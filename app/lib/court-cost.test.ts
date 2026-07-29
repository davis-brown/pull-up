import {
  accessTier,
  costLabel,
  costTier,
  feeAmountToInput,
  formatFeeAmount,
  isRestricted,
  parseFeeInput,
  restrictionLine,
  shortAccessLabel,
  shortCostLabel,
  type CostFields,
} from "./court-cost";

function court(overrides: Partial<CostFields> = {}): CostFields {
  return {
    is_public: true,
    access: null,
    fee: null,
    fee_amount_cents: null,
    fee_currency: null,
    fee_note: null,
    ...overrides,
  };
}

describe("costTier", () => {
  it("treats an unknown fee as free, and only a true fee as paid", () => {
    expect(costTier(court({ fee: null }))).toBe("unknown");
    expect(costTier(court({ fee: false }))).toBe("free");
    expect(costTier(court({ fee: true }))).toBe("paid");
  });
});

describe("accessTier", () => {
  it("reads access first and falls back to the coarse is_public flag", () => {
    expect(accessTier(court())).toBe("open");
    expect(accessTier(court({ access: "public" }))).toBe("open");
    expect(accessTier(court({ access: "private" }))).toBe("private");
    expect(accessTier(court({ access: "customers" }))).toBe("customers");
    expect(accessTier(court({ is_public: false }))).toBe("private");
  });

  it("lets either field restrict, matching the server's public filter", () => {
    // CourtsInBBox requires is_public = true AND access in (null,'public'),
    // so a court flagged non-public is restricted even if access says public.
    expect(accessTier(court({ is_public: false, access: "public" }))).toBe("private");
  });
});

describe("isRestricted", () => {
  it("is true for anything that is not free and open to all", () => {
    expect(isRestricted(court())).toBe(false);
    expect(isRestricted(court({ fee: false }))).toBe(false);
    expect(isRestricted(court({ fee: true }))).toBe(true);
    expect(isRestricted(court({ access: "customers" }))).toBe(true);
    expect(isRestricted(court({ is_public: false }))).toBe(true);
  });
});

describe("formatFeeAmount", () => {
  it("drops the decimals on a whole amount but keeps them on a fractional one", () => {
    expect(
      formatFeeAmount(court({ fee_amount_cents: 500, fee_currency: "USD" })),
    ).toBe("$5");
    expect(
      formatFeeAmount(court({ fee_amount_cents: 750, fee_currency: "USD" })),
    ).toBe("$7.50");
  });

  it("does not divide a zero-decimal currency by 100", () => {
    expect(
      formatFeeAmount(court({ fee_amount_cents: 500, fee_currency: "JPY" })),
    ).toBe("¥500");
  });

  it("returns null unless both an amount and a currency are present", () => {
    expect(formatFeeAmount(court({ fee_amount_cents: 500 }))).toBeNull();
    expect(formatFeeAmount(court({ fee_currency: "USD" }))).toBeNull();
    expect(formatFeeAmount(court())).toBeNull();
  });

  it("renders an unassigned but well-formed code without throwing", () => {
    // Intl accepts any ISO-shaped code and prints the code as the symbol, so
    // the try/catch is a backstop rather than the path taken here. It joins
    // with a non-breaking space, hence the normalization.
    const formatted = formatFeeAmount(
      court({ fee_amount_cents: 500, fee_currency: "ZZZ" }),
    );
    expect(formatted?.replace(/ /g, " ")).toBe("ZZZ 5");
  });

  it("formats a free court's stale amount only when asked directly", () => {
    // costLabel gates on the fee flag; the formatter itself does not.
    const stale = court({ fee: false, fee_amount_cents: 500, fee_currency: "USD" });
    expect(formatFeeAmount(stale)).toBe("$5");
    expect(costLabel(stale)).toBeNull();
  });
});

describe("costLabel", () => {
  it("joins the price and the note when both are known", () => {
    expect(
      costLabel(
        court({
          fee: true,
          fee_amount_cents: 500,
          fee_currency: "USD",
          fee_note: "drop-in",
        }),
      ),
    ).toBe("$5 drop-in");
  });

  it("degrades to the price, then the note, then a bare phrase", () => {
    expect(
      costLabel(court({ fee: true, fee_amount_cents: 500, fee_currency: "USD" })),
    ).toBe("$5");
    expect(costLabel(court({ fee: true, fee_note: "$200/mo" }))).toBe("$200/mo");
    expect(costLabel(court({ fee: true }))).toBe("Fee to play");
  });

  it("is null for a free or unknown court", () => {
    expect(costLabel(court({ fee: false }))).toBeNull();
    expect(costLabel(court())).toBeNull();
  });
});

describe("shortCostLabel", () => {
  it("prefers the price and falls back to a bare Paid", () => {
    expect(
      shortCostLabel(court({ fee: true, fee_amount_cents: 500, fee_currency: "USD" })),
    ).toBe("$5");
    expect(shortCostLabel(court({ fee: true, fee_note: "drop-in" }))).toBe("Paid");
    expect(shortCostLabel(court({ fee: false }))).toBeNull();
  });
});

describe("shortAccessLabel", () => {
  it("gives a one-word label only for restricted courts", () => {
    expect(shortAccessLabel(court())).toBeNull();
    expect(shortAccessLabel(court({ access: "private" }))).toBe("Private");
    expect(shortAccessLabel(court({ access: "customers" }))).toBe("Members");
  });
});

describe("restrictionLine", () => {
  it("joins access and cost, and is null when neither applies", () => {
    expect(restrictionLine(court())).toBeNull();
    expect(restrictionLine(court({ access: "private" }))).toBe("Private court");
    expect(restrictionLine(court({ fee: true }))).toBe("Fee to play");
    expect(
      restrictionLine(
        court({
          access: "customers",
          fee: true,
          fee_amount_cents: 1500,
          fee_currency: "USD",
        }),
      ),
    ).toBe("Customers/members only  ·  $15");
  });
});

describe("feeAmountToInput / parseFeeInput", () => {
  it("round-trips a decimal currency through the edit field", () => {
    expect(feeAmountToInput(court({ fee_amount_cents: 500, fee_currency: "USD" }))).toBe("5");
    expect(feeAmountToInput(court({ fee_amount_cents: 750, fee_currency: "USD" }))).toBe("7.50");
    expect(parseFeeInput("5", "USD")).toBe(500);
    expect(parseFeeInput("7.50", "USD")).toBe(750);
  });

  it("round-trips a zero-decimal currency without scaling", () => {
    expect(feeAmountToInput(court({ fee_amount_cents: 500, fee_currency: "JPY" }))).toBe("500");
    expect(parseFeeInput("500", "JPY")).toBe(500);
  });

  it("accepts a decimal comma", () => {
    expect(parseFeeInput("2,50", "EUR")).toBe(250);
  });

  it("returns null for empty, unparseable, and over-large input", () => {
    expect(parseFeeInput("", "USD")).toBeNull();
    expect(parseFeeInput("   ", "USD")).toBeNull();
    expect(parseFeeInput("free", "USD")).toBeNull();
    expect(parseFeeInput("-5", "USD")).toBeNull();
    expect(parseFeeInput("99999", "USD")).toBeNull();
  });

  it("gives an empty field when there is no stored amount", () => {
    expect(feeAmountToInput(court())).toBe("");
  });
});
