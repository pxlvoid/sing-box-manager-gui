package logger

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	// Default max log file size 10MB
	DefaultMaxSize = 10 * 1024 * 1024
	// Default number of log files to retain
	DefaultMaxBackups = 3
)

// Logger manages log operations
type Logger struct {
	mu          sync.Mutex
	file        *os.File
	filePath    string
	maxSize     int64
	maxBackups  int
	currentSize int64
	logger      *log.Logger
	prefix      string
}

// LogManager handles global log management
type LogManager struct {
	dataDir       string
	appLogger     *Logger
	singboxLogger *Logger
}

var (
	// Global log manager instance
	manager *LogManager
	once    sync.Once
)

// NewLogger creates a new logger
func NewLogger(filePath string, prefix string) (*Logger, error) {
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %w", err)
	}

	l := &Logger{
		filePath:   filePath,
		maxSize:    DefaultMaxSize,
		maxBackups: DefaultMaxBackups,
		prefix:     prefix,
	}

	if err := l.openFile(); err != nil {
		return nil, err
	}

	return l, nil
}

// openFile opens or creates a log file
func (l *Logger) openFile() error {
	file, err := os.OpenFile(l.filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return fmt.Errorf("failed to get file info: %w", err)
	}

	l.file = file
	l.currentSize = info.Size()
	l.logger = log.New(file, l.prefix, log.LstdFlags)

	return nil
}

// rotate rotates log files
func (l *Logger) rotate() error {
	if l.file != nil {
		l.file.Close()
	}

	// Delete oldest backup
	oldestBackup := fmt.Sprintf("%s.%d", l.filePath, l.maxBackups)
	os.Remove(oldestBackup)

	// Move existing backups
	for i := l.maxBackups - 1; i >= 1; i-- {
		oldPath := fmt.Sprintf("%s.%d", l.filePath, i)
		newPath := fmt.Sprintf("%s.%d", l.filePath, i+1)
		os.Rename(oldPath, newPath)
	}

	// Move current log to .1
	os.Rename(l.filePath, l.filePath+".1")

	// Create new file
	return l.openFile()
}

// Write implements the io.Writer interface
func (l *Logger) Write(p []byte) (n int, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Check if rotation is needed
	if l.currentSize+int64(len(p)) > l.maxSize {
		if err := l.rotate(); err != nil {
			return 0, err
		}
	}

	n, err = l.file.Write(p)
	l.currentSize += int64(n)
	return
}

// Printf outputs formatted log message
func (l *Logger) Printf(format string, v ...interface{}) {
	timestamp := time.Now().Format("2006/01/02 15:04:05")
	msg := fmt.Sprintf(format, v...)
	line := fmt.Sprintf("%s %s%s\n", timestamp, l.prefix, msg)

	// Write to file
	l.Write([]byte(line))

	// Also output to console
	fmt.Print(line)
}

// Println outputs a log line
func (l *Logger) Println(v ...interface{}) {
	timestamp := time.Now().Format("2006/01/02 15:04:05")
	msg := fmt.Sprint(v...)
	line := fmt.Sprintf("%s %s%s\n", timestamp, l.prefix, msg)

	// Write to file
	l.Write([]byte(line))

	// Also output to console
	fmt.Print(line)
}

// WriteRaw writes raw log lines (without timestamp, for sing-box output)
// Only writes to file, does not output to console to avoid mixing with program logs
func (l *Logger) WriteRaw(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	data := line + "\n"

	// Check if rotation is needed
	if l.currentSize+int64(len(data)) > l.maxSize {
		if err := l.rotate(); err != nil {
			fmt.Fprintf(os.Stderr, "log rotation failed: %v\n", err)
			return
		}
	}

	n, _ := l.file.Write([]byte(data))
	l.currentSize += int64(n)
}

// Close closes the log file
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.file != nil {
		return l.file.Close()
	}
	return nil
}

// ReadLastLines reads the last n lines from the log
func (l *Logger) ReadLastLines(n int) ([]string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Sync file
	if l.file != nil {
		l.file.Sync()
	}

	// Read file
	file, err := os.Open(l.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	// Use ring buffer to store last n lines
	lines := make([]string, 0, n)
	scanner := bufio.NewScanner(file)

	// Increase scanner buffer size to handle long lines
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("failed to read logs: %w", err)
	}

	return lines, nil
}

// GetFilePath returns the log file path
func (l *Logger) GetFilePath() string {
	return l.filePath
}

// InitLogManager initializes the global log manager
func InitLogManager(dataDir string) error {
	var initErr error
	once.Do(func() {
		logsDir := filepath.Join(dataDir, "logs")

		appLogger, err := NewLogger(filepath.Join(logsDir, "sbm.log"), "[SBM] ")
		if err != nil {
			initErr = fmt.Errorf("failed to initialize app logger: %w", err)
			return
		}

		singboxLogger, err := NewLogger(filepath.Join(logsDir, "singbox.log"), "")
		if err != nil {
			initErr = fmt.Errorf("failed to initialize sing-box logger: %w", err)
			return
		}

		manager = &LogManager{
			dataDir:       dataDir,
			appLogger:     appLogger,
			singboxLogger: singboxLogger,
		}
	})

	return initErr
}

// GetLogManager returns the global log manager
func GetLogManager() *LogManager {
	return manager
}

// AppLogger returns the app logger
func (m *LogManager) AppLogger() *Logger {
	return m.appLogger
}

// SingboxLogger returns the sing-box logger
func (m *LogManager) SingboxLogger() *Logger {
	return m.singboxLogger
}

// Printf app log shortcut method
func Printf(format string, v ...interface{}) {
	if manager != nil && manager.appLogger != nil {
		manager.appLogger.Printf(format, v...)
	} else {
		log.Printf(format, v...)
	}
}

// Println app log shortcut method
func Println(v ...interface{}) {
	if manager != nil && manager.appLogger != nil {
		manager.appLogger.Println(v...)
	} else {
		log.Println(v...)
	}
}

// SingboxWriter returns a Writer that can be used for sing-box output
type SingboxWriter struct {
	logger   *Logger
	memLogs  *[]string
	memMu    *sync.RWMutex
	maxLogs  int
	callback func(string) // Optional callback function
}

// NewSingboxWriter creates a sing-box output writer
func NewSingboxWriter(logger *Logger, memLogs *[]string, memMu *sync.RWMutex, maxLogs int) *SingboxWriter {
	return &SingboxWriter{
		logger:  logger,
		memLogs: memLogs,
		memMu:   memMu,
		maxLogs: maxLogs,
	}
}

// Write implements the io.Writer interface
func (w *SingboxWriter) Write(p []byte) (n int, err error) {
	return len(p), nil
}

// WriteLine writes a log line
func (w *SingboxWriter) WriteLine(line string) {
	// Write to file
	if w.logger != nil {
		w.logger.WriteRaw(line)
	}

	// Write to memory
	if w.memLogs != nil && w.memMu != nil {
		w.memMu.Lock()
		*w.memLogs = append(*w.memLogs, line)
		if len(*w.memLogs) > w.maxLogs {
			*w.memLogs = (*w.memLogs)[len(*w.memLogs)-w.maxLogs:]
		}
		w.memMu.Unlock()
	}
}

// ReadAppLogs reads app logs
func ReadAppLogs(lines int) ([]string, error) {
	if manager == nil || manager.appLogger == nil {
		return []string{}, nil
	}
	return manager.appLogger.ReadLastLines(lines)
}

// ReadSingboxLogs reads sing-box logs
func ReadSingboxLogs(lines int) ([]string, error) {
	if manager == nil || manager.singboxLogger == nil {
		return []string{}, nil
	}
	return manager.singboxLogger.ReadLastLines(lines)
}

// MultiWriter writes to multiple targets simultaneously
type MultiWriter struct {
	writers []io.Writer
}

// NewMultiWriter creates a multi-target writer
func NewMultiWriter(writers ...io.Writer) *MultiWriter {
	return &MultiWriter{writers: writers}
}

// Write writes to all targets
func (mw *MultiWriter) Write(p []byte) (n int, err error) {
	for _, w := range mw.writers {
		n, err = w.Write(p)
		if err != nil {
			return
		}
	}
	return len(p), nil
}
