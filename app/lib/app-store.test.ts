import { storeUrlForUserAgent } from "./app-store";

describe("storeUrlForUserAgent", () => {
  const ios = "https://apps.apple.com/app/id123";
  const android = "https://play.google.com/store/apps/details?id=com.pullup.app";

  it("sends Android browsers to Google Play", () => {
    expect(storeUrlForUserAgent("Mozilla/5.0 (Linux; Android 15)", ios, android)).toBe(android);
  });

  it("sends iPhone and iPad browsers to the App Store", () => {
    expect(storeUrlForUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", ios, android)).toBe(ios);
    expect(storeUrlForUserAgent("Mozilla/5.0 (iPad; CPU OS 18_0)", ios, android)).toBe(ios);
  });

  it("falls back to the configured store that exists", () => {
    expect(storeUrlForUserAgent("desktop", "", android)).toBe(android);
    expect(storeUrlForUserAgent("Android", ios, "")).toBe(ios);
  });

  it("does not open malformed or non-http store URLs", () => {
    expect(storeUrlForUserAgent("iPhone", "javascript:alert(1)", android)).toBe(android);
    expect(storeUrlForUserAgent("Android", ios, "not a url")).toBe(ios);
  });
});
