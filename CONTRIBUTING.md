# Contributing

Thanks for taking a look. pull-up is a personal project, so please open an
issue before starting anything substantial — it may already be planned, or
deliberately out of scope.

Security issues go through [SECURITY.md](SECURITY.md), not the issue tracker.

## Getting set up

Requirements are in the [README](README.md#local-development): Go 1.25.7+,
Node 22, Docker for Postgres+PostGIS, and sqlc if you touch SQL.

```sh
make dev            # postgres+postgis, API on :8080
npm --prefix app start
```

Maps need no API keys — tiles come from OpenFreeMap. The only app config you
must set is `EXPO_PUBLIC_API_URL`; see `app/.env.example`.

## Before opening a pull request

```sh
make test                        # server unit tests
make test-int                    # server + DB-backed tests (needs Docker)
npm --prefix app run typecheck
npm --prefix app run lint
npm --prefix app test
npm --prefix deploy/api test
```

CI runs all of this plus the app's web export and the Worker's
generated-bindings check, typecheck and container dry-run. The DB-backed tests
skip without a `TEST_DATABASE_URL`, so `make test` passing locally does not
mean CI will — run `make test-int` if you changed anything touching the store
layer.

If you edit SQL under `server/internal/store/queries/`, regenerate with
`sqlc generate` and commit the generated output.

## House style

- Match the surrounding code. Comments explain *why* something is the way it
  is, not what the line does; several non-obvious decisions in this codebase
  are load-bearing and are commented as such.
- Keep commits focused, and write the commit message for someone who has to
  understand the change a year from now.
- Never put a credential in a command, a config file, or a commit. Local
  credentials go in the macOS Keychain via `scripts/secret`.

## Court data

Court locations come from OpenStreetMap and are licensed
[ODbL](https://www.openstreetmap.org/copyright). The OSM-derived subset is kept
separable via the `source`/`osm_id` columns to honour share-alike, and the
in-app attribution has to stay visible. Please don't change either without
saying why in the pull request.
