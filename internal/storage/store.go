package storage

import "time"

// Store defines the interface for all storage operations.
type Store interface {
	// Subscriptions
	GetSubscriptions() []Subscription
	GetSubscription(id string) *Subscription
	AddSubscription(sub Subscription) error
	UpdateSubscription(sub Subscription) error
	DeleteSubscription(id string) error

	// Filters
	GetFilters() []Filter
	GetFilter(id string) *Filter
	AddFilter(filter Filter) error
	UpdateFilter(filter Filter) error
	DeleteFilter(id string) error

	// Rules
	GetRules() []Rule
	AddRule(rule Rule) error
	UpdateRule(rule Rule) error
	DeleteRule(id string) error
	ReplaceRules(rules []Rule) error

	// Rule Groups
	GetRuleGroups() []RuleGroup
	UpdateRuleGroup(ruleGroup RuleGroup) error

	// Settings
	GetSettings() *Settings
	UpdateSettings(settings *Settings) error
	UpdateProxyMode(mode string) error

	// Unified Nodes
	GetNodes(status NodeStatus) []UnifiedNode
	GetNodeByID(id int64) *UnifiedNode
	GetNodeByServerPort(server string, port int) *UnifiedNode
	GetNodesBySource(source string) []UnifiedNode
	AddNode(node UnifiedNode) (int64, error)
	AddNodesBulk(nodes []UnifiedNode) (int, error)
	UpdateNode(node UnifiedNode) error
	DeleteNode(id int64) error
	PromoteNode(id int64) error
	DemoteNode(id int64) error
	ArchiveNode(id int64) error
	UnarchiveNode(id int64) error
	IncrementConsecutiveFailures(id int64) (int, error)
	ResetConsecutiveFailures(id int64) error
	GetNodeCounts() NodeCounts

	// Verification Logs
	AddVerificationLog(log VerificationLog) error
	GetVerificationLogs(limit int) []VerificationLog
	AddPipelineActivityLog(log PipelineActivityLog) error
	GetPipelineActivityLogs(limit int) []PipelineActivityLog

	// Helpers
	GetAllNodes() []Node
	GetAllNodesIncludeDisabled() []Node
	GetNodesByCountry(countryCode string) []Node
	GetCountryGroups() []CountryGroup
	GetDataDir() string
	Save() error
	RemoveNodesByTags(tags []string) (int, error)

	// Unsupported Nodes
	GetUnsupportedNodes() []UnsupportedNode
	AddUnsupportedNode(node UnsupportedNode) error
	ClearUnsupportedNodes() error
	DeleteUnsupportedNodesByTags(tags []string) error

	// Measurements
	AddHealthMeasurements(measurements []HealthMeasurement) error
	GetHealthMeasurements(server string, port int, limit int) ([]HealthMeasurement, error)
	GetHealthStats(server string, port int) (*HealthStats, error)
	GetBulkHealthStats(days int) ([]NodeStabilityStats, error)
	GetLatestHealthMeasurements() ([]HealthMeasurement, error)
	AddSiteMeasurements(measurements []SiteMeasurement) error
	GetSiteMeasurements(server string, port int, limit int) ([]SiteMeasurement, error)
	GetLatestSiteMeasurements() ([]SiteMeasurement, error)

	// GeoIP Data
	UpsertGeoData(data GeoData) error
	UpsertGeoDataBulk(data []GeoData) error
	GetGeoData(server string, port int) (*GeoData, error)
	GetAllGeoData() ([]GeoData, error)
	GetStaleGeoNodes(maxAge time.Duration) ([]GeoData, error)
	GetGeoDataBulk(keys []string) (map[string]*GeoData, error)
	UpdateNodeCountry(server string, port int, countryCode, countryEmoji string) error

	// Lifecycle
	Close() error
}

// Compile-time interface checks
var _ Store = (*SQLiteStore)(nil)
