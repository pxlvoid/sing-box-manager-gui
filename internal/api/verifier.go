package api

import (
	"fmt"
	"time"

	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

// RunVerification performs a full verification cycle for all pending and verified nodes.
func (s *Server) RunVerification() {
	s.runVerificationWithTagFilter(nil)
}

// RunVerificationForTags performs a verification cycle only for selected tags.
func (s *Server) RunVerificationForTags(tags []string) {
	tagSet := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		if tag == "" {
			continue
		}
		tagSet[tag] = struct{}{}
	}
	if len(tagSet) == 0 {
		return
	}
	s.runVerificationWithTagFilter(tagSet)
}

func (s *Server) runVerificationWithTagFilter(tagSet map[string]struct{}) {
	start := time.Now()
	settings := s.store.GetSettings()
	archiveThreshold := settings.ArchiveThreshold
	if archiveThreshold <= 0 {
		archiveThreshold = 10
	}

	vlog := storage.VerificationLog{
		Timestamp: time.Now(),
	}

	defer func() {
		vlog.DurationMs = time.Since(start).Milliseconds()
		if err := s.store.AddVerificationLog(vlog); err != nil {
			logger.Printf("[verifier] Failed to save log: %v", err)
		}
		logger.Printf("[verifier] Completed in %dms: pending checked=%d promoted=%d archived=%d | verified checked=%d demoted=%d",
			vlog.DurationMs, vlog.PendingChecked, vlog.PendingPromoted, vlog.PendingArchived,
			vlog.VerifiedChecked, vlog.VerifiedDemoted)

		s.eventBus.Publish("verify:complete", map[string]interface{}{
			"duration_ms": vlog.DurationMs,
			"promoted":    vlog.PendingPromoted,
			"demoted":     vlog.VerifiedDemoted,
			"archived":    vlog.PendingArchived,
			"timestamp":   time.Now().Format(time.RFC3339),
		})
	}()

	configChanged := false
	pendingNodes, verifiedNodes := s.collectVerificationNodes(tagSet)

	// Archive pending nodes that already exceeded threshold before any probe checks.
	pendingNodes = s.archiveThresholdExceededPendingNodes(pendingNodes, archiveThreshold, &vlog, &configChanged)

	if len(pendingNodes) == 0 && len(verifiedNodes) == 0 {
		return
	}

	s.eventBus.Publish("verify:start", map[string]interface{}{
		"pending_count":  len(pendingNodes),
		"verified_count": len(verifiedNodes),
		"timestamp":      time.Now().Format(time.RFC3339),
	})

	// Combine all nodes for health check
	var allCheckNodes []storage.Node
	tagToUnified := make(map[string]*storage.UnifiedNode) // tag -> unified node

	for i := range pendingNodes {
		n := &pendingNodes[i]
		tagToUnified[n.Tag] = n
		allCheckNodes = append(allCheckNodes, n.ToNode())
	}
	for i := range verifiedNodes {
		n := &verifiedNodes[i]
		tagToUnified[n.Tag] = n
		allCheckNodes = append(allCheckNodes, n.ToNode())
	}

	// 0. Pre-validate: run probe config validation to detect broken nodes
	//    and archive them immediately before health checks.
	s.archiveBrokenNodes(allCheckNodes, tagToUnified, &vlog, &configChanged)

	// Re-fetch nodes after archiving broken ones (they may have changed status)
	pendingNodes, verifiedNodes = s.collectVerificationNodes(tagSet)

	allCheckNodes = allCheckNodes[:0]

	for i := range pendingNodes {
		n := &pendingNodes[i]
		allCheckNodes = append(allCheckNodes, n.ToNode())
	}
	for i := range verifiedNodes {
		n := &verifiedNodes[i]
		allCheckNodes = append(allCheckNodes, n.ToNode())
	}

	if len(allCheckNodes) == 0 {
		return
	}

	// 1. Health check via probe
	s.eventBus.Publish("verify:health_start", map[string]interface{}{
		"total_nodes": len(allCheckNodes),
	})

	healthResults, _, err := s.performHealthCheck(allCheckNodes)
	if err != nil {
		vlog.Error = fmt.Sprintf("health check failed: %v", err)
		logger.Printf("[verifier] Health check failed: %v", err)
		return
	}

	// 2. Site check via probe (mandatory sites) only for alive nodes
	siteTargets := []string{"chatgpt.com", "youtube.com", "instagram.com", "2ip.ru"}
	aliveCheckNodes := make([]storage.Node, 0, len(allCheckNodes))
	for _, n := range allCheckNodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if hr, ok := healthResults[key]; ok && hr.Alive {
			aliveCheckNodes = append(aliveCheckNodes, n)
		}
	}

	s.eventBus.Publish("verify:site_start", map[string]interface{}{
		"total_nodes": len(aliveCheckNodes),
	})
	siteResults := make(map[string]*NodeSiteCheckResult)
	if len(aliveCheckNodes) > 0 {
		siteResults, _, err = s.performSiteCheck(aliveCheckNodes, siteTargets)
		if err != nil {
			logger.Printf("[verifier] Site check failed (continuing with health only): %v", err)
			siteResults = nil
			// Continue — don't fail entirely, just use health check results
		}
	}

	// 3. Process pending nodes
	vlog.PendingChecked = len(pendingNodes)
	for i, pn := range pendingNodes {
		key := fmt.Sprintf("%s:%d", pn.Server, pn.ServerPort)

		alive := false
		if hr, ok := healthResults[key]; ok && hr.Alive {
			alive = true
		}

		sitesOk := true
		if alive && siteResults != nil {
			if sr, ok := siteResults[key]; ok {
				for _, delay := range sr.Sites {
					if delay <= 0 {
						sitesOk = false
						break
					}
				}
			} else {
				sitesOk = false
			}
		}

		if alive && sitesOk {
			// Promote: pending -> verified
			if err := s.store.PromoteNode(pn.ID); err != nil {
				logger.Printf("[verifier] Failed to promote node %d: %v", pn.ID, err)
				continue
			}
			vlog.PendingPromoted++
			configChanged = true
			s.eventBus.Publish("verify:node_promoted", map[string]interface{}{
				"tag":         pn.Tag,
				"server":      pn.Server,
				"server_port": pn.ServerPort,
			})
		} else {
			// Increment failures
			failures, err := s.store.IncrementConsecutiveFailures(pn.ID)
			if err != nil {
				logger.Printf("[verifier] Failed to increment failures for %d: %v", pn.ID, err)
				continue
			}
			if failures >= archiveThreshold {
				if err := s.store.ArchiveNode(pn.ID); err != nil {
					logger.Printf("[verifier] Failed to archive node %d: %v", pn.ID, err)
					continue
				}
				vlog.PendingArchived++
				s.eventBus.Publish("verify:node_archived", map[string]interface{}{
					"tag":         pn.Tag,
					"server":      pn.Server,
					"server_port": pn.ServerPort,
					"failures":    failures,
				})
			}
		}

		s.eventBus.Publish("verify:progress", map[string]interface{}{
			"phase":    "pending",
			"current":  i + 1,
			"total":    len(pendingNodes),
			"tag":      pn.Tag,
			"alive":    alive,
			"sites_ok": sitesOk,
		})
	}

	// 4. Process verified nodes
	vlog.VerifiedChecked = len(verifiedNodes)
	for i, vn := range verifiedNodes {
		key := fmt.Sprintf("%s:%d", vn.Server, vn.ServerPort)

		alive := false
		if hr, ok := healthResults[key]; ok && hr.Alive {
			alive = true
		}

		sitesOk := true
		if alive && siteResults != nil {
			if sr, ok := siteResults[key]; ok {
				for _, delay := range sr.Sites {
					if delay <= 0 {
						sitesOk = false
						break
					}
				}
			} else {
				sitesOk = false
			}
		}

		if !alive || !sitesOk {
			// Demote: verified -> pending
			if err := s.store.DemoteNode(vn.ID); err != nil {
				logger.Printf("[verifier] Failed to demote node %d: %v", vn.ID, err)
				continue
			}
			vlog.VerifiedDemoted++
			configChanged = true
			s.eventBus.Publish("verify:node_demoted", map[string]interface{}{
				"tag":         vn.Tag,
				"server":      vn.Server,
				"server_port": vn.ServerPort,
			})
		} else {
			// Reset failures counter
			s.store.ResetConsecutiveFailures(vn.ID)
		}

		s.eventBus.Publish("verify:progress", map[string]interface{}{
			"phase":    "verified",
			"current":  i + 1,
			"total":    len(verifiedNodes),
			"tag":      vn.Tag,
			"alive":    alive,
			"sites_ok": sitesOk,
		})
	}

	// 5. If changes were made, auto-apply config
	if configChanged {
		if err := s.autoApplyConfig(); err != nil {
			logger.Printf("[verifier] Auto-apply failed: %v", err)
		} else {
			logger.Printf("[verifier] Config auto-applied")
		}
	}
}

func (s *Server) archiveThresholdExceededPendingNodes(
	pendingNodes []storage.UnifiedNode,
	archiveThreshold int,
	vlog *storage.VerificationLog,
	configChanged *bool,
) []storage.UnifiedNode {
	if archiveThreshold <= 0 || len(pendingNodes) == 0 {
		return pendingNodes
	}

	filtered := make([]storage.UnifiedNode, 0, len(pendingNodes))
	for _, pn := range pendingNodes {
		if pn.ConsecutiveFailures < archiveThreshold {
			filtered = append(filtered, pn)
			continue
		}

		if err := s.store.ArchiveNode(pn.ID); err != nil {
			logger.Printf("[verifier] Failed to archive threshold-exceeded node %d: %v", pn.ID, err)
			filtered = append(filtered, pn)
			continue
		}

		vlog.PendingArchived++
		*configChanged = true

		s.eventBus.Publish("verify:node_archived", map[string]interface{}{
			"tag":         pn.Tag,
			"server":      pn.Server,
			"server_port": pn.ServerPort,
			"failures":    pn.ConsecutiveFailures,
			"reason":      "threshold exceeded before check",
			"timestamp":   time.Now().Format(time.RFC3339),
		})
	}

	return filtered
}

func (s *Server) collectVerificationNodes(tagSet map[string]struct{}) ([]storage.UnifiedNode, []storage.UnifiedNode) {
	pendingNodes := s.store.GetNodes(storage.NodeStatusPending)
	verifiedNodes := s.store.GetNodes(storage.NodeStatusVerified)

	if len(tagSet) == 0 {
		return pendingNodes, verifiedNodes
	}

	filteredPending := make([]storage.UnifiedNode, 0, len(pendingNodes))
	for _, n := range pendingNodes {
		if _, ok := tagSet[n.Tag]; ok {
			filteredPending = append(filteredPending, n)
		}
	}

	filteredVerified := make([]storage.UnifiedNode, 0, len(verifiedNodes))
	for _, n := range verifiedNodes {
		if _, ok := tagSet[n.Tag]; ok {
			filteredVerified = append(filteredVerified, n)
		}
	}

	return filteredPending, filteredVerified
}

// archiveBrokenNodes runs a dry-run probe config validation to detect
// structurally invalid nodes (unsupported transport, broken config, etc.)
// and archives them immediately.
func (s *Server) archiveBrokenNodes(
	nodes []storage.Node,
	tagToUnified map[string]*storage.UnifiedNode,
	vlog *storage.VerificationLog,
	configChanged *bool,
) {
	// Deduplicate by server:port (same as performHealthCheck)
	seen := make(map[string]bool, len(nodes))
	var uniqueNodes []storage.Node
	for _, n := range nodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if !seen[key] {
			seen[key] = true
			uniqueNodes = append(uniqueNodes, n)
		}
	}

	// Run probe validation only (no actual start)
	_, _, brokenNodes, err := s.probeManager.EnsureRunning(uniqueNodes)
	if err != nil && len(brokenNodes) == 0 {
		// No broken nodes detected, just a general failure — skip
		logger.Printf("[verifier] Probe pre-validation failed: %v", err)
		return
	}

	if len(brokenNodes) == 0 {
		return
	}

	logger.Printf("[verifier] Found %d broken node(s) during probe validation", len(brokenNodes))

	for _, bn := range brokenNodes {
		un, ok := tagToUnified[bn.Tag]
		if !ok {
			// Try to find by server:port from the broken node
			continue
		}

		// Archive the broken node immediately
		if err := s.store.ArchiveNode(un.ID); err != nil {
			logger.Printf("[verifier] Failed to archive broken node %d (%s): %v", un.ID, bn.Tag, err)
			continue
		}

		vlog.PendingArchived++
		*configChanged = true

		s.eventBus.Publish("verify:node_archived", map[string]interface{}{
			"tag":         bn.Tag,
			"server":      un.Server,
			"server_port": un.ServerPort,
			"reason":      fmt.Sprintf("broken config: %s", bn.Error),
		})
		logger.Printf("[verifier] Archived broken node: %s — %s", bn.Tag, bn.Error)

		// Also record as unsupported node for visibility
		unsup := storage.UnsupportedNode{
			NodeTag:    bn.Tag,
			Error:      bn.Error,
			Server:     un.Server,
			ServerPort: un.ServerPort,
			DetectedAt: time.Now(),
		}
		if err := s.store.AddUnsupportedNode(unsup); err != nil {
			logger.Printf("[verifier] Failed to persist unsupported node %s: %v", bn.Tag, err)
		}
	}
}
