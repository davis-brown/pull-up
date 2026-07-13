// Pure, node-safe: turnout forecast shapes and the scrubber math built on
// top of them. No react/react-native imports here — see lib/court-filters.ts
// for the pattern this follows (jest runs these in plain node).

export interface ForecastSession {
  session_id: string;
  hour: number;
  starts_at: string;
  going: number;
}

export interface CourtForecast {
  court_id: string;
  hours: number[];
  has_history: boolean;
  sessions: ForecastSession[];
}

// Expected turnout at a given hour: the historical/baseline hourly count
// plus the going-count of every planned session scheduled at that hour.
export function expectedAt(f: CourtForecast | undefined, hour: number): number {
  if (!f) return 0;
  const base = f.hours[hour] ?? 0;
  const sessionGoing = f.sessions
    .filter((s) => s.hour === hour)
    .reduce((sum, s) => sum + s.going, 0);
  return base + sessionGoing;
}

// The first planned session scheduled at a given hour, or null.
export function sessionAt(f: CourtForecast | undefined, hour: number): ForecastSession | null {
  if (!f) return null;
  return f.sessions.find((s) => s.hour === hour) ?? null;
}

// The busiest contiguous 3-hour window over a 24-length hourly array (sliding
// window sum), or null when every hour is zero (nothing to highlight).
export function busiestWindow(hours: number[]): { start: number; end: number } | null {
  if (hours.every((h) => h === 0)) return null;
  let bestStart = 0;
  let bestSum = -1;
  for (let start = 0; start + 2 < hours.length; start++) {
    const sum = hours[start] + hours[start + 1] + hours[start + 2];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }
  return { start: bestStart, end: bestStart + 2 };
}

// The scrubbable hour range for "today": from the current hour through
// closeHour (10 PM default) inclusive. Always returns at least one hour,
// even when now is already past closeHour (e.g. 11 PM) — the scrubber still
// needs a valid, non-empty range to render.
export function scrubHours(now: Date, closeHour = 22): number[] {
  const currentHour = now.getHours();
  const end = Math.max(currentHour, closeHour);
  const out: number[] = [];
  for (let h = currentHour; h <= end; h++) out.push(h);
  return out;
}
