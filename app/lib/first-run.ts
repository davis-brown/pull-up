import { storage } from "./storage";

// One-shot flags for first-run UX. Each is "unset" until marked, then sticky.
// Stored in the same secure storage as tokens — no extra dependency.
const seen = (key: string) => async (): Promise<boolean> =>
  (await storage.get(key)) === "true";
const mark = (key: string) => async (): Promise<void> => storage.set(key, "true");

export const onboardingSeen = seen("rallyflare.onboarding_seen_v1");
export const markOnboardingSeen = mark("rallyflare.onboarding_seen_v1");

// Permission primers (Task: permission priming) — shown at most once each.
export const locationPrimerDone = seen("rallyflare.location_primer_v1");
export const markLocationPrimerDone = mark("rallyflare.location_primer_v1");
export const pushPrimerDone = seen("rallyflare.push_primer_v1");
export const markPushPrimerDone = mark("rallyflare.push_primer_v1");
