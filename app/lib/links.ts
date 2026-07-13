// Canonical share links for courts and planned runs. Pure and node-safe:
// no react-native import (detect web via window, not Platform) so jest can
// exercise it in the node environment.

// Production web origin; override with EXPO_PUBLIC_WEB_URL at build time.
export const DEFAULT_WEB_URL = "https://pullup.app";

function baseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_WEB_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_WEB_URL;
}

export function buildCourtLink(courtId: string, sessionId?: string): string {
  const base = `${baseUrl()}/court/${courtId}`;
  return sessionId ? `${base}?run=${sessionId}` : base;
}

// Canonical share link for a player's public profile (shared player card).
export function buildProfileLink(userId: string): string {
  return `${baseUrl()}/user/${userId}`;
}

// Validates a router `run` query value: a single non-empty string, else null.
export function parseRunParam(param: string | string[] | undefined): string | null {
  return typeof param === "string" && param.length > 0 ? param : null;
}

export function courtShareMessage(name: string, link: string): string {
  return `Check out ${name} on pull-up — ${link}`;
}

export function runShareMessage(name: string, whenLabel: string, link: string): string {
  return `Pull up to ${name}, ${whenLabel} — ${link}`;
}
