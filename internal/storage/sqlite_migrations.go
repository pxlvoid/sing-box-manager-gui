package storage

import "fmt"

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
