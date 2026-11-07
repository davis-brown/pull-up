import { accountEmailLabel } from "./account";

describe("accountEmailLabel", () => {
  it("shows a real email unchanged", () => {
    expect(accountEmailLabel("hooper@example.com")).toBe("hooper@example.com");
    expect(accountEmailLabel("abc@privaterelay.appleid.com")).toBe("abc@privaterelay.appleid.com");
    expect(accountEmailLabel("abc@private.icloud.com")).toBe("abc@private.icloud.com");
  });

  it("replaces the server's placeholder with the provider name", () => {
    expect(accountEmailLabel("apple-001234.abcd.0987@users.rallyflare.local")).toBe("Signed in with Apple");
    expect(accountEmailLabel("google-1234567890@users.rallyflare.local")).toBe("Signed in with Google");
    expect(accountEmailLabel("Apple-001234@USERS.RALLYFLARE.LOCAL")).toBe("Signed in with Apple");
  });

  it("hides placeholders from an unknown provider", () => {
    expect(accountEmailLabel("other-1@users.rallyflare.local")).toBe("Email hidden");
  });

  it("returns empty for a missing email", () => {
    expect(accountEmailLabel(undefined)).toBe("");
    expect(accountEmailLabel(null)).toBe("");
    expect(accountEmailLabel("")).toBe("");
  });
});
