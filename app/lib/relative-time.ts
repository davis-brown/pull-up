// Pure, node-safe (no react-native import): compact "time since" label for the
// feed's "friends here now" strip. `now` is injectable for deterministic tests.
export function relativeSince(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
