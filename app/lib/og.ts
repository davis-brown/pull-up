// Pure logic for the web Worker (app/worker.ts). No Workers/DOM globals here
// so it typechecks in the app tsconfig and runs under node jest; worker.ts
// supplies the runtime (HTMLRewriter, ASSETS binding).

export interface OgConfig {
  IOS_APP_ID: string;
  ANDROID_CERT_SHA256: string;
  APPLE_APP_STORE_ID: string;
  API_URL: string;
}

// Apple App Site Association — served at /.well-known/apple-app-site-association
// as application/json (no file extension).
export function aasaBody(cfg: OgConfig): unknown {
  return {
    applinks: {
      details: [{ appIDs: [cfg.IOS_APP_ID], components: [{ "/": "/court/*" }] }],
    },
  };
}

// Android Digital Asset Links — served at /.well-known/assetlinks.json.
export function assetlinksBody(cfg: OgConfig): unknown {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.pullup.app",
        sha256_cert_fingerprints: [cfg.ANDROID_CERT_SHA256],
      },
    },
  ];
}

export function liveStatusLine(activeCount: number): string {
  return activeCount > 0
    ? `${activeCount} playing right now`
    : "See who's playing pickup here";
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

export function ogMetaTags(input: {
  name: string;
  description: string;
  imageUrl: string;
  link: string;
}): string {
  const title = escapeAttr(input.name);
  const desc = escapeAttr(input.description);
  const img = escapeAttr(input.imageUrl);
  const url = escapeAttr(input.link);
  return [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${img}">`,
  ].join("");
}

export function appBannerTag(cfg: OgConfig): string {
  return `<meta name="apple-itunes-app" content="app-id=${cfg.APPLE_APP_STORE_ID}">`;
}

// Resolves the preview image: first uploaded photo (via the API origin),
// else the first external (Commons) photo, else the caller-provided fallback.
export function courtImageUrl(
  cfg: OgConfig,
  photos: { photos: Array<{ storage_key: string }>; external: Array<{ image_url: string }> },
  fallbackUrl: string,
): string {
  if (photos.photos[0]) return `${cfg.API_URL}/photos/${photos.photos[0].storage_key}`;
  if (photos.external[0]) return photos.external[0].image_url;
  return fallbackUrl;
}
