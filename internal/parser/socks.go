package parser

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"
	"unicode"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// SocksParser SOCKS Parser
type SocksParser struct{}

// Protocol Return protocol name
func (p *SocksParser) Protocol() string {
	return "socks"
}

// Parse Parse SOCKS URL
// Format1: socks://username:password@server:port#name
// Format2: socks://base64(username:password)@server:port#name
// Format3: socks://server:port#name (no authentication)
// Also supports socks5:// and socks4:// prefixes
func (p *SocksParser) Parse(rawURL string) (*storage.Node, error) {
	addressPart, params, name, err := parseURLParams(rawURL)
	if err != nil {
		return nil, err
	}

	var username, password, serverPart string
	version := "5" // Default SOCKS5

	// Detect version (from protocol name)
	idx := strings.Index(rawURL, "://")
	if idx != -1 {
		protocol := strings.ToLower(rawURL[:idx])
		if protocol == "socks4" || protocol == "socks4a" {
			version = "4"
		}
	}

	// Separate authentication info and server
	atIdx := strings.LastIndex(addressPart, "@")
	if atIdx != -1 {
		// Has authentication
		authPart := addressPart[:atIdx]
		serverPart = addressPart[atIdx+1:]

		// Try to parse username:password format
		if colonIdx := strings.Index(authPart, ":"); colonIdx != -1 {
			// Direct format: username:password
			username, _ = url.QueryUnescape(authPart[:colonIdx])
			password, _ = url.QueryUnescape(authPart[colonIdx+1:])
		} else {
			// No colon, may be Base64 encoded username:password or just username
			// Try Base64 decoding
			decoded := tryBase64Decode(authPart)

			if decoded != "" && strings.Contains(decoded, ":") {
				// Decoded successfully and contains colon, indicating Base64 encoded username:password
				colonIdx := strings.Index(decoded, ":")
				username = decoded[:colonIdx]
				password = decoded[colonIdx+1:]
			} else {
				// Decoding failed or does not contain colon, treat as normal username
				username, _ = url.QueryUnescape(authPart)
			}
		}
	} else {
		// No authentication
		serverPart = addressPart
	}

	// Parse server address
	server, port, err := parseServerInfo(serverPart)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse server address: %w", err)
	}

	// Set default name
	if name == "" {
		name = fmt.Sprintf("%s:%d", server, port)
	}

	// Build Extra
	extra := map[string]interface{}{
		"version": version,
	}

	// Add authentication info
	if username != "" {
		extra["username"] = username
	}
	if password != "" {
		extra["password"] = password
	}

	// Handle possible extra configuration from URL parameters
	if v := params.Get("version"); v != "" {
		extra["version"] = v
	}
	if u := params.Get("username"); u != "" {
		extra["username"] = u
	}
	if pw := params.Get("password"); pw != "" {
		extra["password"] = pw
	}

	// UoT (UDP over TCP) configuration
	if getParamBool(params, "udp-over-tcp") || getParamBool(params, "uot") {
		extra["udp_over_tcp"] = map[string]interface{}{
			"enabled": true,
		}
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "socks",
		Server:     server,
		ServerPort: port,
		Extra:      extra,
	}

	return node, nil
}

// isValidUsername Check if string is valid username (contains only printable characters)
func isValidUsername(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsPrint(r) {
			return false
		}
	}
	return true
}

// tryBase64Decode Try multiple Base64 decoding methods
func tryBase64Decode(s string) string {
	// Try standard Base64
	if decoded, err := base64.StdEncoding.DecodeString(s); err == nil {
		if isValidUsername(string(decoded)) {
			return string(decoded)
		}
	}
	// Try URL-safe Base64
	if decoded, err := base64.URLEncoding.DecodeString(s); err == nil {
		if isValidUsername(string(decoded)) {
			return string(decoded)
		}
	}
	// Try unpadded Base64
	if decoded, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		if isValidUsername(string(decoded)) {
			return string(decoded)
		}
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		if isValidUsername(string(decoded)) {
			return string(decoded)
		}
	}
	return ""
}
