/**
 * Genererer en sømløs PBR-tekstur af hvidpigmenteret ask (albedo, normal, roughness)
 * til public/models/textures/ask-hvidpigmenteret/.
 *
 *   node tools/generate-ash-texture.mjs
 *
 * Kræver Playwright/Chromium (teksturen tegnes på et canvas i en headless browser).
 * Teksturen er procedural (lavet til dette projekt) og kan frit bruges.
 * Én tekstur-flade svarer til 40 × 40 cm træ; årerne løber lodret (langs V).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const OUT = path.resolve('public/models/textures/ask-hvidpigmenteret');
const SIZE = 1024;

function generate(SIZE) {
  // ---------- sømløs værdi-støj (hash-baseret, periodisk) ----------
  function makeNoise(seed) {
    const hash = (a, b) => {
      let h = (a * 374761393 + b * 668265263 + seed * 144269504) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    return (x, y, px, py) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const g = (a, b) => hash(((a % px) + px) % px, ((b % py) + py) % py);
      const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  const n1 = makeNoise(11), n2 = makeNoise(29), n3 = makeNoise(47), n4 = makeNoise(83), n5 = makeNoise(131);
  const fbm = (n, x, y, px, py, oct) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * n(x * f, y * f, px * f, py * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const N = SIZE * SIZE;
  const height = new Float32Array(N);
  const albedo = new Float32Array(N * 3);
  const rough = new Float32Array(N);
  const RINGS = 22; // årringe over 40 cm (ask vokser ~1,5–2 cm/år)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      // Lige årer med blød, uregelmæssig bugtning (rift/kvartskåret ask, som i bøjede stoledele)
      const warp = (fbm(n1, u * 2, v * 3, 2, 3, 5) - 0.5) * 1.5 + (fbm(n2, u * 5, v * 2, 5, 2, 3) - 0.5) * 0.6;
      // Varierende tilvækst: nogle år er brede, andre smalle
      const growth = (fbm(n5, u * 7, v * 1, 7, 1, 2) - 0.5) * 1.2;
      const r = u * RINGS + warp + growth;
      const f = r - Math.floor(r);
      const ringId = Math.floor(r);
      const ringTone = ((ringId * 7919) % 13) / 13 - 0.5; // hver årring har sin egen tone
      // Ringporøs ask: bånd af store porer i vårveddet, tæt sommerved derefter
      const early = smooth(0.0, 0.05, f) * (1 - smooth(0.13, 0.3, f));
      const late = smooth(0.4, 0.97, f);
      // Aflange porer (strakt langs årerne)
      const pore = fbm(n4, u * 160, v * 12, 160, 12, 2);
      const pores = early * smooth(0.5, 0.64, pore);
      const fine = fbm(n3, u * 380, v * 30, 380, 30, 1);
      const finePores = smooth(0.6, 0.72, fine) * 0.35 * (0.35 + early);
      const cellNoise = fbm(n3, u * 50, v * 6, 50, 6, 3) - 0.5;
      const i = y * SIZE + x;

      // Højde: porer er fordybninger, sommerveddet er en anelse hævet
      height[i] = -pores * 0.9 - finePores * 0.5 - early * 0.18 + late * 0.06 + cellNoise * 0.06;

      // Farve: lys ask med hvid pigmentering
      const base = [0.915, 0.878, 0.815];
      const band = [0.79, 0.73, 0.64];
      const w = early * 0.7 + late * 0.18 + ringTone * 0.12 + cellNoise * 0.14;
      let rr = base[0] + (band[0] - base[0]) * w;
      let gg = base[1] + (band[1] - base[1]) * w;
      let bb = base[2] + (band[2] - base[2]) * w;
      // Det hvide pigment sætter sig i porerne og gør dem lysere og en anelse kølige
      const pig = pores * 0.6 + finePores * 0.3;
      rr += (0.955 - rr) * pig;
      gg += (0.948 - gg) * pig;
      bb += (0.93 - bb) * pig;
      // Svage marvstråler (små, tværgående glimt)
      const ray = smooth(0.8, 0.95, fbm(n2, u * 300, v * 60, 300, 60, 1)) * 0.03;
      rr += ray; gg += ray; bb += ray;
      albedo[i * 3] = rr; albedo[i * 3 + 1] = gg; albedo[i * 3 + 2] = bb;

      // Roughness: olieret/pigmenteret overflade, porer lidt mere matte
      rough[i] = 0.52 + pores * 0.2 + finePores * 0.1 + cellNoise * 0.05 + early * 0.05;
    }
  }

  const toCanvas = (fill) => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < N; i++) fill(i, img.data, i * 4);
    ctx.putImageData(img, 0, 0);
    return c;
  };
  const srgb = (c) => {
    c = Math.min(1, Math.max(0, c));
    return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
  };
  // Albedo er beregnet lineært → konvertér til sRGB
  const aC = toCanvas((i, d, o) => {
    d[o] = srgb(Math.pow(albedo[i * 3], 2.2));
    d[o + 1] = srgb(Math.pow(albedo[i * 3 + 1], 2.2));
    d[o + 2] = srgb(Math.pow(albedo[i * 3 + 2], 2.2));
    d[o + 3] = 255;
  });
  // Normal-map (OpenGL-konvention, +Y op) fra højdefeltet med sømløs Sobel
  const H = (x, y) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  const strength = 2.2;
  const nC = toCanvas((i, d, o) => {
    const x = i % SIZE, y = (i / SIZE) | 0;
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * strength;
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    d[o] = Math.round((nx * 0.5 + 0.5) * 255);
    d[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    d[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    d[o + 3] = 255;
  });
  const rC = toCanvas((i, d, o) => {
    const g = Math.round(Math.min(1, Math.max(0, rough[i])) * 255);
    d[o] = d[o + 1] = d[o + 2] = g;
    d[o + 3] = 255;
  });
  return {
    albedo: aC.toDataURL('image/jpeg', 0.9),
    normal: nC.toDataURL('image/png'),
    roughness: rC.toDataURL('image/jpeg', 0.9),
  };
}

const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(generate, SIZE);
await browser.close();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, url] of Object.entries(out)) {
  const ext = url.startsWith('data:image/png') ? 'png' : 'jpg';
  const file = path.join(OUT, `${name}.${ext}`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('skrev', path.relative(process.cwd(), file), fs.statSync(file).size, 'bytes');
}
