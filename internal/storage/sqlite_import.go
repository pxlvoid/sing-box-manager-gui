package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// importFromJSON reads data.json and imports all data into SQLite in a single transaction.
// If subscriptions already exist in the DB, the import is skipped (already imported).
func (s *SQLiteStore) importFromJSON(jsonPath string) error {
	// Check if already imported
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM subscriptions").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil // already has data
	}

	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read data.json: %w", err)
	}

	var appData AppData
	if err := json.Unmarshal(data, &appData); err != nil {
		return fmt.Errorf("parse data.json: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Import subscriptions + nodes
	for _, sub := range appData.Subscriptions {
		trafficJSON := marshalJSON(sub.Traffic)
		_, err := tx.Exec(`INSERT INTO subscriptions (id, name, url, node_count, updated_at, expire_at, enabled, traffic_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			sub.ID, sub.Name, sub.URL, sub.NodeCount, sub.UpdatedAt, sub.ExpireAt, boolToInt(sub.Enabled), trafficJSON)
		if err != nil {
			return fmt.Errorf("import subscription %s: %w", sub.ID, err)
		}

		if err := insertNodesTx(tx, sub.ID, sub.Nodes); err != nil {
			return fmt.Errorf("import nodes for subscription %s: %w", sub.ID, err)
		}
	}

	// Import manual nodes into unified nodes table
	now := time.Now()
	for _, mn := range appData.ManualNodes {
		extraJSON := marshalJSON(mn.Node.Extra)
		status := "pending"
		var promotedAt *time.Time
		if mn.Enabled {
			status = "verified"
			promotedAt = &now
		}
		source := "manual"
		if mn.SourceSubscriptionID != "" {
			source = mn.SourceSubscriptionID
		}
		_, err := tx.Exec(`INSERT OR IGNORE INTO nodes (tag, type, server, server_port, country, country_emoji, extra_json,
			status, source, group_tag, created_at, promoted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			mn.Node.Tag, mn.Node.Type, mn.Node.Server, mn.Node.ServerPort,
			mn.Node.Country, mn.Node.CountryEmoji, extraJSON,
			status, source, mn.GroupTag, now, promotedAt)
		if err != nil {
			return fmt.Errorf("import node %s: %w", mn.ID, err)
		}
	}

	// Import filters
	for _, f := range appData.Filters {
		_, err := tx.Exec(`INSERT INTO filters (id, name, mode, urltest_config_json, all_nodes, enabled,
			include_json, exclude_json, include_countries_json, exclude_countries_json, subscriptions_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			f.ID, f.Name, f.Mode,
			marshalJSON(f.URLTestConfig),
			boolToInt(f.AllNodes), boolToInt(f.Enabled),
			marshalJSON(f.Include), marshalJSON(f.Exclude),
			marshalJSON(f.IncludeCountries), marshalJSON(f.ExcludeCountries),
			marshalJSON(f.Subscriptions))
		if err != nil {
			return fmt.Errorf("import filter %s: %w", f.ID, err)
		}
	}

	// Import rules
	for _, r := range appData.Rules {
		_, err := tx.Exec(`INSERT INTO rules (id, name, rule_type, values_json, outbound, enabled, priority)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			r.ID, r.Name, r.RuleType, marshalJSON(r.Values), r.Outbound, boolToInt(r.Enabled), r.Priority)
		if err != nil {
			return fmt.Errorf("import rule %s: %w", r.ID, err)
		}
	}

	// Import rule groups
	for _, rg := range appData.RuleGroups {
		if err := insertRuleGroupTx(tx, rg); err != nil {
			return fmt.Errorf("import rule group %s: %w", rg.ID, err)
		}
	}

	// Import settings
	if appData.Settings != nil {
		settings := appData.Settings
		_, err = tx.Exec(`INSERT OR REPLACE INTO settings (id,
			singbox_path, config_path,
			mixed_port, mixed_address, tun_enabled, allow_lan,
			socks_port, socks_address, socks_auth, socks_username, socks_password,
			http_port, http_address, http_auth, http_username, http_password,
			shadowsocks_port, shadowsocks_address, shadowsocks_method, shadowsocks_password,
			proxy_dns, direct_dns,
			web_port, clash_api_port, clash_ui_path, clash_api_secret,
			final_outbound, ruleset_base_url,
			auto_apply, subscription_interval,
			github_proxy, debug_api_enabled)
			VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			settings.SingBoxPath, settings.ConfigPath,
			settings.MixedPort, settings.MixedAddress, boolToInt(settings.TunEnabled), boolToInt(settings.AllowLAN),
			settings.SocksPort, settings.SocksAddress, boolToInt(settings.SocksAuth), settings.SocksUsername, settings.SocksPassword,
			settings.HttpPort, settings.HttpAddress, boolToInt(settings.HttpAuth), settings.HttpUsername, settings.HttpPassword,
			settings.ShadowsocksPort, settings.ShadowsocksAddress, settings.ShadowsocksMethod, settings.ShadowsocksPassword,
			settings.ProxyDNS, settings.DirectDNS,
			settings.WebPort, settings.ClashAPIPort, settings.ClashUIPath, settings.ClashAPISecret,
			settings.FinalOutbound, settings.RuleSetBaseURL,
			boolToInt(settings.AutoApply), settings.SubscriptionInterval,
			settings.GithubProxy, boolToInt(settings.DebugAPIEnabled))
		if err != nil {
			return fmt.Errorf("import settings: %w", err)
		}

		// Import host entries
		for _, h := range settings.Hosts {
			ipsJSON, _ := json.Marshal(h.IPs)
			_, err := tx.Exec("INSERT INTO host_entries (id, domain, ips_json, enabled) VALUES (?, ?, ?, ?)",
				h.ID, h.Domain, string(ipsJSON), boolToInt(h.Enabled))
			if err != nil {
				return fmt.Errorf("import host entry %s: %w", h.ID, err)
			}
		}
	}

	return tx.Commit()
}
