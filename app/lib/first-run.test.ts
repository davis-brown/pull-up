import {
  markOnboardingSeen,
  onboardingSeen,
} from "./first-run";
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

describe("first-run flags", () => {
  it("is unseen until marked", async () => {
    mockStorage.get.mockResolvedValue(null);
    expect(await onboardingSeen()).toBe(false);
  });

  it("is seen after marking", async () => {
    await markOnboardingSeen();
    expect(mockStorage.set).toHaveBeenCalledWith("pullup.onboarding_seen_v1", "true");
    mockStorage.get.mockResolvedValue("true");
    expect(await onboardingSeen()).toBe(true);
  });
});
