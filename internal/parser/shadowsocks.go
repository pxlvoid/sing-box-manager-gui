package parser

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
	"github.com/xiaobei/singbox-manager/pkg/utils"
)

// ShadowsocksParser Shadowsocks parser
type ShadowsocksParser struct{}

// Protocol returns the protocol name
func (p *ShadowsocksParser) Protocol() string {
	return "shadowsocks"
}

// Parse parses a Shadowsocks URL
// Format 1 (SIP002): ss://BASE64(method:password)@server:port#name
// Format 2 (Legacy): ss://BASE64(method:password@server:port)#name
func (p *ShadowsocksParser) Parse(rawURL string) (*storage.Node, error) {
	// Remove protocol prefix
	rawURL = strings.TrimPrefix(rawURL, "ss://")

	// Separate fragment (#name)
	var name string
	if idx := strings.Index(rawURL, "#"); idx != -1 {
		name, _ = url.QueryUnescape(rawURL[idx+1:])
		rawURL = rawURL[:idx]
	}

	var method, password, server string
	var port int

	// Try SIP002 format: BASE64@server:port
	if atIdx := strings.LastIndex(rawURL, "@"); atIdx != -1 {
		// New format
		userInfo := rawURL[:atIdx]
		serverPart := rawURL[atIdx+1:]

		// Parse server info
		var err error
		server, port, err = parseServerInfo(serverPart)
		if err != nil {
			return nil, fmt.Errorf("failed to parse server address: %w", err)
		}

		// Decode user info
		decoded, err := utils.DecodeBase64(userInfo)
		if err != nil {
			// Might be URL encoded
			decoded, err = url.QueryUnescape(userInfo)
			if err != nil {
				return nil, fmt.Errorf("failed to decode user info: %w", err)
			}
		}

		// Separate method:password
		colonIdx := strings.Index(decoded, ":")
		if colonIdx == -1 {
			return nil, fmt.Errorf("invalid user info format")
		}
		method = decoded[:colonIdx]
		password = decoded[colonIdx+1:]
	} else {
		// Legacy format: BASE64(method:password@server:port)
		decoded, err := utils.DecodeBase64(rawURL)
		if err != nil {
			return nil, fmt.Errorf("decode failed: %w", err)
		}

		// Separate method:password@server:port
		atIdx := strings.LastIndex(decoded, "@")
		if atIdx == -1 {
			return nil, fmt.Errorf("invalid URL format")
		}

		userInfo := decoded[:atIdx]
		serverPart := decoded[atIdx+1:]

		// Parse server info
		server, port, err = parseServerInfo(serverPart)
		if err != nil {
			return nil, fmt.Errorf("failed to parse server address: %w", err)
		}

		// Separate method:password
		colonIdx := strings.Index(userInfo, ":")
		if colonIdx == -1 {
			return nil, fmt.Errorf("invalid user info format")
		}
		method = userInfo[:colonIdx]
		password = userInfo[colonIdx+1:]
	}

	// Set default name
	if name == "" {
		name = fmt.Sprintf("%s:%d", server, port)
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "shadowsocks",
		Server:     server,
		ServerPort: port,
		Extra: map[string]interface{}{
			"method":   method,
			"password": password,
			"network":  []string{"tcp", "udp"},
		},
	}

	return node, nil
}
