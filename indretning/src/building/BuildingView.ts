import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ProjectDoc, RoomStyle, WallMode } from '../state/types';
import { DEFAULT_FLOOR_MATERIAL } from '../state/defaults';
import { floorMaterial, trimMaterial, wallMaterial } from '../render/materials';
import { type Room, computeWallCorners, detectRooms, wallFrame } from './wallGraph';
import { buildFloorGeometry, buildWallGeometry, buildWallStub, doorSwing } from './wallGeometry';
import { openingStyle } from './buildCatalog';
import { buildOpeningModel } from './openingModels';
import { closestOnSegment, pointInPolygon } from '../core/math2d';

/** Højde på sænkede vægge ("stumper", som i The Sims). */
export const STUB_HEIGHT = 0.24;
/** Kameraet står "tæt på" en væg inden for denne afstand – så sænkes den ikke. */
const NEAR_WALL = 1.5;
/** Under denne kamerahøjde sænker cutaway ingen vægge (man står i øjenhøjde). */
const EYE_LEVEL = 1.5;

interface WallEntry {
  /** Beholder med pick-info; indeholder den fulde væg og stumpen. */
  group: THREE.Group;
  /** Den fulde væg (skaleres i højden under animationen). */
  full: THREE.Group;
  /** Døre/vinduer i den fulde væg (skjules under animationen, så de ikke ses mast). */
  openings: THREE.Group;
  /** Den lave stump med døråbninger, svingbuer og vinduesmarkeringer. */
  stub: THREE.Group;
  /** 1 = fuld højde; lowFactor = stumpens højde. */
  factor: number;
  target: number;
  lowFactor: number;
  a: THREE.Vector2;
  b: THREE.Vector2;
  height: number;
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
  private openingObjects = new Map<string, THREE.Object3D[]>();
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
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
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
      const full = new THREE.Group();
      const stub = new THREE.Group();
      const openingsGroup = new THREE.Group();
      full.add(openingsGroup);
      group.add(full, stub);
      const mk = (parent: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material, side?: 'A' | 'B') => {
        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.pick = { kind: 'wall', id: w.id, side };
        mesh.userData.wallMesh = true;
        parent.add(mesh);
        return mesh;
      };
      mk(full, geo.sideA, wallMaterial(w.sideA), 'A');
      mk(full, geo.sideB, wallMaterial(w.sideB), 'B');
      mk(full, geo.rest, trimMaterial());

      // Stumpen: lav væg med ægte døråbninger
      const stubH = Math.min(STUB_HEIGHT, w.height);
      const sg = buildWallStub(f, c, stubH, w.thickness, ops);
      mk(stub, sg.sideA, wallMaterial(w.sideA), 'A');
      mk(stub, sg.sideB, wallMaterial(w.sideB), 'B');
      mk(stub, sg.rest, stubCapMaterial());

      for (const o of ops) {
        const model = buildOpeningModel(o, w.thickness);
        model.position.x = o.offset;
        model.userData.pick = { kind: 'opening', id: o.id };
        model.traverse((m) => (m.userData.pick = { kind: 'opening', id: o.id }));
        openingsGroup.add(model);
        const marks = this.stubMarkers(o, w.thickness, stubH);
        stub.add(marks);
        this.openingObjects.set(o.id, [model, marks]);
      }
      const lowFactor = stubH / w.height;
      const saved = this.factors.get(w.id);
      const factor = saved === undefined ? 1 : saved < 0.999 ? lowFactor : 1;
      const entry: WallEntry = {
        group,
        full,
        openings: openingsGroup,
        stub,
        factor,
        target: factor,
        lowFactor,
        a: new THREE.Vector2(f.a.x, f.a.z),
        b: new THREE.Vector2(f.b.x, f.b.z),
        height: w.height,
        mid: new THREE.Vector2((f.a.x + f.b.x) / 2, (f.a.z + f.b.z) / 2),
        normal: new THREE.Vector2(f.n.x, f.n.z),
        length: f.length,
        interiors: [],
      };
      this.applyFactor(entry);
      this.root.add(group);
      this.walls.set(w.id, entry);
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

  /** Markeringer i stumpen: dørens svingbue på gulvet, vinduet som en glasstribe. */
  private stubMarkers(o: ProjectDoc['openings'][string], thickness: number, stubH: number): THREE.Group {
    const g = new THREE.Group();
    g.userData.pick = { kind: 'opening', id: o.id };
    const pick = { kind: 'opening', id: o.id };
    if (o.kind === 'door') {
      if (o.style !== 'door-opening') {
        const swing = doorSwing(o, thickness);
        const fill = new THREE.Mesh(swing.fill, swingFillMaterial());
        fill.userData.pick = pick;
        fill.renderOrder = 3;
        const line = new THREE.LineSegments(swing.line, swingLineMaterial());
        line.userData.pick = pick;
        line.renderOrder = 3;
        g.add(fill, line);
      }
      // Tærskel i åbningen, så døren kan ses og vælges
      const sill = new THREE.Mesh(new THREE.BoxGeometry(o.width - 0.02, 0.012, thickness), openingMarkMaterial());
      sill.position.set(o.offset, 0.006, 0);
      sill.userData.pick = pick;
      g.add(sill);
    } else {
      const st = openingStyle(o.style);
      // Vinduet vises som en lyseblå glasstribe oven på stumpen
      const glass = new THREE.Mesh(new THREE.BoxGeometry(o.width, 0.03, thickness + 0.012), windowMarkMaterial());
      glass.position.set(o.offset, stubH + 0.015, 0);
      glass.userData.pick = pick;
      g.add(glass);
      if (st.variant === 'panorama' || st.variant === 'window-split') {
        const n = st.variant === 'panorama' ? 3 : 2;
        for (let i = 1; i < n; i++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, thickness + 0.016), openingMarkMaterial());
          bar.position.set(o.offset - o.width / 2 + (o.width * i) / n, stubH + 0.015, 0);
          bar.userData.pick = pick;
          g.add(bar);
        }
      }
    }
    return g;
  }

  /** Viser fuld væg, animationsfase eller stump ud fra faktoren. */
  private applyFactor(w: WallEntry) {
    const atLow = w.factor <= w.lowFactor + 0.001;
    const atFull = w.factor >= 0.999;
    w.full.visible = !atLow;
    w.full.scale.y = w.factor;
    // Døre/vinduer vises kun i fuld højde – aldrig mast sammen med væggen
    w.openings.visible = atFull;
    w.stub.visible = atLow;
  }

  /** 3D-objekt for et element (bruges til fokus). */
  objectFor(kind: string, id: string): THREE.Object3D | undefined {
    if (kind === 'wall') return this.walls.get(id)?.group;
    if (kind === 'opening') return this.openingObjects.get(id)?.[0];
    if (kind === 'floor') return this.floorObjects.get(id);
    return undefined;
  }

  /** Alle 3D-objekter for et element (fuld og sænket udgave) – til omrids. */
  objectsFor(kind: string, id: string): THREE.Object3D[] {
    if (kind === 'opening') return this.openingObjects.get(id) ?? [];
    const o = this.objectFor(kind, id);
    return o ? [o] : [];
  }

  /** De synlige vægflader (fuld væg eller stump) – bruges til dronens kollision. */
  collisionMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const w of this.walls.values()) {
      const src = w.full.visible ? w.full : w.stub;
      for (const c of src.children) if (c instanceof THREE.Mesh && c.userData.wallMesh) out.push(c);
    }
    return out;
  }

  wallFactor(id: string) {
    return this.walls.get(id)?.factor ?? 1;
  }

  /** Antal vægge, der er (eller er på vej til at blive) sænket. */
  get loweredCount() {
    let n = 0;
    for (const w of this.walls.values()) if (w.target < 1) n++;
    return n;
  }

  /**
   * Sænker vægge efter vægvisningen. Cutaway (som i The Sims): en væg sænkes,
   * når kameraet står uden for et rum, som væggen skjuler. Den sænkes aldrig,
   * når kameraet er inde i huset i øjenhøjde, under 1,5 m eller tæt på væggen.
   * Vægge i `keepUp` (dem man bygger på) står altid i fuld højde.
   * Returnerer true, hvis noget ændrede sig (så skyggerne skal opdateres).
   */
  updateCutaway(dt: number, mode: WallMode, camPos: THREE.Vector3, focus: THREE.Vector3, keepUp?: Set<string>): boolean {
    let changed = false;
    const cam = new THREE.Vector2(camPos.x, camPos.z);
    const foc = new THREE.Vector2(focus.x, focus.z);
    const camToFocus = cam.distanceTo(foc);
    let tallest = 0;
    for (const w of this.walls.values()) tallest = Math.max(tallest, w.height);
    const camP = { x: camPos.x, z: camPos.z };
    const insideHouse = camPos.y < tallest + 0.2 && this.rooms.some((r) => pointInPolygon(camP, r.polygon));
    const cutawayAllowed = camPos.y >= EYE_LEVEL && !insideHouse;
    for (const [id, w] of this.walls) {
      let low = false;
      if (keepUp?.has(id)) low = false;
      else if (mode === 'down') low = true;
      else if (mode === 'cutaway' && cutawayAllowed) {
        const nearWall = closestOnSegment(camP, { x: w.a.x, z: w.a.y }, { x: w.b.x, z: w.b.y }).d < NEAR_WALL;
        if (nearWall) low = false;
        else if (w.interiors.length) {
          // Kameraet står uden for et af de rum, væggen afgrænser → væggen skjuler rummet
          const toCam = new THREE.Vector2().subVectors(cam, w.mid);
          low = toCam.length() < 80 && w.interiors.some((n) => toCam.dot(n) < -0.05);
        } else {
          const sc = new THREE.Vector2().subVectors(cam, w.mid).dot(w.normal);
          const sf = new THREE.Vector2().subVectors(foc, w.mid).dot(w.normal);
          const opposite = Math.sign(sc) !== Math.sign(sf) && Math.abs(sc) > 0.05;
          low = opposite && w.mid.distanceTo(cam) < camToFocus + w.length * 0.5;
        }
      }
      w.target = low ? w.lowFactor : 1;
      if (Math.abs(w.factor - w.target) > 0.0005) {
        w.factor += (w.target - w.factor) * (1 - Math.exp(-12 * dt));
        if (Math.abs(w.factor - w.target) < 0.004) w.factor = w.target;
        this.applyFactor(w);
        changed = true;
      }
    }
    return changed;
  }

  bounds(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.root);
  }
}

const matCache = new Map<string, THREE.Material>();
const cached = <T extends THREE.Material>(key: string, make: () => T): T => {
  let m = matCache.get(key) as T | undefined;
  if (!m) matCache.set(key, (m = make()));
  return m;
};
/** Stumpens top: lidt mørkere, så man tydeligt ser, at væggen er "skåret over". */
const stubCapMaterial = () => cached('stubCap', () => new THREE.MeshStandardMaterial({ color: '#8d877d', roughness: 0.9 }));
const swingFillMaterial = () =>
  cached('swingFill', () => new THREE.MeshBasicMaterial({ color: '#2f7fd0', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
const swingLineMaterial = () => cached('swingLine', () => new THREE.LineBasicMaterial({ color: '#2f7fd0', transparent: true, opacity: 0.85 }));
const windowMarkMaterial = () =>
  cached('windowMark', () => new THREE.MeshStandardMaterial({ color: '#8fc6ec', roughness: 0.15, transparent: true, opacity: 0.9, emissive: '#4f9fd8', emissiveIntensity: 0.25 }));
const openingMarkMaterial = () => cached('openingMark', () => new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.6 }));

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
