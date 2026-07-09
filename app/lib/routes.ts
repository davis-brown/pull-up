// Builds the login route, preserving where the user was so the auth screens
// can send them back after sign-in (the `next` param, read by (auth)/_layout).
export function signInHref(next?: string | null): string {
  if (!next || next === "/" || next.startsWith("/login") || next.startsWith("/register")) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(next)}`;
}
