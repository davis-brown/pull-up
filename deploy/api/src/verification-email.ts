// Pure email bodies for the auth flows, kept out of index.ts so they can be
// tested without the Workers runtime.

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

// The code is typed into the app that asked for it; there is deliberately no
// link, so opening this email on another device can't finish someone else's
// sign-up.
export function verificationCodeEmail(code: string, expires: string, nowMs = Date.now()): EmailContent {
  const minutes = Math.max(1, Math.round((Date.parse(expires) - nowMs) / 60_000));
  const expiry = `This code expires in ${minutes} minutes. If you didn't just sign up for pull-up, ignore this email.`;
  return {
    subject: `${code} is your pull-up code`,
    text: [
      "Your pull-up verification code",
      "",
      code,
      "",
      "Enter it in the app to finish creating your account.",
      expiry,
    ].join("\n"),
    html: [
      "<h1>Your pull-up verification code</h1>",
      `<p style="font-size:32px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>`,
      "<p>Enter it in the app to finish creating your account.</p>",
      `<p>${escapeHtml(expiry)}</p>`,
    ].join(""),
  };
}

export function existingAccountEmail(loginUrl: string): EmailContent {
  const lines = [
    "Someone tried to create a pull-up account with this email address, but you already have one.",
    "If it was you, sign in instead (with your password, or with Google or Apple if that's how you joined).",
    "If it wasn't you, you can ignore this email. Nothing about your account changed.",
  ];
  return {
    subject: "You already have a pull-up account",
    text: [...lines, "", loginUrl].join("\n\n"),
    html: [
      ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
      `<p><a href="${escapeHtml(loginUrl)}">Sign in</a></p>`,
    ].join(""),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
