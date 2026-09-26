import type { FurnitureItem, ProjectDoc } from '../state/types';
import type { CatalogEntry } from './catalog';
import { dimsMeters } from './catalog';
import { type Vec2, dot, sub } from '../core/math2d';
import { wallFrame } from '../building/wallGraph';

/** Orienteret rektangel (fodaftryk) med højdeinterval. */
export interface OBB {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  rot: number;
  y0: number;
  y1: number;
}

export function itemOBB(item: Pick<FurnitureItem, 'x' | 'y' | 'z' | 'rotation'>, entry: CatalogEntry): OBB {
  const { w, d, h } = dimsMeters(entry);
  return { cx: item.x, cz: item.z, hw: w / 2, hd: d / 2, rot: item.rotation, y0: item.y, y1: item.y + h };
}

function axes(o: OBB): Vec2[] {
  // Lokal x = (cos, -sin), lokal z = (sin, cos) for rotation.y = rot
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return [
    { x: c, z: -s },
    { x: s, z: c },
  ];
}

function corners(o: OBB): Vec2[] {
  const [ax, az] = axes(o);
  const pts: Vec2[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      pts.push({ x: o.cx + ax.x * o.hw * sx + az.x * o.hd * sz, z: o.cz + ax.z * o.hw * sx + az.z * o.hd * sz });
  return pts;
}

/** Separating Axis Theorem i 2D + overlap i højden. */
export function obbOverlap(a: OBB, b: OBB, tolerance = 0.01): boolean {
  if (a.y1 <= b.y0 + tolerance || b.y1 <= a.y0 + tolerance) return false;
  const ca = corners(a);
  const cb = corners(b);
  for (const axis of [...axes(a), ...axes(b)]) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of ca) {
      const v = dot(p, axis);
      minA = Math.min(minA, v);
      maxA = Math.max(maxA, v);
    }
    for (const p of cb) {
      const v = dot(p, axis);
      minB = Math.min(minB, v);
      maxB = Math.max(maxB, v);
    }
    if (maxA <= minB + tolerance || maxB <= minA + tolerance) return false;
  }
  return true;
}

/** Tynde ting som tæpper kolliderer ikke – man stiller møbler ovenpå dem. */
export const collides = (e: CatalogEntry) => e.dimensions.height > 3;

/** Stole må gerne skubbes ind under borde. */
export function mayOverlap(a: CatalogEntry, b: CatalogEntry) {
  const pair = (x: CatalogEntry, y: CatalogEntry) => x.category === 'stole' && y.category === 'borde';
  return pair(a, b) || pair(b, a);
}

/** Id'er på møbler, der overlapper andre møbler eller vægge. */
export function findCollisions(
  doc: ProjectDoc,
  getEntry: (id: string) => CatalogEntry | undefined,
  only?: Set<string>,
): Set<string> {
  const out = new Set<string>();
  const items = Object.values(doc.furniture)
    .map((it) => ({ it, e: getEntry(it.catalogId) }))
    .filter((x): x is { it: FurnitureItem; e: CatalogEntry } => !!x.e && collides(x.e));
  const boxes = items.map((x) => ({ id: x.it.id, obb: itemOBB(x.it, x.e), wall: x.e.placement === 'wall' }));
  const walls = Object.values(doc.walls).map((w) => {
    const f = wallFrame(doc, w);
    return {
      cx: (f.a.x + f.b.x) / 2,
      cz: (f.a.z + f.b.z) / 2,
      hw: f.length / 2,
      hd: w.thickness / 2,
      rot: Math.atan2(-f.d.z, f.d.x),
      y0: 0,
      y1: w.height,
    } satisfies OBB;
  });
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (only && !only.has(a.id) && !only.has(b.id)) continue;
      if (mayOverlap(items[i].e, items[j].e)) continue;
      if (obbOverlap(a.obb, b.obb)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
    if (only && !only.has(a.id)) continue;
    if (!a.wall && walls.some((w) => obbOverlap(a.obb, w, 0.015))) out.add(a.id);
  }
  return out;
}

export interface WallSnap {
  x: number;
  z: number;
  rotation: number;
  wallId: string;
}

/**
 * Finder nærmeste væg og returnerer en placering med ryggen mod væggen.
 * Møblets forside (+z) vender væk fra væggen.
 */
export function snapToWall(doc: ProjectDoc, p: Vec2, depth: number, maxGap: number, width = 0): WallSnap | null {
  let best: (WallSnap & { gap: number }) | null = null;
  for (const w of Object.values(doc.walls)) {
    const f = wallFrame(doc, w);
    if (f.length < 0.2) continue;
    // Punktet skal ligge ud for væggen (ikke ud for dens forlængelse).
    const along = dot(sub(p, f.a), f.d);
    if (along < -0.01 || along > f.length + 0.01) continue;
    const side = Math.sign(dot(sub(p, f.a), f.n)) || 1;
    const perp = Math.abs(dot(sub(p, f.a), f.n));
    const gap = perp - w.thickness / 2 - depth / 2;
    if (gap > maxGap || perp < w.thickness / 2) continue;
    if (best && gap >= best.gap) continue;
    const nx = f.n.x * side;
    const nz = f.n.z * side;
    // Hold møblet inden for væggens længde, hvis muligt.
    const half = Math.min(width / 2, f.length / 2);
    const t = Math.max(half, Math.min(f.length - half, along));
    const base = { x: f.a.x + f.d.x * t, z: f.a.z + f.d.z * t };
    const off = w.thickness / 2 + depth / 2 + 0.004;
    best = {
      x: base.x + nx * off,
      z: base.z + nz * off,
      rotation: Math.atan2(nx, nz),
      wallId: w.id,
      gap,
    };
  }
  if (!best) return null;
  return { x: best.x, z: best.z, rotation: best.rotation, wallId: best.wallId };
}

/** Kolliderer et møbel i en given position med andre møbler eller vægge? */
export function collidesAt(
  doc: ProjectDoc,
  entry: CatalogEntry,
  pose: Pick<FurnitureItem, 'x' | 'y' | 'z' | 'rotation'>,
  excludeId: string | null,
  getEntry: (id: string) => CatalogEntry | undefined,
): boolean {
  if (!collides(entry)) return false;
  const a = itemOBB(pose, entry);
  for (const it of Object.values(doc.furniture)) {
    if (it.id === excludeId) continue;
    const e = getEntry(it.catalogId);
    if (!e || !collides(e) || mayOverlap(entry, e)) continue;
    if (obbOverlap(a, itemOBB(it, e))) return true;
  }
  if (entry.placement === 'wall') return false;
  for (const w of Object.values(doc.walls)) {
    const f = wallFrame(doc, w);
    const wb: OBB = {
      cx: (f.a.x + f.b.x) / 2,
      cz: (f.a.z + f.b.z) / 2,
      hw: f.length / 2,
      hd: w.thickness / 2,
      rot: Math.atan2(-f.d.z, f.d.x),
      y0: 0,
      y1: w.height,
    };
    if (obbOverlap(a, wb, 0.015)) return true;
  }
  return false;
}
