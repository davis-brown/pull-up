// Pure and node-safe: turnout forecast shapes and the scrubber math. No
// react/react-native imports, so jest can run these in plain node.

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
  // Distinct weeks of history behind the averages (0-8); a confidence signal.
  weeks: number;
  sessions: ForecastSession[];
}

// Below this many weeks of history the forecast is captioned as thin.
export const CONFIDENCE_WEEKS = 4;

// A low-confidence caption, or null when the forecast has no history or
// enough weeks to stand on its own.
export function lowConfidenceLabel(f: CourtForecast | undefined): string | null {
  if (!f || !f.has_history || f.weeks >= CONFIDENCE_WEEKS) return null;
  const w = Math.max(1, f.weeks);
  return `Based on ${w} week${w === 1 ? "" : "s"} of check-ins`;
}

// Expected turnout at an hour: the baseline count plus the going-count of
// every planned session at that hour.
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

// The busiest contiguous 3-hour window, or null when every hour is zero.
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

// The set of court ids to request a forecast for, capped at `cap`.
// priorityId always survives the cut, or the selected court's scrubbed count
// could read 0. Sorting happens AFTER that inclusion, so the output — and
// therefore the query cache key — is deterministic for a given input set.
export function forecastIdSet(
  ids: string[],
  priorityId: string | null | undefined,
  cap: number,
): string[] {
  const unique = new Set(ids);
  if (priorityId) unique.add(priorityId);
  const sorted = [...unique].sort();
  if (sorted.length <= cap) return sorted;
  const rest = priorityId ? sorted.filter((id) => id !== priorityId) : sorted;
  const capped = priorityId ? [priorityId, ...rest.slice(0, cap - 1)] : rest.slice(0, cap);
  return capped.sort();
}

// The scrubbable hour range for today: current hour through closeHour,
// inclusive. Always non-empty, even when now is past closeHour.
export function scrubHours(now: Date, closeHour = 22): number[] {
  const currentHour = now.getHours();
  const end = Math.max(currentHour, closeHour);
  const out: number[] = [];
  for (let h = currentHour; h <= end; h++) out.push(h);
  return out;
}
