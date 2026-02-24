package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/xiaobei/singbox-manager/internal/api"
	"github.com/xiaobei/singbox-manager/internal/daemon"
	"github.com/xiaobei/singbox-manager/internal/logger"
	"github.com/xiaobei/singbox-manager/internal/storage"
)

var (
	version = "0.2.13"
	dataDir string
	port    int
)

func init() {
	// Get default data directory
	homeDir, _ := os.UserHomeDir()
	defaultDataDir := filepath.Join(homeDir, ".singbox-manager")

	flag.StringVar(&dataDir, "data", defaultDataDir, "Data directory")
	flag.IntVar(&port, "port", 9090, "Web service port")
}

func main() {
	flag.Parse()

	// Convert dataDir to absolute path to avoid relative path errors in child processes
	var err error
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to get absolute path: %v\n", err)
		os.Exit(1)
	}

	// Get the absolute path of the current executable (for launchd installation)
	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to get executable file path: %v\n", err)
		os.Exit(1)
	}
	execPath, _ = filepath.EvalSymlinks(execPath)

	// Initialize logging system
	if err := logger.InitLogManager(dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logging system: %v\n", err)
		os.Exit(1)
	}

	// Print startup information
	logger.Printf("singbox-manager v%s", version)
	logger.Printf("Data directory: %s", dataDir)
	logger.Printf("Web port: %d", port)

	// Initialize storage
	store, err := storage.NewJSONStore(dataDir)
	if err != nil {
		logger.Printf("Failed to initialize storage: %v", err)
		os.Exit(1)
	}

	// Initialize process manager
	// sing-box binary file path is fixed at dataDir/bin/sing-box
	singboxPath := filepath.Join(dataDir, "bin", "sing-box")
	configPath := filepath.Join(dataDir, "generated", "config.json")
	processManager := daemon.NewProcessManager(singboxPath, configPath, dataDir)

	// Initialize launchd manager
	launchdManager, err := daemon.NewLaunchdManager()
	if err != nil {
		logger.Printf("Failed to initialize launchd manager: %v", err)
	}

	// Initialize systemd manager
	systemdManager, err := daemon.NewSystemdManager()
	if err != nil {
		logger.Printf("Failed to initialize systemd manager: %v", err)
	}

	// Create API server
	server := api.NewServer(store, processManager, launchdManager, systemdManager, execPath, port, version)

	// Start task scheduler
	server.StartScheduler()

	// Start service
	addr := fmt.Sprintf(":%d", port)
	logger.Printf("Starting Web service: http://0.0.0.0%s", addr)

	if err := server.Run(addr); err != nil {
		logger.Printf("Failed to start service: %v", err)
		os.Exit(1)
	}
}
