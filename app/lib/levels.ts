// Pure and node-safe: presentation helpers for XP levels. The curve lives
// server-side (internal/api/xp.go) and arrives via /me/stats; the app never
// recomputes a level, so the two can't drift.
import type { MeStats } from "./types";

// How full the progress bar should be, 0..1. The level cap reports
// xp_for_next_level = 0; that reads as a full bar, not a divide-by-zero.
export function levelProgressRatio(stats: MeStats | undefined): number {
  if (!stats) return 0;
  if (stats.xp_for_next_level <= 0) return 1;
  const ratio = stats.xp_into_level / stats.xp_for_next_level;
  return Math.min(1, Math.max(0, ratio));
}

// "35 XP to level 4", or "Max level" at the cap.
export function xpToNextLabel(stats: MeStats | undefined): string {
  if (!stats) return "";
  if (stats.xp_for_next_level <= 0) return "Max level";
  const remaining = Math.max(0, stats.xp_for_next_level - stats.xp_into_level);
  return `${remaining} XP to level ${stats.level + 1}`;
}

// Mirrors the award constants in internal/api/xp.go. Keep in sync.
export const XP_SOURCES: { label: string; points: string }[] = [
  { label: "Check in at a court", points: "+10" },
  { label: "First check-in of the day", points: "+5" },
  { label: "Show up to a run you're in", points: "+15" },
  { label: "A run you planned draws a crowd", points: "+20" },
  { label: "A court you added gets verified", points: "+25" },
  { label: "Confirm a court's conditions", points: "+2" },
  { label: "Play a confirmed game", points: "+10" },
  { label: "Weekly streak bonus", points: "+10 per week, up to 5" },
];

// Display names for the award kinds in /me/stats' xp_breakdown, keyed by the
// raw ledger kind. Read defensively: an unrecognised kind (a new award
// shipped ahead of the app) falls back to a readable form of the key.
const XP_KIND_LABELS: Record<string, string> = {
  check_in: "Check-ins",
  daily_first: "First check-in of the day",
  showed_up: "Showed up to a run",
  hosted_run: "Runs you planned",
  court_verified: "Courts you added, verified",
  fact_confirmed: "Court conditions confirmed",
  game_played: "Games played",
  streak_week: "Weekly streak",
};

export function xpKindLabel(kind: string): string {
  return XP_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}
