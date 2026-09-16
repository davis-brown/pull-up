import { describe, expect, it } from "vitest";

import { PREFLIGHT_MAX_AGE, corsPreflightResponse, isCorsPreflight } from "./cors-preflight";

const ORIGIN = "https://pull-up.davisbrown.dev";

function preflight(headers: Record<string, string>): Request {
  return new Request("https://api.test/api/v1/courts/search", { method: "OPTIONS", headers });
}

describe("isCorsPreflight", () => {
  it("recognizes an OPTIONS carrying Origin and Access-Control-Request-Method", () => {
    expect(
      isCorsPreflight(preflight({ Origin: ORIGIN, "Access-Control-Request-Method": "POST" })),
    ).toBe(true);
  });

  it("ignores a bare OPTIONS so the container keeps owning the Allow list", () => {
    expect(isCorsPreflight(preflight({}))).toBe(false);
    expect(isCorsPreflight(preflight({ Origin: ORIGIN }))).toBe(false);
  });

  it("ignores non-OPTIONS methods", () => {
    const request = new Request("https://api.test/api/v1/courts/search", {
      method: "POST",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(isCorsPreflight(request)).toBe(false);
  });
});

describe("corsPreflightResponse", () => {
  it("approves an allowed origin, method and header set", () => {
    const response = corsPreflightResponse(
      preflight({
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      }),
      ORIGIN,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Max-Age")).toBe(String(PREFLIGHT_MAX_AGE));
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("accepts the app's custom platform header in any case", () => {
    const response = corsPreflightResponse(
      preflight({
        Origin: ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Pull-Up-Platform",
      }),
      ORIGIN,
    );
    expect(response.status).toBe(204);
  });

  it("varies on the request headers so caches never cross-serve a decision", () => {
    const response = corsPreflightResponse(
      preflight({ Origin: ORIGIN, "Access-Control-Request-Method": "GET" }),
      ORIGIN,
    );
    const vary = response.headers.get("Vary") ?? "";
    expect(vary).toContain("Origin");
    expect(vary).toContain("Access-Control-Request-Method");
    expect(vary).toContain("Access-Control-Request-Headers");
  });

  it("rejects a disallowed origin without emitting CORS headers", () => {
    const response = corsPreflightResponse(
      preflight({ Origin: "https://evil.test", "Access-Control-Request-Method": "POST" }),
      null,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects a method outside the allowlist", () => {
    const response = corsPreflightResponse(
      preflight({ Origin: ORIGIN, "Access-Control-Request-Method": "TRACE" }),
      ORIGIN,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects a header outside the allowlist", () => {
    const response = corsPreflightResponse(
      preflight({
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, x-smuggled",
      }),
      ORIGIN,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("omits credentials for a wildcard origin, which browsers forbid pairing", () => {
    const response = corsPreflightResponse(
      preflight({ Origin: ORIGIN, "Access-Control-Request-Method": "GET" }),
      "*",
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
