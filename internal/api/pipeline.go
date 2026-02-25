package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

// RunAllPipelines runs pipeline for all enabled subscriptions with auto_pipeline=true.
// Auto-apply is deferred until all pipelines complete to avoid redundant restarts.
// Returns true if config was applied (so the caller can skip its own apply).
func (s *Server) RunAllPipelines() bool {
	subs := s.store.GetSubscriptions()
	anyChanged := false
	for _, sub := range subs {
		if !sub.AutoPipeline || !sub.Enabled {
			continue
		}
		result := s.runPipelineInternal(sub, true)
		if result.Error != "" {
			logger.Printf("[pipeline] %s: error: %s", sub.Name, result.Error)
		} else {
			logger.Printf("[pipeline] %s: checked=%d alive=%d copied=%d removed=%d (%dms)",
				sub.Name, result.CheckedNodes, result.AliveNodes, result.CopiedNodes, result.RemovedStale, result.DurationMs)
			if result.CopiedNodes > 0 || result.RemovedStale > 0 {
				anyChanged = true
			}
		}
	}

	if anyChanged {
		if err := s.autoApplyConfig(); err != nil {
			logger.Printf("[pipeline] Auto-apply after all pipelines failed: %v", err)
		}
		return true
	}
	return false
}

// RunPipeline executes the full pipeline for a subscription (with auto-apply).
func (s *Server) RunPipeline(sub storage.Subscription) *storage.PipelineResult {
	return s.runPipelineInternal(sub, false)
}

// runPipelineInternal executes the pipeline. If skipAutoApply is true, the caller is responsible for applying config.
func (s *Server) runPipelineInternal(sub storage.Subscription, skipAutoApply bool) *storage.PipelineResult {
	start := time.Now()
	result := &storage.PipelineResult{
		TotalNodes: len(sub.Nodes),
	}

	defer func() {
		result.DurationMs = time.Since(start).Milliseconds()

		// Save pipeline log
		log := storage.PipelineLog{
			SubscriptionID: sub.ID,
			Timestamp:      time.Now(),
			PipelineResult: *result,
		}
		if err := s.store.AddPipelineLog(log); err != nil {
			logger.Printf("[pipeline] Failed to save log: %v", err)
		}

		// Update subscription last run + result
		now := time.Now()
		sub.PipelineLastRun = &now
		sub.PipelineLastResult = result
		if err := s.store.UpdateSubscription(sub); err != nil {
			logger.Printf("[pipeline] Failed to update subscription: %v", err)
		}
	}()

	if len(sub.Nodes) == 0 {
		return result
	}

	// 1. Health check
	healthResults, _, err := s.performHealthCheck(sub.Nodes)
	if err != nil {
		result.Error = fmt.Sprintf("health check failed: %v", err)
		return result
	}
	result.CheckedNodes = len(healthResults)

	// 2. Filter alive nodes
	var aliveNodes []storage.Node
	for _, node := range sub.Nodes {
		key := fmt.Sprintf("%s:%d", node.Server, node.ServerPort)
		if hr, ok := healthResults[key]; ok && hr.Alive {
			aliveNodes = append(aliveNodes, node)
		}
	}
	result.AliveNodes = len(aliveNodes)

	// 3. Stability filter
	if sub.PipelineMinStability > 0 && len(aliveNodes) > 0 {
		stats, err := s.store.GetBulkHealthStats(7)
		if err == nil && len(stats) > 0 {
			statsMap := make(map[string]float64)
			for _, st := range stats {
				key := fmt.Sprintf("%s:%d", st.Server, st.ServerPort)
				statsMap[key] = st.UptimePercent
			}
			var filtered []storage.Node
			for _, node := range aliveNodes {
				key := fmt.Sprintf("%s:%d", node.Server, node.ServerPort)
				uptime, exists := statsMap[key]
				if !exists || uptime >= sub.PipelineMinStability {
					filtered = append(filtered, node)
				}
			}
			aliveNodes = filtered
			result.AliveNodes = len(aliveNodes)
		}
	}

	// 4. Copy alive to manual (with dedup)
	copied := 0
	skipped := 0
	for _, node := range aliveNodes {
		existing := s.store.FindManualNodeByServerPort(node.Server, node.ServerPort)
		if existing != nil {
			// Update source_subscription_id if it was empty
			if existing.SourceSubscriptionID == "" {
				existing.SourceSubscriptionID = sub.ID
				s.store.UpdateManualNode(*existing)
			}
			skipped++
			continue
		}

		mn := storage.ManualNode{
			ID:                   uuid.New().String(),
			Node:                 node,
			Enabled:              true,
			GroupTag:             sub.PipelineGroupTag,
			SourceSubscriptionID: sub.ID,
		}
		if err := s.store.AddManualNode(mn); err != nil {
			logger.Printf("[pipeline] Failed to add node %s: %v", node.Tag, err)
			continue
		}
		copied++
	}
	result.CopiedNodes = copied
	result.SkippedNodes = skipped

	// 5. Remove stale nodes
	if sub.PipelineRemoveDead {
		staleNodes, err := s.GetStaleNodes(sub, 5)
		if err == nil && len(staleNodes) > 0 {
			for _, mn := range staleNodes {
				if err := s.store.DeleteManualNode(mn.ID); err != nil {
					logger.Printf("[pipeline] Failed to remove stale node %s: %v", mn.Node.Tag, err)
					continue
				}
				result.RemovedStale++
			}
		}
	}

	// 6. Auto-apply if changes were made (unless caller handles it)
	if !skipAutoApply && (copied > 0 || result.RemovedStale > 0) {
		if err := s.autoApplyConfig(); err != nil {
			logger.Printf("[pipeline] Auto-apply failed: %v", err)
		}
	}

	return result
}

// GetStaleNodes returns manual nodes from this subscription that are stale.
func (s *Server) GetStaleNodes(sub storage.Subscription, failThreshold int) ([]storage.ManualNode, error) {
	manualNodes, err := s.store.GetManualNodesBySourceSubscription(sub.ID)
	if err != nil {
		return nil, err
	}

	// Build set of current subscription nodes by server:port
	currentKeys := make(map[string]bool)
	for _, n := range sub.Nodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		currentKeys[key] = true
	}

	var stale []storage.ManualNode
	for _, mn := range manualNodes {
		key := fmt.Sprintf("%s:%d", mn.Node.Server, mn.Node.ServerPort)

		// Node no longer in subscription
		if !currentKeys[key] {
			stale = append(stale, mn)
			continue
		}

		// Consecutive failures exceed threshold
		failures, err := s.store.GetConsecutiveFailures(mn.Node.Server, mn.Node.ServerPort, failThreshold)
		if err == nil && failures >= failThreshold {
			stale = append(stale, mn)
		}
	}
	return stale, nil
}

// ==================== Pipeline HTTP Handlers ====================

func (s *Server) updateSubscriptionPipeline(c *gin.Context) {
	id := c.Param("id")
	sub := s.store.GetSubscription(id)
	if sub == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
		return
	}

	var req struct {
		AutoPipeline         *bool    `json:"auto_pipeline"`
		PipelineGroupTag     *string  `json:"pipeline_group_tag"`
		PipelineMinStability *float64 `json:"pipeline_min_stability"`
		PipelineRemoveDead   *bool    `json:"pipeline_remove_dead"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.AutoPipeline != nil {
		sub.AutoPipeline = *req.AutoPipeline
	}
	if req.PipelineGroupTag != nil {
		sub.PipelineGroupTag = *req.PipelineGroupTag
	}
	if req.PipelineMinStability != nil {
		if *req.PipelineMinStability < 0 || *req.PipelineMinStability > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_min_stability must be between 0 and 100"})
			return
		}
		sub.PipelineMinStability = *req.PipelineMinStability
	}
	if req.PipelineRemoveDead != nil {
		sub.PipelineRemoveDead = *req.PipelineRemoveDead
	}

	if err := s.store.UpdateSubscription(*sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": sub})
}

func (s *Server) runSubscriptionPipeline(c *gin.Context) {
	id := c.Param("id")
	sub := s.store.GetSubscription(id)
	if sub == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
		return
	}

	result := s.RunPipeline(*sub)
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (s *Server) getSubscriptionPipelineLogs(c *gin.Context) {
	id := c.Param("id")
	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 20
	}

	logs, err := s.store.GetPipelineLogs(id, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": logs})
}

func (s *Server) getStaleNodesHandler(c *gin.Context) {
	id := c.Param("id")
	sub := s.store.GetSubscription(id)
	if sub == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
		return
	}

	failThresholdStr := c.DefaultQuery("fail_threshold", "5")
	failThreshold, err := strconv.Atoi(failThresholdStr)
	if err != nil || failThreshold <= 0 {
		failThreshold = 5
	}

	stale, err := s.GetStaleNodes(*sub, failThreshold)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": stale})
}

func (s *Server) deleteStaleNodesHandler(c *gin.Context) {
	id := c.Param("id")
	sub := s.store.GetSubscription(id)
	if sub == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "subscription not found"})
		return
	}

	var req struct {
		NodeIDs []string `json:"node_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build set of allowed node IDs (manual nodes belonging to this subscription)
	subNodes, err := s.store.GetManualNodesBySourceSubscription(sub.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get subscription nodes"})
		return
	}
	allowedIDs := make(map[string]bool, len(subNodes))
	for _, mn := range subNodes {
		allowedIDs[mn.ID] = true
	}

	deleted := 0
	rejected := 0
	for _, nodeID := range req.NodeIDs {
		if !allowedIDs[nodeID] {
			rejected++
			continue
		}
		if err := s.store.DeleteManualNode(nodeID); err != nil {
			continue
		}
		deleted++
	}

	if deleted > 0 {
		s.autoApplyConfig()
	}

	resp := gin.H{"deleted": deleted}
	if rejected > 0 {
		resp["rejected"] = rejected
		resp["warning"] = fmt.Sprintf("%d node(s) do not belong to this subscription", rejected)
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) getAllStaleNodes(c *gin.Context) {
	failThresholdStr := c.DefaultQuery("fail_threshold", "5")
	failThreshold, err := strconv.Atoi(failThresholdStr)
	if err != nil || failThreshold <= 0 {
		failThreshold = 5
	}

	subs := s.store.GetSubscriptions()
	var allStale []storage.ManualNode

	for _, sub := range subs {
		stale, err := s.GetStaleNodes(sub, failThreshold)
		if err != nil {
			continue
		}
		allStale = append(allStale, stale...)
	}

	if allStale == nil {
		allStale = []storage.ManualNode{}
	}

	c.JSON(http.StatusOK, gin.H{"data": allStale})
}
