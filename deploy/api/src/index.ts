import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  API_CONTAINER: DurableObjectNamespace;
  DATABASE_URL: string;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  // OAuth audiences (comma-separated). Empty/unset disables that provider.
  GOOGLE_CLIENT_IDS?: string;
  APPLE_AUDIENCES?: string;
  // Sentry crash reporting for the Go API. Optional.
  SENTRY_DSN?: string;
  // R2 bucket for court photos. Optional: photo routes return 503 until the
  // binding is configured (requires R2 enabled on the account).
  PHOTOS?: R2Bucket;
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export class ApiContainer extends Container {
  defaultPort = 8080;
  // Scale to zero when idle; cold start is just the Go binary + pgx pool.
  sleepAfter = "15m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      JWT_SECRET: env.JWT_SECRET,
      APP_ENV: "production",
      CORS_ORIGINS: env.CORS_ORIGINS ?? "*",
      GOOGLE_CLIENT_IDS: env.GOOGLE_CLIENT_IDS ?? "",
      APPLE_AUDIENCES: env.APPLE_AUDIENCES ?? "",
      SENTRY_DSN: env.SENTRY_DSN ?? "",
      PORT: "8080",
    };
  }
}

// Verifies the HMAC the Go API signs into upload URLs:
// hex(hmac-sha256(`${key}:${exp}`, JWT_SECRET)).
async function verifyUploadSig(
  secret: string,
  key: string,
  exp: string,
  sig: string,
): Promise<boolean> {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${key}:${exp}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time-ish comparison.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

async function handlePhotos(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.PHOTOS) {
    return Response.json({ error: "photo storage not enabled" }, { status: 503 });
  }

  // PUT /photos/upload/<key>?exp=&sig=  — HMAC-authorized upload.
  if (request.method === "PUT" && url.pathname.startsWith("/photos/upload/")) {
    const key = url.pathname.slice("/photos/upload/".length);
    const exp = url.searchParams.get("exp") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    if (!key.startsWith("courts/") || !(await verifyUploadSig(env.JWT_SECRET, key, exp, sig))) {
      return Response.json({ error: "invalid or expired upload signature" }, { status: 403 });
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!length || length > MAX_PHOTO_BYTES) {
      return Response.json({ error: "photo must be under 8 MB" }, { status: 413 });
    }
    await env.PHOTOS.put(key, request.body, {
      httpMetadata: {
        contentType: request.headers.get("content-type") ?? "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return Response.json({ ok: true }, { status: 201 });
  }

  // GET /photos/<key> — public read.
  if (request.method === "GET") {
    const key = url.pathname.slice("/photos/".length);
    if (!key.startsWith("courts/")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const object = await env.PHOTOS.get(key);
    if (!object) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Photo storage is served straight from the Worker's R2 binding; the Go
    // container only issues the signed upload URLs.
    if (url.pathname.startsWith("/photos/")) {
      return handlePhotos(request, env, url);
    }
    // Single container instance: the API is stateless, but one instance
    // means one Postgres connection pool. Revisit with getRandom() +
    // max_instances if load ever demands it.
    return getContainer(env.API_CONTAINER).fetch(request);
  },
};
