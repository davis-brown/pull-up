// Pure, node-safe: bucket math for "looking for a run" (phase 19). Buckets
// are symbolic (date + availability-window key), matched server-side using
// UTC calendar days — not each viewer's local timezone — so the date
// arithmetic here deliberately uses UTC, not local Date methods, even
// though the rest of the app (e.g. the plan-a-run day picker) works in
// local time. Matchmaking buckets are symbolic labels, not exact times —
// see the phase 19 spec for why per-user timezone machinery isn't used.
import type { RunIntentSeeker } from "./types";
import { WINDOW_SPANS, type WindowSpan } from "./your-window";

const DAY_MS = 86_400_000;
// The server accepts run_date up to today+7 (maxIntentLeadDays).
export const MAX_INTENT_LEAD_DAYS = 7;

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysBetween(iso: string, now: Date): number {
  const bucketMs = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.round((bucketMs - utcMidnight(now)) / DAY_MS);
}

function dayType(iso: string): "weekday" | "weekend" {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

// "Today" / "Tomorrow" / "Thu, Jul 23" for a bucket's date, relative to now.
export function dayLabel(iso: string, now: Date): string {
  const offset = daysBetween(iso, now);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export interface IntentDayOption {
  iso: string; // YYYY-MM-DD, UTC calendar date
  label: string;
  dayType: "weekday" | "weekend";
}

// The MAX_INTENT_LEAD_DAYS + 1 selectable days (today through +7).
export function intentDayOptions(now: Date): IntentDayOption[] {
  const today = utcMidnight(now);
  const out: IntentDayOption[] = [];
  for (let offset = 0; offset <= MAX_INTENT_LEAD_DAYS; offset++) {
    const iso = new Date(today + offset * DAY_MS).toISOString().slice(0, 10);
    out.push({ iso, label: dayLabel(iso, now), dayType: dayType(iso) });
  }
  return out;
}

// The availability windows selectable for a given bucket date (weekday_*
// windows on weekdays, weekend_* on weekends) — mirrors the server's
// day-type check in parseIntentBucket.
export function windowsForDate(iso: string): WindowSpan[] {
  const dt = dayType(iso);
  return WINDOW_SPANS.filter((w) => w.dayType === dt);
}

// Maps a bucket's UTC date onto the plan-a-run screen's local "day offset
// from today" picker so tapping "Plan it" on a bucket lands on roughly the
// right day, pre-selected but always editable before submitting — an
// approximation, consistent with buckets being symbolic rather than exact.
export function dayOffsetFromToday(iso: string, now: Date): number {
  return Math.min(MAX_INTENT_LEAD_DAYS, Math.max(0, daysBetween(iso, now)));
}

export interface RunIntentBucket {
  run_date: string;
  window_key: string;
  label: string; // "Today evening"
  seekers: RunIntentSeeker[];
}

function windowOrder(key: string): number {
  const i = WINDOW_SPANS.findIndex((w) => w.key === key);
  return i === -1 ? WINDOW_SPANS.length : i;
}

// Groups the flat seeker list the API returns into per-bucket groups,
// ordered by date then the window's natural (start-hour) order.
export function groupRunIntents(seekers: RunIntentSeeker[], now: Date): RunIntentBucket[] {
  const byKey = new Map<string, RunIntentBucket>();
  for (const s of seekers) {
    const key = `${s.run_date}|${s.window_key}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      const span = WINDOW_SPANS.find((w) => w.key === s.window_key);
      bucket = {
        run_date: s.run_date,
        window_key: s.window_key,
        label: `${dayLabel(s.run_date, now)} ${span?.label ?? s.window_key}`,
        seekers: [],
      };
      byKey.set(key, bucket);
    }
    bucket.seekers.push(s);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.run_date !== b.run_date) return a.run_date < b.run_date ? -1 : 1;
    return windowOrder(a.window_key) - windowOrder(b.window_key);
  });
}
