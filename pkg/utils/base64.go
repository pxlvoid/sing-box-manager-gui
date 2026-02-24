package utils

import (
	"encoding/base64"
	"strings"
)

// DecodeBase64 decodes a Base64 string (supports standard and URL-safe encoding)
func DecodeBase64(s string) (string, error) {
	// Trim whitespace
	s = strings.TrimSpace(s)

	// Pad to correct length
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}

	// Try standard Base64 decoding
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err == nil {
		return string(decoded), nil
	}

	// Try URL-safe Base64 decoding
	decoded, err = base64.URLEncoding.DecodeString(s)
	if err == nil {
		return string(decoded), nil
	}

	// Try RawStdEncoding (no padding)
	s = strings.TrimRight(s, "=")
	decoded, err = base64.RawStdEncoding.DecodeString(s)
	if err == nil {
		return string(decoded), nil
	}

	// Try RawURLEncoding (no padding)
	decoded, err = base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}

	return string(decoded), nil
}

// EncodeBase64 encodes a string to Base64
func EncodeBase64(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

// IsBase64 checks if a string is Base64 encoded
func IsBase64(s string) bool {
	// Trim whitespace
	s = strings.TrimSpace(s)
	if len(s) == 0 {
		return false
	}

	// Base64 character sets
	base64Chars := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
	urlSafeChars := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_="

	isStandard := true
	isURLSafe := true

	for _, c := range s {
		if !strings.ContainsRune(base64Chars, c) {
			isStandard = false
		}
		if !strings.ContainsRune(urlSafeChars, c) {
			isURLSafe = false
		}
	}

	return isStandard || isURLSafe
}
