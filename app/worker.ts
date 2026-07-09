/// <reference types="@cloudflare/workers-types" />
import { aasaBody, assetlinksBody, type OgConfig } from "./lib/og";

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

    // Everything else: the static SPA assets.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
