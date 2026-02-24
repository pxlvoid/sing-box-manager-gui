package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// GetDistFS returns the file system for the frontend build artifacts
func GetDistFS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
