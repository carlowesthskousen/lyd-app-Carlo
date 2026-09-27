import * as THREE from 'three';
import { maxAnisotropy } from '../render/anisotropy';
import { fabricTexture, TEXTURE_SIZE_M } from '../render/textures';

/**
 * Materiale-forudindstillinger til importerede møbler (og manifestets "materials").
 * Træ og læder bruger teksturerne i public/models/textures/ (se tools/generate-textures.mjs).
 * Teksturerede forudindstillinger får automatisk box-projicerede UV'er, hvis modellen mangler dem.
 */
export interface MaterialPreset {
  id: string;
  name: string;
  /** Farve til listevisning. */
  swatch: string;
  /** Teksturmappe under models/textures/ (albedo.jpg, normal.png, roughness.jpg). */
  textures?: string;
  /** Meter pr. teksturflade. */
  textureSize?: number;
  color: string;
  roughness: number;
  metalness?: number;
  normalScale?: number;
  opacity?: number;
  /** Ekstra lys, fx opal-glas i lampeskærme. */
  emissive?: string;
  fabric?: boolean;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'ask', name: 'Ask (hvidpigmenteret)', swatch: '#e6dccb', textures: 'ask-hvidpigmenteret', textureSize: 0.4, color: '#ffffff', roughness: 1, normalScale: 0.6 },
  { id: 'eg', name: 'Eg', swatch: '#c49a6c', textures: 'eg-natur', textureSize: 0.4, color: '#ffffff', roughness: 1, normalScale: 0.6 },
  { id: 'valnoed', name: 'Valnød', swatch: '#6b4a33', textures: 'valnoed', textureSize: 0.4, color: '#ffffff', roughness: 1, normalScale: 0.5 },
  { id: 'sort-lak', name: 'Sort lak', swatch: '#1d1d1f', color: '#1a1a1c', roughness: 0.22 },
  { id: 'hvid-lak', name: 'Hvid lak', swatch: '#f2f0eb', color: '#f2f0eb', roughness: 0.28 },
  { id: 'naturlaeder', name: 'Naturlæder', swatch: '#a86e45', textures: 'laeder', textureSize: 0.2, color: '#b67a4c', roughness: 1, normalScale: 0.5 },
  { id: 'sort-laeder', name: 'Sort læder', swatch: '#232122', textures: 'laeder', textureSize: 0.2, color: '#2a2728', roughness: 0.9, normalScale: 0.5 },
  { id: 'stof', name: 'Stof (uld)', swatch: '#b9b3a6', color: '#b9b3a6', roughness: 0.95, fabric: true },
  { id: 'messing', name: 'Messing', swatch: '#c8a14a', color: '#d4ae5a', roughness: 0.28, metalness: 1 },
  { id: 'krom', name: 'Krom', swatch: '#d9dcdf', color: '#eceef0', roughness: 0.07, metalness: 1 },
  { id: 'opal-glas', name: 'Opal glas', swatch: '#f4f3ef', color: '#f7f6f2', roughness: 0.35, opacity: 0.92, emissive: '#ffffff' },
  { id: 'klart-glas', name: 'Klart glas', swatch: '#dfeef5', color: '#e8f3f7', roughness: 0.04, opacity: 0.22 },
];

export const presetById = (id: string | undefined) => MATERIAL_PRESETS.find((p) => p.id === id);

const texCache = new Map<string, Promise<THREE.Texture>>();

function loadTex(url: string, srgb: boolean) {
  const key = `${url}|${srgb}`;
  let p = texCache.get(key);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAnisotropy();
      return t;
    });
    texCache.set(key, p);
  }
  return p;
}

/** Stien til modelmappen (samme base som kataloget). */
const modelsBase = () => `${import.meta.env.BASE_URL}models/`;

/**
 * Bygger et materiale ud fra en forudindstilling. Returnerer også, om det er
 * tekstureret (så modellen skal have UV'er) og teksturens størrelse i meter.
 */
export async function createPresetMaterial(
  id: string,
  name: string,
  base = modelsBase(),
): Promise<{ material: THREE.MeshStandardMaterial; textured: boolean; textureSize: number } | null> {
  const p = presetById(id);
  if (!p) return null;
  const m = new THREE.MeshStandardMaterial({
    name,
    color: p.color,
    roughness: p.roughness,
    metalness: p.metalness ?? 0,
  });
  if (p.opacity !== undefined && p.opacity < 1) {
    m.transparent = true;
    m.opacity = p.opacity;
    m.depthWrite = p.opacity > 0.5;
  }
  if (p.emissive) {
    m.emissive.set(p.emissive);
    m.emissiveIntensity = 0.15;
  }
  let textured = false;
  let textureSize = p.textureSize ?? 0.5;
  if (p.textures) {
    const dir = `${base}textures/${p.textures}/`;
    const [map, normal, rough] = await Promise.all([
      loadTex(`${dir}albedo.jpg`, true),
      loadTex(`${dir}normal.png`, false),
      loadTex(`${dir}roughness.jpg`, false),
    ]);
    m.map = map;
    m.normalMap = normal;
    m.normalScale.setScalar(p.normalScale ?? 1);
    m.roughnessMap = rough;
    textured = true;
  } else if (p.fabric) {
    // Stoffets tekstur er i meter-skala (UV = meter / textureSize)
    const t = fabricTexture();
    m.map = t;
    textured = true;
    textureSize = TEXTURE_SIZE_M.fabric;
  }
  return { material: m, textured, textureSize };
}
