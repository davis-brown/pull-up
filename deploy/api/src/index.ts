import { Container, getContainer } from "@cloudflare/containers";

import { drainInBatches } from "./background-drain";
import { corsPreflightResponse, isCorsPreflight } from "./cors-preflight";
import {
  MAX_PHOTO_BYTES,
  hasJpegMagic,
  isAllowedExternalKey,
  isAllowedPhotoKey,
  isJpegContentType,
  parseExternalKey,
  readUploadCredentials,
  timingSafeEqualStrings,
  verifyUploadSignature,
} from "./photo-security";

interface OptionalBindings {
  CORS_ORIGINS?: string;
  GOOGLE_CLIENT_IDS?: string;
  APPLE_AUDIENCES?: string;
  SENTRY_DSN?: string;
  EMAIL_FROM?: string;
  WEB_ORIGIN?: string;
  // Workers AI text moderation (Llama Guard). Both must be present for the
  // Go API to screen chat messages and notes; with either missing it
  // accepts text unscreened rather than failing closed.
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_TOKEN?: string;
  // Enables the enricher's Mapillary photo source; empty leaves it off and
  // courts still get Wikimedia Commons photos.
  MAPILLARY_TOKEN?: string;
  // Set per-deploy via `wrangler deploy --var DEPLOY_COMMIT:<sha>` so the
  // container can report which commit it is running.
  DEPLOY_COMMIT?: string;
}

type RuntimeEnv = Env & OptionalBindings;

const PHOTO_PREFIX = "/photos/";
const UPLOAD_PREFIX = "/photos/upload/";
// Auto-fetched Commons/Mapillary photos, cached read-through into R2 (see
// handleExternalPhotoRead). Distinct prefix from /photos/ — user photos are
// private and re-authorized on every read; these are openly licensed, public,
// and cacheable.
const EXTERNAL_PHOTO_PREFIX = "/photos-ext/";
// Upstream thumbnails are small; anything larger is not the image we expect.
const MAX_EXTERNAL_PHOTO_BYTES = 8 * 1024 * 1024;
// Openly-licensed images are stable, so let the edge and clients cache hard.
const EXTERNAL_PHOTO_CACHE = "public, max-age=86400";
// Content types Commons/Mapillary serve; served back verbatim under nosniff.
const EXTERNAL_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const INTERNAL_PREFIX = "/api/v1/internal";
const DENY_ALL_CORS_ORIGIN = "https://cors.invalid";
const MAX_INTERNAL_JSON_BYTES = 256 * 1024;
const MAX_DELETION_BATCH = 100;
const PHOTO_READ_WINDOW_MS = 60_000;
const PHOTO_READ_MAX_PER_WINDOW = 100;
// A scanner probes many distinct keys and gets a 404 for almost all of them,
// whereas a legitimate viewer requests keys that exist. Bounding not-found
// responses per client is therefore the signal that actually limits blind
// enumeration, without ever throttling real gallery browsing.
const PHOTO_MISS_MAX_PER_WINDOW = 40;
const EMAIL_TOKEN_HEADER = "X-Pull-Up-Email-Verification-Token";
const EMAIL_EXPIRY_HEADER = "X-Pull-Up-Email-Verification-Expires";
const EMAIL_TO_HEADER = "X-Pull-Up-Email-Verification-To";
const EMAIL_SENT_HEADER = "X-Pull-Up-Email-Sent";
const EMAIL_PATHS = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/email-verification/request",
]);

export class ApiContainer extends Container<RuntimeEnv> {
  defaultPort = 8080;
  // Short on purpose, so an idle container sleeps and lets the Neon endpoint
  // suspend behind it. The previous 20m lease was set to outlive the */15 cron
  // so the container never cold-started, but that reasoning was circular: the
  // cron is a drain for a queue that is almost always empty, not a heartbeat,
  // and "free" warmth billed the container ~100% of the time and held a pgx
  // pool open against the database around the clock. Organic traffic keeps the
  // container warm on its own; when there is none, nobody is waiting on it.
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState<{}>, env: RuntimeEnv) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      JWT_SECRET: env.JWT_SECRET,
      UPLOAD_SIGNING_SECRET: env.UPLOAD_SIGNING_SECRET,
      INTERNAL_TASK_SECRET: env.INTERNAL_TASK_SECRET,
      APP_ENV: "production",
      CORS_ORIGINS: env.CORS_ORIGINS?.trim() || DENY_ALL_CORS_ORIGIN,
      GOOGLE_CLIENT_IDS: env.GOOGLE_CLIENT_IDS ?? "",
      APPLE_AUDIENCES: env.APPLE_AUDIENCES ?? "",
      SENTRY_DSN: env.SENTRY_DSN ?? "",
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? "",
      CLOUDFLARE_AI_TOKEN: env.CLOUDFLARE_AI_TOKEN ?? "",
      MAPILLARY_TOKEN: env.MAPILLARY_TOKEN ?? "",
      TRUST_CF_CONNECTING_IP: "true",
      PORT: "8080",
      COMMIT: env.DEPLOY_COMMIT ?? "",
    };
  }
}

class UploadBodyError extends Error {}

// Simple in-memory fixed-window counters for anonymous photo reads. State is
// per-PoP/per-isolate, so these are best-effort cost/abuse guards layered on top
// of the real protection (122 bits of unguessable key entropy plus a backend
// authorization check), not a hard security boundary.
const readRateLimit = new Map<string, { count: number; resetAt: number }>();
const missRateLimit = new Map<string, { count: number; resetAt: number }>();

function bumpWindow(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  max: number,
): { allowed: boolean; count: number } {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + PHOTO_READ_WINDOW_MS });
    return { allowed: true, count: 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= max, count: entry.count };
}

// Flood guard for repeated reads of a single known object.
function trackPhotoRead(key: string): { allowed: boolean; count: number } {
  return bumpWindow(readRateLimit, key, PHOTO_READ_MAX_PER_WINDOW);
}

// Scanning guard: record a not-found response from a client (enumeration signal).
function trackPhotoMiss(client: string): void {
  bumpWindow(missRateLimit, client, PHOTO_MISS_MAX_PER_WINDOW);
}

// Read-only check of whether a client has already exceeded its not-found budget.
// Does not itself count against the window, so valid reads never trip it.
function overPhotoMissBudget(client: string): boolean {
  const entry = missRateLimit.get(client);
  if (!entry || Date.now() >= entry.resetAt) return false;
  return entry.count > PHOTO_MISS_MAX_PER_WINDOW;
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

function addVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  const values = new Set((current ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function allowedCorsOrigin(request: Request, env: RuntimeEnv): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configured = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured.includes("*")) return "*";
  return configured.includes(origin) ? origin : null;
}

function withPhotoHeaders(response: Response, request: Request, env: RuntimeEnv): Response {
  const headers = new Headers(response.headers);
  const origin = allowedCorsOrigin(request, env);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  addVary(headers, "Origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function photoError(
  request: Request,
  env: RuntimeEnv,
  status: number,
  message: string,
  headers?: HeadersInit,
): Response {
  return withPhotoHeaders(jsonResponse({ error: message }, status, headers), request, env);
}

function containerProxyRequest(request: Request, internalSecret?: string): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("Forwarded");
  headers.delete("True-Client-IP");
  headers.delete("X-Forwarded-For");
  headers.delete("X-Forwarded-Host");
  headers.delete("X-Forwarded-Proto");
  headers.delete("X-Real-IP");
  headers.delete("X-Internal-Task");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Real-IP", clientIp);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.slice(0, -1));
  if (request.headers.get("Origin")) headers.set("X-Pull-Up-Platform", "web");
  if (internalSecret) headers.set("X-Internal-Task", internalSecret);
  return new Request(request, { headers });
}

function sanitizedEmailResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete(EMAIL_TOKEN_HEADER);
  headers.delete(EMAIL_EXPIRY_HEADER);
  headers.delete(EMAIL_TO_HEADER);
  headers.delete(EMAIL_SENT_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function deliverVerificationEmail(response: Response, env: RuntimeEnv): Promise<Response> {
  const token = response.headers.get(EMAIL_TOKEN_HEADER);
  const expires = response.headers.get(EMAIL_EXPIRY_HEADER);
  const recipient = response.headers.get(EMAIL_TO_HEADER);
  if (!token || !expires || !recipient) {
    // Resend responses deliberately look the same for unknown and verified
    // addresses, preventing account enumeration.
    return sanitizedEmailResponse(response);
  }

  let webOrigin: string;
  try {
    const parsed = new URL(env.WEB_ORIGIN ?? "");
    if (parsed.protocol !== "https:" || parsed.origin !== parsed.href.replace(/\/$/, "")) {
      throw new Error("WEB_ORIGIN must be an HTTPS origin");
    }
    webOrigin = parsed.origin;
  } catch (error) {
    console.error(JSON.stringify({
      message: "verification email configuration invalid",
      error: error instanceof Error ? error.message : String(error),
    }));
    return sanitizedEmailResponse(response);
  }

  const from = env.EMAIL_FROM?.trim() ?? "";
  if (!/^\S+@\S+\.\S+$/.test(from) || !/^\S+@\S+\.\S+$/.test(recipient)) {
    console.error(JSON.stringify({ message: "verification email address configuration invalid" }));
    return sanitizedEmailResponse(response);
  }

  const verificationUrl = new URL("/verify-email", webOrigin);
  // Keep the credential out of URL search params: it would be sent in Referer
  // headers and recorded by edge invocation logs. The client reads the fragment
  // and clears it before issuing API requests.
  verificationUrl.hash = `token=${encodeURIComponent(token)}`;
  const text = [
    "Verify your pull-up account",
    "",
    "Open this link to verify your email address:",
    verificationUrl.toString(),
    "",
    `This link expires at ${expires}. If you did not create this account, ignore this email.`,
  ].join("\n");
  const html = [
    "<h1>Verify your pull-up account</h1>",
    "<p>Confirm this email address to finish creating your account.</p>",
    `<p><a href="${escapeHtml(verificationUrl.toString())}">Verify email</a></p>`,
    `<p>This link expires at ${escapeHtml(expires)}. If you did not create this account, ignore this email.</p>`,
  ].join("");

  try {
    await env.EMAIL.send({
      to: recipient,
      from: { email: from, name: "pull-up" },
      subject: "Verify your pull-up account",
      text,
      html,
    });
    return sanitizedEmailResponse(response);
  } catch (error) {
    console.error(JSON.stringify({
      message: "verification email send failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return sanitizedEmailResponse(response);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function handlePhotoOptions(request: Request, env: RuntimeEnv): Response {
  const origin = allowedCorsOrigin(request, env);
  if (!request.headers.get("Origin") || !origin) {
    return photoError(request, env, 403, "origin not allowed");
  }

  const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  if (!requestedMethod || !["GET", "HEAD", "PUT"].includes(requestedMethod)) {
    return photoError(request, env, 405, "method not allowed", { Allow: "GET, HEAD, PUT, OPTIONS" });
  }

  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !["authorization", "content-type"].includes(header))) {
    return photoError(request, env, 403, "request header not allowed");
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Allow: "GET, HEAD, PUT, OPTIONS",
  });
  addVary(headers, "Origin");
  addVary(headers, "Access-Control-Request-Method");
  addVary(headers, "Access-Control-Request-Headers");
  return new Response(null, { status: 204, headers });
}

async function handlePhotoUpload(
  request: Request,
  env: RuntimeEnv,
  url: URL,
  key: string,
): Promise<Response> {
  const credentials = readUploadCredentials(request);
  if (
    !credentials ||
    url.search !== "" ||
    !(await verifyUploadSignature(env.UPLOAD_SIGNING_SECRET, key, credentials))
  ) {
    return photoError(request, env, 403, "invalid or expired upload signature");
  }

  if (!isJpegContentType(request.headers.get("Content-Type"))) {
    return photoError(request, env, 415, "Content-Type must be image/jpeg");
  }
  const contentEncoding = request.headers.get("Content-Encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    return photoError(request, env, 415, "encoded upload bodies are not supported");
  }
  if (!request.body) {
    return photoError(request, env, 400, "photo body is required");
  }

  const contentLength = request.headers.get("Content-Length");
  if (!contentLength) {
    return photoError(request, env, 411, "Content-Length is required");
  }
  if (!/^[1-9][0-9]*$/.test(contentLength)) {
    return photoError(request, env, 400, "invalid Content-Length");
  }
  const expectedBytes = Number(contentLength);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_PHOTO_BYTES) {
    return photoError(request, env, 413, "photo must be 8 MB or smaller");
  }

  try {
    const upload = await validatedUploadStream(request.body, expectedBytes);
    if (!hasJpegMagic(upload.prefix)) {
      await upload.cancel();
      return photoError(request, env, 415, "upload body is not a JPEG");
    }

    const onlyIf = new Headers({ "If-None-Match": "*" });
    try {
      const object = await env.PHOTOS.put(key, upload.readable, {
        onlyIf,
        httpMetadata: {
          contentType: "image/jpeg",
          contentDisposition: "inline",
          cacheControl: "private, no-store",
        },
        customMetadata: { validated: "image/jpeg" },
      });
      if (!object) {
        await upload.cancel();
        const existing = await env.PHOTOS.head(key);
        if (existing?.customMetadata?.validated !== "image/jpeg") {
          return photoError(request, env, 409, "photo already uploaded");
        }
        try {
          await recordMediaUploaded(env, key);
        } catch (finalizeError) {
          // Leave the existing validated object in place; finalization was
          // only a re-confirmation. The error is still logged and surfaced.
          throw finalizeError;
        }
        return withPhotoHeaders(jsonResponse({ ok: true }, 200), request, env);
      }
      await upload.pump;
      try {
        await recordMediaUploaded(env, key);
      } catch (finalizeError) {
        // Finalization failed but the object was already written. Remove the
        // orphan so we do not retain unreferenced bytes. The client will retry
        // with a fresh key if it chooses to.
        await env.PHOTOS.delete(key).catch(() => {});
        throw finalizeError;
      }
    } catch (error) {
      const pumpError = await upload.cancel();
      throw pumpError instanceof UploadBodyError ? pumpError : error;
    }
    return withPhotoHeaders(jsonResponse({ ok: true }, 201), request, env);
  } catch (error) {
    if (error instanceof UploadBodyError) {
      return photoError(request, env, 400, error.message);
    }
    console.error(JSON.stringify({
      message: "photo upload failed",
      error: error instanceof Error ? error.message : String(error),
      key,
    }));
    return photoError(request, env, 500, "photo upload failed");
  }
}

async function validatedUploadStream(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
): Promise<{
  prefix: Uint8Array;
  readable: ReadableStream<Uint8Array>;
  pump: Promise<void>;
  cancel: () => Promise<unknown>;
}> {
  const reader = body.getReader();
  const initial: Uint8Array[] = [];
  let seen = 0;

  while (seen < 3) {
    const result = await reader.read();
    if (result.done) {
      await reader.cancel().catch(() => undefined);
      throw new UploadBodyError("photo body is too short");
    }
    seen += result.value.byteLength;
    if (seen > expectedBytes || seen > MAX_PHOTO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new UploadBodyError("photo body exceeds its declared size");
    }
    initial.push(result.value);
  }

  const prefix = new Uint8Array(3);
  let prefixOffset = 0;
  for (const chunk of initial) {
    const amount = Math.min(chunk.byteLength, prefix.byteLength - prefixOffset);
    prefix.set(chunk.subarray(0, amount), prefixOffset);
    prefixOffset += amount;
    if (prefixOffset === prefix.byteLength) break;
  }

  let initialIndex = 0;
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (initialIndex < initial.length) {
        controller.enqueue(initial[initialIndex++]!);
        return;
      }

      const result = await reader.read();
      if (result.done) {
        if (seen !== expectedBytes) {
          controller.error(new UploadBodyError("photo body does not match Content-Length"));
        } else {
          controller.close();
        }
        return;
      }

      seen += result.value.byteLength;
      if (seen > expectedBytes || seen > MAX_PHOTO_BYTES) {
        await reader.cancel().catch(() => undefined);
        controller.error(new UploadBodyError("photo body exceeds its declared size"));
        return;
      }
      controller.enqueue(result.value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });

  const fixedLength = new FixedLengthStream(expectedBytes);
  const pump = source.pipeTo(fixedLength.writable);
  return {
    prefix,
    readable: fixedLength.readable,
    pump,
    cancel: async () => {
      const pumpResult = pump.then<unknown, unknown>(
        () => null,
        (reason: unknown) => reason,
      );
      await fixedLength.readable.cancel("invalid image signature").catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      return pumpResult;
    },
  };
}

async function authorizeMedia(env: RuntimeEnv, key: string): Promise<boolean> {
  const response = await fetchContainerInternal(env, `${INTERNAL_PREFIX}/media/authorize`, {
    method: "POST",
    body: JSON.stringify({ key }),
  }, 15_000);
  if (response.status === 204) return true;
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return false;
  }
  await response.body?.cancel();
  throw new Error(`media authorization returned HTTP ${response.status}`);
}

async function recordMediaUploaded(env: RuntimeEnv, key: string): Promise<void> {
  const response = await fetchContainerInternal(env, `${INTERNAL_PREFIX}/media/uploaded`, {
    method: "POST",
    body: JSON.stringify({ key }),
  }, 15_000);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`media finalization returned HTTP ${response.status}`);
  }
  await response.body?.cancel();
}

async function handlePhotoRead(
  request: Request,
  env: RuntimeEnv,
  key: string,
): Promise<Response> {
  // Rate-limit anonymous reads at the edge before any backend work.
  const colo = request.cf?.colo ?? "unknown";
  const client = `${colo}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`;
  const readLimit = trackPhotoRead(`${colo}:${key}`);
  if (!readLimit.allowed) {
    return photoError(request, env, 429, "too many photo reads");
  }
  // A client already over the not-found budget is enumerating keys; stop it
  // before spending an R2 lookup on yet another guess.
  if (overPhotoMissBudget(client)) {
    return photoError(request, env, 429, "too many photo reads");
  }

  // Check R2 existence first. A missing object is the common case for random
  // keys, and this avoids pointless database/container load.
  const headOnly = request.method === "HEAD";
  const object = headOnly ? await env.PHOTOS.head(key) : await env.PHOTOS.get(key);
  if (!object) {
    // Count this miss so sustained enumeration trips the guard above.
    trackPhotoMiss(client);
    return photoError(request, env, 404, "not found");
  }

  let authorized: boolean;
  try {
    authorized = await authorizeMedia(env, key);
  } catch (error) {
    console.error(JSON.stringify({
      message: "media authorization failed",
      error: error instanceof Error ? error.message : String(error),
      key,
    }));
    return photoError(request, env, 503, "media authorization unavailable");
  }
  if (!authorized) return photoError(request, env, 404, "not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "image/jpeg");
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", object.uploaded.toUTCString());
  headers.set("Cache-Control", "private, no-store");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const body = !headOnly && "body" in object && object.body instanceof ReadableStream
    ? object.body
    : null;
  return withPhotoHeaders(new Response(body, { status: 200, headers }), request, env);
}

async function handlePhotos(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const isUpload = url.pathname.startsWith(UPLOAD_PREFIX);
  const key = url.pathname.slice((isUpload ? UPLOAD_PREFIX : PHOTO_PREFIX).length);
  if (!key || !isAllowedPhotoKey(key)) {
    return photoError(request, env, 404, "not found");
  }
  if (request.method === "OPTIONS") return handlePhotoOptions(request, env);
  if (isUpload && request.method === "PUT") return handlePhotoUpload(request, env, url, key);
  if (!isUpload && (request.method === "GET" || request.method === "HEAD")) {
    return handlePhotoRead(request, env, key);
  }
  return photoError(request, env, 405, "method not allowed", {
    Allow: isUpload ? "PUT, OPTIONS" : "GET, HEAD, OPTIONS",
  });
}

async function handleExternalPhotos(request: Request, env: RuntimeEnv, url: URL): Promise<Response> {
  const key = url.pathname.slice(EXTERNAL_PHOTO_PREFIX.length);
  if (!isAllowedExternalKey(key)) {
    return photoError(request, env, 404, "not found");
  }
  if (request.method === "OPTIONS") return handlePhotoOptions(request, env);
  if (request.method === "GET" || request.method === "HEAD") {
    return handleExternalPhotoRead(request, env, key);
  }
  return photoError(request, env, 405, "method not allowed", { Allow: "GET, HEAD, OPTIONS" });
}

// handleExternalPhotoRead serves an auto-fetched Commons/Mapillary photo from
// R2, filling the cache from the upstream URL on the first read. Filling from
// upstream (rather than storing the URL at enrichment time) matters because
// Mapillary thumbnails are signed URLs that expire hours after enrichment; the
// first court view lands while the URL is still fresh and pins the bytes in R2.
// Visibility is re-checked with the container on every read, so an admin hiding
// a photo takes effect immediately regardless of what R2 already cached.
async function handleExternalPhotoRead(
  request: Request,
  env: RuntimeEnv,
  key: string,
): Promise<Response> {
  const colo = request.cf?.colo ?? "unknown";
  const client = `${colo}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`;
  if (!trackPhotoRead(`${colo}:${key}`).allowed || overPhotoMissBudget(client)) {
    return photoError(request, env, 429, "too many photo reads");
  }

  const parsed = parseExternalKey(key);
  if (!parsed) return photoError(request, env, 404, "not found");

  let imageUrl: string | null;
  try {
    imageUrl = await resolveExternalPhoto(env, parsed.source, parsed.sourceId);
  } catch (error) {
    console.error(JSON.stringify({
      message: "external photo resolve failed",
      error: error instanceof Error ? error.message : String(error),
      key,
    }));
    return photoError(request, env, 503, "external photo resolution unavailable");
  }
  if (imageUrl === null) {
    trackPhotoMiss(client);
    return photoError(request, env, 404, "not found");
  }

  const headOnly = request.method === "HEAD";
  const cached = headOnly ? await env.PHOTOS.head(key) : await env.PHOTOS.get(key);
  if (cached) {
    return serveExternalObject(cached, headOnly, request, env);
  }
  return fillExternalPhoto(request, env, key, imageUrl, headOnly);
}

// resolveExternalPhoto asks the container for a visible external photo's
// upstream URL. Returns null when the photo is hidden or unknown (HTTP 404),
// and throws on any transport or backend failure so the caller can 503.
async function resolveExternalPhoto(
  env: RuntimeEnv,
  source: string,
  sourceId: string,
): Promise<string | null> {
  const response = await fetchContainerInternal(
    env,
    `${INTERNAL_PREFIX}/external-photo/resolve`,
    { method: "POST", body: JSON.stringify({ source, source_id: sourceId }) },
    15_000,
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`external photo resolve returned HTTP ${response.status}`);
  }
  const body = await readJsonLimited(response, 8 * 1024);
  if (!isRecord(body) || typeof body.image_url !== "string" || !isHttpsUrl(body.image_url)) {
    throw new Error("external photo resolve returned an invalid response");
  }
  return body.image_url;
}

async function fillExternalPhoto(
  request: Request,
  env: RuntimeEnv,
  key: string,
  imageUrl: string,
  headOnly: boolean,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(imageUrl, {
      method: "GET",
      headers: { Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "external photo upstream fetch failed",
      error: error instanceof Error ? error.message : String(error),
      key,
    }));
    return photoError(request, env, 502, "external photo unavailable");
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return photoError(request, env, 502, "external photo unavailable");
  }

  const contentType = (upstream.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!EXTERNAL_PHOTO_TYPES.has(contentType)) {
    await upstream.body?.cancel();
    return photoError(request, env, 502, "external photo has an unexpected type");
  }
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXTERNAL_PHOTO_BYTES) {
    return photoError(request, env, 502, "external photo unavailable");
  }

  await env.PHOTOS.put(key, bytes, {
    httpMetadata: {
      contentType,
      contentDisposition: "inline",
      cacheControl: EXTERNAL_PHOTO_CACHE,
    },
    customMetadata: { validated: contentType, cachedFrom: "external" },
  });

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Length", String(bytes.byteLength));
  headers.set("Cache-Control", EXTERNAL_PHOTO_CACHE);
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const body = headOnly ? null : bytes;
  return withPhotoHeaders(new Response(body, { status: 200, headers }), request, env);
}

function serveExternalObject(
  object: R2Object | R2ObjectBody,
  headOnly: boolean,
  request: Request,
  env: RuntimeEnv,
): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", object.uploaded.toUTCString());
  headers.set("Cache-Control", EXTERNAL_PHOTO_CACHE);
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const body = !headOnly && "body" in object && object.body instanceof ReadableStream
    ? object.body
    : null;
  return withPhotoHeaders(new Response(body, { status: 200, headers }), request, env);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchContainerInternal(
  env: RuntimeEnv,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Internal-Task", env.INTERNAL_TASK_SECRET);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return getContainer(env.API_CONTAINER).fetch(new Request(`http://container${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  }));
}

async function readJsonLimited(response: Response, limit = MAX_INTERNAL_JSON_BYTES): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("internal response exceeded size limit");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Keys the deletion drain will act on: user photo/avatar keys plus the
// ext/<source>/<id> cache keys enqueued when an admin hides an external photo.
function isPhotoKeyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (key) => typeof key === "string" && (isAllowedPhotoKey(key) || isAllowedExternalKey(key)),
  );
}

async function drainBackendBacklog(env: RuntimeEnv): Promise<{ tiles: number; courts: number }> {
  const response = await fetchContainerInternal(env, `${INTERNAL_PREFIX}/drain`, { method: "POST" }, 65_000);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`backend drain returned HTTP ${response.status}`);
  }
  const body = await readJsonLimited(response, 64 * 1024);
  if (
    !isRecord(body) ||
    !isNonnegativeSafeInteger(body.tiles) ||
    !isNonnegativeSafeInteger(body.courts)
  ) {
    throw new Error("backend drain returned an invalid response");
  }
  return { tiles: body.tiles, courts: body.courts };
}

async function drainObjectDeletions(env: RuntimeEnv): Promise<number> {
  const claimResponse = await fetchContainerInternal(
    env,
    `${INTERNAL_PREFIX}/media/deletions/claim`,
    { method: "POST", body: JSON.stringify({ limit: MAX_DELETION_BATCH }) },
    15_000,
  );
  if (claimResponse.status === 204) return 0;
  if (!claimResponse.ok) {
    await claimResponse.body?.cancel();
    throw new Error(`deletion claim returned HTTP ${claimResponse.status}`);
  }

  const claim = await readJsonLimited(claimResponse);
  if (!isRecord(claim) || !isPhotoKeyArray(claim.keys)) {
    throw new Error("deletion claim returned an invalid response");
  }
  const keys = claim.keys;
  if (
    keys.length > MAX_DELETION_BATCH ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error("deletion claim returned invalid object keys");
  }
  if (keys.length === 0) return 0;

  await env.PHOTOS.delete(keys);
  const ackResponse = await fetchContainerInternal(
    env,
    `${INTERNAL_PREFIX}/media/deletions/ack`,
    { method: "POST", body: JSON.stringify({ keys }) },
    15_000,
  );
  if (!ackResponse.ok) {
    await ackResponse.body?.cancel();
    throw new Error(`deletion acknowledgement returned HTTP ${ackResponse.status}`);
  }
  await ackResponse.body?.cancel();
  return keys.length;
}

// Entries become claimable an hour after they are enqueued (see
// ScheduleUploadedObjectCleanup), so the cron is the only drain that can ever
// find work — a drain fired from the request that created the entry would
// always claim nothing. Looping here keeps deletion throughput independent of
// the cron interval, bounded so one invocation cannot run away.
const MAX_DELETION_PASSES = 20;

async function drainObjectDeletionsFully(env: RuntimeEnv) {
  return drainInBatches(
    () => drainObjectDeletions(env),
    MAX_DELETION_BATCH,
    MAX_DELETION_PASSES,
  );
}

type TimedResult<T> =
  | { status: "fulfilled"; result: T; durationMs: number }
  | { status: "rejected"; error: unknown; durationMs: number };

async function timed<T>(work: () => Promise<T>): Promise<TimedResult<T>> {
  const startedAt = Date.now();
  try {
    const result = await work();
    return { status: "fulfilled", result, durationMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "rejected", error, durationMs: Date.now() - startedAt };
  }
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(EXTERNAL_PHOTO_PREFIX)) {
      return handleExternalPhotos(request, env, url);
    }
    if (url.pathname.startsWith(PHOTO_PREFIX)) {
      return handlePhotos(request, env, url);
    }
    // The deploy pipeline confirms container rollout by polling the version
    // endpoint with the internal-task secret; every other internal route is
    // reachable only from this Worker's own container calls.
    const providedTaskSecret = request.headers.get("X-Internal-Task");
    const isVersionCheck =
      url.pathname === `${INTERNAL_PREFIX}/version` &&
      request.method === "GET" &&
      providedTaskSecret !== null &&
      Boolean(env.INTERNAL_TASK_SECRET) &&
      timingSafeEqualStrings(providedTaskSecret, env.INTERNAL_TASK_SECRET);
    if (url.pathname.startsWith(INTERNAL_PREFIX) && !isVersionCheck) {
      return jsonResponse({ error: "not found" }, 404);
    }

    // Answered at the edge so a preflight never wakes the container. Placed
    // after the internal-route guard so internal paths still 404 rather than
    // advertising their methods.
    if (isCorsPreflight(request)) {
      return corsPreflightResponse(request, allowedCorsOrigin(request, env));
    }

    try {
      const isEmailRequest = request.method === "POST" && EMAIL_PATHS.has(url.pathname);
      const injectSecret = isEmailRequest || isVersionCheck;
      const response = await getContainer(env.API_CONTAINER).fetch(
        containerProxyRequest(request, injectSecret ? env.INTERNAL_TASK_SECRET : undefined),
      );
      return isEmailRequest
        ? await deliverVerificationEmail(response, env)
        : response;
    } catch (error) {
      console.error(JSON.stringify({
        message: "container request failed",
        error: error instanceof Error ? error.message : String(error),
        method: request.method,
        path: url.pathname,
      }));
      return jsonResponse({ error: "service unavailable" }, 503);
    }
  },

  async scheduled(event: ScheduledController, env: RuntimeEnv): Promise<void> {
    const [backlog, deletions] = await Promise.all([
      timed(() => drainBackendBacklog(env)),
      timed(() => drainObjectDeletionsFully(env)),
    ]);

    const common = {
      event: "background_drain",
      trigger: "cron",
      cron: event.cron,
      scheduled_time: event.scheduledTime,
    } as const;
    const errors: string[] = [];
    if (backlog.status === "rejected") {
      const error = backlog.error instanceof Error ? backlog.error.message : String(backlog.error);
      errors.push(`backlog: ${error}`);
      console.error({
        ...common,
        queue: "court_enrichment",
        outcome: "error",
        duration_ms: backlog.durationMs,
        error,
      });
    } else {
      console.log({
        ...common,
        queue: "court_enrichment",
        outcome: "ok",
        duration_ms: backlog.durationMs,
        enrichment_attempts: backlog.result.courts,
        osm_tiles_attempted: backlog.result.tiles,
      });
    }
    if (deletions.status === "rejected") {
      const error = deletions.error instanceof Error ? deletions.error.message : String(deletions.error);
      errors.push(`deletions: ${error}`);
      console.error({
        ...common,
        queue: "object_deletion",
        outcome: "error",
        duration_ms: deletions.durationMs,
        error,
      });
    } else {
      console.log({
        ...common,
        queue: "object_deletion",
        outcome: "ok",
        duration_ms: deletions.durationMs,
        objects_deleted: deletions.result.itemsProcessed,
        claim_passes: deletions.result.claimPasses,
        saturated: deletions.result.saturated,
      });
    }
    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }
  },
} satisfies ExportedHandler<RuntimeEnv>;
