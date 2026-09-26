import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ProjectDoc, RoomStyle, WallMode } from '../state/types';
import { DEFAULT_FLOOR_MATERIAL } from '../state/defaults';
import { floorMaterial, trimMaterial, wallMaterial } from '../render/materials';
import { type Room, computeWallCorners, detectRooms, wallFrame } from './wallGraph';
import { buildFloorGeometry, buildWallGeometry } from './wallGeometry';
import { buildOpeningModel } from './openingModels';
import { pointInPolygon } from '../core/math2d';

/** Højde (andel) for sænkede vægge – Sims-agtige "stubbe". */
const LOW_FACTOR = 0.09;

interface WallEntry {
  group: THREE.Group;
  factor: number;
  target: number;
  mid: THREE.Vector2;
  normal: THREE.Vector2;
  length: number;
  /** Normaler der peger ind i de rum, væggen afgrænser. */
  interiors: THREE.Vector2[];
}

/**
 * Afleder 3D-objekter for vægge, døre/vinduer og gulve fra dokumentet og
 * styrer cutaway (sænkning af vægge mellem kameraet og det, man kigger på).
 */
export class BuildingView {
  readonly root = new THREE.Group();
  rooms: Room[] = [];
  private walls = new Map<string, WallEntry>();
  private openingObjects = new Map<string, THREE.Object3D>();
  private floorObjects = new Map<string, THREE.Mesh>();
  private signature = '';
  private factors = new Map<string, number>();
  showRoomLabels = true;
  onRebuilt?: () => void;

  constructor(scene: THREE.Scene) {
    this.root.name = 'building';
    scene.add(this.root);
  }

  sync(doc: ProjectDoc) {
    const sig = JSON.stringify([doc.nodes, doc.walls, doc.openings, doc.rooms]);
    if (sig === this.signature) return false;
    this.signature = sig;
    this.rebuild(doc);
    return true;
  }

  private clear() {
    for (const [id, w] of this.walls) this.factors.set(id, w.factor);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.root.clear();
    this.walls.clear();
    this.openingObjects.clear();
    this.floorObjects.clear();
  }

  private rebuild(doc: ProjectDoc) {
    this.clear();
    const corners = computeWallCorners(doc);
    const openingsByWall = new Map<string, typeof doc.openings[string][]>();
    for (const o of Object.values(doc.openings)) {
      let l = openingsByWall.get(o.wallId);
      if (!l) openingsByWall.set(o.wallId, (l = []));
      l.push(o);
    }

    for (const w of Object.values(doc.walls)) {
      const c = corners.get(w.id);
      if (!c) continue;
      const f = wallFrame(doc, w);
      const ops = openingsByWall.get(w.id) ?? [];
      const geo = buildWallGeometry(f, c, w.height, w.thickness, ops);
      const group = new THREE.Group();
      group.position.set(f.a.x, 0, f.a.z);
      group.rotation.y = Math.atan2(-f.d.z, f.d.x);
      group.userData.pick = { kind: 'wall', id: w.id };
      const mk = (g: THREE.BufferGeometry, m: THREE.Material, side?: 'A' | 'B') => {
        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.pick = { kind: 'wall', id: w.id, side };
        group.add(mesh);
        return mesh;
      };
      mk(geo.sideA, wallMaterial(w.sideA), 'A');
      mk(geo.sideB, wallMaterial(w.sideB), 'B');
      mk(geo.rest, trimMaterial());

      for (const o of ops) {
        const model = buildOpeningModel(o, w.thickness);
        model.position.x = o.offset;
        model.userData.pick = { kind: 'opening', id: o.id };
        model.traverse((m) => (m.userData.pick = { kind: 'opening', id: o.id }));
        group.add(model);
        this.openingObjects.set(o.id, model);
      }
      const factor = this.factors.get(w.id) ?? 1;
      group.scale.y = factor;
      this.root.add(group);
      this.walls.set(w.id, {
        group,
        factor,
        target: factor,
        mid: new THREE.Vector2((f.a.x + f.b.x) / 2, (f.a.z + f.b.z) / 2),
        normal: new THREE.Vector2(f.n.x, f.n.z),
        length: f.length,
        interiors: [],
      });
    }

    this.rooms = detectRooms(doc, corners);
    for (const room of this.rooms) {
      for (const side of room.sides) {
        const w = this.walls.get(side.wallId);
        if (w) w.interiors.push(w.normal.clone().multiplyScalar(side.side === 'A' ? 1 : -1));
      }
    }
    for (const room of this.rooms) {
      const style = roomStyleFor(doc, room);
      if (style?.hidden) continue;
      const mat = floorMaterial(style?.floor ?? DEFAULT_FLOOR_MATERIAL);
      const mesh = new THREE.Mesh(buildFloorGeometry(room.polygon), mat);
      mesh.receiveShadow = true;
      mesh.userData.pick = { kind: 'floor', id: room.key };
      this.root.add(mesh);
      this.floorObjects.set(room.key, mesh);

      const el = document.createElement('div');
      el.className = 'room-label';
      el.innerHTML = `${style?.name ? `<b>${escapeHtml(style.name)}</b>` : ''}<span>${formatArea(room.area)}</span>`;
      const label = new CSS2DObject(el);
      label.position.set(room.labelPoint.x, 0.05, room.labelPoint.z);
      label.visible = this.showRoomLabels;
      mesh.add(label);
    }
    this.onRebuilt?.();
  }

  setRoomLabelsVisible(v: boolean) {
    this.showRoomLabels = v;
    this.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.visible = v;
    });
  }

  /** 3D-objekt for et element (bruges til omrids og fokus). */
  objectFor(kind: string, id: string): THREE.Object3D | undefined {
    if (kind === 'wall') return this.walls.get(id)?.group;
    if (kind === 'opening') return this.openingObjects.get(id);
    if (kind === 'floor') return this.floorObjects.get(id);
    return undefined;
  }

  /** Alle vægflader (med huller til døre/vinduer) – bruges til dronens kollision. */
  collisionMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const w of this.walls.values()) for (const c of w.group.children) if (c instanceof THREE.Mesh) out.push(c);
    return out;
  }

  /** Vægmeshes uden døre/vinduer – til omrids af en væg. */
  wallMeshes(id: string): THREE.Object3D[] {
    const g = this.walls.get(id)?.group;
    return g ? g.children.filter((c) => c instanceof THREE.Mesh) : [];
  }

  wallFactor(id: string) {
    return this.walls.get(id)?.factor ?? 1;
  }

  /**
   * Cutaway: sænker vægge, som står mellem kameraet og punktet man kigger på.
   * Returnerer true, hvis noget ændrede sig (så skyggerne skal opdateres).
   */
  updateCutaway(dt: number, mode: WallMode, camPos: THREE.Vector3, focus: THREE.Vector3, keepUp?: string): boolean {
    let changed = false;
    const cam = new THREE.Vector2(camPos.x, camPos.z);
    const foc = new THREE.Vector2(focus.x, focus.z);
    const camToFocus = cam.distanceTo(foc);
    for (const [id, w] of this.walls) {
      let target = 1;
      if (id === keepUp) target = 1;
      else if (mode === 'down') target = LOW_FACTOR;
      else if (mode === 'cutaway' && id !== keepUp && w.interiors.length) {
        // Som i The Sims: sænk væggen, hvis kameraet står uden for et af de rum,
        // den afgrænser – så skjuler den rummets indre.
        const toCam = new THREE.Vector2().subVectors(cam, w.mid);
        const near = toCam.length() < 80;
        if (near && camPos.y > 0.4 && w.interiors.some((n) => toCam.dot(n) < -0.05)) target = LOW_FACTOR;
      } else if (mode === 'cutaway' && id !== keepUp) {
        const sc = new THREE.Vector2().subVectors(cam, w.mid).dot(w.normal);
        const sf = new THREE.Vector2().subVectors(foc, w.mid).dot(w.normal);
        const opposite = Math.sign(sc) !== Math.sign(sf) && Math.abs(sc) > 0.05;
        // Afstand fra væggens midte til sigtelinjen kamera→fokus (vandret)
        const closer = w.mid.distanceTo(cam) < camToFocus + w.length * 0.5;
        const lookingDown = camPos.y > 0.4;
        if (opposite && closer && lookingDown) target = LOW_FACTOR;
      }
      w.target = target;
      if (Math.abs(w.factor - w.target) > 0.001) {
        w.factor += (w.target - w.factor) * (1 - Math.exp(-10 * dt));
        if (Math.abs(w.factor - w.target) < 0.002) w.factor = w.target;
        w.group.scale.y = w.factor;
        changed = true;
      }
    }
    return changed;
  }

  bounds(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.root);
  }
}

export function roomStyleFor(doc: ProjectDoc, room: Room): RoomStyle | undefined {
  return doc.rooms.find((s) => pointInPolygon(s, room.polygon));
}

export function formatArea(a: number) {
  return `${a.toFixed(1).replace('.', ',')} m²`;
}

export function formatLength(m: number) {
  return `${m.toFixed(2).replace('.', ',')} m`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
