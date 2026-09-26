import * as THREE from 'three';
import type { Editor } from '../editor';
import { type CatalogEntry, dimsMeters } from '../furniture/catalog';
import { collidesAt, snapToWall } from '../furniture/placement';
import { roomForPoint } from '../building/wallGraph';
import { pointInPolygon } from '../core/math2d';

export interface FurniturePose {
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Står møblet et gyldigt sted (fx vægting på en væg)? */
  valid: boolean;
  colliding: boolean;
  wallSnapped: boolean;
}

export interface PlacementOptions {
  alt: boolean;
  excludeId: string | null;
  /** Brugerens egen rotation (bruges når møblet ikke står ved en væg). */
  rotation: number;
  /** Ekstra rotation oven i væggens retning, når møblet er snappet til en væg. */
  wallOffset: number;
  /** Forskydning fra musen til møblets centrum (når man flytter et eksisterende møbel). */
  grabOffset?: THREE.Vector2;
}

const WALL_SNAP_GAP = 0.28;

/** Beregner hvor et møbel skal stå ud fra musens position. */
export function computePlacement(ed: Editor, entry: CatalogEntry, ndc: THREE.Vector2, o: PlacementOptions): FurniturePose | null {
  const doc = ed.store.doc;
  const { w, d, h } = dimsMeters(entry);
  const placement = entry.placement ?? 'floor';
  const exclude = new Set<THREE.Object3D>();
  if (o.excludeId) {
    const obj = ed.furniture.objectFor(o.excludeId);
    if (obj) exclude.add(obj);
  }

  let x: number, z: number, y = 0;
  let rotation = o.rotation;
  let wallSnapped = false;
  let valid = true;

  if (placement === 'wall') {
    const hit = ed.picker.pick(ndc, ['wall'], exclude);
    const g = hit?.point ?? ed.picker.groundPoint(ndc, (entry.elevation ?? 140) / 100);
    if (!g) return null;
    const snap = snapToWall(doc, { x: g.x, z: g.z }, d, 1.5, w);
    if (snap) {
      x = snap.x;
      z = snap.z;
      rotation = snap.rotation;
      wallSnapped = true;
      if (hit) {
        const wall = doc.walls[snap.wallId];
        const along = hit.point.y - h / 2;
        y = THREE.MathUtils.clamp(ed.store.doc.settings.snapEnabled && !o.alt ? Math.round(along / 0.05) * 0.05 : along, 0.05, wall.height - h - 0.02);
      } else y = (entry.elevation ?? 140) / 100 - h / 2;
    } else {
      x = g.x;
      z = g.z;
      y = (entry.elevation ?? 140) / 100 - h / 2;
      valid = false;
    }
    return finish();
  }

  let point: THREE.Vector3 | null = null;
  if (placement === 'surface') {
    const hit = ed.picker.pick(ndc, ['furniture', 'floor'], exclude);
    if (hit && hit.kind === 'furniture' && hit.normal && hit.normal.y > 0.7) {
      point = hit.point;
      y = hit.point.y;
    }
  }
  if (!point) point = ed.picker.groundPoint(ndc, 0);
  if (!point) return null;
  x = point.x + (o.grabOffset?.x ?? 0);
  z = point.z + (o.grabOffset?.y ?? 0);

  if (placement === 'ceiling') {
    const room = roomForPoint(ed.building.rooms, { x, z }, pointInPolygon);
    let ceiling = doc.settings.defaultWallHeight;
    if (room) ceiling = Math.max(...room.sides.map((s) => doc.walls[s.wallId]?.height ?? ceiling));
    y = Math.max(0.5, ceiling - h - (entry.elevation !== undefined ? 0 : 0.55));
    if (entry.elevation !== undefined) y = entry.elevation / 100;
  }

  if (!o.alt && placement === 'floor' && entry.dimensions.height > 3) {
    const snap = snapToWall(doc, { x, z }, d, WALL_SNAP_GAP, w);
    if (snap) {
      x = snap.x;
      z = snap.z;
      rotation = snap.rotation + o.wallOffset;
      wallSnapped = true;
    }
  }
  if (!wallSnapped && doc.settings.snapEnabled && !o.alt) {
    const p = ed.snap({ x, z }, true);
    x = p.x;
    z = p.z;
  }
  return finish();

  function finish(): FurniturePose {
    const pose = { x, y, z, rotation };
    const colliding = collidesAt(doc, entry, pose, o.excludeId, (id) => ed.catalog.get(id));
    return { ...pose, valid, colliding, wallSnapped };
  }
}

export const ROT_STEP = THREE.MathUtils.degToRad(15);
export const FINE_ROT_STEP = THREE.MathUtils.degToRad(1);
