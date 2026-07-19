// Pure, node-safe (no react-native import): compact "time since" label for the
// feed's "friends here now" strip. `now` is injectable for deterministic tests.
export function relativeSince(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// Locale-formatted clock time, e.g. "2:45 PM" — used for check-in expiry and
// session start times.
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
