package parser

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
	"github.com/xiaobei/singbox-manager/pkg/utils"
)

// VmessParser VMess parser
type VmessParser struct{}

// Protocol returns the protocol name
func (p *VmessParser) Protocol() string {
	return "vmess"
}

// vmessConfig VMess configuration structure
type vmessConfig struct {
	V    interface{} `json:"v"`              // version
	Ps   string      `json:"ps"`             // node name
	Add  string      `json:"add"`            // server address
	Port interface{} `json:"port"`           // port
	ID   string      `json:"id"`             // UUID
	Aid  interface{} `json:"aid"`            // Alter ID
	Scy  string      `json:"scy"`            // encryption method
	Net  string      `json:"net"`            // transport protocol
	Type string      `json:"type"`           // camouflage type
	Host string      `json:"host"`           // camouflage domain
	Path string      `json:"path"`           // path
	TLS  string      `json:"tls"`            // TLS
	SNI  string      `json:"sni"`            // SNI
	ALPN string      `json:"alpn"`           // ALPN
	Fp   string      `json:"fp"`             // Fingerprint
	Skip bool        `json:"skip-cert-verify"` // skip certificate verification
}

// Parse parses a VMess URL
// Format: vmess://BASE64(json)#name
func (p *VmessParser) Parse(rawURL string) (*storage.Node, error) {
	// Remove protocol prefix
	rawURL = strings.TrimPrefix(rawURL, "vmess://")

	// Separate fragment (#name)
	var fragmentName string
	if idx := strings.Index(rawURL, "#"); idx != -1 {
		fragmentName, _ = url.QueryUnescape(rawURL[idx+1:])
		rawURL = rawURL[:idx]
	}

	// Base64 decode
	decoded, err := utils.DecodeBase64(rawURL)
	if err != nil {
		return nil, fmt.Errorf("Base64 decode failed: %w", err)
	}

	// Parse JSON
	var config vmessConfig
	if err := json.Unmarshal([]byte(decoded), &config); err != nil {
		return nil, fmt.Errorf("JSON parse failed: %w", err)
	}

	// Get port
	var port int
	switch v := config.Port.(type) {
	case float64:
		port = int(v)
	case string:
		port, _ = strconv.Atoi(v)
	case int:
		port = v
	}

	// Get Alter ID
	var alterId int
	switch v := config.Aid.(type) {
	case float64:
		alterId = int(v)
	case string:
		alterId, _ = strconv.Atoi(v)
	case int:
		alterId = v
	}

	// Set name
	name := config.Ps
	if fragmentName != "" {
		name = fragmentName
	}
	if name == "" {
		name = fmt.Sprintf("%s:%d", config.Add, port)
	}

	// Build Extra
	extra := map[string]interface{}{
		"uuid":     config.ID,
		"alter_id": alterId,
		"security": config.Scy,
	}

	// Set default encryption method
	if config.Scy == "" {
		extra["security"] = "auto"
	}

	// Transport layer configuration
	network := config.Net
	if network == "" {
		network = "tcp"
	}

	// Build transport configuration
	if network != "tcp" || config.Type == "http" {
		transport := map[string]interface{}{
			"type": network,
		}

		switch network {
		case "ws":
			if config.Path != "" {
				transport["path"] = config.Path
			}
			if config.Host != "" {
				transport["headers"] = map[string]string{
					"Host": config.Host,
				}
			}
		case "http", "h2":
			if config.Path != "" {
				transport["path"] = config.Path
			}
			if config.Host != "" {
				transport["host"] = strings.Split(config.Host, ",")
			}
		case "grpc":
			if config.Path != "" {
				transport["service_name"] = config.Path
			}
		case "quic":
			if config.Type != "" {
				transport["security"] = config.Type
			}
		}

		extra["transport"] = transport
	}

	// TLS configuration
	if config.TLS == "tls" {
		tls := map[string]interface{}{
			"enabled": true,
		}
		// Set server_name (by priority: SNI > Host > server address)
		if config.SNI != "" {
			tls["server_name"] = config.SNI
		} else if config.Host != "" {
			tls["server_name"] = config.Host
		} else {
			// If both SNI and Host are empty, use server address as default server_name
			// This ensures the correct SNI is used during TLS handshake
			tls["server_name"] = config.Add
		}
		if config.Skip {
			tls["insecure"] = true
		}
		if config.Fp != "" {
			tls["utls"] = map[string]interface{}{
				"enabled":     true,
				"fingerprint": config.Fp,
			}
		}
		if config.ALPN != "" {
			tls["alpn"] = strings.Split(config.ALPN, ",")
		}
		extra["tls"] = tls
	}

	node := &storage.Node{
		Tag:        name,
		Type:       "vmess",
		Server:     config.Add,
		ServerPort: port,
		Extra:      extra,
	}

	return node, nil
}
