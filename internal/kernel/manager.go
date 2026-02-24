package kernel

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// KernelInfo represents kernel information
type KernelInfo struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version"`
	Path      string `json:"path"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
}

// DownloadProgress represents download progress
type DownloadProgress struct {
	Status     string  `json:"status"`     // idle, downloading, extracting, installing, completed, error
	Progress   float64 `json:"progress"`   // 0-100
	Message    string  `json:"message"`    // Status description
	Downloaded int64   `json:"downloaded"` // Downloaded bytes
	Total      int64   `json:"total"`      // Total bytes
}

// GithubRelease represents GitHub release information
type GithubRelease struct {
	TagName    string        `json:"tag_name"`
	Name       string        `json:"name"`
	Prerelease bool          `json:"prerelease"`
	Assets     []GithubAsset `json:"assets"`
}

// GithubAsset represents a GitHub release asset
type GithubAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// Manager handles kernel management
type Manager struct {
	dataDir     string
	binPath     string                       // absolute path to the sing-box binary
	getSettings func() *storage.Settings
	mu          sync.RWMutex
	progress    *DownloadProgress
	downloading bool
}

// NewManager creates a kernel manager
func NewManager(dataDir string, getSettings func() *storage.Settings) *Manager {
	// Calculate absolute path for sing-box binary
	// dataDir is typically ~/.singbox-manager, we place sing-box at dataDir/bin/sing-box
	binPath := filepath.Join(dataDir, "bin", "sing-box")

	return &Manager{
		dataDir:     dataDir,
		binPath:     binPath,
		getSettings: getSettings,
		progress: &DownloadProgress{
			Status:  "idle",
			Message: "",
		},
	}
}

// GetInfo returns kernel information
func (m *Manager) GetInfo() *KernelInfo {
	info := &KernelInfo{
		Path: m.binPath,
		OS:   runtime.GOOS,
		Arch: m.normalizeArch(runtime.GOARCH),
	}

	// Check if file exists
	if _, err := os.Stat(m.binPath); os.IsNotExist(err) {
		info.Installed = false
		return info
	}

	info.Installed = true

	// Get version
	version, err := m.getVersion(m.binPath)
	if err == nil {
		info.Version = version
	}

	return info
}

// GetBinPath returns the sing-box binary path
func (m *Manager) GetBinPath() string {
	return m.binPath
}

// getVersion gets the sing-box version
func (m *Manager) getVersion(singboxPath string) (string, error) {
	cmd := exec.Command(singboxPath, "version")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	// Parse version number, output format is typically: sing-box version 1.x.x
	lines := strings.Split(string(output), "\n")
	if len(lines) > 0 {
		parts := strings.Fields(lines[0])
		for i, part := range parts {
			if part == "version" && i+1 < len(parts) {
				return parts[i+1], nil
			}
		}
		// If "version" keyword not found, try returning the first line
		return strings.TrimSpace(lines[0]), nil
	}

	return "", fmt.Errorf("unable to parse version number")
}

// FetchReleases fetches GitHub releases list
func (m *Manager) FetchReleases() ([]GithubRelease, error) {
	settings := m.getSettings()
	apiURL := "https://api.github.com/repos/SagerNet/sing-box/releases"

	// If proxy is configured, API also uses proxy
	if settings.GithubProxy != "" {
		apiURL = settings.GithubProxy + apiURL
	}

	resp, err := http.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 403 {
		return nil, fmt.Errorf("GitHub API rate limited, please try again later or configure a proxy")
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned error: %d", resp.StatusCode)
	}

	var releases []GithubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("failed to parse releases: %w", err)
	}

	// Filter stable versions (exclude alpha, beta, rc)
	stablePattern := regexp.MustCompile(`^v\d+\.\d+\.\d+$`)
	stableReleases := make([]GithubRelease, 0)
	for _, release := range releases {
		if !release.Prerelease && stablePattern.MatchString(release.TagName) {
			stableReleases = append(stableReleases, release)
		}
	}

	return stableReleases, nil
}

// GetLatestVersion gets the latest stable version
func (m *Manager) GetLatestVersion() (string, error) {
	releases, err := m.FetchReleases()
	if err != nil {
		return "", err
	}

	if len(releases) == 0 {
		return "", fmt.Errorf("no stable version found")
	}

	return releases[0].TagName, nil
}

// StartDownload starts downloading a specific version
func (m *Manager) StartDownload(version string) error {
	m.mu.Lock()
	if m.downloading {
		m.mu.Unlock()
		return fmt.Errorf("a download is already in progress")
	}
	m.downloading = true
	m.progress = &DownloadProgress{
		Status:  "preparing",
		Message: "Preparing download...",
	}
	m.mu.Unlock()

	// Execute download asynchronously
	go m.downloadAndInstall(version)

	return nil
}

// GetProgress returns download progress
func (m *Manager) GetProgress() *DownloadProgress {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.progress
}

// IsDownloading checks if a download is in progress
func (m *Manager) IsDownloading() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.downloading
}

// updateProgress updates progress
func (m *Manager) updateProgress(status string, progress float64, message string, downloaded, total int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.progress = &DownloadProgress{
		Status:     status,
		Progress:   progress,
		Message:    message,
		Downloaded: downloaded,
		Total:      total,
	}
}

// setDownloadComplete marks download as complete
func (m *Manager) setDownloadComplete(status string, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.downloading = false
	m.progress = &DownloadProgress{
		Status:   status,
		Progress: 100,
		Message:  message,
	}
}

// getAssetInfo gets asset info for the current platform
func (m *Manager) getAssetInfo(releases []GithubRelease, version string) (*GithubAsset, error) {
	// Find matching version
	var targetRelease *GithubRelease
	for i := range releases {
		if releases[i].TagName == version {
			targetRelease = &releases[i]
			break
		}
	}

	if targetRelease == nil {
		return nil, fmt.Errorf("version %s not found", version)
	}

	// Build asset filename
	assetName := m.buildAssetName(version)
	if assetName == "" {
		return nil, fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	// Find matching asset
	for i := range targetRelease.Assets {
		if targetRelease.Assets[i].Name == assetName {
			return &targetRelease.Assets[i], nil
		}
	}

	return nil, fmt.Errorf("no compatible version found for %s/%s", runtime.GOOS, runtime.GOARCH)
}

// buildAssetName builds the asset filename
func (m *Manager) buildAssetName(version string) string {
	os := runtime.GOOS
	arch := m.normalizeArch(runtime.GOARCH)
	ver := strings.TrimPrefix(version, "v")

	switch os {
	case "darwin":
		return fmt.Sprintf("sing-box-%s-darwin-%s.tar.gz", ver, arch)
	case "linux":
		return fmt.Sprintf("sing-box-%s-linux-%s.tar.gz", ver, arch)
	case "windows":
		return fmt.Sprintf("sing-box-%s-windows-%s.zip", ver, arch)
	default:
		return ""
	}
}

// normalizeArch normalizes architecture names
func (m *Manager) normalizeArch(arch string) string {
	switch arch {
	case "amd64":
		return "amd64"
	case "arm64":
		return "arm64"
	case "386":
		return "386"
	default:
		return arch
	}
}

// buildDownloadURL builds download URL (with proxy support)
func (m *Manager) buildDownloadURL(originalURL string) string {
	settings := m.getSettings()
	if settings.GithubProxy != "" {
		return settings.GithubProxy + originalURL
	}
	return originalURL
}
