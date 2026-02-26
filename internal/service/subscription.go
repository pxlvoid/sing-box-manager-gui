package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/xiaobei/singbox-manager/internal/parser"
	"github.com/xiaobei/singbox-manager/internal/storage"
	"github.com/xiaobei/singbox-manager/pkg/utils"
)

// SubscriptionService handles subscription operations
type SubscriptionService struct {
	store storage.Store
}

// NewSubscriptionService creates a new subscription service
func NewSubscriptionService(store storage.Store) *SubscriptionService {
	return &SubscriptionService{
		store: store,
	}
}

// GetAll returns all subscriptions
func (s *SubscriptionService) GetAll() []storage.Subscription {
	return s.store.GetSubscriptions()
}

// Get returns a single subscription
func (s *SubscriptionService) Get(id string) *storage.Subscription {
	return s.store.GetSubscription(id)
}

// Add adds a subscription
func (s *SubscriptionService) Add(name, url string) (*storage.Subscription, error) {
	sub := storage.Subscription{
		ID:        uuid.New().String(),
		Name:      name,
		URL:       url,
		NodeCount: 0,
		UpdatedAt: time.Now(),
		Nodes:     []storage.Node{},
		Enabled:   true,
	}

	// Fetch and parse subscription
	if err := s.refresh(&sub); err != nil {
		return nil, fmt.Errorf("failed to fetch subscription: %w", err)
	}

	// Save subscription
	if err := s.store.AddSubscription(sub); err != nil {
		return nil, fmt.Errorf("failed to save subscription: %w", err)
	}

	// Sync nodes to unified nodes table as pending
	s.syncToUnifiedNodes(&sub)

	return &sub, nil
}

// Update updates a subscription
func (s *SubscriptionService) Update(sub storage.Subscription) error {
	return s.store.UpdateSubscription(sub)
}

// Delete deletes a subscription
func (s *SubscriptionService) Delete(id string) error {
	return s.store.DeleteSubscription(id)
}

// Refresh refreshes a subscription
func (s *SubscriptionService) Refresh(id string) error {
	sub := s.store.GetSubscription(id)
	if sub == nil {
		return fmt.Errorf("subscription not found: %s", id)
	}

	if err := s.refresh(sub); err != nil {
		return err
	}

	if err := s.store.UpdateSubscription(*sub); err != nil {
		return err
	}

	// Sync new nodes to unified nodes table as pending
	s.syncToUnifiedNodes(sub)

	return nil
}

// RefreshAll refreshes all subscriptions
func (s *SubscriptionService) RefreshAll() error {
	subs := s.store.GetSubscriptions()
	for _, sub := range subs {
		if sub.Enabled {
			if err := s.refresh(&sub); err != nil {
				// Log error but continue processing other subscriptions
				continue
			}
			if err := s.store.UpdateSubscription(sub); err != nil {
				continue
			}
			// Sync new nodes to unified nodes table as pending
			s.syncToUnifiedNodes(&sub)
		}
	}
	return nil
}

// syncToUnifiedNodes converts subscription nodes to unified nodes (pending) with deduplication.
func (s *SubscriptionService) syncToUnifiedNodes(sub *storage.Subscription) (int, error) {
	if len(sub.Nodes) == 0 {
		return 0, nil
	}

	var unified []storage.UnifiedNode
	for _, n := range sub.Nodes {
		unified = append(unified, storage.UnifiedNode{
			Tag:          n.Tag,
			Type:         n.Type,
			Server:       n.Server,
			ServerPort:   n.ServerPort,
			Country:      n.Country,
			CountryEmoji: n.CountryEmoji,
			Extra:        n.Extra,
			Status:       storage.NodeStatusPending,
			Source:       sub.ID,
		})
	}

	return s.store.AddNodesBulk(unified)
}

// refresh internal refresh method
func (s *SubscriptionService) refresh(sub *storage.Subscription) error {
	// Fetch subscription content
	content, info, err := utils.FetchSubscription(sub.URL)
	if err != nil {
		return fmt.Errorf("failed to fetch subscription: %w", err)
	}

	// Parse nodes
	nodes, err := parser.ParseSubscriptionContent(content)
	if err != nil {
		return fmt.Errorf("failed to parse subscription: %w", err)
	}

	// Update subscription info
	sub.Nodes = nodes
	sub.NodeCount = len(nodes)
	sub.UpdatedAt = time.Now()

	// Update traffic info
	if info != nil && info.Total > 0 {
		sub.Traffic = &storage.Traffic{
			Total:     info.Total,
			Used:      info.Upload + info.Download,
			Remaining: info.Total - info.Upload - info.Download,
		}
		sub.ExpireAt = info.Expire
	}

	return nil
}

// Toggle toggles subscription enabled state
func (s *SubscriptionService) Toggle(id string, enabled bool) error {
	sub := s.store.GetSubscription(id)
	if sub == nil {
		return fmt.Errorf("subscription not found: %s", id)
	}

	sub.Enabled = enabled
	return s.store.UpdateSubscription(*sub)
}
