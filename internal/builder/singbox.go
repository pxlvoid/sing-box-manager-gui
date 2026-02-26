package builder

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// SingBoxConfig represents the sing-box configuration structure
type SingBoxConfig struct {
	Log          *LogConfig          `json:"log,omitempty"`
	DNS          *DNSConfig          `json:"dns,omitempty"`
	NTP          *NTPConfig          `json:"ntp,omitempty"`
	Inbounds     []Inbound           `json:"inbounds,omitempty"`
	Outbounds    []Outbound          `json:"outbounds"`
	Route        *RouteConfig        `json:"route,omitempty"`
	Experimental *ExperimentalConfig `json:"experimental,omitempty"`
}

// LogConfig represents log configuration
type LogConfig struct {
	Level     string `json:"level,omitempty"`
	Timestamp bool   `json:"timestamp,omitempty"`
	Output    string `json:"output,omitempty"`
}

// DNSConfig represents DNS configuration
type DNSConfig struct {
	Strategy         string      `json:"strategy,omitempty"`
	Servers          []DNSServer `json:"servers,omitempty"`
	Rules            []DNSRule   `json:"rules,omitempty"`
	Final            string      `json:"final,omitempty"`
	IndependentCache bool        `json:"independent_cache,omitempty"`
}

// DNSServer represents a DNS server (new format, supports FakeIP and hosts)
type DNSServer struct {
	Tag        string         `json:"tag"`
	Type       string         `json:"type"`                   // udp, tcp, https, tls, quic, h3, fakeip, rcode, hosts
	Server     string         `json:"server,omitempty"`       // Server address
	Detour     string         `json:"detour,omitempty"`       // Outbound proxy
	Inet4Range string         `json:"inet4_range,omitempty"`  // FakeIP IPv4 address pool
	Inet6Range string         `json:"inet6_range,omitempty"`  // FakeIP IPv6 address pool
	Predefined map[string]any `json:"predefined,omitempty"`   // hosts type only: predefined domain mappings
}

// DNSRule represents a DNS rule
type DNSRule struct {
	Outbound  string   `json:"outbound,omitempty"`   // Match outbound DNS queries, e.g. "any" for proxy server address resolution
	RuleSet   []string `json:"rule_set,omitempty"`
	QueryType []string `json:"query_type,omitempty"`
	Domain    []string `json:"domain,omitempty"`     // Full domain match
	Server    string   `json:"server,omitempty"`
	Action    string   `json:"action,omitempty"`     // route, reject, etc.
}

// NTPConfig represents NTP configuration
type NTPConfig struct {
	Enabled bool   `json:"enabled"`
	Server  string `json:"server,omitempty"`
}

// InboundUser represents a user for socks/http auth
type InboundUser struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Inbound represents inbound configuration
type Inbound struct {
	Type           string        `json:"type"`
	Tag            string        `json:"tag"`
	Listen         string        `json:"listen,omitempty"`
	ListenPort     int           `json:"listen_port,omitempty"`
	Address        []string      `json:"address,omitempty"`
	AutoRoute      bool          `json:"auto_route,omitempty"`
	StrictRoute    bool          `json:"strict_route,omitempty"`
	Stack          string        `json:"stack,omitempty"`
	Sniff          bool          `json:"sniff,omitempty"`
	SniffOverrideDestination bool `json:"sniff_override_destination,omitempty"`
	Users          []InboundUser `json:"users,omitempty"`
	Method         string        `json:"method,omitempty"`
	Password       string        `json:"password,omitempty"`
	Network        []string      `json:"network,omitempty"`
}

// Outbound represents outbound configuration
type Outbound map[string]interface{}

// DomainResolver represents domain resolver configuration
type DomainResolver struct {
	Server     string `json:"server"`
	RewriteTTL int    `json:"rewrite_ttl,omitempty"`
}

// RouteConfig represents route configuration
type RouteConfig struct {
	Rules                 []RouteRule     `json:"rules,omitempty"`
	RuleSet               []RuleSet       `json:"rule_set,omitempty"`
	Final                 string          `json:"final,omitempty"`
	AutoDetectInterface   bool            `json:"auto_detect_interface,omitempty"`
	DefaultDomainResolver *DomainResolver `json:"default_domain_resolver,omitempty"`
}

// RouteRule represents a route rule
type RouteRule map[string]interface{}

// RuleSet represents a rule set
type RuleSet struct {
	Tag            string `json:"tag"`
	Type           string `json:"type"`
	Format         string `json:"format"`
	URL            string `json:"url,omitempty"`
	DownloadDetour string `json:"download_detour,omitempty"`
}

// ExperimentalConfig represents experimental configuration
type ExperimentalConfig struct {
	ClashAPI *ClashAPIConfig `json:"clash_api,omitempty"`
	CacheFile *CacheFileConfig `json:"cache_file,omitempty"`
}

// ClashAPIConfig represents Clash API configuration
type ClashAPIConfig struct {
	ExternalController string `json:"external_controller,omitempty"`
	ExternalUI         string `json:"external_ui,omitempty"`
	Secret             string `json:"secret,omitempty"`
	DefaultMode        string `json:"default_mode,omitempty"`
}

// CacheFileConfig represents cache file configuration
type CacheFileConfig struct {
	Enabled     bool   `json:"enabled"`
	Path        string `json:"path,omitempty"`
	StoreFakeIP bool   `json:"store_fakeip,omitempty"` // Persist FakeIP mappings
}

// ConfigBuilder builds sing-box configuration
type ConfigBuilder struct {
	settings    *storage.Settings
	nodes       []storage.Node
	filters     []storage.Filter
	rules       []storage.Rule
	ruleGroups  []storage.RuleGroup
	excludeTags map[string]bool
}

// NewConfigBuilder creates a new configuration builder
func NewConfigBuilder(settings *storage.Settings, nodes []storage.Node, filters []storage.Filter, rules []storage.Rule, ruleGroups []storage.RuleGroup) *ConfigBuilder {
	return &ConfigBuilder{
		settings:   settings,
		nodes:      nodes,
		filters:    filters,
		rules:      rules,
		ruleGroups: ruleGroups,
	}
}

// NewConfigBuilderWithExclusions creates a new configuration builder that excludes specific nodes by tag
func NewConfigBuilderWithExclusions(settings *storage.Settings, nodes []storage.Node, filters []storage.Filter, rules []storage.Rule, ruleGroups []storage.RuleGroup, excludeTags map[string]bool) *ConfigBuilder {
	return &ConfigBuilder{
		settings:    settings,
		nodes:       nodes,
		filters:     filters,
		rules:       rules,
		ruleGroups:  ruleGroups,
		excludeTags: excludeTags,
	}
}

// buildRuleSetURL builds rule set URL (with GitHub proxy support)
func (b *ConfigBuilder) buildRuleSetURL(originalURL string) string {
	if b.settings.GithubProxy != "" {
		return b.settings.GithubProxy + originalURL
	}
	return originalURL
}

// Build builds the sing-box configuration
func (b *ConfigBuilder) Build() (*SingBoxConfig, error) {
	outbounds, _ := b.buildOutboundsWithMap()
	config := &SingBoxConfig{
		Log:       b.buildLog(),
		DNS:       b.buildDNS(),
		NTP:       b.buildNTP(),
		Inbounds:  b.buildInbounds(),
		Outbounds: outbounds,
		Route:     b.buildRoute(),
	}

	// Add Clash API support
	if b.settings.ClashAPIPort > 0 {
		config.Experimental = b.buildExperimental()
	}

	return config, nil
}

// BuildJSON builds the JSON string
func (b *ConfigBuilder) BuildJSON() (string, error) {
	config, err := b.Build()
	if err != nil {
		return "", err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to serialize config: %w", err)
	}

	return string(data), nil
}

// BuildJSONWithNodeMap builds the JSON string and returns a map from outbound index to node tag
func (b *ConfigBuilder) BuildJSONWithNodeMap() (string, map[int]string, error) {
	outbounds, indexToTag := b.buildOutboundsWithMap()
	config := &SingBoxConfig{
		Log:       b.buildLog(),
		DNS:       b.buildDNS(),
		NTP:       b.buildNTP(),
		Inbounds:  b.buildInbounds(),
		Outbounds: outbounds,
		Route:     b.buildRoute(),
	}

	if b.settings.ClashAPIPort > 0 {
		config.Experimental = b.buildExperimental()
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", nil, fmt.Errorf("failed to serialize config: %w", err)
	}

	return string(data), indexToTag, nil
}

// buildLog builds log configuration
func (b *ConfigBuilder) buildLog() *LogConfig {
	return &LogConfig{
		Level:     "info",
		Timestamp: true,
	}
}

// ParseSystemHosts parses the system /etc/hosts file
func ParseSystemHosts() map[string][]string {
	hosts := make(map[string][]string)

	data, err := os.ReadFile("/etc/hosts")
	if err != nil {
		return hosts
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Remove inline comments
		if idx := strings.Index(line, "#"); idx != -1 {
			line = line[:idx]
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		ip := fields[0]
		// Skip localhost entries
		for _, domain := range fields[1:] {
			if domain == "localhost" || strings.HasSuffix(domain, ".localhost") {
				continue
			}
			hosts[domain] = append(hosts[domain], ip)
		}
	}

	return hosts
}

// buildDNS builds DNS configuration
func (b *ConfigBuilder) buildDNS() *DNSConfig {
	// Base DNS servers
	servers := []DNSServer{
		{
			Tag:    "dns_proxy",
			Type:   "https",
			Server: "8.8.8.8",
			Detour: "Proxy",
		},
		{
			Tag:    "dns_direct",
			Type:   "udp",
			Server: "223.5.5.5",
		},
		{
			Tag:        "dns_fakeip",
			Type:       "fakeip",
			Inet4Range: "198.18.0.0/15",
			Inet6Range: "fc00::/18",
		},
	}

	// Base DNS rules
	rules := []DNSRule{
		{
			QueryType: []string{"A", "AAAA"},
			Server:    "dns_fakeip",
			Action:    "route",
		},
	}

	// 1. Read system hosts
	systemHosts := ParseSystemHosts()

	// 2. Collect user-defined hosts (user takes priority, overrides system hosts)
	predefined := make(map[string]any)
	var domains []string

	// First add system hosts
	for domain, ips := range systemHosts {
		if len(ips) == 1 {
			predefined[domain] = ips[0]
		} else {
			predefined[domain] = ips
		}
		domains = append(domains, domain)
	}

	// Then add user hosts (overrides same-name system hosts)
	for _, host := range b.settings.Hosts {
		if host.Enabled && host.Domain != "" && len(host.IPs) > 0 {
			if len(host.IPs) == 1 {
				predefined[host.Domain] = host.IPs[0]
			} else {
				predefined[host.Domain] = host.IPs
			}
			// If it's a new domain, add to list
			if _, exists := systemHosts[host.Domain]; !exists {
				domains = append(domains, host.Domain)
			}
		}
	}

	// 3. If there are mappings, add hosts server and rules
	if len(predefined) > 0 {
		// Insert hosts server at the beginning of server list
		hostsServer := DNSServer{
			Tag:        "dns_hosts",
			Type:       "hosts",
			Predefined: predefined,
		}
		servers = append([]DNSServer{hostsServer}, servers...)

		// Insert hosts rule at the beginning of rule list (priority match)
		hostsRule := DNSRule{
			Domain: domains,
			Server: "dns_hosts",
			Action: "route",
		}
		rules = append([]DNSRule{hostsRule}, rules...)
	}

	return &DNSConfig{
		Strategy:         "prefer_ipv4",
		Servers:          servers,
		Rules:            rules,
		Final:            "dns_proxy",
		IndependentCache: true,
	}
}

// buildNTP builds NTP configuration
func (b *ConfigBuilder) buildNTP() *NTPConfig {
	return &NTPConfig{
		Enabled: true,
		Server:  "time.apple.com",
	}
}

// buildInbounds builds inbound configuration
func (b *ConfigBuilder) buildInbounds() []Inbound {
	// Determine listen address based on LAN access setting
	listenAddr := "127.0.0.1"
	if b.settings.AllowLAN {
		listenAddr = "0.0.0.0"
	}

	var inbounds []Inbound

	// Mixed inbound (HTTP+SOCKS5 on one port)
	if b.settings.MixedPort > 0 {
		inbounds = append(inbounds, Inbound{
			Type:       "mixed",
			Tag:        "mixed-in",
			Listen:     listenAddr,
			ListenPort: b.settings.MixedPort,
			Sniff:      true,
			SniffOverrideDestination: true,
		})
	}

	// SOCKS5 inbound
	if b.settings.SocksPort > 0 {
		socks := Inbound{
			Type:       "socks",
			Tag:        "socks-in",
			Listen:     listenAddr,
			ListenPort: b.settings.SocksPort,
			Sniff:      true,
			SniffOverrideDestination: true,
		}
		if b.settings.SocksAuth && b.settings.SocksUsername != "" {
			socks.Users = []InboundUser{
				{Username: b.settings.SocksUsername, Password: b.settings.SocksPassword},
			}
		}
		inbounds = append(inbounds, socks)
	}

	// HTTP inbound
	if b.settings.HttpPort > 0 {
		http := Inbound{
			Type:       "http",
			Tag:        "http-in",
			Listen:     listenAddr,
			ListenPort: b.settings.HttpPort,
			Sniff:      true,
			SniffOverrideDestination: true,
		}
		if b.settings.HttpAuth && b.settings.HttpUsername != "" {
			http.Users = []InboundUser{
				{Username: b.settings.HttpUsername, Password: b.settings.HttpPassword},
			}
		}
		inbounds = append(inbounds, http)
	}

	// Shadowsocks inbound
	if b.settings.ShadowsocksPort > 0 && b.settings.ShadowsocksMethod != "" {
		inbounds = append(inbounds, Inbound{
			Type:       "shadowsocks",
			Tag:        "shadowsocks-in",
			Listen:     listenAddr,
			ListenPort: b.settings.ShadowsocksPort,
			Sniff:      true,
			SniffOverrideDestination: true,
			Method:     b.settings.ShadowsocksMethod,
			Password:   b.settings.ShadowsocksPassword,
			Network:    []string{"tcp", "udp"},
		})
	}

	// TUN inbound
	if b.settings.TunEnabled {
		inbounds = append(inbounds, Inbound{
			Type:        "tun",
			Tag:         "tun-in",
			Address:     []string{"172.19.0.1/30", "fdfe:dcba:9876::1/126"},
			AutoRoute:   true,
			StrictRoute: true,
			Stack:       "system",
			Sniff:       true,
			SniffOverrideDestination: true,
		})
	}

	return inbounds
}

// buildOutboundsWithMap builds outbound configuration and returns a map from outbound index to node tag
func (b *ConfigBuilder) buildOutboundsWithMap() ([]Outbound, map[int]string) {
	indexToTag := make(map[int]string)
	outbounds := []Outbound{
		{"type": "direct", "tag": "DIRECT"},
		{"type": "block", "tag": "REJECT"},
		// Removed dns-out, using route action: hijack-dns instead
	}

	// Collect all node tags and group by country
	var allNodeTags []string
	nodeTagSet := make(map[string]bool)
	countryNodes := make(map[string][]string) // Country code -> node tag list

	// Add all nodes (skip duplicates and excluded tags)
	for _, node := range b.nodes {
		if b.excludeTags != nil && b.excludeTags[node.Tag] {
			continue
		}
		// Skip duplicate tags — sing-box doesn't allow duplicate outbound tags
		if nodeTagSet[node.Tag] {
			continue
		}
		indexToTag[len(outbounds)] = node.Tag
		outbound := b.nodeToOutbound(node)
		outbounds = append(outbounds, outbound)
		allNodeTags = append(allNodeTags, node.Tag)
		nodeTagSet[node.Tag] = true

		// Group by country
		if node.Country != "" {
			countryNodes[node.Country] = append(countryNodes[node.Country], node.Tag)
		} else {
			// Unrecognized country nodes go into "OTHER" group
			countryNodes["OTHER"] = append(countryNodes["OTHER"], node.Tag)
		}
	}

	// Collect filter groups
	var filterGroupTags []string
	filterNodeMap := make(map[string][]string)

	for _, filter := range b.filters {
		if !filter.Enabled {
			continue
		}

		// Filter nodes based on filter criteria
		var filteredTags []string
		for _, node := range b.nodes {
			if b.excludeTags != nil && b.excludeTags[node.Tag] {
				continue
			}
			if b.matchFilter(node, filter) {
				filteredTags = append(filteredTags, node.Tag)
			}
		}

		if len(filteredTags) == 0 {
			continue
		}

		groupTag := filter.Name
		filterGroupTags = append(filterGroupTags, groupTag)
		filterNodeMap[groupTag] = filteredTags

		// Create group
		group := Outbound{
			"tag":       groupTag,
			"type":      filter.Mode,
			"outbounds": filteredTags,
		}

		if filter.Mode == "urltest" {
			if filter.URLTestConfig != nil {
				group["url"] = filter.URLTestConfig.URL
				group["interval"] = filter.URLTestConfig.Interval
				group["tolerance"] = filter.URLTestConfig.Tolerance
			} else {
				group["url"] = "https://www.gstatic.com/generate_204"
				group["interval"] = "5m"
				group["tolerance"] = 50
			}
		}

		outbounds = append(outbounds, group)
	}

	// Create country-grouped outbound selectors
	var countryGroupTags []string
	// Sort by country code for consistent ordering
	var countryCodes []string
	for code := range countryNodes {
		countryCodes = append(countryCodes, code)
	}
	sort.Strings(countryCodes)

	for _, code := range countryCodes {
		nodes := countryNodes[code]
		if len(nodes) == 0 {
			continue
		}

		// Create country group tag, format: "flag emoji + name" or "HK"
		emoji := storage.GetCountryEmoji(code)
		name := storage.GetCountryName(code)
		groupTag := fmt.Sprintf("%s %s", emoji, name)
		countryGroupTags = append(countryGroupTags, groupTag)

		// Create auto-select group
		outbounds = append(outbounds, Outbound{
			"tag":       groupTag,
			"type":      "urltest",
			"outbounds": nodes,
			"url":       "https://www.gstatic.com/generate_204",
			"interval":  "5m",
			"tolerance": 50,
		})
	}

	// Create auto-select group (all nodes)
	if len(allNodeTags) > 0 {
		outbounds = append(outbounds, Outbound{
			"tag":       "Auto",
			"type":      "urltest",
			"outbounds": allNodeTags,
			"url":       "https://www.gstatic.com/generate_204",
			"interval":  "5m",
			"tolerance": 50,
		})
	}

	// Create main selector:
	// include individual nodes so dashboard can switch to a specific node directly.
	proxyOutbounds := []string{"Auto"}
	proxyOutbounds = append(proxyOutbounds, allNodeTags...)
	proxyOutbounds = append(proxyOutbounds, countryGroupTags...) // Add country groups
	proxyOutbounds = append(proxyOutbounds, filterGroupTags...)

	outbounds = append(outbounds, Outbound{
		"tag":       "Proxy",
		"type":      "selector",
		"outbounds": proxyOutbounds,
		"default":   "Auto",
	})

	// Create selectors for enabled rule groups
	for _, rg := range b.ruleGroups {
		if !rg.Enabled {
			continue
		}

		var selectorOutbounds []string

		// Determine options based on rule group's default outbound type
		if rg.Outbound == "DIRECT" || rg.Outbound == "REJECT" {
			// Direct/block rule groups: only provide basic options
			selectorOutbounds = []string{"DIRECT", "REJECT", "Proxy"}
		} else {
			// Proxy rule groups: provide full options (without individual nodes)
			selectorOutbounds = []string{"Proxy", "Auto", "DIRECT", "REJECT"}
			selectorOutbounds = append(selectorOutbounds, countryGroupTags...) // Add country groups
			selectorOutbounds = append(selectorOutbounds, filterGroupTags...)
		}

		outbounds = append(outbounds, Outbound{
			"tag":       rg.Name,
			"type":      "selector",
			"outbounds": selectorOutbounds,
			"default":   rg.Outbound,
		})
	}

	// Create fallback rule selector
	fallbackOutbounds := []string{"Proxy", "DIRECT"}
	fallbackOutbounds = append(fallbackOutbounds, countryGroupTags...) // Add country groups
	fallbackOutbounds = append(fallbackOutbounds, filterGroupTags...)
	outbounds = append(outbounds, Outbound{
		"tag":       "Final",
		"type":      "selector",
		"outbounds": fallbackOutbounds,
		"default":   b.settings.FinalOutbound,
	})

	return outbounds, indexToTag
}

// nodeToOutbound converts a node to outbound configuration
func (b *ConfigBuilder) nodeToOutbound(node storage.Node) Outbound {
	return NodeToOutbound(node)
}

// NodeToOutbound converts a storage.Node to an Outbound config entry.
func NodeToOutbound(node storage.Node) Outbound {
	outbound := Outbound{
		"tag":         node.Tag,
		"type":        node.Type,
		"server":      node.Server,
		"server_port": node.ServerPort,
	}

	// Copy Extra fields
	for k, v := range node.Extra {
		outbound[k] = v
	}

	// Remove fields from transport that sing-box doesn't support
	if transport, ok := outbound["transport"].(map[string]interface{}); ok {
		delete(transport, "mode")
	}

	return outbound
}

// matchFilter checks if a node matches a filter
func (b *ConfigBuilder) matchFilter(node storage.Node, filter storage.Filter) bool {
	name := strings.ToLower(node.Tag)

	// 1. Check country include conditions
	if len(filter.IncludeCountries) > 0 {
		matched := false
		for _, country := range filter.IncludeCountries {
			if strings.EqualFold(node.Country, country) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// 2. Check country exclude conditions
	for _, country := range filter.ExcludeCountries {
		if strings.EqualFold(node.Country, country) {
			return false
		}
	}

	// 3. Check keyword include conditions
	if len(filter.Include) > 0 {
		matched := false
		for _, keyword := range filter.Include {
			if strings.Contains(name, strings.ToLower(keyword)) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// 4. Check keyword exclude conditions
	for _, keyword := range filter.Exclude {
		if strings.Contains(name, strings.ToLower(keyword)) {
			return false
		}
	}

	return true
}

// buildRoute builds route configuration
func (b *ConfigBuilder) buildRoute() *RouteConfig {
	route := &RouteConfig{
		AutoDetectInterface: true,
		Final:               "Final",
		// Default domain resolver: resolves all outbound server addresses to avoid DNS loops
		DefaultDomainResolver: &DomainResolver{
			Server:     "dns_direct",
			RewriteTTL: 60,
		},
	}

	// Build rule sets
	ruleSetMap := make(map[string]bool)
	var ruleSets []RuleSet

	// Use a stable order for default rule groups so specific groups
	// (e.g. YouTube) can override broader groups (e.g. Google).
	orderedRuleGroups := make([]storage.RuleGroup, len(b.ruleGroups))
	copy(orderedRuleGroups, b.ruleGroups)
	defaultRulePriority := map[string]int{
		"youtube": 10,
		"google":  20,
	}
	sort.SliceStable(orderedRuleGroups, func(i, j int) bool {
		pi, okI := defaultRulePriority[orderedRuleGroups[i].ID]
		pj, okJ := defaultRulePriority[orderedRuleGroups[j].ID]
		if !okI {
			pi = 1000
		}
		if !okJ {
			pj = 1000
		}
		return pi < pj
	})

	// Collect required rule sets from rule groups
	for _, rg := range orderedRuleGroups {
		if !rg.Enabled {
			continue
		}
		for _, sr := range rg.SiteRules {
			tag := fmt.Sprintf("geosite-%s", sr)
			if !ruleSetMap[tag] {
				ruleSetMap[tag] = true
				ruleSets = append(ruleSets, RuleSet{
					Tag:            tag,
					Type:           "remote",
					Format:         "binary",
					URL:            b.buildRuleSetURL(fmt.Sprintf("%s/geosite-%s.srs", b.settings.RuleSetBaseURL, sr)),
					DownloadDetour: "DIRECT",
				})
			}
		}
		for _, ir := range rg.IPRules {
			tag := fmt.Sprintf("geoip-%s", ir)
			if !ruleSetMap[tag] {
				ruleSetMap[tag] = true
				ruleSets = append(ruleSets, RuleSet{
					Tag:            tag,
					Type:           "remote",
					Format:         "binary",
					URL:            b.buildRuleSetURL(fmt.Sprintf("%s/../rule-set-geoip/geoip-%s.srs", b.settings.RuleSetBaseURL, ir)),
					DownloadDetour: "DIRECT",
				})
			}
		}
	}

	// Collect required rule sets from custom rules
	for _, rule := range b.rules {
		if !rule.Enabled {
			continue
		}
		if rule.RuleType == "geosite" {
			for _, v := range rule.Values {
				tag := fmt.Sprintf("geosite-%s", v)
				if !ruleSetMap[tag] {
					ruleSetMap[tag] = true
					ruleSets = append(ruleSets, RuleSet{
						Tag:            tag,
						Type:           "remote",
						Format:         "binary",
						URL:            b.buildRuleSetURL(fmt.Sprintf("%s/geosite-%s.srs", b.settings.RuleSetBaseURL, v)),
						DownloadDetour: "DIRECT",
					})
				}
			}
		} else if rule.RuleType == "geoip" {
			for _, v := range rule.Values {
				tag := fmt.Sprintf("geoip-%s", v)
				if !ruleSetMap[tag] {
					ruleSetMap[tag] = true
					ruleSets = append(ruleSets, RuleSet{
						Tag:            tag,
						Type:           "remote",
						Format:         "binary",
						URL:            b.buildRuleSetURL(fmt.Sprintf("%s/../rule-set-geoip/geoip-%s.srs", b.settings.RuleSetBaseURL, v)),
						DownloadDetour: "DIRECT",
					})
				}
			}
		}
	}

	route.RuleSet = ruleSets

	// Build route rules
	var rules []RouteRule

	// 1. Add sniff action (detect traffic type, used with FakeIP)
	rules = append(rules, RouteRule{
		"action":  "sniff",
		"sniffer": []string{"dns", "http", "tls", "quic"},
		"timeout": "500ms",
	})

	// 2. DNS hijack using action (replaces deprecated dns-out)
	rules = append(rules, RouteRule{
		"protocol": "dns",
		"action":   "hijack-dns",
	})

	// 3. Add hosts domain route rules (high priority, before other rules)
	// Use override_address to directly specify target IP, avoiding DIRECT outbound re-resolving DNS
	// This fixes the NXDOMAIN issue caused by sniff_override_destination
	systemHosts := ParseSystemHosts()
	for domain, ips := range systemHosts {
		if len(ips) > 0 {
			rules = append(rules, RouteRule{
				"domain":           []string{domain},
				"outbound":         "DIRECT",
				"override_address": ips[0],
			})
		}
	}
	for _, host := range b.settings.Hosts {
		if host.Enabled && host.Domain != "" && len(host.IPs) > 0 {
			rules = append(rules, RouteRule{
				"domain":           []string{host.Domain},
				"outbound":         "DIRECT",
				"override_address": host.IPs[0],
			})
		}
	}

	// Sort custom rules by priority
	sortedRules := make([]storage.Rule, len(b.rules))
	copy(sortedRules, b.rules)
	sort.Slice(sortedRules, func(i, j int) bool {
		return sortedRules[i].Priority < sortedRules[j].Priority
	})

	// Add custom rules
	for _, rule := range sortedRules {
		if !rule.Enabled {
			continue
		}

		routeRule := RouteRule{
			"outbound": rule.Outbound,
		}

		switch rule.RuleType {
		case "domain_suffix":
			routeRule["domain_suffix"] = rule.Values
		case "domain_keyword":
			routeRule["domain_keyword"] = rule.Values
		case "domain":
			routeRule["domain"] = rule.Values
		case "ip_cidr":
			routeRule["ip_cidr"] = rule.Values
		case "port":
			// Convert port strings to integers
			var ports []uint16
			for _, v := range rule.Values {
				if port, err := strconv.ParseUint(v, 10, 16); err == nil {
					ports = append(ports, uint16(port))
				}
			}
			if len(ports) == 1 {
				routeRule["port"] = ports[0]
			} else if len(ports) > 1 {
				routeRule["port"] = ports
			}
		case "geosite":
			var tags []string
			for _, v := range rule.Values {
				tags = append(tags, fmt.Sprintf("geosite-%s", v))
			}
			routeRule["rule_set"] = tags
		case "geoip":
			var tags []string
			for _, v := range rule.Values {
				tags = append(tags, fmt.Sprintf("geoip-%s", v))
			}
			routeRule["rule_set"] = tags
		}

		rules = append(rules, routeRule)
	}

	// Add rule group route rules
	for _, rg := range orderedRuleGroups {
		if !rg.Enabled {
			continue
		}

		// Site rules
		if len(rg.SiteRules) > 0 {
			var tags []string
			for _, sr := range rg.SiteRules {
				tags = append(tags, fmt.Sprintf("geosite-%s", sr))
			}
			rules = append(rules, RouteRule{
				"rule_set": tags,
				"outbound": rg.Name,
			})
		}

		// IP rules
		if len(rg.IPRules) > 0 {
			var tags []string
			for _, ir := range rg.IPRules {
				tags = append(tags, fmt.Sprintf("geoip-%s", ir))
			}
			rules = append(rules, RouteRule{
				"rule_set": tags,
				"outbound": rg.Name,
			})
		}
	}

	route.Rules = rules

	return route
}

// buildExperimental builds experimental configuration
func (b *ConfigBuilder) buildExperimental() *ExperimentalConfig {
	// Determine listen address based on LAN access setting
	listenAddr := "127.0.0.1"
	if b.settings.AllowLAN {
		listenAddr = "0.0.0.0"
	}

	// Only set secret when LAN access is enabled
	secret := ""
	if b.settings.AllowLAN {
		secret = b.settings.ClashAPISecret
	}

	return &ExperimentalConfig{
		ClashAPI: &ClashAPIConfig{
			ExternalController:    fmt.Sprintf("%s:%d", listenAddr, b.settings.ClashAPIPort),
			ExternalUI:            b.settings.ClashUIPath,
			Secret:                secret,
			DefaultMode:           storage.NormalizeProxyMode(b.settings.ProxyMode),
		},
		CacheFile: &CacheFileConfig{
			Enabled:     true,
			Path:        "cache.db",
			StoreFakeIP: true, // Persist FakeIP mappings to avoid address changes after restart
		},
	}
}
