// Asserts the deployed web map actually renders.
//
// Every other check can pass against a map that draws nothing. That is not
// hypothetical: the maplibre 6 upgrade shipped a build whose tile worker was
// never emitted, so the style, sprite and tilejson all loaded, the canvas
// existed, the overlay chrome was in the right place — and not one vector tile
// was ever requested. The page looked fine to HTTP and to the DOM.
//
// So this drives the real origin in a real browser and asserts the one thing
// that was false that day: vector tiles are fetched. Uses the runner's
// preinstalled Chrome rather than downloading a browser.
//
// Usage: WEB_ORIGIN=https://… node scripts/smoke-map.mjs
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const origin = (process.env.WEB_ORIGIN ?? "").replace(/\/$/, "");
if (!origin) {
  console.error("smoke-map: WEB_ORIGIN is required");
  process.exit(2);
}

// GitHub's ubuntu runners ship google-chrome-stable; the macOS path is for
// running this by hand.
const candidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error(`smoke-map: no Chrome found, looked in:\n  ${candidates.join("\n  ")}`);
  process.exit(2);
}

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  // Lower Manhattan, which has seeded courts. Geolocation only decides where
  // the map opens; the assertions below do not depend on any court existing.
  geolocation: { latitude: 40.715, longitude: -73.999 },
  permissions: ["geolocation"],
  locale: "en-US",
});
// Skip first-run onboarding, which otherwise covers the map.
await context.addInitScript(() => {
  try {
    localStorage.setItem("pullup.onboarding_seen_v1", "true");
    localStorage.setItem("pullup.app_banner_dismissed", "true");
  } catch {}
});

const page = await context.newPage();
const pageErrors = [];
let tiles = 0;
let workerContentType = null;

page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("response", (res) => {
  const url = res.url();
  if (/\.pbf(\?|$)/.test(url) && res.ok()) tiles += 1;
  if (url.includes("maplibre-gl-worker")) workerContentType = res.headers()["content-type"] ?? "";
});

let canvases = 0;
try {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The container may be asleep, so the first request can pay a cold start.
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 90_000 });
  canvases = await page.locator("canvas.maplibregl-canvas").count();
  // Tiles stream in after the canvas mounts; poll rather than sleep blindly.
  for (let i = 0; i < 40 && tiles === 0; i += 1) {
    await page.waitForTimeout(1_000);
  }
} catch (err) {
  console.error(`smoke-map: ${err instanceof Error ? err.message : String(err)}`);
}

const markers = await page.locator(".maplibregl-marker").count().catch(() => 0);
await browser.close();

const failures = [];
if (canvases === 0) failures.push("no maplibre canvas mounted");
if (tiles === 0) failures.push("no vector tile was requested — the map rendered nothing");
if (workerContentType && !/javascript/i.test(workerContentType)) {
  failures.push(`tile worker served as ${workerContentType}, not JavaScript`);
}
if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);

console.log(
  `smoke-map: canvas=${canvases} tiles=${tiles} markers=${markers} ` +
    `worker=${workerContentType ?? "not requested"} pageErrors=${pageErrors.length}`,
);

if (failures.length > 0) {
  console.error(`smoke-map FAILED:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("smoke-map: the deployed map renders tiles");
