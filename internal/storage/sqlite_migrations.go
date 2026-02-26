package storage

import (
	"database/sql"
	"fmt"
	"time"
)

// migrate runs all pending schema migrations.
func (s *SQLiteStore) migrate() error {
	// Create schema_version table if not exists
	if _, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create schema_version: %w", err)
	}

	var current int
	err := s.db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_version").Scan(&current)
	if err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}

	migrations := []func() error{
		s.migrateV1,
		s.migrateV2,
		s.migrateV3,
	}

	for i, m := range migrations {
		ver := i + 1
		if ver <= current {
			continue
		}
		if err := m(); err != nil {
			return fmt.Errorf("migration v%d: %w", ver, err)
		}
		if _, err := s.db.Exec("INSERT INTO schema_version (version) VALUES (?)", ver); err != nil {
			return fmt.Errorf("record version v%d: %w", ver, err)
		}
	}
	return nil
}

// migrateV1 creates all initial tables and indices.
func (s *SQLiteStore) migrateV1() error {
	stmts := []string{
		// Subscriptions
		`CREATE TABLE IF NOT EXISTS subscriptions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			url TEXT NOT NULL DEFAULT '',
			node_count INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMP,
			expire_at TIMESTAMP,
			enabled INTEGER NOT NULL DEFAULT 1,
			traffic_json TEXT
		)`,

		// Subscription nodes
		`CREATE TABLE IF NOT EXISTS subscription_nodes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
			tag TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			server TEXT NOT NULL DEFAULT '',
			server_port INTEGER NOT NULL DEFAULT 0,
			country TEXT NOT NULL DEFAULT '',
			country_emoji TEXT NOT NULL DEFAULT '',
			extra_json TEXT
		)`,

		// Manual nodes
		`CREATE TABLE IF NOT EXISTS manual_nodes (
			id TEXT PRIMARY KEY,
			tag TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			server TEXT NOT NULL DEFAULT '',
			server_port INTEGER NOT NULL DEFAULT 0,
			country TEXT NOT NULL DEFAULT '',
			country_emoji TEXT NOT NULL DEFAULT '',
			extra_json TEXT,
			enabled INTEGER NOT NULL DEFAULT 1,
			group_tag TEXT NOT NULL DEFAULT '',
			source_subscription_id TEXT NOT NULL DEFAULT ''
		)`,

		// Filters
		`CREATE TABLE IF NOT EXISTS filters (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			mode TEXT NOT NULL DEFAULT '',
			urltest_config_json TEXT,
			all_nodes INTEGER NOT NULL DEFAULT 0,
			enabled INTEGER NOT NULL DEFAULT 0,
			include_json TEXT,
			exclude_json TEXT,
			include_countries_json TEXT,
			exclude_countries_json TEXT,
			subscriptions_json TEXT
		)`,

		// Rules
		`CREATE TABLE IF NOT EXISTS rules (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			rule_type TEXT NOT NULL DEFAULT '',
			values_json TEXT,
			outbound TEXT NOT NULL DEFAULT '',
			enabled INTEGER NOT NULL DEFAULT 0,
			priority INTEGER NOT NULL DEFAULT 0
		)`,

		// Rule groups
		`CREATE TABLE IF NOT EXISTS rule_groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			site_rules_json TEXT,
			ip_rules_json TEXT,
			outbound TEXT NOT NULL DEFAULT '',
			enabled INTEGER NOT NULL DEFAULT 0
		)`,

		// Host entries (separated from settings)
		`CREATE TABLE IF NOT EXISTS host_entries (
			id TEXT PRIMARY KEY,
			domain TEXT NOT NULL DEFAULT '',
			ips_json TEXT,
			enabled INTEGER NOT NULL DEFAULT 0
		)`,

		// Settings (single row)
		`CREATE TABLE IF NOT EXISTS settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			singbox_path TEXT NOT NULL DEFAULT '',
			config_path TEXT NOT NULL DEFAULT '',
			mixed_port INTEGER NOT NULL DEFAULT 0,
			mixed_address TEXT NOT NULL DEFAULT '',
			tun_enabled INTEGER NOT NULL DEFAULT 0,
			allow_lan INTEGER NOT NULL DEFAULT 0,
			socks_port INTEGER NOT NULL DEFAULT 0,
			socks_address TEXT NOT NULL DEFAULT '',
			socks_auth INTEGER NOT NULL DEFAULT 0,
			socks_username TEXT NOT NULL DEFAULT '',
			socks_password TEXT NOT NULL DEFAULT '',
			http_port INTEGER NOT NULL DEFAULT 0,
			http_address TEXT NOT NULL DEFAULT '',
			http_auth INTEGER NOT NULL DEFAULT 0,
			http_username TEXT NOT NULL DEFAULT '',
			http_password TEXT NOT NULL DEFAULT '',
			shadowsocks_port INTEGER NOT NULL DEFAULT 0,
			shadowsocks_address TEXT NOT NULL DEFAULT '',
			shadowsocks_method TEXT NOT NULL DEFAULT '',
			shadowsocks_password TEXT NOT NULL DEFAULT '',
			proxy_dns TEXT NOT NULL DEFAULT '',
			direct_dns TEXT NOT NULL DEFAULT '',
			web_port INTEGER NOT NULL DEFAULT 0,
			clash_api_port INTEGER NOT NULL DEFAULT 0,
			clash_ui_path TEXT NOT NULL DEFAULT '',
			clash_api_secret TEXT NOT NULL DEFAULT '',
			final_outbound TEXT NOT NULL DEFAULT '',
			ruleset_base_url TEXT NOT NULL DEFAULT '',
			auto_apply INTEGER NOT NULL DEFAULT 0,
			subscription_interval INTEGER NOT NULL DEFAULT 0,
			github_proxy TEXT NOT NULL DEFAULT '',
			debug_api_enabled INTEGER NOT NULL DEFAULT 0
		)`,

		// Unsupported nodes (PK by server:port)
		`CREATE TABLE IF NOT EXISTS unsupported_nodes (
			server TEXT NOT NULL,
			server_port INTEGER NOT NULL,
			node_tag TEXT NOT NULL DEFAULT '',
			error TEXT NOT NULL DEFAULT '',
			detected_at TIMESTAMP,
			PRIMARY KEY (server, server_port)
		)`,

		// Health measurements
		`CREATE TABLE IF NOT EXISTS health_measurements (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server TEXT NOT NULL,
			server_port INTEGER NOT NULL,
			node_tag TEXT NOT NULL DEFAULT '',
			timestamp TIMESTAMP,
			alive INTEGER NOT NULL DEFAULT 0,
			latency_ms INTEGER NOT NULL DEFAULT 0,
			mode TEXT NOT NULL DEFAULT ''
		)`,

		// Site measurements
		`CREATE TABLE IF NOT EXISTS site_measurements (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server TEXT NOT NULL,
			server_port INTEGER NOT NULL,
			node_tag TEXT NOT NULL DEFAULT '',
			timestamp TIMESTAMP,
			site TEXT NOT NULL DEFAULT '',
			delay_ms INTEGER NOT NULL DEFAULT 0,
			mode TEXT NOT NULL DEFAULT ''
		)`,

		// Indices
		`CREATE INDEX IF NOT EXISTS idx_sub_nodes_sub_id ON subscription_nodes(subscription_id)`,
		`CREATE INDEX IF NOT EXISTS idx_manual_server ON manual_nodes(server, server_port)`,
		`CREATE INDEX IF NOT EXISTS idx_manual_group ON manual_nodes(group_tag)`,
		`CREATE INDEX IF NOT EXISTS idx_manual_source ON manual_nodes(source_subscription_id)`,
		`CREATE INDEX IF NOT EXISTS idx_health_server_ts ON health_measurements(server, server_port, timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_site_server_ts ON site_measurements(server, server_port, timestamp)`,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:60], err)
		}
	}

	return tx.Commit()
}

// migrateV2 adds auto-pipeline columns to subscriptions and pipeline_logs table (legacy).
func (s *SQLiteStore) migrateV2() error {
	stmts := []string{
		// Pipeline settings on subscription
		`ALTER TABLE subscriptions ADD COLUMN auto_pipeline INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE subscriptions ADD COLUMN pipeline_group_tag TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE subscriptions ADD COLUMN pipeline_min_stability REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE subscriptions ADD COLUMN pipeline_remove_dead INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE subscriptions ADD COLUMN pipeline_last_run TIMESTAMP`,
		`ALTER TABLE subscriptions ADD COLUMN pipeline_last_result_json TEXT`,

		// Pipeline execution log
		`CREATE TABLE IF NOT EXISTS pipeline_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
			timestamp TIMESTAMP NOT NULL,
			total_nodes INTEGER NOT NULL DEFAULT 0,
			checked_nodes INTEGER NOT NULL DEFAULT 0,
			alive_nodes INTEGER NOT NULL DEFAULT 0,
			copied_nodes INTEGER NOT NULL DEFAULT 0,
			skipped_nodes INTEGER NOT NULL DEFAULT 0,
			removed_stale INTEGER NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT '',
			duration_ms INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pipeline_logs_sub_ts ON pipeline_logs(subscription_id, timestamp)`,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:60], err)
		}
	}

	return tx.Commit()
}

// migrateV3 creates unified nodes table, verification_logs, migrates data, adds verification settings.
func (s *SQLiteStore) migrateV3() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Create unified nodes table
	createStmts := []string{
		`CREATE TABLE IF NOT EXISTS nodes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tag TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			server TEXT NOT NULL DEFAULT '',
			server_port INTEGER NOT NULL DEFAULT 0,
			country TEXT NOT NULL DEFAULT '',
			country_emoji TEXT NOT NULL DEFAULT '',
			extra_json TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			source TEXT NOT NULL DEFAULT 'manual',
			group_tag TEXT NOT NULL DEFAULT '',
			consecutive_failures INTEGER NOT NULL DEFAULT 0,
			last_checked_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			promoted_at TIMESTAMP,
			archived_at TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status)`,
		`CREATE INDEX IF NOT EXISTS idx_nodes_server ON nodes(server, server_port)`,
		`CREATE INDEX IF NOT EXISTS idx_nodes_source ON nodes(source)`,
		`CREATE INDEX IF NOT EXISTS idx_nodes_group ON nodes(group_tag)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_server_port_uniq ON nodes(server, server_port)`,

		// 2. Create verification_logs table
		`CREATE TABLE IF NOT EXISTS verification_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TIMESTAMP NOT NULL,
			pending_checked INTEGER NOT NULL DEFAULT 0,
			pending_promoted INTEGER NOT NULL DEFAULT 0,
			pending_archived INTEGER NOT NULL DEFAULT 0,
			verified_checked INTEGER NOT NULL DEFAULT 0,
			verified_demoted INTEGER NOT NULL DEFAULT 0,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_verification_logs_ts ON verification_logs(timestamp)`,

		// 3. Add verification settings columns
		`ALTER TABLE settings ADD COLUMN verification_interval INTEGER NOT NULL DEFAULT 30`,
		`ALTER TABLE settings ADD COLUMN archive_threshold INTEGER NOT NULL DEFAULT 10`,
	}

	for _, stmt := range createStmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:60], err)
		}
	}

	// 4. Migrate data from manual_nodes -> nodes
	now := time.Now()
	rows, err := tx.Query(`SELECT id, tag, type, server, server_port, country, country_emoji, extra_json,
		enabled, group_tag, source_subscription_id FROM manual_nodes`)
	if err != nil {
		return fmt.Errorf("read manual_nodes: %w", err)
	}

	seen := make(map[string]bool)
	for rows.Next() {
		var id, tag, typ, server, country, countryEmoji, groupTag, sourceSubID string
		var serverPort, enabled int
		var extraJSON sql.NullString
		if err := rows.Scan(&id, &tag, &typ, &server, &serverPort, &country, &countryEmoji, &extraJSON,
			&enabled, &groupTag, &sourceSubID); err != nil {
			rows.Close()
			return fmt.Errorf("scan manual_node: %w", err)
		}

		key := fmt.Sprintf("%s:%d", server, serverPort)
		if seen[key] {
			continue
		}
		seen[key] = true

		status := "pending"
		var promotedAt *time.Time
		if enabled != 0 {
			status = "verified"
			promotedAt = &now
		}

		source := "manual"
		if sourceSubID != "" {
			source = sourceSubID
		}

		extra := ""
		if extraJSON.Valid {
			extra = extraJSON.String
		}

		_, err = tx.Exec(`INSERT INTO nodes (tag, type, server, server_port, country, country_emoji, extra_json,
			status, source, group_tag, created_at, promoted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			tag, typ, server, serverPort, country, countryEmoji, extra,
			status, source, groupTag, now, promotedAt)
		if err != nil {
			rows.Close()
			return fmt.Errorf("insert node from manual: %w", err)
		}
	}
	rows.Close()

	// 5. Migrate subscription_nodes -> nodes (as pending, dedup by server:port)
	rows2, err := tx.Query(`SELECT sn.tag, sn.type, sn.server, sn.server_port, sn.country, sn.country_emoji, sn.extra_json, sn.subscription_id
		FROM subscription_nodes sn`)
	if err != nil {
		return fmt.Errorf("read subscription_nodes: %w", err)
	}

	for rows2.Next() {
		var tag, typ, server, country, countryEmoji, subID string
		var serverPort int
		var extraJSON sql.NullString
		if err := rows2.Scan(&tag, &typ, &server, &serverPort, &country, &countryEmoji, &extraJSON, &subID); err != nil {
			rows2.Close()
			return fmt.Errorf("scan subscription_node: %w", err)
		}

		key := fmt.Sprintf("%s:%d", server, serverPort)
		if seen[key] {
			continue
		}
		seen[key] = true

		extra := ""
		if extraJSON.Valid {
			extra = extraJSON.String
		}

		_, err = tx.Exec(`INSERT INTO nodes (tag, type, server, server_port, country, country_emoji, extra_json,
			status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
			tag, typ, server, serverPort, country, countryEmoji, extra, subID, now)
		if err != nil {
			rows2.Close()
			return fmt.Errorf("insert node from subscription: %w", err)
		}
	}
	rows2.Close()

	// 6. Rename old tables to _legacy_*
	legacyStmts := []string{
		`ALTER TABLE manual_nodes RENAME TO _legacy_manual_nodes`,
		`ALTER TABLE pipeline_logs RENAME TO _legacy_pipeline_logs`,
	}
	for _, stmt := range legacyStmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("rename legacy: %w", err)
		}
	}

	return tx.Commit()
}
