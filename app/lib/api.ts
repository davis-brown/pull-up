import { backgroundStorage as storage, platformOS } from "./storage";
import type { User } from "./types";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ??
  (platformOS === "web" ? "" : "http://localhost:8080");
const API_BASE_URL = API_URL.replace(/\/+$/, "");

const TOKEN_PAIR_KEY = "pullup.token_pair";
const LEGACY_ACCESS_KEY = "pullup.access_token";
const LEGACY_REFRESH_KEY = "pullup.refresh_token";
const PLATFORM_HEADER = "X-Pull-Up-Platform";
const REQUEST_TIMEOUT_MS = 15_000;
const LOGOUT_TIMEOUT_MS = 5_000;

interface TokenPair {
  accessToken: string;
  refreshToken: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  user: User;
}

export interface RegistrationResult {
  verificationRequired: true;
}

export interface LogoutOptions {
  pushToken?: Promise<string | null> | string | null;
  onPushTokenRemoved?: () => void | Promise<void>;
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "RequestTimeoutError";
  }
}

export class SessionChangedError extends Error {
  constructor() {
    super("Session changed while the request was in progress");
    this.name = "SessionChangedError";
  }
}

export function resolveApiURL(path: string): string {
  if (!path.startsWith("/")) throw new Error("API path must start with /");
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

// Re-encode the storage-key part of a photo URL. Server keys look like
// courts/<uuid>/<uuid>.jpg or avatars/<uuid>/<uuid>.jpg.
const PHOTO_KEY_RE = /^(?:courts|avatars)\/[0-9a-f-]+\/[0-9a-f-]+\.jpg$/i;

export function photoURL(baseURL: string, storageKey: string): string {
  if (!PHOTO_KEY_RE.test(storageKey)) throw new Error("Invalid photo storage key");
  const origin = baseURL.replace(/\/+$/, "");
  return `${origin}/photos/${storageKey}`;
}

export function photoURLFromAPIBase(baseURL: string, storageKey: string): string {
  return photoURL(baseURL, storageKey);
}

class RequestAbortedError extends Error {
  constructor() {
    super("Request was cancelled");
    this.name = "AbortError";
  }
}

const isWeb = () => platformOS === "web";

let memoryTokens: TokenPair | null = null;
let sessionEpoch = 0;
let knownEmptyEpoch: number | null = null;
let tokenWriteQueue: Promise<void> = Promise.resolve();
let tokenLoad:
  | { epoch: number; promise: Promise<TokenPair | null> }
  | null = null;
let legacyWebRefreshToken: string | null | undefined;

const requestControllers = new Map<number, Set<AbortController>>();

function queueTokenWrite(write: () => Promise<void>): Promise<void> {
  const queued = tokenWriteQueue.then(write, write);
  tokenWriteQueue = queued.catch(() => {});
  return queued;
}

function abortEpochRequests(): void {
  for (const controllers of requestControllers.values()) {
    for (const controller of controllers) controller.abort();
  }
  requestControllers.clear();
}

function advanceSessionEpoch(): number {
  sessionEpoch += 1;
  abortEpochRequests();
  refreshState = null;
  return sessionEpoch;
}

// Changes request ownership without changing the current credentials. Auth UI
// calls this exactly when an identity becomes visible/hidden so requests that
// began under the prior identity cannot repopulate a freshly cleared cache.
export function cancelSessionRequests(): void {
  const wasKnownEmpty = knownEmptyEpoch === sessionEpoch;
  const epoch = advanceSessionEpoch();
  if (wasKnownEmpty) knownEmptyEpoch = epoch;
}

function clearMemorySession(): number {
  const epoch = advanceSessionEpoch();
  memoryTokens = null;
  knownEmptyEpoch = epoch;
  tokenLoad = null;
  return epoch;
}

function queueStoredTokenClear(): Promise<void> {
  if (isWeb()) return removeLegacyWebTokens(false);
  return queueTokenWrite(async () => {
    await storage.remove(TOKEN_PAIR_KEY);
    await Promise.all([
      storage.remove(LEGACY_ACCESS_KEY),
      storage.remove(LEGACY_REFRESH_KEY),
    ]);
  });
}

function parseStoredPair(raw: string | null): TokenPair | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TokenPair>;
    if (
      typeof value.accessToken === "string" &&
      value.accessToken.length > 0 &&
      typeof value.refreshToken === "string" &&
      value.refreshToken.length > 0
    ) {
      return { accessToken: value.accessToken, refreshToken: value.refreshToken };
    }
  } catch {
    // Corrupt or pre-release data is removed below.
  }
  return null;
}

async function removeLegacyWebTokens(preserveRefresh = true): Promise<void> {
  if (!isWeb()) return;
  if (preserveRefresh && legacyWebRefreshToken === undefined) {
    // Consume a legacy refresh token once so the backend can exchange it for
    // an HttpOnly cookie during the first refresh after an upgrade.
    legacyWebRefreshToken = await storage.get(LEGACY_REFRESH_KEY);
  } else if (!preserveRefresh) {
    legacyWebRefreshToken = null;
  }
  await Promise.all([
    storage.remove(LEGACY_ACCESS_KEY),
    storage.remove(LEGACY_REFRESH_KEY),
    storage.remove(TOKEN_PAIR_KEY),
  ]);
}

async function loadNativeTokens(epoch: number): Promise<TokenPair | null> {
  const stored = parseStoredPair(await storage.get(TOKEN_PAIR_KEY));
  if (stored) return stored;

  // Migrate the old two-key native format into one atomic SecureStore value.
  const [accessToken, refreshToken] = await Promise.all([
    storage.get(LEGACY_ACCESS_KEY),
    storage.get(LEGACY_REFRESH_KEY),
  ]);
  const migrated = accessToken && refreshToken
    ? { accessToken, refreshToken }
    : null;
  await queueTokenWrite(async () => {
    if (sessionEpoch !== epoch) return;
    if (migrated) {
      await storage.set(TOKEN_PAIR_KEY, JSON.stringify(migrated));
    } else {
      await storage.remove(TOKEN_PAIR_KEY);
    }
    await Promise.all([
      storage.remove(LEGACY_ACCESS_KEY),
      storage.remove(LEGACY_REFRESH_KEY),
    ]);
  });
  return migrated;
}

async function getTokens(epoch = sessionEpoch): Promise<TokenPair | null> {
  if (epoch !== sessionEpoch) throw new SessionChangedError();
  if (isWeb()) {
    await removeLegacyWebTokens();
    return memoryTokens;
  }
  if (memoryTokens) return memoryTokens;
  if (knownEmptyEpoch === epoch) return null;
  if (!tokenLoad || tokenLoad.epoch !== epoch) {
    const promise = loadNativeTokens(epoch).then((tokens) => {
      if (sessionEpoch !== epoch) return null;
      memoryTokens = tokens;
      return tokens;
    });
    tokenLoad = { epoch, promise };
  }
  return tokenLoad.promise;
}

function validateTokenResponse(value: unknown): TokenResponse {
  const token = value as Partial<TokenResponse> | null;
  if (
    !token ||
    typeof token.access_token !== "string" ||
    token.access_token.length === 0 ||
    (!isWeb() &&
      (typeof token.refresh_token !== "string" || token.refresh_token.length === 0)) ||
    !token.user ||
    typeof token.user.id !== "string"
  ) {
    throw new ApiError(502, { error: "Invalid authentication response" });
  }
  return token as TokenResponse;
}

async function storeTokenResponse(token: TokenResponse, epoch: number): Promise<void> {
  if (sessionEpoch !== epoch) throw new SessionChangedError();
  const pair: TokenPair = {
    accessToken: token.access_token,
    refreshToken: isWeb() ? null : token.refresh_token!,
  };
  memoryTokens = pair;
  knownEmptyEpoch = null;
  if (isWeb()) return;
  await queueTokenWrite(async () => {
    if (sessionEpoch !== epoch) return;
    await storage.set(TOKEN_PAIR_KEY, JSON.stringify(pair));
    await Promise.all([
      storage.remove(LEGACY_ACCESS_KEY),
      storage.remove(LEGACY_REFRESH_KEY),
    ]);
  });
  if (sessionEpoch !== epoch) throw new SessionChangedError();
}

export async function clearTokens(): Promise<void> {
  clearMemorySession();
  await queueStoredTokenClear();
}

export async function hasSession(): Promise<boolean> {
  if (isWeb()) {
    await removeLegacyWebTokens();
    // HttpOnly cookies are deliberately opaque to JavaScript. Probe /me on
    // restore; its 401 path performs one cookie-backed refresh if necessary.
    return true;
  }
  return (await getTokens())?.refreshToken != null;
}

function headersFor(options: RequestInit, accessToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => {
      headers[key] = value;
    });
  }
  if (options.body != null && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  headers[PLATFORM_HEADER] = platformOS;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

export function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      controller.abort();
      finish(() => reject(new RequestAbortedError()));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new RequestTimeoutError()));
    }, timeoutMs);

    Promise.resolve().then(() => fetch(input, { ...options, signal: controller.signal })).then(
      (response) => finish(() => resolve(response)),
      (error) => finish(() => reject(error)),
    );
  });
}

function responseBodyWithTimeout<T>(
  response: Response,
  read: () => Promise<T>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void response.body?.cancel().catch(() => {});
      reject(new RequestTimeoutError());
    }, timeoutMs);
    read().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function responseTextWithTimeout(response: Response): Promise<string> {
  return responseBodyWithTimeout(response, () => response.text());
}

export function responseBlobWithTimeout(response: Response) {
  return responseBodyWithTimeout(response, () => response.blob());
}

function requestSignal(epoch: number, external?: AbortSignal | null): {
  signal: AbortSignal;
  release: () => void;
} {
  if (epoch !== sessionEpoch) throw new SessionChangedError();
  const controller = new AbortController();
  let controllers = requestControllers.get(epoch);
  if (!controllers) {
    controllers = new Set();
    requestControllers.set(epoch, controllers);
  }
  controllers.add(controller);
  const onAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    release: () => {
      external?.removeEventListener("abort", onAbort);
      const active = requestControllers.get(epoch);
      active?.delete(controller);
      if (active?.size === 0) requestControllers.delete(epoch);
    },
  };
}

type ScopedResponse = {
  response: Response;
  release: () => void;
};

async function rawRequestScoped(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
  epoch?: number,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ScopedResponse> {
  const scoped = epoch == null ? null : requestSignal(epoch, options.signal);
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/v1${path}`,
    {
      ...options,
      credentials: "include",
      headers: headersFor(options, accessToken),
      signal: scoped?.signal ?? options.signal,
    },
    timeoutMs,
  );
  return {
    response,
    release: () => {
      scoped?.release();
    },
  };
}

async function rawRequest(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
  epoch?: number,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const scoped = await rawRequestScoped(path, options, accessToken, epoch, timeoutMs);
  scoped.release();
  return scoped.response;
}

async function readJSON(response: Response): Promise<unknown> {
  const text = await responseTextWithTimeout(response);
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorBody(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function responseValue<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.status === 205) return undefined as T;
  const value = await readJSON(response);
  if (!response.ok) throw new ApiError(response.status, errorBody(value));
  if (value === undefined) {
    throw new ApiError(502, { error: "Invalid response from server" });
  }
  return value as T;
}

type SessionExpiredListener = () => void;
let sessionExpiredListeners: SessionExpiredListener[] = [];

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.push(listener);
  return () => {
    sessionExpiredListeners = sessionExpiredListeners.filter((item) => item !== listener);
  };
}

let expectedUserId: string | null = null;

// Set the user identity that the current credential session is expected to
// represent. Refresh results that return a different user are treated as a
// session mismatch and trigger expiration, preventing one tab/account from
// silently inheriting another's refreshed token.
export function setExpectedUserId(id: string | null): void {
  expectedUserId = id;
}

export function getExpectedUserId(): string | null {
  return expectedUserId;
}

// Serializes web auth operations that mutate the HttpOnly refresh cookie.
// This prevents an in-flight logout response from clearing a cookie set by a
// subsequent login.
let cookieMutex: Promise<unknown> = Promise.resolve();

function runCookieMutating<T>(operation: () => Promise<T>): Promise<T> {
  if (!isWeb()) return operation();
  const next = cookieMutex.then(operation).finally(() => {
    if (cookieMutex === next) cookieMutex = Promise.resolve();
  });
  cookieMutex = next;
  return next;
}

async function expireSession(epoch: number): Promise<void> {
  if (sessionEpoch !== epoch) return;
  clearMemorySession();
  sessionExpiredListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // One UI subscriber must not prevent the others or token cleanup.
    }
  });
  await queueStoredTokenClear();
}

type RefreshResult =
  | { kind: "refreshed" }
  | { kind: "expired" }
  | { kind: "transient"; error: unknown };

let refreshState: { epoch: number; promise: Promise<RefreshResult> } | null = null;

function isTerminalRefreshStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

async function performRefresh(epoch: number): Promise<RefreshResult> {
  try {
    const tokens = await getTokens(epoch);
    if (!isWeb() && !tokens?.refreshToken) {
      await expireSession(epoch);
      return { kind: "expired" };
    }
    const migrationToken = isWeb() ? legacyWebRefreshToken : null;
    if (isWeb()) legacyWebRefreshToken = null;
    const body = isWeb()
      ? migrationToken
        ? { refresh_token: migrationToken }
        : {}
      : { refresh_token: tokens!.refreshToken };
  const scoped = await rawRequestScoped(
    "/auth/refresh",
    { method: "POST", body: JSON.stringify(body) },
    null,
    epoch,
  );
  try {
    const value = await readJSON(scoped.response);
    if (!scoped.response.ok) {
      const error = new ApiError(scoped.response.status, errorBody(value));
      if (isTerminalRefreshStatus(scoped.response.status)) {
        await expireSession(epoch);
        return { kind: "expired" };
      }
      return { kind: "transient", error };
    }
    const token = validateTokenResponse(value);
    if (expectedUserId != null && token.user.id !== expectedUserId) {
      await expireSession(epoch);
      return { kind: "expired" };
    }
    await storeTokenResponse(token, epoch);
    return { kind: "refreshed" };
  } finally {
    scoped.release();
  }
  } catch (error) {
    if (error instanceof SessionChangedError || sessionEpoch !== epoch) {
      return { kind: "transient", error: new SessionChangedError() };
    }
    return { kind: "transient", error };
  }
}

function refreshSession(epoch: number): Promise<RefreshResult> {
  if (!refreshState || refreshState.epoch !== epoch) {
    // A successful refresh rotates the HttpOnly refresh cookie via Set-Cookie,
    // so it must share the cookie mutex with login/logout to avoid a background
    // refresh racing an explicit auth transition. On native this is a no-op.
    const promise = runCookieMutating(() => performRefresh(epoch)).finally(() => {
      if (refreshState?.epoch === epoch) refreshState = null;
    });
    refreshState = { epoch, promise };
  }
  return refreshState.promise;
}

// Attaches the current access token and retries once after a collapsed,
// epoch-scoped refresh. Only definitive refresh rejection expires a session;
// transport errors, 429s, and 5xx responses leave it intact for later retry.
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const epoch = sessionEpoch;
  const tokens = await getTokens(epoch);
  let scoped = await rawRequestScoped(path, options, tokens?.accessToken, epoch);
  try {
    if (sessionEpoch !== epoch) throw new SessionChangedError();
    if (scoped.response.status === 401) {
      void scoped.response.body?.cancel().catch(() => {});
      scoped.release();
      const refreshed = await refreshSession(epoch);
      if (refreshed.kind === "transient") throw refreshed.error;
      if (refreshed.kind === "refreshed") {
        const next = await getTokens(epoch);
        scoped = await rawRequestScoped(path, options, next?.accessToken, epoch);
      } else {
        // Expired: leave the caller to handle the 401 after releasing scope.
      }
    }
    if (sessionEpoch !== epoch) throw new SessionChangedError();
    if (scoped.response.status === 204 || scoped.response.status === 205) {
      return undefined as T;
    }
    const value = await readJSON(scoped.response);
    if (!scoped.response.ok) throw new ApiError(scoped.response.status, errorBody(value));
    if (value === undefined) {
      throw new ApiError(502, { error: "Invalid response from server" });
    }
    return value as T;
  } finally {
    scoped.release();
  }
}

async function authenticate(
  path: string,
  body: Record<string, unknown>,
): Promise<User> {
  const epoch = clearMemorySession();
  const clearPromise = queueStoredTokenClear();
  await clearPromise;
  let scoped: ScopedResponse;
  try {
    scoped = await rawRequestScoped(
      path,
      { method: "POST", body: JSON.stringify(body) },
      null,
      epoch,
    );
  } catch (error) {
    if (sessionEpoch !== epoch) throw new SessionChangedError();
    throw error;
  }
  try {
    const value = await readJSON(scoped.response);
    if (sessionEpoch !== epoch) throw new SessionChangedError();
    if (!scoped.response.ok) throw new ApiError(scoped.response.status, errorBody(value));
    const token = validateTokenResponse(value);
    await storeTokenResponse(token, epoch);
    return token.user;
  } finally {
    scoped.release();
  }
}

export function login(email: string, password: string): Promise<User> {
  return runCookieMutating(() => authenticate("/auth/login", { email, password }));
}

export function oauthLogin(
  provider: "google" | "apple",
  idToken: string,
  displayName?: string,
): Promise<User> {
  return runCookieMutating(() => authenticate("/auth/oauth", {
    provider,
    id_token: idToken,
    ...(displayName ? { display_name: displayName } : {}),
  }));
}

export function verifyEmail(token: string): Promise<User> {
  return runCookieMutating(() => authenticate("/auth/email-verification/verify", { token }));
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<RegistrationResult> {
  const epoch = clearMemorySession();
  await queueStoredTokenClear();
  const scoped = await rawRequestScoped(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    },
    null,
    epoch,
  );
  try {
    const value = await readJSON(scoped.response);
    if (sessionEpoch !== epoch) throw new SessionChangedError();
    if (!scoped.response.ok) throw new ApiError(scoped.response.status, errorBody(value));
    const body = errorBody(value);
    if (scoped.response.status !== 202 || body.verification_required !== true) {
      throw new ApiError(502, { error: "Invalid registration response" });
    }
    return {
      verificationRequired: true,
    };
  } finally {
    scoped.release();
  }
}

export async function requestEmailVerification(email: string): Promise<void> {
  const epoch = sessionEpoch;
  const scoped = await rawRequestScoped(
    "/auth/email-verification/request",
    { method: "POST", body: JSON.stringify({ email }) },
    null,
    epoch,
  );
  try {
    await responseValue<unknown>(scoped.response);
  } finally {
    scoped.release();
  }
}

export async function logout(options: LogoutOptions = {}): Promise<void> {
  return runCookieMutating(async () => {
    const tokens = memoryTokens;
    clearMemorySession();
    const clearPromise = queueStoredTokenClear();

    // These calls deliberately use the captured credentials outside the new
    // epoch. Local state is already gone; server revocation is bounded and
    // best-effort so a bad network can never trap the user in a signed-in UI.
    const serverCalls: Promise<unknown>[] = [];
    if (tokens?.accessToken && options.pushToken !== undefined) {
      serverCalls.push(
        Promise.resolve(options.pushToken).then(async (pushToken) => {
          if (!pushToken) return;
          const res = await rawRequest(
            "/me/push-token",
            { method: "DELETE", body: JSON.stringify({ token: pushToken }) },
            tokens.accessToken,
            undefined,
            LOGOUT_TIMEOUT_MS,
          );
          if (res.ok) {
            await options.onPushTokenRemoved?.();
          }
        }),
      );
    }
    if (isWeb() || tokens?.refreshToken) {
      serverCalls.push(
        rawRequest(
          "/auth/logout",
          {
            method: "POST",
            body: JSON.stringify(
              isWeb() ? {} : { refresh_token: tokens!.refreshToken },
            ),
          },
          null,
          undefined,
          LOGOUT_TIMEOUT_MS,
        ),
      );
    }
    const cleanup = Promise.allSettled([clearPromise, ...serverCalls]);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS);
      cleanup.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}
