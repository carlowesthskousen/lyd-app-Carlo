import type { Editor } from '../editor';
import type { Vec2 } from '../core/math2d';
import { closestOnSegment, dist } from '../core/math2d';
import type * as THREE from 'three';

export interface SnapResult {
  p: Vec2;
  /** Hvad der blev snappet til. */
  kind: 'node' | 'wall' | 'grid' | 'free';
}

/**
 * Snap til (i prioriteret rækkefølge): eksisterende hjørner, eksisterende vægge, gitter.
 * Snap-afstanden vokser med kameraets højde, så det føles ens tæt på og langt væk.
 */
export function snapBuildPoint(ed: Editor, ndc: THREE.Vector2, free: boolean): SnapResult | null {
  const g = ed.picker.groundPoint(ndc);
  if (!g) return null;
  const p = { x: g.x, z: g.z };
  if (free) return { p, kind: 'free' };
  const doc = ed.store.doc;
  const radius = Math.max(0.15, Math.min(0.6, ed.camera.position.y * 0.025));
  let best: { p: Vec2; d: number } | null = null;
  for (const n of Object.values(doc.nodes)) {
    const d = dist(n, p);
    if (d < radius && (!best || d < best.d)) best = { p: { x: n.x, z: n.z }, d };
  }
  if (best) return { p: best.p, kind: 'node' };
  for (const w of Object.values(doc.walls)) {
    const a = doc.nodes[w.a];
    const b = doc.nodes[w.b];
    const c = closestOnSegment(p, a, b);
    if (c.d < radius * 0.7) {
      // Snap langs væggen til gitteret, målt fra væggens start.
      const L = dist(a, b);
      const step = doc.settings.snapEnabled ? doc.settings.snapStep : 0.01;
      const t = Math.max(0, Math.min(L, Math.round((c.t * L) / step) * step)) / (L || 1);
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, kind: 'wall' };
    }
  }
  if (doc.settings.snapEnabled) return { p: ed.snap(p), kind: 'grid' };
  return { p, kind: 'free' };
}

/** Lås retningen til 0/45/90° fra startpunktet og snap længden. */
export function constrainAngle(ed: Editor, start: Vec2, p: Vec2): Vec2 {
  const dx = p.x - start.x;
  const dz = p.z - start.z;
  const a = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
  let L = Math.hypot(dx, dz);
  const s = ed.store.doc.settings;
  if (s.snapEnabled) L = Math.round(L / s.snapStep) * s.snapStep;
  return { x: start.x + Math.cos(a) * L, z: start.z + Math.sin(a) * L };
}
