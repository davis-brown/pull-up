import { storage } from "./storage";

// One-shot flags for first-run UX. Each is "unset" until marked, then sticky.
// Stored in the same secure storage as tokens — no extra dependency.
const seen = (key: string) => async (): Promise<boolean> =>
  (await storage.get(key)) === "true";
const mark = (key: string) => async (): Promise<void> => storage.set(key, "true");

export const onboardingSeen = seen("pullup.onboarding_seen_v1");
export const markOnboardingSeen = mark("pullup.onboarding_seen_v1");

// Permission primers (Task: permission priming) — shown at most once each.
export const locationPrimerDone = seen("pullup.location_primer_v1");
export const markLocationPrimerDone = mark("pullup.location_primer_v1");
export const pushPrimerDone = seen("pullup.push_primer_v1");
export const markPushPrimerDone = mark("pullup.push_primer_v1");
