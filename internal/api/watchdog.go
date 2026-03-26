package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"strings"
	"time"

	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

const (
	watchdogInterval          = 45 * time.Second
	watchdogFailThreshold     = 2
	watchdogCooldownDuration  = 45 * time.Minute
	watchdogProbeTimeoutMs    = 5000
	watchdogProbeAttempts     = 3
	autoProxyPipelineInterval = 1 * time.Minute
)

var watchdogTargets = []string{
	"https://www.gstatic.com/generate_204",
	"https://cp.cloudflare.com/generate_204",
	"https://www.msftconnecttest.com/connecttest.txt",
	"https://www.apple.com/library/test/success.html",
}

func watchdogSuccessQuorum() int {
	if len(watchdogTargets) == 0 {
		return 0
	}
	return len(watchdogTargets)/2 + 1
}

type clashProxySnapshot struct {
	Type string   `json:"type"`
	Now  string   `json:"now"`
	All  []string `json:"all"`
}

func (s *Server) startActiveProxyWatchdog() {
	go func() {
		ticker := time.NewTicker(watchdogInterval)
		defer ticker.Stop()

		for range ticker.C {
			s.runActiveProxyWatchdog()
		}
	}()

	go func() {
		ticker := time.NewTicker(autoProxyPipelineInterval)
		defer ticker.Stop()

		for range ticker.C {
			s.runAutoProxyPipelineTick()
		}
	}()
}

func (s *Server) runActiveProxyWatchdog() {
	if !s.processManager.IsRunning() {
		return
	}

	settings := s.store.GetSettings()
	if settings == nil || settings.ClashAPIPort == 0 {
		return
	}
	if storage.NormalizeProxyMode(settings.ProxyMode) == storage.ProxyModeDirect {
		return
	}

	proxies, err := s.fetchClashProxiesSnapshot()
	if err != nil {
		return
	}
	root, ok := proxies["Proxy"]
	if !ok || strings.TrimSpace(root.Now) == "" {
		return
	}

	activeLeaf := resolveProxyLeaf(proxies, root.Now)
	if strings.TrimSpace(activeLeaf) == "" {
		return
	}

	allTargetsOK := true
	successfulTargets := 0
	failReasons := make(map[string]string)
	for _, target := range watchdogTargets {
		delay, errType := s.probeDelayMedianWithRetries(
			settings.ClashAPIPort,
			settings.ClashAPISecret,
			activeLeaf,
			target,
			watchdogProbeTimeoutMs,
			watchdogProbeAttempts,
		)
		if delay <= 0 {
			allTargetsOK = false
			failReasons[target] = errType
			continue
		}
		successfulTargets++
	}

	if allTargetsOK || successfulTargets >= watchdogSuccessQuorum() {
		s.resetWatchdogFailure(activeLeaf)
		return
	}

	streak := s.bumpWatchdogFailure(activeLeaf)
	logger.Printf("[watchdog] active proxy %s failed (%d/%d), successful_targets=%d/%d, reasons=%v", activeLeaf, streak, watchdogFailThreshold, successfulTargets, len(watchdogTargets), failReasons)
	if streak < watchdogFailThreshold {
		return
	}

	s.setWatchdogCooldown(activeLeaf, time.Now().Add(watchdogCooldownDuration))
	s.resetWatchdogFailure(activeLeaf)

	candidate, successCount, score, err := s.pickWatchdogFailoverCandidate(settings.ClashAPIPort, settings.ClashAPISecret, proxies, activeLeaf)
	if err != nil {
		logger.Printf("[watchdog] failover candidate selection failed: %v", err)
		return
	}

	if candidate == "" {
		if !strings.EqualFold(root.Now, "Auto") {
			if err := s.switchClashProxyGroup("Proxy", "Auto"); err != nil {
				logger.Printf("[watchdog] fallback switch to Auto failed: %v", err)
			} else {
				logger.Printf("[watchdog] fallback switched Proxy -> Auto")
			}
		}
		return
	}

	if err := s.switchClashProxyGroup("Proxy", candidate); err != nil {
		logger.Printf("[watchdog] failover switch failed %s -> %s: %v", activeLeaf, candidate, err)
		return
	}

	logger.Printf("[watchdog] failover switched Proxy %s -> %s (success=%d/%d, score=%d)", activeLeaf, candidate, successCount, len(watchdogTargets), score)
	if s.eventBus != nil {
		s.eventBus.PublishTimestamped("watchdog:failover", map[string]interface{}{
			"from":          activeLeaf,
			"to":            candidate,
			"score":         score,
			"success_count": successCount,
			"target_count":  len(watchdogTargets),
			"reason":        failReasons,
		})
	}
}

func (s *Server) runAutoProxyPipelineTick() {
	if !s.processManager.IsRunning() {
		return
	}

	settings := s.store.GetSettings()
	if settings == nil || settings.ClashAPIPort == 0 {
		return
	}
	if storage.NormalizeProxyMode(settings.ProxyMode) == storage.ProxyModeDirect {
		return
	}

	proxies, err := s.fetchClashProxiesSnapshot()
	if err != nil {
		return
	}
	root, ok := proxies["Proxy"]
	if !ok || strings.TrimSpace(root.Now) == "" {
		return
	}
	if !isAutoProxySelection(proxies, root) {
		return
	}

	activeLeaf := strings.TrimSpace(resolveProxyLeaf(proxies, root.Now))
	if activeLeaf == "" || strings.EqualFold(activeLeaf, "DIRECT") || strings.EqualFold(activeLeaf, "REJECT") {
		return
	}
	if p, ok := proxies[activeLeaf]; ok && isProxyGroupType(p.Type) {
		return
	}

	logger.Printf("[watchdog] auto-proxy pipeline tick: verifying %s", activeLeaf)
	s.RunVerificationForTags([]string{activeLeaf})
}

func (s *Server) fetchClashProxiesSnapshot() (map[string]clashProxySnapshot, error) {
	resp, err := s.clashAPIRequest("GET", "/proxies", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var payload struct {
		Proxies map[string]clashProxySnapshot `json:"proxies"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	return payload.Proxies, nil
}

func resolveProxyLeaf(proxies map[string]clashProxySnapshot, start string) string {
	current := strings.TrimSpace(start)
	seen := make(map[string]bool)

	for current != "" && !seen[current] {
		seen[current] = true
		entry, ok := proxies[current]
		if !ok || strings.TrimSpace(entry.Now) == "" || entry.Now == current {
			return current
		}
		current = strings.TrimSpace(entry.Now)
	}
	return current
}

func isAutoProxySelection(proxies map[string]clashProxySnapshot, root clashProxySnapshot) bool {
	selected := strings.TrimSpace(root.Now)
	if selected == "" {
		return false
	}
	if strings.EqualFold(selected, "Auto") {
		return true
	}
	selectedProxy, ok := proxies[selected]
	if !ok {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(selectedProxy.Type), "urltest")
}

func isProxyGroupType(proxyType string) bool {
	switch strings.ToLower(strings.TrimSpace(proxyType)) {
	case "selector", "urltest", "fallback", "loadbalance", "load-balance", "relay":
		return true
	default:
		return false
	}
}

func (s *Server) pickWatchdogFailoverCandidate(port int, secret string, proxies map[string]clashProxySnapshot, activeLeaf string) (string, int, int, error) {
	root, ok := proxies["Proxy"]
	if !ok {
		return "", 0, 0, nil
	}

	bestCandidate := ""
	bestSuccessCount := -1
	bestScore := int(^uint(0) >> 1)
	quorum := watchdogSuccessQuorum()

	for _, name := range root.All {
		candidate := strings.TrimSpace(name)
		if candidate == "" || candidate == activeLeaf {
			continue
		}
		if strings.EqualFold(candidate, "DIRECT") || strings.EqualFold(candidate, "REJECT") {
			continue
		}
		if s.isWatchdogCooldownActive(candidate) {
			continue
		}
		if p, ok := proxies[candidate]; ok && isProxyGroupType(p.Type) {
			continue
		}

		score := 0
		successCount := 0
		for _, target := range watchdogTargets {
			delay, _ := s.probeDelayMedianWithRetries(
				port,
				secret,
				candidate,
				target,
				watchdogProbeTimeoutMs,
				watchdogProbeAttempts,
			)
			if delay <= 0 {
				continue
			}
			successCount++
			score += delay
		}
		if successCount < quorum {
			continue
		}
		if successCount > bestSuccessCount || (successCount == bestSuccessCount && score < bestScore) {
			bestSuccessCount = successCount
			bestScore = score
			bestCandidate = candidate
		}
	}

	if bestCandidate == "" {
		return "", 0, 0, nil
	}
	return bestCandidate, bestSuccessCount, bestScore, nil
}

func (s *Server) switchClashProxyGroup(groupName, targetName string) error {
	payload, _ := json.Marshal(map[string]string{"name": targetName})
	path := fmt.Sprintf("/proxies/%s", neturl.PathEscape(groupName))
	resp, err := s.clashAPIRequest("PUT", path, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("clash api switch failed: %s", strings.TrimSpace(string(body)))
	}
	return nil
}

func (s *Server) bumpWatchdogFailure(tag string) int {
	s.watchdogMu.Lock()
	defer s.watchdogMu.Unlock()
	s.watchdogFailStreak[tag]++
	return s.watchdogFailStreak[tag]
}

func (s *Server) resetWatchdogFailure(tag string) {
	s.watchdogMu.Lock()
	defer s.watchdogMu.Unlock()
	delete(s.watchdogFailStreak, tag)
}

func (s *Server) setWatchdogCooldown(tag string, until time.Time) {
	s.watchdogMu.Lock()
	defer s.watchdogMu.Unlock()
	s.watchdogCooldownTill[tag] = until
}

func (s *Server) isWatchdogCooldownActive(tag string) bool {
	s.watchdogMu.Lock()
	defer s.watchdogMu.Unlock()

	until, ok := s.watchdogCooldownTill[tag]
	if !ok {
		return false
	}
	if time.Now().After(until) {
		delete(s.watchdogCooldownTill, tag)
		return false
	}
	return true
}
