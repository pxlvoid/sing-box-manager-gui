package parser

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// Hysteria2Parser Hysteria2 Parser
type Hysteria2Parser struct{}

// Protocol Return protocol name
func (p *Hysteria2Parser) Protocol() string {
	return "hysteria2"
}

// Parse Parse Hysteria2 URL
// Format1: hysteria2://password@server:port?params#name
// Format2: hysteria2://server:port?auth=password&params#name
func (p *Hysteria2Parser) Parse(rawURL string) (*storage.Node, error) {
	addressPart, params, name, err := parseURLParams(rawURL)
	if err != nil {
		return nil, err
	}

	var password, server string
	var port int

	// Determine format
	if strings.Contains(addressPart, "@") {
		// Format 1: password@server:port
		atIdx := strings.Index(addressPart, "@")
		password, _ = url.QueryUnescape(addressPart[:atIdx])
		serverPart := addressPart[atIdx+1:]

		server, port, err = parseServerInfo(serverPart)
		if err != nil {
			return nil, fmt.Errorf("Failed to parse server address: %w", err)
		}
	} else {
		// Format 2: server:port (password in params)
		server, port, err = parseServerInfo(addressPart)
		if err != nil {
			return nil, fmt.Errorf("Failed to parse server address: %w", err)
		}
		password = params.Get("auth")
	}

	if password == "" {
		return nil, fmt.Errorf("Missing authentication password")
	}

	// Set default name
	if name == "" {
		name = fmt.Sprintf("%s:%d", server, port)
	}

	// Build Extra
	extra := map[string]interface{}{
		"password": password,
	}

	// TLS configuration
	tls := map[string]interface{}{
		"enabled": true,
	}

	// SNI - If not specified, use server address as default
	if sni := params.Get("sni"); sni != "" {
		tls["server_name"] = sni
	} else {
		// Use server address by default
		tls["server_name"] = server
	}

	// Skip certificate verification
	if getParamBool(params, "insecure") || getParamBool(params, "allowInsecure") {
		tls["insecure"] = true
	}

	// ALPN
	if alpn := params.Get("alpn"); alpn != "" {
		tls["alpn"] = strings.Split(alpn, ",")
	}

	extra["tls"] = tls

	// Obfuscation configuration
	if obfsPassword := params.Get("obfs-password"); obfsPassword != "" {
		obfs := map[string]interface{}{
			"type":     getParamString(params, "obfs", "salamander"),
			"password": obfsPassword,
		}
		extra["obfs"] = obfs
	}

	// Bandwidth configuration - unified conversion to up_mbps/down_mbps
	if up := params.Get("upmbps"); up != "" {
		extra["up_mbps"] = getParamInt(params, "upmbps", 0)
	} else if up := params.Get("up"); up != "" {
		// Parse bandwidth string to integer
		if mbps := parseBandwidth(up); mbps > 0 {
			extra["up_mbps"] = mbps
		}
	}

	if down := params.Get("downmbps"); down != "" {
		extra["down_mbps"] = getParamInt(params, "downmbps", 0)
	} else if down := params.Get("down"); down != "" {
		// Parse bandwidth string to integer
		if mbps := parseBandwidth(down); mbps > 0 {
			extra["down_mbps"] = mbps
		}
	}

	// Port hopping
	if ports := params.Get("mport"); ports != "" {
		extra["ports"] = ports
	}

	// Hop interval
	if hopInterval := params.Get("hop-interval"); hopInterval != "" {
		extra["hop_interval"] = hopInterval
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "hysteria2",
		Server:     server,
		ServerPort: port,
		Extra:      extra,
	}

	return node, nil
}

// parseBandwidth Parse bandwidth string to Mbps integer
// Supported formats: "100", "100Mbps", "100 mbps", "100M" etc
func parseBandwidth(s string) int {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.TrimSuffix(s, "mbps")
	s = strings.TrimSuffix(s, "m")
	s = strings.TrimSpace(s)
	if v, err := strconv.Atoi(s); err == nil && v > 0 {
		return v
	}
	return 0
}
