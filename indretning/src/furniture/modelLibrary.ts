import * as THREE from 'three';
import { maxAnisotropy } from '../render/anisotropy';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Catalog, type CatalogEntry, type MaterialOverride, dimsMeters } from './catalog';
import { buildProcedural } from './procedural';
import { createPresetMaterial } from '../materials/presets';

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

  /** Glem en model (fx efter redigering), så den indlæses igen næste gang. */
  invalidate(id: string) {
    this.cache.delete(id);
    this.ready.delete(id);
    this.errors.delete(id);
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

  /** Bygger materialer ud fra manifestets "materials"-felt (farve + PBR-teksturer). */
  private async overrideMaterials(entry: CatalogEntry): Promise<Map<string, OverrideResult>> {
    const out = new Map<string, OverrideResult>();
    for (const [name, def] of Object.entries(entry.materials ?? {})) {
      if (def.preset) {
        const p = await createPresetMaterial(def.preset, name, this.catalog.base).catch(() => null);
        if (p) {
          if (def.color) p.material.color.multiply(new THREE.Color(def.color));
          out.set(name, { material: p.material, def: { textureSize: p.textureSize, ...def }, textured: p.textured });
          continue;
        }
      }
      const m = new THREE.MeshStandardMaterial({
        color: def.color ?? '#ffffff',
        roughness: def.roughness ?? 1,
        metalness: def.metalness ?? 0,
      });
      m.name = name;
      const load = async (path: string | undefined, srgb: boolean) => {
        if (!path) return null;
        try {
          return await loadTexture(this.catalog.url(path), srgb);
        } catch {
          const msg = `Kunne ikke indlæse teksturen ${path}`;
          console.warn(msg);
          this.errors.set(entry.id, msg);
          return null;
        }
      };
      const [map, normalMap, roughnessMap] = await Promise.all([
        load(def.map, true),
        load(def.normalMap, false),
        load(def.roughnessMap, false),
      ]);
      if (map) m.map = map;
      if (normalMap) {
        m.normalMap = normalMap;
        m.normalScale.setScalar(def.normalScale ?? 1);
      }
      if (roughnessMap) m.roughnessMap = roughnessMap;
      out.set(name, { material: m, def, textured: !!(map || normalMap || roughnessMap) });
    }
    return out;
  }

  private async build(entry: CatalogEntry): Promise<THREE.Group> {
    const { w, d, h } = dimsMeters(entry);
    const token = new THREE.MeshStandardMaterial({ color: entry.defaultColor ?? '#cccccc' });
    if (entry.file) {
      try {
        const gltf = await this.loader.loadAsync(this.catalog.url(entry.file));
        const scene = gltf.scene;
        const names = Array.isArray(entry.recolorable) ? entry.recolorable : null;
        const overrides = await this.overrideMaterials(entry);
        scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = true;
          o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats as THREE.MeshStandardMaterial[]) {
            for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) if (t) t.anisotropy = maxAnisotropy();
          }
          const tint = mats.some((m: THREE.Material) => (names ? names.includes(m.name) : entry.recolorable === true));
          if (tint) o.userData.role = 'tint';
          if (!Array.isArray(o.material)) {
            const ov = overrides.get(o.material.name);
            if (ov) {
              o.material = ov.material;
              const hasUv = !!o.geometry.attributes.uv;
              if (ov.def.uv === 'box' || (ov.def.uv !== 'model' && !hasUv && ov.textured)) {
                o.userData.boxUv = ov.def.textureSize ?? 0.5;
              }
            }
          }
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

const textureCache = new Map<string, Promise<THREE.Texture>>();

function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  const key = `${url}|${srgb}`;
  let p = textureCache.get(key);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAnisotropy();
      return t;
    });
    textureCache.set(key, p);
  }
  return p;
}

export interface OverrideResult {
  material: THREE.MeshStandardMaterial;
  def: MaterialOverride;
  textured: boolean;
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
      const geo = o.geometry.clone();
      for (const name of ['position', 'normal']) if (geo.getAttribute(name)) geo.setAttribute(name, toFloat(geo.getAttribute(name)));
      clone.geometry = geo.applyMatrix4(o.matrixWorld);
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      out.add(clone);
      return;
    }
    let g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      else g.setAttribute(name, toFloat(g.getAttribute(name)));
    }
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    const boxUv = o.userData.boxUv as number | undefined;
    if (!g.attributes.uv && !boxUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
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
    if (boxUv) applyBoxUv(g, boxUv);
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

/**
 * GLB-filer er ofte komprimerede (kvantiserede heltal). Før vi bager skala og
 * placering ind, pakkes attributten ud til almindelige 32-bit tal – ellers
 * ville koordinater i meter blive klippet til intervallet [-1, 1].
 */
export function toFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  if (!(attr instanceof THREE.InterleavedBufferAttribute) && attr.array instanceof Float32Array) return attr as THREE.BufferAttribute;
  const n = attr.count;
  const size = attr.itemSize;
  const out = new Float32Array(n * size);
  for (let i = 0; i < n; i++) {
    out[i * size] = attr.getX(i);
    if (size > 1) out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i);
    if (size > 3) out[i * size + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, size);
}

/**
 * Box-projicerede UV'er i meter (til modeller uden UV'er). Hver flade får
 * koordinater fra den akse, dens normal peger mest langs. På lodrette flader
 * løber teksturens V-akse (træets årer) lodret, som i ben og stolper.
 */
export function applyBoxUv(g: THREE.BufferGeometry, textureSize: number) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const s = 1 / textureSize;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) {
      // Vandrette flader (armlæn, top): årerne følger bredden
      u = z;
      v = x;
    } else if (ax >= az) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u * s;
    uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
