/// <reference types="@cloudflare/workers-types" />
import {
  aasaBody,
  appBannerTag,
  assetlinksBody,
  courtImageUrl,
  liveStatusLine,
  ogMetaTags,
  type OgConfig,
} from "./lib/og";

interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
  IOS_APP_ID?: string;
  ANDROID_CERT_SHA256?: string;
  APPLE_APP_STORE_ID?: string;
}

interface PreviewData {
  court: { name: string; active_count: number };
  photos: {
    photos: Array<{ storage_key: string }>;
    external: Array<{ source: string; source_id: string }>;
  };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const COURT_ID = new RegExp(`^${UUID}$`, "i");
const PHOTO_KEY = new RegExp(`^(?:courts|avatars)/${UUID}/${UUID}\\.jpg$`);
const IOS_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;
const ANDROID_CERT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/i;
const APP_STORE_ID = /^[0-9]{6,12}$/;
const PREVIEW_TIMEOUT_MS = 3_000;
const PREVIEW_CACHE_SECONDS = 30;
const MAX_PREVIEW_JSON_BYTES = 128 * 1024;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://tiles.openfreemap.org",
  "connect-src 'self' blob: data: https://tiles.openfreemap.org https://accounts.google.com https://oauth2.googleapis.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
].join("; ");

function jsonResponse(body: unknown, status = 200, cacheControl = "public, max-age=3600"): Response {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function secureResponse(response: Response, url: URL): Response {
  const secured = new Response(response.body, response);
  secured.headers.set(
    "Content-Security-Policy",
    url.protocol === "https:"
      ? `${CONTENT_SECURITY_POLICY}; upgrade-insecure-requests`
      : CONTENT_SECURITY_POLICY,
  );
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  secured.headers.delete("Server");
  if (url.protocol === "https:") {
    secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return secured;
}

function associationResponse(request: Request, body: unknown): Response {
  return request.method === "HEAD"
    ? new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      })
    : jsonResponse(body);
}

function isApiProxyPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/photos" ||
    pathname.startsWith("/photos/") ||
    pathname.startsWith("/photos-ext/") ||
    pathname === "/healthz"
  );
}

async function proxyApi(request: Request, env: Env, url: URL): Promise<Response> {
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
  headers.set("X-Pull-Up-Platform", "web");
  return env.API.fetch(new Request(request, { headers }));
}

function ogConfig(env: Env, origin: string): OgConfig {
  return {
    API_URL: origin,
    IOS_APP_ID: env.IOS_APP_ID ?? "",
    ANDROID_CERT_SHA256: env.ANDROID_CERT_SHA256 ?? "",
    APPLE_APP_STORE_ID: env.APPLE_APP_STORE_ID ?? "",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    try {
      if (url.pathname === "/.well-known/apple-app-site-association") {
        response = request.method !== "GET" && request.method !== "HEAD"
          ? jsonResponse({ error: "method not allowed" }, 405, "no-store")
          : IOS_APP_ID.test(env.IOS_APP_ID ?? "")
            ? associationResponse(request, aasaBody(ogConfig(env, url.origin)))
            : jsonResponse({ error: "not configured" }, 404, "no-store");
        if (response.status === 405) response.headers.set("Allow", "GET, HEAD");
      } else if (url.pathname === "/.well-known/assetlinks.json") {
        response = request.method !== "GET" && request.method !== "HEAD"
          ? jsonResponse({ error: "method not allowed" }, 405, "no-store")
          : ANDROID_CERT.test(env.ANDROID_CERT_SHA256 ?? "")
            ? associationResponse(request, assetlinksBody(ogConfig(env, url.origin)))
            : jsonResponse({ error: "not configured" }, 404, "no-store");
        if (response.status === 405) response.headers.set("Allow", "GET, HEAD");
      } else if (isApiProxyPath(url.pathname)) {
        response = await proxyApi(request, env, url);
      } else {
        const courtMatch = url.pathname.match(/^\/court\/([^/]+)$/);
        response = request.method === "GET" && courtMatch
          ? await injectCourtPreview(request, env, ctx, courtMatch[1], url)
          : await env.ASSETS.fetch(request);
      }
    } catch (error) {
      console.error(JSON.stringify({
        message: "web worker request failed",
        error: error instanceof Error ? error.message : String(error),
        method: request.method,
        path: url.pathname,
      }));
      response = jsonResponse({ error: "service unavailable" }, 503, "no-store");
    }

    return secureResponse(response, url);
  },
} satisfies ExportedHandler<Env>;

async function injectCourtPreview(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  courtId: string,
  url: URL,
): Promise<Response> {
  const assetResponsePromise = env.ASSETS.fetch(request);
  if (!COURT_ID.test(courtId)) return assetResponsePromise;

  const [assetResponse, preview] = await Promise.all([
    assetResponsePromise,
    getCourtPreview(env, ctx, courtId, url.origin).catch((error: unknown) => {
      console.warn(JSON.stringify({
        message: "court preview unavailable",
        error: error instanceof Error ? error.message : String(error),
        courtId,
      }));
      return null;
    }),
  ]);
  if (!preview || !assetResponse.ok || !assetResponse.headers.get("Content-Type")?.includes("text/html")) {
    return assetResponse;
  }

  const config = ogConfig(env, url.origin);
  const link = `${url.origin}/court/${courtId}`;
  const head = ogMetaTags({
    name: preview.court.name,
    description: liveStatusLine(preview.court.active_count),
    imageUrl: courtImageUrl(config, preview.photos, `${url.origin}/favicon.png`),
    link,
  }) + (APP_STORE_ID.test(config.APPLE_APP_STORE_ID) ? appBannerTag(config) : "");

  const transformed = new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(head, { html: true });
      },
    })
    .transform(assetResponse);
  transformed.headers.set("Cache-Control", `public, max-age=${PREVIEW_CACHE_SECONDS}`);
  return transformed;
}

async function getCourtPreview(
  env: Env,
  ctx: ExecutionContext,
  courtId: string,
  origin: string,
): Promise<PreviewData> {
  const cache = caches.default;
  const cacheKey = new Request(`${origin}/.well-known/pull-up-preview-cache/${courtId}`);
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const parsed = parsePreviewData(await readJsonLimited(cached));
      if (parsed) return parsed;
      ctx.waitUntil(cache.delete(cacheKey).catch((error: unknown) => {
        console.warn(JSON.stringify({
          message: "preview cache delete failed",
          error: error instanceof Error ? error.message : String(error),
        }));
        return false;
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      message: "preview cache read failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const courtRequest = new Request(`https://api.internal/api/v1/courts/${courtId}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
  });
  const photosRequest = new Request(`https://api.internal/api/v1/courts/${courtId}/photos`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
  });
  const [courtResult, photosResult] = await Promise.allSettled([
    env.API.fetch(courtRequest),
    env.API.fetch(photosRequest),
  ]);
  if (courtResult.status === "rejected") {
    if (photosResult.status === "fulfilled") await photosResult.value.body?.cancel();
    throw courtResult.reason;
  }
  const courtResponse = courtResult.value;
  const photosResponse = photosResult.status === "fulfilled" ? photosResult.value : null;
  if (!courtResponse.ok) {
    await courtResponse.body?.cancel();
    await photosResponse?.body?.cancel();
    throw new Error(`court API returned HTTP ${courtResponse.status}`);
  }

  const photosValuePromise = photosResponse?.ok
    ? readJsonLimited(photosResponse).catch(() => null)
    : Promise.resolve(null);
  if (photosResponse && !photosResponse.ok) await photosResponse.body?.cancel();
  const [courtValue, photosValue] = await Promise.all([
    readJsonLimited(courtResponse),
    photosValuePromise,
  ]);
  const court = parseCourt(courtValue);
  if (!court) {
    throw new Error("court API returned invalid data");
  }
  const photos = parsePhotos(photosValue) ?? { photos: [], external: [] };

  const preview = { court, photos };
  const cacheResponse = jsonResponse(
    preview,
    200,
    `public, max-age=${PREVIEW_CACHE_SECONDS}`,
  );
  ctx.waitUntil(cache.put(cacheKey, cacheResponse).catch((error: unknown) => {
    console.warn(JSON.stringify({
      message: "preview cache write failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }));
  return preview;
}

async function readJsonLimited(response: Response): Promise<unknown> {
  if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    throw new Error("upstream did not return JSON");
  }
  if (!response.body) throw new Error("upstream returned an empty body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_PREVIEW_JSON_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("upstream JSON exceeded size limit");
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

function parseCourt(value: unknown): PreviewData["court"] | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  const activeCount = value.active_count;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > 200 ||
    typeof activeCount !== "number" ||
    !Number.isSafeInteger(activeCount) ||
    activeCount < 0 ||
    activeCount > 1_000_000
  ) {
    return null;
  }
  return { name: name.trim(), active_count: activeCount };
}

function parsePhotos(value: unknown): PreviewData["photos"] | null {
  if (!isRecord(value) || !Array.isArray(value.photos)) return null;
  const externalPhotos = value.external === undefined ? [] : value.external;
  if (!Array.isArray(externalPhotos)) return null;
  const photos = value.photos
    .filter(isRecord)
    .map((photo) => photo.storage_key)
    .filter((key): key is string => typeof key === "string" && PHOTO_KEY.test(key))
    .slice(0, 20)
    .map((storage_key) => ({ storage_key }));
  const external = externalPhotos
    .filter(isRecord)
    .map((photo) => ({ source: photo.source, source_id: photo.source_id }))
    .filter(isSafeExternalRef)
    .slice(0, 20);
  return { photos, external };
}

function parsePreviewData(value: unknown): PreviewData | null {
  if (!isRecord(value)) return null;
  const court = parseCourt(value.court);
  const photos = parsePhotos(value.photos);
  return court && photos ? { court, photos } : null;
}

const EXTERNAL_SOURCE_ID = /^[0-9]{1,20}$/;

// External photos are referenced by (source, source_id) so the OG image can use
// the Worker's cached read-through route instead of the raw upstream URL (which
// for Mapillary is a signed URL that expires).
function isSafeExternalRef(
  ref: { source: unknown; source_id: unknown },
): ref is { source: "commons" | "mapillary"; source_id: string } {
  return (
    (ref.source === "commons" || ref.source === "mapillary") &&
    typeof ref.source_id === "string" &&
    EXTERNAL_SOURCE_ID.test(ref.source_id)
  );
}
