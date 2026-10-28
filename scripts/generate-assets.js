#!/usr/bin/env node
/**
 * Generates every bitmap the app ships with, so the demo works offline and
 * needs no external image CDN:
 *
 *   public/images/placeholder.png   - shown when a linked image is broken
 *   public/images/avatar-fallback.png - shown when an avatar fails to load
 *   public/images/avatars/*.png     - seeded user avatars
 *   public/images/samples/*.png     - seeded wall images (varied heights)
 *
 * Pure Node, no dependencies: a tiny PNG encoder over zlib.
 *
 *   node scripts/generate-assets.js           # always regenerate
 *   node scripts/generate-assets.js --if-missing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const IMAGES = path.join(ROOT, 'public', 'images');

const argv = process.argv.slice(2);
const ifMissing = argv.includes('--if-missing');

// ---------------------------------------------------------------- PNG codec

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer of width*height*4 bytes */
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ canvas

function hex(color) {
  const c = color.replace('#', '');
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
    255,
  ];
}

function createCanvas(width, height, bg) {
  const px = Buffer.alloc(width * height * 4);
  const [r, g, b] = hex(bg);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }

  const api = {
    width,
    height,
    px,
    set(x, y, [r, g, b, a = 255]) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      if (a === 255) {
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = 255;
      } else {
        const al = a / 255;
        px[i] = Math.round(r * al + px[i] * (1 - al));
        px[i + 1] = Math.round(g * al + px[i + 1] * (1 - al));
        px[i + 2] = Math.round(b * al + px[i + 2] * (1 - al));
        px[i + 3] = 255;
      }
    },
    rect(x, y, w, h, color) {
      const c = hex(color);
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) api.set(xx, yy, c);
    },
    strokeRect(x, y, w, h, t, color) {
      api.rect(x, y, w, t, color);
      api.rect(x, y + h - t, w, t, color);
      api.rect(x, y, t, h, color);
      api.rect(x + w - t, y, t, h, color);
    },
    circle(cx, cy, r, color, alpha = 255) {
      const c = hex(color);
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= r) api.set(x, y, [c[0], c[1], c[2], d > r - 1.2 ? Math.round(alpha * (r - d) / 1.2) : alpha]);
        }
      }
    },
    /** filled triangle via barycentric fill */
    tri(x1, y1, x2, y2, x3, y3, color) {
      const c = hex(color);
      const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(x1, x2, x3)));
      const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(y1, y2, y3)));
      const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      if (!denom) return;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const w1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denom;
          const w2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denom;
          const w3 = 1 - w1 - w2;
          if (w1 >= 0 && w2 >= 0 && w3 >= 0) api.set(x, y, c);
        }
      }
    },
    /** smooth vertical gradient with a few soft blobs for a photographic feel */
    gradient(top, bottom, seed = 1) {
      const a = hex(top);
      const b = hex(bottom);
      for (let y = 0; y < height; y++) {
        const t = y / (height - 1 || 1);
        const r = Math.round(a[0] + (b[0] - a[0]) * t);
        const g = Math.round(a[1] + (b[1] - a[1]) * t);
        const bl = Math.round(a[2] + (b[2] - a[2]) * t);
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          px[i] = r;
          px[i + 1] = g;
          px[i + 2] = bl;
          px[i + 3] = 255;
        }
      }
      let s = seed * 9301 + 49297;
      const rand = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
      for (let i = 0; i < 5; i++) {
        api.circle(
          rand() * width,
          rand() * height,
          (0.15 + rand() * 0.35) * Math.min(width, height),
          top,
          40
        );
      }
    },
    outline(color, thickness = 6) {
      api.strokeRect(0, 0, width, height, thickness, color);
    },
    encode() {
      return encodePNG(width, height, px);
    },
  };
  return api;
}

// ------------------------------------------------------------ asset recipes

function writeIfWanted(file, buffer, force) {
  if (!force && fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return true;
}

function placeholder() {
  const c = createCanvas(480, 360, '#efece7');
  // frame
  c.strokeRect(24, 24, 432, 312, 4, '#d9d3ca');
  // sun
  c.circle(360, 118, 34, '#e2445c', 235);
  // mountains
  c.tri(60, 300, 190, 140, 320, 300, '#c9c1b6');
  c.tri(190, 300, 320, 175, 445, 300, '#b7afa4');
  c.rect(24, 300, 432, 36, '#c9c1b6');
  // baseline rule so the tile reads as "image missing" rather than "image"
  c.rect(150, 330, 180, 6, '#d9d3ca');
  c.outline('#e4dfd7', 8);
  return c.encode();
}

function avatarFallback() {
  const c = createCanvas(96, 96, '#efece7');
  c.circle(48, 38, 18, '#c9c1b6');
  c.circle(48, 92, 34, '#c9c1b6');
  return c.encode();
}

function avatar(top, bottom, seed) {
  const c = createCanvas(128, 128, top);
  c.gradient(top, bottom, seed);
  c.circle(64, 46, 26, '#ffffff', 70);
  c.circle(64, 118, 46, '#ffffff', 60);
  return c.encode();
}

const SAMPLES = [
  { file: 'sample-01.png', w: 480, h: 640, top: '#f7b733', bottom: '#fc4a1a' },
  { file: 'sample-02.png', w: 480, h: 360, top: '#43cea2', bottom: '#185a9d' },
  { file: 'sample-03.png', w: 480, h: 540, top: '#b24592', bottom: '#f15f79' },
  { file: 'sample-04.png', w: 480, h: 720, top: '#1f4037', bottom: '#99f2c8' },
  { file: 'sample-05.png', w: 480, h: 400, top: '#2c3e50', bottom: '#4ca1af' },
  { file: 'sample-06.png', w: 480, h: 600, top: '#ff9966', bottom: '#ff5e62' },
  { file: 'sample-07.png', w: 480, h: 380, top: '#654ea3', bottom: '#eaafc8' },
  { file: 'sample-08.png', w: 480, h: 560, top: '#0f2027', bottom: '#2c5364' },
  { file: 'sample-09.png', w: 480, h: 460, top: '#f2994a', bottom: '#f2c94c' },
];

function sample({ w, h, top, bottom }, seed) {
  const c = createCanvas(w, h, top);
  c.gradient(top, bottom, seed);
  // a couple of geometric motifs so the tiles read as "photos"
  const kind = seed % 3;
  if (kind === 0) {
    c.circle(w * 0.7, h * 0.28, Math.min(w, h) * 0.16, '#ffffff', 90);
    c.tri(w * 0.1, h * 0.9, w * 0.45, h * 0.45, w * 0.8, h * 0.9, '#000000');
    c.tri(w * 0.1, h * 0.9, w * 0.45, h * 0.45, w * 0.8, h * 0.9, '#ffffff');
  } else if (kind === 1) {
    for (let i = 0; i < 5; i++) {
      c.rect(w * 0.1, h * (0.2 + i * 0.13), w * 0.8 * ((i % 2) + 1) * 0.5, h * 0.05, '#ffffff');
    }
  } else {
    const step = Math.round(Math.min(w, h) / 9);
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        if ((x / step + y / step) % 2 === 0) c.circle(x, y, step * 0.34, '#ffffff', 120);
      }
    }
  }
  c.outline('#ffffff', 6);
  return c.encode();
}

// -------------------------------------------------------------------- main

function main() {
  const force = !ifMissing;
  const existing = fs.existsSync(IMAGES);
  if (ifMissing && existing) {
    const needed = ['placeholder.png', 'avatar-fallback.png'].some(
      (f) => !fs.existsSync(path.join(IMAGES, f))
    );
    if (!needed) {
      console.log('assets up to date');
      return;
    }
  }

  let written = 0;
  written += writeIfWanted(path.join(IMAGES, 'placeholder.png'), placeholder(), force) ? 1 : 0;
  written += writeIfWanted(path.join(IMAGES, 'avatar-fallback.png'), avatarFallback(), force) ? 1 : 0;

  const avatars = [
    ['avatar-01.png', '#e8455c', '#7b1f36', 3],
    ['avatar-02.png', '#2f9e8f', '#14524b', 7],
    ['avatar-03.png', '#f2994a', '#8a4b12', 11],
    ['avatar-04.png', '#5b6ee1', '#22265e', 13],
  ];
  for (const [file, top, bottom, seed] of avatars) {
    written += writeIfWanted(path.join(IMAGES, 'avatars', file), avatar(top, bottom, seed), force) ? 1 : 0;
  }

  SAMPLES.forEach((s, i) => {
    written += writeIfWanted(path.join(IMAGES, 'samples', s.file), sample(s, i + 1), force) ? 1 : 0;
  });

  console.log(`generated ${written} image asset(s)`);
}

main();
