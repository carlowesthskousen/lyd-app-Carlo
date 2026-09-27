import * as THREE from 'three';
import type { Room } from '../building/wallGraph';
import { pointInPolygon } from '../core/math2d';

/**
 * Lokale refleksioner inde i huset: én "refleksionsprobe" (CubeCamera) pr. rum,
 * der fotograferer rummet (vægge, gulv, vinduer) fra midten. Metal, lak og glas
 * inde i rummet reflekterer derefter rummets egne vægge i stedet for himlen,
 * og det bløde omgivelseslys kommer fra rummet (ikke fra græsset udenfor).
 *
 * Proberne opdateres, når rummet ændres, tiden på dagen skifter eller lamper
 * tændes/slukkes (med en lille forsinkelse, så det ikke sker hver frame).
 */
interface Probe {
  key: string;
  polygon: { x: number; z: number }[];
  position: THREE.Vector3;
  pmrem: THREE.WebGLRenderTarget | null;
}

export class ReflectionProbes {
  private probes = new Map<string, Probe>();
  private cube: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCamera: THREE.CubeCamera | null = null;
  private pmremGen: THREE.PMREMGenerator;
  private variants = new WeakMap<THREE.Material, Map<string, THREE.Material>>();
  /** Variant → det delte grundmateriale. */
  private baseOf = new WeakMap<THREE.Material, THREE.Material>();
  private timer = 0;
  private size = 128;
  /** Metal udenfor: samme HDRI som scenen, men med kraftigere refleksion. */
  private outdoor = { texture: null as THREE.Texture | null, rotationY: 0, intensity: 1 };
  private outdoorVariants = new Set<THREE.MeshStandardMaterial>();
  enabled = true;
  /** Kaldes før/efter fotograferingen (skjul møbler, hæv vægge …). Returnerer en "gendan"-funktion. */
  prepareCapture?: () => () => void;
  /** Kaldes efter at proberne er opdateret (så materialerne kan tildeles). */
  onUpdated?: () => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {
    this.pmremGen = new THREE.PMREMGenerator(renderer);
  }

  setSize(size: number) {
    if (size === this.size) return;
    this.size = size;
    this.cube?.dispose();
    this.cube = null;
    this.cubeCamera = null;
    for (const p of this.probes.values()) {
      p.pmrem?.dispose();
      p.pmrem = null;
    }
    this.schedule(50);
  }

  /** Synkroniserer proberne med husets rum. */
  setRooms(rooms: Room[], heights: (room: Room) => number) {
    const keep = new Set<string>();
    for (const r of rooms) {
      keep.add(r.key);
      const pos = new THREE.Vector3(r.labelPoint.x, Math.min(1.3, heights(r) - 0.3), r.labelPoint.z);
      const old = this.probes.get(r.key);
      if (old) {
        old.polygon = r.polygon;
        old.position.copy(pos);
      } else {
        this.probes.set(r.key, { key: r.key, polygon: r.polygon, position: pos, pmrem: null });
      }
    }
    for (const [k, p] of this.probes) {
      if (keep.has(k)) continue;
      p.pmrem?.dispose();
      this.probes.delete(k);
    }
    this.schedule();
  }

  /** Beder om en ny fotografering lidt senere (samler mange ændringer til én). */
  schedule(delay = 350) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.captureAll(), delay);
  }

  /** Rummet, et punkt ligger i (eller null udenfor). */
  roomAt(x: number, z: number): string | null {
    for (const p of this.probes.values()) if (pointInPolygon({ x, z }, p.polygon)) return p.key;
    return null;
  }

  texture(key: string | null): THREE.Texture | null {
    if (!key || !this.enabled) return null;
    return this.probes.get(key)?.pmrem?.texture ?? null;
  }

  /**
   * Opdaterer himmel-refleksionen for metal udenfor. Metal har ingen diffus farve,
   * så det lyser kun op af det, det spejler; derfor får det lidt mere af himlen
   * end resten af scenen (ellers ser messing mat og "plastikagtigt" ud).
   */
  setOutdoor(texture: THREE.Texture | null, rotationY: number, intensity: number) {
    this.outdoor = { texture, rotationY, intensity };
    for (const m of this.outdoorVariants) this.styleOutdoor(m);
  }

  private styleOutdoor(m: THREE.MeshStandardMaterial) {
    m.envMap = this.outdoor.texture;
    m.envMapRotation.set(0, this.outdoor.rotationY, 0);
    m.envMapIntensity = this.outdoor.intensity * METAL_BOOST;
  }

  captureAll() {
    if (!this.enabled || !this.probes.size) {
      this.onUpdated?.();
      return;
    }
    if (!this.cube) {
      this.cube = new THREE.WebGLCubeRenderTarget(this.size, { type: THREE.HalfFloatType, generateMipmaps: false });
      this.cubeCamera = new THREE.CubeCamera(0.05, 4000, this.cube);
    }
    const restore = this.prepareCapture?.() ?? (() => {});
    const r = this.renderer;
    const shadowAuto = r.shadowMap.autoUpdate;
    const needs = r.shadowMap.needsUpdate;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = false;
    try {
      for (const p of this.probes.values()) {
        this.cubeCamera!.position.copy(p.position);
        this.cubeCamera!.updateMatrixWorld(true);
        this.cubeCamera!.update(r, this.scene);
        p.pmrem = this.pmremGen.fromCubemap(this.cube.texture, p.pmrem);
      }
    } finally {
      r.shadowMap.autoUpdate = shadowAuto;
      r.shadowMap.needsUpdate = needs;
      restore();
    }
    this.onUpdated?.();
  }

  /**
   * Sætter rummets refleksion på en mesh. Delte materialer får en kopi pr. rum
   * (caches); unikke materialer (fx lampeskærme) ændres direkte.
   */
  applyTo(mesh: THREE.Mesh, key: string | null) {
    const tex = this.texture(key);
    const cur = mesh.material as THREE.Material;
    if (Array.isArray(cur)) return;
    const base = this.baseOf.get(cur) ?? cur;
    if (!('envMap' in base)) return;
    if (base.userData.uniquePerObject) {
      const m = base as THREE.MeshStandardMaterial;
      if (m.envMap !== tex) {
        if (!!m.envMap !== !!tex) m.needsUpdate = true;
        m.envMap = tex;
      }
      return;
    }
    const metal = ((base as THREE.MeshStandardMaterial).metalness ?? 0) >= 0.5;
    let variantKey: string | null = null;
    if (tex && key) variantKey = key;
    else if (metal && this.outdoor.texture) variantKey = OUTDOOR;
    if (!variantKey) {
      if (cur !== base) mesh.material = base;
      return;
    }
    let byRoom = this.variants.get(base);
    if (!byRoom) this.variants.set(base, (byRoom = new Map()));
    let v = byRoom.get(variantKey) as THREE.MeshStandardMaterial | undefined;
    if (!v) {
      v = (base as THREE.MeshStandardMaterial).clone();
      // clone() tager ikke shader-tilpasninger med
      v.onBeforeCompile = base.onBeforeCompile;
      v.customProgramCacheKey = base.customProgramCacheKey;
      this.baseOf.set(v, base);
      byRoom.set(variantKey, v);
      if (variantKey === OUTDOOR) {
        this.outdoorVariants.add(v);
        this.styleOutdoor(v);
      }
    }
    if (variantKey !== OUTDOOR) {
      v.envMap = tex;
      v.envMapIntensity = metal ? METAL_BOOST_INDOOR : INDOOR_BOUNCE;
    }
    if (mesh.material !== v) mesh.material = v;
  }
}

const OUTDOOR = '__ude';
/** Hvor meget kraftigere metal spejler himlen end resten af scenen. */
const METAL_BOOST = 1.8;
const METAL_BOOST_INDOOR = 1.5;
/**
 * Proben fanger kun lysets første genskin. Rigtige rum får lys fra mange
 * genskin mellem vægge, loft og gulv, så det indirekte lys forstærkes lidt.
 */
const INDOOR_BOUNCE = 1.7;
