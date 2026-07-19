// Pure, node-safe: maps a player's availability windows (profile settings)
// onto today's hourly forecast curve — the "your window" lens.
import type { CourtForecast } from "./forecast";

export interface WindowSpan {
  key: string;
  dayType: "weekday" | "weekend";
  start: number; // inclusive hour
  end: number; // exclusive hour
  label: string; // short, lowercase, for sentences
}

// Exported so tests can assert these stay in sync with the availability
// keys players actually pick in profile settings (player.ts).
export const WINDOW_SPANS: WindowSpan[] = [
  { key: "weekday_morning", dayType: "weekday", start: 6, end: 11, label: "morning" },
  { key: "weekday_lunch", dayType: "weekday", start: 11, end: 14, label: "lunch" },
  { key: "weekday_evening", dayType: "weekday", start: 17, end: 22, label: "evening" },
  { key: "weekend_morning", dayType: "weekend", start: 6, end: 12, label: "morning" },
  { key: "weekend_afternoon", dayType: "weekend", start: 12, end: 17, label: "afternoon" },
  { key: "weekend_evening", dayType: "weekend", start: 17, end: 22, label: "evening" },
];

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function dayTypeOf(now: Date): "weekday" | "weekend" {
  const dow = now.getDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

// The player's windows that apply to today (their weekday windows on
// weekdays, weekend windows on weekends).
export function todaysWindows(availability: string[], now: Date): WindowSpan[] {
  const today = dayTypeOf(now);
  return WINDOW_SPANS.filter(
    (w) => w.dayType === today && availability.includes(w.key),
  );
}

// Hours (0-23) covered by any of the player's windows today.
export function yourWindowHours(availability: string[], now: Date): Set<number> {
  const hours = new Set<number>();
  for (const w of todaysWindows(availability, now)) {
    for (let h = w.start; h < w.end; h++) hours.add(h);
  }
  return hours;
}

// One-liner for the map's court sheet when the player's best window today has
// historical activity, e.g. "Usually active in your Thursday-evening window"
// (the forecast's hourly curve is already filtered to today's day of week).
// Sums the historical baseline only — never today's scheduled runs — so a
// single planned session can't masquerade as "usually". Null when the player
// set no windows for today, the court lacks history, or their windows are
// historically dead here.
export function yourWindowSummary(
  forecast: CourtForecast | undefined,
  availability: string[],
  now: Date,
): string | null {
  if (!forecast?.has_history) return null;
  let best: { label: string; total: number } | null = null;
  for (const w of todaysWindows(availability, now)) {
    let total = 0;
    for (let h = w.start; h < w.end; h++) total += forecast.hours[h] ?? 0;
    if (total > 0 && (best == null || total > best.total)) {
      best = { label: w.label, total };
    }
  }
  if (!best) return null;
  return `Usually active in your ${DAY_NAMES[now.getDay()]}-${best.label} window`;
}
