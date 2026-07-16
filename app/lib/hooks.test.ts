jest.mock("./storage", () => ({
  platformOS: "ios",
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
  backgroundStorage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

import { photoURL } from "./api";

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
