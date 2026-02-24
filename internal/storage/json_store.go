package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// JSONStore implements JSON file storage
type JSONStore struct {
	dataDir string
	mu      sync.RWMutex
	data    *AppData
}

// NewJSONStore creates a new JSON store
func NewJSONStore(dataDir string) (*JSONStore, error) {
	store := &JSONStore{
		dataDir: dataDir,
	}

	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data directory: %w", err)
	}

	// Ensure generated subdirectory exists
	generatedDir := filepath.Join(dataDir, "generated")
	if err := os.MkdirAll(generatedDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create generated directory: %w", err)
	}

	// Load data
	if err := store.load(); err != nil {
		return nil, err
	}

	return store, nil
}

// load loads data from file
func (s *JSONStore) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dataFile := filepath.Join(s.dataDir, "data.json")

	// If file does not exist, initialize with default data
	if _, err := os.Stat(dataFile); os.IsNotExist(err) {
		s.data = &AppData{
			Subscriptions: []Subscription{},
			ManualNodes:   []ManualNode{},
			Filters:       []Filter{},
			Rules:         []Rule{},
			RuleGroups:    DefaultRuleGroups(),
			Settings:      DefaultSettings(),
		}
		return s.saveInternal()
	}

	// Read file
	data, err := os.ReadFile(dataFile)
	if err != nil {
		return fmt.Errorf("failed to read data file: %w", err)
	}

	s.data = &AppData{}
	if err := json.Unmarshal(data, s.data); err != nil {
		return fmt.Errorf("failed to parse data file: %w", err)
	}

	// Ensure Settings is not empty
	if s.data.Settings == nil {
		s.data.Settings = DefaultSettings()
	}

	// Ensure RuleGroups is not empty
	if len(s.data.RuleGroups) == 0 {
		s.data.RuleGroups = DefaultRuleGroups()
	}

	// Migrate old path format (remove redundant data/ prefix)
	needSave := false
	if s.data.Settings.SingBoxPath == "data/bin/sing-box" {
		s.data.Settings.SingBoxPath = "bin/sing-box"
		needSave = true
	}
	if s.data.Settings.ConfigPath == "data/generated/config.json" {
		s.data.Settings.ConfigPath = "generated/config.json"
		needSave = true
	}
	if needSave {
		return s.saveInternal()
	}

	return nil
}

// saveInternal internal save method (without locking)
func (s *JSONStore) saveInternal() error {
	dataFile := filepath.Join(s.dataDir, "data.json")

	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize data: %w", err)
	}

	if err := os.WriteFile(dataFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write data file: %w", err)
	}

	return nil
}

// Save saves data to file
func (s *JSONStore) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveInternal()
}

// ==================== Subscription Operations ====================

// GetSubscriptions returns all subscriptions
func (s *JSONStore) GetSubscriptions() []Subscription {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Subscriptions
}

// GetSubscription returns a single subscription
func (s *JSONStore) GetSubscription(id string) *Subscription {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := range s.data.Subscriptions {
		if s.data.Subscriptions[i].ID == id {
			return &s.data.Subscriptions[i]
		}
	}
	return nil
}

// AddSubscription adds a subscription
func (s *JSONStore) AddSubscription(sub Subscription) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.Subscriptions = append(s.data.Subscriptions, sub)
	return s.saveInternal()
}

// UpdateSubscription updates a subscription
func (s *JSONStore) UpdateSubscription(sub Subscription) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Subscriptions {
		if s.data.Subscriptions[i].ID == sub.ID {
			s.data.Subscriptions[i] = sub
			return s.saveInternal()
		}
	}
	return fmt.Errorf("subscription not found: %s", sub.ID)
}

// DeleteSubscription deletes a subscription
func (s *JSONStore) DeleteSubscription(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Subscriptions {
		if s.data.Subscriptions[i].ID == id {
			s.data.Subscriptions = append(s.data.Subscriptions[:i], s.data.Subscriptions[i+1:]...)
			return s.saveInternal()
		}
	}
	return fmt.Errorf("subscription not found: %s", id)
}

// ==================== Filter Operations ====================

// GetFilters returns all filters
func (s *JSONStore) GetFilters() []Filter {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Filters
}

// GetFilter returns a single filter
func (s *JSONStore) GetFilter(id string) *Filter {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := range s.data.Filters {
		if s.data.Filters[i].ID == id {
			return &s.data.Filters[i]
		}
	}
	return nil
}

// AddFilter adds a filter
func (s *JSONStore) AddFilter(filter Filter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.Filters = append(s.data.Filters, filter)
	return s.saveInternal()
}

// UpdateFilter updates a filter
func (s *JSONStore) UpdateFilter(filter Filter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Filters {
		if s.data.Filters[i].ID == filter.ID {
			s.data.Filters[i] = filter
			return s.saveInternal()
		}
	}
	return fmt.Errorf("filter not found: %s", filter.ID)
}

// DeleteFilter deletes a filter
func (s *JSONStore) DeleteFilter(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Filters {
		if s.data.Filters[i].ID == id {
			s.data.Filters = append(s.data.Filters[:i], s.data.Filters[i+1:]...)
			return s.saveInternal()
		}
	}
	return fmt.Errorf("filter not found: %s", id)
}

// ==================== Rule Operations ====================

// GetRules returns all custom rules
func (s *JSONStore) GetRules() []Rule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Rules
}

// AddRule adds a rule
func (s *JSONStore) AddRule(rule Rule) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.Rules = append(s.data.Rules, rule)
	return s.saveInternal()
}

// UpdateRule updates a rule
func (s *JSONStore) UpdateRule(rule Rule) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Rules {
		if s.data.Rules[i].ID == rule.ID {
			s.data.Rules[i] = rule
			return s.saveInternal()
		}
	}
	return fmt.Errorf("rule not found: %s", rule.ID)
}

// DeleteRule deletes a rule
func (s *JSONStore) DeleteRule(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Rules {
		if s.data.Rules[i].ID == id {
			s.data.Rules = append(s.data.Rules[:i], s.data.Rules[i+1:]...)
			return s.saveInternal()
		}
	}
	return fmt.Errorf("rule not found: %s", id)
}

// ==================== Rule Group Operations ====================

// GetRuleGroups returns all preset rule groups
func (s *JSONStore) GetRuleGroups() []RuleGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.RuleGroups
}

// UpdateRuleGroup updates a rule group
func (s *JSONStore) UpdateRuleGroup(ruleGroup RuleGroup) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.RuleGroups {
		if s.data.RuleGroups[i].ID == ruleGroup.ID {
			s.data.RuleGroups[i] = ruleGroup
			return s.saveInternal()
		}
	}
	return fmt.Errorf("rule group not found: %s", ruleGroup.ID)
}

// ==================== Settings Operations ====================

// GetSettings returns settings
func (s *JSONStore) GetSettings() *Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Settings
}

// UpdateSettings updates settings
func (s *JSONStore) UpdateSettings(settings *Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.Settings = settings
	return s.saveInternal()
}

// ==================== Manual Node Operations ====================

// GetManualNodes returns all manual nodes
func (s *JSONStore) GetManualNodes() []ManualNode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.ManualNodes
}

// AddManualNode adds a manual node
func (s *JSONStore) AddManualNode(node ManualNode) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.ManualNodes = append(s.data.ManualNodes, node)
	return s.saveInternal()
}

// UpdateManualNode updates a manual node
func (s *JSONStore) UpdateManualNode(node ManualNode) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.ManualNodes {
		if s.data.ManualNodes[i].ID == node.ID {
			s.data.ManualNodes[i] = node
			return s.saveInternal()
		}
	}
	return fmt.Errorf("manual node not found: %s", node.ID)
}

// DeleteManualNode deletes a manual node
func (s *JSONStore) DeleteManualNode(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.ManualNodes {
		if s.data.ManualNodes[i].ID == id {
			s.data.ManualNodes = append(s.data.ManualNodes[:i], s.data.ManualNodes[i+1:]...)
			return s.saveInternal()
		}
	}
	return fmt.Errorf("manual node not found: %s", id)
}

// ==================== Helper Methods ====================

// GetAllNodes returns all enabled nodes (subscription nodes + manual nodes)
func (s *JSONStore) GetAllNodes() []Node {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var nodes []Node
	// Add subscription nodes
	for _, sub := range s.data.Subscriptions {
		if sub.Enabled {
			nodes = append(nodes, sub.Nodes...)
		}
	}
	// Add manual nodes
	for _, mn := range s.data.ManualNodes {
		if mn.Enabled {
			nodes = append(nodes, mn.Node)
		}
	}
	return nodes
}

// GetNodesByCountry returns nodes by country
func (s *JSONStore) GetNodesByCountry(countryCode string) []Node {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var nodes []Node
	// Subscription nodes
	for _, sub := range s.data.Subscriptions {
		if sub.Enabled {
			for _, node := range sub.Nodes {
				if node.Country == countryCode {
					nodes = append(nodes, node)
				}
			}
		}
	}
	// Manual nodes
	for _, mn := range s.data.ManualNodes {
		if mn.Enabled && mn.Node.Country == countryCode {
			nodes = append(nodes, mn.Node)
		}
	}
	return nodes
}

// GetCountryGroups returns all country node groups
func (s *JSONStore) GetCountryGroups() []CountryGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()

	countryCount := make(map[string]int)

	// Count subscription nodes
	for _, sub := range s.data.Subscriptions {
		if sub.Enabled {
			for _, node := range sub.Nodes {
				if node.Country != "" {
					countryCount[node.Country]++
				}
			}
		}
	}
	// Count manual nodes
	for _, mn := range s.data.ManualNodes {
		if mn.Enabled && mn.Node.Country != "" {
			countryCount[mn.Node.Country]++
		}
	}

	var groups []CountryGroup
	for code, count := range countryCount {
		groups = append(groups, CountryGroup{
			Code:      code,
			Name:      GetCountryName(code),
			Emoji:     GetCountryEmoji(code),
			NodeCount: count,
		})
	}

	return groups
}

// GetDataDir returns the data directory
func (s *JSONStore) GetDataDir() string {
	return s.dataDir
}
