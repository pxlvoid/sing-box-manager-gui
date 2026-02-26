package service

import (
	"log"
	"sync"
	"time"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

// Scheduler scheduled task scheduler
type Scheduler struct {
	store      storage.Store
	subService *SubscriptionService
	onUpdate   func() error // Callback after subscription update
	onVerify   func()       // Callback to run verification cycle

	stopCh             chan struct{}
	running            bool
	interval           time.Duration
	verifyInterval     time.Duration
	verifyRunning      bool
	lastVerifyTime     *time.Time
	nextSubUpdateTime  *time.Time
	nextVerifyTime     *time.Time
	mu                 sync.Mutex
}

// NewScheduler creates a scheduler
func NewScheduler(store storage.Store, subService *SubscriptionService) *Scheduler {
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

// SetVerificationCallback sets the verification callback that runs periodically
func (s *Scheduler) SetVerificationCallback(callback func()) {
	s.onVerify = callback
}

// Start starts the scheduler
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return
	}

	settings := s.store.GetSettings()

	subEnabled := settings.SubscriptionInterval > 0
	verifyEnabled := settings.VerificationInterval > 0

	if !subEnabled && !verifyEnabled {
		log.Println("[Scheduler] All scheduled tasks disabled")
		return
	}

	s.running = true
	s.stopCh = make(chan struct{})

	if subEnabled {
		s.interval = time.Duration(settings.SubscriptionInterval) * time.Minute
		go s.runSubscriptionTicker()
		log.Printf("[Scheduler] Subscription updates started, interval: %v", s.interval)
	}

	if verifyEnabled && s.onVerify != nil {
		s.verifyInterval = time.Duration(settings.VerificationInterval) * time.Minute
		go s.runVerificationTicker()
		log.Printf("[Scheduler] Verification started, interval: %v", s.verifyInterval)
	}
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
	s.verifyRunning = false
	s.nextSubUpdateTime = nil
	s.nextVerifyTime = nil
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

// runSubscriptionTicker runs the subscription update ticker
func (s *Scheduler) runSubscriptionTicker() {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	s.mu.Lock()
	now := time.Now()
	next := now.Add(s.interval)
	s.nextSubUpdateTime = &next
	s.mu.Unlock()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.updateSubscriptions()
			s.mu.Lock()
			next := time.Now().Add(s.interval)
			s.nextSubUpdateTime = &next
			s.mu.Unlock()
		}
	}
}

// runVerificationTicker runs the verification ticker
func (s *Scheduler) runVerificationTicker() {
	ticker := time.NewTicker(s.verifyInterval)
	defer ticker.Stop()

	s.mu.Lock()
	s.verifyRunning = true
	now := time.Now()
	next := now.Add(s.verifyInterval)
	s.nextVerifyTime = &next
	s.mu.Unlock()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.runVerification()
			s.mu.Lock()
			next := time.Now().Add(s.verifyInterval)
			s.nextVerifyTime = &next
			s.mu.Unlock()
		}
	}
}

// runVerification executes a single verification cycle
func (s *Scheduler) runVerification() {
	log.Println("[Scheduler] Starting automatic verification...")

	if s.onVerify != nil {
		s.onVerify()
	}

	s.mu.Lock()
	now := time.Now()
	s.lastVerifyTime = &now
	s.mu.Unlock()

	log.Println("[Scheduler] Verification completed")
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

// GetNextUpdateTime gets the next subscription update time
func (s *Scheduler) GetNextUpdateTime() *time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextSubUpdateTime
}

// GetNextVerifyTime gets the next verification time
func (s *Scheduler) GetNextVerifyTime() *time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextVerifyTime
}

// GetLastVerifyTime gets the last verification time
func (s *Scheduler) GetLastVerifyTime() *time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastVerifyTime
}

// GetInterval gets the subscription update interval
func (s *Scheduler) GetInterval() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.interval
}

// GetVerifyInterval gets the verification interval
func (s *Scheduler) GetVerifyInterval() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.verifyInterval
}
