package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const nodeColumns = `id, tag, internal_tag, display_name, source_tag, type, server, server_port, country, country_emoji, extra_json,
	status, source, group_tag, consecutive_failures, last_checked_at, created_at, promoted_at, archived_at, is_favorite`

func normalizeUnifiedNodeForPersistence(node *UnifiedNode) {
	node.Tag = strings.TrimSpace(node.Tag)
	node.InternalTag = strings.TrimSpace(node.InternalTag)
	node.DisplayName = strings.TrimSpace(node.DisplayName)
	node.SourceTag = strings.TrimSpace(node.SourceTag)

	if node.SourceTag == "" {
		if node.Tag != "" {
			node.SourceTag = node.Tag
		} else if node.DisplayName != "" {
			node.SourceTag = node.DisplayName
		}
	}

	if node.DisplayName == "" {
		if node.Tag != "" {
			node.DisplayName = node.Tag
		} else if node.SourceTag != "" {
			node.DisplayName = node.SourceTag
		} else if node.Server != "" && node.ServerPort > 0 {
			node.DisplayName = fmt.Sprintf("%s:%d", node.Server, node.ServerPort)
		} else {
			node.DisplayName = "Node"
		}
	}

	// Keep legacy `tag` in sync with UI display name for compatibility.
	node.Tag = node.DisplayName

	if node.InternalTag == "" {
		node.InternalTag = "node_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	}
}

func (s *SQLiteStore) GetNodes(status NodeStatus) []UnifiedNode {
	rows, err := s.db.Query("SELECT "+nodeColumns+" FROM nodes WHERE status = ? ORDER BY id", string(status))
	if err != nil {
		return []UnifiedNode{}
	}
	defer rows.Close()
	return scanUnifiedNodes(rows)
}

func (s *SQLiteStore) GetNodeByID(id int64) *UnifiedNode {
	row := s.db.QueryRow("SELECT "+nodeColumns+" FROM nodes WHERE id = ?", id)
	return scanUnifiedNodeRow(row)
}

func (s *SQLiteStore) GetNodeByServerPort(server string, port int) *UnifiedNode {
	row := s.db.QueryRow("SELECT "+nodeColumns+" FROM nodes WHERE server = ? AND server_port = ? LIMIT 1", server, port)
	return scanUnifiedNodeRow(row)
}

func (s *SQLiteStore) GetNodesBySource(source string) []UnifiedNode {
	rows, err := s.db.Query("SELECT "+nodeColumns+" FROM nodes WHERE source = ? ORDER BY id", source)
	if err != nil {
		return []UnifiedNode{}
	}
	defer rows.Close()
	return scanUnifiedNodes(rows)
}

func (s *SQLiteStore) AddNode(node UnifiedNode) (int64, error) {
	normalizeUnifiedNodeForPersistence(&node)

	extraJSON := marshalJSON(node.Extra)
	if node.CreatedAt.IsZero() {
		node.CreatedAt = time.Now()
	}
	if node.Status == "" {
		node.Status = NodeStatusPending
	}
	if node.Source == "" {
		node.Source = "manual"
	}

	res, err := s.db.Exec(`INSERT INTO nodes (tag, internal_tag, display_name, source_tag, type, server, server_port, country, country_emoji, extra_json,
		status, source, group_tag, consecutive_failures, last_checked_at, created_at, promoted_at, archived_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		node.Tag, node.InternalTag, node.DisplayName, node.SourceTag, node.Type, node.Server, node.ServerPort, node.Country, node.CountryEmoji, extraJSON,
		string(node.Status), node.Source, node.GroupTag, node.ConsecutiveFailures,
		node.LastCheckedAt, node.CreatedAt, node.PromotedAt, node.ArchivedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *SQLiteStore) AddNodesBulk(nodes []UnifiedNode) (added int, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO nodes (tag, internal_tag, display_name, source_tag, type, server, server_port, country, country_emoji, extra_json,
		status, source, group_tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	now := time.Now()
	for i := range nodes {
		n := nodes[i]
		normalizeUnifiedNodeForPersistence(&n)

		extraJSON := marshalJSON(n.Extra)
		status := string(n.Status)
		if status == "" {
			status = "pending"
		}
		source := n.Source
		if source == "" {
			source = "manual"
		}
		res, err := stmt.Exec(n.Tag, n.InternalTag, n.DisplayName, n.SourceTag, n.Type, n.Server, n.ServerPort, n.Country, n.CountryEmoji, extraJSON,
			status, source, n.GroupTag, now)
		if err != nil {
			continue
		}
		ra, _ := res.RowsAffected()
		added += int(ra)
	}
	return added, tx.Commit()
}

func (s *SQLiteStore) UpdateNode(node UnifiedNode) error {
	current := s.GetNodeByID(node.ID)
	if current == nil {
		return fmt.Errorf("node not found: %d", node.ID)
	}

	if strings.TrimSpace(node.InternalTag) == "" {
		node.InternalTag = current.InternalTag
	}
	if strings.TrimSpace(node.SourceTag) == "" {
		node.SourceTag = current.SourceTag
	}
	if strings.TrimSpace(node.DisplayName) == "" {
		if strings.TrimSpace(node.Tag) != "" {
			node.DisplayName = strings.TrimSpace(node.Tag)
		} else {
			node.DisplayName = current.DisplayName
		}
	}

	normalizeUnifiedNodeForPersistence(&node)

	extraJSON := marshalJSON(node.Extra)
	res, err := s.db.Exec(`UPDATE nodes SET tag=?, display_name=?, source_tag=?, type=?, server=?, server_port=?, country=?, country_emoji=?,
		extra_json=?, status=?, source=?, group_tag=?, consecutive_failures=?,
		last_checked_at=?, promoted_at=?, archived_at=? WHERE id=?`,
		node.Tag, node.DisplayName, node.SourceTag, node.Type, node.Server, node.ServerPort, node.Country, node.CountryEmoji, extraJSON,
		string(node.Status), node.Source, node.GroupTag, node.ConsecutiveFailures,
		node.LastCheckedAt, node.PromotedAt, node.ArchivedAt, node.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", node.ID)
	}
	return nil
}

func (s *SQLiteStore) DeleteNode(id int64) error {
	res, err := s.db.Exec("DELETE FROM nodes WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", id)
	}
	return nil
}

func (s *SQLiteStore) PromoteNode(id int64) error {
	now := time.Now()
	res, err := s.db.Exec(`UPDATE nodes SET status = 'verified', promoted_at = ?, consecutive_failures = 0,
		last_checked_at = ? WHERE id = ?`, now, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", id)
	}
	return nil
}

func (s *SQLiteStore) DemoteNode(id int64) error {
	now := time.Now()
	res, err := s.db.Exec(`UPDATE nodes SET status = 'pending', promoted_at = NULL, consecutive_failures = 1,
		last_checked_at = ? WHERE id = ?`, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", id)
	}
	return nil
}

func (s *SQLiteStore) ArchiveNode(id int64) error {
	now := time.Now()
	res, err := s.db.Exec(`UPDATE nodes SET status = 'archived', archived_at = ? WHERE id = ?`, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", id)
	}
	return nil
}

func (s *SQLiteStore) UnarchiveNode(id int64) error {
	res, err := s.db.Exec(`UPDATE nodes SET status = 'pending', archived_at = NULL, consecutive_failures = 0 WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", id)
	}
	return nil
}

func (s *SQLiteStore) IncrementConsecutiveFailures(id int64) (int, error) {
	now := time.Now()
	_, err := s.db.Exec(`UPDATE nodes SET consecutive_failures = consecutive_failures + 1, last_checked_at = ? WHERE id = ?`, now, id)
	if err != nil {
		return 0, err
	}
	var failures int
	err = s.db.QueryRow("SELECT consecutive_failures FROM nodes WHERE id = ?", id).Scan(&failures)
	return failures, err
}

func (s *SQLiteStore) ResetConsecutiveFailures(id int64) error {
	now := time.Now()
	_, err := s.db.Exec(`UPDATE nodes SET consecutive_failures = 0, last_checked_at = ? WHERE id = ?`, now, id)
	return err
}

func (s *SQLiteStore) GetNodeCounts() NodeCounts {
	var counts NodeCounts
	s.db.QueryRow("SELECT COUNT(*) FROM nodes WHERE status = 'pending'").Scan(&counts.Pending)
	s.db.QueryRow("SELECT COUNT(*) FROM nodes WHERE status = 'verified'").Scan(&counts.Verified)
	s.db.QueryRow("SELECT COUNT(*) FROM nodes WHERE status = 'archived'").Scan(&counts.Archived)
	return counts
}

func (s *SQLiteStore) AddVerificationLog(log VerificationLog) error {
	_, err := s.db.Exec(`INSERT INTO verification_logs (timestamp, pending_checked, pending_promoted, pending_archived,
		verified_checked, verified_demoted, duration_ms, error)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		log.Timestamp, log.PendingChecked, log.PendingPromoted, log.PendingArchived,
		log.VerifiedChecked, log.VerifiedDemoted, log.DurationMs, log.Error)
	return err
}

func (s *SQLiteStore) GetVerificationLogs(limit int) []VerificationLog {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.Query(`SELECT id, timestamp, pending_checked, pending_promoted, pending_archived,
		verified_checked, verified_demoted, duration_ms, error
		FROM verification_logs ORDER BY timestamp DESC LIMIT ?`, limit)
	if err != nil {
		return []VerificationLog{}
	}
	defer rows.Close()

	var logs []VerificationLog
	for rows.Next() {
		var l VerificationLog
		if err := rows.Scan(&l.ID, &l.Timestamp, &l.PendingChecked, &l.PendingPromoted, &l.PendingArchived,
			&l.VerifiedChecked, &l.VerifiedDemoted, &l.DurationMs, &l.Error); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []VerificationLog{}
	}
	return logs
}

// scanUnifiedNodes scans multiple UnifiedNode rows
func scanUnifiedNodes(rows *sql.Rows) []UnifiedNode {
	var nodes []UnifiedNode
	for rows.Next() {
		n, err := scanUnifiedNodeFromRows(rows)
		if err != nil {
			continue
		}
		nodes = append(nodes, n)
	}
	if nodes == nil {
		nodes = []UnifiedNode{}
	}
	return nodes
}

func scanUnifiedNodeFromRows(rows *sql.Rows) (UnifiedNode, error) {
	var n UnifiedNode
	var extraJSON sql.NullString
	var status string
	var lastCheckedAt, promotedAt, archivedAt sql.NullTime
	var createdAt time.Time

	err := rows.Scan(&n.ID, &n.Tag, &n.InternalTag, &n.DisplayName, &n.SourceTag, &n.Type, &n.Server, &n.ServerPort, &n.Country, &n.CountryEmoji,
		&extraJSON, &status, &n.Source, &n.GroupTag, &n.ConsecutiveFailures,
		&lastCheckedAt, &createdAt, &promotedAt, &archivedAt, &n.IsFavorite)
	if err != nil {
		return n, err
	}

	n.Status = NodeStatus(status)
	n.CreatedAt = createdAt
	if lastCheckedAt.Valid {
		n.LastCheckedAt = &lastCheckedAt.Time
	}
	if promotedAt.Valid {
		n.PromotedAt = &promotedAt.Time
	}
	if archivedAt.Valid {
		n.ArchivedAt = &archivedAt.Time
	}
	if extraJSON.Valid && extraJSON.String != "" {
		json.Unmarshal([]byte(extraJSON.String), &n.Extra)
	}
	return n, nil
}

func scanUnifiedNodeRow(row *sql.Row) *UnifiedNode {
	var n UnifiedNode
	var extraJSON sql.NullString
	var status string
	var lastCheckedAt, promotedAt, archivedAt sql.NullTime
	var createdAt time.Time

	err := row.Scan(&n.ID, &n.Tag, &n.InternalTag, &n.DisplayName, &n.SourceTag, &n.Type, &n.Server, &n.ServerPort, &n.Country, &n.CountryEmoji,
		&extraJSON, &status, &n.Source, &n.GroupTag, &n.ConsecutiveFailures,
		&lastCheckedAt, &createdAt, &promotedAt, &archivedAt, &n.IsFavorite)
	if err != nil {
		return nil
	}

	n.Status = NodeStatus(status)
	n.CreatedAt = createdAt
	if lastCheckedAt.Valid {
		n.LastCheckedAt = &lastCheckedAt.Time
	}
	if promotedAt.Valid {
		n.PromotedAt = &promotedAt.Time
	}
	if archivedAt.Valid {
		n.ArchivedAt = &archivedAt.Time
	}
	if extraJSON.Valid && extraJSON.String != "" {
		json.Unmarshal([]byte(extraJSON.String), &n.Extra)
	}
	return &n
}

func (s *SQLiteStore) SetNodeFavorite(id int64, favorite bool) error {
	val := 0
	if favorite {
		val = 1
	}
	res, err := s.db.Exec(`UPDATE nodes SET is_favorite = ? WHERE id = ?`, val, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("node not found: %d", id)
	}
	return nil
}
