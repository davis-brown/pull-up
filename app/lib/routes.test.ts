import {
  parseRouteId,
  resolveNextPath,
  safePathSegment,
  signInHref,
} from "./routes";

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

  it("rejects unsafe return routes before putting them in the login URL", () => {
    expect(signInHref("https://evil.com")).toBe("/login");
    expect(signInHref("/\\evil.com")).toBe("/login");
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

  it("rejects backslashes, controls, malformed escapes, and encoded protocol-relative values", () => {
    expect(resolveNextPath("/\\evil.com")).toBe("/");
    expect(resolveNextPath("/%2f%2fevil.com")).toBe("/");
    expect(resolveNextPath("/%zz")).toBe("/");
    expect(resolveNextPath("/court/x\nnext")).toBe("/");
  });
});

describe("route ids", () => {
  it("accepts UUID and slug-shaped single segments", () => {
    expect(parseRouteId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(parseRouteId("user_1")).toBe("user_1");
  });

  it("rejects arrays, traversal, delimiters, and oversized ids", () => {
    expect(parseRouteId(["a", "b"])).toBeUndefined();
    expect(parseRouteId("../admin")).toBeUndefined();
    expect(parseRouteId("a/b")).toBeUndefined();
    expect(parseRouteId("a?x=1")).toBeUndefined();
    expect(parseRouteId("a".repeat(129))).toBeUndefined();
  });

  it("refuses to construct a path segment from an invalid id", () => {
    expect(safePathSegment("valid-id")).toBe("valid-id");
    expect(() => safePathSegment("../admin")).toThrow("Invalid path segment");
  });
});
