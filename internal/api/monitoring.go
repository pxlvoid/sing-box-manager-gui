package api

import (
	"bufio"
	"bytes"
	cryptorand "crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

type clashConnectionMetadata struct {
	SourceIP      string `json:"sourceIP"`
	DestinationIP string `json:"destinationIP"`
	Host          string `json:"host"`
}

type clashConnection struct {
	ID       string                  `json:"id"`
	Metadata clashConnectionMetadata `json:"metadata"`
	Upload   int64                   `json:"upload"`
	Download int64                   `json:"download"`
	Start    string                  `json:"start"`
	Chains   []string                `json:"chains"`
}

type clashMemoryStats struct {
	Inuse   int64 `json:"inuse"`
	OSLimit int64 `json:"oslimit"`
}

func (m *clashMemoryStats) UnmarshalJSON(data []byte) error {
	payload := bytes.TrimSpace(data)
	if len(payload) == 0 || bytes.Equal(payload, []byte("null")) {
		*m = clashMemoryStats{}
		return nil
	}

	if payload[0] == '{' {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(payload, &raw); err != nil {
			return err
		}

		if value, ok := raw["inuse"]; ok {
			parsed, err := parseJSONInt64(value)
			if err != nil {
				return fmt.Errorf("memory.inuse: %w", err)
			}
			m.Inuse = parsed
		}

		if value, ok := raw["oslimit"]; ok {
			parsed, err := parseJSONInt64(value)
			if err != nil {
				return fmt.Errorf("memory.oslimit: %w", err)
			}
			m.OSLimit = parsed
		}
		return nil
	}

	inuse, err := parseJSONInt64(payload)
	if err != nil {
		return fmt.Errorf("memory: %w", err)
	}
	m.Inuse = inuse
	m.OSLimit = 0
	return nil
}

func parseJSONInt64(raw json.RawMessage) (int64, error) {
	value := bytes.TrimSpace(raw)
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		return 0, nil
	}

	var i int64
	if err := json.Unmarshal(value, &i); err == nil {
		return i, nil
	}

	var f float64
	if err := json.Unmarshal(value, &f); err == nil {
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, fmt.Errorf("invalid numeric value")
		}
		return int64(f), nil
	}

	var s string
	if err := json.Unmarshal(value, &s); err == nil {
		s = strings.TrimSpace(s)
		if s == "" {
			return 0, nil
		}
		if parsed, err := strconv.ParseInt(s, 10, 64); err == nil {
			return parsed, nil
		}
		if parsed, err := strconv.ParseFloat(s, 64); err == nil {
			if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
				return 0, fmt.Errorf("invalid numeric value")
			}
			return int64(parsed), nil
		}
		return 0, fmt.Errorf("invalid numeric string %q", s)
	}

	return 0, fmt.Errorf("unsupported value %q", string(value))
}

type clashConnectionsSnapshot struct {
	DownloadTotal int64             `json:"downloadTotal"`
	UploadTotal   int64             `json:"uploadTotal"`
	Connections   []clashConnection `json:"connections"`
	Memory        clashMemoryStats  `json:"memory"`
}

type clientAccumulator struct {
	SourceIP          string
	ActiveConnections int
	UploadBytes       int64
	DownloadBytes     int64
	EarliestStart     time.Time
	HostSet           map[string]struct{}
	ChainCount        map[string]int
}

type resourceAccumulator struct {
	SourceIP          string
	Host              string
	ActiveConnections int
	UploadBytes       int64
	DownloadBytes     int64
	ProxyChain        string
}

type monitoringNodeTrafficItem struct {
	NodeTag       string    `json:"node_tag"`
	DisplayName   string    `json:"display_name,omitempty"`
	SourceTag     string    `json:"source_tag,omitempty"`
	LastSeen      time.Time `json:"last_seen"`
	UploadBytes   int64     `json:"upload_bytes"`
	DownloadBytes int64     `json:"download_bytes"`
	TotalBytes    int64     `json:"total_bytes"`
}

type monitoringNodeMeta struct {
	DisplayName string
	SourceTag   string
}

func (s *Server) startTrafficAggregator() {
	go func() {
		// Small startup delay to avoid noisy errors while the app boots.
		time.Sleep(2 * time.Second)

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			s.collectAndPersistTrafficSample()
		}
	}()
}

func (s *Server) collectAndPersistTrafficSample() {
	s.storeSwapMu.RLock()
	defer s.storeSwapMu.RUnlock()

	running := s.processManager.IsRunning()

	snapshot, err := s.fetchConnectionsSnapshot()
	if err != nil {
		if running {
			logger.Printf("[monitoring] failed to fetch connections snapshot: %v", err)
		}
		s.resetTrafficRateState()
		return
	}

	if !running {
		logger.Printf("[monitoring] sing-box not tracked by process manager but Clash API responded, collecting sample anyway")
	}

	now := time.Now().UTC()
	upBps, downBps := s.computeTrafficRates(snapshot.UploadTotal, snapshot.DownloadTotal, now)
	clients, resources := aggregateConnections(snapshot.Connections, now)

	sample := storage.TrafficSample{
		Timestamp:         now,
		UpBps:             upBps,
		DownBps:           downBps,
		UploadTotal:       snapshot.UploadTotal,
		DownloadTotal:     snapshot.DownloadTotal,
		ActiveConnections: len(snapshot.Connections),
		ClientCount:       len(clients),
		MemoryInuse:       snapshot.Memory.Inuse,
		MemoryOSLimit:     snapshot.Memory.OSLimit,
	}

	if _, err := s.store.AddTrafficSample(sample, clients, resources); err != nil {
		logger.Printf("[monitoring] failed to persist traffic sample: %v", err)
	}
}

func (s *Server) computeTrafficRates(uploadTotal, downloadTotal int64, now time.Time) (int64, int64) {
	s.monitoringMu.Lock()
	defer s.monitoringMu.Unlock()

	if s.lastTrafficSampleAt.IsZero() {
		s.lastTrafficSampleAt = now
		s.lastTrafficUploadTotal = uploadTotal
		s.lastTrafficDownTotal = downloadTotal
		return 0, 0
	}

	elapsed := now.Sub(s.lastTrafficSampleAt).Seconds()
	if elapsed <= 0 {
		elapsed = 1
	}

	upDelta := uploadTotal - s.lastTrafficUploadTotal
	downDelta := downloadTotal - s.lastTrafficDownTotal
	if upDelta < 0 {
		upDelta = 0
	}
	if downDelta < 0 {
		downDelta = 0
	}

	upBps := int64(float64(upDelta) / elapsed)
	downBps := int64(float64(downDelta) / elapsed)

	s.lastTrafficSampleAt = now
	s.lastTrafficUploadTotal = uploadTotal
	s.lastTrafficDownTotal = downloadTotal

	return upBps, downBps
}

func (s *Server) resetTrafficRateState() {
	s.monitoringMu.Lock()
	s.lastTrafficSampleAt = time.Time{}
	s.lastTrafficUploadTotal = 0
	s.lastTrafficDownTotal = 0
	s.monitoringMu.Unlock()
}

func (s *Server) fetchConnectionsSnapshot() (*clashConnectionsSnapshot, error) {
	resp, err := s.clashAPIRequest("GET", "/connections", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("Clash API /connections status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var snapshot clashConnectionsSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&snapshot); err != nil {
		return nil, err
	}
	if snapshot.Connections == nil {
		snapshot.Connections = []clashConnection{}
	}

	return &snapshot, nil
}

func aggregateConnections(connections []clashConnection, now time.Time) ([]storage.ClientTrafficSnapshot, []storage.ClientResourceSnapshot) {
	clientMap := make(map[string]*clientAccumulator)
	resourceMap := make(map[string]*resourceAccumulator)

	for _, conn := range connections {
		sourceIP := strings.TrimSpace(conn.Metadata.SourceIP)
		if sourceIP == "" {
			sourceIP = "unknown"
		}
		host := normalizeConnectionHost(conn.Metadata.Host, conn.Metadata.DestinationIP)
		chain := normalizeProxyChain(conn.Chains)

		clientEntry, ok := clientMap[sourceIP]
		if !ok {
			clientEntry = &clientAccumulator{
				SourceIP:   sourceIP,
				HostSet:    make(map[string]struct{}),
				ChainCount: make(map[string]int),
			}
			clientMap[sourceIP] = clientEntry
		}
		clientEntry.ActiveConnections++
		clientEntry.UploadBytes += maxI64(conn.Upload, 0)
		clientEntry.DownloadBytes += maxI64(conn.Download, 0)
		clientEntry.ChainCount[chain]++
		if host != "" {
			clientEntry.HostSet[host] = struct{}{}
		}
		if startAt, err := time.Parse(time.RFC3339, conn.Start); err == nil {
			if clientEntry.EarliestStart.IsZero() || startAt.Before(clientEntry.EarliestStart) {
				clientEntry.EarliestStart = startAt
			}
		}

		if host == "" {
			continue
		}
		key := sourceIP + "\x00" + host
		resourceEntry, ok := resourceMap[key]
		if !ok {
			resourceEntry = &resourceAccumulator{
				SourceIP:   sourceIP,
				Host:       host,
				ProxyChain: chain,
			}
			resourceMap[key] = resourceEntry
		}
		resourceEntry.ActiveConnections++
		resourceEntry.UploadBytes += maxI64(conn.Upload, 0)
		resourceEntry.DownloadBytes += maxI64(conn.Download, 0)
		if resourceEntry.ProxyChain == "" || resourceEntry.ProxyChain == "direct" {
			resourceEntry.ProxyChain = chain
		}
	}

	topHostByIP := make(map[string]string)
	topHostTrafficByIP := make(map[string]int64)
	for _, resource := range resourceMap {
		traffic := resource.UploadBytes + resource.DownloadBytes
		if traffic > topHostTrafficByIP[resource.SourceIP] {
			topHostTrafficByIP[resource.SourceIP] = traffic
			topHostByIP[resource.SourceIP] = resource.Host
		}
	}

	clients := make([]storage.ClientTrafficSnapshot, 0, len(clientMap))
	for _, client := range clientMap {
		duration := int64(0)
		if !client.EarliestStart.IsZero() && now.After(client.EarliestStart) {
			duration = int64(now.Sub(client.EarliestStart).Seconds())
		}

		clients = append(clients, storage.ClientTrafficSnapshot{
			Timestamp:         now,
			SourceIP:          client.SourceIP,
			ActiveConnections: client.ActiveConnections,
			UploadBytes:       client.UploadBytes,
			DownloadBytes:     client.DownloadBytes,
			DurationSeconds:   duration,
			ProxyChain:        mostFrequentKey(client.ChainCount, "direct"),
			HostCount:         len(client.HostSet),
			TopHost:           topHostByIP[client.SourceIP],
		})
	}

	resources := make([]storage.ClientResourceSnapshot, 0, len(resourceMap))
	for _, resource := range resourceMap {
		resources = append(resources, storage.ClientResourceSnapshot{
			Timestamp:         now,
			SourceIP:          resource.SourceIP,
			Host:              resource.Host,
			ActiveConnections: resource.ActiveConnections,
			UploadBytes:       resource.UploadBytes,
			DownloadBytes:     resource.DownloadBytes,
			ProxyChain:        resource.ProxyChain,
		})
	}

	sortClientSnapshots(clients)
	sortResourceSnapshots(resources)
	return clients, resources
}

func normalizeConnectionHost(host, destinationIP string) string {
	h := strings.TrimSpace(strings.ToLower(host))
	if h != "" {
		return h
	}
	return strings.TrimSpace(destinationIP)
}

func normalizeProxyChain(chains []string) string {
	if len(chains) == 0 {
		return "direct"
	}
	parts := make([]string, 0, len(chains))
	for _, chain := range chains {
		trimmed := strings.TrimSpace(chain)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	if len(parts) == 0 {
		return "direct"
	}
	return strings.Join(parts, " -> ")
}

func mostFrequentKey(counter map[string]int, fallback string) string {
	bestKey := fallback
	bestCount := -1
	for key, count := range counter {
		if count > bestCount {
			bestKey = key
			bestCount = count
		}
	}
	return bestKey
}

func sortClientSnapshots(clients []storage.ClientTrafficSnapshot) {
	if len(clients) < 2 {
		return
	}
	sort.Slice(clients, func(i, j int) bool {
		ti := clients[i].UploadBytes + clients[i].DownloadBytes
		tj := clients[j].UploadBytes + clients[j].DownloadBytes
		if ti == tj {
			return clients[i].ActiveConnections > clients[j].ActiveConnections
		}
		return ti > tj
	})
}

func sortResourceSnapshots(resources []storage.ClientResourceSnapshot) {
	if len(resources) < 2 {
		return
	}
	sort.Slice(resources, func(i, j int) bool {
		ti := resources[i].UploadBytes + resources[i].DownloadBytes
		tj := resources[j].UploadBytes + resources[j].DownloadBytes
		if ti == tj {
			return resources[i].ActiveConnections > resources[j].ActiveConnections
		}
		return ti > tj
	})
}

func maxI64(v, min int64) int64 {
	if v < min {
		return min
	}
	return v
}

func collectKnownNodeTags(store storage.Store) map[string]string {
	knownTags := make(map[string]string)
	statuses := []storage.NodeStatus{
		storage.NodeStatusPending,
		storage.NodeStatusVerified,
		storage.NodeStatusArchived,
	}
	for _, status := range statuses {
		for _, node := range store.GetNodes(status) {
			canonical := unifiedRoutingTag(node)
			if canonical == "" {
				continue
			}
			for _, alias := range unifiedNodeTagCandidates(node) {
				knownTags[alias] = canonical
			}
		}
	}
	if len(knownTags) > 0 {
		return knownTags
	}

	for _, node := range store.GetAllNodes() {
		canonical := nodeRoutingTag(node)
		if canonical == "" {
			continue
		}
		for _, alias := range nodeTagCandidates(node) {
			knownTags[alias] = canonical
		}
	}
	return knownTags
}

func collectKnownNodeMeta(store storage.Store) map[string]monitoringNodeMeta {
	meta := make(map[string]monitoringNodeMeta)
	statuses := []storage.NodeStatus{
		storage.NodeStatusPending,
		storage.NodeStatusVerified,
		storage.NodeStatusArchived,
	}
	for _, status := range statuses {
		for _, node := range store.GetNodes(status) {
			canonical := unifiedRoutingTag(node)
			if canonical == "" {
				continue
			}
			if _, exists := meta[canonical]; exists {
				continue
			}
			meta[canonical] = monitoringNodeMeta{
				DisplayName: unifiedDisplayName(node),
				SourceTag:   unifiedSourceTag(node),
			}
		}
	}
	if len(meta) > 0 {
		return meta
	}
	for _, node := range store.GetAllNodes() {
		canonical := nodeRoutingTag(node)
		if canonical == "" {
			continue
		}
		if _, exists := meta[canonical]; exists {
			continue
		}
		meta[canonical] = monitoringNodeMeta{
			DisplayName: nodeDisplayName(node),
			SourceTag:   nodeSourceTag(node),
		}
	}
	return meta
}

func selectNodeTagFromChain(proxyChain string, knownTags map[string]string) (string, bool) {
	parts := splitProxyChain(proxyChain)
	if len(parts) == 0 {
		return "", false
	}
	if len(knownTags) == 0 {
		return parts[0], true
	}
	for _, part := range parts {
		if canonical, ok := knownTags[part]; ok {
			return canonical, true
		}
	}
	return "", false
}

func splitProxyChain(proxyChain string) []string {
	chain := strings.TrimSpace(proxyChain)
	if chain == "" || strings.EqualFold(chain, "direct") {
		return nil
	}
	raw := strings.Split(chain, "->")
	parts := make([]string, 0, len(raw))
	for _, part := range raw {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}

func (s *Server) getMonitoringOverview(c *gin.Context) {
	latest, err := s.store.GetLatestTrafficSample()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if latest == nil {
		latest = &storage.TrafficSample{
			Timestamp: time.Now().UTC(),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"running":            s.processManager.IsRunning(),
			"timestamp":          latest.Timestamp,
			"up_bps":             latest.UpBps,
			"down_bps":           latest.DownBps,
			"upload_total":       latest.UploadTotal,
			"download_total":     latest.DownloadTotal,
			"active_connections": latest.ActiveConnections,
			"client_count":       latest.ClientCount,
			"memory_inuse":       latest.MemoryInuse,
			"memory_oslimit":     latest.MemoryOSLimit,
		},
	})
}

func (s *Server) getMonitoringLifetimeStats(c *gin.Context) {
	stats, err := s.store.GetTrafficLifetimeStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if stats == nil {
		stats = &storage.TrafficLifetimeStats{}
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"sample_count":         stats.SampleCount,
			"total_clients":        stats.TotalClients,
			"total_upload_bytes":   stats.TotalUploadBytes,
			"total_download_bytes": stats.TotalDownloadBytes,
			"total_traffic_bytes":  stats.TotalUploadBytes + stats.TotalDownloadBytes,
			"first_sample_at":      stats.FirstSampleAt,
			"last_sample_at":       stats.LastSampleAt,
		},
	})
}

func (s *Server) getMonitoringHistory(c *gin.Context) {
	limit := 120
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	samples, err := s.store.GetTrafficSamples(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": samples})
}

func (s *Server) getMonitoringClients(c *gin.Context) {
	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	clients, err := s.store.GetLatestTrafficClients(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": clients})
}

func (s *Server) getMonitoringRecentClients(c *gin.Context) {
	limit := 300
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	hours := 24
	if raw := strings.TrimSpace(c.Query("hours")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			hours = parsed
		}
	}
	if hours > 24*30 {
		hours = 24 * 30
	}

	clients, err := s.store.GetRecentTrafficClients(limit, time.Duration(hours)*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": clients})
}

func (s *Server) getMonitoringResources(c *gin.Context) {
	limit := 300
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	sourceIP := strings.TrimSpace(c.Query("source_ip"))
	resources, err := s.store.GetLatestTrafficResources(limit, sourceIP)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": resources})
}

func (s *Server) getMonitoringNodesTraffic(c *gin.Context) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if limit > 2000 {
		limit = 2000
	}

	hours := 0
	if raw := strings.TrimSpace(c.Query("hours")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			hours = parsed
		}
	}
	if hours > 24*365 {
		hours = 24 * 365
	}

	chainLimit := limit * 20
	if chainLimit < 500 {
		chainLimit = 500
	}
	if chainLimit > 5000 {
		chainLimit = 5000
	}

	var lookback time.Duration
	if hours > 0 {
		lookback = time.Duration(hours) * time.Hour
	}

	chainStats, err := s.store.GetTrafficChainStats(chainLimit, lookback)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	knownTags := collectKnownNodeTags(s.store)
	knownMeta := collectKnownNodeMeta(s.store)
	agg := make(map[string]*monitoringNodeTrafficItem, len(chainStats))

	for _, chainStat := range chainStats {
		nodeTag, ok := selectNodeTagFromChain(chainStat.ProxyChain, knownTags)
		if !ok || nodeTag == "" {
			continue
		}

		item, exists := agg[nodeTag]
		if !exists {
			item = &monitoringNodeTrafficItem{NodeTag: nodeTag}
			if meta, ok := knownMeta[nodeTag]; ok {
				item.DisplayName = meta.DisplayName
				item.SourceTag = meta.SourceTag
			}
			agg[nodeTag] = item
		}
		item.UploadBytes += maxI64(chainStat.UploadBytes, 0)
		item.DownloadBytes += maxI64(chainStat.DownloadBytes, 0)
		if item.LastSeen.IsZero() || chainStat.LastSeen.After(item.LastSeen) {
			item.LastSeen = chainStat.LastSeen
		}
	}

	items := make([]monitoringNodeTrafficItem, 0, len(agg))
	for _, item := range agg {
		item.TotalBytes = item.UploadBytes + item.DownloadBytes
		items = append(items, *item)
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].TotalBytes == items[j].TotalBytes {
			return items[i].LastSeen.After(items[j].LastSeen)
		}
		return items[i].TotalBytes > items[j].TotalBytes
	})

	if len(items) > limit {
		items = items[:limit]
	}

	c.JSON(http.StatusOK, gin.H{
		"data": items,
		"meta": gin.H{
			"hours": hours,
		},
	})
}

func (s *Server) streamTrafficWebSocket(c *gin.Context) {
	s.proxyClashWebSocket(c, "/traffic", "")
}

func (s *Server) streamConnectionsWebSocket(c *gin.Context) {
	intervalMs := 1000
	if raw := strings.TrimSpace(c.Query("interval")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			intervalMs = parsed
		}
	}
	if intervalMs < 300 {
		intervalMs = 300
	}
	if intervalMs > 10000 {
		intervalMs = 10000
	}
	s.proxyClashWebSocket(c, "/connections", fmt.Sprintf("interval=%d", intervalMs))
}

func (s *Server) proxyClashWebSocket(c *gin.Context, path, rawQuery string) {
	if !s.processManager.IsRunning() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sing-box is not running"})
		return
	}

	downstreamWS, err := upgradeSimpleWebSocket(c.Writer, c.Request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "websocket upgrade failed: " + err.Error()})
		return
	}
	defer downstreamWS.Close()

	settings := s.store.GetSettings()
	if settings.ClashAPIPort == 0 {
		_ = downstreamWS.WriteJSON(gin.H{"error": "Clash API port is not configured"})
		return
	}

	upstreamWS, err := dialUpstreamWebSocket(settings.ClashAPIPort, settings.ClashAPISecret, path, rawQuery)
	if err != nil {
		_ = downstreamWS.WriteJSON(gin.H{"error": "Failed to connect upstream websocket: " + err.Error()})
		return
	}
	defer upstreamWS.Close()

	var fragmentedOpcode byte
	var fragmentedPayload []byte

	for {
		fin, opcode, payload, err := upstreamWS.ReadFrame()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				logger.Printf("[monitoring] upstream ws read error (%s): %v", path, err)
			}
			return
		}

		switch opcode {
		case wsOpcodeText, wsOpcodeBinary:
			if fin {
				if err := downstreamWS.WriteText(payload); err != nil {
					return
				}
				continue
			}
			fragmentedOpcode = opcode
			fragmentedPayload = append(fragmentedPayload[:0], payload...)
		case wsOpcodeContinuation:
			if fragmentedOpcode == 0 {
				continue
			}
			fragmentedPayload = append(fragmentedPayload, payload...)
			if fin {
				if err := downstreamWS.WriteText(fragmentedPayload); err != nil {
					return
				}
				fragmentedOpcode = 0
				fragmentedPayload = fragmentedPayload[:0]
			}
		case wsOpcodePing:
			_ = upstreamWS.WriteControl(wsOpcodePong, payload)
		case wsOpcodePong:
			continue
		case wsOpcodeClose:
			return
		default:
			continue
		}
	}
}

const (
	wsOpcodeContinuation byte = 0x0
	wsOpcodeText         byte = 0x1
	wsOpcodeBinary       byte = 0x2
	wsOpcodeClose        byte = 0x8
	wsOpcodePing         byte = 0x9
	wsOpcodePong         byte = 0xA
)

type upstreamWebSocket struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	closed bool
}

func dialUpstreamWebSocket(port int, secret, path, rawQuery string) (*upstreamWebSocket, error) {
	host := fmt.Sprintf("127.0.0.1:%d", port)
	target := path
	if strings.TrimSpace(rawQuery) != "" {
		target += "?" + rawQuery
	}

	conn, err := net.DialTimeout("tcp", host, 5*time.Second)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("GET", "http://"+host+target, nil)
	if err != nil {
		conn.Close()
		return nil, err
	}

	wsKey, err := generateWebSocketKey()
	if err != nil {
		conn.Close()
		return nil, err
	}

	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", wsKey)
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}

	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}

	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, req)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		conn.Close()
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	expected := computeWebSocketAccept(wsKey)
	got := strings.TrimSpace(resp.Header.Get("Sec-WebSocket-Accept"))
	if got != expected {
		conn.Close()
		return nil, fmt.Errorf("invalid websocket accept key")
	}

	return &upstreamWebSocket{
		conn:   conn,
		reader: reader,
	}, nil
}

func generateWebSocketKey() (string, error) {
	buf := make([]byte, 16)
	if _, err := cryptorand.Read(buf); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf), nil
}

func (ws *upstreamWebSocket) ReadFrame() (fin bool, opcode byte, payload []byte, err error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(ws.reader, header); err != nil {
		return false, 0, nil, err
	}

	fin = (header[0] & 0x80) != 0
	opcode = header[0] & 0x0F
	masked := (header[1] & 0x80) != 0
	payloadLen := uint64(header[1] & 0x7F)

	switch payloadLen {
	case 126:
		var extended [2]byte
		if _, err := io.ReadFull(ws.reader, extended[:]); err != nil {
			return false, 0, nil, err
		}
		payloadLen = uint64(binary.BigEndian.Uint16(extended[:]))
	case 127:
		var extended [8]byte
		if _, err := io.ReadFull(ws.reader, extended[:]); err != nil {
			return false, 0, nil, err
		}
		payloadLen = binary.BigEndian.Uint64(extended[:])
	}
	if payloadLen > 64*1024*1024 {
		return false, 0, nil, fmt.Errorf("websocket payload too large: %d", payloadLen)
	}

	var maskKey [4]byte
	if masked {
		if _, err := io.ReadFull(ws.reader, maskKey[:]); err != nil {
			return false, 0, nil, err
		}
	}

	payload = make([]byte, int(payloadLen))
	if payloadLen > 0 {
		if _, err := io.ReadFull(ws.reader, payload); err != nil {
			return false, 0, nil, err
		}
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}

	return fin, opcode, payload, nil
}

func (ws *upstreamWebSocket) WriteControl(opcode byte, payload []byte) error {
	return ws.writeFrame(opcode, payload, true)
}

func (ws *upstreamWebSocket) writeFrame(opcode byte, payload []byte, mask bool) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if ws.closed {
		return net.ErrClosed
	}

	header := make([]byte, 14)
	header[0] = 0x80 | (opcode & 0x0F) // FIN + opcode

	payloadLen := len(payload)
	headerLen := 2

	switch {
	case payloadLen <= 125:
		header[1] = byte(payloadLen)
	case payloadLen <= 65535:
		header[1] = 126
		binary.BigEndian.PutUint16(header[2:], uint16(payloadLen))
		headerLen = 4
	default:
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:], uint64(payloadLen))
		headerLen = 10
	}

	framePayload := payload
	if mask {
		header[1] |= 0x80
		maskKey := make([]byte, 4)
		if _, err := cryptorand.Read(maskKey); err != nil {
			return err
		}
		copy(header[headerLen:headerLen+4], maskKey)
		headerLen += 4

		framePayload = make([]byte, len(payload))
		for i := range payload {
			framePayload[i] = payload[i] ^ maskKey[i%4]
		}
	}

	if err := writeAll(ws.conn, header[:headerLen]); err != nil {
		ws.closed = true
		return err
	}
	if len(framePayload) > 0 {
		if err := writeAll(ws.conn, framePayload); err != nil {
			ws.closed = true
			return err
		}
	}

	return nil
}

func (ws *upstreamWebSocket) Close() error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return nil
	}
	ws.closed = true
	return ws.conn.Close()
}

const webSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type simpleWebSocket struct {
	conn   net.Conn
	mu     sync.Mutex
	closed bool
}

func upgradeSimpleWebSocket(w http.ResponseWriter, r *http.Request) (*simpleWebSocket, error) {
	if !headerContainsToken(r.Header, "Connection", "Upgrade") || !strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return nil, fmt.Errorf("missing websocket upgrade headers")
	}

	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		return nil, fmt.Errorf("missing Sec-WebSocket-Key")
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, fmt.Errorf("hijacking not supported")
	}

	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}

	accept := computeWebSocketAccept(key)
	if _, err := rw.WriteString(
		"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			"Sec-WebSocket-Accept: " + accept + "\r\n\r\n",
	); err != nil {
		conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}

	return &simpleWebSocket{conn: conn}, nil
}

func computeWebSocketAccept(key string) string {
	hash := sha1.Sum([]byte(key + webSocketGUID))
	return base64.StdEncoding.EncodeToString(hash[:])
}

func headerContainsToken(header http.Header, headerKey, expectedToken string) bool {
	values := header.Values(headerKey)
	for _, value := range values {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), expectedToken) {
				return true
			}
		}
	}
	return false
}

func (ws *simpleWebSocket) WriteJSON(v interface{}) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return ws.WriteText(payload)
}

func (ws *simpleWebSocket) WriteText(payload []byte) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if ws.closed {
		return net.ErrClosed
	}

	header := make([]byte, 10)
	header[0] = 0x81 // FIN + text frame
	headerLen := 2
	payloadLen := len(payload)

	switch {
	case payloadLen <= 125:
		header[1] = byte(payloadLen)
	case payloadLen <= 65535:
		header[1] = 126
		binary.BigEndian.PutUint16(header[2:], uint16(payloadLen))
		headerLen = 4
	default:
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:], uint64(payloadLen))
		headerLen = 10
	}

	if err := writeAll(ws.conn, header[:headerLen]); err != nil {
		ws.closed = true
		return err
	}
	if err := writeAll(ws.conn, payload); err != nil {
		ws.closed = true
		return err
	}
	return nil
}

func writeAll(conn net.Conn, data []byte) error {
	for len(data) > 0 {
		n, err := conn.Write(data)
		if err != nil {
			return err
		}
		data = data[n:]
	}
	return nil
}

func (ws *simpleWebSocket) Close() error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.closed {
		return nil
	}
	ws.closed = true
	return ws.conn.Close()
}
