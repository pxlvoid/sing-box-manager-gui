package storage

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

	// Manual Nodes
	GetManualNodes() []ManualNode
	AddManualNode(node ManualNode) error
	UpdateManualNode(node ManualNode) error
	DeleteManualNode(id string) error
	RemoveNodesByTags(tags []string) (int, error)
	FindManualNodeByServerPort(server string, port int) *ManualNode
	RenameGroupTag(oldTag, newTag string) (int, error)
	ClearGroupTag(tag string) (int, error)

	// Helpers
	GetAllNodes() []Node
	GetAllNodesIncludeDisabled() []Node
	GetNodesByCountry(countryCode string) []Node
	GetCountryGroups() []CountryGroup
	GetDataDir() string
	Save() error

	// Unsupported Nodes
	GetUnsupportedNodes() []UnsupportedNode
	AddUnsupportedNode(node UnsupportedNode) error
	ClearUnsupportedNodes() error
	DeleteUnsupportedNodesByTags(tags []string) error

	// Measurements
	AddHealthMeasurements(measurements []HealthMeasurement) error
	GetHealthMeasurements(server string, port int, limit int) ([]HealthMeasurement, error)
	GetHealthStats(server string, port int) (*HealthStats, error)
	AddSiteMeasurements(measurements []SiteMeasurement) error
	GetSiteMeasurements(server string, port int, limit int) ([]SiteMeasurement, error)

	// Lifecycle
	Close() error
}

// Compile-time interface checks
var _ Store = (*JSONStore)(nil)
