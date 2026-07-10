import { avatarColor, initials } from "./avatar";

describe("initials", () => {
  it("takes up to two initials from the display name", () => {
    expect(initials("Rucker Park")).toBe("RP");
    expect(initials("Solo")).toBe("S");
    expect(initials("  three word name")).toBe("TW");
    expect(initials("")).toBe("?");
  });
});

describe("avatarColor", () => {
  it("is deterministic for the same id", () => {
    expect(avatarColor("abc")).toBe(avatarColor("abc"));
  });
  it("returns an hsl string", () => {
    expect(avatarColor("abc")).toMatch(/^hsl\(\d+/);
  });
});
