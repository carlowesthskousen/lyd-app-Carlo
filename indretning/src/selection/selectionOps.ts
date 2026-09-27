import type { FurnitureItem, Group, Opening, PickRef, ProjectDoc, Wall, WallNode } from '../state/types';
import { uid } from '../state/ids';
import { findNodeNear, wallFrame } from '../building/wallGraph';

/**
 * Handlinger på en markering af flere objekter ("bunken"): flyt, drej, kopiér,
 * indsæt og grupper. Rene funktioner på dokumentet, så de kan bruges inde i én
 * transaktion (= én fortryd) og testes uden browser.
 */

export const refKey = (r: PickRef) => `${r.kind}:${r.id}`;
export const sameRef = (a: PickRef, b: PickRef) => a.kind === b.kind && a.id === b.id;

export function refExists(doc: ProjectDoc, r: PickRef): boolean {
  if (r.kind === 'furniture') return !!doc.furniture[r.id];
  if (r.kind === 'wall') return !!doc.walls[r.id];
  if (r.kind === 'opening') return !!doc.openings[r.id];
  return false;
}

export function uniqueRefs(refs: PickRef[]): PickRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = refKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------- grupper

export function groupsOf(doc: ProjectDoc): Group[] {
  return Object.values(doc.groups ?? {});
}

/** Gruppen et objekt er med i (kun grupper med mindst 2 eksisterende medlemmer). */
export function groupFor(doc: ProjectDoc, r: PickRef): Group | undefined {
  return groupsOf(doc).find((g) => g.members.some((m) => sameRef(m, r)) && liveMembers(doc, g).length >= 2);
}

export const liveMembers = (doc: ProjectDoc, g: Group) => g.members.filter((m) => refExists(doc, m));

/** Udvider en markering, så hele grupper kommer med. */
export function expandGroups(doc: ProjectDoc, refs: PickRef[]): PickRef[] {
  const out: PickRef[] = [];
  for (const r of refs) {
    const g = groupFor(doc, r);
    out.push(...(g ? liveMembers(doc, g) : [r]));
  }
  return uniqueRefs(out);
}

/** Er markeringen præcis én gruppe? */
export function exactGroup(doc: ProjectDoc, refs: PickRef[]): Group | undefined {
  if (refs.length < 2) return undefined;
  const g = groupFor(doc, refs[0]);
  if (!g) return undefined;
  const live = liveMembers(doc, g);
  return live.length === refs.length && refs.every((r) => live.some((m) => sameRef(m, r))) ? g : undefined;
}

export function createGroup(doc: ProjectDoc, refs: PickRef[], name: string): Group {
  doc.groups ??= {};
  // Et objekt kan kun være i én gruppe: fjern det fra gamle grupper.
  removeFromGroups(doc, refs);
  const g: Group = { id: uid('g'), name, members: uniqueRefs(refs).map((r) => ({ kind: r.kind, id: r.id })) };
  doc.groups[g.id] = g;
  return g;
}

export function removeFromGroups(doc: ProjectDoc, refs: PickRef[]) {
  for (const g of groupsOf(doc)) {
    g.members = g.members.filter((m) => !refs.some((r) => sameRef(r, m)));
    if (g.members.length < 2) delete doc.groups![g.id];
  }
}

/** Opløser alle grupper, som noget i markeringen er med i. Returnerer antallet. */
export function ungroup(doc: ProjectDoc, refs: PickRef[]): number {
  let n = 0;
  for (const g of groupsOf(doc)) {
    if (g.members.some((m) => refs.some((r) => sameRef(r, m)))) {
      delete doc.groups![g.id];
      n++;
    }
  }
  return n;
}

/** Foreslår et gruppenavn ud fra indholdet, fx "Spisebord 180 med 6 spisestole". */
export function suggestGroupName(doc: ProjectDoc, refs: PickRef[], nameOf: (catalogId: string) => string | undefined): string {
  const counts = new Map<string, number>();
  let walls = 0;
  for (const r of refs) {
    if (r.kind === 'furniture') {
      const n = nameOf(doc.furniture[r.id]?.catalogId ?? '') ?? 'møbel';
      counts.set(n, (counts.get(n) ?? 0) + 1);
    } else if (r.kind === 'wall') walls++;
  }
  const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
  if (!sorted.length) return walls ? `${walls} vægge` : 'Gruppe';
  const [main, ...rest] = sorted;
  const parts = rest.map(([n, c]) => `${c} × ${n.toLowerCase()}`);
  return parts.length ? `${main[0]} med ${parts.join(', ')}` : main[1] > 1 ? `${main[1]} × ${main[0].toLowerCase()}` : main[0];
}

// ---------------------------------------------------------------------------- geometri

/** Noder der hører til markerede vægge. */
export function nodesOf(doc: ProjectDoc, refs: PickRef[]): string[] {
  const ids = new Set<string>();
  for (const r of refs) {
    if (r.kind !== 'wall') continue;
    const w = doc.walls[r.id];
    if (w) ids.add(w.a).add(w.b);
  }
  return [...ids];
}

export function selectionCenter(doc: ProjectDoc, refs: PickRef[]): { x: number; z: number } {
  let x = 0, z = 0, n = 0;
  for (const r of refs) {
    const p = refPosition(doc, r);
    if (p) {
      x += p.x;
      z += p.z;
      n++;
    }
  }
  return n ? { x: x / n, z: z / n } : { x: 0, z: 0 };
}

export function refPosition(doc: ProjectDoc, r: PickRef): { x: number; z: number } | null {
  if (r.kind === 'furniture') {
    const f = doc.furniture[r.id];
    return f ? { x: f.x, z: f.z } : null;
  }
  if (r.kind === 'wall') {
    const w = doc.walls[r.id];
    if (!w) return null;
    const a = doc.nodes[w.a], b = doc.nodes[w.b];
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  }
  if (r.kind === 'opening') {
    const o = doc.openings[r.id];
    const w = o && doc.walls[o.wallId];
    if (!w) return null;
    const f = wallFrame(doc, w);
    return { x: f.a.x + f.d.x * o.offset, z: f.a.z + f.d.z * o.offset };
  }
  return null;
}

/** Udgangspositioner, så en flytning altid regnes fra start (ingen afrundingsdrift). */
export interface MoveSnapshot {
  furniture: Record<string, { x: number; z: number }>;
  nodes: Record<string, { x: number; z: number }>;
  openings: Record<string, number>;
}

export function snapshotFor(doc: ProjectDoc, refs: PickRef[]): MoveSnapshot {
  const s: MoveSnapshot = { furniture: {}, nodes: {}, openings: {} };
  for (const r of refs) if (r.kind === 'furniture' && doc.furniture[r.id]) s.furniture[r.id] = { x: doc.furniture[r.id].x, z: doc.furniture[r.id].z };
  for (const id of nodesOf(doc, refs)) s.nodes[id] = { x: doc.nodes[id].x, z: doc.nodes[id].z };
  const movedWalls = new Set(refs.filter((r) => r.kind === 'wall').map((r) => r.id));
  for (const r of refs) {
    const o = r.kind === 'opening' ? doc.openings[r.id] : undefined;
    if (o && !movedWalls.has(o.wallId)) s.openings[o.id] = o.offset;
  }
  return s;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Flytter bunken (dx, dz) fra udgangspositionerne. Vægge flyttes via deres noder,
 * så døre og vinduer følger med. Løse døre/vinduer glider langs deres væg.
 */
export function translateSnapshot(doc: ProjectDoc, snap: MoveSnapshot, dx: number, dz: number) {
  for (const [id, p] of Object.entries(snap.furniture)) {
    const f = doc.furniture[id];
    if (f) {
      f.x = r4(p.x + dx);
      f.z = r4(p.z + dz);
    }
  }
  for (const [id, p] of Object.entries(snap.nodes)) {
    const n = doc.nodes[id];
    if (n) {
      n.x = r4(p.x + dx);
      n.z = r4(p.z + dz);
    }
  }
  for (const [id, off] of Object.entries(snap.openings)) {
    const o = doc.openings[id];
    const w = o && doc.walls[o.wallId];
    if (!w) continue;
    const f = wallFrame(doc, w);
    const along = dx * f.d.x + dz * f.d.z;
    o.offset = Math.max(o.width / 2 + 0.06, Math.min(f.length - o.width / 2 - 0.06, off + along));
  }
}

/** Drejer bunken om dens fælles midtpunkt (møbler drejer også om sig selv). */
export function rotateSelection(doc: ProjectDoc, refs: PickRef[], angle: number, center = selectionCenter(doc, refs)) {
  const c = Math.cos(angle), s = Math.sin(angle);
  // Three.js' rotation.y drejer (x, z) → (x·cos + z·sin, −x·sin + z·cos)
  const rot = (x: number, z: number) => {
    const rx = x - center.x, rz = z - center.z;
    return { x: r4(center.x + rx * c + rz * s), z: r4(center.z - rx * s + rz * c) };
  };
  for (const r of refs) {
    if (r.kind !== 'furniture') continue;
    const f = doc.furniture[r.id];
    if (!f) continue;
    Object.assign(f, rot(f.x, f.z));
    f.rotation = Math.atan2(Math.sin(f.rotation + angle), Math.cos(f.rotation + angle));
  }
  for (const id of nodesOf(doc, refs)) Object.assign(doc.nodes[id], rot(doc.nodes[id].x, doc.nodes[id].z));
}

// ---------------------------------------------------------------------------- kopiér / indsæt

/** Udklipsholder-format (gemmes i browseren, så det virker mellem projekter). */
export interface Clip {
  type: 'indretning-udklip';
  version: 1;
  center: { x: number; z: number };
  furniture: FurnitureItem[];
  nodes: WallNode[];
  walls: Wall[];
  openings: Opening[];
}

export function copySelection(doc: ProjectDoc, refs: PickRef[]): Clip {
  const walls = refs.filter((r) => r.kind === 'wall').map((r) => doc.walls[r.id]).filter(Boolean);
  const wallIds = new Set(walls.map((w) => w.id));
  const nodes = nodesOf(doc, refs).map((id) => doc.nodes[id]);
  return structuredClone({
    type: 'indretning-udklip' as const,
    version: 1 as const,
    center: selectionCenter(doc, refs),
    furniture: refs.filter((r) => r.kind === 'furniture').map((r) => doc.furniture[r.id]).filter(Boolean),
    nodes,
    walls,
    // Døre/vinduer kommer med deres væg (en løs dør kan ikke stå alene)
    openings: Object.values(doc.openings).filter((o) => wallIds.has(o.wallId)),
  });
}

/**
 * Indsætter et udklip i dokumentet med nye id'er, forskudt så midten lander i `at`.
 * Returnerer referencer til de nye objekter.
 */
export function pasteClip(doc: ProjectDoc, clip: Clip, at: { x: number; z: number }): PickRef[] {
  const dx = at.x - clip.center.x, dz = at.z - clip.center.z;
  const refs: PickRef[] = [];
  const nodeMap = new Map<string, string>();
  for (const n of clip.nodes) {
    const nn: WallNode = { id: uid('n'), x: r4(n.x + dx), z: r4(n.z + dz) };
    doc.nodes[nn.id] = nn;
    nodeMap.set(n.id, nn.id);
  }
  const wallMap = new Map<string, string>();
  for (const w of clip.walls) {
    const a = nodeMap.get(w.a), b = nodeMap.get(w.b);
    if (!a || !b) continue;
    const nw: Wall = { ...structuredClone(w), id: uid('w'), a, b };
    doc.walls[nw.id] = nw;
    wallMap.set(w.id, nw.id);
    refs.push({ kind: 'wall', id: nw.id });
  }
  for (const o of clip.openings) {
    const wallId = wallMap.get(o.wallId);
    if (!wallId) continue;
    const no: Opening = { ...structuredClone(o), id: uid('o'), wallId };
    doc.openings[no.id] = no;
  }
  for (const f of clip.furniture) {
    const nf: FurnitureItem = { ...structuredClone(f), id: uid('f'), x: r4(f.x + dx), z: r4(f.z + dz) };
    doc.furniture[nf.id] = nf;
    refs.push({ kind: 'furniture', id: nf.id });
  }
  return refs;
}

/**
 * Når indsatte/flyttede vægge ender oven i eksisterende hjørner, samles noderne,
 * så vægge hænger sammen (og rum kan findes).
 */
export function mergeNodes(doc: ProjectDoc, nodeIds: string[]) {
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (!n) continue;
    const others = { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).filter(([k]) => k !== id)) };
    const hit = findNodeNear(others as ProjectDoc, n, 0.02);
    if (!hit) continue;
    for (const w of Object.values(doc.walls)) {
      if (w.a === id) w.a = hit.id;
      if (w.b === id) w.b = hit.id;
      if (w.a === w.b) delete doc.walls[w.id];
    }
    delete doc.nodes[id];
  }
}

export function isClip(d: unknown): d is Clip {
  return (d as Clip)?.type === 'indretning-udklip';
}
