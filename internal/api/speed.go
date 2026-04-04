package api

import (
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

const (
	// Test file URL (~10MB, hosted on Cloudflare CDN — fast and reliable)
	speedTestURL     = "http://speed.cloudflare.com/__down?bytes=10000000"
	speedTestTimeout = 30 * time.Second
)

// SpeedTestResult represents the speed test result for a node
type SpeedTestResult struct {
	DownloadBps   int64  `json:"download_bps"`
	DownloadBytes int64  `json:"download_bytes"`
	DurationMs    int    `json:"duration_ms"`
	Error         string `json:"error,omitempty"`
}

// performSpeedTest runs speed tests for the given nodes by downloading a test file through each.
func (s *Server) performSpeedTest(nodes []storage.Node) (map[string]*SpeedTestResult, error) {
	if len(nodes) == 0 {
		return map[string]*SpeedTestResult{}, nil
	}

	// Deduplicate by server:port
	seen := make(map[string]bool, len(nodes))
	var uniqueNodes []storage.Node
	for _, n := range nodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if !seen[key] {
			seen[key] = true
			uniqueNodes = append(uniqueNodes, n)
		}
	}

	clashPort, tagMap, geoProxyPort, _, err := s.probeManager.EnsureRunning(uniqueNodes)
	if err != nil {
		return nil, fmt.Errorf("probe not available: %w", err)
	}
	if geoProxyPort == 0 {
		return nil, fmt.Errorf("proxy port not available")
	}

	proxyURL := fmt.Sprintf("socks5://127.0.0.1:%d", geoProxyPort)

	results := make(map[string]*SpeedTestResult)
	var mu sync.Mutex
	// Run sequentially — speed tests are bandwidth-bound, parallel would interfere
	var completed atomic.Int32
	total := int32(len(uniqueNodes))

	for _, node := range uniqueNodes {
		key := fmt.Sprintf("%s:%d", node.Server, node.ServerPort)

		probeTag := nodeRoutingTag(node)
		if tagMap != nil {
			if pt, ok := tagMap.KeyToProbe[key]; ok {
				probeTag = pt
			}
		}

		// Switch GeoSelector to this node
		if err := s.clashSwitchSelector(clashPort, "GeoSelector", probeTag); err != nil {
			logger.Printf("[speed] Failed to switch selector to %s: %v", probeTag, err)
			mu.Lock()
			results[key] = &SpeedTestResult{Error: "selector_switch: " + err.Error()}
			mu.Unlock()
			completed.Add(1)
			s.eventBus.Publish("speed:progress", map[string]interface{}{
				"current": completed.Load(),
				"total":   total,
				"tag":     nodeDisplayName(node),
				"status":  "error",
			})
			continue
		}

		time.Sleep(100 * time.Millisecond) // let selector switch take effect

		nodeTag := nodeDisplayName(node)
		result := s.downloadSpeedTest(proxyURL, func(downloaded, total int64) {
			s.eventBus.Publish("speed:download_progress", map[string]interface{}{
				"tag":        nodeTag,
				"downloaded": downloaded,
				"total":      total,
			})
		})

		mu.Lock()
		results[key] = result
		mu.Unlock()

		cur := completed.Add(1)
		status := "ok"
		if result.Error != "" {
			status = "error"
		}
		s.eventBus.Publish("speed:progress", map[string]interface{}{
			"current":      cur,
			"total":        total,
			"tag":          nodeDisplayName(node),
			"download_bps": result.DownloadBps,
			"status":       status,
		})
	}

	// Save measurements
	now := time.Now()
	var measurements []storage.SpeedMeasurement
	for _, n := range uniqueNodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if r, ok := results[key]; ok {
			measurements = append(measurements, storage.SpeedMeasurement{
				Server:        n.Server,
				ServerPort:    n.ServerPort,
				NodeTag:       nodeRoutingTag(n),
				Timestamp:     now,
				DownloadBps:   r.DownloadBps,
				DownloadBytes: r.DownloadBytes,
				DurationMs:    r.DurationMs,
				Error:         r.Error,
			})
		}
	}
	if len(measurements) > 0 {
		if err := s.store.AddSpeedMeasurements(measurements); err != nil {
			logger.Printf("[speed] Failed to save measurements: %v", err)
		}
	}

	return results, nil
}

// progressWriter wraps io.Discard and reports download progress via a callback.
type progressWriter struct {
	downloaded int64
	total      int64
	onProgress func(downloaded, total int64)
	lastReport time.Time
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.downloaded += int64(n)
	if pw.onProgress != nil && time.Since(pw.lastReport) >= 250*time.Millisecond {
		pw.lastReport = time.Now()
		pw.onProgress(pw.downloaded, pw.total)
	}
	return n, nil
}

// downloadSpeedTest downloads a test file through the given SOCKS5 proxy and measures throughput.
func (s *Server) downloadSpeedTest(proxyURL string, onProgress func(downloaded, total int64)) *SpeedTestResult {
	proxy, err := neturl.Parse(proxyURL)
	if err != nil {
		return &SpeedTestResult{Error: "bad_proxy: " + err.Error()}
	}

	transport := &http.Transport{
		Proxy: http.ProxyURL(proxy),
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   speedTestTimeout,
	}

	start := time.Now()
	resp, err := client.Get(speedTestURL)
	if err != nil {
		return &SpeedTestResult{Error: "download: " + err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &SpeedTestResult{Error: fmt.Sprintf("http_%d", resp.StatusCode)}
	}

	pw := &progressWriter{
		total:      resp.ContentLength,
		onProgress: onProgress,
	}
	n, err := io.Copy(pw, resp.Body)
	duration := time.Since(start)

	durationMs := int(duration.Milliseconds())
	if durationMs == 0 {
		durationMs = 1
	}

	result := &SpeedTestResult{
		DownloadBytes: n,
		DurationMs:    durationMs,
		DownloadBps:   n * 1000 / int64(durationMs), // bytes per second
	}

	if err != nil {
		result.Error = "partial: " + err.Error()
	}

	return result
}

// speedCheckNodes handles POST /nodes/speed-test
func (s *Server) speedCheckNodes(c *gin.Context) {
	var req struct {
		Tags []string `json:"tags"`
	}
	c.ShouldBindJSON(&req)

	allNodes := s.store.GetAllNodes()

	var nodes []storage.Node
	if len(req.Tags) > 0 {
		tagSet := parseTagSet(req.Tags)
		for _, n := range allNodes {
			if nodeMatchesAnyTag(n, tagSet) {
				nodes = append(nodes, n)
			}
		}
	} else {
		nodes = allNodes
	}

	if len(nodes) == 0 {
		c.JSON(http.StatusOK, gin.H{"data": map[string]*SpeedTestResult{}})
		return
	}

	s.eventBus.Publish("speed:start", map[string]interface{}{
		"total": len(nodes),
	})

	results, err := s.performSpeedTest(nodes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.eventBus.Publish("speed:complete", map[string]interface{}{
		"total": len(results),
	})

	c.JSON(http.StatusOK, gin.H{"data": results})
}

// getLatestSpeedMeasurements handles GET /measurements/speed/latest
func (s *Server) getLatestSpeedMeasurements(c *gin.Context) {
	measurements, err := s.store.GetLatestSpeedMeasurements()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": measurements})
}
