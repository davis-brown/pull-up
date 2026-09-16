// CORS preflight answered at the stateless edge.
//
// Every browser call to the API used to send its OPTIONS preflight all the way
// through the Durable Object into the Go container — over a sample week the
// Worker logged more preflights than actual searches, each ~97ms and each one
// able to wake a sleeping container. The container's go-chi/cors handler is
// still the authority for real requests; this mirrors its configuration for
// the preflight only, so a rejected origin is rejected identically at both
// layers.
//
// Keep these three constants in sync with cors.Options in
// server/internal/api/server.go.

export const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

// Compared case-insensitively: Access-Control-Request-Headers is lowercased by
// the browser, but the Go allowlist is written in canonical header case.
export const ALLOWED_HEADERS = ["authorization", "content-type", "x-pull-up-platform"] as const;

// Chrome caps preflight caching at 7200s and Safari at 600s, so this is the
// highest value that actually buys anything. The old 600 meant an active
// session re-paid the preflight every ten minutes.
export const PREFLIGHT_MAX_AGE = 7200;

const VARY = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";

/**
 * A preflight is an OPTIONS carrying both Origin and
 * Access-Control-Request-Method. A bare OPTIONS is not a preflight and is left
 * to the container, which owns the per-route Allow list.
 */
export function isCorsPreflight(request: Request): boolean {
  return (
    request.method === "OPTIONS" &&
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null
  );
}

function reject(status: number, message: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", VARY);
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

/**
 * Builds the preflight response. `allowedOrigin` is the caller's already
 * resolved allowlist decision — null means the Origin is not allowed, in which
 * case no CORS headers are emitted and the browser blocks the real request.
 */
export function corsPreflightResponse(request: Request, allowedOrigin: string | null): Response {
  if (!allowedOrigin) {
    return reject(403, "origin not allowed");
  }

  const method = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  if (!method || !ALLOWED_METHODS.includes(method as (typeof ALLOWED_METHODS)[number])) {
    return reject(405, "method not allowed", { Allow: ALLOWED_METHODS.join(", ") });
  }

  const requested = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    requested.some((header) => !ALLOWED_HEADERS.includes(header as (typeof ALLOWED_HEADERS)[number]))
  ) {
    return reject(403, "request header not allowed");
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Pull-Up-Platform",
    "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE),
    Vary: VARY,
  });
  // Credentialed responses may not use a wildcard origin. Config validation
  // rejects "*" for the container, so this only guards the degenerate case.
  if (allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(null, { status: 204, headers });
}
