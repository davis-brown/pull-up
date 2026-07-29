// Pure helpers for the shareable player card. No react-native import, so
// jest exercises these in the node environment.

const CM_PER_INCH = 2.54;

// Rounds to the nearest inch, then formats as feet'inches" (e.g. 185 -> 6'1").
export function formatHeight(cm: number | null): string | null {
  if (cm == null) return null;
  const totalInches = Math.round(cm / CM_PER_INCH);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// Builds the player card's caption subline, e.g. "#23 · Guard · 6'1" · Advanced".
// Omits any missing part cleanly (no dangling "·"); "" when all are missing.
export function playerSubline(u: {
  jersey_number: number | null;
  position: string | null;
  height_cm: number | null;
  skill_level?: string | null;
}): string {
  const parts: string[] = [];
  if (u.jersey_number != null) parts.push(`#${u.jersey_number}`);
  if (u.position) parts.push(capitalize(u.position));
  const height = formatHeight(u.height_cm);
  if (height) parts.push(height);
  if (u.skill_level) parts.push(capitalize(u.skill_level));
  return parts.join(" · ");
}

// "Weekday evenings · Weekend mornings" from availability keys; unknown keys
// are skipped so the card never renders raw enum values.
export function availabilityLine(keys: string[]): string {
  return keys
    .map((key) => AVAILABILITY_WINDOWS.find((w) => w.key === key)?.label)
    .filter((label): label is string => Boolean(label))
    .join(" · ");
}

export const STYLE_TAGS: { key: string; label: string }[] = [
  { key: "shooter", label: "Shooter" },
  { key: "pass_first", label: "Pass-first" },
  { key: "defense", label: "Defense" },
  { key: "rim_runner", label: "Rim runner" },
  { key: "casual", label: "Casual" },
  { key: "competitive", label: "Competitive" },
];

export const MAX_STYLE_TAGS = 3;

export const POSITIONS: { key: string; label: string }[] = [
  { key: "guard", label: "Guard" },
  { key: "wing", label: "Wing" },
  { key: "forward", label: "Forward" },
  { key: "center", label: "Center" },
];

export const SKILL_LEVELS: { key: string; label: string }[] = [
  { key: "beginner", label: "Beginner" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
  { key: "elite", label: "Elite" },
];

// Structured availability windows, mirroring the server allowlist.
export const AVAILABILITY_WINDOWS: { key: string; label: string }[] = [
  { key: "weekday_morning", label: "Weekday mornings" },
  { key: "weekday_lunch", label: "Weekday lunch" },
  { key: "weekday_evening", label: "Weekday evenings" },
  { key: "weekend_morning", label: "Weekend mornings" },
  { key: "weekend_afternoon", label: "Weekend afternoons" },
  { key: "weekend_evening", label: "Weekend evenings" },
];

export const BADGES: { id: string; label: string; icon: string }[] = [
  { id: "first_run", label: "First Run", icon: "basketball" },
  { id: "explorer", label: "Explorer", icon: "map" },
  { id: "early_bird", label: "Early Bird", icon: "sunny" },
  { id: "regular", label: "Regular", icon: "home" },
  { id: "streak_4", label: "On a Streak", icon: "flame" },
  { id: "host", label: "Host", icon: "people" },
];
