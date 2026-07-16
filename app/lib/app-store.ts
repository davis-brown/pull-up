export function storeUrlForUserAgent(
  userAgent: string,
  iosUrl: string,
  androidUrl: string,
): string {
  const safeIos = safeStoreUrl(iosUrl);
  const safeAndroid = safeStoreUrl(androidUrl);
  if (/android/i.test(userAgent)) return safeAndroid || safeIos;
  if (/iPad|iPhone|iPod/i.test(userAgent)) return safeIos || safeAndroid;
  return safeIos || safeAndroid;
}

function safeStoreUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
