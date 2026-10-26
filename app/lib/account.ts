// When Apple (or Google) withholds an email, the server stores a synthetic
// "<provider>-<subject>@users.pullup.local" address (handleOAuth). It is not
// a real inbox, so it is never shown as the user's email.
const PLACEHOLDER_DOMAIN = "@users.pullup.local";

const providerNames: Record<string, string> = {
  apple: "Apple",
  google: "Google",
};

export function accountEmailLabel(email: string | null | undefined): string {
  if (!email) return "";
  if (!email.toLowerCase().endsWith(PLACEHOLDER_DOMAIN)) return email;
  const provider = providerNames[email.split("-", 1)[0]!.toLowerCase()];
  return provider ? `Signed in with ${provider}` : "Email hidden";
}
