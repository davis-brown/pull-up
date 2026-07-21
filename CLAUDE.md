# pull-up

## Secrets

**Never put a credential in a command.** Approving a command that carries a
secret inline copies that secret into the approving tool's config, where it
persists indefinitely and ends up in transcripts. This happened once already
(a Neon password in `.claude/settings.local.json`), which is why the wrappers
below exist.

Local credentials live in the macOS Keychain:

```sh
scripts/secret set   pull-up-db-dev   # prompts; value is never echoed
scripts/secret check pull-up-db-dev   # present/absent only
```

Query the database through the wrapper, never with `DATABASE_URL=... go run`:

```sh
scripts/dbq "select count(*) from courts"          # dev branch
PULL_UP_ALLOW_PROD=1 scripts/dbq --prod "select 1" # production
```

`scripts/dbq` defaults to the **dev** target. Production needs both `--prod`
and `PULL_UP_ALLOW_PROD=1`. That pairing is not a security boundary — it is a
speed bump wired to the permission allowlist: `Bash(scripts/dbq *)` is
allowlisted so routine dev queries run unattended, while the
`PULL_UP_ALLOW_PROD` form deliberately is not, so anything touching production
stops for a human approval prompt. Do not add it to the allowlist.

Deployed secrets are Cloudflare Worker secrets, declared by name in
`deploy/api/wrangler.jsonc` under `secrets.required` and provisioned in CI
from GitHub secrets (see `.github/workflows/deploy.yml`). Optional ones —
currently `CLOUDFLARE_AI_TOKEN`, which gates Llama Guard text moderation —
go in that workflow's `optional` list so a missing value disables the feature
instead of failing the deploy.
