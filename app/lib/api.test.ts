let platformOS = "ios";
const mockGet = jest.fn<Promise<string | null>, [string]>();
const mockSet = jest.fn<Promise<void>, [string, string]>();
const mockRemove = jest.fn<Promise<void>, [string]>();

jest.mock("./storage", () => ({
  get platformOS() {
    return platformOS;
  },
  storage: {
    get: mockGet,
    set: mockSet,
    remove: mockRemove,
  },
  backgroundStorage: {
    get: mockGet,
    set: mockSet,
    remove: mockRemove,
  },
}));

type ApiModule = typeof import("./api");
let client: ApiModule;
let stored: Record<string, string>;

function useStatefulStorage(initial: Record<string, string> = {}) {
  stored = { ...initial };
  mockGet.mockImplementation(async (key) => stored[key] ?? null);
  mockSet.mockImplementation(async (key, value) => {
    stored[key] = value;
  });
  mockRemove.mockImplementation(async (key) => {
    delete stored[key];
  });
}

function fakeResponse(
  status: number,
  body?: unknown,
  rawText?: string,
  headers?: HeadersInit,
): Response {
  const text = rawText ?? (body === undefined ? "" : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    blob: async () => new Blob([text]),
    body: null,
    headers: new Headers(headers),
  } as unknown as Response;
}

function tokenResponse(access = "access", refresh = "refresh", id = "u1") {
  return {
    access_token: access,
    refresh_token: refresh,
    user: { id, email: `${id}@test.local` },
  };
}

beforeEach(async () => {
  jest.useRealTimers();
  jest.resetModules();
  jest.clearAllMocks();
  platformOS = "ios";
  useStatefulStorage();
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  client = await import("./api");
});

describe("native session storage and refresh", () => {
  it("migrates legacy keys to one atomic token pair and refreshes once", async () => {
    useStatefulStorage({
      "pullup.access_token": "expired-token",
      "pullup.refresh_token": "valid-refresh-token",
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(fakeResponse(401, { error: "expired" }))
      .mockResolvedValueOnce(fakeResponse(200, tokenResponse("new-access", "new-refresh")))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    await expect(client.api("/me")).resolves.toEqual({ ok: true });

    const pairWrites = mockSet.mock.calls.filter(([key]) => key === "pullup.token_pair");
    expect(pairWrites.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(pairWrites.at(-1)![1])).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    expect(mockSet).not.toHaveBeenCalledWith("pullup.access_token", expect.anything());
    expect(mockSet).not.toHaveBeenCalledWith("pullup.refresh_token", expect.anything());
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer new-access");
  });

  it("collapses concurrent 401 responses into one refresh", async () => {
    useStatefulStorage({
      "pullup.token_pair": JSON.stringify({
        accessToken: "expired",
        refreshToken: "valid-refresh",
      }),
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation((url: string, options: RequestInit) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(fakeResponse(200, tokenResponse("fresh", "rotated")));
      }
      const authorization = (options.headers as Record<string, string>).Authorization;
      return Promise.resolve(
        authorization === "Bearer fresh"
          ? fakeResponse(200, { ok: true })
          : fakeResponse(401, { error: "expired" }),
      );
    });

    await Promise.all([client.api("/me"), client.api("/me/favorites")]);

    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/auth/refresh"))).toHaveLength(1);
  });

  it.each([429, 500, 503])(
    "preserves the token pair when refresh returns %s",
    async (status) => {
      useStatefulStorage({
        "pullup.token_pair": JSON.stringify({
          accessToken: "expired",
          refreshToken: "keep-me",
        }),
      });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(fakeResponse(401, { error: "expired" }))
        .mockResolvedValueOnce(fakeResponse(status, { error: "try later" }));

      await expect(client.api("/me")).rejects.toMatchObject({ status });
      expect(stored["pullup.token_pair"]).toContain("keep-me");
      expect(mockRemove).not.toHaveBeenCalledWith("pullup.token_pair");
    },
  );

  it("preserves the token pair on a refresh transport failure", async () => {
    useStatefulStorage({
      "pullup.token_pair": JSON.stringify({
        accessToken: "expired",
        refreshToken: "keep-me",
      }),
    });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse(401, { error: "expired" }))
      .mockRejectedValueOnce(new TypeError("network down"));

    await expect(client.api("/me")).rejects.toThrow("network down");
    expect(stored["pullup.token_pair"]).toContain("keep-me");
  });

  it("expires only a definitively rejected refresh session", async () => {
    useStatefulStorage({
      "pullup.token_pair": JSON.stringify({
        accessToken: "expired",
        refreshToken: "revoked",
      }),
    });
    const expired = jest.fn();
    client.onSessionExpired(expired);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse(401, { error: "expired" }))
      .mockResolvedValueOnce(fakeResponse(401, { error: "invalid refresh token" }));

    await expect(client.api("/me")).rejects.toBeInstanceOf(client.SessionChangedError);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(stored["pullup.token_pair"]).toBeUndefined();
  });

  it("does not let a refresh response restore tokens after logout", async () => {
    useStatefulStorage({
      "pullup.token_pair": JSON.stringify({
        accessToken: "expired",
        refreshToken: "valid-refresh",
      }),
    });
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) return refreshResponse;
      if (url.includes("/auth/logout")) return Promise.resolve(fakeResponse(204));
      return Promise.resolve(fakeResponse(401, { error: "expired" }));
    });

    const request = client.api("/me");
    while (!fetchMock.mock.calls.some(([url]) => url.includes("/auth/refresh"))) {
      await Promise.resolve();
    }
    const logout = client.logout();
    resolveRefresh(fakeResponse(200, tokenResponse("stale-access", "stale-refresh")));

    await expect(request).rejects.toBeInstanceOf(client.SessionChangedError);
    await logout;
    expect(stored["pullup.token_pair"]).toBeUndefined();
    expect(mockSet.mock.calls.some(([, value]) => value.includes("stale-access"))).toBe(false);
  });
});

describe("auth transitions and logout", () => {
  it("stores a successful login as one native pair", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(200, tokenResponse("a", "r")),
    );

    await expect(client.login("a@b.com", "password123")).resolves.toMatchObject({ id: "u1" });

    expect(JSON.parse(stored["pullup.token_pair"])).toEqual({
      accessToken: "a",
      refreshToken: "r",
    });
  });

  it("lets only the latest concurrent login own the session", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(fakeResponse(200, tokenResponse("second-a", "second-r", "u2")));

    const firstLogin = client.login("first@test.local", "password123");
    while (fetchMock.mock.calls.length === 0) await Promise.resolve();
    const secondLogin = client.login("second@test.local", "password123");
    resolveFirst(fakeResponse(200, tokenResponse("first-a", "first-r", "u1")));

    await expect(firstLogin).rejects.toBeInstanceOf(client.SessionChangedError);
    await expect(secondLogin).resolves.toMatchObject({ id: "u2" });
    expect(JSON.parse(stored["pullup.token_pair"])).toEqual({
      accessToken: "second-a",
      refreshToken: "second-r",
    });
  });

  it("keeps registration signed out until email verification succeeds", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse(
        202,
        { verification_required: true },
      ))
      .mockResolvedValueOnce(fakeResponse(200, tokenResponse("verified-a", "verified-r")));

    await expect(client.register("new@test.local", "password123", "New Player")).resolves.toEqual({
      verificationRequired: true,
    });
    expect(stored["pullup.token_pair"]).toBeUndefined();

    await expect(client.verifyEmail("one-time-token")).resolves.toMatchObject({ id: "u1" });
    expect(JSON.parse(stored["pullup.token_pair"])).toEqual({
      accessToken: "verified-a",
      refreshToken: "verified-r",
    });
  });

  it("clears local credentials even when logout requests fail", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse(200, tokenResponse()))
      .mockRejectedValue(new TypeError("network down"));
    await client.login("a@b.com", "password123");

    await expect(client.logout({ pushToken: "ExpoToken[test]" })).resolves.toBeUndefined();

    expect(stored["pullup.token_pair"]).toBeUndefined();
    const methods = (global.fetch as jest.Mock).mock.calls.slice(1).map(([, options]) => options.method);
    expect(methods).toEqual(expect.arrayContaining(["DELETE", "POST"]));
  });
});

describe("web cookie contract", () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    platformOS = "web";
    useStatefulStorage({
      "pullup.access_token": "legacy-access",
      "pullup.refresh_token": "legacy-refresh",
    });
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
    client = await import("./api");
  });

  it("removes legacy web tokens and migrates refresh into the cookie flow once", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(fakeResponse(401, { error: "missing access token" }))
      .mockResolvedValueOnce(fakeResponse(200, {
        access_token: "memory-access",
        user: { id: "u1" },
      }))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    await expect(client.api("/me")).resolves.toEqual({ ok: true });

    expect(stored["pullup.access_token"]).toBeUndefined();
    expect(stored["pullup.refresh_token"]).toBeUndefined();
    expect(mockSet).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      refresh_token: "legacy-refresh",
    });
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers["X-Pull-Up-Platform"]).toBe("web");
    }
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer memory-access");
  });

  it("keeps a login access token in memory and ignores response refresh tokens", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, tokenResponse("memory-only", "do-not-store")))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    await client.login("web@test.local", "password123");
    await client.api("/me");

    expect(mockSet).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer memory-only");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auth/login");
  });
});

describe("request parsing and timeout", () => {
  it("does not parse a body for a 204 response", async () => {
    const response = fakeResponse(204);
    response.text = jest.fn(async () => {
      throw new Error("must not read");
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(response);

    await expect(client.api("/check-ins/current", { method: "DELETE" })).resolves.toBeUndefined();
    expect(response.text).not.toHaveBeenCalled();
  });

  it("uses a generic ApiError for non-JSON errors", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(500, undefined, "upstream exploded"),
    );

    await expect(client.api("/whatever")).rejects.toMatchObject({
      status: 500,
      message: "HTTP 500",
    });
  });

  it("rejects malformed successful JSON instead of hanging or returning undefined", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(200, undefined, "not json"),
    );

    await expect(client.api("/whatever")).rejects.toMatchObject({
      status: 502,
      message: "Invalid response from server",
    });
  });

  it("settles a request when fetch does not respond", async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));

    const request = client.fetchWithTimeout("https://api.test", {}, 50);
    const result = expect(request).rejects.toBeInstanceOf(client.RequestTimeoutError);
    await jest.advanceTimersByTimeAsync(51);

    await result;
  });
});
