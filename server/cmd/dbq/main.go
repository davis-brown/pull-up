// Ad-hoc query runner for ops tasks (no local psql). Usage:
//
//	DATABASE_URL=... go run ./cmd/dbq "select ..."
//
// Prints rows tab-separated. Not part of the deployed API.
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dbq <sql>")
		os.Exit(2)
	}
	conn, err := pgx.Connect(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer conn.Close(context.Background())

	rows, err := conn.Query(context.Background(), os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "query:", err)
		os.Exit(1)
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	names := make([]string, len(fields))
	for i, f := range fields {
		names[i] = f.Name
	}
	fmt.Println(strings.Join(names, "\t"))
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			fmt.Fprintln(os.Stderr, "scan:", err)
			os.Exit(1)
		}
		parts := make([]string, len(vals))
		for i, v := range vals {
			parts[i] = fmt.Sprint(v)
		}
		fmt.Println(strings.Join(parts, "\t"))
	}
	if rows.Err() != nil {
		fmt.Fprintln(os.Stderr, "rows:", rows.Err())
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "(%d rows)\n", rows.CommandTag().RowsAffected())
}
