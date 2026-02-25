package storage

import (
	"database/sql"
	"fmt"
)

// ==================== Rules ====================

func (s *SQLiteStore) GetRules() []Rule {
	rows, err := s.db.Query("SELECT id, name, rule_type, values_json, outbound, enabled, priority FROM rules ORDER BY priority")
	if err != nil {
		return []Rule{}
	}
	defer rows.Close()

	var rules []Rule
	for rows.Next() {
		r, err := scanRule(rows)
		if err != nil {
			continue
		}
		rules = append(rules, r)
	}
	if rules == nil {
		rules = []Rule{}
	}
	return rules
}

func (s *SQLiteStore) AddRule(rule Rule) error {
	_, err := s.db.Exec(`INSERT INTO rules (id, name, rule_type, values_json, outbound, enabled, priority)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		rule.ID, rule.Name, rule.RuleType, marshalJSON(rule.Values), rule.Outbound, boolToInt(rule.Enabled), rule.Priority)
	return err
}

func (s *SQLiteStore) UpdateRule(rule Rule) error {
	res, err := s.db.Exec(`UPDATE rules SET name=?, rule_type=?, values_json=?, outbound=?, enabled=?, priority=? WHERE id=?`,
		rule.Name, rule.RuleType, marshalJSON(rule.Values), rule.Outbound, boolToInt(rule.Enabled), rule.Priority, rule.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("rule not found: %s", rule.ID)
	}
	return nil
}

func (s *SQLiteStore) DeleteRule(id string) error {
	res, err := s.db.Exec("DELETE FROM rules WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("rule not found: %s", id)
	}
	return nil
}

func (s *SQLiteStore) ReplaceRules(rules []Rule) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM rules"); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`INSERT INTO rules (id, name, rule_type, values_json, outbound, enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range rules {
		if _, err := stmt.Exec(r.ID, r.Name, r.RuleType, marshalJSON(r.Values), r.Outbound, boolToInt(r.Enabled), r.Priority); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func scanRule(rows *sql.Rows) (Rule, error) {
	var r Rule
	var valuesJSON sql.NullString
	var enabled int

	err := rows.Scan(&r.ID, &r.Name, &r.RuleType, &valuesJSON, &r.Outbound, &enabled, &r.Priority)
	if err != nil {
		return r, err
	}
	r.Enabled = enabled != 0
	unmarshalStringSlice(valuesJSON, &r.Values)
	if r.Values == nil {
		r.Values = []string{}
	}
	return r, nil
}

// ==================== Rule Groups ====================

func (s *SQLiteStore) GetRuleGroups() []RuleGroup {
	rows, err := s.db.Query("SELECT id, name, site_rules_json, ip_rules_json, outbound, enabled FROM rule_groups")
	if err != nil {
		return []RuleGroup{}
	}
	defer rows.Close()

	var groups []RuleGroup
	for rows.Next() {
		rg, err := scanRuleGroup(rows)
		if err != nil {
			continue
		}
		groups = append(groups, rg)
	}
	if groups == nil {
		groups = []RuleGroup{}
	}
	return groups
}

func (s *SQLiteStore) UpdateRuleGroup(rg RuleGroup) error {
	res, err := s.db.Exec(`UPDATE rule_groups SET name=?, site_rules_json=?, ip_rules_json=?, outbound=?, enabled=? WHERE id=?`,
		rg.Name, marshalJSON(rg.SiteRules), marshalJSON(rg.IPRules), rg.Outbound, boolToInt(rg.Enabled), rg.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("rule group not found: %s", rg.ID)
	}
	return nil
}

func insertRuleGroupTx(tx *sql.Tx, rg RuleGroup) error {
	_, err := tx.Exec(`INSERT INTO rule_groups (id, name, site_rules_json, ip_rules_json, outbound, enabled)
		VALUES (?, ?, ?, ?, ?, ?)`,
		rg.ID, rg.Name, marshalJSON(rg.SiteRules), marshalJSON(rg.IPRules), rg.Outbound, boolToInt(rg.Enabled))
	return err
}

func scanRuleGroup(rows *sql.Rows) (RuleGroup, error) {
	var rg RuleGroup
	var siteRulesJSON, ipRulesJSON sql.NullString
	var enabled int

	err := rows.Scan(&rg.ID, &rg.Name, &siteRulesJSON, &ipRulesJSON, &rg.Outbound, &enabled)
	if err != nil {
		return rg, err
	}
	rg.Enabled = enabled != 0
	unmarshalStringSlice(siteRulesJSON, &rg.SiteRules)
	unmarshalStringSlice(ipRulesJSON, &rg.IPRules)
	if rg.SiteRules == nil {
		rg.SiteRules = []string{}
	}
	if rg.IPRules == nil {
		rg.IPRules = []string{}
	}
	return rg, nil
}
