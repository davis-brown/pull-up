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
