import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Catalog, type CatalogEntry, dimsMeters } from './catalog';
import { buildProcedural } from './procedural';

/**
 * Indlæser og normaliserer møbelmodeller.
 *
 * Uanset om modellen kommer fra en GLB-fil eller er procedural, bliver den:
 *  1. drejet (rotationY), så forsiden vender mod +z
 *  2. skaleret, så dens bounding box præcis matcher målene i manifestet
 *  3. flyttet, så origo ligger midt under møblet på gulvet
 *  4. "bagt" og slået sammen pr. materiale (færre draw calls = bedre fps)
 */
export class ModelLibrary {
  private cache = new Map<string, Promise<THREE.Group>>();
  private ready = new Map<string, THREE.Group>();
  private loader: GLTFLoader;
  /** Fejl pr. katalog-id (vises i UI). */
  readonly errors = new Map<string, string>();

  constructor(private catalog: Catalog) {
    this.loader = new GLTFLoader();
    // Draco-dekoderen bundtes lokalt af Vite (virker også offline).
    const draco = new DRACOLoader();
    this.loader.setDRACOLoader(draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  getReady(id: string) {
    return this.ready.get(id);
  }

  get(entry: CatalogEntry): Promise<THREE.Group> {
    let p = this.cache.get(entry.id);
    if (!p) {
      p = this.build(entry).then((g) => {
        this.ready.set(entry.id, g);
        return g;
      });
      this.cache.set(entry.id, p);
    }
    return p;
  }

  private async build(entry: CatalogEntry): Promise<THREE.Group> {
    const { w, d, h } = dimsMeters(entry);
    const token = new THREE.MeshStandardMaterial({ color: entry.defaultColor ?? '#cccccc' });
    if (entry.file) {
      try {
        const gltf = await this.loader.loadAsync(this.catalog.url(entry.file));
        const scene = gltf.scene;
        const names = Array.isArray(entry.recolorable) ? entry.recolorable : null;
        scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = true;
          o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const tint = mats.some((m: THREE.Material) => (names ? names.includes(m.name) : entry.recolorable === true));
          if (tint) o.userData.role = 'tint';
        });
        return normalize(scene, entry, w, d, h, null);
      } catch (err) {
        const msg = `Kunne ikke indlæse ${entry.file}: ${(err as Error).message ?? err}`;
        console.warn(msg, '– bruger placeholder i stedet.');
        this.errors.set(entry.id, msg);
      }
    }
    const g = buildProcedural(entry.procedural ?? 'box', w, d, h, token);
    return normalize(g, entry, w, d, h, token);
  }
}

function normalize(
  model: THREE.Object3D,
  entry: CatalogEntry,
  w: number,
  d: number,
  h: number,
  mainToken: THREE.Material | null,
): THREE.Group {
  const rot = new THREE.Group();
  rot.rotation.y = THREE.MathUtils.degToRad(entry.rotationY ?? 0);
  rot.add(model);
  const scaler = new THREE.Group();
  scaler.add(rot);
  const root = new THREE.Group();
  root.add(scaler);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scaler, true);
  const size = box.getSize(new THREE.Vector3());
  const safe = (v: number) => (v > 1e-6 ? v : 1);
  if (entry.scaleMode === 'uniform') {
    const s = Math.min(w / safe(size.x), h / safe(size.y), d / safe(size.z));
    scaler.scale.setScalar(s);
  } else {
    // Meget flade modeller (tæpper, billeder) må ikke strækkes i den flade retning.
    scaler.scale.set(
      size.x > 1e-4 ? w / size.x : 1,
      size.y > 1e-4 ? h / size.y : 1,
      size.z > 1e-4 ? d / size.z : 1,
    );
    const ratios = [w / safe(size.x), h / safe(size.y), d / safe(size.z)].filter((r) => isFinite(r));
    const spread = Math.max(...ratios) / Math.min(...ratios);
    if (entry.file && spread > 1.35) {
      console.warn(
        `"${entry.name}": modellens proportioner afviger ${(spread * 100 - 100).toFixed(0)}% fra målene i manifestet. ` +
          `Tjek bredde/dybde eller om "rotationY" skal være 90.`,
      );
    }
  }
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scaler, true);
  const c = box2.getCenter(new THREE.Vector3());
  scaler.position.set(-c.x, -box2.min.y, -c.z);
  root.updateMatrixWorld(true);
  const baked = bakeAndMerge(root, mainToken);
  baked.userData.entryId = entry.id;
  return baked;
}

/** Bager alle transformationer ind i geometrien og slår meshes sammen pr. materiale. */
export function bakeAndMerge(root: THREE.Object3D, mainToken: THREE.Material | null): THREE.Group {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; data: Record<string, unknown>; shadow: boolean }>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const flip = o.matrixWorld.determinant() < 0;
    if (Array.isArray(o.material) || o instanceof THREE.SkinnedMesh || o.morphTargetInfluences) {
      const clone = o.clone();
      clone.geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      out.add(clone);
      return;
    }
    let g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.applyMatrix4(o.matrixWorld);
    if (flip) {
      const idx = g.index!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
    }
    // Ensartet indekstype, ellers kan geometrierne ikke slås sammen.
    if (!(g.index!.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index!.array), 1));
    const data: Record<string, unknown> = {};
    if (o.material === mainToken) data.role = 'main';
    else if (o.userData.role) data.role = o.userData.role;
    else if (o.material.name === 'shade') data.role = 'shade';
    if (o.userData.doubleSide) data.doubleSide = true;
    const shadow = o.castShadow;
    const key = `${o.material.uuid}|${JSON.stringify(data)}|${shadow}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: o.material, geos: [], data, shadow }));
    b.geos.push(g);
  });
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    Object.assign(mesh.userData, b.data);
    out.add(mesh);
  }
  return out;
}
