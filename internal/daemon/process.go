package daemon

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/process"
	"github.com/xiaobei/singbox-manager/internal/logger"
)

// ProcessManager Process manager
type ProcessManager struct {
	singboxPath string
	configPath  string
	dataDir     string // Data directory for setting sing-box working directory
	pidFile     string // PID file path for persisting process state
	cmd         *exec.Cmd
	mu          sync.RWMutex
	running     bool
	pid         int // Save PID (supports process recovery even if cmd is nil)
	logs        []string
	maxLogs     int
}

// NewProcessManager Create process manager
func NewProcessManager(singboxPath, configPath, dataDir string) *ProcessManager {
	pm := &ProcessManager{
		singboxPath: singboxPath,
		configPath:  configPath,
		dataDir:     dataDir,
		pidFile:     filepath.Join(dataDir, "singbox.pid"),
		maxLogs:     1000,
		logs:        make([]string, 0),
	}

	// Try to recover existing sing-box process on startup
	pm.recoverProcess()

	return pm
}

// recoverProcess Try to recover existing sing-box process (dual detection)
func (pm *ProcessManager) recoverProcess() {
	var pid int

	// Step 1: Try to recover from PID file
	pid = pm.recoverFromPidFile()

	// Step 2: If PID file is invalid, scan system processes
	if pid <= 0 {
		pid = pm.findSingboxProcess()
	}

	if pid <= 0 {
		return // sing-box process not found
	}

	// Recover state
	pm.mu.Lock()
	pm.running = true
	pm.pid = pid
	pm.mu.Unlock()

	// Update PID file (ensure consistency)
	os.WriteFile(pm.pidFile, []byte(strconv.Itoa(pid)), 0644)

	logger.Printf("Recovered sing-box process tracking, PID: %d", pid)

	// Start async monitoring for process exit
	go pm.monitorProcess(pid)
}

// recoverFromPidFile Recover from PID file (using kill -0 for quick verification)
func (pm *ProcessManager) recoverFromPidFile() int {
	pid := pm.readPidFile()
	if pid <= 0 {
		return 0
	}

	// Use kill -0 to quickly verify if process is alive
	if !pm.isProcessAlive(pid) {
		os.Remove(pm.pidFile)
		return 0
	}

	logger.Printf("Recovered sing-box process from PID file, PID: %d", pid)
	return pid
}

// findSingboxProcess Use pgrep to quickly find sing-box process (used on startup)
func (pm *ProcessManager) findSingboxProcess() int {
	pid := pm.findSingboxByPgrep()
	if pid > 0 {
		logger.Printf("Found sing-box process via pgrep, PID: %d", pid)
	}
	return pid
}

// isSingboxProcess Check if process is sing-box
func (pm *ProcessManager) isSingboxProcess(proc *process.Process) bool {
	// Method 1: Check process name
	name, _ := proc.Name()
	if name == "sing-box" {
		return true
	}

	// Method 2: Check executable path (process name may be truncated on macOS)
	exe, _ := proc.Exe()
	if strings.HasSuffix(exe, "/sing-box") || strings.HasSuffix(exe, "\\sing-box") {
		return true
	}

	return false
}

// isValidSingboxProcess Verify if PID is a valid sing-box process
func (pm *ProcessManager) isValidSingboxProcess(pid int) bool {
	proc, err := process.NewProcess(int32(pid))
	if err != nil {
		return false
	}

	return pm.isSingboxProcess(proc)
}

// isProcessAlive Check if process is alive using kill -0 (more reliable)
func (pm *ProcessManager) isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// kill -0 does not send signal, only checks if process exists
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

// readPidFile Only read PID file without verifying process type (lightweight)
func (pm *ProcessManager) readPidFile() int {
	data, err := os.ReadFile(pm.pidFile)
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0
	}
	return pid
}

// findSingboxByPgrep Use pgrep to quickly find sing-box process
func (pm *ProcessManager) findSingboxByPgrep() int {
	// pgrep -x exact match process name
	cmd := exec.Command("pgrep", "-x", "sing-box")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	// pgrep may return multiple lines (multiple processes), take the first one
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) == 0 || lines[0] == "" {
		return 0
	}

	pid, err := strconv.Atoi(lines[0])
	if err != nil {
		return 0
	}
	return pid
}

// recoverState Recover running state
func (pm *ProcessManager) recoverState(pid int) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if !pm.running {
		pm.running = true
		pm.pid = pid
		// Update PID file
		os.WriteFile(pm.pidFile, []byte(strconv.Itoa(pid)), 0644)
		logger.Printf("Detected sing-box process still running, recovered state, PID: %d", pid)

		// Restart monitoring
		go pm.monitorProcess(pid)
	}
}

// monitorProcess Monitor recovered process (used when there is no cmd object)
func (pm *ProcessManager) monitorProcess(pid int) {
	failCount := 0
	maxFails := 3 // Consider exit after 3 consecutive failures

	for {
		time.Sleep(2 * time.Second)

		// Prioritize using kill -0 for checking (more reliable)
		if pm.isProcessAlive(pid) {
			failCount = 0
			continue
		}

		// If kill -0 fails, check with gopsutil again
		if pm.isValidSingboxProcess(pid) {
			failCount = 0
			continue
		}

		// Both methods failed, count it
		failCount++
		if failCount < maxFails {
			logger.Printf("sing-box process detection failed (%d/%d), PID: %d", failCount, maxFails, pid)
			continue
		}

		// Consecutive failures reached threshold, consider process exited
		pm.mu.Lock()
		pm.running = false
		pm.pid = 0
		pm.mu.Unlock()
		os.Remove(pm.pidFile)
		logger.Printf("sing-box process exited, PID: %d", pid)
		return
	}
}

// Start Start sing-box
func (pm *ProcessManager) Start() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if pm.running {
		return fmt.Errorf("sing-box is already running")
	}

	// Check if sing-box exists
	if _, err := os.Stat(pm.singboxPath); os.IsNotExist(err) {
		return fmt.Errorf("sing-box does not exist: %s", pm.singboxPath)
	}

	// Check if config file exists
	if _, err := os.Stat(pm.configPath); os.IsNotExist(err) {
		return fmt.Errorf("config file does not exist: %s", pm.configPath)
	}

	pm.cmd = exec.Command(pm.singboxPath, "run", "-c", pm.configPath)
	pm.cmd.Dir = pm.dataDir // Set working directory to ensure relative paths (like external_ui) are resolved correctly

	// Capture output
	stdout, err := pm.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get standard output: %w", err)
	}

	stderr, err := pm.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to get standard error: %w", err)
	}

	if err := pm.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start sing-box: %w", err)
	}

	pm.running = true
	pm.pid = pm.cmd.Process.Pid

	// Write PID file
	if err := os.WriteFile(pm.pidFile, []byte(strconv.Itoa(pm.pid)), 0644); err != nil {
		logger.Printf("failed to write PID file: %v", err)
	}

	logger.Printf("sing-box started, PID: %d", pm.pid)

	// Get sing-box logger
	var singboxLogger *logger.Logger
	if logManager := logger.GetLogManager(); logManager != nil {
		singboxLogger = logManager.SingboxLogger()
	}

	// Async read logs
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			pm.addLog(line)
			// Also write to log file
			if singboxLogger != nil {
				singboxLogger.WriteRaw(line)
			}
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			pm.addLog(line)
			// Also write to log file
			if singboxLogger != nil {
				singboxLogger.WriteRaw(line)
			}
		}
	}()

	// Monitor process exit
	go func() {
		pm.cmd.Wait()
		pm.mu.Lock()
		pm.running = false
		pm.pid = 0
		pm.mu.Unlock()
		os.Remove(pm.pidFile)
		logger.Printf("sing-box process exited")
	}()

	return nil
}

// Stop Stop sing-box
func (pm *ProcessManager) Stop() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if !pm.running {
		return nil
	}

	var pid int

	// Case 1: Has cmd object (normally started process)
	if pm.cmd != nil && pm.cmd.Process != nil {
		pid = pm.cmd.Process.Pid
		// Send SIGTERM signal
		if err := pm.cmd.Process.Signal(syscall.SIGTERM); err != nil {
			// If SIGTERM fails, try SIGKILL
			if err := pm.cmd.Process.Kill(); err != nil {
				return fmt.Errorf("failed to stop sing-box: %w", err)
			}
		}
	} else if pm.pid > 0 {
		// Case 2: No cmd object (recovered process), send signal via PID
		pid = pm.pid
		proc, err := os.FindProcess(pid)
		if err == nil {
			if err := proc.Signal(syscall.SIGTERM); err != nil {
				proc.Kill()
			}
		}
	}

	pm.running = false
	pm.pid = 0
	os.Remove(pm.pidFile)
	logger.Printf("sing-box stopped, PID: %d", pid)
	return nil
}

// Restart restarts sing-box
func (pm *ProcessManager) Restart() error {
	if err := pm.Stop(); err != nil {
		return err
	}
	return pm.Start()
}

// Reload Hot reload config
func (pm *ProcessManager) Reload() error {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if !pm.running || pm.cmd == nil || pm.cmd.Process == nil {
		return fmt.Errorf("sing-box is not running")
	}

	// sing-box supports SIGHUP hot reload
	if err := pm.cmd.Process.Signal(syscall.SIGHUP); err != nil {
		return fmt.Errorf("failed to reload config: %w", err)
	}

	return nil
}

// IsRunning Check if running (with real-time detection and auto-recovery)
func (pm *ProcessManager) IsRunning() bool {
	pm.mu.RLock()
	running := pm.running
	pid := pm.pid
	cmd := pm.cmd
	pm.mu.RUnlock()

	// 1. If memory state is running, return true directly
	if running {
		return true
	}

	// 2. Memory state is not running, but try to detect if process is actually alive

	// 2.1 Check saved PID
	if pid > 0 && pm.isProcessAlive(pid) {
		pm.recoverState(pid)
		return true
	}

	// 2.2 Check cmd object PID
	if cmd != nil && cmd.Process != nil {
		cmdPid := cmd.Process.Pid
		if pm.isProcessAlive(cmdPid) {
			pm.recoverState(cmdPid)
			return true
		}
	}

	// 2.3 Fallback: recover from PID file (read file + kill -0, very fast)
	if filePid := pm.readPidFile(); filePid > 0 && pm.isProcessAlive(filePid) {
		pm.recoverState(filePid)
		return true
	}

	// 2.4 Fallback: use pgrep for quick search (replace gopsutil full scan)
	if pgrepPid := pm.findSingboxByPgrep(); pgrepPid > 0 {
		pm.recoverState(pgrepPid)
		return true
	}

	return false
}

// GetPID Get process ID
func (pm *ProcessManager) GetPID() int {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	// Prioritize returning saved PID (supports recovered processes)
	if pm.pid > 0 {
		return pm.pid
	}

	// Fallback: get from cmd
	if pm.cmd != nil && pm.cmd.Process != nil {
		return pm.cmd.Process.Pid
	}
	return 0
}

// GetLogs Get logs
func (pm *ProcessManager) GetLogs() []string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	logs := make([]string, len(pm.logs))
	copy(logs, pm.logs)
	return logs
}

// ClearLogs Clear logs
func (pm *ProcessManager) ClearLogs() {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.logs = make([]string, 0)
}

// addLog Add log
func (pm *ProcessManager) addLog(line string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	pm.logs = append(pm.logs, line)

	// Limit log quantity
	if len(pm.logs) > pm.maxLogs {
		pm.logs = pm.logs[len(pm.logs)-pm.maxLogs:]
	}
}

// GetSingBoxPath returns the path to the sing-box binary.
func (pm *ProcessManager) GetSingBoxPath() string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.singboxPath
}

// SetPaths Set paths
func (pm *ProcessManager) SetPaths(singboxPath, configPath string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.singboxPath = singboxPath
	pm.configPath = configPath
}

// SetConfigPath Only set config file path
func (pm *ProcessManager) SetConfigPath(configPath string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.configPath = configPath
}

// Check Check config file
func (pm *ProcessManager) Check() error {
	cmd := exec.Command(pm.singboxPath, "check", "-c", pm.configPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("config check failed: %s", string(output))
	}
	return nil
}

// Version Get sing-box version
func (pm *ProcessManager) Version() (string, error) {
	cmd := exec.Command(pm.singboxPath, "version")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get version: %w", err)
	}
	return string(output), nil
}
