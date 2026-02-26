package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

func (s *Server) setupPipelineActivityPersistence() {
	s.eventBus.SetPublishHook(func(eventType string, data interface{}) {
		message, ok := pipelineActivityMessage(eventType, data)
		if !ok {
			return
		}
		ts := pipelineActivityTimestamp(data)
		if ts.IsZero() {
			ts = time.Now()
		}
		if err := s.store.AddPipelineActivityLog(storage.PipelineActivityLog{
			Type:      eventType,
			Message:   message,
			Timestamp: ts,
		}); err != nil {
			logger.Printf("[pipeline-activity] Failed to save %s: %v", eventType, err)
		}
	})
}

func (s *Server) getPipelineActivityLogs(c *gin.Context) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if err != nil || limit <= 0 {
		limit = 50
	}
	logs := s.store.GetPipelineActivityLogs(limit)
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

func pipelineActivityMessage(eventType string, data interface{}) (string, bool) {
	m := asStringMap(data)
	switch eventType {
	case "verify:start":
		return fmt.Sprintf("Verification started: %d pending, %d verified",
			intFromMap(m, "pending_count"), intFromMap(m, "verified_count")), true
	case "verify:health_start":
		return fmt.Sprintf("Health check: %d nodes", intFromMap(m, "total_nodes")), true
	case "verify:site_start":
		total := intFromMap(m, "total_nodes")
		healthTotal := intFromMap(m, "health_total_nodes")
		return fmt.Sprintf("Site check: %d nodes%s", total, siteCheckProgressSuffix(total, healthTotal)), true
	case "verify:node_promoted":
		return fmt.Sprintf("Node promoted: %s", nodeIdentityFromMap(m)), true
	case "verify:node_demoted":
		return fmt.Sprintf("Node demoted: %s", nodeIdentityFromMap(m)), true
	case "verify:complete":
		return fmt.Sprintf("Verification complete in %dms - promoted: %d, demoted: %d, archived: %d",
			int64FromMap(m, "duration_ms"),
			intFromMap(m, "promoted"),
			intFromMap(m, "demoted"),
			intFromMap(m, "archived")), true
	case "pipeline:start":
		return "Pipeline started", true
	case "pipeline:stop":
		return "Pipeline stopped", true
	case "sub:refresh":
		return fmt.Sprintf("Subscription refreshed: %s (%d nodes)",
			stringFromMap(m, "name"), intFromMap(m, "node_count")), true
	case "sub:nodes_synced":
		return fmt.Sprintf("Nodes synced: %d processed, +%d added, %d skipped",
			intFromMap(m, "total"), intFromMap(m, "added"), intFromMap(m, "skipped")), true
	case "probe:started":
		return fmt.Sprintf("Probe started on port %d with %d nodes",
			intFromMap(m, "port"), intFromMap(m, "node_count")), true
	case "probe:stopped":
		return "Probe stopped", true
	default:
		return "", false
	}
}

func pipelineActivityTimestamp(data interface{}) time.Time {
	m := asStringMap(data)
	raw := stringFromMap(m, "timestamp")
	if raw == "" {
		return time.Time{}
	}
	ts, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return ts
}

func asStringMap(data interface{}) map[string]interface{} {
	if data == nil {
		return map[string]interface{}{}
	}
	m, ok := data.(map[string]interface{})
	if !ok {
		return map[string]interface{}{}
	}
	return m
}

func stringFromMap(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

func int64FromMap(m map[string]interface{}, key string) int64 {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	switch t := v.(type) {
	case int64:
		return t
	case int:
		return int64(t)
	case float64:
		return int64(t)
	case float32:
		return int64(t)
	default:
		return 0
	}
}

func intFromMap(m map[string]interface{}, key string) int {
	return int(int64FromMap(m, key))
}

func nodeIdentityFromMap(m map[string]interface{}) string {
	tag := stringFromMap(m, "tag")
	server := stringFromMap(m, "server")
	port := intFromMap(m, "server_port")
	if server != "" && port > 0 {
		if tag != "" {
			return fmt.Sprintf("%s (%s:%d)", tag, server, port)
		}
		return fmt.Sprintf("%s:%d", server, port)
	}
	if tag != "" {
		return tag
	}
	return "unknown"
}

func siteCheckProgressSuffix(siteTotal int, healthTotal int) string {
	if siteTotal < 0 || healthTotal <= 0 {
		return ""
	}
	percent := (float64(siteTotal) / float64(healthTotal)) * 100
	return fmt.Sprintf(" (%.1f%% of health check)", percent)
}
