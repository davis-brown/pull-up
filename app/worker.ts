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

interface Env extends OgConfig {
  ASSETS: Fetcher;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/apple-app-site-association") {
      return jsonResponse(aasaBody(env));
    }
    if (url.pathname === "/.well-known/assetlinks.json") {
      return jsonResponse(assetlinksBody(env));
    }

    const courtMatch = url.pathname.match(/^\/court\/([^/]+)$/);
    if (request.method === "GET" && courtMatch) {
      return injectCourtPreview(request, env, courtMatch[1], url);
    }

    // Everything else: the static SPA assets.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function injectCourtPreview(
  request: Request,
  env: Env,
  courtId: string,
  url: URL,
): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(request);
  try {
    const courtRes = await fetch(`${env.API_URL}/api/v1/courts/${courtId}`);
    if (!courtRes.ok) return assetResponse;
    const court = (await courtRes.json()) as { name: string; active_count: number };

    // Photos are a separate endpoint; best-effort, never blocks the preview.
    let photos = { photos: [] as Array<{ storage_key: string }>, external: [] as Array<{ image_url: string }> };
    try {
      const photoRes = await fetch(`${env.API_URL}/api/v1/courts/${courtId}/photos`);
      if (photoRes.ok) {
        const body = (await photoRes.json()) as typeof photos;
        photos = { photos: body.photos ?? [], external: body.external ?? [] };
      }
    } catch {
      // keep the empty default
    }

    const link = `${url.origin}/court/${courtId}`;
    const head =
      ogMetaTags({
        name: court.name,
        description: liveStatusLine(court.active_count),
        imageUrl: courtImageUrl(env, photos, `${url.origin}/favicon.png`),
        link,
      }) + appBannerTag(env);

    return new HTMLRewriter()
      .on("head", {
        element(el) {
          el.append(head, { html: true });
        },
      })
      .transform(assetResponse);
  } catch {
    // Any failure: serve the untouched SPA so the link still works.
    return assetResponse;
  }
}
