package daemon

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/xiaobei/singbox-manager/internal/builder"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

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
	singboxPath string
	dataDir     string
	cmd         *exec.Cmd
	port        int
	pid         int
	mu          sync.Mutex
	running     bool
	nodeTags    []string   // sorted tags of nodes currently loaded
	startedAt   time.Time
	configPath  string     // path to the current temp config file
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
func (pm *ProbeManager) Start(nodes []storage.Node) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Stop any existing instance (unlocked variant).
	pm.stopLocked()

	if _, err := os.Stat(pm.singboxPath); os.IsNotExist(err) {
		return fmt.Errorf("sing-box binary not found: %s", pm.singboxPath)
	}

	port, err := getFreePort()
	if err != nil {
		return fmt.Errorf("failed to find free port: %w", err)
	}

	cfg := buildProbeConfig(nodes, port)
	cfgJSON, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	tmpFile, err := os.CreateTemp("", "sbm-probe-*.json")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(cfgJSON); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("failed to write config: %w", err)
	}
	tmpFile.Close()

	logger.Printf("[probe] Starting probe sing-box on port %d for %d nodes", port, len(nodes))
	cmd := exec.Command(pm.singboxPath, "run", "-c", tmpPath)
	cmd.Dir = pm.dataDir

	// Pipe output to singbox logger so it appears in the web panel.
	var singboxLogger *logger.Logger
	if logManager := logger.GetLogManager(); logManager != nil {
		singboxLogger = logManager.SingboxLogger()
	}
	if singboxLogger != nil {
		cmd.Stdout = singboxLogger
		cmd.Stderr = singboxLogger
	}

	if err := cmd.Start(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to start probe sing-box: %w", err)
	}

	pm.cmd = cmd
	pm.port = port
	pm.pid = cmd.Process.Pid
	pm.running = true
	pm.configPath = tmpPath
	pm.nodeTags = sortedNodeTags(nodes)
	pm.startedAt = time.Now()

	logger.Printf("[probe] Probe sing-box started, PID: %d, port: %d", pm.pid, pm.port)

	// Monitor process exit in the background.
	go pm.monitor(cmd, pm.pid)

	// Wait for Clash API readiness (up to 5s).
	if err := pm.waitForReady(port); err != nil {
		pm.stopLocked()
		return err
	}

	return nil
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
	pm.pid = 0
	pm.configPath = ""
	pm.nodeTags = nil
}

// EnsureRunning makes sure the probe is running with the given set of nodes.
// If it's already running with the same nodes, it returns the existing port.
// Otherwise it restarts with the new set.
func (pm *ProbeManager) EnsureRunning(nodes []storage.Node) (int, error) {
	pm.mu.Lock()

	// Check if the current instance is alive and has the same nodes.
	if pm.running && pm.isAliveLocked() && tagsEqual(pm.nodeTags, sortedNodeTags(nodes)) {
		port := pm.port
		pm.mu.Unlock()
		return port, nil
	}

	pm.mu.Unlock()

	// Need to (re)start.
	if err := pm.Start(nodes); err != nil {
		return 0, err
	}

	pm.mu.Lock()
	port := pm.port
	pm.mu.Unlock()
	return port, nil
}

// Port returns the current Clash API port (0 if not running).
func (pm *ProbeManager) Port() int {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return pm.port
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

// buildProbeConfig builds a minimal sing-box config for probing.
func buildProbeConfig(nodes []storage.Node, clashAPIPort int) *builder.SingBoxConfig {
	outbounds := []builder.Outbound{
		{"type": "direct", "tag": "DIRECT"},
		{"type": "block", "tag": "REJECT"},
	}

	var nodeTags []string
	for _, n := range nodes {
		outbounds = append(outbounds, builder.NodeToOutbound(n))
		nodeTags = append(nodeTags, n.Tag)
	}

	if len(nodeTags) > 0 {
		outbounds = append(outbounds, builder.Outbound{
			"type":      "urltest",
			"tag":       "Proxy",
			"outbounds": nodeTags,
			"url":       "https://www.gstatic.com/generate_204",
			"interval":  "5m",
			"tolerance": 50,
		})
	}

	return &builder.SingBoxConfig{
		Log:       &builder.LogConfig{Level: "warn", Timestamp: true},
		Outbounds: outbounds,
		Experimental: &builder.ExperimentalConfig{
			ClashAPI: &builder.ClashAPIConfig{
				ExternalController: fmt.Sprintf("127.0.0.1:%d", clashAPIPort),
				DefaultMode:        "rule",
			},
		},
	}
}

// sortedNodeTags returns a sorted list of node tags.
func sortedNodeTags(nodes []storage.Node) []string {
	tags := make([]string, len(nodes))
	for i, n := range nodes {
		tags[i] = n.Tag
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

