package service

import (
	"log"
	"sync"
	"time"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// Scheduler scheduled task scheduler
type Scheduler struct {
	store      *storage.JSONStore
	subService *SubscriptionService
	onUpdate   func() error // Callback after subscription update

	stopCh   chan struct{}
	running  bool
	interval time.Duration
	mu       sync.Mutex
}

// NewScheduler creates a scheduler
func NewScheduler(store *storage.JSONStore, subService *SubscriptionService) *Scheduler {
	return &Scheduler{
		store:      store,
		subService: subService,
		stopCh:     make(chan struct{}),
	}
}

// SetUpdateCallback sets the update callback
func (s *Scheduler) SetUpdateCallback(callback func() error) {
	s.onUpdate = callback
}

// Start starts the scheduler
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return
	}

	settings := s.store.GetSettings()
	if settings.SubscriptionInterval <= 0 {
		log.Println("[Scheduler] Scheduled updates disabled")
		return
	}

	s.interval = time.Duration(settings.SubscriptionInterval) * time.Minute
	s.running = true
	s.stopCh = make(chan struct{})

	go s.run()
	log.Printf("[Scheduler] Started, update interval: %v\n", s.interval)
}

// Stop stops the scheduler
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}

	close(s.stopCh)
	s.running = false
	log.Println("[Scheduler] Stopped")
}

// Restart restarts the scheduler (call after updating config)
func (s *Scheduler) Restart() {
	s.Stop()
	s.Start()
}

// IsRunning checks if the scheduler is running
func (s *Scheduler) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// run runs the scheduled task
func (s *Scheduler) run() {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.updateSubscriptions()
		}
	}
}

// updateSubscriptions updates all subscriptions
func (s *Scheduler) updateSubscriptions() {
	log.Println("[Scheduler] Starting automatic subscription update...")

	if err := s.subService.RefreshAll(); err != nil {
		log.Printf("[Scheduler] Failed to update subscription: %v\n", err)
		return
	}

	log.Println("[Scheduler] Subscription update completed")

	// Call update callback (auto-apply config)
	if s.onUpdate != nil {
		if err := s.onUpdate(); err != nil {
			log.Printf("[Scheduler] Failed to auto-apply config: %v\n", err)
		} else {
			log.Println("[Scheduler] Config auto-applied")
		}
	}
}

// GetNextUpdateTime gets the next update time
func (s *Scheduler) GetNextUpdateTime() *time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return nil
	}

	next := time.Now().Add(s.interval)
	return &next
}

// GetInterval gets the update interval
func (s *Scheduler) GetInterval() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.interval
}
