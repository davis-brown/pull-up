// Package migrations embeds the goose SQL migrations so the API can
// self-migrate on startup.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
