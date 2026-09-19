// Ships MapLibre's tile worker alongside the web export.
//
// MapLibre 6 loads its worker as a separate ES module, resolved relative to
// its own file via import.meta.url. Metro renames that file on export and
// never emits the worker, so the default URL falls through to the SPA's
// index.html and the map renders no tiles. CourtMap.web.tsx points
// setWorkerUrl() at the copy written here.
//
// The path carries the MapLibre version so a cached worker can never pair
// with a main bundle from a different release — the two share an internal
// chunk whose exports change between versions.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(appDir, "package.json"));
const { version } = require("maplibre-gl/package.json");
const srcDir = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
const outDir = join(appDir, "dist", "maplibre", version);

// The worker imports the shared chunk as a sibling, so both must be copied.
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (!existsSync(join(appDir, "dist"))) {
  console.error("copy-maplibre-worker: dist/ not found — run expo export first");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const src = join(srcDir, file);
  if (!existsSync(src)) {
    console.error(`copy-maplibre-worker: ${src} missing — has maplibre-gl changed its layout?`);
    process.exit(1);
  }
  copyFileSync(src, join(outDir, file));
}
process.stdout.write(`copy-maplibre-worker: shipped maplibre-gl ${version} worker to dist/maplibre/${version}/\n`);
