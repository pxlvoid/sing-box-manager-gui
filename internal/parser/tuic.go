package parser

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// TuicParser TUIC Parser
type TuicParser struct{}

// Protocol Return protocol name
func (p *TuicParser) Protocol() string {
	return "tuic"
}

// Parse Parse TUIC URL
// Format: tuic://uuid:password@server:port?params#name
func (p *TuicParser) Parse(rawURL string) (*storage.Node, error) {
	addressPart, params, name, err := parseURLParams(rawURL)
	if err != nil {
		return nil, err
	}

	// Separate userinfo and server information
	atIdx := strings.LastIndex(addressPart, "@")
	if atIdx == -1 {
		return nil, fmt.Errorf("Invalid TUIC URL format")
	}

	userInfo, _ := url.QueryUnescape(addressPart[:atIdx])
	serverPart := addressPart[atIdx+1:]

	// Parse server address
	server, port, err := parseServerInfo(serverPart)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse server address: %w", err)
	}

	// Parse uuid:password
	var uuid, password string
	colonIdx := strings.Index(userInfo, ":")
	if colonIdx == -1 {
		uuid = userInfo
		password = params.Get("password")
	} else {
		uuid = userInfo[:colonIdx]
		password = userInfo[colonIdx+1:]
	}

	// Set default name
	if name == "" {
		name = fmt.Sprintf("%s:%d", server, port)
	}

	// Build Extra
	extra := map[string]interface{}{
		"uuid":     uuid,
		"password": password,
	}

	// TLS configuration
	tls := map[string]interface{}{
		"enabled": true,
	}

	// SNI
	if sni := params.Get("sni"); sni != "" {
		tls["server_name"] = sni
	}

	// Skip certificate verification
	if getParamBool(params, "insecure") || getParamBool(params, "allowInsecure") || getParamBool(params, "skip-cert-verify") {
		tls["insecure"] = true
	}

	// ALPN
	if alpn := params.Get("alpn"); alpn != "" {
		tls["alpn"] = strings.Split(alpn, ",")
	}

	// Disable SNI
	if getParamBool(params, "disable-sni") {
		tls["disable_sni"] = true
	}

	extra["tls"] = tls

	// Congestion control
	if cc := params.Get("congestion_control"); cc != "" {
		extra["congestion_control"] = cc
	} else if cc := params.Get("congestion-control"); cc != "" {
		extra["congestion_control"] = cc
	}

	// UDP relay mode
	if mode := params.Get("udp-relay-mode"); mode != "" {
		extra["udp_relay_mode"] = mode
	} else if mode := params.Get("udp_relay_mode"); mode != "" {
		extra["udp_relay_mode"] = mode
	}

	// Zero RTT
	if getParamBool(params, "zero-rtt") || getParamBool(params, "reduce-rtt") {
		extra["zero_rtt_handshake"] = true
	}

	// Heartbeat
	if heartbeat := params.Get("heartbeat"); heartbeat != "" {
		extra["heartbeat"] = heartbeat
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "tuic",
		Server:     server,
		ServerPort: port,
		Extra:      extra,
	}

	return node, nil
}
