// Builds the login route, preserving where the user was so the auth screens
// can send them back after sign-in (the `next` param, read by (auth)/_layout).
export function signInHref(next?: string | null): string {
  const safeNext = resolveNextPath(next);
  if (safeNext === "/" || safeNext.startsWith("/login") || safeNext.startsWith("/register")) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(safeNext)}`;
}

// Dynamic ids are opaque but must be one path segment. Accepts UUIDs and
// fixture slugs; rejects arrays, traversal, separators, query delimiters,
// and control characters.
export function parseRouteId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
    ? value
    : undefined;
}

export function safePathSegment(value: string): string {
  const valid = parseRouteId(value);
  if (!valid) throw new Error("Invalid path segment");
  return encodeURIComponent(valid);
}

// Resolves a ?next= value to a safe internal path. Rejects anything that
// isn't a plain in-app path — in particular protocol-relative "//host"
// values, which expo-router would open as an external URL (open redirect).
export function resolveNextPath(next: unknown): string {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(next)
  ) {
    return "/";
  }
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith("//") || decoded.includes("\\")) return "/";
  } catch {
    return "/";
  }
  return next;
}
