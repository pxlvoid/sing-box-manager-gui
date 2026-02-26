package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shirou/gopsutil/v3/process"
	"github.com/xiaobei/singbox-manager/internal/builder"
	"github.com/xiaobei/singbox-manager/internal/daemon"
	"github.com/xiaobei/singbox-manager/internal/events"
	"github.com/xiaobei/singbox-manager/internal/kernel"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/parser"
	"github.com/xiaobei/singbox-manager/internal/service"
	"github.com/xiaobei/singbox-manager/internal/storage"
	"github.com/xiaobei/singbox-manager/web"
)

// generateRandomSecret generates a random secret
func generateRandomSecret(length int) string {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		// If cryptographic random number generation fails, return empty string
		return ""
	}
	return hex.EncodeToString(bytes)[:length]
}

// UnsupportedNodeInfo represents a node that failed sing-box config validation
type UnsupportedNodeInfo struct {
	Tag   string    `json:"tag"`
	Error string    `json:"error"`
	Time  time.Time `json:"detected_at"`
}

// Server represents the API server
type Server struct {
	store          storage.Store
	subService     *service.SubscriptionService
	processManager *daemon.ProcessManager
	probeManager   *daemon.ProbeManager
	launchdManager *daemon.LaunchdManager
	systemdManager *daemon.SystemdManager
	kernelManager  *kernel.Manager
	scheduler      *service.Scheduler
	router         *gin.Engine
	sbmPath        string // sbm executable path
	port           int    // Web service port
	version        string // sbm version

	eventBus *events.Bus

	unsupportedNodes   map[string]UnsupportedNodeInfo
	unsupportedNodesMu sync.RWMutex
}

// NewServer creates an API server
func NewServer(store storage.Store, processManager *daemon.ProcessManager, probeManager *daemon.ProbeManager, launchdManager *daemon.LaunchdManager, systemdManager *daemon.SystemdManager, sbmPath string, port int, version string) *Server {
	gin.SetMode(gin.ReleaseMode)

	subService := service.NewSubscriptionService(store)

	// Create kernel manager
	kernelManager := kernel.NewManager(store.GetDataDir(), store.GetSettings)

	eventBus := events.NewBus()

	s := &Server{
		store:            store,
		subService:       subService,
		processManager:   processManager,
		probeManager:     probeManager,
		launchdManager:   launchdManager,
		systemdManager:   systemdManager,
		kernelManager:    kernelManager,
		scheduler:        service.NewScheduler(store, subService),
		router:           gin.Default(),
		sbmPath:          sbmPath,
		port:             port,
		version:          version,
		eventBus:         eventBus,
		unsupportedNodes: make(map[string]UnsupportedNodeInfo),
	}

	// Wire event bus to services
	s.scheduler.SetEventBus(eventBus)
	s.subService.SetEventBus(eventBus)

	// Hydrate unsupported nodes from store (survive restart)
	if persisted := store.GetUnsupportedNodes(); len(persisted) > 0 {
		for _, un := range persisted {
			s.unsupportedNodes[un.NodeTag] = UnsupportedNodeInfo{
				Tag:   un.NodeTag,
				Error: un.Error,
				Time:  un.DetectedAt,
			}
		}
		logger.Printf("[startup] Loaded %d unsupported node(s) from store", len(persisted))
	}

	// Set scheduler callbacks
	s.scheduler.SetUpdateCallback(s.autoApplyConfig)
	s.scheduler.SetVerificationCallback(s.RunVerification)

	s.setupRoutes()
	return s
}

// StartScheduler starts the scheduled task scheduler
func (s *Server) StartScheduler() {
	s.scheduler.Start()
}

// StopScheduler stops the scheduled task scheduler
func (s *Server) StopScheduler() {
	s.scheduler.Stop()
}

// setupRoutes sets up routes
func (s *Server) setupRoutes() {
	// CORS configuration
	s.router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// API route group
	api := s.router.Group("/api")
	{
		// Subscription management
		api.GET("/subscriptions", s.getSubscriptions)
		api.POST("/subscriptions", s.addSubscription)
		api.PUT("/subscriptions/:id", s.updateSubscription)
		api.DELETE("/subscriptions/:id", s.deleteSubscription)
		api.POST("/subscriptions/:id/refresh", s.refreshSubscription)
		api.POST("/subscriptions/refresh-all", s.refreshAllSubscriptions)

		// Filter management
		api.GET("/filters", s.getFilters)
		api.POST("/filters", s.addFilter)
		api.PUT("/filters/:id", s.updateFilter)
		api.DELETE("/filters/:id", s.deleteFilter)

		// Rule management
		api.GET("/rules", s.getRules)
		api.POST("/rules", s.addRule)
		api.PUT("/rules/replace", s.replaceRules)
		api.PUT("/rules/:id", s.updateRule)
		api.DELETE("/rules/:id", s.deleteRule)

		// Rule group management
		api.GET("/rule-groups", s.getRuleGroups)
		api.GET("/rule-groups/defaults", s.getDefaultRuleGroups)
		api.PUT("/rule-groups/:id", s.updateRuleGroup)
		api.POST("/rule-groups/:id/reset", s.resetRuleGroup)

		// Rule set validation
		api.GET("/ruleset/validate", s.validateRuleSet)

		// Settings
		api.GET("/settings", s.getSettings)
		api.PUT("/settings", s.updateSettings)

		// System hosts
		api.GET("/system-hosts", s.getSystemHosts)

		// Config generation
		api.POST("/config/generate", s.generateConfig)
		api.POST("/config/apply", s.applyConfig)
		api.GET("/config/preview", s.previewConfig)

		// Service management
		api.GET("/service/status", s.getServiceStatus)
		api.POST("/service/start", s.startService)
		api.POST("/service/stop", s.stopService)
		api.POST("/service/restart", s.restartService)
		api.POST("/service/reload", s.reloadService)

		// launchd management
		api.GET("/launchd/status", s.getLaunchdStatus)
		api.POST("/launchd/install", s.installLaunchd)
		api.POST("/launchd/uninstall", s.uninstallLaunchd)
		api.POST("/launchd/restart", s.restartLaunchd)

		// systemd management
		api.GET("/systemd/status", s.getSystemdStatus)
		api.POST("/systemd/install", s.installSystemd)
		api.POST("/systemd/uninstall", s.uninstallSystemd)
		api.POST("/systemd/restart", s.restartSystemd)

		// Unified daemon management (auto-detect system)
		api.GET("/daemon/status", s.getDaemonStatus)
		api.POST("/daemon/install", s.installDaemon)
		api.POST("/daemon/uninstall", s.uninstallDaemon)
		api.POST("/daemon/restart", s.restartDaemon)

		// System monitoring
		api.GET("/monitor/system", s.getSystemInfo)
		api.GET("/monitor/logs", s.getLogs)
		api.GET("/monitor/logs/sbm", s.getAppLogs)
		api.GET("/monitor/logs/singbox", s.getSingboxLogs)
		api.GET("/monitor/logs/probe", s.getProbeLogs)

		// Nodes
		api.GET("/nodes", s.getAllNodes)
		api.GET("/nodes/countries", s.getCountryGroups)
		api.GET("/nodes/country/:code", s.getNodesByCountry)
		api.POST("/nodes/parse", s.parseNodeURL)
		api.POST("/nodes/parse-bulk", s.parseNodeURLsBulk)
		api.POST("/nodes/health-check", s.healthCheckNodes)
		api.POST("/nodes/health-check-single", s.healthCheckSingleNode)
		api.POST("/nodes/site-check", s.siteCheckNodes)
		api.GET("/nodes/unsupported", s.getUnsupportedNodes)
		api.POST("/nodes/unsupported/recheck", s.recheckUnsupportedNodes)
		api.DELETE("/nodes/unsupported", s.clearUnsupportedNodes)
		api.POST("/nodes/unsupported/delete", s.deleteUnsupportedNodes)

		// Unified nodes
		api.GET("/nodes/unified", s.getUnifiedNodes)
		api.POST("/nodes/unified", s.addUnifiedNode)
		api.POST("/nodes/unified/bulk", s.addUnifiedNodesBulk)
		api.PUT("/nodes/unified/:id", s.updateUnifiedNode)
		api.DELETE("/nodes/unified/:id", s.deleteUnifiedNode)
		api.POST("/nodes/unified/:id/promote", s.promoteUnifiedNode)
		api.POST("/nodes/unified/:id/demote", s.demoteUnifiedNode)
		api.POST("/nodes/unified/:id/archive", s.archiveUnifiedNode)
		api.POST("/nodes/unified/:id/unarchive", s.unarchiveUnifiedNode)
		api.POST("/nodes/unified/bulk-promote", s.bulkPromoteNodes)
		api.POST("/nodes/unified/bulk-archive", s.bulkArchiveNodes)
		api.GET("/nodes/unified/counts", s.getNodeCounts)

		// Verification
		api.POST("/verification/run", s.runVerification)
		api.GET("/verification/logs", s.getVerificationLogs)
		api.GET("/verification/status", s.getVerificationStatus)
		api.POST("/verification/start", s.startVerificationScheduler)
		api.POST("/verification/stop", s.stopVerificationScheduler)

		// Kernel management
		api.GET("/kernel/info", s.getKernelInfo)
		api.GET("/kernel/releases", s.getKernelReleases)
		api.POST("/kernel/download", s.startKernelDownload)
		api.GET("/kernel/progress", s.getKernelProgress)

		// Proxy group management (Clash API proxy)
		api.GET("/proxy/groups", s.getProxyGroups)
		api.PUT("/proxy/groups/:name", s.switchProxyGroup)
		api.GET("/proxy/delay/:name", s.getProxyDelay)

		// Debug API
		api.GET("/debug/dump", s.debugDump)
		api.GET("/debug/logs/singbox", s.debugSingboxLogs)
		api.GET("/debug/logs/app", s.debugAppLogs)
		api.GET("/debug/logs/probe", s.debugProbeLogs)

		// Probe management
		api.GET("/probe/status", s.getProbeStatus)
		api.POST("/probe/stop", s.stopProbe)

		// SSE event stream
		api.GET("/events/stream", s.handleEventStream)

		// Measurements API
		api.GET("/measurements/health", s.getHealthMeasurements)
		api.GET("/measurements/health/stats", s.getHealthStats)
		api.GET("/measurements/health/stats/bulk", s.getBulkHealthStats)
		api.POST("/measurements/health", s.saveHealthMeasurements)
		api.GET("/measurements/site", s.getSiteMeasurements)
		api.POST("/measurements/site", s.saveSiteMeasurements)
		api.POST("/measurements/import", s.importMeasurements)
	}

	// Static file service (frontend, using embedded file system)
	distFS, err := web.GetDistFS()
	if err != nil {
		logger.Printf("Failed to load frontend assets: %v", err)
	} else {
		// Get assets subdirectory
		assetsFS, _ := fs.Sub(distFS, "assets")
		s.router.StaticFS("/assets", http.FS(assetsFS))

		// Handle root path and all unmatched routes (SPA support)
		indexHTML, _ := fs.ReadFile(distFS, "index.html")
		s.router.GET("/", func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
		})
		s.router.NoRoute(func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
		})
	}
}

// Run starts the server
func (s *Server) Run(addr string) error {
	return s.router.Run(addr)
}

// ==================== Subscription API ====================

func (s *Server) getSubscriptions(c *gin.Context) {
	subs := s.subService.GetAll()
	c.JSON(http.StatusOK, gin.H{"data": subs})
}

func (s *Server) addSubscription(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
		URL  string `json:"url" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sub, err := s.subService.Add(req.Name, req.URL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": sub, "warning": "Added successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": sub})
}

func (s *Server) updateSubscription(c *gin.Context) {
	id := c.Param("id")

	var sub storage.Subscription
	if err := c.ShouldBindJSON(&sub); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sub.ID = id
	if err := s.subService.Update(sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Updated successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

func (s *Server) deleteSubscription(c *gin.Context) {
	id := c.Param("id")

	if err := s.subService.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

func (s *Server) refreshSubscription(c *gin.Context) {
	id := c.Param("id")

	if err := s.subService.Refresh(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Refreshed successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Refreshed successfully"})
}

func (s *Server) refreshAllSubscriptions(c *gin.Context) {
	if err := s.subService.RefreshAll(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Refreshed successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Refreshed successfully"})
}

// ==================== Filter API ====================

func (s *Server) getFilters(c *gin.Context) {
	filters := s.store.GetFilters()
	c.JSON(http.StatusOK, gin.H{"data": filters})
}

func (s *Server) addFilter(c *gin.Context) {
	var filter storage.Filter
	if err := c.ShouldBindJSON(&filter); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate ID
	filter.ID = uuid.New().String()

	if err := s.store.AddFilter(filter); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": filter, "warning": "Added successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": filter})
}

func (s *Server) updateFilter(c *gin.Context) {
	id := c.Param("id")

	var filter storage.Filter
	if err := c.ShouldBindJSON(&filter); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	filter.ID = id
	if err := s.store.UpdateFilter(filter); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Updated successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

func (s *Server) deleteFilter(c *gin.Context) {
	id := c.Param("id")

	if err := s.store.DeleteFilter(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

// ==================== Rule API ====================

func (s *Server) getRules(c *gin.Context) {
	rules := s.store.GetRules()
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

func (s *Server) addRule(c *gin.Context) {
	var rule storage.Rule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate ID
	rule.ID = uuid.New().String()

	if err := s.store.AddRule(rule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": rule, "warning": "Added successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (s *Server) replaceRules(c *gin.Context) {
	var req struct {
		Rules []storage.Rule `json:"rules"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Ensure each rule has an ID
	for i := range req.Rules {
		if strings.TrimSpace(req.Rules[i].ID) == "" {
			req.Rules[i].ID = uuid.New().String()
		}
	}

	if err := s.store.ReplaceRules(req.Rules); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": req.Rules, "warning": "Replaced successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": req.Rules, "message": "Replaced successfully"})
}

func (s *Server) updateRule(c *gin.Context) {
	id := c.Param("id")

	var rule storage.Rule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.ID = id
	if err := s.store.UpdateRule(rule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Updated successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

func (s *Server) deleteRule(c *gin.Context) {
	id := c.Param("id")

	if err := s.store.DeleteRule(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

// ==================== Rule Group API ====================

func (s *Server) getRuleGroups(c *gin.Context) {
	ruleGroups := s.store.GetRuleGroups()
	c.JSON(http.StatusOK, gin.H{"data": ruleGroups})
}

func (s *Server) updateRuleGroup(c *gin.Context) {
	id := c.Param("id")

	var ruleGroup storage.RuleGroup
	if err := c.ShouldBindJSON(&ruleGroup); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ruleGroup.ID = id
	if err := s.store.UpdateRuleGroup(ruleGroup); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Updated successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

func (s *Server) getDefaultRuleGroups(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": storage.DefaultRuleGroups()})
}

func (s *Server) resetRuleGroup(c *gin.Context) {
	id := c.Param("id")

	// Find default rule group by ID
	var defaultGroup *storage.RuleGroup
	for _, dg := range storage.DefaultRuleGroups() {
		if dg.ID == id {
			defaultGroup = &dg
			break
		}
	}

	if defaultGroup == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No default rule group found for ID: " + id})
		return
	}

	// Keep current enabled and outbound, reset name/site_rules/ip_rules
	current := s.store.GetRuleGroups()
	for _, rg := range current {
		if rg.ID == id {
			defaultGroup.Enabled = rg.Enabled
			defaultGroup.Outbound = rg.Outbound
			break
		}
	}

	if err := s.store.UpdateRuleGroup(*defaultGroup); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Reset successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Reset successfully"})
}

// ==================== Rule Set Validation API ====================

func (s *Server) validateRuleSet(c *gin.Context) {
	ruleType := c.Query("type") // geosite or geoip
	name := c.Query("name")     // Rule set name

	if ruleType == "" || name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parameters type and name are required"})
		return
	}

	if ruleType != "geosite" && ruleType != "geoip" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be geosite or geoip"})
		return
	}

	settings := s.store.GetSettings()
	var url string
	var tag string

	if ruleType == "geosite" {
		tag = "geosite-" + name
		url = settings.RuleSetBaseURL + "/geosite-" + name + ".srs"
	} else {
		tag = "geoip-" + name
		// geoip uses relative path
		url = settings.RuleSetBaseURL + "/../rule-set-geoip/geoip-" + name + ".srs"
	}

	// If GitHub proxy is configured, add proxy prefix
	if settings.GithubProxy != "" {
		url = settings.GithubProxy + url
	}

	// Send HEAD request to check if file exists
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Head(url)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"valid":   false,
			"url":     url,
			"tag":     tag,
			"message": "Cannot access rule set: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		c.JSON(http.StatusOK, gin.H{
			"valid":   true,
			"url":     url,
			"tag":     tag,
			"message": "Rule set exists",
		})
	} else {
		c.JSON(http.StatusOK, gin.H{
			"valid":   false,
			"url":     url,
			"tag":     tag,
			"message": "Rule set not found (HTTP " + strconv.Itoa(resp.StatusCode) + ")",
		})
	}
}

// ==================== Settings API ====================

func (s *Server) getSettings(c *gin.Context) {
	settings := s.store.GetSettings()
	settings.WebPort = s.port
	c.JSON(http.StatusOK, gin.H{"data": settings})
}

func (s *Server) updateSettings(c *gin.Context) {
	var settings storage.Settings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Handle secret based on LAN access setting
	if settings.AllowLAN {
		// When LAN access is enabled and secret is empty, auto-generate one
		if settings.ClashAPISecret == "" {
			settings.ClashAPISecret = generateRandomSecret(16)
		}
	} else {
		// When LAN access is disabled, clear secret
		settings.ClashAPISecret = ""
	}

	if err := s.store.UpdateSettings(&settings); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Update process manager config path (sing-box path is fixed, no update needed)
	s.processManager.SetConfigPath(s.resolvePath(settings.ConfigPath))

	// Restart scheduler (interval may have been updated)
	s.scheduler.Restart()

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": settings, "warning": "Updated successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": settings, "message": "Updated successfully"})
}

// ==================== System Hosts API ====================

func (s *Server) getSystemHosts(c *gin.Context) {
	hosts := builder.ParseSystemHosts()

	var entries []storage.HostEntry
	for domain, ips := range hosts {
		entries = append(entries, storage.HostEntry{
			ID:      "system-" + domain,
			Domain:  domain,
			IPs:     ips,
			Enabled: true,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// ==================== Config API ====================

func (s *Server) generateConfig(c *gin.Context) {
	configJSON, err := s.buildConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": configJSON})
}

func (s *Server) previewConfig(c *gin.Context) {
	configJSON, err := s.buildConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.String(http.StatusOK, configJSON)
}

func (s *Server) applyConfig(c *gin.Context) {
	configJSON, newUnsupported, err := s.buildAndValidateConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Save config file
	settings := s.store.GetSettings()
	if err := s.saveConfigFile(s.resolvePath(settings.ConfigPath), configJSON); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Restart service
	if s.processManager.IsRunning() {
		if err := s.processManager.Restart(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	response := gin.H{"message": "Config applied"}
	if len(newUnsupported) > 0 {
		tags := make([]string, len(newUnsupported))
		for i, u := range newUnsupported {
			tags[i] = u.Tag
		}
		response["warning"] = fmt.Sprintf("%d unsupported node(s) excluded: %s", len(newUnsupported), strings.Join(tags, ", "))
		response["unsupported_nodes"] = newUnsupported
	}
	c.JSON(http.StatusOK, response)
}

func (s *Server) buildConfig() (string, error) {
	settings := s.store.GetSettings()
	nodes := s.store.GetAllNodes()
	filters := s.store.GetFilters()
	rules := s.store.GetRules()
	ruleGroups := s.store.GetRuleGroups()

	b := builder.NewConfigBuilder(settings, nodes, filters, rules, ruleGroups)
	return b.BuildJSON()
}

// buildAndValidateConfig generates config, validates it with sing-box check,
// and iteratively removes unsupported nodes until validation passes.
func (s *Server) buildAndValidateConfig() (string, []UnsupportedNodeInfo, error) {
	settings := s.store.GetSettings()
	nodes := s.store.GetAllNodes()
	filters := s.store.GetFilters()
	rules := s.store.GetRules()
	ruleGroups := s.store.GetRuleGroups()

	excludeTags := make(map[string]bool)

	// Copy currently known unsupported nodes into exclusion set
	s.unsupportedNodesMu.RLock()
	for tag := range s.unsupportedNodes {
		excludeTags[tag] = true
	}
	s.unsupportedNodesMu.RUnlock()

	var newUnsupported []UnsupportedNodeInfo
	const maxIterations = 50

	singboxPath := s.processManager.GetSingBoxPath()

	for i := 0; i < maxIterations; i++ {
		b := builder.NewConfigBuilderWithExclusions(settings, nodes, filters, rules, ruleGroups, excludeTags)
		configJSON, indexToTag, err := b.BuildJSONWithNodeMap()
		if err != nil {
			return "", nil, err
		}

		// Write to temp file for validation
		tmpFile, err := os.CreateTemp("", "sbm-validate-*.json")
		if err != nil {
			return "", nil, fmt.Errorf("failed to create temp file: %w", err)
		}
		tmpPath := tmpFile.Name()

		if _, err := tmpFile.WriteString(configJSON); err != nil {
			tmpFile.Close()
			os.Remove(tmpPath)
			return "", nil, fmt.Errorf("failed to write temp config: %w", err)
		}
		tmpFile.Close()

		// Run sing-box check
		checkCmd := exec.Command(singboxPath, "check", "-c", tmpPath)
		output, checkErr := checkCmd.CombinedOutput()
		os.Remove(tmpPath)

		if checkErr == nil {
			// Config is valid — store new unsupported nodes
			if len(newUnsupported) > 0 {
				// Build tag→Node map to resolve server:port
				tagToNode := make(map[string]storage.Node)
				for _, n := range nodes {
					tagToNode[n.Tag] = n
				}

				s.unsupportedNodesMu.Lock()
				for _, info := range newUnsupported {
					s.unsupportedNodes[info.Tag] = info
				}
				s.unsupportedNodesMu.Unlock()

				// Persist to store
				for _, info := range newUnsupported {
					un := storage.UnsupportedNode{
						NodeTag:    info.Tag,
						Error:      info.Error,
						DetectedAt: info.Time,
					}
					if n, ok := tagToNode[info.Tag]; ok {
						un.Server = n.Server
						un.ServerPort = n.ServerPort
					}
					if err := s.store.AddUnsupportedNode(un); err != nil {
						logger.Printf("[config] Failed to persist unsupported node %s: %v", info.Tag, err)
					}
				}

				// Log excluded nodes
				tags := make([]string, len(newUnsupported))
				for i, u := range newUnsupported {
					tags[i] = u.Tag
				}
				logger.Printf("[config] Excluded %d unsupported node(s): %s", len(newUnsupported), strings.Join(tags, ", "))
			}
			return configJSON, newUnsupported, nil
		}

		// Parse errors
		checkErrors := builder.ParseCheckErrors(string(output))
		if !checkErrors.HasErrors() {
			// Unrecognized error, cannot auto-fix
			return "", nil, fmt.Errorf("config check failed: %s", string(output))
		}

		// Build reverse map: tag -> list of outbound indices (for duplicate detection)
		tagToIndices := make(map[string][]int)
		for idx, tag := range indexToTag {
			tagToIndices[tag] = append(tagToIndices[tag], idx)
		}

		foundNew := false

		// Handle outbound index errors (outbounds[N].field: message)
		for _, oe := range checkErrors.OutboundErrors {
			tag, ok := indexToTag[oe.Index]
			if !ok {
				// Error in a non-node outbound (group/selector), cannot auto-fix
				return "", nil, fmt.Errorf("config check failed: %s", string(output))
			}
			if !excludeTags[tag] {
				excludeTags[tag] = true
				info := UnsupportedNodeInfo{
					Tag:   tag,
					Error: oe.Message,
					Time:  time.Now(),
				}
				newUnsupported = append(newUnsupported, info)
				foundNew = true
			}
		}

		// Handle duplicate tag errors (duplicate outbound/endpoint tag: <tag>)
		// Node-level duplicates are already handled in the builder (deduplication).
		// If this error still occurs, it's a conflict with a group/selector tag.
		for _, dte := range checkErrors.DuplicateTagErrors {
			// Try to find and exclude the node with conflicting tag
			if _, isNodeTag := tagToIndices[dte.Tag]; isNodeTag {
				if !excludeTags[dte.Tag] {
					excludeTags[dte.Tag] = true
					info := UnsupportedNodeInfo{
						Tag:   dte.Tag,
						Error: fmt.Sprintf("duplicate outbound tag: %s", dte.Tag),
						Time:  time.Now(),
					}
					newUnsupported = append(newUnsupported, info)
					foundNew = true
				}
			}
		}

		if !foundNew {
			return "", nil, fmt.Errorf("config check failed: %s", string(output))
		}
	}

	return "", nil, fmt.Errorf("config validation exceeded max iterations (%d)", maxIterations)
}

func (s *Server) saveConfigFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// resolvePath resolves a relative path to an absolute path based on the data directory
func (s *Server) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(s.store.GetDataDir(), path)
}

// autoApplyConfig auto-applies config (if sing-box is running)
func (s *Server) autoApplyConfig() error {
	settings := s.store.GetSettings()
	if !settings.AutoApply {
		return nil
	}

	// Generate and validate config
	configJSON, _, err := s.buildAndValidateConfig()
	if err != nil {
		return err
	}

	// Save config file
	if err := s.saveConfigFile(s.resolvePath(settings.ConfigPath), configJSON); err != nil {
		return err
	}

	// If sing-box is running, restart it
	if s.processManager.IsRunning() {
		return s.processManager.Restart()
	}

	return nil
}

// ==================== Unsupported Nodes API ====================

func (s *Server) getUnsupportedNodes(c *gin.Context) {
	s.unsupportedNodesMu.RLock()
	defer s.unsupportedNodesMu.RUnlock()

	nodes := make([]UnsupportedNodeInfo, 0, len(s.unsupportedNodes))
	for _, info := range s.unsupportedNodes {
		nodes = append(nodes, info)
	}
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

func (s *Server) recheckUnsupportedNodes(c *gin.Context) {
	// Clear unsupported list (in-memory + store)
	s.unsupportedNodesMu.Lock()
	s.unsupportedNodes = make(map[string]UnsupportedNodeInfo)
	s.unsupportedNodesMu.Unlock()
	if err := s.store.ClearUnsupportedNodes(); err != nil {
		logger.Printf("[unsupported] Failed to clear from store: %v", err)
	}

	// Re-validate config
	configJSON, newUnsupported, err := s.buildAndValidateConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Save the validated config
	settings := s.store.GetSettings()
	if err := s.saveConfigFile(s.resolvePath(settings.ConfigPath), configJSON); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Return updated list
	s.unsupportedNodesMu.RLock()
	defer s.unsupportedNodesMu.RUnlock()
	nodes := make([]UnsupportedNodeInfo, 0, len(s.unsupportedNodes))
	for _, info := range s.unsupportedNodes {
		nodes = append(nodes, info)
	}
	c.JSON(http.StatusOK, gin.H{"data": nodes, "message": fmt.Sprintf("Recheck completed, %d unsupported node(s)", len(newUnsupported))})
}

func (s *Server) clearUnsupportedNodes(c *gin.Context) {
	s.unsupportedNodesMu.Lock()
	s.unsupportedNodes = make(map[string]UnsupportedNodeInfo)
	s.unsupportedNodesMu.Unlock()
	if err := s.store.ClearUnsupportedNodes(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clear from store: %v", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Cleared"})
}

// deleteUnsupportedNodes permanently removes unsupported nodes from subscriptions and manual nodes
func (s *Server) deleteUnsupportedNodes(c *gin.Context) {
	var req struct {
		Tags []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Tags) == 0 {
		// If no tags specified, delete all unsupported
		s.unsupportedNodesMu.RLock()
		for tag := range s.unsupportedNodes {
			req.Tags = append(req.Tags, tag)
		}
		s.unsupportedNodesMu.RUnlock()
	}

	if len(req.Tags) == 0 {
		c.JSON(http.StatusOK, gin.H{"message": "No unsupported nodes to delete", "removed": 0})
		return
	}

	removed, err := s.store.RemoveNodesByTags(req.Tags)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Clear them from unsupported list (in-memory + store)
	s.unsupportedNodesMu.Lock()
	for _, tag := range req.Tags {
		delete(s.unsupportedNodes, tag)
	}
	s.unsupportedNodesMu.Unlock()
	if err := s.store.DeleteUnsupportedNodesByTags(req.Tags); err != nil {
		logger.Printf("[unsupported] Failed to delete from store: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Removed %d node(s)", removed),
		"removed": removed,
	})
}

// ==================== Service API ====================

func (s *Server) getServiceStatus(c *gin.Context) {
	running := s.processManager.IsRunning()
	pid := s.processManager.GetPID()

	version := ""
	if v, err := s.processManager.Version(); err == nil {
		version = v
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"running":     running,
			"pid":         pid,
			"version":     version,
			"sbm_version": s.version,
		},
	})
}

func (s *Server) startService(c *gin.Context) {
	if err := s.processManager.Start(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service started"})
}

func (s *Server) stopService(c *gin.Context) {
	if err := s.processManager.Stop(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service stopped"})
}

func (s *Server) restartService(c *gin.Context) {
	if err := s.processManager.Restart(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service restarted"})
}

func (s *Server) reloadService(c *gin.Context) {
	if err := s.processManager.Reload(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Config reloaded"})
}

// ==================== launchd API ====================

func (s *Server) getLaunchdStatus(c *gin.Context) {
	if s.launchdManager == nil {
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"installed": false,
				"running":   false,
				"plistPath": "",
				"supported": false,
			},
		})
		return
	}

	installed := s.launchdManager.IsInstalled()
	running := s.launchdManager.IsRunning()

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"installed": installed,
			"running":   running,
			"plistPath": s.launchdManager.GetPlistPath(),
			"supported": true,
		},
	})
}

func (s *Server) installLaunchd(c *gin.Context) {
	if s.launchdManager == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "launchd service is not supported on this system"})
		return
	}

	// Get user home directory (supports multiple methods)
	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		// Fallback: use os/user package
		if u, err := user.Current(); err == nil && u.HomeDir != "" {
			homeDir = u.HomeDir
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get user home directory"})
			return
		}
	}

	// Ensure logs directory exists
	logsDir := s.store.GetDataDir() + "/logs"

	config := daemon.LaunchdConfig{
		SbmPath:    s.sbmPath,
		DataDir:    s.store.GetDataDir(),
		Port:       strconv.Itoa(s.port),
		LogPath:    logsDir,
		WorkingDir: s.store.GetDataDir(),
		HomeDir:    homeDir,
		RunAtLoad:  true,
		KeepAlive:  true,
	}

	if err := s.launchdManager.Install(config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Start service after successful installation
	if err := s.launchdManager.Start(); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": "Service installed, but failed to start: " + err.Error() + ". Please restart the computer or manually run the launchctl load command",
			"action":  "manual",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Service installed and started. You can close this terminal window. sbm will run in the background and start on boot.",
		"action":  "exit",
	})
}

func (s *Server) uninstallLaunchd(c *gin.Context) {
	if s.launchdManager == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "launchd service is not supported on this system"})
		return
	}

	if err := s.launchdManager.Uninstall(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service uninstalled"})
}

func (s *Server) restartLaunchd(c *gin.Context) {
	if s.launchdManager == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "launchd service is not supported on this system"})
		return
	}

	if err := s.launchdManager.Restart(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service restarted"})
}

// ==================== systemd API ====================

func (s *Server) getSystemdStatus(c *gin.Context) {
	if s.systemdManager == nil {
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"installed":   false,
				"running":     false,
				"servicePath": "",
				"supported":   false,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"installed":   s.systemdManager.IsInstalled(),
			"running":     s.systemdManager.IsRunning(),
			"servicePath": s.systemdManager.GetServicePath(),
			"supported":   true,
		},
	})
}

func (s *Server) installSystemd(c *gin.Context) {
	if s.systemdManager == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "systemd service is not supported on this system"})
		return
	}

	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		if u, err := user.Current(); err == nil && u.HomeDir != "" {
			homeDir = u.HomeDir
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get user home directory"})
			return
		}
	}

	logsDir := s.store.GetDataDir() + "/logs"

	config := daemon.SystemdConfig{
		SbmPath:    s.sbmPath,
		DataDir:    s.store.GetDataDir(),
		Port:       strconv.Itoa(s.port),
		LogPath:    logsDir,
		WorkingDir: s.store.GetDataDir(),
		HomeDir:    homeDir,
		RunAtLoad:  true,
		KeepAlive:  true,
	}

	if err := s.systemdManager.Install(config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := s.systemdManager.Start(); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": "Service installed, but failed to start: " + err.Error() + ". Please run systemctl --user start singbox-manager",
			"action":  "manual",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Service installed and started. You can close this terminal window. sbm will run in the background and start on boot.",
		"action":  "exit",
	})
}

func (s *Server) uninstallSystemd(c *gin.Context) {
	if s.systemdManager == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "systemd service is not supported on this system"})
		return
	}

	if err := s.systemdManager.Uninstall(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service uninstalled"})
}

func (s *Server) restartSystemd(c *gin.Context) {
	if s.systemdManager == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "systemd service is not supported on this system"})
		return
	}

	if err := s.systemdManager.Restart(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service restarted"})
}

// ==================== Unified Daemon API ====================

func (s *Server) getDaemonStatus(c *gin.Context) {
	platform := runtime.GOOS
	var installed, running, supported bool
	var configPath string

	switch platform {
	case "darwin":
		if s.launchdManager != nil {
			supported = true
			installed = s.launchdManager.IsInstalled()
			running = s.launchdManager.IsRunning()
			configPath = s.launchdManager.GetPlistPath()
		}
	case "linux":
		if s.systemdManager != nil {
			supported = true
			installed = s.systemdManager.IsInstalled()
			running = s.systemdManager.IsRunning()
			configPath = s.systemdManager.GetServicePath()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"installed":  installed,
			"running":    running,
			"configPath": configPath,
			"supported":  supported,
			"platform":   platform,
		},
	})
}

func (s *Server) installDaemon(c *gin.Context) {
	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		if u, err := user.Current(); err == nil && u.HomeDir != "" {
			homeDir = u.HomeDir
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get user home directory"})
			return
		}
	}

	logsDir := s.store.GetDataDir() + "/logs"

	switch runtime.GOOS {
	case "darwin":
		if s.launchdManager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
			return
		}
		config := daemon.LaunchdConfig{
			SbmPath:    s.sbmPath,
			DataDir:    s.store.GetDataDir(),
			Port:       strconv.Itoa(s.port),
			LogPath:    logsDir,
			WorkingDir: s.store.GetDataDir(),
			HomeDir:    homeDir,
			RunAtLoad:  true,
			KeepAlive:  true,
		}
		if err := s.launchdManager.Install(config); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := s.launchdManager.Start(); err != nil {
			c.JSON(http.StatusOK, gin.H{"message": "Service installed, but failed to start: " + err.Error(), "action": "manual"})
			return
		}
	case "linux":
		if s.systemdManager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
			return
		}
		config := daemon.SystemdConfig{
			SbmPath:    s.sbmPath,
			DataDir:    s.store.GetDataDir(),
			Port:       strconv.Itoa(s.port),
			LogPath:    logsDir,
			WorkingDir: s.store.GetDataDir(),
			HomeDir:    homeDir,
			RunAtLoad:  true,
			KeepAlive:  true,
		}
		if err := s.systemdManager.Install(config); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := s.systemdManager.Start(); err != nil {
			c.JSON(http.StatusOK, gin.H{"message": "Service installed, but failed to start: " + err.Error(), "action": "manual"})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Service installed and started", "action": "exit"})
}

func (s *Server) uninstallDaemon(c *gin.Context) {
	var err error
	switch runtime.GOOS {
	case "darwin":
		if s.launchdManager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
			return
		}
		err = s.launchdManager.Uninstall()
	case "linux":
		if s.systemdManager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
			return
		}
		err = s.systemdManager.Uninstall()
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service uninstalled"})
}

func (s *Server) restartDaemon(c *gin.Context) {
	var err error
	switch runtime.GOOS {
	case "darwin":
		if s.launchdManager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
			return
		}
		err = s.launchdManager.Restart()
	case "linux":
		if s.systemdManager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
			return
		}
		err = s.systemdManager.Restart()
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "daemon service is not supported on this system"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Service restarted"})
}

// ==================== Monitor API ====================

// ProcessStats represents process resource statistics
type ProcessStats struct {
	PID        int     `json:"pid"`
	CPUPercent float64 `json:"cpu_percent"`
	MemoryMB   float64 `json:"memory_mb"`
}

func (s *Server) getSystemInfo(c *gin.Context) {
	result := gin.H{}

	// Get sbm process info
	sbmPid := int32(os.Getpid())
	if sbmProc, err := process.NewProcess(sbmPid); err == nil {
		cpuPercent, _ := sbmProc.CPUPercent()
		var memoryMB float64
		if memInfo, err := sbmProc.MemoryInfo(); err == nil && memInfo != nil {
			memoryMB = float64(memInfo.RSS) / 1024 / 1024
		}

		result["sbm"] = ProcessStats{
			PID:        int(sbmPid),
			CPUPercent: cpuPercent,
			MemoryMB:   memoryMB,
		}
	}

	// Get sing-box process info
	if s.processManager.IsRunning() {
		singboxPid := int32(s.processManager.GetPID())
		if singboxProc, err := process.NewProcess(singboxPid); err == nil {
			cpuPercent, _ := singboxProc.CPUPercent()
			var memoryMB float64
			if memInfo, err := singboxProc.MemoryInfo(); err == nil && memInfo != nil {
				memoryMB = float64(memInfo.RSS) / 1024 / 1024
			}

			result["singbox"] = ProcessStats{
				PID:        int(singboxPid),
				CPUPercent: cpuPercent,
				MemoryMB:   memoryMB,
			}
		}
	}

	// Get probe sing-box process info
	if s.probeManager != nil && s.probeManager.IsRunning() {
		probeStatus := s.probeManager.Status()
		if probeStatus.PID > 0 {
			probePid := int32(probeStatus.PID)
			if probeProc, err := process.NewProcess(probePid); err == nil {
				cpuPercent, _ := probeProc.CPUPercent()
				var memoryMB float64
				if memInfo, err := probeProc.MemoryInfo(); err == nil && memInfo != nil {
					memoryMB = float64(memInfo.RSS) / 1024 / 1024
				}

				result["probe"] = ProcessStats{
					PID:        int(probePid),
					CPUPercent: cpuPercent,
					MemoryMB:   memoryMB,
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

const (
	defaultMonitorLogLines = 2000
	maxMonitorLogLines     = 10000
)

func parseMonitorLogLines(c *gin.Context) int {
	lines := defaultMonitorLogLines
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
			if n > maxMonitorLogLines {
				return maxMonitorLogLines
			}
			lines = n
		}
	}
	return lines
}

func (s *Server) getLogs(c *gin.Context) {
	lines := parseMonitorLogLines(c)

	// Return program logs, not mixed with sing-box output
	logs, err := logger.ReadAppLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// getAppLogs gets application logs
func (s *Server) getAppLogs(c *gin.Context) {
	lines := parseMonitorLogLines(c)

	logs, err := logger.ReadAppLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// getSingboxLogs gets sing-box logs
func (s *Server) getSingboxLogs(c *gin.Context) {
	lines := parseMonitorLogLines(c)

	logs, err := logger.ReadSingboxLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// getProbeLogs gets probe sing-box logs
func (s *Server) getProbeLogs(c *gin.Context) {
	lines := parseMonitorLogLines(c)

	logs, err := logger.ReadProbeLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// ==================== Node API ====================

func (s *Server) getAllNodes(c *gin.Context) {
	nodes := s.store.GetAllNodes()
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

func (s *Server) getCountryGroups(c *gin.Context) {
	groups := s.store.GetCountryGroups()
	c.JSON(http.StatusOK, gin.H{"data": groups})
}

func (s *Server) getNodesByCountry(c *gin.Context) {
	code := c.Param("code")
	nodes := s.store.GetNodesByCountry(code)
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

func (s *Server) parseNodeURL(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	node, err := parser.ParseURL(req.URL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Parse failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": node})
}

func (s *Server) parseNodeURLsBulk(c *gin.Context) {
	var req struct {
		URLs []string `json:"urls" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	type parseResult struct {
		URL   string        `json:"url"`
		Node  *storage.Node `json:"node,omitempty"`
		Error string        `json:"error,omitempty"`
	}

	results := make([]parseResult, 0, len(req.URLs))
	for _, rawURL := range req.URLs {
		trimmed := strings.TrimSpace(rawURL)
		if trimmed == "" {
			continue
		}
		node, err := parser.ParseURL(trimmed)
		if err != nil {
			results = append(results, parseResult{URL: trimmed, Error: err.Error()})
		} else {
			results = append(results, parseResult{URL: trimmed, Node: node})
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": results})
}

// ==================== Health Check API ====================

// NodeHealthResult represents health check result for a single node
type NodeHealthResult struct {
	Alive        bool           `json:"alive"`
	TCPLatencyMs int64          `json:"tcp_latency_ms"`
	Groups       map[string]int `json:"groups"`
}

// NodeSiteCheckResult represents site reachability check result for a single node.
// Sites map value is delay in ms; 0 means timeout/failure.
type NodeSiteCheckResult struct {
	Sites map[string]int `json:"sites"`
}

// matchFilter checks if a node matches a filter (duplicated from builder for API layer)
func matchFilter(node storage.Node, filter storage.Filter) bool {
	name := strings.ToLower(node.Tag)

	if len(filter.IncludeCountries) > 0 {
		matched := false
		for _, country := range filter.IncludeCountries {
			if strings.EqualFold(node.Country, country) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	for _, country := range filter.ExcludeCountries {
		if strings.EqualFold(node.Country, country) {
			return false
		}
	}

	if len(filter.Include) > 0 {
		matched := false
		for _, keyword := range filter.Include {
			if strings.Contains(name, strings.ToLower(keyword)) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	for _, keyword := range filter.Exclude {
		if strings.Contains(name, strings.ToLower(keyword)) {
			return false
		}
	}

	return true
}

var defaultSiteCheckTargets = []string{
	"chatgpt.com",
	"2ip.ru",
	"youtube.com",
	"instagram.com",
}

func normalizeSiteTarget(site string) string {
	site = strings.TrimSpace(site)
	if site == "" {
		return ""
	}

	// Fast path: plain hostname.
	if !strings.Contains(site, "://") && !strings.Contains(site, "/") {
		return strings.ToLower(site)
	}

	raw := site
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	if u, err := neturl.Parse(raw); err == nil && u.Hostname() != "" {
		return strings.ToLower(u.Hostname())
	}

	site = strings.TrimPrefix(site, "https://")
	site = strings.TrimPrefix(site, "http://")
	if idx := strings.Index(site, "/"); idx >= 0 {
		site = site[:idx]
	}
	return strings.ToLower(site)
}

func sanitizeSiteTargets(raw []string) []string {
	if len(raw) == 0 {
		raw = defaultSiteCheckTargets
	}

	seen := make(map[string]bool, len(raw))
	targets := make([]string, 0, len(raw))
	for _, site := range raw {
		target := normalizeSiteTarget(site)
		if target == "" || seen[target] {
			continue
		}
		seen[target] = true
		targets = append(targets, target)
	}
	return targets
}

func normalizeSiteCheckURL(site string) string {
	site = strings.TrimSpace(site)
	if site == "" {
		return ""
	}
	if strings.HasPrefix(site, "http://") || strings.HasPrefix(site, "https://") {
		return site
	}
	return "https://" + site
}

func (s *Server) clashProxyDelayWithURL(port int, secret, nodeTag, targetURL string, timeoutMs int) int {
	if strings.TrimSpace(targetURL) == "" {
		return 0
	}
	if timeoutMs <= 0 {
		timeoutMs = 5000
	}

	client := &http.Client{Timeout: time.Duration(timeoutMs+2000) * time.Millisecond}
	apiURL := fmt.Sprintf(
		"http://127.0.0.1:%d/proxies/%s/delay?url=%s&timeout=%d",
		port,
		neturl.PathEscape(nodeTag),
		neturl.QueryEscape(targetURL),
		timeoutMs,
	)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0
	}

	var result struct {
		Delay int `json:"delay"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0
	}
	return result.Delay
}

func (s *Server) clashProxyDelay(port int, secret, nodeTag string) int {
	return s.clashProxyDelayWithURL(port, secret, nodeTag, "https://www.gstatic.com/generate_204", 5000)
}

func (s *Server) performHealthCheck(nodes []storage.Node) (map[string]*NodeHealthResult, string, error) {
	// Deduplicate nodes by server:port — check each endpoint only once
	seen := make(map[string]bool, len(nodes))
	uniqueNodes := make([]storage.Node, 0, len(nodes))
	for _, n := range nodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if !seen[key] {
			seen[key] = true
			uniqueNodes = append(uniqueNodes, n)
		}
	}

	port, tagMap, err := s.probeManager.EnsureRunning(uniqueNodes)
	if err != nil {
		return nil, "", err
	}

	results := make(map[string]*NodeHealthResult)
	var mu sync.Mutex
	sem := make(chan struct{}, 50)
	var wg sync.WaitGroup

	for _, node := range uniqueNodes {
		wg.Add(1)
		go func(n storage.Node) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := &NodeHealthResult{
				Groups: make(map[string]int),
			}

			// Use probe tag (unique) instead of original tag (may have duplicates)
			key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
			probeTag := n.Tag
			if tagMap != nil {
				if pt, ok := tagMap.KeyToProbe[key]; ok {
					probeTag = pt
				}
			}

			delay := s.clashProxyDelay(port, "", probeTag)
			if delay > 0 {
				result.Alive = true
			}
			result.TCPLatencyMs = 0
			result.Groups["Proxy"] = delay

			mu.Lock()
			results[key] = result
			mu.Unlock()
		}(node)
	}

	wg.Wait()

	// Auto-save measurements to store (one per unique server:port)
	now := time.Now()
	var measurements []storage.HealthMeasurement
	for _, n := range uniqueNodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if r, ok := results[key]; ok {
			latency := 0
			for _, d := range r.Groups {
				if d > 0 {
					latency = d
					break
				}
			}
			measurements = append(measurements, storage.HealthMeasurement{
				Server:     n.Server,
				ServerPort: n.ServerPort,
				NodeTag:    n.Tag,
				Timestamp:  now,
				Alive:      r.Alive,
				LatencyMs:  latency,
				Mode:       "probe",
			})
		}
	}
	if len(measurements) > 0 {
		if err := s.store.AddHealthMeasurements(measurements); err != nil {
			logger.Printf("[health] Failed to save measurements: %v", err)
		}
	}

	return results, "probe", nil
}

func (s *Server) healthCheckNodes(c *gin.Context) {
	var req struct {
		Tags []string `json:"tags"`
	}
	c.ShouldBindJSON(&req)

	allNodes := s.store.GetAllNodesIncludeDisabled()

	var nodes []storage.Node
	if len(req.Tags) > 0 {
		tagSet := make(map[string]bool)
		for _, t := range req.Tags {
			tagSet[t] = true
		}
		for _, n := range allNodes {
			if tagSet[n.Tag] {
				nodes = append(nodes, n)
			}
		}
	} else {
		nodes = allNodes
	}

	if len(nodes) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"data": map[string]*NodeHealthResult{},
			"mode": "",
		})
		return
	}

	results, mode, err := s.performHealthCheck(nodes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": results, "mode": mode})
}

func (s *Server) healthCheckSingleNode(c *gin.Context) {
	var req struct {
		Tag string `json:"tag" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	allNodes := s.store.GetAllNodesIncludeDisabled()
	var nodes []storage.Node
	for _, n := range allNodes {
		if n.Tag == req.Tag {
			nodes = append(nodes, n)
			break
		}
	}

	if len(nodes) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "node not found"})
		return
	}

	results, mode, err := s.performHealthCheck(nodes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": results, "mode": mode})
}

func (s *Server) performSiteCheck(nodes []storage.Node, targets []string) (map[string]*NodeSiteCheckResult, string, error) {
	// Deduplicate nodes by server:port — check each endpoint only once
	seen := make(map[string]bool, len(nodes))
	uniqueNodes := make([]storage.Node, 0, len(nodes))
	for _, n := range nodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if !seen[key] {
			seen[key] = true
			uniqueNodes = append(uniqueNodes, n)
		}
	}

	port, tagMap, err := s.probeManager.EnsureRunning(uniqueNodes)
	if err != nil {
		return nil, "", err
	}

	results := make(map[string]*NodeSiteCheckResult)
	var mu sync.Mutex
	sem := make(chan struct{}, 80)
	var wg sync.WaitGroup

	for _, node := range uniqueNodes {
		wg.Add(1)
		go func(n storage.Node) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
			probeTag := n.Tag
			if tagMap != nil {
				if pt, ok := tagMap.KeyToProbe[key]; ok {
					probeTag = pt
				}
			}

			result := &NodeSiteCheckResult{
				Sites: make(map[string]int, len(targets)),
			}
			for _, target := range targets {
				result.Sites[target] = s.clashProxyDelayWithURL(port, "", probeTag, normalizeSiteCheckURL(target), 5000)
			}

			mu.Lock()
			results[key] = result
			mu.Unlock()
		}(node)
	}

	wg.Wait()

	// Auto-save site measurements to store (one per unique server:port)
	now := time.Now()
	var measurements []storage.SiteMeasurement
	for _, n := range uniqueNodes {
		key := fmt.Sprintf("%s:%d", n.Server, n.ServerPort)
		if r, ok := results[key]; ok {
			for site, delay := range r.Sites {
				measurements = append(measurements, storage.SiteMeasurement{
					Server:     n.Server,
					ServerPort: n.ServerPort,
					NodeTag:    n.Tag,
					Timestamp:  now,
					Site:       site,
					DelayMs:    delay,
					Mode:       "probe",
				})
			}
		}
	}
	if len(measurements) > 0 {
		if err := s.store.AddSiteMeasurements(measurements); err != nil {
			logger.Printf("[site-check] Failed to save measurements: %v", err)
		}
	}

	return results, "probe", nil
}

func (s *Server) siteCheckNodes(c *gin.Context) {
	var req struct {
		Tags  []string `json:"tags"`
		Sites []string `json:"sites"`
	}
	c.ShouldBindJSON(&req)

	targets := sanitizeSiteTargets(req.Sites)
	if len(targets) == 0 {
		targets = append([]string{}, defaultSiteCheckTargets...)
	}

	allNodes := s.store.GetAllNodesIncludeDisabled()
	var nodes []storage.Node
	if len(req.Tags) > 0 {
		tagSet := make(map[string]bool, len(req.Tags))
		for _, t := range req.Tags {
			tagSet[t] = true
		}
		for _, n := range allNodes {
			if tagSet[n.Tag] {
				nodes = append(nodes, n)
			}
		}
	} else {
		nodes = allNodes
	}

	if len(nodes) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"data":  map[string]*NodeSiteCheckResult{},
			"mode":  "",
			"sites": targets,
		})
		return
	}

	results, mode, err := s.performSiteCheck(nodes, targets)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  results,
		"mode":  mode,
		"sites": targets,
	})
}

// ==================== Unified Node API ====================

func (s *Server) getUnifiedNodes(c *gin.Context) {
	statusStr := c.DefaultQuery("status", "")
	if statusStr == "" {
		// Return all
		pending := s.store.GetNodes(storage.NodeStatusPending)
		verified := s.store.GetNodes(storage.NodeStatusVerified)
		archived := s.store.GetNodes(storage.NodeStatusArchived)
		c.JSON(http.StatusOK, gin.H{
			"pending":  pending,
			"verified": verified,
			"archived": archived,
		})
		return
	}
	nodes := s.store.GetNodes(storage.NodeStatus(statusStr))
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

func (s *Server) addUnifiedNode(c *gin.Context) {
	var node storage.UnifiedNode
	if err := c.ShouldBindJSON(&node); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Deduplication check
	if existing := s.store.GetNodeByServerPort(node.Server, node.ServerPort); existing != nil {
		c.JSON(http.StatusConflict, gin.H{
			"error":    fmt.Sprintf("Node %s:%d already exists as '%s'", node.Server, node.ServerPort, existing.Tag),
			"existing": existing,
		})
		return
	}

	id, err := s.store.AddNode(node)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	node.ID = id

	c.JSON(http.StatusOK, gin.H{"data": node})
}

func (s *Server) addUnifiedNodesBulk(c *gin.Context) {
	var req struct {
		Nodes    []storage.UnifiedNode `json:"nodes" binding:"required"`
		GroupTag string                `json:"group_tag"`
		Source   string                `json:"source"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for i := range req.Nodes {
		if req.GroupTag != "" && req.Nodes[i].GroupTag == "" {
			req.Nodes[i].GroupTag = req.GroupTag
		}
		if req.Source != "" && req.Nodes[i].Source == "" {
			req.Nodes[i].Source = req.Source
		}
	}

	added, err := s.store.AddNodesBulk(req.Nodes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	skipped := len(req.Nodes) - added
	msg := fmt.Sprintf("Added %d nodes", added)
	if skipped > 0 {
		msg += fmt.Sprintf(", skipped %d duplicates", skipped)
	}

	c.JSON(http.StatusOK, gin.H{"added": added, "skipped": skipped, "message": msg})
}

func (s *Server) updateUnifiedNode(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var node storage.UnifiedNode
	if err := c.ShouldBindJSON(&node); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	node.ID = id
	if err := s.store.UpdateNode(node); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Updated, but auto-apply failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

func (s *Server) deleteUnifiedNode(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := s.store.DeleteNode(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Deleted, but auto-apply failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

func (s *Server) promoteUnifiedNode(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := s.store.PromoteNode(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.autoApplyConfig()
	c.JSON(http.StatusOK, gin.H{"message": "Promoted to verified"})
}

func (s *Server) demoteUnifiedNode(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := s.store.DemoteNode(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.autoApplyConfig()
	c.JSON(http.StatusOK, gin.H{"message": "Demoted to pending"})
}

func (s *Server) archiveUnifiedNode(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := s.store.ArchiveNode(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Archived"})
}

func (s *Server) unarchiveUnifiedNode(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := s.store.UnarchiveNode(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Unarchived to pending"})
}

func (s *Server) bulkPromoteNodes(c *gin.Context) {
	var req struct {
		IDs []int64 `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	promoted := 0
	for _, id := range req.IDs {
		if err := s.store.PromoteNode(id); err == nil {
			promoted++
		}
	}
	s.autoApplyConfig()
	c.JSON(http.StatusOK, gin.H{"promoted": promoted, "message": fmt.Sprintf("Promoted %d nodes", promoted)})
}

func (s *Server) bulkArchiveNodes(c *gin.Context) {
	var req struct {
		IDs []int64 `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	archived := 0
	for _, id := range req.IDs {
		if err := s.store.ArchiveNode(id); err == nil {
			archived++
		}
	}
	c.JSON(http.StatusOK, gin.H{"archived": archived, "message": fmt.Sprintf("Archived %d nodes", archived)})
}

func (s *Server) getNodeCounts(c *gin.Context) {
	counts := s.store.GetNodeCounts()
	c.JSON(http.StatusOK, gin.H{"data": counts})
}

// ==================== Verification API ====================

func (s *Server) runVerification(c *gin.Context) {
	go s.RunVerification()
	c.JSON(http.StatusOK, gin.H{"message": "Verification started"})
}

func (s *Server) getVerificationStatus(c *gin.Context) {
	settings := s.store.GetSettings()
	result := gin.H{
		"enabled":            settings.VerificationInterval > 0,
		"interval_min":       settings.VerificationInterval,
		"last_run_at":        s.scheduler.GetLastVerifyTime(),
		"next_run_at":        s.scheduler.GetNextVerifyTime(),
		"node_counts":        s.store.GetNodeCounts(),
		"scheduler_running":  s.scheduler.IsRunning(),
		"sub_update_enabled":     settings.SubscriptionInterval > 0,
		"sub_update_interval_min": settings.SubscriptionInterval,
		"sub_next_update_at":     s.scheduler.GetNextUpdateTime(),
		"auto_apply":             settings.AutoApply,
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (s *Server) startVerificationScheduler(c *gin.Context) {
	status := s.scheduler.Start()
	switch status {
	case service.StartStatusAlreadyRunning:
		c.JSON(http.StatusOK, gin.H{"message": "Scheduler is already running"})
	case service.StartStatusAllDisabled:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot start: both subscription_interval and verification_interval are set to 0 in Settings"})
	default:
		c.JSON(http.StatusOK, gin.H{"message": "Scheduler started"})
	}
}

func (s *Server) stopVerificationScheduler(c *gin.Context) {
	s.scheduler.Stop()
	c.JSON(http.StatusOK, gin.H{"message": "Scheduler stopped"})
}

func (s *Server) getVerificationLogs(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 20
	}
	logs := s.store.GetVerificationLogs(limit)
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// ==================== Kernel Management API ====================

func (s *Server) getKernelInfo(c *gin.Context) {
	info := s.kernelManager.GetInfo()
	c.JSON(http.StatusOK, gin.H{"data": info})
}

func (s *Server) getKernelReleases(c *gin.Context) {
	releases, err := s.kernelManager.FetchReleases()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Only return version and name, not full assets
	type ReleaseInfo struct {
		TagName string `json:"tag_name"`
		Name    string `json:"name"`
	}

	result := make([]ReleaseInfo, len(releases))
	for i, r := range releases {
		result[i] = ReleaseInfo{
			TagName: r.TagName,
			Name:    r.Name,
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (s *Server) startKernelDownload(c *gin.Context) {
	var req struct {
		Version string `json:"version" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.kernelManager.StartDownload(req.Version); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Download started"})
}

func (s *Server) getKernelProgress(c *gin.Context) {
	progress := s.kernelManager.GetProgress()
	c.JSON(http.StatusOK, gin.H{"data": progress})
}

// ==================== Proxy Group Management (Clash API) ====================

func (s *Server) getProxyGroups(c *gin.Context) {
	if !s.processManager.IsRunning() {
		c.JSON(http.StatusOK, gin.H{"data": nil})
		return
	}

	settings := s.store.GetSettings()
	if settings.ClashAPIPort == 0 {
		c.JSON(http.StatusOK, gin.H{"data": nil})
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/proxies", settings.ClashAPIPort)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if settings.ClashAPISecret != "" {
		req.Header.Set("Authorization", "Bearer "+settings.ClashAPISecret)
	}

	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to connect to Clash API: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var clashResp struct {
		Proxies map[string]struct {
			Type    string   `json:"type"`
			Now     string   `json:"now"`
			All     []string `json:"all"`
			History []struct {
				Delay int `json:"delay"`
			} `json:"history"`
		} `json:"proxies"`
	}
	if err := json.Unmarshal(body, &clashResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse Clash API response: " + err.Error()})
		return
	}

	type ProxyGroup struct {
		Name string   `json:"name"`
		Type string   `json:"type"`
		Now  string   `json:"now"`
		All  []string `json:"all"`
	}

	var groups []ProxyGroup
	for name, proxy := range clashResp.Proxies {
		if proxy.Type == "Selector" || proxy.Type == "selector" {
			groups = append(groups, ProxyGroup{
				Name: name,
				Type: proxy.Type,
				Now:  proxy.Now,
				All:  proxy.All,
			})
		}
	}

	// Sort: "Proxy" first, then alphabetical
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].Name == "Proxy" {
			return true
		}
		if groups[j].Name == "Proxy" {
			return false
		}
		return groups[i].Name < groups[j].Name
	})

	c.JSON(http.StatusOK, gin.H{"data": groups})
}

func (s *Server) switchProxyGroup(c *gin.Context) {
	if !s.processManager.IsRunning() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sing-box is not running"})
		return
	}

	groupName := c.Param("name")
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	settings := s.store.GetSettings()
	if settings.ClashAPIPort == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Clash API port is not configured"})
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	reqBody, _ := json.Marshal(map[string]string{"name": req.Name})
	apiURL := fmt.Sprintf("http://127.0.0.1:%d/proxies/%s", settings.ClashAPIPort, neturl.PathEscape(groupName))
	httpReq, err := http.NewRequest("PUT", apiURL, strings.NewReader(string(reqBody)))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if settings.ClashAPISecret != "" {
		httpReq.Header.Set("Authorization", "Bearer "+settings.ClashAPISecret)
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to connect to Clash API: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Clash API error: " + string(body)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Proxy switched"})
}

func (s *Server) getProxyDelay(c *gin.Context) {
	if !s.processManager.IsRunning() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sing-box is not running"})
		return
	}

	proxyName := c.Param("name")
	if strings.TrimSpace(proxyName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "proxy name is required"})
		return
	}

	settings := s.store.GetSettings()
	if settings.ClashAPIPort == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Clash API port is not configured"})
		return
	}

	delay := s.clashProxyDelay(settings.ClashAPIPort, settings.ClashAPISecret, proxyName)
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"name":  proxyName,
			"delay": delay,
		},
	})
}

// ==================== Debug API ====================

func (s *Server) debugDump(c *gin.Context) {
	settings := s.store.GetSettings()
	if !settings.DebugAPIEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "Debug API is disabled. Enable it in Settings."})
		return
	}

	subscriptions := s.store.GetSubscriptions()
	nodeCounts := s.store.GetNodeCounts()
	filters := s.store.GetFilters()
	rules := s.store.GetRules()
	ruleGroups := s.store.GetRuleGroups()
	countryGroups := s.store.GetCountryGroups()

	// Unified nodes by status
	pendingNodes := s.store.GetNodes(storage.NodeStatusPending)
	verifiedNodes := s.store.GetNodes(storage.NodeStatusVerified)
	archivedNodes := s.store.GetNodes(storage.NodeStatusArchived)

	// Verification logs (last 20)
	verificationLogs := s.store.GetVerificationLogs(20)

	// Unsupported nodes
	s.unsupportedNodesMu.RLock()
	unsupported := make([]UnsupportedNodeInfo, 0, len(s.unsupportedNodes))
	for _, info := range s.unsupportedNodes {
		unsupported = append(unsupported, info)
	}
	s.unsupportedNodesMu.RUnlock()

	// Service status
	serviceRunning := s.processManager.IsRunning()
	servicePID := 0
	if serviceRunning {
		servicePID = s.processManager.GetPID()
	}

	// Runtime info
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	type debugServiceStatus struct {
		Running bool `json:"running"`
		PID     int  `json:"pid"`
	}
	type debugRuntime struct {
		Version    string  `json:"version"`
		GoVersion  string  `json:"go_version"`
		OS         string  `json:"os"`
		Arch       string  `json:"arch"`
		Goroutines int     `json:"goroutines"`
		MemAllocMB float64 `json:"mem_alloc_mb"`
		MemSysMB   float64 `json:"mem_sys_mb"`
	}
	type debugSchedulerStatus struct {
		Running              bool       `json:"running"`
		SubUpdateEnabled     bool       `json:"sub_update_enabled"`
		SubUpdateIntervalMin int        `json:"sub_update_interval_min"`
		SubNextUpdateAt      *time.Time `json:"sub_next_update_at,omitempty"`
		VerifyEnabled        bool       `json:"verify_enabled"`
		VerifyIntervalMin    int        `json:"verify_interval_min"`
		LastVerifyAt         *time.Time `json:"last_verify_at,omitempty"`
		NextVerifyAt         *time.Time `json:"next_verify_at,omitempty"`
	}
	type debugDumpData struct {
		// System info first
		Timestamp        time.Time                `json:"timestamp"`
		Runtime          debugRuntime             `json:"runtime"`
		Service          debugServiceStatus       `json:"service"`
		Probe            daemon.ProbeStatus       `json:"probe"`
		Scheduler        debugSchedulerStatus     `json:"scheduler"`
		Settings         interface{}              `json:"settings"`
		// Data
		Subscriptions    interface{}              `json:"subscriptions"`
		NodeCounts       interface{}              `json:"node_counts"`
		PendingNodes     []storage.UnifiedNode    `json:"pending_nodes"`
		VerifiedNodes    []storage.UnifiedNode    `json:"verified_nodes"`
		ArchivedNodes    []storage.UnifiedNode    `json:"archived_nodes"`
		Filters          interface{}              `json:"filters"`
		Rules            interface{}              `json:"rules"`
		RuleGroups       interface{}              `json:"rule_groups"`
		CountryGroups    interface{}              `json:"country_groups"`
		UnsupportedNodes []UnsupportedNodeInfo    `json:"unsupported_nodes"`
		VerificationLogs []storage.VerificationLog `json:"verification_logs"`
	}

	c.JSON(http.StatusOK, gin.H{
		"data": debugDumpData{
			Timestamp: time.Now().UTC(),
			Runtime: debugRuntime{
				Version:    s.version,
				GoVersion:  runtime.Version(),
				OS:         runtime.GOOS,
				Arch:       runtime.GOARCH,
				Goroutines: runtime.NumGoroutine(),
				MemAllocMB: float64(memStats.Alloc) / 1024 / 1024,
				MemSysMB:   float64(memStats.Sys) / 1024 / 1024,
			},
			Service: debugServiceStatus{
				Running: serviceRunning,
				PID:     servicePID,
			},
			Probe: s.probeManager.Status(),
			Scheduler: debugSchedulerStatus{
				Running:              s.scheduler.IsRunning(),
				SubUpdateEnabled:     settings.SubscriptionInterval > 0,
				SubUpdateIntervalMin: settings.SubscriptionInterval,
				SubNextUpdateAt:      s.scheduler.GetNextUpdateTime(),
				VerifyEnabled:        settings.VerificationInterval > 0,
				VerifyIntervalMin:    settings.VerificationInterval,
				LastVerifyAt:         s.scheduler.GetLastVerifyTime(),
				NextVerifyAt:         s.scheduler.GetNextVerifyTime(),
			},
			Settings:         settings,
			Subscriptions:    subscriptions,
			NodeCounts:       nodeCounts,
			PendingNodes:     pendingNodes,
			VerifiedNodes:    verifiedNodes,
			ArchivedNodes:    archivedNodes,
			Filters:          filters,
			Rules:            rules,
			RuleGroups:       ruleGroups,
			CountryGroups:    countryGroups,
			UnsupportedNodes: unsupported,
			VerificationLogs: verificationLogs,
		},
	})
}

func (s *Server) debugSingboxLogs(c *gin.Context) {
	settings := s.store.GetSettings()
	if !settings.DebugAPIEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "Debug API is disabled. Enable it in Settings."})
		return
	}

	lines := 500
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
			if n > 5000 {
				n = 5000
			}
			lines = n
		}
	}

	logs, err := logger.ReadSingboxLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

func (s *Server) debugAppLogs(c *gin.Context) {
	settings := s.store.GetSettings()
	if !settings.DebugAPIEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "Debug API is disabled. Enable it in Settings."})
		return
	}

	lines := 500
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
			if n > 5000 {
				n = 5000
			}
			lines = n
		}
	}

	logs, err := logger.ReadAppLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

func (s *Server) debugProbeLogs(c *gin.Context) {
	settings := s.store.GetSettings()
	if !settings.DebugAPIEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "Debug API is disabled. Enable it in Settings."})
		return
	}

	lines := 500
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
			if n > 5000 {
				n = 5000
			}
			lines = n
		}
	}

	logs, err := logger.ReadProbeLogs(lines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// ==================== Probe Management API ====================

func (s *Server) getProbeStatus(c *gin.Context) {
	status := s.probeManager.Status()
	c.JSON(http.StatusOK, gin.H{"data": status})
}

func (s *Server) stopProbe(c *gin.Context) {
	s.probeManager.Stop()
	s.eventBus.PublishTimestamped("probe:stopped", nil)
	c.JSON(http.StatusOK, gin.H{"message": "Probe stopped"})
}

// ==================== SSE Event Stream ====================

func (s *Server) handleEventStream(c *gin.Context) {
	subID := fmt.Sprintf("sse-%d", time.Now().UnixNano())
	sub := s.eventBus.Subscribe(subID)
	defer s.eventBus.Unsubscribe(subID)

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	// Send initial ping
	c.SSEvent("ping", "connected")
	c.Writer.Flush()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	clientGone := c.Request.Context().Done()

	for {
		select {
		case <-clientGone:
			return
		case <-ticker.C:
			c.SSEvent("ping", "keepalive")
			c.Writer.Flush()
		case event, ok := <-sub.Events:
			if !ok {
				return
			}
			c.SSEvent(event.Type, string(event.MarshalData()))
			c.Writer.Flush()
		}
	}
}

// ==================== Measurements API ====================

func (s *Server) getHealthMeasurements(c *gin.Context) {
	server := c.Query("server")
	port, _ := strconv.Atoi(c.Query("port"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if server == "" || port == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server and port required"})
		return
	}
	measurements, err := s.store.GetHealthMeasurements(server, port, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": measurements})
}

func (s *Server) getHealthStats(c *gin.Context) {
	server := c.Query("server")
	port, _ := strconv.Atoi(c.Query("port"))
	if server == "" || port == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server and port required"})
		return
	}
	stats, err := s.store.GetHealthStats(server, port)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

func (s *Server) getBulkHealthStats(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	stats, err := s.store.GetBulkHealthStats(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if stats == nil {
		stats = []storage.NodeStabilityStats{}
	}
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

func (s *Server) saveHealthMeasurements(c *gin.Context) {
	var req struct {
		Measurements []storage.HealthMeasurement `json:"measurements"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.store.AddHealthMeasurements(req.Measurements); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Saved %d measurements", len(req.Measurements))})
}

func (s *Server) getSiteMeasurements(c *gin.Context) {
	server := c.Query("server")
	port, _ := strconv.Atoi(c.Query("port"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if server == "" || port == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server and port required"})
		return
	}
	measurements, err := s.store.GetSiteMeasurements(server, port, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": measurements})
}

func (s *Server) saveSiteMeasurements(c *gin.Context) {
	var req struct {
		Measurements []storage.SiteMeasurement `json:"measurements"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := s.store.AddSiteMeasurements(req.Measurements); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Saved %d measurements", len(req.Measurements))})
}

func (s *Server) importMeasurements(c *gin.Context) {
	var req struct {
		HealthHistory    map[string][]json.RawMessage `json:"healthHistory"`
		SiteCheckHistory map[string][]json.RawMessage `json:"siteCheckHistory"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build tag→Node lookup
	allNodes := s.store.GetAllNodesIncludeDisabled()
	tagToNode := make(map[string]storage.Node)
	for _, n := range allNodes {
		tagToNode[n.Tag] = n
	}

	imported := 0
	failed := 0

	// Import health history
	for tag, entries := range req.HealthHistory {
		node, ok := tagToNode[tag]
		if !ok {
			continue
		}
		var measurements []storage.HealthMeasurement
		for _, raw := range entries {
			var entry struct {
				Timestamp string `json:"timestamp"`
				Mode      string `json:"mode"`
				Result    struct {
					Alive      bool           `json:"alive"`
					Groups     map[string]int `json:"groups"`
				} `json:"result"`
			}
			if json.Unmarshal(raw, &entry) != nil {
				continue
			}
			ts, _ := time.Parse(time.RFC3339, entry.Timestamp)
			latency := 0
			for _, d := range entry.Result.Groups {
				if d > 0 {
					latency = d
					break
				}
			}
			measurements = append(measurements, storage.HealthMeasurement{
				Server:     node.Server,
				ServerPort: node.ServerPort,
				NodeTag:    tag,
				Timestamp:  ts,
				Alive:      entry.Result.Alive,
				LatencyMs:  latency,
				Mode:       entry.Mode,
			})
		}
		if len(measurements) > 0 {
			if err := s.store.AddHealthMeasurements(measurements); err != nil {
				logger.Printf("[import] Failed to save health measurements for %s: %v", tag, err)
				failed += len(measurements)
			} else {
				imported += len(measurements)
			}
		}
	}

	// Import site history
	for tag, entries := range req.SiteCheckHistory {
		node, ok := tagToNode[tag]
		if !ok {
			continue
		}
		var measurements []storage.SiteMeasurement
		for _, raw := range entries {
			var entry struct {
				Timestamp string `json:"timestamp"`
				Mode      string `json:"mode"`
				Result    struct {
					Sites map[string]int `json:"sites"`
				} `json:"result"`
			}
			if json.Unmarshal(raw, &entry) != nil {
				continue
			}
			ts, _ := time.Parse(time.RFC3339, entry.Timestamp)
			for site, delay := range entry.Result.Sites {
				measurements = append(measurements, storage.SiteMeasurement{
					Server:     node.Server,
					ServerPort: node.ServerPort,
					NodeTag:    tag,
					Timestamp:  ts,
					Site:       site,
					DelayMs:    delay,
					Mode:       entry.Mode,
				})
			}
		}
		if len(measurements) > 0 {
			if err := s.store.AddSiteMeasurements(measurements); err != nil {
				logger.Printf("[import] Failed to save site measurements for %s: %v", tag, err)
				failed += len(measurements)
			} else {
				imported += len(measurements)
			}
		}
	}

	if failed > 0 {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":    fmt.Sprintf("Partial import: %d saved, %d failed", imported, failed),
			"imported": imported,
			"failed":   failed,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Imported %d measurements", imported), "imported": imported})
}
