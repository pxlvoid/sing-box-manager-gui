package storage

import "encoding/json"

// RemoveNodesByTags removes nodes with matching tags from subscriptions and manual nodes.
func (s *SQLiteStore) RemoveNodesByTags(tags []string) (int, error) {
	if len(tags) == 0 {
		return 0, nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	removed := 0

	// Remove from subscription_nodes
	for _, tag := range tags {
		res, err := tx.Exec("DELETE FROM subscription_nodes WHERE tag = ?", tag)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		removed += int(n)
	}

	// Update node_count for affected subscriptions
	if _, err := tx.Exec(`UPDATE subscriptions SET node_count = (
		SELECT COUNT(*) FROM subscription_nodes WHERE subscription_nodes.subscription_id = subscriptions.id
	)`); err != nil {
		return 0, err
	}

	// Remove from manual_nodes
	for _, tag := range tags {
		res, err := tx.Exec("DELETE FROM manual_nodes WHERE tag = ?", tag)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		removed += int(n)
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return removed, nil
}

// GetAllNodes returns all enabled nodes (subscription + manual).
func (s *SQLiteStore) GetAllNodes() []Node {
	var nodes []Node

	// Subscription nodes from enabled subscriptions
	rows, err := s.db.Query(`SELECT sn.tag, sn.type, sn.server, sn.server_port, sn.country, sn.country_emoji, sn.extra_json
		FROM subscription_nodes sn
		JOIN subscriptions s ON s.id = sn.subscription_id
		WHERE s.enabled = 1`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			n := scanNodeRow(rows)
			if n != nil {
				nodes = append(nodes, *n)
			}
		}
	}

	// Enabled manual nodes
	rows2, err := s.db.Query(`SELECT tag, type, server, server_port, country, country_emoji, extra_json
		FROM manual_nodes WHERE enabled = 1`)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			n := scanNodeRow(rows2)
			if n != nil {
				nodes = append(nodes, *n)
			}
		}
	}

	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// GetAllNodesIncludeDisabled returns all nodes regardless of enabled status.
func (s *SQLiteStore) GetAllNodesIncludeDisabled() []Node {
	var nodes []Node

	rows, err := s.db.Query(`SELECT tag, type, server, server_port, country, country_emoji, extra_json FROM subscription_nodes`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			n := scanNodeRow(rows)
			if n != nil {
				nodes = append(nodes, *n)
			}
		}
	}

	rows2, err := s.db.Query(`SELECT tag, type, server, server_port, country, country_emoji, extra_json FROM manual_nodes`)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			n := scanNodeRow(rows2)
			if n != nil {
				nodes = append(nodes, *n)
			}
		}
	}

	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// GetNodesByCountry returns enabled nodes for a country code.
func (s *SQLiteStore) GetNodesByCountry(countryCode string) []Node {
	var nodes []Node

	rows, err := s.db.Query(`SELECT sn.tag, sn.type, sn.server, sn.server_port, sn.country, sn.country_emoji, sn.extra_json
		FROM subscription_nodes sn
		JOIN subscriptions s ON s.id = sn.subscription_id
		WHERE s.enabled = 1 AND sn.country = ?`, countryCode)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			n := scanNodeRow(rows)
			if n != nil {
				nodes = append(nodes, *n)
			}
		}
	}

	rows2, err := s.db.Query(`SELECT tag, type, server, server_port, country, country_emoji, extra_json
		FROM manual_nodes WHERE enabled = 1 AND country = ?`, countryCode)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			n := scanNodeRow(rows2)
			if n != nil {
				nodes = append(nodes, *n)
			}
		}
	}

	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// GetCountryGroups returns country groups with node counts.
func (s *SQLiteStore) GetCountryGroups() []CountryGroup {
	countryCount := make(map[string]int)

	rows, err := s.db.Query(`SELECT sn.country, COUNT(*) FROM subscription_nodes sn
		JOIN subscriptions s ON s.id = sn.subscription_id
		WHERE s.enabled = 1 AND sn.country != '' GROUP BY sn.country`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var code string
			var cnt int
			if rows.Scan(&code, &cnt) == nil {
				countryCount[code] += cnt
			}
		}
	}

	rows2, err := s.db.Query(`SELECT country, COUNT(*) FROM manual_nodes WHERE enabled = 1 AND country != '' GROUP BY country`)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var code string
			var cnt int
			if rows2.Scan(&code, &cnt) == nil {
				countryCount[code] += cnt
			}
		}
	}

	var groups []CountryGroup
	for code, count := range countryCount {
		groups = append(groups, CountryGroup{
			Code:      code,
			Name:      GetCountryName(code),
			Emoji:     GetCountryEmoji(code),
			NodeCount: count,
		})
	}
	if groups == nil {
		groups = []CountryGroup{}
	}
	return groups
}

// scanNodeRow scans a Node from a rows result.
func scanNodeRow(rows interface{ Scan(dest ...interface{}) error }) *Node {
	var n Node
	var extraJSON *string
	if err := rows.Scan(&n.Tag, &n.Type, &n.Server, &n.ServerPort, &n.Country, &n.CountryEmoji, &extraJSON); err != nil {
		return nil
	}
	if extraJSON != nil && *extraJSON != "" {
		_ = jsonUnmarshalMap(*extraJSON, &n.Extra)
	}
	return &n
}

func jsonUnmarshalMap(s string, target *map[string]interface{}) error {
	if s == "" {
		return nil
	}
	return jsonUnmarshal(s, target)
}

func jsonUnmarshal(s string, target interface{}) error {
	return unmarshalJSONString(s, target)
}

func unmarshalJSONString(s string, target interface{}) error {
	if s == "" {
		return nil
	}
	return json.Unmarshal([]byte(s), target)
}
