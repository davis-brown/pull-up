import { bannerDismissed, dismissBanner } from "./app-banner";

describe("app-banner dismissal flag", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("is not dismissed initially", () => {
    expect(bannerDismissed()).toBe(false);
  });

  it("is dismissed after dismissBanner()", () => {
    dismissBanner();
    expect(bannerDismissed()).toBe(true);
  });
});
