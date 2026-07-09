// Builds the login route, preserving where the user was so the auth screens
// can send them back after sign-in (the `next` param, read by (auth)/_layout).
export function signInHref(next?: string | null): string {
  if (!next || next === "/" || next.startsWith("/login") || next.startsWith("/register")) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(next)}`;
}

// Resolves a ?next= value to a safe internal path. Rejects anything that
// isn't a plain in-app path — in particular protocol-relative "//host"
// values, which expo-router would open as an external URL (open redirect).
export function resolveNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}
