import { describe, expect, it } from "vitest";

import { existingAccountEmail, verificationCodeEmail } from "./verification-email";

describe("verificationCodeEmail", () => {
  it("shows the code and minutes left, with no link", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    const email = verificationCodeEmail("042917", "2026-10-22T12:15:00Z", now);
    expect(email.subject).toBe("042917 is your pull-up code");
    expect(email.text).toContain("042917");
    expect(email.text).toContain("expires in 15 minutes");
    expect(email.html).not.toContain("<a ");
  });
});

describe("existingAccountEmail", () => {
  it("points the owner at sign-in and escapes the link", () => {
    const email = existingAccountEmail("https://pull-up.test/login?a=1&b=2");
    expect(email.subject).toBe("You already have a pull-up account");
    expect(email.html).toContain('href="https://pull-up.test/login?a=1&amp;b=2"');
  });
});
