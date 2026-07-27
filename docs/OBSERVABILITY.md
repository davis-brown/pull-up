# Observability runbook

The API runs as two Cloudflare execution models under the same `pull-up-api`
Worker: the public stateless Worker and the `ApiContainer` Durable Object that
owns the Go container. A request proxied to the Go API therefore produces two
invocation records. This is expected fan-out, not duplicate application
logging, and both records remain enabled because the Durable Object entry is
useful for container and cold-start diagnosis. Photo routes and rejected
internal routes are handled at the stateless edge and produce no container
invocation.

The Go API emits JSON logs to the container's stderr. Its `http request` event
measures Go handler time only; Cloudflare's stateless fetch invocation measures
the user-facing Worker edge. Do not combine the two latency series.

## Cloudflare views

All three views below exist, created 2026-07-27 and reachable under
**Observability → Queries**. Cloudflare stores them in the account rather than
in Wrangler, so this file remains their source-controlled definition — rebuild
from here if one is edited or deleted. They have to be created by hand: saved
views are the observability *queries* API, and the deploy token can read that
endpoint but not write it.

Field names below are the ones the query API accepts, verified against live
`pull-up-api` logs. Invocation metadata lives under `$workers.`, not
`$cloudflare.`; drain fields are top-level because the Worker logs a flat JSON
object. Numeric fields need their type set explicitly, or a calculation over
them returns empty. There is no `p50` operator — the median is `median`.

Saved views are account-scoped, not per-Worker, so any view whose fields are
not unique to this Worker needs an explicit `$metadata.service` filter. The
drain views do not: `event=background_drain` is ours alone.

### API edge latency

Use invocation records with all of these filters:

| Field | Operator | Value |
|---|---|---|
| `$metadata.service` | equals | `pull-up-api` |
| `$metadata.type` | equals | `cf-worker-event` |
| `$workers.executionModel` | equals | `stateless` |
| `$workers.eventType` | equals | `fetch` |

Name the view **API · stateless fetches**. The `executionModel` filter removes
the Durable Object half of each request; `eventType=fetch` keeps the 15-minute
cron out of request counts and latency percentiles. It carries `count` plus
`median`, `p95`, and `p99` of `$workers.wallTimeMs`; group by
`$workers.outcome` to separate `ok` from `exception` and `exceededCpu`.

### Court enrichment drain

Use custom logs with:

| Field | Operator | Value |
|---|---|---|
| `event` | equals | `background_drain` |
| `queue` | equals | `court_enrichment` |

Name the view **Drain · court enrichment**. Keep `outcome`,
`enrichment_attempts`, `osm_tiles_attempted`, `duration_ms`, and `error` visible.
`enrichment_attempts` counts claimed courts, not guaranteed completions; search
the Go container logs for message `enriched court` when completion-level detail
is needed. A zero-attempt cron is healthy when the warm container already
drained the queue.

### Object-deletion drain

Use custom logs with:

| Field | Operator | Value |
|---|---|---|
| `event` | equals | `background_drain` |
| `queue` | equals | `object_deletion` |

Name the view **Drain · object deletion**. Keep `outcome`, `objects_deleted`,
`claim_passes`, `saturated`, `duration_ms`, and `error` visible.
`claim_passes` includes the final empty or partial claim that established the
queue was drained. `saturated=true` means all 20 bounded claim passes were full,
so backlog may remain; a repeated saturated or error result needs investigation.

## Triage

- For elevated edge latency, start with **API · stateless fetches**, then compare
  the matching Durable Object invocation and Go `http request` duration.
- For `court_enrichment` errors, inspect nearby Go warnings for Nominatim,
  Commons, Mapillary, or Overpass and check the Sentry enrichment fingerprint.
- For `object_deletion` errors, identify whether claim, R2 deletion, or
  acknowledgement failed from the structured `error` field. Claims are leased
  and become retryable after five minutes.
- Never include request query strings, authorization values, email addresses,
  or storage object keys in new logs.
