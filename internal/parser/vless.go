package parser

import (
	"fmt"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// VlessParser VLESS parser
type VlessParser struct{}

// Protocol returns the protocol name
func (p *VlessParser) Protocol() string {
	return "vless"
}

// Parse parses a VLESS URL
// Format: vless://uuid@server:port?params#name
func (p *VlessParser) Parse(rawURL string) (*storage.Node, error) {
	addressPart, params, name, err := parseURLParams(rawURL)
	if err != nil {
		return nil, err
	}

	// Separate uuid and server info
	atIdx := strings.Index(addressPart, "@")
	if atIdx == -1 {
		return nil, fmt.Errorf("invalid VLESS URL format")
	}

	uuid := addressPart[:atIdx]
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
		"uuid": uuid,
	}

	// Flow configuration
	if flow := params.Get("flow"); flow != "" {
		extra["flow"] = flow
	}

	// Packet encoding (e.g. xudp)
	if pe := params.Get("packetEncoding"); pe != "" {
		extra["packet_encoding"] = pe
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
		case "http", "h2":
			if path := params.Get("path"); path != "" {
				transport["path"] = path
			}
			if host := params.Get("host"); host != "" {
				transport["host"] = strings.Split(host, ",")
			}
		case "grpc":
			if serviceName := params.Get("serviceName"); serviceName != "" {
				transport["service_name"] = serviceName
			}
			// mode is parsed from URL but not added to config (sing-box doesn't support it)
		case "quic":
			if security := params.Get("quicSecurity"); security != "" {
				transport["security"] = security
			}
		}

		extra["transport"] = transport
	}

	// TLS/Reality configuration
	security := getParamString(params, "security", "none")
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
			fp := strings.TrimSpace(getParamString(params, "fp", "chrome"))
			tls["utls"] = map[string]interface{}{
				"enabled":     true,
				"fingerprint": fp,
			}
		} else if fp := strings.TrimSpace(params.Get("fp")); fp != "" {
			// uTLS for regular TLS
			tls["utls"] = map[string]interface{}{
				"enabled":     true,
				"fingerprint": fp,
			}
		}

		extra["tls"] = tls
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "vless",
		Server:     server,
		ServerPort: port,
		Extra:      extra,
	}

	return node, nil
}
