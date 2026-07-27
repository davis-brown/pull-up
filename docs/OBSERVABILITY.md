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

Create these saved views under **Workers & Pages → pull-up-api →
Observability**. Cloudflare stores saved views in the account rather than in
Wrangler, so this file is their source-controlled definition.

### API edge latency

Use invocation records with all of these filters:

| Field | Operator | Value |
|---|---|---|
| `$cloudflare.$metadata.type` | equals | `cf-worker-event` |
| `$cloudflare.executionModel` | equals | `stateless` |
| `$cloudflare.eventType` | equals | `fetch` |

Name the view **API · stateless fetches**. The `executionModel` filter removes
the Durable Object half of each request; `eventType=fetch` keeps the 15-minute
cron out of request counts and latency percentiles.

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
