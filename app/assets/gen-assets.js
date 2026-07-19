// pull-up brand asset generator — titanium/electric design language.
// Renders a metallic electric-blue basketball ("the alloy ball") with dark
// seams on gunmetal, via supersampled SDF rasterization, and encodes PNGs
// with no dependencies beyond node:zlib.
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

// Theme tokens (mirrors lib/theme.ts dark metal + electric accent)
const METAL_TOP = hex("#272D37");
const METAL_BOTTOM = hex("#12151A");
const BALL_TOP = hex("#5B8CFF");
const BALL_BOTTOM = hex("#2453D6");
const SEAM = hex("#0C0E12");
const WHITE = [255, 255, 255];

// ---------- scene ----------
// All geometry in unit coords (y down). Ball centered slightly above middle.
const BALL = { cx: 0.5, cy: 0.48, r: 0.3 };

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

// Renders one pixel of the ball glyph. Returns [r,g,b,alpha01] with alpha 0
// outside the ball. `carveSeams` makes seams transparent instead of painted.
function ballPixel(x, y, ball, aa, { carveSeams = false, mono = false } = {}) {
  const dBall = Math.hypot(x - ball.cx, y - ball.cy) - ball.r;
  const cover = edge(dBall, aa);
  if (cover <= 0) return null;

  const seamHalf = 0.045 * ball.r;
  const dSeam = seamDistance(x, y, ball, seamHalf);
  const seamCover = edge(dSeam, aa);

  if (mono) {
    // White silhouette with seams knocked out (Android monochrome layer).
    return [255, 255, 255, cover * (1 - seamCover)];
  }
  if (carveSeams && seamCover > 0.999) return null;

  // Electric alloy: vertical gradient, darkened rim, soft specular.
  const tGrad = clamp01((y - (ball.cy - ball.r)) / (2 * ball.r));
  let rgb = mix(BALL_TOP, BALL_BOTTOM, tGrad);
  const rimT = clamp01((-dBall / ball.r) / 0.14); // 0 at edge → 1 inward
  const rim = lerp(0.78, 1, rimT);
  rgb = rgb.map((v) => v * rim);
  const dSpec = Math.hypot(x - (ball.cx - 0.34 * ball.r), y - (ball.cy - 0.5 * ball.r));
  const spec = 0.4 * clamp01(1 - dSpec / (0.75 * ball.r)) ** 2;
  rgb = mix(rgb, WHITE, spec);
  if (seamCover > 0) {
    if (carveSeams) return [rgb[0], rgb[1], rgb[2], cover * (1 - seamCover)];
    rgb = mix(rgb, SEAM, seamCover * 0.92);
  }
  return [rgb[0], rgb[1], rgb[2], cover];
}

// Gunmetal backplate with a machined top-edge highlight and a faint
// diagonal brushed sheen.
function metalBackground(x, y) {
  let rgb = mix(METAL_TOP, METAL_BOTTOM, clamp01(y));
  const sheenBand = Math.abs((x + y) / 2 - 0.38);
  rgb = mix(rgb, WHITE, 0.05 * clamp01(1 - sheenBand / 0.28) ** 2);
  if (y < 0.008) rgb = mix(rgb, WHITE, 0.16 * (1 - y / 0.008));
  return rgb;
}

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
const scenes = {
  // App icon: full-bleed gunmetal + alloy ball (OS masks its own corners).
  "icon.png": [1024, (x, y, aa) => {
    const ball = ballPixel(x, y, BALL, aa);
    if (ball && ball[3] > 0.999) return ball;
    const bg = metalBackground(x, y);
    if (!ball) return [bg[0], bg[1], bg[2], 1];
    const t = ball[3];
    return [lerp(bg[0], ball[0], t), lerp(bg[1], ball[1], t), lerp(bg[2], ball[2], t), 1];
  }],
  // Splash logo: glyph only on transparency (splash background color comes
  // from config), ball a touch larger.
  "splash-icon.png": [1024, (x, y, aa) => ballPixel(x, y, { cx: 0.5, cy: 0.5, r: 0.34 }, aa)],
  // Favicon: glyph only, reads at 16px because seams are proportionally bold.
  "favicon.png": [48, (x, y, aa) => ballPixel(x, y, { cx: 0.5, cy: 0.5, r: 0.46 }, aa)],
  // Android adaptive: background layer (pure metal), foreground glyph within
  // the 66% safe zone, monochrome silhouette.
  "android-icon-background.png": [512, (x, y) => {
    const bg = metalBackground(x, y);
    return [bg[0], bg[1], bg[2], 1];
  }],
  "android-icon-foreground.png": [512, (x, y, aa) => ballPixel(x, y, { cx: 0.5, cy: 0.5, r: 0.21 }, aa)],
  "android-icon-monochrome.png": [432, (x, y, aa) => ballPixel(x, y, { cx: 0.5, cy: 0.5, r: 0.3 }, aa, { mono: true })],
};

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: node gen-assets.js <out-dir>");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, [size, scene]] of Object.entries(scenes)) {
  fs.writeFileSync(path.join(outDir, name), render(size, scene));
  console.log(`${name} (${size}x${size})`);
}
