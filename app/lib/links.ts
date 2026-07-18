// Canonical share links for courts and planned runs. Pure and node-safe:
// no react-native import (detect web via window, not Platform) so jest can
// exercise it in the node environment.

// Production web origin; override with EXPO_PUBLIC_WEB_URL at build time.
export const DEFAULT_WEB_URL = "https://pull-up.davisbrown.dev";

function baseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_WEB_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Fall through to the current/default origin.
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_WEB_URL;
}

export function buildCourtLink(courtId: string, sessionId?: string): string {
  const url = new URL(`/court/${encodeURIComponent(courtId)}`, baseUrl());
  if (sessionId) url.searchParams.set("run", sessionId);
  return url.toString();
}

// Canonical share link for a player's public profile (shared player card).
export function buildProfileLink(userId: string): string {
  return new URL(`/user/${encodeURIComponent(userId)}`, baseUrl()).toString();
}

// Validates a router `run` query value: a single non-empty string, else null.
export function parseRunParam(param: string | string[] | undefined): string | null {
  return typeof param === "string" &&
    param.length > 0 &&
    param.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(param)
    ? param
    : null;
}

export function courtShareMessage(name: string, link: string): string {
  return `Check out ${name} on pull-up — ${link}`;
}

export function runShareMessage(name: string, whenLabel: string, link: string): string {
  return `Pull up to ${name}, ${whenLabel} — ${link}`;
}
