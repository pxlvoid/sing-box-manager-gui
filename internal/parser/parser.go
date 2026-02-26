package parser

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
	"github.com/xiaobei/singbox-manager/pkg/utils"
)

// Parser parser interface
type Parser interface {
	Parse(rawURL string) (*storage.Node, error)
	Protocol() string
}

// ParseURL parses a proxy URL
func ParseURL(rawURL string) (*storage.Node, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, fmt.Errorf("URL is empty")
	}

	// Get protocol type
	idx := strings.Index(rawURL, "://")
	if idx == -1 {
		return nil, fmt.Errorf("invalid URL format")
	}
	protocol := strings.ToLower(rawURL[:idx])

	var parser Parser
	switch protocol {
	case "ss":
		parser = &ShadowsocksParser{}
	case "vmess":
		parser = &VmessParser{}
	case "vless":
		parser = &VlessParser{}
	case "trojan":
		parser = &TrojanParser{}
	case "hysteria2", "hy2", "hysteria":
		parser = &Hysteria2Parser{}
	case "tuic":
		parser = &TuicParser{}
	case "socks", "socks5", "socks4", "socks4a":
		parser = &SocksParser{}
	default:
		return nil, fmt.Errorf("unsupported protocol: %s", protocol)
	}

	node, err := parser.Parse(rawURL)
	if err != nil {
		return nil, err
	}

	return node, nil
}

// ParseSubscriptionContent parses subscription content
func ParseSubscriptionContent(content string) ([]storage.Node, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("subscription content is empty")
	}

	var nodes []storage.Node

	// Try parsing as Clash YAML
	if strings.Contains(content, "proxies:") {
		yamlNodes, err := ParseClashYAML(content)
		if err == nil && len(yamlNodes) > 0 {
			return yamlNodes, nil
		}
	}

	// Try Base64 decode
	if utils.IsBase64(content) && !strings.Contains(content, "://") {
		decoded, err := utils.DecodeBase64(content)
		if err == nil {
			content = decoded
		}
	}

	// Parse line by line
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Try Base64 decode for single line
		if utils.IsBase64(line) && !strings.Contains(line, "://") {
			if decoded, err := utils.DecodeBase64(line); err == nil {
				line = decoded
			}
		}

		// If decoded content contains multiple lines, parse recursively
		if strings.Contains(line, "\n") {
			subNodes, err := ParseSubscriptionContent(line)
			if err == nil {
				nodes = append(nodes, subNodes...)
			}
			continue
		}

		// Parse single URL
		if strings.Contains(line, "://") {
			node, err := ParseURL(line)
			if err == nil && node != nil {
				nodes = append(nodes, *node)
			}
		}
	}

	return nodes, nil
}

// parseServerInfo parses server address and port
func parseServerInfo(serverInfo string) (host string, port int, err error) {
	serverInfo = strings.TrimSpace(serverInfo)

	// Handle IPv6 address [::1]:8080
	if strings.HasPrefix(serverInfo, "[") {
		idx := strings.LastIndex(serverInfo, "]:")
		if idx == -1 {
			return "", 0, fmt.Errorf("invalid server address: %s", serverInfo)
		}
		host = serverInfo[1:idx]
		portStr := serverInfo[idx+2:]
		port, err = strconv.Atoi(portStr)
		if err != nil {
			return "", 0, fmt.Errorf("invalid port: %s", portStr)
		}
		return host, port, nil
	}

	// Handle regular address host:port
	parts := strings.Split(serverInfo, ":")
	if len(parts) < 2 {
		return "", 0, fmt.Errorf("invalid server address: %s", serverInfo)
	}

	// Last part is the port
	portStr := parts[len(parts)-1]
	port, err = strconv.Atoi(portStr)
	if err != nil {
		return "", 0, fmt.Errorf("invalid port: %s", portStr)
	}

	// The rest is the hostname
	host = strings.Join(parts[:len(parts)-1], ":")

	return host, port, nil
}

// parseURLParams parses URL parameters
func parseURLParams(rawURL string) (addressPart string, params url.Values, name string, err error) {
	// Separate protocol
	idx := strings.Index(rawURL, "://")
	if idx == -1 {
		return "", nil, "", fmt.Errorf("invalid URL")
	}
	rest := rawURL[idx+3:]

	// Separate fragment (#name)
	if fragIdx := strings.Index(rest, "#"); fragIdx != -1 {
		name, _ = url.QueryUnescape(rest[fragIdx+1:])
		rest = rest[:fragIdx]
	}

	// Separate query parameters
	if queryIdx := strings.Index(rest, "?"); queryIdx != -1 {
		queryStr := rest[queryIdx+1:]
		params, _ = url.ParseQuery(queryStr)
		addressPart = rest[:queryIdx]
	} else {
		addressPart = rest
		params = url.Values{}
	}

	return addressPart, params, name, nil
}

// getParamString gets a string parameter
func getParamString(params url.Values, key string, defaultValue string) string {
	if v := params.Get(key); v != "" {
		return v
	}
	return defaultValue
}

// getParamBool gets a boolean parameter
func getParamBool(params url.Values, key string) bool {
	v := params.Get(key)
	return v == "1" || v == "true" || v == "True" || v == "TRUE"
}

// validFingerprints is the set of allowed uTLS fingerprint values
var validFingerprints = map[string]bool{
	"chrome":     true,
	"firefox":    true,
	"safari":     true,
	"ios":        true,
	"android":    true,
	"edge":       true,
	"360":        true,
	"qq":         true,
	"random":     true,
	"randomized": true,
}

// validateFingerprint checks if the fingerprint value is valid.
// Returns an error if the value is not in the allowed list.
func validateFingerprint(fp string) error {
	if fp == "" {
		return nil
	}
	if !validFingerprints[fp] {
		return fmt.Errorf("invalid uTLS fingerprint: %q", fp)
	}
	return nil
}

// getParamInt gets an integer parameter
func getParamInt(params url.Values, key string, defaultValue int) int {
	if v := params.Get(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return defaultValue
}
