import { storage } from "./storage";
import type { User } from "./types";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";

const ACCESS_KEY = "pullup.access_token";
const REFRESH_KEY = "pullup.refresh_token";

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export async function setTokens(t: TokenResponse): Promise<void> {
  await storage.set(ACCESS_KEY, t.access_token);
  await storage.set(REFRESH_KEY, t.refresh_token);
}

export async function clearTokens(): Promise<void> {
  await storage.remove(ACCESS_KEY);
  await storage.remove(REFRESH_KEY);
}

export async function hasSession(): Promise<boolean> {
  return (await storage.get(REFRESH_KEY)) != null;
}

async function rawRequest(
  path: string,
  options: RequestInit,
  accessToken?: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${API_URL}/api/v1${path}`, { ...options, headers });
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // Collapse concurrent 401s into one refresh call.
  refreshPromise ??= (async () => {
    try {
      const refreshToken = await storage.get(REFRESH_KEY);
      if (!refreshToken) return false;
      const res = await rawRequest("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        await clearTokens();
        return false;
      }
      await setTokens((await res.json()) as TokenResponse);
      return true;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// api() attaches the access token and transparently retries once through a
// token refresh on 401.
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, options, await storage.get(ACCESS_KEY));
  if (res.status === 401 && (await refreshSession())) {
    res = await rawRequest(path, options, await storage.get(ACCESS_KEY));
  }
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- auth endpoints ---

export async function login(email: string, password: string): Promise<User> {
  const res = await rawRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, await res.json());
  const tokens = (await res.json()) as TokenResponse;
  await setTokens(tokens);
  return tokens.user;
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const res = await rawRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!res.ok) throw new ApiError(res.status, await res.json());
  const tokens = (await res.json()) as TokenResponse;
  await setTokens(tokens);
  return tokens.user;
}

export async function logout(): Promise<void> {
  const refreshToken = await storage.get(REFRESH_KEY);
  if (refreshToken) {
    try {
      await rawRequest("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      // best effort — clear locally regardless
    }
  }
  await clearTokens();
}
