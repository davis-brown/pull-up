import { courtsDisplayState, viewportTooLarge } from "./court-seeding";

describe("courtsDisplayState", () => {
  it("has-courts wins", () => {
    expect(courtsDisplayState({ courtCount: 2, seeding: true, viewportTooLarge: true })).toBe("has-courts");
  });
  it("zoomed-out before seeding when empty", () => {
    expect(courtsDisplayState({ courtCount: 0, seeding: true, viewportTooLarge: true })).toBe("zoomed-out");
  });
  it("seeding when empty and seedable", () => {
    expect(courtsDisplayState({ courtCount: 0, seeding: true, viewportTooLarge: false })).toBe("seeding");
  });
  it("empty otherwise", () => {
    expect(courtsDisplayState({ courtCount: 0, seeding: false, viewportTooLarge: false })).toBe("empty");
  });
});

describe("viewportTooLarge", () => {
  it("false for a small bbox", () => {
    expect(viewportTooLarge({ minLng: 0.1, minLat: 0.1, maxLng: 0.2, maxLat: 0.2 })).toBe(false);
  });
  it("true for a huge bbox", () => {
    expect(viewportTooLarge({ minLng: 0, minLat: 0, maxLng: 10, maxLat: 10 })).toBe(true);
  });
});
