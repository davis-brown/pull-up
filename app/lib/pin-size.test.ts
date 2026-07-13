import { pinVariant } from "./pin-size";

describe("pinVariant", () => {
  it("renders a dot for an unselected, zero-count court", () => {
    expect(pinVariant(0, false)).toEqual({ kind: "dot" });
  });
  it("renders a 36px count pin for an unselected, active court", () => {
    expect(pinVariant(5, false)).toEqual({ kind: "count", size: 36 });
  });
  it("renders a 52px count pin for any selected court", () => {
    expect(pinVariant(0, true)).toEqual({ kind: "count", size: 52 });
    expect(pinVariant(5, true)).toEqual({ kind: "count", size: 52 });
  });
});
