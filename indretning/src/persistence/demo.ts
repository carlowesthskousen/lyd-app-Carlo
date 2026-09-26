import type { FurnitureItem, Opening, ProjectDoc, WallMaterial } from '../state/types';
import { emptyProject } from '../state/defaults';
import { addWall, closestWall, detectRooms, wallFrame } from '../building/wallGraph';
import { openingStyle } from '../building/buildCatalog';
import { snapToWall } from '../furniture/placement';
import { uid } from '../state/ids';

/**
 * Et lille starterhus (ca. 75 m²) med stue/køkken, soveværelse og bad,
 * så man kan gå i gang med det samme.
 */
export function demoProject(dims: (id: string) => { w: number; d: number } | undefined): ProjectDoc {
  const doc = emptyProject('Mit første hus');
  const ox = -5;
  const oz = -3.75;
  const P = (x: number, z: number) => ({ x: x + ox, z: z + oz });
  const ext = { height: 2.6, thickness: 0.25 };
  const int = { height: 2.6, thickness: 0.12 };

  const outline = [P(0, 0), P(10, 0), P(10, 7.5), P(0, 7.5)];
  for (let i = 0; i < 4; i++) addWall(doc, outline[i], outline[(i + 1) % 4], ext);
  addWall(doc, P(6, 0), P(6, 7.5), int);
  addWall(doc, P(6, 4), P(10, 4), int);

  const opening = (x: number, z: number, style: string, flip = false) => {
    const p = P(x, z);
    const w = closestWall(doc, p);
    if (!w) return;
    const f = wallFrame(doc, w);
    const s = openingStyle(style);
    const o: Opening = {
      id: uid('o'),
      wallId: w.id,
      kind: s.kind,
      style: s.id,
      offset: (p.x - f.a.x) * f.d.x + (p.z - f.a.z) * f.d.z,
      width: s.width,
      height: s.height,
      sill: s.sill,
      flip,
    };
    doc.openings[o.id] = o;
  };
  opening(2.2, 7.5, 'door-glass');
  opening(6, 2.2, 'door-90');
  opening(6, 5.8, 'door-80', true);
  opening(1.6, 0, 'win-160');
  opening(4.4, 0, 'win-160');
  opening(0, 3.2, 'win-pano');
  opening(8, 0, 'win-100');
  opening(10, 2, 'win-100');
  opening(10, 5.8, 'win-60');
  opening(4.6, 7.5, 'win-100');

  // Materialer: mursten udvendigt, maling indvendigt.
  const rooms = detectRooms(doc);
  const inside = new Set(rooms.flatMap((r) => r.sides.map((s) => `${s.wallId}:${s.side}`)));
  const brick: WallMaterial = { type: 'brick', color: '#c7735a' };
  for (const w of Object.values(doc.walls)) {
    if (!inside.has(`${w.id}:A`)) w.sideA = { ...brick };
    if (!inside.has(`${w.id}:B`)) w.sideB = { ...brick };
  }
  const paintRoom = (x: number, z: number, color: string) => {
    const p = P(x, z);
    const room = rooms.find((r) => r.sides.length && pointIn(p, r.polygon));
    if (!room) return;
    for (const s of room.sides) {
      const w = doc.walls[s.wallId];
      w[s.side === 'A' ? 'sideA' : 'sideB'] = { type: 'paint', color };
    }
  };
  paintRoom(3, 3, '#f1ede6');
  paintRoom(8, 2, '#a9b59c');
  paintRoom(8, 5.8, '#f4f2ee');

  doc.rooms.push(
    { id: uid('r'), ...P(3, 3), floor: { type: 'wood', color: '#c8a27a' }, name: 'Stue & køkken' },
    { id: uid('r'), ...P(8, 2), floor: { type: 'wood', color: '#e6d6bf' }, name: 'Soveværelse' },
    { id: uid('r'), ...P(8, 5.8), floor: { type: 'tiles', color: '#f2f0ec' }, name: 'Bad' },
  );

  // Møbler
  const add = (catalogId: string, x: number, z: number, rotation = 0, extra: Partial<FurnitureItem> = {}, y = 0) => {
    const id = uid('f');
    const p = P(x, z);
    doc.furniture[id] = { id, catalogId, x: p.x, y, z: p.z, rotation, ...extra };
  };
  /** Stil møblet op ad nærmeste væg. */
  const wallAdd = (catalogId: string, x: number, z: number, extra: Partial<FurnitureItem> = {}, y = 0) => {
    const d = dims(catalogId);
    const p = P(x, z);
    const s = d && snapToWall(doc, p, d.d, 1, d.w);
    const id = uid('f');
    doc.furniture[id] = s
      ? { id, catalogId, x: s.x, y, z: s.z, rotation: s.rotation, ...extra }
      : { id, catalogId, x: p.x, y, z: p.z, rotation: 0, ...extra };
  };

  // Stue
  add('taeppe', 2.6, 2.1, Math.PI / 2, { color: '#b9a58a' });
  add('sofa-chaise', 2.6, 3.35, Math.PI);
  add('sofabord', 2.6, 1.95, 0);
  wallAdd('tv-bord', 2.9, 0.4);
  add('tv', 2.9 - 0.0, 0.33, 0, {}, 0.45);
  add('laenestol', 0.75, 1.6, Math.PI / 2);
  add('gulvlampe', 0.55, 2.55, 0);
  add('plante-stor', 5.4, 0.55, 0);
  wallAdd('reol', 5.72, 1.7);
  // Spiseplads
  add('spisebord', 2.6, 5.6, 0);
  for (const dx of [-0.6, 0, 0.6]) {
    add('spisestol', 2.6 + dx, 5.0, 0);
    add('spisestol', 2.6 + dx, 6.2, Math.PI);
  }
  add('pendel', 2.6, 5.6, 0, {}, 1.62);
  // Køkken langs ydervæggen
  wallAdd('koeleskab', 0.45, 6.9);
  wallAdd('koekken-modul', 1.25, 7.2);
  wallAdd('komfur', 0.45, 5.9 - 0.3);
  wallAdd('koekkenvask', 0.45, 4.8);
  // Soveværelse
  wallAdd('seng-180', 8, 0.5);
  wallAdd('natbord', 6.6, 0.5);
  wallAdd('natbord', 9.4, 0.5);
  wallAdd('garderobe', 8.9, 3.7);
  wallAdd('billede', 8, 0.3, {}, 1.3);
  add('bordlampe', 6.6, 0.33, 0, {}, 0.5);
  add('bordlampe', 9.4, 0.33, 0, {}, 0.5);
  // Bad
  wallAdd('badekar', 9.5, 6.4);
  wallAdd('toilet', 7.1, 7.2);
  wallAdd('haandvask', 8.3, 4.35);

  doc.camera = { x: -2.5, y: 10.5, z: 13, yaw: -0.08, pitch: -0.72 };
  return doc;
}

function pointIn(p: { x: number; z: number }, poly: { x: number; z: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
