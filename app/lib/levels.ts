// Pure, node-safe: presentation helpers for XP levels (phase 20). The
// curve itself lives server-side (internal/api/xp.go) and arrives via
// /me/stats — the app never recomputes a level, so the two can't drift.
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

// How a player earns XP, for the in-app explainer. Mirrors the award
// constants in internal/api/xp.go — if those change, change these.
export const XP_SOURCES: { label: string; points: string }[] = [
  { label: "Check in at a court", points: "+10" },
  { label: "First check-in of the day", points: "+5" },
  { label: "Show up to a run you're in", points: "+15" },
  { label: "A run you planned draws a crowd", points: "+20" },
  { label: "A court you added gets verified", points: "+25" },
  { label: "Confirm a court's conditions", points: "+2" },
  { label: "Weekly streak bonus", points: "+10 per week, up to 5" },
];
