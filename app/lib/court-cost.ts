// Pure and node-safe: how a court's cost and access read to a player.
// Type-only import, so there is no react-native dependency for node-env jest.
import type { CourtDetail, CourtSummary } from "./types";

// The subset both CourtSummary and CourtDetail satisfy, so every surface —
// map pin, list row, detail header — formats cost from one implementation.
export interface CostFields {
  is_public: boolean;
  access: "public" | "private" | "customers" | null;
  fee: boolean | null;
  fee_amount_cents: number | null;
  fee_currency: string | null;
  fee_note: string | null;
}

export type CostTier = "free" | "paid" | "unknown";
export type AccessTier = "open" | "private" | "customers";

// Currencies with no minor unit: their amount is already whole, so dividing by
// 100 would render ¥500 as ¥5. Mirrors zeroDecimalCurrencies in
// server/internal/osm/parse.go — keep the two in sync.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);

// Unknown fee reads as free: most courts are, and warning about a charge that
// may not exist is worse than staying quiet. `paid` needs a positive signal.
export function costTier(c: CostFields): CostTier {
  if (c.fee === true) return "paid";
  if (c.fee === false) return "free";
  return "unknown";
}

// is_public is the coarse legacy flag; access is the specific one. Either can
// mark a court restricted, so both are consulted.
export function accessTier(c: CostFields): AccessTier {
  if (c.access === "private") return "private";
  if (c.access === "customers") return "customers";
  return c.is_public ? "open" : "private";
}

// True when the court is anything other than free and open to all — the
// condition the map badge and list chip key off.
export function isRestricted(c: CostFields): boolean {
  return costTier(c) === "paid" || accessTier(c) !== "open";
}

// Formats the amount alone: "$5", "$7.50", "¥500". Returns null when there is
// no amount to show, so callers can fall back to a bare "Paid".
export function formatFeeAmount(c: CostFields): string | null {
  const { fee_amount_cents: cents, fee_currency: currency } = c;
  if (cents == null || !currency) return null;

  const zeroDecimal = ZERO_DECIMAL.has(currency);
  const value = zeroDecimal ? cents : cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      // Whole amounts lose the ".00" — "$5" reads better than "$5.00" — but a
      // fractional price keeps both places.
      minimumFractionDigits: zeroDecimal || Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value);
  } catch {
    // Intl rejects a currency code it does not know. The server only
    // guarantees the ISO 4217 shape, so fall back rather than crash a screen.
    return `${value} ${currency}`;
  }
}

// The cost phrase for the detail header: "$5 drop-in", "$5", "Fee to play",
// or null when the court is free or unknown.
export function costLabel(c: CostFields): string | null {
  if (costTier(c) !== "paid") return null;
  const amount = formatFeeAmount(c);
  const note = c.fee_note?.trim();
  if (amount && note) return `${amount} ${note}`;
  return amount ?? note ?? "Fee to play";
}

// The short form for a list row's meta line, where space is tight: the price
// if known, else a bare "Paid". Null when the court is not pay-to-play.
export function shortCostLabel(c: CostFields): string | null {
  if (costTier(c) !== "paid") return null;
  return formatFeeAmount(c) ?? "Paid";
}

// Mirrors the server's fee_amount_cents CHECK, so the edit screen rejects an
// over-large price before the request rather than after.
export const MAX_FEE_AMOUNT_CENTS = 1_000_000;

// Seeds the edit field from stored cents: "5", "7.50", "500" for ¥500.
export function feeAmountToInput(c: CostFields): string {
  const { fee_amount_cents: cents, fee_currency: currency } = c;
  if (cents == null) return "";
  if (currency && ZERO_DECIMAL.has(currency)) return String(cents);
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

// Parses the edit field back to minor units. Returns null when the text is
// empty OR unparseable; callers that need to tell those apart check the
// trimmed string themselves, since only one of them is an error.
export function parseFeeInput(input: string, currency: string): number | null {
  const trimmed = input.trim().replace(",", ".");
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(ZERO_DECIMAL.has(currency) ? value : value * 100);
  return cents > MAX_FEE_AMOUNT_CENTS ? null : cents;
}

export function isCurrencyCode(v: string): boolean {
  return /^[A-Z]{3}$/.test(v);
}

// One-word access label for a chip, where accessLabel's phrasing is too long.
export function shortAccessLabel(c: CostFields): string | null {
  switch (accessTier(c)) {
    case "private":
      return "Private";
    case "customers":
      return "Members";
    default:
      return null;
  }
}

export function accessLabel(c: CostFields): string | null {
  switch (accessTier(c)) {
    case "private":
      return "Private court";
    case "customers":
      return "Customers/members only";
    default:
      return null;
  }
}

// Combined warning line for the court detail screen — access and cost joined
// the way the screen already joins its other meta lines. Null when the court
// is free and open, which is the common case and warrants no line at all.
export function restrictionLine(c: CostFields): string | null {
  const parts = [accessLabel(c), costLabel(c)].filter(Boolean);
  return parts.length > 0 ? parts.join("  ·  ") : null;
}

export type { CourtSummary, CourtDetail };
