package daemon

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"text/template"
	"time"
)

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{{.Label}}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{.SbmPath}}</string>
        <string>-data</string>
        <string>{{.DataDir}}</string>
        <string>-port</string>
        <string>{{.Port}}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>{{.HomeDir}}</string>
    </dict>
    <key>RunAtLoad</key>
    <{{if .RunAtLoad}}true{{else}}false{{end}}/>
    <key>KeepAlive</key>
    <{{if .KeepAlive}}true{{else}}false{{end}}/>
    <key>StandardOutPath</key>
    <string>{{.LogPath}}/sbm.log</string>
    <key>StandardErrorPath</key>
    <string>{{.LogPath}}/sbm.error.log</string>
    <key>WorkingDirectory</key>
    <string>{{.WorkingDir}}</string>
</dict>
</plist>`

// LaunchdConfig launchd config
type LaunchdConfig struct {
	Label      string
	SbmPath    string // sbm executable path
	DataDir    string // data directory
	Port       string // web port
	LogPath    string
	WorkingDir string
	HomeDir    string // user home directory for setting HOME environment variable
	RunAtLoad  bool
	KeepAlive  bool
}

// LaunchdManager launchd manager
type LaunchdManager struct {
	label     string
	plistPath string
}

// NewLaunchdManager Create launchd manager
func NewLaunchdManager() (*LaunchdManager, error) {
	// launchd is only supported on macOS
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("launchd is only supported on macOS")
	}

	homeDir, err := getUserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user directory: %w", err)
	}

	label := "com.singbox.manager"
	plistPath := filepath.Join(homeDir, "Library", "LaunchAgents", label+".plist")

	return &LaunchdManager{
		label:     label,
		plistPath: plistPath,
	}, nil
}

// getUserHomeDir Get user home directory, supporting multiple methods
func getUserHomeDir() (string, error) {
	// First try using os.UserHomeDir()
	if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
		return homeDir, nil
	}

	// Fallback: use os/user package (does not depend on $HOME environment variable)
	if u, err := user.Current(); err == nil && u.HomeDir != "" {
		return u.HomeDir, nil
	}

	return "", fmt.Errorf("unable to get user home directory")
}

// Install Install launchd service
func (lm *LaunchdManager) Install(config LaunchdConfig) error {
	// Set default value
	if config.Label == "" {
		config.Label = lm.label
	}

	// Ensure log directory exists
	if err := os.MkdirAll(config.LogPath, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	// Ensure LaunchAgents directory exists
	launchAgentsDir := filepath.Dir(lm.plistPath)
	if err := os.MkdirAll(launchAgentsDir, 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents directory: %w", err)
	}

	// Generate plist file
	tmpl, err := template.New("plist").Parse(plistTemplate)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, config); err != nil {
		return fmt.Errorf("failed to generate plist: %w", err)
	}

	// Write file
	if err := os.WriteFile(lm.plistPath, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to write plist: %w", err)
	}

	// Load service
	cmd := exec.Command("launchctl", "load", lm.plistPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to load service: %s", string(output))
	}

	return nil
}

// Uninstall Uninstall launchd service
func (lm *LaunchdManager) Uninstall() error {
	// Stop service first
	lm.Stop()

	// Unload service
	cmd := exec.Command("launchctl", "unload", lm.plistPath)
	cmd.Run() // Ignore errors, service may not be loaded

	// Delete plist file
	if err := os.Remove(lm.plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete plist: %w", err)
	}

	return nil
}

// Start Start service
func (lm *LaunchdManager) Start() error {
	cmd := exec.Command("launchctl", "start", lm.label)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to start service: %s", string(output))
	}
	return nil
}

// Stop Stop service
func (lm *LaunchdManager) Stop() error {
	cmd := exec.Command("launchctl", "stop", lm.label)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to stop service: %s", string(output))
	}
	return nil
}

// Restart Restart service
func (lm *LaunchdManager) Restart() error {
	// Stop service first (ignore errors, service may not be running)
	lm.Stop()

	// Wait briefly for service to fully stop
	time.Sleep(500 * time.Millisecond)

	// Try to start service (ignore command errors, KeepAlive may have already restarted)
	exec.Command("launchctl", "start", lm.label).Run()

	// Use retry mechanism to check if service started successfully
	// sbm is a web service and may need more time to start
	maxRetries := 20
	retryInterval := 500 * time.Millisecond

	for i := 0; i < maxRetries; i++ {
		time.Sleep(retryInterval)
		if lm.IsRunning() {
			return nil // Service started successfully
		}
	}

	return fmt.Errorf("service restart failed: service failed to start within %v", time.Duration(maxRetries)*retryInterval)
}

// IsInstalled Check if installed
func (lm *LaunchdManager) IsInstalled() bool {
	_, err := os.Stat(lm.plistPath)
	return err == nil
}

// IsRunning Check if running
func (lm *LaunchdManager) IsRunning() bool {
	cmd := exec.Command("launchctl", "list", lm.label)
	err := cmd.Run()
	return err == nil
}

// GetPlistPath Get plist file path
func (lm *LaunchdManager) GetPlistPath() string {
	return lm.plistPath
}

// GetLabel Get service label
func (lm *LaunchdManager) GetLabel() string {
	return lm.label
}
