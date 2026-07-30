# Running the deployed shape locally

`make dev` runs the Go API directly on `:8080`. That is the fast loop, but it
skips everything the Worker in `deploy/api` does in production: the container
proxy, the R2 and `EMAIL` bindings, the HMAC guard on photo uploads, and the
cron drain.

`make dev-worker` runs that layer locally — the real Worker code on `workerd`,
proxying into the Go container built from `server/Dockerfile`:

```sh
make dev-worker        # -> http://localhost:8787
```

No Cloudflare account, no `wrangler login`, nothing deployed, no cost. Both
paths can run at once (`:8080` direct, `:8787` through the Worker); they share
the compose database and the dev signing secrets, so an access token minted by
one is valid on the other.

## Requirements

- Docker **with buildx**. Wrangler builds the container image with
  `docker build --load`, which the legacy builder does not support — without
  buildx the build fails with `unknown flag: --load`. On Debian/Ubuntu:
  `sudo apt-get install docker-buildx`.
- `deploy/api/.dev.vars` (gitignored) holding `DATABASE_URL`, `JWT_SECRET`,
  `UPLOAD_SIGNING_SECRET`, and `INTERNAL_TASK_SECRET`. Use the same committed
  dev placeholders the Makefile uses, so tokens and upload signatures stay
  interchangeable between the two local paths. Never put a real secret here.

## Why the database publishes on two addresses

`docker-compose.yml` publishes Postgres twice:

| bind | used by |
| --- | --- |
| `127.0.0.1:5432` | `make dev`, `make test-int`, `scripts/dbq` |
| `172.17.0.1:5432` | the API container under `make dev-worker` |

The Go API runs *inside a container* under `wrangler dev`, so it cannot reach a
loopback-only publish on the host. It resolves `host.docker.internal` to the
Docker bridge gateway (`172.17.0.1` by default), hence the second bind. That is
deliberately the bridge gateway and not `0.0.0.0` — `docker0` is a host-local
interface, so Postgres still is not exposed to the LAN.

If your `docker0` is not on Docker's default `172.17.0.0/16`, check with
`ip -4 addr show docker0` and override:

```sh
PULLUP_DB_BRIDGE_BIND=<gateway-ip> docker compose up -d db
```

## Verifying it

With `make dev-worker` running in another terminal:

```sh
make smoke-worker
```

That drives a real signup all the way through the email round trip, then
asserts the Worker-specific guarantees: the verification token never comes back
over the wire, an unsigned photo upload gets a `403` from the HMAC guard (the
same assertion `.github/workflows/deploy.yml` makes against production), and the
cron drain handler runs. `make smoke` is the equivalent against `make dev` on
`:8080`.

Both spend requests against `RATE_LIMIT_AUTH_PER_MIN` (default 10/min per IP),
so several runs in quick succession will be throttled — that is the limiter
working, and the scripts say so explicitly rather than failing obscurely.

## How verification works on each path

Registration returns `202 verification_required`; tokens only come back once the
address is verified. Where the verification token is readable differs, which is
the main thing to know when driving either path by hand:

- **`make dev` (`:8080`, no Worker).** The origin returns the token in the
  `X-Pull-Up-Email-Verification-Token` response header, but only to a caller
  presenting `INTERNAL_TASK_SECRET`. This is what `scripts/smoke.sh` uses.
- **`make dev-worker` (`:8787`).** The token is never returned to the client.
  `sanitizedEmailResponse()` in `deploy/api/src/index.ts` strips those
  origin-only headers on every path — including for a caller holding the real
  secret — and the Worker sends the email through its `EMAIL` binding instead.
  Locally that binding writes the message to disk and logs the path:

  ```
  send_email binding called with MessageBuilder:
  Text: deploy/api/.wrangler/tmp/email/miniflare-*/email-text/<id>.txt
  ```

  `scripts/smoke-worker.sh` reads the token out of that file, which is the only
  way to complete a signup through the Worker — as it should be.
