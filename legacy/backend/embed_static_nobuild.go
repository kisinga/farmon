//go:build !embed
// +build !embed

package main

import "io/fs"

func getEmbeddedFrontend() (fs.FS, bool) {
	return nil, false
}
