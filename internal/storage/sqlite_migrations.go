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
		s.migrateV4,
		s.migrateV5,
		s.migrateV6,
		s.migrateV7,
		s.migrateV8,
		s.migrateV9,
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

// migrateV4 creates persistent pipeline activity logs for dashboard feed.
func (s *SQLiteStore) migrateV4() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS pipeline_activity_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_type TEXT NOT NULL DEFAULT '',
			message TEXT NOT NULL DEFAULT '',
			timestamp TIMESTAMP NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pipeline_activity_logs_ts ON pipeline_activity_logs(timestamp)`,
	}
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:60], err)
		}
	}
	return tx.Commit()
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
			debug_api_enabled INTEGER NOT NULL DEFAULT 0,
			proxy_mode TEXT NOT NULL DEFAULT 'rule'
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
				error_type TEXT NOT NULL DEFAULT '',
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

func (s *SQLiteStore) migrateV5() error {
	// Check if proxy_mode column already exists
	rows, err := s.db.Query("PRAGMA table_info(settings)")
	if err != nil {
		return fmt.Errorf("pragma table_info: %w", err)
	}
	defer rows.Close()

	hasProxyMode := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull int
		var dfltValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("scan pragma: %w", err)
		}
		if name == "proxy_mode" {
			hasProxyMode = true
			break
		}
	}

	if !hasProxyMode {
		if _, err := s.db.Exec(`ALTER TABLE settings ADD COLUMN proxy_mode TEXT NOT NULL DEFAULT 'rule'`); err != nil {
			return fmt.Errorf("add proxy_mode column: %w", err)
		}
	}

	return nil
}

// migrateV6 creates the geo_data table for GeoIP lookup results.
func (s *SQLiteStore) migrateV6() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS geo_data (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server TEXT NOT NULL,
			server_port INTEGER NOT NULL,
			node_tag TEXT NOT NULL DEFAULT '',
			timestamp TIMESTAMP NOT NULL,
			status TEXT NOT NULL DEFAULT '',
			country TEXT NOT NULL DEFAULT '',
			country_code TEXT NOT NULL DEFAULT '',
			region TEXT NOT NULL DEFAULT '',
			region_name TEXT NOT NULL DEFAULT '',
			city TEXT NOT NULL DEFAULT '',
			zip TEXT NOT NULL DEFAULT '',
			lat REAL NOT NULL DEFAULT 0,
			lon REAL NOT NULL DEFAULT 0,
			timezone TEXT NOT NULL DEFAULT '',
			isp TEXT NOT NULL DEFAULT '',
			org TEXT NOT NULL DEFAULT '',
			as_info TEXT NOT NULL DEFAULT '',
			query_ip TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_server ON geo_data(server, server_port)`,
	}

	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:60], err)
		}
	}

	return tx.Commit()
}

// migrateV7 creates monitoring tables for traffic history.
func (s *SQLiteStore) migrateV7() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS traffic_samples (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TIMESTAMP NOT NULL,
			up_bps INTEGER NOT NULL DEFAULT 0,
			down_bps INTEGER NOT NULL DEFAULT 0,
			upload_total INTEGER NOT NULL DEFAULT 0,
			download_total INTEGER NOT NULL DEFAULT 0,
			active_connections INTEGER NOT NULL DEFAULT 0,
			client_count INTEGER NOT NULL DEFAULT 0,
			memory_inuse INTEGER NOT NULL DEFAULT 0,
			memory_oslimit INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_traffic_samples_ts ON traffic_samples(timestamp)`,
		`CREATE TABLE IF NOT EXISTS traffic_clients (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sample_id INTEGER NOT NULL REFERENCES traffic_samples(id) ON DELETE CASCADE,
			timestamp TIMESTAMP NOT NULL,
			source_ip TEXT NOT NULL DEFAULT '',
			active_connections INTEGER NOT NULL DEFAULT 0,
			upload_bytes INTEGER NOT NULL DEFAULT 0,
			download_bytes INTEGER NOT NULL DEFAULT 0,
			duration_seconds INTEGER NOT NULL DEFAULT 0,
			proxy_chain TEXT NOT NULL DEFAULT '',
			host_count INTEGER NOT NULL DEFAULT 0,
			top_host TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_traffic_clients_sample ON traffic_clients(sample_id)`,
		`CREATE INDEX IF NOT EXISTS idx_traffic_clients_ip_ts ON traffic_clients(source_ip, timestamp)`,
		`CREATE TABLE IF NOT EXISTS traffic_resources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sample_id INTEGER NOT NULL REFERENCES traffic_samples(id) ON DELETE CASCADE,
			timestamp TIMESTAMP NOT NULL,
			source_ip TEXT NOT NULL DEFAULT '',
			host TEXT NOT NULL DEFAULT '',
			active_connections INTEGER NOT NULL DEFAULT 0,
			upload_bytes INTEGER NOT NULL DEFAULT 0,
			download_bytes INTEGER NOT NULL DEFAULT 0,
			proxy_chain TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_traffic_resources_sample ON traffic_resources(sample_id)`,
		`CREATE INDEX IF NOT EXISTS idx_traffic_resources_ip_host_ts ON traffic_resources(source_ip, host, timestamp)`,
	}

	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:60], err)
		}
	}

	return tx.Commit()
}

// migrateV8 introduces stable internal tags and display/source names for unified nodes.
func (s *SQLiteStore) migrateV8() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	hasInternalTag, err := tableHasColumn(tx, "nodes", "internal_tag")
	if err != nil {
		return err
	}
	if !hasInternalTag {
		if _, err := tx.Exec(`ALTER TABLE nodes ADD COLUMN internal_tag TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add nodes.internal_tag: %w", err)
		}
	}

	hasDisplayName, err := tableHasColumn(tx, "nodes", "display_name")
	if err != nil {
		return err
	}
	if !hasDisplayName {
		if _, err := tx.Exec(`ALTER TABLE nodes ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add nodes.display_name: %w", err)
		}
	}

	hasSourceTag, err := tableHasColumn(tx, "nodes", "source_tag")
	if err != nil {
		return err
	}
	if !hasSourceTag {
		if _, err := tx.Exec(`ALTER TABLE nodes ADD COLUMN source_tag TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add nodes.source_tag: %w", err)
		}
	}

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS node_tag_aliases (
			alias_tag TEXT PRIMARY KEY,
			internal_tag TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_node_tag_aliases_internal ON node_tag_aliases(internal_tag)`,
		`UPDATE nodes
			SET source_tag = CASE
				WHEN TRIM(source_tag) = '' THEN TRIM(tag)
				ELSE source_tag
			END`,
		`UPDATE nodes
			SET display_name = CASE
				WHEN TRIM(display_name) = '' THEN
					CASE
						WHEN TRIM(country) <> '' THEN printf('%s-%04d', UPPER(SUBSTR(country, 1, 2)), id)
						ELSE printf('NODE-%04d', id)
					END
				ELSE display_name
			END`,
		`UPDATE nodes
			SET internal_tag = CASE
				WHEN TRIM(internal_tag) = '' THEN printf('node_%08X', id)
				ELSE internal_tag
			END`,
		`UPDATE nodes
			SET tag = display_name
			WHERE TRIM(display_name) <> ''`,
		`UPDATE unsupported_nodes
			SET node_tag = (
				SELECT n.internal_tag
				FROM nodes n
				WHERE n.server = unsupported_nodes.server
				  AND n.server_port = unsupported_nodes.server_port
				LIMIT 1
			)
			WHERE EXISTS (
				SELECT 1
				FROM nodes n
				WHERE n.server = unsupported_nodes.server
				  AND n.server_port = unsupported_nodes.server_port
				  AND TRIM(n.internal_tag) <> ''
			)`,
		`UPDATE health_measurements
			SET node_tag = (
				SELECT n.internal_tag
				FROM nodes n
				WHERE n.server = health_measurements.server
				  AND n.server_port = health_measurements.server_port
				LIMIT 1
			)
			WHERE EXISTS (
				SELECT 1
				FROM nodes n
				WHERE n.server = health_measurements.server
				  AND n.server_port = health_measurements.server_port
				  AND TRIM(n.internal_tag) <> ''
			)`,
		`UPDATE site_measurements
			SET node_tag = (
				SELECT n.internal_tag
				FROM nodes n
				WHERE n.server = site_measurements.server
				  AND n.server_port = site_measurements.server_port
				LIMIT 1
			)
			WHERE EXISTS (
				SELECT 1
				FROM nodes n
				WHERE n.server = site_measurements.server
				  AND n.server_port = site_measurements.server_port
				  AND TRIM(n.internal_tag) <> ''
			)`,
		`UPDATE geo_data
			SET node_tag = (
				SELECT n.internal_tag
				FROM nodes n
				WHERE n.server = geo_data.server
				  AND n.server_port = geo_data.server_port
				LIMIT 1
			)
			WHERE EXISTS (
				SELECT 1
				FROM nodes n
				WHERE n.server = geo_data.server
				  AND n.server_port = geo_data.server_port
				  AND TRIM(n.internal_tag) <> ''
			)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_internal_tag_uniq
			ON nodes(internal_tag)
			WHERE TRIM(internal_tag) <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_display_name_uniq
			ON nodes(display_name)
			WHERE TRIM(display_name) <> ''`,
		`INSERT OR REPLACE INTO node_tag_aliases(alias_tag, internal_tag)
			SELECT TRIM(source_tag), internal_tag
			FROM nodes
			WHERE TRIM(source_tag) <> '' AND TRIM(internal_tag) <> ''`,
		`INSERT OR REPLACE INTO node_tag_aliases(alias_tag, internal_tag)
			SELECT TRIM(display_name), internal_tag
			FROM nodes
			WHERE TRIM(display_name) <> '' AND TRIM(internal_tag) <> ''`,
	}

	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec migration v8 statement failed: %w", err)
		}
	}

	return tx.Commit()
}

// migrateV9 adds site_measurements.error_type for richer site-check diagnostics.
func (s *SQLiteStore) migrateV9() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	hasErrorType, err := tableHasColumn(tx, "site_measurements", "error_type")
	if err != nil {
		return err
	}
	if !hasErrorType {
		if _, err := tx.Exec(`ALTER TABLE site_measurements ADD COLUMN error_type TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add site_measurements.error_type: %w", err)
		}
	}

	return tx.Commit()
}

func tableHasColumn(tx *sql.Tx, tableName, columnName string) (bool, error) {
	rows, err := tx.Query("PRAGMA table_info(" + tableName + ")")
	if err != nil {
		return false, fmt.Errorf("pragma table_info(%s): %w", tableName, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, typ string
		var notnull int
		var dfltValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dfltValue, &pk); err != nil {
			return false, fmt.Errorf("scan table_info(%s): %w", tableName, err)
		}
		if name == columnName {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate table_info(%s): %w", tableName, err)
	}
	return false, nil
}
