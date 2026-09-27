import * as THREE from 'three';
import type { FurnitureItem, ProjectDoc } from '../state/types';
import { type Catalog, type CatalogEntry } from './catalog';
import type { ModelLibrary } from './modelLibrary';
import { finishMaterial } from '../render/materials';

const MAX_LIGHTS = 8;

/** Et placeret møbel i scenen. */
export interface Instance {
  root: THREE.Group;
  body: THREE.Group | null;
  catalogId: string;
  appearance: string;
  shades: THREE.MeshStandardMaterial[];
}

/**
 * Afleder møbel-objekter fra dokumentet. Modeller deles mellem instanser;
 * kun farvede materialer er unikke pr. farve/finish.
 * Lamper får lys fra en fast pulje (ingen shader-genkompilering, stabil fps).
 */
export class FurnitureView {
  readonly root = new THREE.Group();
  readonly instances = new Map<string, Instance>();
  private lightPool: THREE.PointLight[] = [];
  private tintCache = new Map<string, THREE.Material>();
  onChanged?: () => void;

  constructor(
    scene: THREE.Scene,
    private catalog: Catalog,
    private library: ModelLibrary,
  ) {
    this.root.name = 'furniture';
    scene.add(this.root);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight('#ffd9a8', 0, 6, 2);
      l.castShadow = false;
      scene.add(l);
      this.lightPool.push(l);
    }
  }

  sync(doc: ProjectDoc) {
    let changed = false;
    for (const [id, inst] of this.instances) {
      const item = doc.furniture[id];
      if (!item || item.catalogId !== inst.catalogId) {
        this.root.remove(inst.root);
        this.instances.delete(id);
        changed = true;
      }
    }
    for (const item of Object.values(doc.furniture)) {
      const entry = this.catalog.get(item.catalogId);
      let inst = this.instances.get(item.id);
      if (!inst) {
        inst = this.create(item, entry);
        this.instances.set(item.id, inst);
        changed = true;
      }
      const r = inst.root;
      if (r.position.x !== item.x || r.position.y !== item.y || r.position.z !== item.z || r.rotation.y !== item.rotation) {
        r.position.set(item.x, item.y, item.z);
        r.rotation.y = item.rotation;
        changed = true;
      }
      if (entry && inst.body) {
        const ap = appearanceKey(item, entry);
        if (ap !== inst.appearance) {
          this.applyAppearance(inst, item, entry);
          changed = true;
        }
      }
    }
    if (changed) this.onChanged?.();
  }

  private create(item: FurnitureItem, entry: CatalogEntry | undefined): Instance {
    const root = new THREE.Group();
    root.userData.pick = { kind: 'furniture', id: item.id };
    root.position.set(item.x, item.y, item.z);
    root.rotation.y = item.rotation;
    this.root.add(root);
    const inst: Instance = { root, body: null, catalogId: item.catalogId, appearance: '', shades: [] };
    if (!entry) {
      root.add(missingBox());
      return inst;
    }
    const ready = this.library.getReady(entry.id);
    if (ready) {
      this.attach(inst, ready, item, entry);
    } else {
      const ph = loadingBox(entry);
      root.add(ph);
      this.library.get(entry).then((tpl) => {
        root.remove(ph);
        if (this.instances.get(item.id) !== inst) return;
        this.attach(inst, tpl, item, entry);
        this.onChanged?.();
      });
    }
    return inst;
  }

  private attach(inst: Instance, tpl: THREE.Group, item: FurnitureItem, entry: CatalogEntry) {
    const body = tpl.clone(true);
    body.traverse((o) => (o.userData = { ...o.userData }));
    inst.body = body;
    inst.root.add(body);
    this.applyAppearance(inst, item, entry);
  }

  private applyAppearance(inst: Instance, item: FurnitureItem, entry: CatalogEntry) {
    inst.shades = this.paintBody(inst.body!, item, entry);
    this.setLampState(inst, item, entry);
    inst.appearance = appearanceKey(item, entry);
  }

  /** Standardudseende på en løs kopi af en model (fx forhåndsvisning ved placering). */
  applyPreviewAppearance(body: THREE.Object3D, entry: CatalogEntry) {
    const shades = this.paintBody(body, { lightOn: true } as FurnitureItem, entry);
    for (const m of shades) m.emissiveIntensity = entry.light ? 2.4 : 0;
  }

  private paintBody(body: THREE.Object3D, item: Partial<FurnitureItem>, entry: CatalogEntry) {
    const color = item.color ?? entry.defaultColor ?? '#cccccc';
    const finish = item.finish ?? entry.defaultFinish ?? 'lak';
    const shades: THREE.MeshStandardMaterial[] = [];
    body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const role = o.userData.role;
      if (role === 'main') {
        let m = finishMaterial(finish, color);
        if (o.userData.doubleSide) m = this.doubleSided(m);
        o.material = m;
      } else if (role === 'tint') {
        o.userData.orig ??= o.material;
        // Manifestets defaultColor gælder også GLB-materialer, der kan farves.
        o.material = this.tinted(o.userData.orig as THREE.MeshStandardMaterial, color, item.color !== undefined || !!entry.defaultColor);
      } else if (role === 'shade') {
        o.userData.orig ??= o.material;
        const m = (o.userData.orig as THREE.MeshStandardMaterial).clone();
        o.material = m;
        shades.push(m);
      }
    });
    return shades;
  }

  private doubleSided(m: THREE.MeshStandardMaterial) {
    const key = m.uuid + ':ds';
    let c = this.tintCache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!c) {
      c = m.clone();
      c.side = THREE.DoubleSide;
      this.tintCache.set(key, c);
    }
    return c;
  }

  private tinted(orig: THREE.MeshStandardMaterial, color: string, custom: boolean) {
    if (!custom) return orig;
    const key = `${orig.uuid}:${color}`;
    let m = this.tintCache.get(key);
    if (!m) {
      const c = orig.clone();
      if ('color' in c) c.color = new THREE.Color(color);
      this.tintCache.set(key, (m = c));
    }
    return m;
  }

  private setLampState(inst: Instance, item: FurnitureItem, entry: CatalogEntry) {
    const on = !!entry.light && item.lightOn !== false;
    for (const m of inst.shades) {
      m.emissiveIntensity = on ? 2.4 : 0;
      m.emissive.set(entry.light?.color ?? '#ffe0b0');
    }
  }

  /** Fordeler lyspuljen til de tændte lamper tættest på kameraet. */
  updateLights(doc: ProjectDoc, camPos: THREE.Vector3, nightFactor: number) {
    const lamps: { item: FurnitureItem; entry: CatalogEntry; pos: THREE.Vector3; d: number }[] = [];
    for (const item of Object.values(doc.furniture)) {
      const entry = this.catalog.get(item.catalogId);
      if (!entry?.light || item.lightOn === false) continue;
      const inst = this.instances.get(item.id);
      if (!inst) continue;
      const h = (entry.light.height ?? entry.dimensions.height * 0.85) / 100;
      const pos = new THREE.Vector3(0, h, 0).applyMatrix4(inst.root.matrixWorld);
      lamps.push({ item, entry, pos, d: pos.distanceToSquared(camPos) });
    }
    lamps.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      const lamp = lamps[i];
      if (!lamp) {
        l.intensity = 0;
        continue;
      }
      l.position.copy(lamp.pos);
      l.color.set(lamp.entry.light!.color ?? '#ffd9a8');
      l.distance = lamp.entry.light!.distance ?? 6;
      // Lamper ses tydeligst om aftenen; om dagen giver de en svag, varm glød.
      l.intensity = (lamp.entry.light!.intensity ?? 5) * (0.35 + 0.65 * nightFactor);
    }
  }

  objectFor(id: string) {
    return this.instances.get(id)?.root;
  }

  bounds() {
    return new THREE.Box3().setFromObject(this.root);
  }
}

function appearanceKey(item: FurnitureItem, entry: CatalogEntry) {
  return `${item.color ?? entry.defaultColor}|${item.finish ?? entry.defaultFinish}|${item.lightOn !== false}`;
}

function missingBox() {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0),
    new THREE.MeshStandardMaterial({ color: '#ff00aa', wireframe: true }),
  );
  return m;
}

function loadingBox(entry: CatalogEntry) {
  const w = entry.dimensions.width / 100;
  const d = entry.dimensions.depth / 100;
  const h = entry.dimensions.height / 100;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0),
    new THREE.MeshStandardMaterial({ color: '#9fb2c2', transparent: true, opacity: 0.35 }),
  );
  return m;
}
