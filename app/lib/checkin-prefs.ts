import { storage } from "./storage";

// Remembers the last check-in's party size and ball status so the slide-to-
// check-in screen can default to them next time (spec 3d) — most players
// bring the same crew and gear session to session.
const PREFS_KEY = "pullup.last_checkin_prefs";

export interface CheckInPrefs {
  partySize: number; // 1-4
  hasBall: boolean;
}

const DEFAULT_PREFS: CheckInPrefs = { partySize: 1, hasBall: false };

export async function loadLastCheckInPrefs(): Promise<CheckInPrefs> {
  const raw = await storage.get(PREFS_KEY);
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<CheckInPrefs>;
    const partySize = parsed.partySize;
    const validPartySize =
      typeof partySize === "number" &&
      Number.isInteger(partySize) &&
      partySize >= 1 &&
      partySize <= 4;
    return {
      partySize: validPartySize ? partySize : DEFAULT_PREFS.partySize,
      hasBall: typeof parsed.hasBall === "boolean" ? parsed.hasBall : DEFAULT_PREFS.hasBall,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveLastCheckInPrefs(prefs: CheckInPrefs): Promise<void> {
  await storage.set(PREFS_KEY, JSON.stringify(prefs));
}
