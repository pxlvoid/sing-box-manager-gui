package storage

import (
	"encoding/json"
	"strings"
)

// RemoveNodesByTags removes nodes with matching tags from subscription_nodes and unified nodes.
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

	type endpoint struct {
		server string
		port   int
	}

	sourceTagSet := make(map[string]struct{})
	endpointSet := make(map[endpoint]struct{})

	// Collect source tags and endpoints for aliases (internal/display/source/legacy).
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		// Keep backward-compatible direct source tag deletion path.
		sourceTagSet[tag] = struct{}{}

		rows, err := tx.Query(
			`SELECT source_tag, tag, server, server_port
			 FROM nodes
			 WHERE internal_tag = ? OR tag = ? OR source_tag = ? OR display_name = ?`,
			tag, tag, tag, tag,
		)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var sourceTag, legacyTag, server string
			var serverPort int
			if err := rows.Scan(&sourceTag, &legacyTag, &server, &serverPort); err != nil {
				rows.Close()
				return 0, err
			}
			sourceTag = strings.TrimSpace(sourceTag)
			if sourceTag == "" {
				sourceTag = strings.TrimSpace(legacyTag)
			}
			if sourceTag != "" {
				sourceTagSet[sourceTag] = struct{}{}
			}
			server = strings.TrimSpace(server)
			if server != "" && serverPort > 0 {
				endpointSet[endpoint{server: server, port: serverPort}] = struct{}{}
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return 0, err
		}
		rows.Close()
	}

	// Remove from subscription_nodes by source tag.
	for sourceTag := range sourceTagSet {
		res, err := tx.Exec("DELETE FROM subscription_nodes WHERE tag = ?", sourceTag)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		removed += int(n)
	}

	// Also remove by endpoint to handle alias-only requests (e.g. internal tag).
	for ep := range endpointSet {
		res, err := tx.Exec("DELETE FROM subscription_nodes WHERE server = ? AND server_port = ?", ep.server, ep.port)
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

	// Remove from unified nodes table
	for _, tag := range tags {
		res, err := tx.Exec("DELETE FROM nodes WHERE internal_tag = ? OR tag = ? OR source_tag = ? OR display_name = ?", tag, tag, tag, tag)
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

// GetAllNodes returns all verified nodes (used by config builder).
func (s *SQLiteStore) GetAllNodes() []Node {
	rows, err := s.db.Query(`SELECT tag, internal_tag, display_name, source_tag, type, server, server_port, country, country_emoji, extra_json
		FROM nodes WHERE status = 'verified'`)
	if err != nil {
		return []Node{}
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		n := scanNodeRow(rows)
		if n != nil {
			nodes = append(nodes, *n)
		}
	}
	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// GetAllNodesIncludeDisabled returns all nodes regardless of status.
func (s *SQLiteStore) GetAllNodesIncludeDisabled() []Node {
	rows, err := s.db.Query(`SELECT tag, internal_tag, display_name, source_tag, type, server, server_port, country, country_emoji, extra_json FROM nodes`)
	if err != nil {
		return []Node{}
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		n := scanNodeRow(rows)
		if n != nil {
			nodes = append(nodes, *n)
		}
	}
	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// GetNodesByCountry returns verified nodes for a country code.
func (s *SQLiteStore) GetNodesByCountry(countryCode string) []Node {
	rows, err := s.db.Query(`SELECT tag, internal_tag, display_name, source_tag, type, server, server_port, country, country_emoji, extra_json
		FROM nodes WHERE status = 'verified' AND country = ?`, countryCode)
	if err != nil {
		return []Node{}
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		n := scanNodeRow(rows)
		if n != nil {
			nodes = append(nodes, *n)
		}
	}
	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// GetCountryGroups returns country groups with node counts (verified nodes only).
func (s *SQLiteStore) GetCountryGroups() []CountryGroup {
	countryCount := make(map[string]int)

	rows, err := s.db.Query(`SELECT country, COUNT(*) FROM nodes WHERE status = 'verified' AND country != '' GROUP BY country`)
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
func scanNodeRow(rows interface {
	Scan(dest ...interface{}) error
}) *Node {
	var n Node
	var extraJSON *string
	if err := rows.Scan(&n.Tag, &n.InternalTag, &n.DisplayName, &n.SourceTag, &n.Type, &n.Server, &n.ServerPort, &n.Country, &n.CountryEmoji, &extraJSON); err != nil {
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
