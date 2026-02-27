package daemon

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/xiaobei/singbox-manager/internal/builder"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

// BrokenNode describes a node that failed sing-box config validation.
type BrokenNode struct {
	Index int    // index in the original nodes slice
	Tag   string // original node tag
	Error string // validation error message
}

// ProbeStatus represents the current state of the probe sing-box instance.
type ProbeStatus struct {
	Running   bool       `json:"running"`
	Port      int        `json:"port"`
	PID       int        `json:"pid"`
	NodeCount int        `json:"node_count"`
	StartedAt *time.Time `json:"started_at,omitempty"`
}

// ProbeManager manages a separate sing-box process used exclusively for
// health-check and site-check probes, keeping the main sing-box untouched.
type ProbeManager struct {
	singboxPath  string
	dataDir      string
	cmd          *exec.Cmd
	port         int
	geoProxyPort int // mixed inbound port for GeoIP lookups
	pid          int
	mu           sync.Mutex
	running      bool
	nodeTags     []string     // sorted tags of nodes currently loaded
	tagMap       *ProbeTagMap // probe tag ↔ original tag mapping
	startedAt    time.Time
	configPath   string // path to the current temp config file
}

// NewProbeManager creates a new ProbeManager.
func NewProbeManager(singboxPath, dataDir string) *ProbeManager {
	return &ProbeManager{
		singboxPath: singboxPath,
		dataDir:     dataDir,
	}
}

// SetSingBoxPath updates the sing-box binary path (e.g. after kernel download).
func (pm *ProbeManager) SetSingBoxPath(path string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.singboxPath = path
}

// Start launches a probe sing-box with a minimal config for the given nodes.
// If already running, it stops the previous instance first.
// Returns the list of broken nodes that were excluded during config validation.
func (pm *ProbeManager) Start(nodes []storage.Node) ([]BrokenNode, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Stop any existing instance (unlocked variant).
	pm.stopLocked()

	if _, err := os.Stat(pm.singboxPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("sing-box binary not found: %s", pm.singboxPath)
	}

	port, err := getFreePort()
	if err != nil {
		return nil, fmt.Errorf("failed to find free port: %w", err)
	}

	geoPort, err := getFreePort()
	if err != nil {
		return nil, fmt.Errorf("failed to find free geo proxy port: %w", err)
	}

	// Validate config iteratively, removing broken nodes.
	validNodes, brokenNodes, err := pm.validateProbeConfig(nodes, port, geoPort)
	if err != nil {
		return brokenNodes, fmt.Errorf("probe config validation failed: %w", err)
	}

	if len(validNodes) == 0 {
		return brokenNodes, fmt.Errorf("no valid nodes remaining after validation")
	}

	cfg, tagMap := buildProbeConfig(validNodes, port, geoPort)
	cfgJSON, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return brokenNodes, fmt.Errorf("failed to marshal config: %w", err)
	}

	tmpFile, err := os.CreateTemp("", "sbm-probe-*.json")
	if err != nil {
		return brokenNodes, fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(cfgJSON); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return brokenNodes, fmt.Errorf("failed to write config: %w", err)
	}
	tmpFile.Close()

	logger.Printf("[probe] Starting probe sing-box on port %d (geo: %d) for %d nodes (%d broken excluded)", port, geoPort, len(validNodes), len(brokenNodes))
	cmd := exec.Command(pm.singboxPath, "run", "-c", tmpPath)
	cmd.Dir = pm.dataDir

	// Pipe output to probe logger so it appears in the web panel.
	var probeLogger *logger.Logger
	if logManager := logger.GetLogManager(); logManager != nil {
		probeLogger = logManager.ProbeLogger()
	}
	if probeLogger != nil {
		cmd.Stdout = probeLogger
		cmd.Stderr = probeLogger
	}

	if err := cmd.Start(); err != nil {
		os.Remove(tmpPath)
		return brokenNodes, fmt.Errorf("failed to start probe sing-box: %w", err)
	}

	pm.cmd = cmd
	pm.port = port
	pm.geoProxyPort = geoPort
	pm.pid = cmd.Process.Pid
	pm.running = true
	pm.configPath = tmpPath
	pm.nodeTags = sortedNodeTags(validNodes)
	pm.tagMap = tagMap
	pm.startedAt = time.Now()

	logger.Printf("[probe] Probe sing-box started, PID: %d, port: %d", pm.pid, pm.port)

	// Monitor process exit in the background.
	go pm.monitor(cmd, pm.pid)

	// Wait for Clash API readiness (up to 5s).
	if err := pm.waitForReady(port); err != nil {
		pm.stopLocked()
		return brokenNodes, err
	}

	return brokenNodes, nil
}

// Stop kills the probe sing-box process.
func (pm *ProbeManager) Stop() {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.stopLocked()
}

func (pm *ProbeManager) stopLocked() {
	if !pm.running {
		return
	}

	if pm.cmd != nil && pm.cmd.Process != nil {
		_ = pm.cmd.Process.Signal(syscall.SIGTERM)
		// Give it a moment, then force kill.
		done := make(chan struct{})
		go func() {
			pm.cmd.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			pm.cmd.Process.Kill()
			pm.cmd.Wait()
		}
	}

	if pm.configPath != "" {
		os.Remove(pm.configPath)
	}

	logger.Printf("[probe] Probe sing-box stopped, PID: %d", pm.pid)

	pm.running = false
	pm.cmd = nil
	pm.port = 0
	pm.geoProxyPort = 0
	pm.pid = 0
	pm.configPath = ""
	pm.nodeTags = nil
	pm.tagMap = nil
}

// EnsureRunning makes sure the probe is running with the given set of nodes.
// If it's already running with the same nodes, it returns the existing port, tag map, and geo proxy port.
// Otherwise it restarts with the new set.
// Returns (clashAPIPort, tagMap, geoProxyPort, brokenNodes, error).
func (pm *ProbeManager) EnsureRunning(nodes []storage.Node) (int, *ProbeTagMap, int, []BrokenNode, error) {
	pm.mu.Lock()

	// Check if the current instance is alive and has the same nodes.
	if pm.running && pm.isAliveLocked() && tagsEqual(pm.nodeTags, sortedNodeTags(nodes)) {
		port := pm.port
		tagMap := pm.tagMap
		geoPort := pm.geoProxyPort
		pm.mu.Unlock()
		return port, tagMap, geoPort, nil, nil
	}

	pm.mu.Unlock()

	// Need to (re)start.
	brokenNodes, err := pm.Start(nodes)
	if err != nil {
		return 0, nil, 0, brokenNodes, err
	}

	pm.mu.Lock()
	port := pm.port
	tagMap := pm.tagMap
	geoPort := pm.geoProxyPort
	pm.mu.Unlock()
	return port, tagMap, geoPort, brokenNodes, nil
}

// Port returns the current Clash API port (0 if not running).
func (pm *ProbeManager) Port() int {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return pm.port
}

// GeoProxyPort returns the current geo proxy mixed inbound port (0 if not running).
func (pm *ProbeManager) GeoProxyPort() int {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return pm.geoProxyPort
}

// IsRunning returns whether the probe process is alive.
func (pm *ProbeManager) IsRunning() bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return pm.running && pm.isAliveLocked()
}

// Status returns the full probe status for the API.
func (pm *ProbeManager) Status() ProbeStatus {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if !pm.running || !pm.isAliveLocked() {
		return ProbeStatus{Running: false}
	}

	startedAt := pm.startedAt
	return ProbeStatus{
		Running:   true,
		Port:      pm.port,
		PID:       pm.pid,
		NodeCount: len(pm.nodeTags),
		StartedAt: &startedAt,
	}
}

// isAliveLocked checks if the probe process is still alive.
// Must be called with pm.mu held.
func (pm *ProbeManager) isAliveLocked() bool {
	if pm.pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pm.pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

// waitForReady polls the Clash API until it responds (max 5s).
// Must NOT be called with pm.mu held (it sleeps).
func (pm *ProbeManager) waitForReady(port int) error {
	client := &http.Client{Timeout: 1 * time.Second}
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
		if err == nil {
			resp.Body.Close()
			logger.Printf("[probe] Clash API ready after %dms", (i+1)*100)
			return nil
		}
	}
	return fmt.Errorf("probe sing-box did not become ready within 5s")
}

// monitor watches for the process to exit and updates state.
func (pm *ProbeManager) monitor(cmd *exec.Cmd, pid int) {
	cmd.Wait()

	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Only clear state if this is still the current process.
	if pm.cmd == cmd && pm.pid == pid {
		if pm.configPath != "" {
			os.Remove(pm.configPath)
		}
		pm.running = false
		pm.cmd = nil
		pm.port = 0
		pm.pid = 0
		pm.configPath = ""
		pm.nodeTags = nil
		logger.Printf("[probe] Probe sing-box process exited, PID: %d", pid)
	}
}

// validateProbeConfig runs `sing-box check` iteratively, removing broken nodes
// until the config validates. Returns the list of valid nodes and broken nodes.
func (pm *ProbeManager) validateProbeConfig(nodes []storage.Node, port int, geoPort int) ([]storage.Node, []BrokenNode, error) {
	excluded := make(map[int]bool) // indices of broken nodes
	var brokenNodes []BrokenNode
	// Validation removes at least one broken node per successful iteration.
	// With large subscriptions, a fixed cap (50) can stop early and abort health checks.
	// Scale the cap with node count, while keeping a sane minimum.
	maxIterations := len(nodes) + 2 // +1 for final successful pass, +1 safety margin
	if maxIterations < 50 {
		maxIterations = 50
	}

	// Regex for parsing probe outbound errors: outbound[N] or outbounds[N]
	outboundRe := regexp.MustCompile(`outbounds?\[(\d+)\]\.?([^:]*?):\s*(.+)`)
	unknownTransportRe := regexp.MustCompile(`unknown transport type:\s*(.+)`)

	for iter := 0; iter < maxIterations; iter++ {
		// Build filtered node list
		var validNodes []storage.Node
		for i, n := range nodes {
			if !excluded[i] {
				validNodes = append(validNodes, n)
			}
		}

		if len(validNodes) == 0 {
			return nil, brokenNodes, fmt.Errorf("all nodes are broken")
		}

		cfg, _ := buildProbeConfig(validNodes, port, geoPort)
		cfgJSON, err := json.MarshalIndent(cfg, "", "  ")
		if err != nil {
			return nil, brokenNodes, err
		}

		tmpFile, err := os.CreateTemp("", "sbm-probe-validate-*.json")
		if err != nil {
			return nil, brokenNodes, err
		}
		tmpPath := tmpFile.Name()
		tmpFile.Write(cfgJSON)
		tmpFile.Close()

		checkCmd := exec.Command(pm.singboxPath, "check", "-c", tmpPath)
		output, checkErr := checkCmd.CombinedOutput()
		os.Remove(tmpPath)

		if checkErr == nil {
			// Config is valid
			if len(brokenNodes) > 0 {
				tags := make([]string, len(brokenNodes))
				for i, bn := range brokenNodes {
					tags[i] = bn.Tag
				}
				logger.Printf("[probe] Excluded %d broken node(s): %s", len(brokenNodes), strings.Join(tags, ", "))
			}
			return validNodes, brokenNodes, nil
		}

		// Parse errors and find broken node indices
		outputStr := string(output)
		foundNew := false

		// Parse outbound index errors (e.g. outbounds[5].transport: unknown transport type: xhttp)
		for _, match := range outboundRe.FindAllStringSubmatch(outputStr, -1) {
			if len(match) < 4 {
				continue
			}
			idx, err := strconv.Atoi(match[1])
			if err != nil {
				continue
			}
			// Probe config has 2 system outbounds (DIRECT, REJECT) at the start
			nodeIdx := idx - 2
			if nodeIdx < 0 || nodeIdx >= len(validNodes) {
				continue
			}
			// Map back to original index
			origIdx := pm.findOriginalIndex(nodes, validNodes[nodeIdx], excluded)
			if origIdx >= 0 && !excluded[origIdx] {
				errMsg := strings.TrimSpace(match[3])
				excluded[origIdx] = true
				brokenNodes = append(brokenNodes, BrokenNode{
					Index: origIdx,
					Tag:   nodes[origIdx].DisplayOrTag(),
					Error: errMsg,
				})
				foundNew = true
				logger.Printf("[probe] Broken node detected: %s — %s", nodes[origIdx].DisplayOrTag(), errMsg)
			}
		}

		// Parse unknown transport type (general, not index-based)
		if !foundNew {
			for _, match := range unknownTransportRe.FindAllStringSubmatch(outputStr, -1) {
				if len(match) >= 2 {
					logger.Printf("[probe] Unknown transport type in config: %s", match[1])
				}
			}
		}

		// Parse duplicate tag errors (shouldn't happen with probe_ prefix, but just in case)
		dupRe := regexp.MustCompile(`duplicate outbound/endpoint tag:\s*(.+)`)
		for _, match := range dupRe.FindAllStringSubmatch(outputStr, -1) {
			if len(match) >= 2 {
				dupTag := strings.TrimSpace(match[1])
				// Find the node with this probe tag
				for vi, vn := range validNodes {
					probeTag := fmt.Sprintf("probe_%d", vi)
					if probeTag == dupTag {
						origIdx := pm.findOriginalIndex(nodes, vn, excluded)
						if origIdx >= 0 && !excluded[origIdx] {
							excluded[origIdx] = true
							brokenNodes = append(brokenNodes, BrokenNode{
								Index: origIdx,
								Tag:   nodes[origIdx].DisplayOrTag(),
								Error: fmt.Sprintf("duplicate tag: %s", dupTag),
							})
							foundNew = true
						}
						break
					}
				}
			}
		}

		if !foundNew {
			// Cannot auto-fix — return what we have with the error
			return nil, brokenNodes, fmt.Errorf("probe config check failed: %s", outputStr)
		}
	}

	return nil, brokenNodes, fmt.Errorf("probe config validation exceeded max iterations (%d)", maxIterations)
}

// findOriginalIndex finds the index of a node in the original slice, skipping excluded indices.
func (pm *ProbeManager) findOriginalIndex(original []storage.Node, node storage.Node, excluded map[int]bool) int {
	key := fmt.Sprintf("%s:%d", node.Server, node.ServerPort)
	for i, n := range original {
		if excluded[i] {
			continue
		}
		if fmt.Sprintf("%s:%d", n.Server, n.ServerPort) == key && n.RoutingTag() == node.RoutingTag() {
			return i
		}
	}
	return -1
}

// ---------- helpers ----------

// getFreePort finds and returns a free TCP port on localhost.
func getFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port, nil
}

// ProbeTagMap maps probe-unique tags back to original node tags.
// Key: probe tag used in sing-box config, Value: original node tag.
type ProbeTagMap struct {
	// ProbeToOrig maps probe tag → original tag
	ProbeToOrig map[string]string
	// OrigToProbe maps "server:port" → probe tag (for health check lookups)
	KeyToProbe map[string]string
}

// buildProbeConfig builds a minimal sing-box config for probing.
// It assigns unique tags to each node to avoid sing-box "duplicate tag" errors
// (nodes from different subscriptions often share the same advertising tag).
// Returns the config and a tag mapping for correlating results back.
func buildProbeConfig(nodes []storage.Node, clashAPIPort int, geoProxyPort int) (*builder.SingBoxConfig, *ProbeTagMap) {
	outbounds := []builder.Outbound{
		{"type": "direct", "tag": "DIRECT"},
		{"type": "block", "tag": "REJECT"},
	}

	tagMap := &ProbeTagMap{
		ProbeToOrig: make(map[string]string, len(nodes)),
		KeyToProbe:  make(map[string]string, len(nodes)),
	}

	var probeTags []string
	for i, n := range nodes {
		probeTag := fmt.Sprintf("probe_%d", i)
		ob := builder.NodeToOutbound(n)
		ob["tag"] = probeTag
		outbounds = append(outbounds, ob)
		probeTags = append(probeTags, probeTag)

		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		tagMap.ProbeToOrig[probeTag] = n.RoutingTag()
		tagMap.KeyToProbe[key] = probeTag
	}

	if len(probeTags) > 0 {
		outbounds = append(outbounds, builder.Outbound{
			"type":      "urltest",
			"tag":       "Proxy",
			"outbounds": probeTags,
			"url":       "https://www.gstatic.com/generate_204",
			"interval":  "5m",
			"tolerance": 50,
		})

		// Selector outbound for GeoIP lookups — allows switching to specific node via Clash API
		outbounds = append(outbounds, builder.Outbound{
			"type":      "selector",
			"tag":       "GeoSelector",
			"outbounds": probeTags,
		})
	}

	// Mixed inbound for GeoIP proxy (SOCKS5 + HTTP)
	var inbounds []builder.Inbound
	var route *builder.RouteConfig
	if geoProxyPort > 0 && len(probeTags) > 0 {
		inbounds = append(inbounds, builder.Inbound{
			Type:       "mixed",
			Tag:        "geo-in",
			Listen:     "127.0.0.1",
			ListenPort: geoProxyPort,
		})

		route = &builder.RouteConfig{
			Rules: []builder.RouteRule{
				{"inbound": []string{"geo-in"}, "outbound": "GeoSelector"},
			},
			Final: "DIRECT",
		}
	}

	return &builder.SingBoxConfig{
		Log:       &builder.LogConfig{Level: "warn", Timestamp: true},
		Inbounds:  inbounds,
		Outbounds: outbounds,
		Route:     route,
		Experimental: &builder.ExperimentalConfig{
			ClashAPI: &builder.ClashAPIConfig{
				ExternalController: fmt.Sprintf("127.0.0.1:%d", clashAPIPort),
				DefaultMode:        "rule",
			},
		},
	}, tagMap
}

// sortedNodeTags returns a sorted list of node tags.
func sortedNodeTags(nodes []storage.Node) []string {
	tags := make([]string, len(nodes))
	for i, n := range nodes {
		tags[i] = n.RoutingTag()
	}
	sort.Strings(tags)
	return tags
}

// tagsEqual compares two sorted tag slices.
func tagsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
