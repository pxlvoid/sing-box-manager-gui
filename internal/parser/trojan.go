package parser

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// TrojanParser Trojan parser
type TrojanParser struct{}

// Protocol returns the protocol name
func (p *TrojanParser) Protocol() string {
	return "trojan"
}

// Parse parses a Trojan URL
// Format: trojan://password@server:port?params#name
func (p *TrojanParser) Parse(rawURL string) (*storage.Node, error) {
	addressPart, params, name, err := parseURLParams(rawURL)
	if err != nil {
		return nil, err
	}

	// Separate password and server info
	atIdx := strings.Index(addressPart, "@")
	if atIdx == -1 {
		return nil, fmt.Errorf("invalid Trojan URL format")
	}

	password, _ := url.QueryUnescape(addressPart[:atIdx])
	serverPart := addressPart[atIdx+1:]

	// Parse server address
	server, port, err := parseServerInfo(serverPart)
	if err != nil {
		return nil, fmt.Errorf("failed to parse server address: %w", err)
	}

	// Set default name
	if name == "" {
		name = fmt.Sprintf("%s:%d", server, port)
	}

	// Build Extra
	extra := map[string]interface{}{
		"password": password,
	}

	// Flow configuration
	if flow := params.Get("flow"); flow != "" {
		extra["flow"] = flow
	}

	// Transport layer configuration
	transportType := getParamString(params, "type", "tcp")
	if transportType != "tcp" {
		transport := map[string]interface{}{
			"type": transportType,
		}

		switch transportType {
		case "ws":
			if path := params.Get("path"); path != "" {
				transport["path"] = path
			}
			if host := params.Get("host"); host != "" {
				transport["headers"] = map[string]string{
					"Host": host,
				}
			}
		case "grpc":
			if serviceName := params.Get("serviceName"); serviceName != "" {
				transport["service_name"] = serviceName
			}
		}

		extra["transport"] = transport
	}

	// TLS/Reality configuration
	security := getParamString(params, "security", "tls")
	if security != "none" {
		tls := map[string]interface{}{
			"enabled": true,
		}

		// SNI
		if sni := params.Get("sni"); sni != "" {
			tls["server_name"] = sni
		} else if host := params.Get("host"); host != "" {
			tls["server_name"] = host
		}

		// Skip certificate verification
		if getParamBool(params, "allowInsecure") || getParamBool(params, "insecure") {
			tls["insecure"] = true
		}

		// ALPN
		if alpn := params.Get("alpn"); alpn != "" {
			tls["alpn"] = strings.Split(alpn, ",")
		}

		// Reality configuration
		if security == "reality" {
			reality := map[string]interface{}{
				"enabled": true,
			}
			if pbk := params.Get("pbk"); pbk != "" {
				reality["public_key"] = pbk
			}
			if sid := params.Get("sid"); sid != "" {
				reality["short_id"] = sid
			}
			tls["reality"] = reality

			// uTLS fingerprint
			fp := getParamString(params, "fp", "chrome")
			tls["utls"] = map[string]interface{}{
				"enabled":     true,
				"fingerprint": fp,
			}
		} else if fp := params.Get("fp"); fp != "" {
			tls["utls"] = map[string]interface{}{
				"enabled":     true,
				"fingerprint": fp,
			}
		}

		extra["tls"] = tls
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "trojan",
		Server:     server,
		ServerPort: port,
		Extra:      extra,
	}

	return node, nil
}
