import { ApiError, api, hasSession, login, logout, oauthLogin, register } from "./api";
import { storage } from "./storage";

jest.mock("./storage", () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockStorage = storage as jest.Mocked<typeof storage>;

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
});

describe("api()", () => {
  it("attaches the stored access token as a bearer header", async () => {
    mockStorage.get.mockResolvedValue("stored-access-token");
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    await api("/me");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer stored-access-token");
  });

  it("returns undefined for 204 responses without parsing a body", async () => {
    mockStorage.get.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValueOnce(fakeResponse(204, null));

    await expect(api("/check-ins/current", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("throws ApiError with the server's error message on failure", async () => {
    mockStorage.get.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(400, { error: "name is required" }),
    );

    await expect(api("/courts", { method: "POST" })).rejects.toMatchObject({
      status: 400,
      message: "name is required",
    });
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    mockStorage.get.mockResolvedValue(null);
    const badJsonResponse = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response;
    (global.fetch as jest.Mock).mockResolvedValueOnce(badJsonResponse);

    await expect(api("/whatever")).rejects.toMatchObject({
      status: 500,
      message: "HTTP 500",
    });
  });

  // A stateful fake so that a storage.set() during refresh is actually
  // visible to the next storage.get() call, the way SecureStore behaves.
  function useStatefulStorage(initial: Record<string, string>) {
    const tokens: Record<string, string> = { ...initial };
    mockStorage.get.mockImplementation(async (key: string) => tokens[key] ?? null);
    mockStorage.set.mockImplementation(async (key: string, value: string) => {
      tokens[key] = value;
    });
    mockStorage.remove.mockImplementation(async (key: string) => {
      delete tokens[key];
    });
    return tokens;
  }

  it("refreshes the access token on 401 and retries once", async () => {
    useStatefulStorage({
      "pullup.access_token": "expired-token",
      "pullup.refresh_token": "valid-refresh-token",
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(fakeResponse(401, { error: "invalid or expired token" })) // original request
      .mockResolvedValueOnce(
        fakeResponse(200, {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          user: { id: "u1" },
        }),
      ) // /auth/refresh
      .mockResolvedValueOnce(fakeResponse(200, { ok: true })); // retried original request

    const result = await api("/me");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/auth/refresh");
    expect(mockStorage.set).toHaveBeenCalledWith("pullup.access_token", "new-access-token");
    // The retried request must use the freshly refreshed token.
    const retryOptions = fetchMock.mock.calls[2][1];
    expect(retryOptions.headers.Authorization).toBe("Bearer new-access-token");
  });

  it("clears tokens and surfaces the original 401 when refresh fails", async () => {
    useStatefulStorage({
      "pullup.access_token": "expired-token",
      "pullup.refresh_token": "stale-refresh-token",
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(fakeResponse(401, { error: "invalid or expired token" })) // original request
      .mockResolvedValueOnce(fakeResponse(401, { error: "invalid refresh token" })); // /auth/refresh fails

    await expect(api("/me")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockStorage.remove).toHaveBeenCalled();
  });

  it("collapses concurrent 401s into a single refresh call", async () => {
    useStatefulStorage({
      "pullup.access_token": "expired-token",
      "pullup.refresh_token": "valid-refresh-token",
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation((url: string, options: { headers: Record<string, string> }) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          fakeResponse(200, {
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            user: { id: "u1" },
          }),
        );
      }
      // Only requests carrying the freshly refreshed token succeed — this
      // is what actually proves both callers waited for the same refresh.
      if (options.headers.Authorization === "Bearer new-access-token") {
        return Promise.resolve(fakeResponse(200, { ok: true }));
      }
      return Promise.resolve(fakeResponse(401, { error: "invalid or expired token" }));
    });

    await Promise.all([api("/me"), api("/me/favorites")]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe("hasSession()", () => {
  it("is true only when a refresh token is stored", async () => {
    mockStorage.get.mockResolvedValueOnce(null);
    await expect(hasSession()).resolves.toBe(false);

    mockStorage.get.mockResolvedValueOnce("some-refresh-token");
    await expect(hasSession()).resolves.toBe(true);
  });
});

describe("auth endpoints", () => {
  it("login() stores tokens and returns the user on success", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(200, {
        access_token: "a",
        refresh_token: "r",
        user: { id: "u1", email: "a@b.com" },
      }),
    );

    const user = await login("a@b.com", "password123");

    expect(user).toEqual({ id: "u1", email: "a@b.com" });
    expect(mockStorage.set).toHaveBeenCalledWith("pullup.access_token", "a");
    expect(mockStorage.set).toHaveBeenCalledWith("pullup.refresh_token", "r");
  });

  it("login() throws ApiError and stores nothing on bad credentials", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(401, { error: "invalid email or password" }),
    );

    await expect(login("a@b.com", "wrong")).rejects.toBeInstanceOf(ApiError);
    expect(mockStorage.set).not.toHaveBeenCalled();
  });

  it("register() posts display_name and stores tokens", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(200, { access_token: "a", refresh_token: "r", user: { id: "u2" } }),
    );

    await register("new@test.local", "password123", "New Player");

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      email: "new@test.local",
      password: "password123",
      display_name: "New Player",
    });
  });

  it("oauthLogin() includes display_name only when provided", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeResponse(200, { access_token: "a", refresh_token: "r", user: { id: "u3" } }),
    );

    await oauthLogin("google", "id-token-value");

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({ provider: "google", id_token: "id-token-value" });
  });

  it("logout() clears tokens even when the network call fails", async () => {
    mockStorage.get.mockResolvedValue("some-refresh-token");
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    await expect(logout()).resolves.toBeUndefined();
    expect(mockStorage.remove).toHaveBeenCalledWith("pullup.access_token");
    expect(mockStorage.remove).toHaveBeenCalledWith("pullup.refresh_token");
  });
});
