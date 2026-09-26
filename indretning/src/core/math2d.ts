/** 2D-geometri i gulvplanet (x, z). */
export interface Vec2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.z * b.z;
export const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, z: a.z / l };
};
/** Venstre-normal (+90° i x/z-planet). */
export const leftNormal = (d: Vec2): Vec2 => ({ x: -d.z, z: d.x });
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Skæring mellem to uendelige linjer p + s·d. Returnerer null ved parallelle linjer. */
export function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-6) return null;
  const s = cross(sub(p2, p1), d2) / den;
  return add(p1, scale(d1, s));
}

/** Skæring mellem to linjestykker. Returnerer parametre (t på ab, u på cd) eller null. */
export function segmentIntersect(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { t: number; u: number; p: Vec2 } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: add(a, scale(r, t)) };
}

/** Nærmeste punkt på linjestykket ab og parameteren t ∈ [0,1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; p: Vec2; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, scale(ab, t));
  return { t, p: q, d: dist(p, q) };
}

/** Signeret areal (positivt for mod uret i matematisk x/z-orientering). */
export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.z - q.x * p.z;
  }
  return s / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), v2(0, 0));
    return scale(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * A), z: cz / (6 * A) };
}

/** Et punkt der garanteret ligger inde i polygonen – godt til labels. */
export function interiorPoint(poly: Vec2[]): Vec2 {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  let best = poly[0];
  let bestD = -1;
  const N = 16;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p = v2(minX + ((maxX - minX) * i) / N, minZ + ((maxZ - minZ) * j) / N);
      if (!pointInPolygon(p, poly)) continue;
      let d = Infinity;
      for (let k = 0; k < poly.length; k++) {
        d = Math.min(d, closestOnSegment(p, poly[k], poly[(k + 1) % poly.length]).d);
      }
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

export const snapTo = (v: number, step: number) => Math.round(v / step) * step;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const angleOf = (d: Vec2) => Math.atan2(d.z, d.x);
