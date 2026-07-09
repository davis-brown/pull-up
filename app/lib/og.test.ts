import { aasaBody, assetlinksBody, type OgConfig } from "./og";

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
