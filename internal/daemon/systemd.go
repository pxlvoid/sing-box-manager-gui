package daemon

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"text/template"
	"time"
)

const systemdTemplate = `[Unit]
Description=SingBox Manager
After=network.target

[Service]
Type=simple
ExecStart={{.SbmPath}} -data {{.DataDir}} -port {{.Port}}
WorkingDirectory={{.WorkingDir}}
Restart={{if .KeepAlive}}always{{else}}no{{end}}
RestartSec=5
StandardOutput=append:{{.LogPath}}/sbm.log
StandardError=append:{{.LogPath}}/sbm.error.log
Environment="HOME={{.HomeDir}}"

[Install]
WantedBy={{if .RunAtLoad}}default.target{{else}}multi-user.target{{end}}
`

// SystemdConfig systemd config
type SystemdConfig struct {
	SbmPath    string
	DataDir    string
	Port       string
	LogPath    string
	WorkingDir string
	HomeDir    string
	RunAtLoad  bool
	KeepAlive  bool
}

// SystemdManager systemd manager
type SystemdManager struct {
	serviceName string
	servicePath string
	userMode    bool
}

// NewSystemdManager Create systemd manager
func NewSystemdManager() (*SystemdManager, error) {
	if runtime.GOOS != "linux" {
		return nil, fmt.Errorf("systemd is only supported on Linux")
	}

	serviceName := "singbox-manager.service"
	homeDir, err := getUserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user directory: %w", err)
	}

	// User-level service path
	servicePath := filepath.Join(homeDir, ".config", "systemd", "user", serviceName)

	return &SystemdManager{
		serviceName: serviceName,
		servicePath: servicePath,
		userMode:    true,
	}, nil
}

// Install Install systemd service
func (sm *SystemdManager) Install(config SystemdConfig) error {
	if err := os.MkdirAll(config.LogPath, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(sm.servicePath), 0755); err != nil {
		return fmt.Errorf("failed to create systemd directory: %w", err)
	}

	tmpl, err := template.New("systemd").Parse(systemdTemplate)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, config); err != nil {
		return fmt.Errorf("failed to generate service file: %w", err)
	}

	if err := os.WriteFile(sm.servicePath, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to write service file: %w", err)
	}

	// Reload systemd configuration
	if err := sm.runSystemctl("daemon-reload"); err != nil {
		return fmt.Errorf("failed to reload configuration: %w", err)
	}

	// Enable service (auto-start on boot)
	if config.RunAtLoad {
		if err := sm.runSystemctl("enable", sm.serviceName); err != nil {
			return fmt.Errorf("failed to enable service: %w", err)
		}
	}

	return nil
}

// Uninstall Uninstall systemd service
func (sm *SystemdManager) Uninstall() error {
	sm.Stop()
	sm.runSystemctl("disable", sm.serviceName)

	if err := os.Remove(sm.servicePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete service file: %w", err)
	}

	sm.runSystemctl("daemon-reload")
	return nil
}

// Start Start service
func (sm *SystemdManager) Start() error {
	return sm.runSystemctl("start", sm.serviceName)
}

// Stop Stop service
func (sm *SystemdManager) Stop() error {
	return sm.runSystemctl("stop", sm.serviceName)
}

// Restart Restart service
func (sm *SystemdManager) Restart() error {
	sm.Stop()
	time.Sleep(500 * time.Millisecond)
	sm.runSystemctl("start", sm.serviceName)

	maxRetries := 20
	for i := 0; i < maxRetries; i++ {
		time.Sleep(500 * time.Millisecond)
		if sm.IsRunning() {
			return nil
		}
	}
	return fmt.Errorf("service restart failed: service failed to start within %v", time.Duration(maxRetries)*500*time.Millisecond)
}

// IsInstalled Check if installed
func (sm *SystemdManager) IsInstalled() bool {
	_, err := os.Stat(sm.servicePath)
	return err == nil
}

// IsRunning Check if running
func (sm *SystemdManager) IsRunning() bool {
	err := sm.runSystemctl("is-active", "--quiet", sm.serviceName)
	return err == nil
}

// GetServicePath Get service file path
func (sm *SystemdManager) GetServicePath() string {
	return sm.servicePath
}

func (sm *SystemdManager) runSystemctl(args ...string) error {
	if sm.userMode {
		args = append([]string{"--user"}, args...)
	}
	cmd := exec.Command("systemctl", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err, string(output))
	}
	return nil
}
