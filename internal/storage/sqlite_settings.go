package storage

import (
	"database/sql"
	"encoding/json"
)

func (s *SQLiteStore) GetSettings() *Settings {
	row := s.db.QueryRow(`SELECT singbox_path, config_path,
		mixed_port, mixed_address, tun_enabled, allow_lan,
		socks_port, socks_address, socks_auth, socks_username, socks_password,
		http_port, http_address, http_auth, http_username, http_password,
		shadowsocks_port, shadowsocks_address, shadowsocks_method, shadowsocks_password,
		proxy_dns, direct_dns,
		web_port, clash_api_port, clash_ui_path, clash_api_secret,
		final_outbound, ruleset_base_url,
		auto_apply, subscription_interval,
		github_proxy, debug_api_enabled,
		verification_interval, archive_threshold
		FROM settings WHERE id = 1`)

	settings := &Settings{}
	var tunEnabled, allowLAN, socksAuth, httpAuth, autoApply, debugAPI int
	err := row.Scan(
		&settings.SingBoxPath, &settings.ConfigPath,
		&settings.MixedPort, &settings.MixedAddress, &tunEnabled, &allowLAN,
		&settings.SocksPort, &settings.SocksAddress, &socksAuth, &settings.SocksUsername, &settings.SocksPassword,
		&settings.HttpPort, &settings.HttpAddress, &httpAuth, &settings.HttpUsername, &settings.HttpPassword,
		&settings.ShadowsocksPort, &settings.ShadowsocksAddress, &settings.ShadowsocksMethod, &settings.ShadowsocksPassword,
		&settings.ProxyDNS, &settings.DirectDNS,
		&settings.WebPort, &settings.ClashAPIPort, &settings.ClashUIPath, &settings.ClashAPISecret,
		&settings.FinalOutbound, &settings.RuleSetBaseURL,
		&autoApply, &settings.SubscriptionInterval,
		&settings.GithubProxy, &debugAPI,
		&settings.VerificationInterval, &settings.ArchiveThreshold,
	)
	if err != nil {
		return DefaultSettings()
	}

	settings.TunEnabled = tunEnabled != 0
	settings.AllowLAN = allowLAN != 0
	settings.SocksAuth = socksAuth != 0
	settings.HttpAuth = httpAuth != 0
	settings.AutoApply = autoApply != 0
	settings.DebugAPIEnabled = debugAPI != 0

	// Load host entries
	settings.Hosts = s.getHostEntries()

	return settings
}

func (s *SQLiteStore) UpdateSettings(settings *Settings) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

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
		github_proxy, debug_api_enabled,
		verification_interval, archive_threshold)
		VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		settings.SingBoxPath, settings.ConfigPath,
		settings.MixedPort, settings.MixedAddress, boolToInt(settings.TunEnabled), boolToInt(settings.AllowLAN),
		settings.SocksPort, settings.SocksAddress, boolToInt(settings.SocksAuth), settings.SocksUsername, settings.SocksPassword,
		settings.HttpPort, settings.HttpAddress, boolToInt(settings.HttpAuth), settings.HttpUsername, settings.HttpPassword,
		settings.ShadowsocksPort, settings.ShadowsocksAddress, settings.ShadowsocksMethod, settings.ShadowsocksPassword,
		settings.ProxyDNS, settings.DirectDNS,
		settings.WebPort, settings.ClashAPIPort, settings.ClashUIPath, settings.ClashAPISecret,
		settings.FinalOutbound, settings.RuleSetBaseURL,
		boolToInt(settings.AutoApply), settings.SubscriptionInterval,
		settings.GithubProxy, boolToInt(settings.DebugAPIEnabled),
		settings.VerificationInterval, settings.ArchiveThreshold)
	if err != nil {
		return err
	}

	// Replace host entries
	if _, err := tx.Exec("DELETE FROM host_entries"); err != nil {
		return err
	}
	if len(settings.Hosts) > 0 {
		stmt, err := tx.Prepare("INSERT INTO host_entries (id, domain, ips_json, enabled) VALUES (?, ?, ?, ?)")
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, h := range settings.Hosts {
			ipsJSON, _ := json.Marshal(h.IPs)
			if _, err := stmt.Exec(h.ID, h.Domain, string(ipsJSON), boolToInt(h.Enabled)); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func (s *SQLiteStore) getHostEntries() []HostEntry {
	rows, err := s.db.Query("SELECT id, domain, ips_json, enabled FROM host_entries")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var hosts []HostEntry
	for rows.Next() {
		var h HostEntry
		var ipsJSON sql.NullString
		var enabled int
		if err := rows.Scan(&h.ID, &h.Domain, &ipsJSON, &enabled); err != nil {
			continue
		}
		h.Enabled = enabled != 0
		if ipsJSON.Valid && ipsJSON.String != "" {
			json.Unmarshal([]byte(ipsJSON.String), &h.IPs)
		}
		if h.IPs == nil {
			h.IPs = []string{}
		}
		hosts = append(hosts, h)
	}
	return hosts
}
