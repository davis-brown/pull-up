import { relativeSince } from "./relative-time";

describe("relativeSince", () => {
  const now = new Date("2026-07-10T18:30:00Z").getTime();
  it("shows 'just now' under a minute", () => {
    expect(relativeSince("2026-07-10T18:29:30Z", now)).toBe("just now");
  });
  it("shows whole minutes under an hour", () => {
    expect(relativeSince("2026-07-10T18:10:00Z", now)).toBe("20m ago");
  });
  it("shows whole hours past an hour", () => {
    expect(relativeSince("2026-07-10T16:30:00Z", now)).toBe("2h ago");
  });
  it("never goes negative for a future timestamp", () => {
    expect(relativeSince("2026-07-10T18:40:00Z", now)).toBe("just now");
  });
});
