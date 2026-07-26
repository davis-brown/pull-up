jest.mock("./storage", () => ({
  platformOS: "ios",
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
  backgroundStorage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

import { externalPhotoURLFromAPIBase, photoURL } from "./api";

describe("photoURL", () => {
  it("builds a court photo URL", () => {
    const key = "courts/12345678-1234-4123-8234-123456789abc/abcdef12-3456-4123-8234-123456789abc.jpg";
    expect(photoURL("https://api.pullup.app", key)).toBe(`https://api.pullup.app/photos/${key}`);
  });

  it("builds an avatar URL", () => {
    const key = "avatars/12345678-1234-4123-8234-123456789abc/abcdef12-3456-4123-8234-123456789abc.jpg";
    expect(photoURL("https://api.pullup.app", key)).toBe(`https://api.pullup.app/photos/${key}`);
  });

  it("rejects invalid keys", () => {
    expect(() => photoURL("https://api.pullup.app", "courts/../etc/passwd.jpg")).toThrow("Invalid photo storage key");
    expect(() => photoURL("https://api.pullup.app", "avatars/foo/bar.jpg")).toThrow("Invalid photo storage key");
    expect(() => photoURL("https://api.pullup.app", "courts/123/456.png")).toThrow("Invalid photo storage key");
    expect(() => photoURL("https://api.pullup.app", "https://evil.com/courts/123/456.jpg")).toThrow("Invalid photo storage key");
  });
});

describe("externalPhotoURLFromAPIBase", () => {
  it("builds a cached URL for known sources", () => {
    expect(externalPhotoURLFromAPIBase("https://api.pullup.app", "commons", "12345")).toBe(
      "https://api.pullup.app/photos-ext/commons/12345",
    );
    expect(externalPhotoURLFromAPIBase("https://api.pullup.app/", "mapillary", "42")).toBe(
      "https://api.pullup.app/photos-ext/mapillary/42",
    );
  });

  it("rejects unknown sources and non-numeric ids", () => {
    expect(() => externalPhotoURLFromAPIBase("https://api.pullup.app", "flickr", "1")).toThrow(
      "Invalid external photo source",
    );
    expect(() => externalPhotoURLFromAPIBase("https://api.pullup.app", "commons", "../secret")).toThrow(
      "Invalid external photo source id",
    );
  });
});
