package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
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

// Server represents the API server
type Server struct {
	store          *storage.JSONStore
	subService     *service.SubscriptionService
	processManager *daemon.ProcessManager
	launchdManager *daemon.LaunchdManager
	systemdManager *daemon.SystemdManager
	kernelManager  *kernel.Manager
	scheduler      *service.Scheduler
	router         *gin.Engine
	sbmPath        string // sbm executable path
	port           int    // Web service port
	version        string // sbm version
}

// NewServer creates an API server
func NewServer(store *storage.JSONStore, processManager *daemon.ProcessManager, launchdManager *daemon.LaunchdManager, systemdManager *daemon.SystemdManager, sbmPath string, port int, version string) *Server {
	gin.SetMode(gin.ReleaseMode)

	subService := service.NewSubscriptionService(store)

	// Create kernel manager
	kernelManager := kernel.NewManager(store.GetDataDir(), store.GetSettings)

	s := &Server{
		store:          store,
		subService:     subService,
		processManager: processManager,
		launchdManager: launchdManager,
		systemdManager: systemdManager,
		kernelManager:  kernelManager,
		scheduler:      service.NewScheduler(store, subService),
		router:         gin.Default(),
		sbmPath:        sbmPath,
		port:           port,
		version:        version,
	}

	// Set scheduler update callback
	s.scheduler.SetUpdateCallback(s.autoApplyConfig)

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
		api.PUT("/rules/:id", s.updateRule)
		api.DELETE("/rules/:id", s.deleteRule)

		// Rule group management
		api.GET("/rule-groups", s.getRuleGroups)
		api.PUT("/rule-groups/:id", s.updateRuleGroup)

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

		// Nodes
		api.GET("/nodes", s.getAllNodes)
		api.GET("/nodes/countries", s.getCountryGroups)
		api.GET("/nodes/country/:code", s.getNodesByCountry)
		api.POST("/nodes/parse", s.parseNodeURL)
		api.POST("/nodes/parse-bulk", s.parseNodeURLsBulk)
		api.POST("/nodes/health-check", s.healthCheckNodes)
		api.POST("/nodes/health-check-single", s.healthCheckSingleNode)

		// Manual nodes
		api.GET("/manual-nodes", s.getManualNodes)
		api.POST("/manual-nodes", s.addManualNode)
		api.POST("/manual-nodes/bulk", s.addManualNodesBulk)
		api.PUT("/manual-nodes/:id", s.updateManualNode)
		api.DELETE("/manual-nodes/:id", s.deleteManualNode)
		api.POST("/manual-nodes/export", s.exportManualNodes)

		// Kernel management
		api.GET("/kernel/info", s.getKernelInfo)
		api.GET("/kernel/releases", s.getKernelReleases)
		api.POST("/kernel/download", s.startKernelDownload)
		api.GET("/kernel/progress", s.getKernelProgress)
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
	configJSON, err := s.buildConfig()
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

	// Check config
	if err := s.processManager.Check(); err != nil {
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

	c.JSON(http.StatusOK, gin.H{"message": "Config applied"})
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

	// Generate config
	configJSON, err := s.buildConfig()
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

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (s *Server) getLogs(c *gin.Context) {
	lines := 200 // Default to 200 lines
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
			lines = n
		}
	}

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
	lines := 200 // Default to 200 lines
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
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

// getSingboxLogs gets sing-box logs
func (s *Server) getSingboxLogs(c *gin.Context) {
	lines := 200 // Default to 200 lines
	if linesParam := c.Query("lines"); linesParam != "" {
		if n, err := strconv.Atoi(linesParam); err == nil && n > 0 {
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

func (s *Server) tcpCheck(server string, port int) (alive bool, latencyMs int64) {
	addr := net.JoinHostPort(server, strconv.Itoa(port))
	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return false, 0
	}
	conn.Close()
	return true, time.Since(start).Milliseconds()
}

func (s *Server) clashProxyDelay(port int, secret, nodeTag string) int {
	client := &http.Client{Timeout: 7 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/proxies/%s/delay?url=https://www.gstatic.com/generate_204&timeout=5000", port, nodeTag)

	req, err := http.NewRequest("GET", url, nil)
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

// buildHealthCheckConfig builds a minimal sing-box config for health checking.
// It contains only outbounds (DIRECT + node outbounds + Proxy urltest) and Clash API.
func buildHealthCheckConfig(nodes []storage.Node, clashAPIPort int) *builder.SingBoxConfig {
	outbounds := []builder.Outbound{
		{"type": "direct", "tag": "DIRECT"},
		{"type": "block", "tag": "REJECT"},
	}

	var nodeTags []string
	for _, n := range nodes {
		outbounds = append(outbounds, builder.NodeToOutbound(n))
		nodeTags = append(nodeTags, n.Tag)
	}

	// Proxy urltest group over all nodes
	if len(nodeTags) > 0 {
		outbounds = append(outbounds, builder.Outbound{
			"type":       "urltest",
			"tag":        "Proxy",
			"outbounds":  nodeTags,
			"url":        "https://www.gstatic.com/generate_204",
			"interval":   "5m",
			"tolerance":  50,
		})
	}

	return &builder.SingBoxConfig{
		Log: &builder.LogConfig{Level: "warn", Timestamp: true},
		Outbounds: outbounds,
		Experimental: &builder.ExperimentalConfig{
			ClashAPI: &builder.ClashAPIConfig{
				ExternalController: fmt.Sprintf("127.0.0.1:%d", clashAPIPort),
				DefaultMode:        "rule",
			},
		},
	}
}

// getFreePort finds and returns a free TCP port on localhost.
func getFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port, nil
}

// performHealthCheckWithTempSingbox starts a temporary sing-box instance,
// runs Clash API health checks, then stops and cleans up.
func (s *Server) performHealthCheckWithTempSingbox(nodes []storage.Node) (map[string]*NodeHealthResult, error) {
	singboxPath := s.processManager.GetSingBoxPath()
	if _, err := os.Stat(singboxPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("sing-box binary not found: %s", singboxPath)
	}

	// Find a free port for the temporary Clash API
	port, err := getFreePort()
	if err != nil {
		return nil, fmt.Errorf("failed to find free port: %w", err)
	}

	// Build minimal config
	cfg := buildHealthCheckConfig(nodes, port)
	cfgJSON, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal config: %w", err)
	}

	// Write to temp file
	tmpFile, err := os.CreateTemp("", "sbm-healthcheck-*.json")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := tmpFile.Write(cfgJSON); err != nil {
		tmpFile.Close()
		return nil, fmt.Errorf("failed to write config: %w", err)
	}
	tmpFile.Close()

	// Start temporary sing-box
	logger.Printf("[health-check] Starting temporary sing-box on port %d for %d nodes", port, len(nodes))
	cmd := exec.Command(singboxPath, "run", "-c", tmpPath)

	// Pipe sing-box output to singbox log (visible in web panel)
	var singboxLogger *logger.Logger
	if logManager := logger.GetLogManager(); logManager != nil {
		singboxLogger = logManager.SingboxLogger()
	}
	if singboxLogger != nil {
		cmd.Stdout = singboxLogger
		cmd.Stderr = singboxLogger
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start sing-box: %w", err)
	}
	logger.Printf("[health-check] Temporary sing-box started, PID: %d", cmd.Process.Pid)

	// Ensure cleanup
	defer func() {
		cmd.Process.Kill()
		cmd.Wait()
		logger.Printf("[health-check] Temporary sing-box stopped")
	}()

	// Wait for Clash API to become ready (poll every 100ms, timeout 5s)
	ready := false
	client := &http.Client{Timeout: 1 * time.Second}
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
		if err == nil {
			resp.Body.Close()
			ready = true
			logger.Printf("[health-check] Clash API ready after %dms", (i+1)*100)
			break
		}
	}
	if !ready {
		logger.Printf("[health-check] Clash API did not become ready within 5s")
		return nil, fmt.Errorf("temporary sing-box did not become ready within 5s")
	}

	// Run Clash API health checks in parallel
	results := make(map[string]*NodeHealthResult)
	var mu sync.Mutex
	sem := make(chan struct{}, 50)
	var wg sync.WaitGroup

	for _, node := range nodes {
		wg.Add(1)
		go func(n storage.Node) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := &NodeHealthResult{
				Groups: make(map[string]int),
			}

			// TCP check
			alive, tcpLatency := s.tcpCheck(n.Server, n.ServerPort)
			result.Alive = alive
			result.TCPLatencyMs = tcpLatency

			// Clash API delay check via temporary instance
			delay := s.clashProxyDelay(port, "", n.Tag)
			if delay > 0 {
				result.Alive = true
			}
			result.Groups["Proxy"] = delay

			mu.Lock()
			results[n.Tag] = result
			mu.Unlock()
		}(node)
	}

	wg.Wait()
	logger.Printf("[health-check] Health check completed for %d nodes", len(nodes))
	return results, nil
}

func (s *Server) performHealthCheck(nodes []storage.Node) (map[string]*NodeHealthResult, string) {
	results := make(map[string]*NodeHealthResult)
	var mu sync.Mutex

	isRunning := s.processManager.IsRunning()

	// When sing-box is not running, try temporary instance for real proxy checks
	if !isRunning {
		tempResults, err := s.performHealthCheckWithTempSingbox(nodes)
		if err != nil {
			logger.Printf("Temporary sing-box health check failed, falling back to TCP: %v", err)
		} else {
			return tempResults, "clash_api_temp"
		}
	}

	mode := "tcp"
	if isRunning {
		mode = "clash_api"
	}

	settings := s.store.GetSettings()
	filters := s.store.GetFilters()

	// Semaphore for concurrency limit
	sem := make(chan struct{}, 50)
	var wg sync.WaitGroup

	for _, node := range nodes {
		wg.Add(1)
		go func(n storage.Node) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := &NodeHealthResult{
				Groups: make(map[string]int),
			}

			// TCP check
			alive, tcpLatency := s.tcpCheck(n.Server, n.ServerPort)
			result.Alive = alive
			result.TCPLatencyMs = tcpLatency

			// Clash API check
			if isRunning {
				// Check delay through each matching enabled filter
				for _, filter := range filters {
					if !filter.Enabled {
						continue
					}
					if matchFilter(n, filter) {
						delay := s.clashProxyDelay(settings.ClashAPIPort, settings.ClashAPISecret, n.Tag)
						if delay > 0 {
							result.Alive = true
						}
						result.Groups[filter.Name] = delay
					}
				}

				// Also check via main Proxy group
				delay := s.clashProxyDelay(settings.ClashAPIPort, settings.ClashAPISecret, n.Tag)
				if delay > 0 {
					result.Alive = true
					result.Groups["Proxy"] = delay
				}
			}

			mu.Lock()
			results[n.Tag] = result
			mu.Unlock()
		}(node)
	}

	wg.Wait()
	return results, mode
}

func (s *Server) healthCheckNodes(c *gin.Context) {
	var req struct {
		Tags []string `json:"tags"`
	}
	c.ShouldBindJSON(&req)

	allNodes := s.store.GetAllNodes()

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

	results, mode := s.performHealthCheck(nodes)
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

	allNodes := s.store.GetAllNodes()
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

	results, mode := s.performHealthCheck(nodes)
	c.JSON(http.StatusOK, gin.H{"data": results, "mode": mode})
}

// ==================== Manual Node API ====================

func (s *Server) getManualNodes(c *gin.Context) {
	nodes := s.store.GetManualNodes()
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

func (s *Server) addManualNode(c *gin.Context) {
	var node storage.ManualNode
	if err := c.ShouldBindJSON(&node); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate ID
	node.ID = uuid.New().String()

	if err := s.store.AddManualNode(node); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": node, "warning": "Added successfully, but auto-apply config failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": node})
}

func (s *Server) addManualNodesBulk(c *gin.Context) {
	var req struct {
		Nodes []storage.ManualNode `json:"nodes" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for i := range req.Nodes {
		req.Nodes[i].ID = uuid.New().String()
		if err := s.store.AddManualNode(req.Nodes[i]); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	// Auto-apply config
	if err := s.autoApplyConfig(); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": req.Nodes, "warning": fmt.Sprintf("Added %d nodes, but auto-apply config failed: %s", len(req.Nodes), err.Error())})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": req.Nodes})
}

func (s *Server) updateManualNode(c *gin.Context) {
	id := c.Param("id")

	var node storage.ManualNode
	if err := c.ShouldBindJSON(&node); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	node.ID = id
	if err := s.store.UpdateManualNode(node); err != nil {
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

func (s *Server) deleteManualNode(c *gin.Context) {
	id := c.Param("id")

	if err := s.store.DeleteManualNode(id); err != nil {
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

func (s *Server) exportManualNodes(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids"`
	}
	_ = c.ShouldBindJSON(&req)

	nodes := s.store.GetManualNodes()

	// If specific IDs provided, filter
	if len(req.IDs) > 0 {
		idSet := make(map[string]bool, len(req.IDs))
		for _, id := range req.IDs {
			idSet[id] = true
		}
		filtered := make([]storage.ManualNode, 0, len(req.IDs))
		for _, mn := range nodes {
			if idSet[mn.ID] {
				filtered = append(filtered, mn)
			}
		}
		nodes = filtered
	}

	urls := make([]string, 0, len(nodes))
	for _, mn := range nodes {
		u, err := parser.SerializeNode(&mn.Node)
		if err != nil {
			continue
		}
		urls = append(urls, u)
	}

	c.JSON(http.StatusOK, gin.H{"data": urls})
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
