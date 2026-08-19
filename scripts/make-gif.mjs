import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { PNG } from "pngjs";
import { GifWriter } from "omggif";

const ROOT = "C:/Users/ojasv/Downloads/fastapi-api-tracker-main";
const SHOTS_DIR = join(ROOT, "docs/screenshots");
const OUT = join(ROOT, "docs/demo.gif");

// Target width for the GIF (scale down from 1422px)
const TARGET_W = 800;
const DELAY_CS = 250; // centiseconds per frame (2.5s)

// Read and decode all PNG screenshots
const files = readdirSync(SHOTS_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

console.log(`Found ${files.length} screenshots`);

if (files.length === 0) {
  console.error("No screenshots found!");
  process.exit(1);
}

// Decode first image to get dimensions
const firstPng = PNG.sync.read(readFileSync(join(SHOTS_DIR, files[0])));
const scale = TARGET_W / firstPng.width;
const TARGET_H = Math.round(firstPng.height * scale);

console.log(`Original: ${firstPng.width}x${firstPng.height}`);
console.log(`GIF: ${TARGET_W}x${TARGET_H} (${Math.round(scale * 100)}% scale)`);

// Helper: resize PNG pixel data (simple nearest-neighbor)
function resizePixels(png, tw, th, sc) {
  const src = png.data;
  const sw = png.width;
  const sh = png.height;
  const out = new Uint8Array(tw * th * 4);

  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(Math.floor(x / sc), sw - 1);
      const sy = Math.min(Math.floor(y / sc), sh - 1);
      const si = (sy * sw + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

// Build a 256-color palette using uniform quantization
function buildPalette(rgba, numColors = 256) {
  const bucketBits = Math.ceil(Math.log2(numColors) / 3); // bits per channel
  const bucketSize = Math.ceil(256 / (1 << bucketBits));
  const seen = new Map();

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = (Math.floor(r / bucketSize) << (bucketBits * 2)) |
                (Math.floor(g / bucketSize) << bucketBits) |
                Math.floor(b / bucketSize);
    if (!seen.has(key)) {
      seen.set(key, [r, g, b]);
    }
  }

  const palette = Array.from(seen.values()).slice(0, numColors);
  // Pad to power of 2
  while (palette.length < 256) palette.push([0, 0, 0]);
  return { palette, bucketSize };
}

function rgbaToIndexed(rgba, palette, bucketSize) {
  const indexed = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < indexed.length; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    let bestIdx = 0, bestDist = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; bestIdx = p; }
      if (dist === 0) break;
    }
    indexed[i] = bestIdx;
  }
  return indexed;
}

// Process all frames
const frames = [];
for (const file of files) {
  console.log(`Processing ${file}...`);
  const png = PNG.sync.read(readFileSync(join(SHOTS_DIR, file)));
  const resized = resizePixels(png, TARGET_W, TARGET_H, scale);
  frames.push(resized);
}

// Build global palette
console.log("Building palette...");
const allPixels = new Uint8Array(TARGET_W * TARGET_H * 4 * frames.length);
for (let f = 0; f < frames.length; f++) {
  allPixels.set(frames[f], f * TARGET_W * TARGET_H * 4);
}
const { palette, bucketSize } = buildPalette(allPixels, 256);
console.log(`Palette: ${palette.length} unique colors`);

// Convert frames to indexed
console.log("Converting frames to indexed color...");
const indexedFrames = frames.map((rgba) => rgbaToIndexed(rgba, palette, bucketSize));

// Write GIF
console.log("Writing GIF...");
const gifBuf = [];
const writer = new GifWriter(gifBuf, TARGET_W, TARGET_H, {
  palette: palette,
  loop: 0,
});

for (let i = 0; i < indexedFrames.length; i++) {
  writer.addFrame(0, 0, TARGET_W, TARGET_H, indexedFrames[i], {
    delay: DELAY_CS,
    disposal: 0,
  });
  console.log(`  + Frame ${i + 1}/${indexedFrames.length}`);
}

writer.end();
writeFileSync(OUT, Buffer.from(gifBuf));
const size = (gifBuf.length / 1024).toFixed(0);
console.log(`\nDone! GIF: ${OUT} (${size} KB)`);
