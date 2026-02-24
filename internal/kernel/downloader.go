package kernel

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// downloadAndInstall downloads and installs kernel
func (m *Manager) downloadAndInstall(version string) {
	defer func() {
		if r := recover(); r != nil {
			m.setDownloadComplete("error", fmt.Sprintf("Error occurred during download: %v", r))
		}
	}()

	// 1. Fetch releases
	m.updateProgress("preparing", 0, "Getting version information...", 0, 0)
	releases, err := m.FetchReleases()
	if err != nil {
		m.setDownloadComplete("error", fmt.Sprintf("Failed to get version information: %v", err))
		return
	}

	// 2. Get resource info for corresponding platform
	asset, err := m.getAssetInfo(releases, version)
	if err != nil {
		m.setDownloadComplete("error", err.Error())
		return
	}

	// 3. Create temporary directory
	tmpDir, err := os.MkdirTemp("", "singbox-download")
	if err != nil {
		m.setDownloadComplete("error", fmt.Sprintf("Failed to create temporary directory: %v", err))
		return
	}
	defer os.RemoveAll(tmpDir)

	// 4. Download file
	downloadURL := m.buildDownloadURL(asset.BrowserDownloadURL)
	tmpFile := filepath.Join(tmpDir, asset.Name)

	m.updateProgress("downloading", 0, "Downloading...", 0, asset.Size)
	if err := m.downloadFile(downloadURL, tmpFile, asset.Size); err != nil {
		m.setDownloadComplete("error", fmt.Sprintf("Download failed: %v", err))
		return
	}

	// 5. Extract file
	m.updateProgress("extracting", 80, "Extracting...", asset.Size, asset.Size)
	binaryPath, err := m.extractArchive(tmpFile, tmpDir)
	if err != nil {
		m.setDownloadComplete("error", fmt.Sprintf("Extraction failed: %v", err))
		return
	}

	// 6. Install to target path
	m.updateProgress("installing", 90, "Installing...", asset.Size, asset.Size)
	if err := m.installBinary(binaryPath); err != nil {
		m.setDownloadComplete("error", fmt.Sprintf("Installation failed: %v", err))
		return
	}

	// 7. Completed
	m.setDownloadComplete("completed", fmt.Sprintf("sing-box %s installed successfully", version))
}

// downloadFile downloads a file
func (m *Manager) downloadFile(url, dest string, totalSize int64) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Download failed, HTTP status code: %d", resp.StatusCode)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	var downloaded int64
	buffer := make([]byte, 32*1024)

	for {
		n, err := resp.Body.Read(buffer)
		if n > 0 {
			_, writeErr := out.Write(buffer[:n])
			if writeErr != nil {
				return writeErr
			}
			downloaded += int64(n)

			// Update progress
			progress := float64(downloaded) / float64(totalSize) * 80 // Download phase occupies 80%
			m.updateProgress("downloading", progress, fmt.Sprintf("Downloading %.1f%%", progress/0.8), downloaded, totalSize)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}

	return nil
}

// extractArchive extracts archive
func (m *Manager) extractArchive(archivePath, destDir string) (string, error) {
	if strings.HasSuffix(archivePath, ".tar.gz") || strings.HasSuffix(archivePath, ".tgz") {
		return m.extractTarGz(archivePath, destDir)
	} else if strings.HasSuffix(archivePath, ".zip") {
		return m.extractZip(archivePath, destDir)
	}
	return "", fmt.Errorf("Unsupported archive format: %s", archivePath)
}

// extractTarGz extracts tar.gz
func (m *Manager) extractTarGz(archivePath, destDir string) (string, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	gzr, err := gzip.NewReader(file)
	if err != nil {
		return "", err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	var binaryPath string
	binaryName := "sing-box"
	if runtime.GOOS == "windows" {
		binaryName = "sing-box.exe"
	}

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}

		// Only extract sing-box binary file
		if header.Typeflag == tar.TypeReg && strings.HasSuffix(header.Name, binaryName) {
			binaryPath = filepath.Join(destDir, binaryName)
			outFile, err := os.Create(binaryPath)
			if err != nil {
				return "", err
			}

			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return "", err
			}
			outFile.Close()
			break
		}
	}

	if binaryPath == "" {
		return "", fmt.Errorf("Not found in archive: %s", binaryName)
	}

	return binaryPath, nil
}

// extractZip extracts zip
func (m *Manager) extractZip(archivePath, destDir string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	var binaryPath string
	binaryName := "sing-box"
	if runtime.GOOS == "windows" {
		binaryName = "sing-box.exe"
	}

	for _, f := range r.File {
		if strings.HasSuffix(f.Name, binaryName) {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}

			binaryPath = filepath.Join(destDir, binaryName)
			outFile, err := os.Create(binaryPath)
			if err != nil {
				rc.Close()
				return "", err
			}

			if _, err := io.Copy(outFile, rc); err != nil {
				outFile.Close()
				rc.Close()
				return "", err
			}

			outFile.Close()
			rc.Close()
			break
		}
	}

	if binaryPath == "" {
		return "", fmt.Errorf("Not found in archive: %s", binaryName)
	}

	return binaryPath, nil
}

// installBinary installs binary file
func (m *Manager) installBinary(srcPath string) error {
	destPath := m.binPath

	// Ensure target directory exists
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("Failed to create directory: %w", err)
	}

	// If target file exists, delete first
	if _, err := os.Stat(destPath); err == nil {
		if err := os.Remove(destPath); err != nil {
			return fmt.Errorf("Failed to delete old version: %w", err)
		}
	}

	// Copy file
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dest, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dest.Close()

	if _, err := io.Copy(dest, src); err != nil {
		return err
	}

	// Set executable permission
	if err := os.Chmod(destPath, 0755); err != nil {
		return fmt.Errorf("Failed to set permission: %w", err)
	}

	return nil
}
