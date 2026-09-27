import * as THREE from 'three';
import { maxAnisotropy } from './anisotropy';

/**
 * Procedurale teksturer tegnet på canvas. De er lyse "detaljekort", som
 * materialets farve ganges på, så samme tekstur kan bruges i alle farver.
 * Vil du bruge rigtige PBR-teksturer, så se README ("Egne teksturer").
 */

type Painter = (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, paint: Painter, srgb = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size, rng(key.length * 7919 + size));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, tex);
  return tex;
}

function grey(v: number, a = 1) {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${c},${c},${c},${a})`;
}

function noise(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, amount: number, count: number, r = 1) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = grey(0.5 + (rnd() - 0.5) * 2, amount);
    ctx.fillRect(rnd() * size, rnd() * size, r, r);
  }
}

export const woodTexture = () =>
  make('wood', 1024, (ctx, S, rnd) => {
    const planks = 8;
    const ph = S / planks;
    for (let i = 0; i < planks; i++) {
      const shift = rnd() * S;
      const base = 0.78 + rnd() * 0.18;
      for (let k = 0; k < 2; k++) {
        const x0 = (shift + k * S) % (S * 2) - S;
        ctx.fillStyle = grey(base);
        ctx.fillRect(x0, i * ph, S, ph);
        // årer
        for (let g = 0; g < 26; g++) {
          const y = i * ph + rnd() * ph;
          ctx.strokeStyle = grey(base - 0.12 - rnd() * 0.1, 0.35);
          ctx.lineWidth = 0.6 + rnd() * 1.6;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          for (let x = 0; x <= S; x += S / 16) ctx.lineTo(x0 + x, y + Math.sin(x * 0.01 + g) * 2 + (rnd() - 0.5) * 1.5);
          ctx.stroke();
        }
        // knaster
        if (rnd() < 0.5) {
          ctx.fillStyle = grey(base - 0.25, 0.4);
          ctx.beginPath();
          ctx.ellipse(x0 + rnd() * S, i * ph + ph / 2, 10 + rnd() * 8, 4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // endestød og fuger
      ctx.fillStyle = grey(0.35, 0.8);
      ctx.fillRect(0, i * ph, S, 2);
      ctx.fillRect(shift % S, i * ph, 2, ph);
    }
  });

export const tilesTexture = () =>
  make('tiles', 512, (ctx, S, rnd) => {
    const n = 2;
    const t = S / n;
    ctx.fillStyle = grey(0.62);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 0.93 + rnd() * 0.06;
        ctx.fillStyle = grey(v);
        ctx.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        noise(ctx, S, rnd, 0.04, 400, 2);
      }
  });

export const concreteTexture = () =>
  make('concrete', 512, (ctx, S, rnd) => {
    ctx.fillStyle = grey(0.86);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const g = ctx.createRadialGradient(rnd() * S, rnd() * S, 0, rnd() * S, rnd() * S, 40 + rnd() * 120);
      g.addColorStop(0, grey(0.7 + rnd() * 0.3, 0.15));
      g.addColorStop(1, grey(0.8, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    noise(ctx, S, rnd, 0.12, 9000, 1.5);
  });

export const carpetTexture = () =>
  make('carpet', 256, (ctx, S, rnd) => {
    ctx.fillStyle = grey(0.85);
    ctx.fillRect(0, 0, S, S);
    noise(ctx, S, rnd, 0.25, 20000, 1);
  });

export const brickTexture = () =>
  make('brick', 512, (ctx, S, rnd) => {
    const rows = 8;
    const rh = S / rows;
    const bw = S / 2;
    ctx.fillStyle = grey(0.92);
    ctx.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c < 3; c++) {
        ctx.fillStyle = grey(0.62 + rnd() * 0.2);
        ctx.fillRect(c * bw + off + 3, r * rh + 3, bw - 6, rh - 6);
      }
    }
    noise(ctx, S, rnd, 0.1, 6000, 2);
  });

export const plasterTexture = () =>
  make('plaster', 512, (ctx, S, rnd) => {
    ctx.fillStyle = grey(0.9);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = grey(0.8 + rnd() * 0.2, 0.08);
      ctx.beginPath();
      ctx.ellipse(rnd() * S, rnd() * S, 10 + rnd() * 30, 4 + rnd() * 12, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    noise(ctx, S, rnd, 0.08, 5000, 1.5);
  });

export const fabricTexture = () =>
  make('fabric', 256, (ctx, S, rnd) => {
    ctx.fillStyle = grey(0.88);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 2) {
      ctx.fillStyle = grey(0.8, 0.25);
      ctx.fillRect(i, 0, 1, S);
      ctx.fillRect(0, i, S, 1);
    }
    noise(ctx, S, rnd, 0.12, 6000, 1);
  });

export const grassTexture = () =>
  make('grass', 512, (ctx, S, rnd) => {
    ctx.fillStyle = grey(0.8);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 30000; i++) {
      ctx.fillStyle = grey(0.6 + rnd() * 0.4, 0.5);
      ctx.fillRect(rnd() * S, rnd() * S, 1, 2 + rnd() * 3);
    }
  });

/** Meter pr. teksturgentagelse. */
export const TEXTURE_SIZE_M: Record<string, number> = {
  wood: 1.6,
  tiles: 0.6,
  concrete: 2.5,
  carpet: 0.8,
  brick: 0.6,
  plaster: 1.5,
  fabric: 0.3,
  grass: 3,
};
