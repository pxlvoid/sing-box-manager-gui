package utils

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// SubscriptionInfo represents subscription info (parsed from response headers)
type SubscriptionInfo struct {
	Upload      int64      // Upload traffic
	Download    int64      // Download traffic
	Total       int64      // Total traffic
	Expire      *time.Time // Expiration time
	ContentType string     // Content type
}

// FetchSubscription fetches subscription content
func FetchSubscription(url string) (string, *SubscriptionInfo, error) {
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set User-Agent
	req.Header.Set("User-Agent", "clash-verge/v1.0.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("HTTP status code: %d", resp.StatusCode)
	}

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Parse subscription info
	info := parseSubscriptionInfo(resp.Header)

	return string(body), info, nil
}

// parseSubscriptionInfo parses subscription info from response headers
func parseSubscriptionInfo(header http.Header) *SubscriptionInfo {
	info := &SubscriptionInfo{
		ContentType: header.Get("Content-Type"),
	}

	// Parse subscription-userinfo header
	// Format: upload=xxx; download=xxx; total=xxx; expire=xxx
	userInfo := header.Get("subscription-userinfo")
	if userInfo == "" {
		userInfo = header.Get("Subscription-Userinfo")
	}

	if userInfo != "" {
		parts := strings.Split(userInfo, ";")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			kv := strings.SplitN(part, "=", 2)
			if len(kv) != 2 {
				continue
			}
			key := strings.TrimSpace(kv[0])
			value := strings.TrimSpace(kv[1])

			switch key {
			case "upload":
				info.Upload, _ = strconv.ParseInt(value, 10, 64)
			case "download":
				info.Download, _ = strconv.ParseInt(value, 10, 64)
			case "total":
				info.Total, _ = strconv.ParseInt(value, 10, 64)
			case "expire":
				if ts, err := strconv.ParseInt(value, 10, 64); err == nil {
					t := time.Unix(ts, 0)
					info.Expire = &t
				}
			}
		}
	}

	return info
}

// FormatBytes formats byte count into human-readable string
func FormatBytes(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)

	switch {
	case bytes >= TB:
		return fmt.Sprintf("%.2f TB", float64(bytes)/TB)
	case bytes >= GB:
		return fmt.Sprintf("%.2f GB", float64(bytes)/GB)
	case bytes >= MB:
		return fmt.Sprintf("%.2f MB", float64(bytes)/MB)
	case bytes >= KB:
		return fmt.Sprintf("%.2f KB", float64(bytes)/KB)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
