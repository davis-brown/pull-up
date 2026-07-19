// Extracts a human-readable message from a caught value, falling back for
// non-Error throws (rejected promises can reject with anything).
export function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
