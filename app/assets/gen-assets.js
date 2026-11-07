// RallyFlare brand asset generator. Renders the mark (a violet ball with a
// gold flare) via supersampled SDF rasterization, and encodes PNGs with no
// dependencies beyond node:zlib.
// Usage: node assets/gen-assets.js assets
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// ---------- PNG encoding ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- color helpers ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// smooth edge: coverage 1 inside, 0 outside, feathered over `aa`
const edge = (d, aa) => clamp01(0.5 - d / aa);

// Theme tokens (mirrors lib/theme.ts: dark background, electric violet
// accent, flare gold secondary accent).
const BG_TOP = hex("#241F45");
const BG_BOTTOM = hex("#120F22");
const BALL_TOP = hex("#7A5CFF");
const BALL_BOTTOM = hex("#4A2CD8");
const SEAM = hex("#161326");
const GOLD_TOP = hex("#FFE08A");
const GOLD_BOTTOM = hex("#F5A70F");
const GOLD_CORE = hex("#FFF7DC");
const WHITE = [255, 255, 255];

// ---------- scene ----------
// The mark: a violet ball with a gold four-point flare breaking its upper
// right edge, separated by a knocked-out gap. Geometry is in "mark units"
// centered on the origin (spans roughly -0.46..0.46); `place` maps a unit
// pixel coordinate into mark units for a given center and scale.
const BALL = { cx: -0.08, cy: 0.08, r: 0.38 };
const STAR = { cx: BALL.cx + 0.75 * BALL.r, cy: BALL.cy - 0.75 * BALL.r, R: 0.25 };
const STAR_P = 0.6; // superellipse exponent < 1 gives concave, pinched sides
const GAP_SCALE = 1.2; // knockout around the flare: the flare scaled up

const place = (x, y, at) => [(x - at.cx) / at.s, (y - at.cy) / at.s];

// Signed distance to the seam pattern (classic basketball: vertical +
// horizontal great circles and two side arcs), negative inside a seam stroke.
function seamDistance(x, y, ball, halfWidth) {
  const dv = Math.abs(x - ball.cx);
  const dh = Math.abs(y - ball.cy);
  const arcR = 1.15 * ball.r;
  const arcOff = 1.62 * ball.r;
  const dLeft = Math.abs(Math.hypot(x - (ball.cx - arcOff), y - ball.cy) - arcR);
  const dRight = Math.abs(Math.hypot(x - (ball.cx + arcOff), y - ball.cy) - arcR);
  return Math.min(dv, dh, dLeft, dRight) - halfWidth;
}

// Approximate signed distance to the flare (first-order: f / |grad f|).
// Not a true offset, so the knockout uses a scaled flare (R) instead of d - gap.
function starDistance(x, y, R = STAR.R) {
  const u = Math.max(Math.abs(x - STAR.cx) / R, 1e-6);
  const v = Math.max(Math.abs(y - STAR.cy) / R, 1e-6);
  const f = u ** STAR_P + v ** STAR_P - 1;
  const gu = STAR_P * u ** (STAR_P - 1);
  const gv = STAR_P * v ** (STAR_P - 1);
  return (f / Math.hypot(gu, gv)) * R;
}

// "Over" compositing of straight-alpha [r,g,b,a] colors (null = empty).
function over(top, bottom) {
  if (!top || top[3] <= 0) return bottom;
  if (!bottom || bottom[3] <= 0) return top;
  const a = top[3] + bottom[3] * (1 - top[3]);
  const ch = (i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
  return [ch(0), ch(1), ch(2), a];
}

// One pixel of the mark in mark units. `aa` is the feather in mark units.
// mono renders a white silhouette (Android monochrome layer).
function markPixel(x, y, aa, { mono = false } = {}) {
  const dStar = starDistance(x, y);
  const starCover = edge(dStar, aa);
  const gapCover = edge(starDistance(x, y, STAR.R * GAP_SCALE), aa);

  let ball = null;
  const dBall = Math.hypot(x - BALL.cx, y - BALL.cy) - BALL.r;
  const ballCover = edge(dBall, aa) * (1 - gapCover);
  if (ballCover > 0) {
    const seamCover = edge(seamDistance(x, y, BALL, 0.045 * BALL.r), aa);
    if (mono) {
      ball = [255, 255, 255, ballCover * (1 - seamCover)];
    } else {
      // Vertical gradient, darkened rim, soft specular, painted seams.
      let rgb = mix(BALL_TOP, BALL_BOTTOM, clamp01((y - (BALL.cy - BALL.r)) / (2 * BALL.r)));
      const rim = lerp(0.8, 1, clamp01(-dBall / BALL.r / 0.14));
      rgb = rgb.map((c) => c * rim);
      const dSpec = Math.hypot(x - (BALL.cx - 0.34 * BALL.r), y - (BALL.cy - 0.5 * BALL.r));
      rgb = mix(rgb, WHITE, 0.32 * clamp01(1 - dSpec / (0.75 * BALL.r)) ** 2);
      rgb = mix(rgb, SEAM, seamCover * 0.92);
      ball = [rgb[0], rgb[1], rgb[2], ballCover];
    }
  }

  let star = null;
  if (starCover > 0) {
    if (mono) {
      star = [255, 255, 255, starCover];
    } else {
      let rgb = mix(GOLD_TOP, GOLD_BOTTOM, clamp01((y - (STAR.cy - STAR.R)) / (2 * STAR.R)));
      const core = Math.hypot(x - STAR.cx, y - STAR.cy) / (0.35 * STAR.R);
      rgb = mix(rgb, GOLD_CORE, 0.85 * clamp01(1 - core) ** 2);
      star = [rgb[0], rgb[1], rgb[2], starCover];
    }
  }
  return over(star, ball);
}

// Deep indigo backplate with a faint gold bloom behind the flare.
function background(x, y, at) {
  let rgb = mix(BG_TOP, BG_BOTTOM, clamp01(y));
  const [mx, my] = place(x, y, at);
  const bloom = Math.exp(-Math.hypot(mx - STAR.cx, my - STAR.cy) / (0.9 * STAR.R));
  rgb = mix(rgb, GOLD_BOTTOM, 0.22 * bloom);
  return [rgb[0], rgb[1], rgb[2], 1];
}

const glyph = (at, opts) => (x, y, aa) => {
  const [mx, my] = place(x, y, at);
  return markPixel(mx, my, aa / at.s, opts);
};

// ---------- rasterizer ----------
// scene(x, y, aa) -> [r,g,b,alpha01] | null, in unit coords
function render(size, scene, supersample = 3) {
  const S = size * supersample;
  const out = Buffer.alloc(size * size * 4);
  const aa = 1.2 / S;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const x = (px * supersample + sx + 0.5) / S;
          const y = (py * supersample + sy + 0.5) / S;
          const c = scene(x, y, aa);
          if (c) {
            const [cr, cg, cb, ca] = c;
            r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
          }
        }
      }
      const n = supersample * supersample;
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return encodePNG(size, size, out);
}

// ---------- compositions ----------
const ICON_AT = { cx: 0.5, cy: 0.5, s: 0.66 };
const scenes = {
  // App icon: full-bleed backplate + mark (OS masks its own corners).
  "icon.png": [1024, (x, y, aa) => over(glyph(ICON_AT)(x, y, aa), background(x, y, ICON_AT))],
  // Splash logo: mark only on transparency (background color comes from config).
  "splash-icon.png": [1024, glyph({ cx: 0.5, cy: 0.5, s: 0.8 })],
  // Favicon: mark only, nearly full-bleed so it reads at 16px.
  "favicon.png": [48, glyph({ cx: 0.5, cy: 0.5, s: 1.0 })],
  // Android adaptive: backplate layer, mark within the 66% safe zone,
  // monochrome silhouette.
  "android-icon-background.png": [512, (x, y) => background(x, y, { cx: 0.5, cy: 0.5, s: 0.6 })],
  "android-icon-foreground.png": [512, glyph({ cx: 0.5, cy: 0.5, s: 0.6 })],
  "android-icon-monochrome.png": [432, glyph({ cx: 0.5, cy: 0.5, s: 0.7 }, { mono: true })],
};

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: node gen-assets.js <out-dir>");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, [size, scene]] of Object.entries(scenes)) {
  fs.writeFileSync(path.join(outDir, name), render(size, scene));
  console.log(`${name} (${size}x${size})`);
}
