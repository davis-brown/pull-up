import { resolveNextPath, signInHref } from "./routes";

describe("signInHref", () => {
  it("returns plain /login when there is nowhere to return to", () => {
    expect(signInHref(null)).toBe("/login");
    expect(signInHref(undefined)).toBe("/login");
    expect(signInHref("/")).toBe("/login");
  });

  it("never loops back into the auth screens", () => {
    expect(signInHref("/login")).toBe("/login");
    expect(signInHref("/register")).toBe("/login");
  });

  it("encodes the return route", () => {
    expect(signInHref("/court/abc-123")).toBe("/login?next=%2Fcourt%2Fabc-123");
  });
});

describe("resolveNextPath", () => {
  it("passes plain internal paths through", () => {
    expect(resolveNextPath("/court/abc-123")).toBe("/court/abc-123");
  });

  it("rejects non-strings and arrays", () => {
    expect(resolveNextPath(undefined)).toBe("/");
    expect(resolveNextPath(["/a", "/b"])).toBe("/");
  });

  it("rejects external and protocol-relative values (open redirect)", () => {
    expect(resolveNextPath("//evil.com")).toBe("/");
    expect(resolveNextPath("https://evil.com")).toBe("/");
  });
});
