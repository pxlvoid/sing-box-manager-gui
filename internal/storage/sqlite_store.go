package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Compile-time interface check
var _ Store = (*SQLiteStore)(nil)

// SQLiteStore implements Store backed by SQLite.
type SQLiteStore struct {
	db      *sql.DB
	dataDir string
}

// NewSQLiteStore opens (or creates) a SQLite database in dataDir/data.db and runs migrations.
func NewSQLiteStore(dataDir string) (*SQLiteStore, error) {
	// Ensure directories
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data directory: %w", err)
	}
	generatedDir := filepath.Join(dataDir, "generated")
	if err := os.MkdirAll(generatedDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create generated directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "data.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite: %w", err)
	}

	// Set pragmas
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("failed to set pragma %q: %w", pragma, err)
		}
	}

	s := &SQLiteStore{db: db, dataDir: dataDir}

	// Run migrations
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	// Ensure default settings exist
	if err := s.ensureDefaults(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ensure defaults: %w", err)
	}

	return s, nil
}

// ensureDefaults inserts default settings and rule groups if they don't exist.
func (s *SQLiteStore) ensureDefaults() error {
	// Check if settings row exists
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM settings WHERE id = 1").Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		if err := s.UpdateSettings(DefaultSettings()); err != nil {
			return err
		}
	}

	// Check if rule groups exist
	if err := s.db.QueryRow("SELECT COUNT(*) FROM rule_groups").Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, rg := range DefaultRuleGroups() {
			if err := insertRuleGroupTx(tx, rg); err != nil {
				return err
			}
		}
		return tx.Commit()
	}

	return nil
}

// Close closes the database connection.
func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// GetDataDir returns the data directory.
func (s *SQLiteStore) GetDataDir() string {
	return s.dataDir
}

// Save is a no-op for SQLiteStore (each mutation is auto-committed).
func (s *SQLiteStore) Save() error {
	return nil
}
