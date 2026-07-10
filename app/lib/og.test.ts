import {
  aasaBody,
  appBannerTag,
  assetlinksBody,
  courtImageUrl,
  liveStatusLine,
  ogMetaTags,
  type OgConfig,
} from "./og";

const cfg: OgConfig = {
  IOS_APP_ID: "ABCDE12345.com.pullup.app",
  ANDROID_CERT_SHA256: "AA:BB:CC",
  APPLE_APP_STORE_ID: "1234567890",
  API_URL: "https://api.example.com",
};

describe("aasaBody", () => {
  it("scopes the app to /court/* paths", () => {
    const body = aasaBody(cfg) as {
      applinks: { details: Array<{ appIDs: string[]; components: Array<Record<string, string>> }> };
    };
    expect(body.applinks.details[0].appIDs).toEqual(["ABCDE12345.com.pullup.app"]);
    expect(body.applinks.details[0].components[0]["/"]).toBe("/court/*");
  });
});

describe("assetlinksBody", () => {
  it("delegates URL handling to the android package with the cert fingerprint", () => {
    const body = assetlinksBody(cfg) as Array<{
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }>;
    expect(body[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(body[0].target.package_name).toBe("com.pullup.app");
    expect(body[0].target.sha256_cert_fingerprints).toEqual(["AA:BB:CC"]);
  });
});

describe("liveStatusLine", () => {
  it("counts active players when present", () => {
    expect(liveStatusLine(3)).toBe("3 playing right now");
    expect(liveStatusLine(1)).toBe("1 playing right now");
  });
  it("uses a neutral tagline when empty", () => {
    expect(liveStatusLine(0)).toBe("See who's playing pickup here");
  });
});

describe("ogMetaTags", () => {
  const tags = ogMetaTags({
    name: "Rucker Park",
    description: "3 playing right now",
    imageUrl: "https://api.example.com/photos/k",
    link: "https://pullup.app/court/x",
  });
  it("includes escaped title, description, image, url and twitter card", () => {
    expect(tags).toContain('property="og:title" content="Rucker Park"');
    expect(tags).toContain('property="og:description" content="3 playing right now"');
    expect(tags).toContain('property="og:image" content="https://api.example.com/photos/k"');
    expect(tags).toContain('property="og:url" content="https://pullup.app/court/x"');
    expect(tags).toContain('name="twitter:card" content="summary_large_image"');
  });
  it("escapes double quotes in the name", () => {
    const t = ogMetaTags({ name: 'A "B" Court', description: "d", imageUrl: "i", link: "l" });
    expect(t).toContain('content="A &quot;B&quot; Court"');
  });
  it("escapes single quotes in the name", () => {
    const t = ogMetaTags({ name: "O'Neal Court", description: "d", imageUrl: "i", link: "l" });
    expect(t).toContain("O&#39;Neal Court");
  });
});

describe("appBannerTag", () => {
  it("emits the apple-itunes-app meta with the store id", () => {
    expect(appBannerTag(cfg)).toBe(
      '<meta name="apple-itunes-app" content="app-id=1234567890">',
    );
  });
});

describe("courtImageUrl", () => {
  const fallback = "https://web.example/favicon.png";
  it("uses the first uploaded photo via the API origin", () => {
    expect(courtImageUrl(cfg, { photos: [{ storage_key: "k1" }], external: [] }, fallback)).toBe(
      "https://api.example.com/photos/k1",
    );
  });
  it("falls back to an external photo, then the provided fallback url", () => {
    expect(
      courtImageUrl(cfg, { photos: [], external: [{ image_url: "https://ex/e.jpg" }] }, fallback),
    ).toBe("https://ex/e.jpg");
    expect(courtImageUrl(cfg, { photos: [], external: [] }, fallback)).toBe(fallback);
  });
});
