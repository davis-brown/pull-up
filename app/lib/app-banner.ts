// "Get the app" banner dismissal, persisted in web localStorage. Node-safe
// (guards typeof localStorage) so jest can exercise it; the banner component
// only renders on web anyway.
const KEY = "pullup.app_banner_dismissed";

export function bannerDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "true";
}

export function dismissBanner(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, "true");
}
