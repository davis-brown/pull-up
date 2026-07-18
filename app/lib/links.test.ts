import {
  buildCourtLink,
  buildProfileLink,
  courtShareMessage,
  parseRunParam,
  runShareMessage,
} from "./links";

describe("buildCourtLink", () => {
  const orig = process.env.EXPO_PUBLIC_WEB_URL;
  afterEach(() => {
    if (orig === undefined) delete process.env.EXPO_PUBLIC_WEB_URL;
    else process.env.EXPO_PUBLIC_WEB_URL = orig;
  });

  it("builds a court link from EXPO_PUBLIC_WEB_URL", () => {
    process.env.EXPO_PUBLIC_WEB_URL = "https://pullup.app";
    expect(buildCourtLink("abc")).toBe("https://pullup.app/court/abc");
  });

  it("appends the run param for a session", () => {
    process.env.EXPO_PUBLIC_WEB_URL = "https://pullup.app";
    expect(buildCourtLink("abc", "run-1")).toBe(
      "https://pullup.app/court/abc?run=run-1",
    );
  });

  it("encodes ids as path and query values", () => {
    process.env.EXPO_PUBLIC_WEB_URL = "https://pullup.app";
    expect(buildCourtLink("court/one", "run?one")).toBe(
      "https://pullup.app/court/court%2Fone?run=run%3Fone",
    );
  });

  it("strips a trailing slash on the base", () => {
    process.env.EXPO_PUBLIC_WEB_URL = "https://pullup.app/";
    expect(buildCourtLink("abc")).toBe("https://pullup.app/court/abc");
  });

  it("falls back to the default web url when unset", () => {
    delete process.env.EXPO_PUBLIC_WEB_URL;
    expect(buildCourtLink("abc")).toBe("https://pull-up.davisbrown.dev/court/abc");
  });

  it("uses only the configured origin and rejects non-http configuration", () => {
    process.env.EXPO_PUBLIC_WEB_URL = "https://pullup.app/unexpected/path";
    expect(buildCourtLink("abc")).toBe("https://pullup.app/court/abc");
    process.env.EXPO_PUBLIC_WEB_URL = "javascript:alert(1)";
    expect(buildCourtLink("abc")).toBe("https://pull-up.davisbrown.dev/court/abc");
  });
});

describe("buildProfileLink", () => {
  const orig = process.env.EXPO_PUBLIC_WEB_URL;
  afterEach(() => {
    if (orig === undefined) delete process.env.EXPO_PUBLIC_WEB_URL;
    else process.env.EXPO_PUBLIC_WEB_URL = orig;
  });

  it("builds a profile link from EXPO_PUBLIC_WEB_URL", () => {
    process.env.EXPO_PUBLIC_WEB_URL = "https://pullup.app";
    expect(buildProfileLink("u1")).toBe("https://pullup.app/user/u1");
  });
});

describe("parseRunParam", () => {
  it("returns a non-empty string unchanged", () => {
    expect(parseRunParam("run-1")).toBe("run-1");
  });
  it("returns null for empty, undefined, or array values", () => {
    expect(parseRunParam("")).toBeNull();
    expect(parseRunParam(undefined)).toBeNull();
    expect(parseRunParam(["a", "b"])).toBeNull();
    expect(parseRunParam("../admin")).toBeNull();
  });
});

describe("share copy", () => {
  it("formats a court message", () => {
    expect(courtShareMessage("Rucker Park", "https://pullup.app/court/x")).toBe(
      "Check out Rucker Park on pull-up — https://pullup.app/court/x",
    );
  });
  it("formats a run message", () => {
    expect(
      runShareMessage("Rucker Park", "Today 6:00 PM", "https://pullup.app/court/x?run=r"),
    ).toBe("Pull up to Rucker Park, Today 6:00 PM — https://pullup.app/court/x?run=r");
  });
});
