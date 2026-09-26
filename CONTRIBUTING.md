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
- Never put a credential in a command, a config file, or a commit — see
  [Secrets](#secrets).

## Secrets

Never put a credential in a command. A value typed inline ends up in shell
history and in whatever tool config recorded the invocation, and it persists
there long after you have forgotten it — this repo lost a database password
to a local tool's config file exactly once, which is why the wrappers below
exist.

Local credentials live in the macOS Keychain:

```sh
scripts/secret set   pull-up-db-dev   # prompts; the value is never echoed
scripts/secret check pull-up-db-dev   # reports present/absent, nothing else
```

Query the database through the wrapper rather than passing `DATABASE_URL`
inline:

```sh
scripts/dbq "select count(*) from courts"          # dev branch
PULL_UP_ALLOW_PROD=1 scripts/dbq --prod "select 1" # production
```

`scripts/dbq` defaults to the **dev** branch. Production needs both `--prod`
and `PULL_UP_ALLOW_PROD=1`. That pairing is a deliberate speed bump rather
than a security boundary: routine dev queries stay frictionless, while
anything pointed at production takes a second, explicit step.

Deployed secrets are Cloudflare Worker secrets, declared by name in
`deploy/api/wrangler.jsonc` under `secrets.required` and provisioned in CI
from GitHub secrets (see `.github/workflows/deploy.yml`). Optional ones —
currently `CLOUDFLARE_AI_TOKEN`, which gates Llama Guard text moderation — go
in that workflow's `optional` list, so a missing value disables the feature
instead of failing the deploy.

## Court data

Court locations come from OpenStreetMap and are licensed
[ODbL](https://www.openstreetmap.org/copyright). The OSM-derived subset is kept
separable via the `source`/`osm_id` columns to honour share-alike, and the
in-app attribution has to stay visible. Please don't change either without
saying why in the pull request.
