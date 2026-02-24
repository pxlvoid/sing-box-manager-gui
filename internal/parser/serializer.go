package parser

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// SerializeNode converts a Node back to a proxy URL string.
func SerializeNode(node *storage.Node) (string, error) {
	switch node.Type {
	case "shadowsocks":
		return serializeShadowsocks(node)
	case "vmess":
		return serializeVmess(node)
	case "vless":
		return serializeVless(node)
	case "trojan":
		return serializeTrojan(node)
	case "hysteria2":
		return serializeHysteria2(node)
	case "tuic":
		return serializeTuic(node)
	case "socks":
		return serializeSocks(node)
	default:
		return "", fmt.Errorf("unsupported protocol: %s", node.Type)
	}
}

// helper to safely get a string from extra map
func extraStr(extra map[string]interface{}, key string) string {
	if v, ok := extra[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// helper to safely get an int from extra map
func extraInt(extra map[string]interface{}, key string) int {
	if v, ok := extra[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case string:
			i, _ := strconv.Atoi(n)
			return i
		}
	}
	return 0
}

// helper to safely get a bool from extra map
func extraBool(extra map[string]interface{}, key string) bool {
	if v, ok := extra[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

// helper to get a nested map from extra
func extraMap(extra map[string]interface{}, key string) map[string]interface{} {
	if v, ok := extra[key]; ok {
		if m, ok := v.(map[string]interface{}); ok {
			return m
		}
	}
	return nil
}

func formatServerPort(server string, port int) string {
	if strings.Contains(server, ":") {
		// IPv6
		return fmt.Sprintf("[%s]:%d", server, port)
	}
	return fmt.Sprintf("%s:%d", server, port)
}

// ss://BASE64(method:password)@server:port#name
func serializeShadowsocks(node *storage.Node) (string, error) {
	method := extraStr(node.Extra, "method")
	password := extraStr(node.Extra, "password")
	if method == "" || password == "" {
		return "", fmt.Errorf("shadowsocks: missing method or password")
	}

	userInfo := base64.URLEncoding.EncodeToString([]byte(method + ":" + password))
	u := fmt.Sprintf("ss://%s@%s#%s", userInfo, formatServerPort(node.Server, node.ServerPort), url.PathEscape(node.Tag))
	return u, nil
}

// vmess://BASE64(json)
func serializeVmess(node *storage.Node) (string, error) {
	config := vmessConfig{
		V:   "2",
		Ps:  node.Tag,
		Add: node.Server,
		Port: node.ServerPort,
		ID:  extraStr(node.Extra, "uuid"),
		Aid: extraInt(node.Extra, "alter_id"),
		Scy: extraStr(node.Extra, "security"),
	}

	if transport := extraMap(node.Extra, "transport"); transport != nil {
		config.Net = extraStr(transport, "type")
		switch config.Net {
		case "ws":
			config.Path = extraStr(transport, "path")
			if headers := extraMap(transport, "headers"); headers != nil {
				config.Host = extraStr(headers, "Host")
			}
		case "http", "h2":
			config.Path = extraStr(transport, "path")
			if host, ok := transport["host"]; ok {
				if hosts, ok := host.([]interface{}); ok {
					parts := make([]string, 0, len(hosts))
					for _, h := range hosts {
						if s, ok := h.(string); ok {
							parts = append(parts, s)
						}
					}
					config.Host = strings.Join(parts, ",")
				}
			}
		case "grpc":
			config.Path = extraStr(transport, "service_name")
		}
	}

	if tls := extraMap(node.Extra, "tls"); tls != nil {
		if extraBool(tls, "enabled") {
			config.TLS = "tls"
			config.SNI = extraStr(tls, "server_name")
			config.Skip = extraBool(tls, "insecure")
			if utls := extraMap(tls, "utls"); utls != nil {
				config.Fp = extraStr(utls, "fingerprint")
			}
			if alpn, ok := tls["alpn"]; ok {
				if alpnList, ok := alpn.([]interface{}); ok {
					parts := make([]string, 0, len(alpnList))
					for _, a := range alpnList {
						if s, ok := a.(string); ok {
							parts = append(parts, s)
						}
					}
					config.ALPN = strings.Join(parts, ",")
				}
			}
		}
	}

	jsonBytes, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("vmess: failed to marshal config: %w", err)
	}

	encoded := base64.StdEncoding.EncodeToString(jsonBytes)
	return "vmess://" + encoded, nil
}

// vless://uuid@server:port?params#name
func serializeVless(node *storage.Node) (string, error) {
	uuid := extraStr(node.Extra, "uuid")
	if uuid == "" {
		return "", fmt.Errorf("vless: missing uuid")
	}

	params := url.Values{}

	if flow := extraStr(node.Extra, "flow"); flow != "" {
		params.Set("flow", flow)
	}
	if pe := extraStr(node.Extra, "packet_encoding"); pe != "" {
		params.Set("packetEncoding", pe)
	}

	serializeTransportParams(node.Extra, params)
	serializeTLSParams(node.Extra, params)

	u := fmt.Sprintf("vless://%s@%s", uuid, formatServerPort(node.Server, node.ServerPort))
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	u += "#" + url.PathEscape(node.Tag)
	return u, nil
}

// trojan://password@server:port?params#name
func serializeTrojan(node *storage.Node) (string, error) {
	password := extraStr(node.Extra, "password")
	if password == "" {
		return "", fmt.Errorf("trojan: missing password")
	}

	params := url.Values{}

	if flow := extraStr(node.Extra, "flow"); flow != "" {
		params.Set("flow", flow)
	}

	serializeTransportParams(node.Extra, params)
	serializeTLSParams(node.Extra, params)

	u := fmt.Sprintf("trojan://%s@%s", url.QueryEscape(password), formatServerPort(node.Server, node.ServerPort))
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	u += "#" + url.PathEscape(node.Tag)
	return u, nil
}

// hysteria2://password@server:port?params#name
func serializeHysteria2(node *storage.Node) (string, error) {
	password := extraStr(node.Extra, "password")
	if password == "" {
		return "", fmt.Errorf("hysteria2: missing password")
	}

	params := url.Values{}

	if tls := extraMap(node.Extra, "tls"); tls != nil {
		if sni := extraStr(tls, "server_name"); sni != "" {
			params.Set("sni", sni)
		}
		if extraBool(tls, "insecure") {
			params.Set("insecure", "1")
		}
		if alpn, ok := tls["alpn"]; ok {
			if alpnList, ok := alpn.([]interface{}); ok {
				parts := make([]string, 0, len(alpnList))
				for _, a := range alpnList {
					if s, ok := a.(string); ok {
						parts = append(parts, s)
					}
				}
				if len(parts) > 0 {
					params.Set("alpn", strings.Join(parts, ","))
				}
			}
		}
	}

	if obfs := extraMap(node.Extra, "obfs"); obfs != nil {
		if obfsType := extraStr(obfs, "type"); obfsType != "" {
			params.Set("obfs", obfsType)
		}
		if obfsPassword := extraStr(obfs, "password"); obfsPassword != "" {
			params.Set("obfs-password", obfsPassword)
		}
	}

	if upMbps := extraInt(node.Extra, "up_mbps"); upMbps > 0 {
		params.Set("upmbps", strconv.Itoa(upMbps))
	}
	if downMbps := extraInt(node.Extra, "down_mbps"); downMbps > 0 {
		params.Set("downmbps", strconv.Itoa(downMbps))
	}
	if ports := extraStr(node.Extra, "ports"); ports != "" {
		params.Set("mport", ports)
	}
	if hopInterval := extraStr(node.Extra, "hop_interval"); hopInterval != "" {
		params.Set("hop-interval", hopInterval)
	}

	u := fmt.Sprintf("hysteria2://%s@%s", url.QueryEscape(password), formatServerPort(node.Server, node.ServerPort))
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	u += "#" + url.PathEscape(node.Tag)
	return u, nil
}

// tuic://uuid:password@server:port?params#name
func serializeTuic(node *storage.Node) (string, error) {
	uuid := extraStr(node.Extra, "uuid")
	password := extraStr(node.Extra, "password")

	params := url.Values{}

	if tls := extraMap(node.Extra, "tls"); tls != nil {
		if sni := extraStr(tls, "server_name"); sni != "" {
			params.Set("sni", sni)
		}
		if extraBool(tls, "insecure") {
			params.Set("insecure", "1")
		}
		if extraBool(tls, "disable_sni") {
			params.Set("disable-sni", "1")
		}
		if alpn, ok := tls["alpn"]; ok {
			if alpnList, ok := alpn.([]interface{}); ok {
				parts := make([]string, 0, len(alpnList))
				for _, a := range alpnList {
					if s, ok := a.(string); ok {
						parts = append(parts, s)
					}
				}
				if len(parts) > 0 {
					params.Set("alpn", strings.Join(parts, ","))
				}
			}
		}
	}

	if cc := extraStr(node.Extra, "congestion_control"); cc != "" {
		params.Set("congestion_control", cc)
	}
	if mode := extraStr(node.Extra, "udp_relay_mode"); mode != "" {
		params.Set("udp-relay-mode", mode)
	}
	if extraBool(node.Extra, "zero_rtt_handshake") {
		params.Set("zero-rtt", "1")
	}
	if heartbeat := extraStr(node.Extra, "heartbeat"); heartbeat != "" {
		params.Set("heartbeat", heartbeat)
	}

	u := fmt.Sprintf("tuic://%s:%s@%s", url.QueryEscape(uuid), url.QueryEscape(password), formatServerPort(node.Server, node.ServerPort))
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	u += "#" + url.PathEscape(node.Tag)
	return u, nil
}

// socks://username:password@server:port#name
func serializeSocks(node *storage.Node) (string, error) {
	username := extraStr(node.Extra, "username")
	password := extraStr(node.Extra, "password")

	var userPart string
	if username != "" || password != "" {
		userPart = url.QueryEscape(username) + ":" + url.QueryEscape(password) + "@"
	}

	u := fmt.Sprintf("socks://%s%s#%s", userPart, formatServerPort(node.Server, node.ServerPort), url.PathEscape(node.Tag))
	return u, nil
}

// serializeTransportParams writes transport-related query params.
func serializeTransportParams(extra map[string]interface{}, params url.Values) {
	transport := extraMap(extra, "transport")
	if transport == nil {
		return
	}

	transportType := extraStr(transport, "type")
	if transportType != "" {
		params.Set("type", transportType)
	}

	switch transportType {
	case "ws":
		if path := extraStr(transport, "path"); path != "" {
			params.Set("path", path)
		}
		if headers := extraMap(transport, "headers"); headers != nil {
			if host := extraStr(headers, "Host"); host != "" {
				params.Set("host", host)
			}
		}
	case "http", "h2":
		if path := extraStr(transport, "path"); path != "" {
			params.Set("path", path)
		}
		if host, ok := transport["host"]; ok {
			if hosts, ok := host.([]interface{}); ok {
				parts := make([]string, 0, len(hosts))
				for _, h := range hosts {
					if s, ok := h.(string); ok {
						parts = append(parts, s)
					}
				}
				if len(parts) > 0 {
					params.Set("host", strings.Join(parts, ","))
				}
			}
		}
	case "grpc":
		if sn := extraStr(transport, "service_name"); sn != "" {
			params.Set("serviceName", sn)
		}
		if idle := extraStr(transport, "idle_timeout"); idle != "" {
			params.Set("idleTimeout", idle)
		}
		if ping := extraStr(transport, "ping_timeout"); ping != "" {
			params.Set("pingTimeout", ping)
		}
		if extraBool(transport, "permit_without_stream") {
			params.Set("permitWithoutStream", "1")
		}
	}
}

// serializeTLSParams writes TLS/Reality-related query params.
func serializeTLSParams(extra map[string]interface{}, params url.Values) {
	tls := extraMap(extra, "tls")
	if tls == nil || !extraBool(tls, "enabled") {
		params.Set("security", "none")
		return
	}

	// Check if Reality
	reality := extraMap(tls, "reality")
	if reality != nil && extraBool(reality, "enabled") {
		params.Set("security", "reality")
		if pbk := extraStr(reality, "public_key"); pbk != "" {
			params.Set("pbk", pbk)
		}
		if sid := extraStr(reality, "short_id"); sid != "" {
			params.Set("sid", sid)
		}
	} else {
		params.Set("security", "tls")
	}

	if sni := extraStr(tls, "server_name"); sni != "" {
		params.Set("sni", sni)
	}
	if extraBool(tls, "insecure") {
		params.Set("allowInsecure", "1")
	}
	if alpn, ok := tls["alpn"]; ok {
		if alpnList, ok := alpn.([]interface{}); ok {
			parts := make([]string, 0, len(alpnList))
			for _, a := range alpnList {
				if s, ok := a.(string); ok {
					parts = append(parts, s)
				}
			}
			if len(parts) > 0 {
				params.Set("alpn", strings.Join(parts, ","))
			}
		}
	}
	if utls := extraMap(tls, "utls"); utls != nil && extraBool(utls, "enabled") {
		if fp := extraStr(utls, "fingerprint"); fp != "" {
			params.Set("fp", fp)
		}
	}
}
