package builder

import (
	"regexp"
	"strconv"
	"strings"
)

// OutboundError represents a parsed sing-box validation error for an outbound
type OutboundError struct {
	Index   int    // outbound index in the config (-1 if not index-based)
	Field   string // the problematic field path (e.g. "transport.mode")
	Message string // full error message
}

// DuplicateTagError represents a duplicate outbound tag error
type DuplicateTagError struct {
	Tag string // the duplicate tag name
}

// CheckErrors holds all parsed errors from sing-box check output
type CheckErrors struct {
	OutboundErrors    []OutboundError
	DuplicateTagErrors []DuplicateTagError
}

var outboundErrorRe = regexp.MustCompile(`outbounds\[(\d+)\]\.?([^:]*?):\s*(.+)`)
var duplicateTagRe = regexp.MustCompile(`duplicate outbound/endpoint tag:\s*(.+)`)

// ParseCheckErrors parses sing-box check output and extracts all recognizable errors.
func ParseCheckErrors(output string) CheckErrors {
	var result CheckErrors

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)

		// Check for outbound index errors: outbounds[N].field: message
		if strings.Contains(line, "outbounds[") {
			matches := outboundErrorRe.FindStringSubmatch(line)
			if len(matches) >= 4 {
				idx, err := strconv.Atoi(matches[1])
				if err != nil {
					continue
				}
				result.OutboundErrors = append(result.OutboundErrors, OutboundError{
					Index:   idx,
					Field:   strings.TrimSpace(matches[2]),
					Message: strings.TrimSpace(matches[3]),
				})
			}
			continue
		}

		// Check for duplicate tag errors: duplicate outbound/endpoint tag: <tag>
		if strings.Contains(line, "duplicate outbound/endpoint tag") {
			matches := duplicateTagRe.FindStringSubmatch(line)
			if len(matches) >= 2 {
				result.DuplicateTagErrors = append(result.DuplicateTagErrors, DuplicateTagError{
					Tag: strings.TrimSpace(matches[1]),
				})
			}
		}
	}

	return result
}

// HasErrors returns true if any errors were parsed
func (e CheckErrors) HasErrors() bool {
	return len(e.OutboundErrors) > 0 || len(e.DuplicateTagErrors) > 0
}
