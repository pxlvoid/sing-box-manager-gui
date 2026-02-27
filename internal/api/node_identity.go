package api

import (
	"strings"

	"github.com/xiaobei/singbox-manager/internal/storage"
)

func trimTagValue(value string) string {
	return strings.TrimSpace(value)
}

func nodeRoutingTag(node storage.Node) string {
	return trimTagValue(node.RoutingTag())
}

func nodeDisplayName(node storage.Node) string {
	return trimTagValue(node.DisplayOrTag())
}

func nodeSourceTag(node storage.Node) string {
	return trimTagValue(node.SourceOrTag())
}

func unifiedRoutingTag(node storage.UnifiedNode) string {
	return trimTagValue(node.RoutingTag())
}

func unifiedDisplayName(node storage.UnifiedNode) string {
	return trimTagValue(node.DisplayOrTag())
}

func unifiedSourceTag(node storage.UnifiedNode) string {
	return trimTagValue(node.SourceOrTag())
}

func nodeTagCandidates(node storage.Node) []string {
	values := []string{
		nodeRoutingTag(node),
		trimTagValue(node.Tag),
		nodeDisplayName(node),
		nodeSourceTag(node),
	}
	return dedupeNonEmptyStrings(values)
}

func unifiedNodeTagCandidates(node storage.UnifiedNode) []string {
	values := []string{
		unifiedRoutingTag(node),
		trimTagValue(node.Tag),
		unifiedDisplayName(node),
		unifiedSourceTag(node),
	}
	return dedupeNonEmptyStrings(values)
}

func nodeMatchesAnyTag(node storage.Node, tagSet map[string]struct{}) bool {
	if len(tagSet) == 0 {
		return true
	}
	for _, candidate := range nodeTagCandidates(node) {
		if _, ok := tagSet[candidate]; ok {
			return true
		}
	}
	return false
}

func unifiedNodeMatchesAnyTag(node storage.UnifiedNode, tagSet map[string]struct{}) bool {
	if len(tagSet) == 0 {
		return true
	}
	for _, candidate := range unifiedNodeTagCandidates(node) {
		if _, ok := tagSet[candidate]; ok {
			return true
		}
	}
	return false
}

func parseTagSet(values []string) map[string]struct{} {
	tagSet := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := trimTagValue(value)
		if trimmed == "" {
			continue
		}
		tagSet[trimmed] = struct{}{}
	}
	return tagSet
}

func dedupeNonEmptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
