package api

import (
	"fmt"
	"time"

	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

// RunVerification performs a full verification cycle for all pending and verified nodes.
func (s *Server) RunVerification() {
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

	pendingNodes := s.store.GetNodes(storage.NodeStatusPending)
	verifiedNodes := s.store.GetNodes(storage.NodeStatusVerified)

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
	nodeMap := make(map[string]*storage.UnifiedNode) // server:port -> unified node

	for i := range pendingNodes {
		n := &pendingNodes[i]
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		nodeMap[key] = n
		allCheckNodes = append(allCheckNodes, n.ToNode())
	}
	for i := range verifiedNodes {
		n := &verifiedNodes[i]
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		nodeMap[key] = n
		allCheckNodes = append(allCheckNodes, n.ToNode())
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

	// 2. Site check via probe (mandatory sites)
	siteTargets := []string{"chatgpt.com", "youtube.com", "instagram.com", "2ip.ru"}
	siteResults, _, err := s.performSiteCheck(allCheckNodes, siteTargets)
	if err != nil {
		logger.Printf("[verifier] Site check failed (continuing with health only): %v", err)
		// Continue — don't fail entirely, just use health check results
	}

	configChanged := false

	// 3. Process pending nodes
	vlog.PendingChecked = len(pendingNodes)
	for i, pn := range pendingNodes {
		key := fmt.Sprintf("%s:%d", pn.Server, pn.ServerPort)

		alive := false
		if hr, ok := healthResults[key]; ok && hr.Alive {
			alive = true
		}

		sitesOk := true
		if siteResults != nil {
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
			s.eventBus.Publish("verify:node_promoted", map[string]interface{}{"tag": pn.Tag})
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
					"tag":      pn.Tag,
					"failures": failures,
				})
			}
		}

		s.eventBus.Publish("verify:progress", map[string]interface{}{
			"phase":   "pending",
			"current": i + 1,
			"total":   len(pendingNodes),
			"tag":     pn.Tag,
			"alive":   alive,
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
		if siteResults != nil {
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
			s.eventBus.Publish("verify:node_demoted", map[string]interface{}{"tag": vn.Tag})
		} else {
			// Reset failures counter
			s.store.ResetConsecutiveFailures(vn.ID)
		}

		s.eventBus.Publish("verify:progress", map[string]interface{}{
			"phase":   "verified",
			"current": i + 1,
			"total":   len(verifiedNodes),
			"tag":     vn.Tag,
			"alive":   alive,
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
