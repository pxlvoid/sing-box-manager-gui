package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

// ipAPIResponse represents the response from ip-api.com/json/
type ipAPIResponse struct {
	Status      string  `json:"status"` // "success" or "fail"
	Message     string  `json:"message,omitempty"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	Region      string  `json:"region"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	Zip         string  `json:"zip"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	Timezone    string  `json:"timezone"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
	AS          string  `json:"as"`
	Query       string  `json:"query"` // IP address
}

const (
	geoIPURL              = "http://ip-api.com/json/"
	geoRequestTimeout     = 10 * time.Second
	geoCacheMaxAge        = 24 * time.Hour
	geoRateInterval       = 1500 * time.Millisecond // ~40 req/min to stay under 45 req/min limit
	geoUnknownCountryCode = "UNKNOWN"
	geoUnknownCountryName = "Unknown"
)

// performGeoCheck runs GeoIP lookups for the given nodes through the probe's mixed proxy.
// It uses the GeoSelector to route each request through a specific node.
// Returns a map of "server:port" -> GeoData for nodes that were checked.
func (s *Server) performGeoCheck(nodes []storage.Node) (map[string]*storage.GeoData, error) {
	if len(nodes) == 0 {
		return map[string]*storage.GeoData{}, nil
	}

	// Deduplicate nodes by server:port
	seen := make(map[string]bool, len(nodes))
	var uniqueNodes []storage.Node
	for _, n := range nodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if !seen[key] {
			seen[key] = true
			uniqueNodes = append(uniqueNodes, n)
		}
	}

	// Ensure probe is running and get ports
	clashPort, tagMap, geoProxyPort, _, err := s.probeManager.EnsureRunning(uniqueNodes)
	if err != nil {
		return nil, fmt.Errorf("probe not available: %w", err)
	}
	if geoProxyPort == 0 {
		return nil, fmt.Errorf("geo proxy port not available")
	}

	// Get existing geo data to check cache
	keys := make([]string, 0, len(uniqueNodes))
	for _, n := range uniqueNodes {
		keys = append(keys, fmt.Sprintf("%s:%d", n.Server, n.ServerPort))
	}
	existingGeo, err := s.store.GetGeoDataBulk(keys)
	if err != nil {
		logger.Printf("[geo] Failed to fetch existing geo data: %v", err)
		existingGeo = map[string]*storage.GeoData{}
	}

	// Filter: skip nodes with fresh geo data (< 24h)
	cutoff := time.Now().Add(-geoCacheMaxAge)
	var nodesToCheck []storage.Node
	for _, n := range uniqueNodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if existing, ok := existingGeo[key]; ok && existing.Timestamp.After(cutoff) && existing.Status == "success" {
			continue // fresh data, skip
		}
		nodesToCheck = append(nodesToCheck, n)
	}

	if len(nodesToCheck) == 0 {
		logger.Printf("[geo] All %d nodes have fresh geo data, skipping", len(uniqueNodes))
		return existingGeo, nil
	}

	logger.Printf("[geo] Checking GeoIP for %d nodes (skipped %d with fresh data)", len(nodesToCheck), len(uniqueNodes)-len(nodesToCheck))

	results := make(map[string]*storage.GeoData)

	// Copy existing fresh results
	for k, v := range existingGeo {
		results[k] = v
	}

	proxyURL := fmt.Sprintf("socks5://127.0.0.1:%d", geoProxyPort)

	total := len(nodesToCheck)
	for i, node := range nodesToCheck {
		key := fmt.Sprintf("%s:%d", node.Server, node.ServerPort)

		// Find probe tag for this node
		probeTag := node.Tag
		if tagMap != nil {
			if pt, ok := tagMap.KeyToProbe[key]; ok {
				probeTag = pt
			}
		}

		// Switch GeoSelector to this node via Clash API
		if err := s.clashSwitchSelector(clashPort, "GeoSelector", probeTag); err != nil {
			logger.Printf("[geo] Failed to switch selector to %s: %v", probeTag, err)
			failData := storage.GeoData{
				Server:      node.Server,
				ServerPort:  node.ServerPort,
				NodeTag:     node.Tag,
				Timestamp:   time.Now(),
				Status:      "fail",
				Country:     geoUnknownCountryName,
				CountryCode: geoUnknownCountryCode,
			}
			if saveErr := s.store.UpsertGeoData(failData); saveErr != nil {
				logger.Printf("[geo] Failed to save geo fail status for %s: %v", key, saveErr)
			}
			if saveErr := s.store.UpdateNodeCountry(node.Server, node.ServerPort, geoUnknownCountryCode, storage.GetCountryEmoji(geoUnknownCountryCode)); saveErr != nil {
				logger.Printf("[geo] Failed to set unknown country for %s: %v", key, saveErr)
			}
			results[key] = &failData
			s.eventBus.Publish("verify:geo_progress", map[string]interface{}{
				"current": i + 1,
				"total":   total,
				"tag":     node.Tag,
				"country": geoUnknownCountryCode,
				"status":  "fail",
			})
			continue
		}

		// Small delay to let the selector switch take effect
		time.Sleep(50 * time.Millisecond)

		// Make HTTP request to ip-api.com through the proxy
		geoData, err := s.fetchGeoIP(proxyURL, node)
		if err != nil {
			logger.Printf("[geo] GeoIP lookup failed for %s (%s): %v", node.Tag, key, err)
			failData := storage.GeoData{
				Server:      node.Server,
				ServerPort:  node.ServerPort,
				NodeTag:     node.Tag,
				Timestamp:   time.Now(),
				Status:      "fail",
				Country:     geoUnknownCountryName,
				CountryCode: geoUnknownCountryCode,
			}
			if saveErr := s.store.UpsertGeoData(failData); saveErr != nil {
				logger.Printf("[geo] Failed to save geo fail status for %s: %v", key, saveErr)
			}
			if saveErr := s.store.UpdateNodeCountry(node.Server, node.ServerPort, geoUnknownCountryCode, storage.GetCountryEmoji(geoUnknownCountryCode)); saveErr != nil {
				logger.Printf("[geo] Failed to set unknown country for %s: %v", key, saveErr)
			}
			results[key] = &failData
			s.eventBus.Publish("verify:geo_progress", map[string]interface{}{
				"current": i + 1,
				"total":   total,
				"tag":     node.Tag,
				"country": geoUnknownCountryCode,
				"status":  "fail",
			})
			continue
		}

		// Save to DB
		if err := s.store.UpsertGeoData(*geoData); err != nil {
			logger.Printf("[geo] Failed to save geo data for %s: %v", key, err)
		}

		// Update node country if country_code changed
		if geoData.Status == "success" && geoData.CountryCode != "" {
			emoji := storage.GetCountryEmoji(geoData.CountryCode)
			if err := s.store.UpdateNodeCountry(node.Server, node.ServerPort, geoData.CountryCode, emoji); err != nil {
				logger.Printf("[geo] Failed to update country for %s: %v", key, err)
			}
		}

		results[key] = geoData

		// Publish progress
		s.eventBus.Publish("verify:geo_progress", map[string]interface{}{
			"current": i + 1,
			"total":   total,
			"tag":     node.Tag,
			"country": geoData.CountryCode,
			"city":    geoData.City,
			"ip":      geoData.QueryIP,
			"status":  "success",
		})

		// Rate limit: wait between requests (except after the last one)
		if i < total-1 {
			time.Sleep(geoRateInterval)
		}
	}

	logger.Printf("[geo] GeoIP check completed: %d/%d nodes checked", len(nodesToCheck), len(uniqueNodes))
	return results, nil
}

// clashSwitchSelector switches a selector outbound to the specified proxy via Clash API.
func (s *Server) clashSwitchSelector(clashPort int, selectorTag, proxyTag string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	reqBody, _ := json.Marshal(map[string]string{"name": proxyTag})
	apiURL := fmt.Sprintf("http://127.0.0.1:%d/proxies/%s", clashPort, neturl.PathEscape(selectorTag))

	req, err := http.NewRequest("PUT", apiURL, strings.NewReader(string(reqBody)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("clash API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("clash API error %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// fetchGeoIP makes an HTTP request to ip-api.com through the given SOCKS5 proxy.
func (s *Server) fetchGeoIP(proxyURL string, node storage.Node) (*storage.GeoData, error) {
	proxy, err := neturl.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	client := &http.Client{
		Timeout:   geoRequestTimeout,
		Transport: &http.Transport{Proxy: http.ProxyURL(proxy)},
	}

	resp, err := client.Get(geoIPURL)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var apiResp ipAPIResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	if apiResp.Status != "success" {
		return nil, fmt.Errorf("ip-api returned fail: %s", apiResp.Message)
	}

	return &storage.GeoData{
		Server:      node.Server,
		ServerPort:  node.ServerPort,
		NodeTag:     node.Tag,
		Timestamp:   time.Now(),
		Status:      "success",
		Country:     apiResp.Country,
		CountryCode: apiResp.CountryCode,
		Region:      apiResp.Region,
		RegionName:  apiResp.RegionName,
		City:        apiResp.City,
		Zip:         apiResp.Zip,
		Lat:         apiResp.Lat,
		Lon:         apiResp.Lon,
		Timezone:    apiResp.Timezone,
		ISP:         apiResp.ISP,
		Org:         apiResp.Org,
		AS:          apiResp.AS,
		QueryIP:     apiResp.Query,
	}, nil
}

// --- API Handlers ---

// getAllGeoData returns all geo data records.
func (s *Server) getAllGeoData(c *gin.Context) {
	data, err := s.store.GetAllGeoData()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

// getNodeGeoData returns geo data for a specific node.
func (s *Server) getNodeGeoData(c *gin.Context) {
	server := c.Param("server")
	portStr := c.Param("port")
	port, err := strconv.Atoi(portStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid port"})
		return
	}

	data, err := s.store.GetGeoData(server, port)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "geo data not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

// geoCheckNodes triggers a GeoIP check for nodes (optionally filtered by tags).
func (s *Server) geoCheckNodes(c *gin.Context) {
	var req struct {
		Tags []string `json:"tags"`
	}
	c.ShouldBindJSON(&req)

	allNodes := s.store.GetAllNodesIncludeDisabled()

	var nodes []storage.Node
	if len(req.Tags) > 0 {
		tagSet := make(map[string]bool)
		for _, t := range req.Tags {
			tagSet[t] = true
		}
		for _, n := range allNodes {
			if tagSet[n.Tag] {
				nodes = append(nodes, n)
			}
		}
	} else {
		nodes = allNodes
	}

	if len(nodes) == 0 {
		c.JSON(http.StatusOK, gin.H{"data": map[string]*storage.GeoData{}, "checked": 0})
		return
	}

	s.eventBus.Publish("verify:geo_start", map[string]interface{}{
		"total_nodes": len(nodes),
	})

	results, err := s.performGeoCheck(nodes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.eventBus.Publish("verify:geo_complete", map[string]interface{}{
		"checked": len(results),
	})

	c.JSON(http.StatusOK, gin.H{"data": results, "checked": len(results)})
}
