import { loadLastCheckInPrefs, saveLastCheckInPrefs } from "./checkin-prefs";
import { storage } from "./storage";

jest.mock("./storage", () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockStorage = storage as jest.Mocked<typeof storage>;

beforeEach(() => jest.clearAllMocks());

describe("checkin-prefs", () => {
  it("defaults to just-me, no ball when nothing is stored", async () => {
    mockStorage.get.mockResolvedValue(null);
    expect(await loadLastCheckInPrefs()).toEqual({ partySize: 1, hasBall: false });
  });

  it("round-trips saved prefs", async () => {
    let saved: string | null = null;
    mockStorage.set.mockImplementation(async (_key, value) => {
      saved = value;
    });
    await saveLastCheckInPrefs({ partySize: 3, hasBall: true });
    expect(mockStorage.set).toHaveBeenCalledWith(
      "pullup.last_checkin_prefs",
      expect.any(String),
    );
    mockStorage.get.mockResolvedValue(saved);
    expect(await loadLastCheckInPrefs()).toEqual({ partySize: 3, hasBall: true });
  });

  it("falls back to defaults on malformed JSON", async () => {
    mockStorage.get.mockResolvedValue("not json");
    expect(await loadLastCheckInPrefs()).toEqual({ partySize: 1, hasBall: false });
  });

  it("falls back to defaults on out-of-range party size", async () => {
    mockStorage.get.mockResolvedValue(JSON.stringify({ partySize: 9, hasBall: true }));
    expect(await loadLastCheckInPrefs()).toEqual({ partySize: 1, hasBall: true });
  });

  it("falls back to defaults on non-integer party size", async () => {
    mockStorage.get.mockResolvedValue(JSON.stringify({ partySize: 2.5, hasBall: false }));
    expect(await loadLastCheckInPrefs()).toEqual({ partySize: 1, hasBall: false });
  });

  it("ignores a non-boolean hasBall", async () => {
    mockStorage.get.mockResolvedValue(JSON.stringify({ partySize: 2, hasBall: "yes" }));
    expect(await loadLastCheckInPrefs()).toEqual({ partySize: 2, hasBall: false });
  });
});
