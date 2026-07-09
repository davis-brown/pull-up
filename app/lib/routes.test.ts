import { signInHref } from "./routes";

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
