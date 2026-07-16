import { Container, getContainer } from "@cloudflare/containers";

import {
  MAX_PHOTO_BYTES,
  hasJpegMagic,
  isAllowedPhotoKey,
  isJpegContentType,
  readUploadCredentials,
  verifyUploadSignature,
} from "./photo-security";

interface OptionalBindings {
  CORS_ORIGINS?: string;
  GOOGLE_CLIENT_IDS?: string;
  APPLE_AUDIENCES?: string;
  SENTRY_DSN?: string;
  EMAIL_FROM?: string;
  WEB_ORIGIN?: string;
}

type RuntimeEnv = Env & OptionalBindings;

const PHOTO_PREFIX = "/photos/";
const UPLOAD_PREFIX = "/photos/upload/";
const INTERNAL_PREFIX = "/api/v1/internal";
const DENY_ALL_CORS_ORIGIN = "https://cors.invalid";
const MAX_INTERNAL_JSON_BYTES = 256 * 1024;
const MAX_DELETION_BATCH = 100;
const PHOTO_READ_WINDOW_MS = 60_000;
const PHOTO_READ_MAX_PER_WINDOW = 100;
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
  sleepAfter = "15m";

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
      TRUST_CF_CONNECTING_IP: "true",
      PORT: "8080",
    };
  }
}

class UploadBodyError extends Error {}

// Simple in-memory sliding-window rate limiter for anonymous photo reads.
// Keys are per-PoP and per-object; the limit is intentionally lenient for
// legitimate gallery browsing but blocks blind scanning.
const readRateLimit = new Map<string, { count: number; resetAt: number }>();

function trackPhotoRead(key: string): { allowed: boolean; count: number } {
  const now = Date.now();
  const entry = readRateLimit.get(key);
  if (!entry || now >= entry.resetAt) {
    readRateLimit.set(key, { count: 1, resetAt: now + PHOTO_READ_WINDOW_MS });
    return { allowed: true, count: 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= PHOTO_READ_MAX_PER_WINDOW, count: entry.count };
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
  const rateLimitKey = `${request.cf?.colo ?? "unknown"}:${key}`;
  const readLimit = trackPhotoRead(rateLimitKey);
  if (!readLimit.allowed) {
    return photoError(request, env, 429, "too many photo reads");
  }

  // Check R2 existence first. A missing object is the common case for random
  // keys, and this avoids pointless database/container load.
  const headOnly = request.method === "HEAD";
  const object = headOnly ? await env.PHOTOS.head(key) : await env.PHOTOS.get(key);
  if (!object) {
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

function isPhotoKeyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (key) => typeof key === "string" && isAllowedPhotoKey(key),
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

export default {
  async fetch(request: Request, env: RuntimeEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(PHOTO_PREFIX)) {
      return handlePhotos(request, env, url);
    }
    if (url.pathname.startsWith(INTERNAL_PREFIX)) {
      return jsonResponse({ error: "not found" }, 404);
    }

    try {
      const isEmailRequest = request.method === "POST" && EMAIL_PATHS.has(url.pathname);
      const response = await getContainer(env.API_CONTAINER).fetch(
        containerProxyRequest(request, isEmailRequest ? env.INTERNAL_TASK_SECRET : undefined),
      );
      const result = isEmailRequest
        ? await deliverVerificationEmail(response, env)
        : response;
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        ctx.waitUntil(drainObjectDeletions(env).catch((error: unknown) => {
          console.warn(JSON.stringify({
            message: "post-request media cleanup failed",
            error: error instanceof Error ? error.message : String(error),
          }));
        }));
      }
      return result;
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
    const [backlog, deletions] = await Promise.allSettled([
      drainBackendBacklog(env),
      drainObjectDeletions(env),
    ]);
    const errors: string[] = [];
    if (backlog.status === "rejected") {
      errors.push(`backlog: ${backlog.reason instanceof Error ? backlog.reason.message : String(backlog.reason)}`);
    }
    if (deletions.status === "rejected") {
      errors.push(`deletions: ${deletions.reason instanceof Error ? deletions.reason.message : String(deletions.reason)}`);
    }
    if (errors.length > 0) {
      console.error(JSON.stringify({
        message: "scheduled drain failed",
        cron: event.cron,
        scheduledTime: event.scheduledTime,
        errors,
      }));
      throw new Error(errors.join("; "));
    }

    console.log(JSON.stringify({
      message: "scheduled drain completed",
      cron: event.cron,
      scheduledTime: event.scheduledTime,
      tiles: backlog.status === "fulfilled" ? backlog.value.tiles : 0,
      courts: backlog.status === "fulfilled" ? backlog.value.courts : 0,
      objectDeletions: deletions.status === "fulfilled" ? deletions.value : 0,
    }));
  },
} satisfies ExportedHandler<RuntimeEnv>;
