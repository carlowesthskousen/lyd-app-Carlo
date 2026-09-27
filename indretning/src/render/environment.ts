import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * Udendørs miljølys fra et rigtigt HDRI (Poly Haven, CC0).
 *
 * - Lægger man sit eget 2K-HDRI i `public/hdri/ude.hdr`, bruges det automatisk.
 *   Ellers bruges en 512 px-udgave af Poly Havens "park"-HDRI (fra @pmndrs/assets, CC0).
 * - Solen i billedet klippes ned: det direkte sollys kommer fra spillets
 *   DirectionalLight (med skygger), så den ikke tælles med to gange.
 * - HDRI'et drejes, så dets sol står samme sted som spillets sol, og lysstyrken
 *   normaliseres, så himlen giver et realistisk forhold mellem sol og skygge.
 */

/** Himlens lysstyrke (gns. radians i den øverste halvkugle) ved fuldt dagslys. */
const SKY_TARGET = 0.32;
/** Klip værdier over dette (solskiven) – relativt til himlens middelværdi. */
const SUN_CLAMP = 24;
/**
 * Træk lidt af farven ud af HDRI'et. En dybblå himmel gør ellers messing og
 * guld gråligt i refleksionerne og giver blålige skygger.
 */
const DESATURATE = 0.4;

export interface HdriInfo {
  /** Retning til HDRI'ets sol (i HDRI'ets egne koordinater). */
  sunAzimuth: number;
  /** Gennemsnitlig radians i den øverste halvkugle efter klipning. */
  skyMean: number;
  source: string;
  width: number;
}

export class EnvironmentLight {
  texture: THREE.Texture | null = null;
  info: HdriInfo | null = null;
  private daylight = 1;
  private sunAz = 0;
  onReady?: () => void;
  /** Kaldes, når rotation eller lysstyrke ændres. */
  onChange?: () => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {}

  async load(base = import.meta.env.BASE_URL) {
    // Eget HDRI først; ellers det medfølgende (hentes som egen JS-chunk, så det virker overalt)
    let tex = await loadFirst([[`${base}hdri/ude.hdr`, 'hdr']], true);
    if (!tex) {
      const park = (await import('@pmndrs/assets/hdri/park.exr.js')).default as string;
      tex = await loadFirst([[park, 'exr']], false);
    }
    if (!tex) return;
    this.info = prepare(tex.texture, tex.url.startsWith('data:') ? 'park-512 (@pmndrs/assets)' : tex.url);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromEquirectangular(tex.texture);
    pmrem.dispose();
    tex.texture.dispose();
    this.texture = rt.texture;
    this.scene.environment = this.texture;
    this.apply();
    this.onReady?.();
  }

  /** Følger solen (retning i verden) og dagslyset (0–1). */
  setSun(dir: THREE.Vector3, daylight: number) {
    this.sunAz = Math.atan2(dir.z, dir.x);
    this.daylight = daylight;
    this.apply();
  }

  private apply() {
    const info = this.info;
    if (!info) {
      this.scene.environmentIntensity = 0.1 + 0.5 * this.daylight;
      return;
    }
    // three.js slår op i miljøet med R_y(-θ)·retning, så HDRI'ets sol havner ved spillets sol.
    this.scene.environmentRotation.set(0, info.sunAzimuth - this.sunAz, 0);
    const norm = SKY_TARGET / Math.max(0.01, info.skyMean);
    this.scene.environmentIntensity = norm * (0.07 + 0.93 * this.daylight);
    this.onChange?.();
  }
}

type Loaded = { texture: THREE.DataTexture; url: string };

async function loadFirst(list: [string, 'hdr' | 'exr'][], check: boolean): Promise<Loaded | null> {
  for (const [url, kind] of list) {
    try {
      if (check) {
        // Findes filen? (vite-dev svarer med index.html for ukendte stier)
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) continue;
      }
      const loader = kind === 'hdr' ? new HDRLoader() : new EXRLoader();
      loader.setDataType(THREE.FloatType);
      const texture = (await loader.loadAsync(url)) as THREE.DataTexture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      return { texture, url };
    } catch {
      /* prøv den næste */
    }
  }
  return null;
}

/**
 * Finder solen (den lyseste pixel), klipper den og måler himlens middelværdi.
 * EXR: række 0 er nederst (v = 0 ⇒ lige ned). HDR indlæses med flipY, så dér er række 0 øverst.
 */
export function prepare(tex: THREE.DataTexture, source = ''): HdriInfo {
  const { width: w, height: h } = tex.image;
  const data = tex.image.data as Float32Array;
  const ch = data.length / (w * h);
  let best = -1;
  let bestI = 0;
  let sum = 0;
  let weight = 0;
  const elevation = (y: number) => ((tex.flipY ? h - 1 - y : y) + 0.5) / h * Math.PI - Math.PI / 2;
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let y = 0; y < h; y++) {
    const el = elevation(y);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const l = lum(i);
      if (l > best) {
        best = l;
        bestI = y * w + x;
      }
      if (el > 0) {
        const wgt = Math.cos(el) * Math.sin(el); // rumvinkel × cos (vandret flade)
        sum += Math.min(l, 50) * wgt;
        weight += wgt;
      }
    }
  }
  const roughMean = sum / Math.max(1e-6, weight);
  const clampAt = Math.max(2, roughMean * SUN_CLAMP);
  sum = 0;
  for (let y = 0; y < h; y++) {
    const el = elevation(y);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const l = lum(i);
      if (l > clampAt) {
        const k = clampAt / l;
        data[i] *= k;
        data[i + 1] *= k;
        data[i + 2] *= k;
      }
      const g = lum(i);
      for (let c = 0; c < 3; c++) data[i + c] += (g - data[i + c]) * DESATURATE;
      if (el > 0) sum += Math.min(l, clampAt) * Math.cos(el) * Math.sin(el);
    }
  }
  tex.needsUpdate = true;
  const u = ((bestI % w) + 0.5) / w;
  return { sunAzimuth: (u - 0.5) * Math.PI * 2, skyMean: sum / Math.max(1e-6, weight), source, width: w };
}
