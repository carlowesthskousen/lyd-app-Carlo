import type { Opening, ProjectDoc, Wall, WallNode } from '../state/types';
import { uid } from '../state/ids';
import {
  type Vec2,
  add,
  angleOf,
  closestOnSegment,
  dist,
  interiorPoint,
  leftNormal,
  lineIntersect,
  norm,
  scale,
  segmentIntersect,
  signedArea,
  sub,
} from '../core/math2d';

export interface WallFrame {
  a: Vec2;
  b: Vec2;
  /** Enhedsvektor fra a mod b. */
  d: Vec2;
  /** Venstre-normal (side A). */
  n: Vec2;
  length: number;
}

export function wallFrame(doc: ProjectDoc, wall: Wall): WallFrame {
  const a = doc.nodes[wall.a];
  const b = doc.nodes[wall.b];
  const d = norm(sub(b, a));
  return { a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, d, n: leftNormal(d), length: dist(a, b) };
}

/** Hjørnepunkter for en væg efter geringssamling med nabovægge. */
export interface WallCorners {
  /** Side A (+n) ved a. */
  aA: Vec2;
  /** Side B (-n) ved a. */
  aB: Vec2;
  bA: Vec2;
  bB: Vec2;
}

interface Incident {
  wall: Wall;
  dir: Vec2;
  half: number;
  atStart: boolean;
}

export function wallsAtNode(doc: ProjectDoc, nodeId: string): Wall[] {
  return Object.values(doc.walls).filter((w) => w.a === nodeId || w.b === nodeId);
}

/** Beregner geringshjørner for alle vægge. */
export function computeWallCorners(doc: ProjectDoc): Map<string, WallCorners> {
  const byNode = new Map<string, Incident[]>();
  for (const w of Object.values(doc.walls)) {
    const f = wallFrame(doc, w);
    if (f.length < 1e-6) continue;
    const push = (nodeId: string, inc: Incident) => {
      let l = byNode.get(nodeId);
      if (!l) byNode.set(nodeId, (l = []));
      l.push(inc);
    };
    push(w.a, { wall: w, dir: f.d, half: w.thickness / 2, atStart: true });
    push(w.b, { wall: w, dir: scale(f.d, -1), half: w.thickness / 2, atStart: false });
  }

  const result = new Map<string, WallCorners>();
  const get = (id: string) => {
    let c = result.get(id);
    if (!c) {
      c = { aA: { x: 0, z: 0 }, aB: { x: 0, z: 0 }, bA: { x: 0, z: 0 }, bB: { x: 0, z: 0 } };
      result.set(id, c);
    }
    return c;
  };

  for (const [nodeId, list] of byNode) {
    const node = doc.nodes[nodeId];
    const N: Vec2 = { x: node.x, z: node.z };
    list.sort((p, q) => angleOf(p.dir) - angleOf(q.dir));
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const e = list[i];
      const next = list[(i + 1) % count];
      const prev = list[(i - 1 + count) % count];
      const nl = leftNormal(e.dir);
      const leftBase = add(N, scale(nl, e.half));
      const rightBase = add(N, scale(nl, -e.half));
      const miterLimit = Math.max(e.half, next.half, prev.half) * 6;

      let left = leftBase;
      if (next !== e) {
        const p = lineIntersect(leftBase, e.dir, add(N, scale(leftNormal(next.dir), -next.half)), next.dir);
        if (p && dist(p, N) < miterLimit) left = p;
      }
      let right = rightBase;
      if (prev !== e) {
        const p = lineIntersect(rightBase, e.dir, add(N, scale(leftNormal(prev.dir), prev.half)), prev.dir);
        if (p && dist(p, N) < miterLimit) right = p;
      }
      const c = get(e.wall.id);
      if (e.atStart) {
        c.aA = left;
        c.aB = right;
      } else {
        // Set fra b peger venstre-normalen mod side B.
        c.bB = left;
        c.bA = right;
      }
    }
  }
  return result;
}

export interface WallSideRef {
  wallId: string;
  side: 'A' | 'B';
}

export interface Room {
  key: string;
  /** Polygon langs væggenes indersider. */
  polygon: Vec2[];
  /** Polygon langs væggenes midterlinjer. */
  outline: Vec2[];
  area: number;
  labelPoint: Vec2;
  sides: WallSideRef[];
}

/** Finder lukkede rum ved at gennemløbe den plane graf (face traversal). */
export function detectRooms(doc: ProjectDoc, corners = computeWallCorners(doc)): Room[] {
  type Half = { from: string; to: string; wall: Wall };
  const adj = new Map<string, { to: string; wall: Wall; angle: number }[]>();
  for (const w of Object.values(doc.walls)) {
    const a = doc.nodes[w.a];
    const b = doc.nodes[w.b];
    if (!a || !b || dist(a, b) < 1e-6) continue;
    const push = (from: WallNode, to: WallNode) => {
      let l = adj.get(from.id);
      if (!l) adj.set(from.id, (l = []));
      l.push({ to: to.id, wall: w, angle: Math.atan2(to.z - from.z, to.x - from.x) });
    };
    push(a, b);
    push(b, a);
  }
  for (const l of adj.values()) l.sort((p, q) => p.angle - q.angle);

  const visited = new Set<string>();
  const hkey = (h: Half) => `${h.from}>${h.to}>${h.wall.id}`;
  const rooms: Room[] = [];

  for (const [from, list] of adj) {
    for (const start of list) {
      const first: Half = { from, to: start.to, wall: start.wall };
      if (visited.has(hkey(first))) continue;
      const halves: Half[] = [];
      let h = first;
      let guard = 0;
      while (!visited.has(hkey(h)) && guard++ < 10000) {
        visited.add(hkey(h));
        halves.push(h);
        const around = adj.get(h.to)!;
        const idx = around.findIndex((e) => e.to === h.from && e.wall.id === h.wall.id);
        const nx = around[(idx - 1 + around.length) % around.length];
        h = { from: h.to, to: nx.to, wall: nx.wall };
      }
      const outline = halves.map((x) => ({ x: doc.nodes[x.from].x, z: doc.nodes[x.from].z }));
      const outlineArea = signedArea(outline);
      if (outlineArea <= 0.05) continue; // ydre flade eller åben struktur

      const sides: WallSideRef[] = halves.map((x) => ({
        wallId: x.wall.id,
        side: x.wall.a === x.from ? 'A' : 'B',
      }));
      const polygon: Vec2[] = [];
      for (const s of sides) {
        const c = corners.get(s.wallId);
        if (!c) continue;
        // Indersiden ligger til venstre for gennemløbsretningen.
        const pts = s.side === 'A' ? [c.aA, c.bA] : [c.bB, c.aB];
        for (const p of pts) {
          const last = polygon[polygon.length - 1];
          if (!last || dist(last, p) > 1e-4) polygon.push(p);
        }
      }
      if (polygon.length > 2 && dist(polygon[0], polygon[polygon.length - 1]) < 1e-4) polygon.pop();
      const area = Math.abs(signedArea(polygon));
      if (polygon.length < 3 || area < 0.05) continue;
      rooms.push({
        key: [...new Set(sides.map((s) => s.wallId))].sort().join('|'),
        polygon,
        outline,
        area,
        labelPoint: interiorPoint(polygon),
        sides,
      });
    }
  }
  return rooms;
}

// ---------------------------------------------------------------------------
// Redigering af væg-grafen (bruges inde i store.transact).
// ---------------------------------------------------------------------------

const MERGE_EPS = 0.02;

export function findNodeNear(doc: ProjectDoc, p: Vec2, eps = MERGE_EPS): WallNode | null {
  let best: WallNode | null = null;
  let bestD = eps;
  for (const n of Object.values(doc.nodes)) {
    const d = dist(n, p);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function findWallNear(
  doc: ProjectDoc,
  p: Vec2,
  maxDist: number,
): { wall: Wall; t: number; point: Vec2; d: number } | null {
  let best: { wall: Wall; t: number; point: Vec2; d: number } | null = null;
  for (const w of Object.values(doc.walls)) {
    const a = doc.nodes[w.a];
    const b = doc.nodes[w.b];
    const c = closestOnSegment(p, a, b);
    if (c.d <= maxDist && (!best || c.d < best.d)) best = { wall: w, t: c.t, point: c.p, d: c.d };
  }
  return best;
}

export function wallBetween(doc: ProjectDoc, n1: string, n2: string): Wall | undefined {
  return Object.values(doc.walls).find(
    (w) => (w.a === n1 && w.b === n2) || (w.a === n2 && w.b === n1),
  );
}

function createNode(doc: ProjectDoc, p: Vec2): WallNode {
  const n: WallNode = { id: uid('n'), x: round(p.x), z: round(p.z) };
  doc.nodes[n.id] = n;
  return n;
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Deler en væg i punktet p. Returnerer den nye node. Døre/vinduer flyttes med. */
export function splitWall(doc: ProjectDoc, wallId: string, p: Vec2): WallNode {
  const w = doc.walls[wallId];
  const f = wallFrame(doc, w);
  const node = createNode(doc, p);
  const s = dist(f.a, node);
  const w2: Wall = { ...structuredClone(w), id: uid('w'), a: node.id, b: w.b };
  w.b = node.id;
  doc.walls[w2.id] = w2;
  for (const o of Object.values(doc.openings)) {
    if (o.wallId !== wallId) continue;
    if (o.offset > s) {
      o.wallId = w2.id;
      o.offset = o.offset - s;
    }
  }
  return node;
}

/** Finder eller opretter en node i p: genbruger eksisterende noder og deler vægge. */
export function nodeAt(doc: ProjectDoc, p: Vec2): WallNode {
  const existing = findNodeNear(doc, p);
  if (existing) return existing;
  const onWall = findWallNear(doc, p, MERGE_EPS);
  if (onWall && onWall.t > 1e-3 && onWall.t < 1 - 1e-3) return splitWall(doc, onWall.wall.id, onWall.point);
  return createNode(doc, p);
}

export interface WallOptions {
  height: number;
  thickness: number;
  sideA?: Wall['sideA'];
  sideB?: Wall['sideB'];
}

/**
 * Tilføjer en væg fra p1 til p2. Krydsende vægge deles, så grafen forbliver plan,
 * og rum kan findes. Returnerer id'er for de oprettede vægstykker.
 */
export function addWall(doc: ProjectDoc, p1: Vec2, p2: Vec2, opts: WallOptions): string[] {
  if (dist(p1, p2) < 0.05) return [];
  const n1 = nodeAt(doc, p1);
  const n2 = nodeAt(doc, p2);
  if (n1.id === n2.id) return [];

  // Opdel eksisterende vægge, der krydser den nye.
  const stops: { t: number; node: WallNode }[] = [];
  const A = { x: n1.x, z: n1.z };
  const B = { x: n2.x, z: n2.z };
  const L = dist(A, B);
  for (const w of Object.values(doc.walls)) {
    if (w.a === n1.id || w.a === n2.id || w.b === n1.id || w.b === n2.id) continue;
    const a = doc.nodes[w.a];
    const b = doc.nodes[w.b];
    const hit = segmentIntersect(A, B, a, b);
    if (!hit) continue;
    if (hit.t * L < MERGE_EPS || (1 - hit.t) * L < MERGE_EPS) continue;
    const wl = dist(a, b);
    let node: WallNode;
    if (hit.u * wl < MERGE_EPS) node = a;
    else if ((1 - hit.u) * wl < MERGE_EPS) node = b;
    else node = splitWall(doc, w.id, hit.p);
    stops.push({ t: hit.t, node });
  }
  // Eksisterende noder, der ligger på den nye væg.
  for (const n of Object.values(doc.nodes)) {
    if (n.id === n1.id || n.id === n2.id) continue;
    const c = closestOnSegment(n, A, B);
    if (c.d < MERGE_EPS && c.t > 1e-3 && c.t < 1 - 1e-3 && !stops.some((s) => s.node.id === n.id)) {
      stops.push({ t: c.t, node: n });
    }
  }
  stops.sort((p, q) => p.t - q.t);
  const chain = [n1, ...stops.map((s) => s.node), n2];
  const created: string[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    if (a.id === b.id || wallBetween(doc, a.id, b.id)) continue;
    const w: Wall = {
      id: uid('w'),
      a: a.id,
      b: b.id,
      height: opts.height,
      thickness: opts.thickness,
      sideA: structuredClone(opts.sideA ?? { type: 'paint', color: '#f1ede6' }),
      sideB: structuredClone(opts.sideB ?? { type: 'paint', color: '#f1ede6' }),
    };
    doc.walls[w.id] = w;
    created.push(w.id);
  }
  return created;
}

/** Sletter en væg, dens døre/vinduer og noder, der ikke længere bruges. */
export function removeWall(doc: ProjectDoc, wallId: string) {
  const w = doc.walls[wallId];
  if (!w) return;
  delete doc.walls[wallId];
  for (const o of Object.values(doc.openings)) if (o.wallId === wallId) delete doc.openings[o.id];
  for (const nid of [w.a, w.b]) {
    if (!Object.values(doc.walls).some((x) => x.a === nid || x.b === nid)) delete doc.nodes[nid];
  }
}

/** Tjekker om en dør/et vindue kan være på væggen uden at overlappe andre. */
export function openingFits(
  doc: ProjectDoc,
  wallId: string,
  o: Pick<Opening, 'offset' | 'width' | 'height' | 'sill'>,
  ignoreId?: string,
): boolean {
  const w = doc.walls[wallId];
  if (!w) return false;
  const f = wallFrame(doc, w);
  const margin = 0.05;
  if (o.offset - o.width / 2 < margin || o.offset + o.width / 2 > f.length - margin) return false;
  if (o.sill + o.height > w.height - 0.02) return false;
  for (const other of Object.values(doc.openings)) {
    if (other.wallId !== wallId || other.id === ignoreId) continue;
    if (Math.abs(other.offset - o.offset) < (other.width + o.width) / 2 + 0.05) return false;
  }
  return true;
}

export function roomForPoint(rooms: Room[], p: Vec2, pip: (p: Vec2, poly: Vec2[]) => boolean): Room | undefined {
  // Mindste rum først, så indlejrede rum vinder.
  return [...rooms].sort((a, b) => a.area - b.area).find((r) => pip(p, r.polygon));
}

/** Væggen nærmest et punkt. */
export function closestWall(doc: ProjectDoc, p: Vec2): Wall | null {
  return findWallNear(doc, p, Infinity)?.wall ?? null;
}
