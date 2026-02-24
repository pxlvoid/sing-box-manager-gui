package storage

import "time"

// Subscription represents a proxy subscription
type Subscription struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	URL       string     `json:"url"`
	NodeCount int        `json:"node_count"`
	UpdatedAt time.Time  `json:"updated_at"`
	ExpireAt  *time.Time `json:"expire_at,omitempty"`
	Traffic   *Traffic   `json:"traffic,omitempty"`
	Nodes     []Node     `json:"nodes"`
	Enabled   bool       `json:"enabled"`
}

// Traffic represents traffic information
type Traffic struct {
	Total     int64 `json:"total"`     // total traffic (bytes)
	Used      int64 `json:"used"`      // used traffic
	Remaining int64 `json:"remaining"` // remaining traffic
}

// Node represents a proxy node
type Node struct {
	Tag          string                 `json:"tag"`
	Type         string                 `json:"type"`                    // shadowsocks/vmess/vless/trojan/hysteria2/tuic
	Server       string                 `json:"server"`
	ServerPort   int                    `json:"server_port"`
	Extra        map[string]interface{} `json:"extra,omitempty"`         // protocol-specific fields
	Country      string                 `json:"country,omitempty"`       // country code
	CountryEmoji string                 `json:"country_emoji,omitempty"` // country emoji
}

// ManualNode represents a manually added node
type ManualNode struct {
	ID      string `json:"id"`
	Node    Node   `json:"node"`
	Enabled bool   `json:"enabled"`
}

// CountryGroup represents a country-based node group
type CountryGroup struct {
	Code      string `json:"code"`       // country code (e.g. HK, US, JP)
	Name      string `json:"name"`       // country name (e.g. Hong Kong, United States, Japan)
	Emoji     string `json:"emoji"`      // country flag emoji
	NodeCount int    `json:"node_count"` // node count
}

// Filter represents a node filter
type Filter struct {
	ID               string         `json:"id"`
	Name             string         `json:"name"`
	Include          []string       `json:"include"`           // include keywords
	Exclude          []string       `json:"exclude"`           // exclude keywords
	IncludeCountries []string       `json:"include_countries"` // included country codes
	ExcludeCountries []string       `json:"exclude_countries"` // excluded country codes
	Mode             string         `json:"mode"`              // urltest / select
	URLTestConfig    *URLTestConfig `json:"urltest_config,omitempty"`
	Subscriptions    []string       `json:"subscriptions"` // applicable subscription IDs, empty means all
	AllNodes         bool           `json:"all_nodes"`     // whether to apply to all nodes
	Enabled          bool           `json:"enabled"`
}

// URLTestConfig represents urltest mode configuration
type URLTestConfig struct {
	URL       string `json:"url"`
	Interval  string `json:"interval"`
	Tolerance int    `json:"tolerance"`
}

// Rule represents a custom rule
type Rule struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	RuleType string   `json:"rule_type"` // domain_suffix/domain_keyword/ip_cidr/geosite/geoip/port
	Values   []string `json:"values"`    // rule value list
	Outbound string   `json:"outbound"`  // target outbound
	Enabled  bool     `json:"enabled"`
	Priority int      `json:"priority"`  // priority (lower value = higher priority)
}

// RuleGroup represents a preset rule group
type RuleGroup struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	SiteRules []string `json:"site_rules"` // geosite rules
	IPRules   []string `json:"ip_rules"`   // geoip rules
	Outbound  string   `json:"outbound"`
	Enabled   bool     `json:"enabled"`
}

// HostEntry represents a DNS hosts mapping entry
type HostEntry struct {
	ID      string   `json:"id"`
	Domain  string   `json:"domain"` // domain name
	IPs     []string `json:"ips"`    // IP address list
	Enabled bool     `json:"enabled"`
}

// Settings represents global settings
type Settings struct {
	// sing-box paths
	SingBoxPath string `json:"singbox_path"`
	ConfigPath  string `json:"config_path"`

	// inbound configuration
	MixedPort  int  `json:"mixed_port"`  // HTTP/SOCKS5 mixed port
	TunEnabled bool `json:"tun_enabled"` // TUN mode
	AllowLAN   bool `json:"allow_lan"`   // allow LAN access

	// DNS configuration
	ProxyDNS  string      `json:"proxy_dns"`        // proxy DNS
	DirectDNS string      `json:"direct_dns"`       // direct DNS
	Hosts     []HostEntry `json:"hosts,omitempty"`  // DNS hosts mapping

	// control panel
	WebPort        int    `json:"web_port"`          // management UI port
	ClashAPIPort   int    `json:"clash_api_port"`    // Clash API port
	ClashUIPath    string `json:"clash_ui_path"`     // Clash external UI path
	ClashAPISecret string `json:"clash_api_secret"`  // Clash API secret

	// final rule
	FinalOutbound string `json:"final_outbound"` // default outbound

	// rule set source
	RuleSetBaseURL string `json:"ruleset_base_url"` // rule set download URL

	// automation settings
	AutoApply            bool `json:"auto_apply"`            // auto-apply after config changes
	SubscriptionInterval int  `json:"subscription_interval"` // subscription auto-update interval (minutes), 0 to disable

	// GitHub proxy settings
	GithubProxy string `json:"github_proxy"` // GitHub proxy URL, e.g. https://ghproxy.com/
}

// DefaultSettings returns default settings
func DefaultSettings() *Settings {
	return &Settings{
		SingBoxPath:          "bin/sing-box",
		ConfigPath:           "generated/config.json",
		MixedPort:            2080,
		TunEnabled:           true,
		AllowLAN:             false, // LAN access disabled by default
		ProxyDNS:             "https://1.1.1.1/dns-query",
		DirectDNS:            "https://dns.alidns.com/dns-query",
		WebPort:              9090,
		ClashAPIPort:         9091,
		ClashUIPath:          "",
		ClashAPISecret:       "", // empty by default, auto-generated when LAN is enabled
		FinalOutbound:        "Proxy",
		RuleSetBaseURL:       "https://github.com/lyc8503/sing-box-rules/raw/rule-set-geosite",
		AutoApply:            true, // auto-apply enabled by default
		SubscriptionInterval: 60,   // default 60 minutes update interval
		GithubProxy:          "",   // no proxy by default
	}
}

// AppData represents application data
type AppData struct {
	Subscriptions []Subscription `json:"subscriptions"`
	ManualNodes   []ManualNode   `json:"manual_nodes"`
	Filters       []Filter       `json:"filters"`
	Rules         []Rule         `json:"rules"`
	RuleGroups    []RuleGroup    `json:"rule_groups"`
	Settings      *Settings      `json:"settings"`
}

// DefaultRuleGroups returns default rule groups
func DefaultRuleGroups() []RuleGroup {
	return []RuleGroup{
		{ID: "ad-block", Name: "Ad Block", SiteRules: []string{"category-ads-all"}, Outbound: "REJECT", Enabled: true},
		{ID: "ai-services", Name: "AI Services", SiteRules: []string{"openai", "anthropic", "jetbrains-ai"}, Outbound: "Proxy", Enabled: true},
		{ID: "google", Name: "Google", SiteRules: []string{"google"}, IPRules: []string{"google"}, Outbound: "Proxy", Enabled: true},
		{ID: "youtube", Name: "YouTube", SiteRules: []string{"youtube"}, Outbound: "Proxy", Enabled: true},
		{ID: "github", Name: "GitHub", SiteRules: []string{"github"}, Outbound: "Proxy", Enabled: true},
		{ID: "telegram", Name: "Telegram", SiteRules: []string{"telegram"}, IPRules: []string{"telegram"}, Outbound: "Proxy", Enabled: true},
		{ID: "twitter", Name: "Twitter/X", SiteRules: []string{"twitter"}, Outbound: "Proxy", Enabled: true},
		{ID: "netflix", Name: "Netflix", SiteRules: []string{"netflix"}, Outbound: "Proxy", Enabled: false},
		{ID: "spotify", Name: "Spotify", SiteRules: []string{"spotify"}, Outbound: "Proxy", Enabled: false},
		{ID: "apple", Name: "Apple", SiteRules: []string{"apple"}, Outbound: "DIRECT", Enabled: true},
		{ID: "microsoft", Name: "Microsoft", SiteRules: []string{"microsoft"}, Outbound: "DIRECT", Enabled: true},
		{ID: "cn", Name: "China", SiteRules: []string{"geolocation-cn"}, IPRules: []string{"cn"}, Outbound: "DIRECT", Enabled: true},
		{ID: "private", Name: "Private Network", SiteRules: []string{"private"}, IPRules: []string{"private"}, Outbound: "DIRECT", Enabled: true},
	}
}

// CountryNames maps country codes to English names
var CountryNames = map[string]string{
	"HK": "Hong Kong",
	"TW": "Taiwan",
	"JP": "Japan",
	"KR": "South Korea",
	"SG": "Singapore",
	"US": "United States",
	"GB": "United Kingdom",
	"DE": "Germany",
	"FR": "France",
	"NL": "Netherlands",
	"AU": "Australia",
	"CA": "Canada",
	"RU": "Russia",
	"IN": "India",
	"BR": "Brazil",
	"AR": "Argentina",
	"TR": "Turkey",
	"TH": "Thailand",
	"VN": "Vietnam",
	"MY": "Malaysia",
	"PH": "Philippines",
	"ID": "Indonesia",
	"AE": "UAE",
	"ZA": "South Africa",
	"CH": "Switzerland",
	"IT": "Italy",
	"ES": "Spain",
	"SE": "Sweden",
	"NO": "Norway",
	"FI": "Finland",
	"DK": "Denmark",
	"PL": "Poland",
	"CZ": "Czech Republic",
	"AT": "Austria",
	"IE": "Ireland",
	"PT": "Portugal",
	"GR": "Greece",
	"IL": "Israel",
	"MX": "Mexico",
	"CL": "Chile",
	"CO": "Colombia",
	"PE": "Peru",
	"NZ":    "New Zealand",
	"OTHER": "Other",
}

// CountryEmojis maps country codes to flag emojis
var CountryEmojis = map[string]string{
	"HK": "🇭🇰",
	"TW": "🇹🇼",
	"JP": "🇯🇵",
	"KR": "🇰🇷",
	"SG": "🇸🇬",
	"US": "🇺🇸",
	"GB": "🇬🇧",
	"DE": "🇩🇪",
	"FR": "🇫🇷",
	"NL": "🇳🇱",
	"AU": "🇦🇺",
	"CA": "🇨🇦",
	"RU": "🇷🇺",
	"IN": "🇮🇳",
	"BR": "🇧🇷",
	"AR": "🇦🇷",
	"TR": "🇹🇷",
	"TH": "🇹🇭",
	"VN": "🇻🇳",
	"MY": "🇲🇾",
	"PH": "🇵🇭",
	"ID": "🇮🇩",
	"AE": "🇦🇪",
	"ZA": "🇿🇦",
	"CH": "🇨🇭",
	"IT": "🇮🇹",
	"ES": "🇪🇸",
	"SE": "🇸🇪",
	"NO": "🇳🇴",
	"FI": "🇫🇮",
	"DK": "🇩🇰",
	"PL": "🇵🇱",
	"CZ": "🇨🇿",
	"AT": "🇦🇹",
	"IE": "🇮🇪",
	"PT": "🇵🇹",
	"GR": "🇬🇷",
	"IL": "🇮🇱",
	"MX": "🇲🇽",
	"CL": "🇨🇱",
	"CO": "🇨🇴",
	"PE": "🇵🇪",
	"NZ":    "🇳🇿",
	"OTHER": "🌐",
}

// GetCountryName returns the country name for the given code
func GetCountryName(code string) string {
	if name, ok := CountryNames[code]; ok {
		return name
	}
	return code
}

// GetCountryEmoji returns the flag emoji for the given country code
func GetCountryEmoji(code string) string {
	if emoji, ok := CountryEmojis[code]; ok {
		return emoji
	}
	return "🌐"
}
