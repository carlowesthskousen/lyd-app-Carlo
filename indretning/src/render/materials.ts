import * as THREE from 'three';
import type { Finish, FloorMaterial, WallMaterial } from '../state/types';
import {
  TEXTURE_SIZE_M,
  brickTexture,
  carpetTexture,
  concreteTexture,
  fabricTexture,
  plasterTexture,
  tilesTexture,
  woodTexture,
} from './textures';

/**
 * Delte materialer. Alle vægge/gulve med samme materiale deler én instans,
 * hvilket holder antallet af shader-skift nede.
 */
const cache = new Map<string, THREE.MeshStandardMaterial>();

function withRepeat(tex: THREE.Texture, meters: number): THREE.Texture {
  // Geometriens UV'er er i meter; én kopi pr. tekstur-størrelse.
  const t = tex.clone();
  t.repeat.set(1 / meters, 1 / meters);
  t.needsUpdate = true;
  return t;
}

export function floorMaterial(m: FloorMaterial): THREE.MeshStandardMaterial {
  const key = `floor:${m.type}:${m.color}`;
  let mat = cache.get(key);
  if (mat) return mat;
  const color = new THREE.Color(m.color);
  switch (m.type) {
    case 'wood':
      mat = new THREE.MeshStandardMaterial({ color, map: withRepeat(woodTexture(), TEXTURE_SIZE_M.wood), roughness: 0.55 });
      break;
    case 'tiles': {
      const t = withRepeat(tilesTexture(), TEXTURE_SIZE_M.tiles);
      mat = new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 1.2, roughness: 0.25 });
      break;
    }
    case 'concrete':
      mat = new THREE.MeshStandardMaterial({ color, map: withRepeat(concreteTexture(), TEXTURE_SIZE_M.concrete), roughness: 0.8 });
      break;
    case 'carpet': {
      const t = withRepeat(carpetTexture(), TEXTURE_SIZE_M.carpet);
      mat = new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 0.6, roughness: 1 });
      break;
    }
  }
  mat.name = key;
  cache.set(key, mat);
  return mat;
}

export function wallMaterial(m: WallMaterial): THREE.MeshStandardMaterial {
  const key = `wall:${m.type}:${m.color}`;
  let mat = cache.get(key);
  if (mat) return mat;
  const color = new THREE.Color(m.color);
  switch (m.type) {
    case 'paint':
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      break;
    case 'brick': {
      const t = withRepeat(brickTexture(), TEXTURE_SIZE_M.brick);
      mat = new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 2, roughness: 0.9 });
      break;
    }
    case 'plaster': {
      const t = withRepeat(plasterTexture(), TEXTURE_SIZE_M.plaster);
      mat = new THREE.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 1.5, roughness: 0.95 });
      break;
    }
  }
  mat.name = key;
  cache.set(key, mat);
  return mat;
}

export function trimMaterial(): THREE.MeshStandardMaterial {
  let m = cache.get('trim');
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#e9e5de', roughness: 0.85 });
    cache.set('trim', m);
  }
  return m;
}

export function finishMaterial(finish: Finish, color: string): THREE.MeshStandardMaterial {
  const key = `finish:${finish}:${color}`;
  let mat = cache.get(key);
  if (mat) return mat;
  const c = new THREE.Color(color);
  switch (finish) {
    case 'stof': {
      const t = withRepeat(fabricTexture(), TEXTURE_SIZE_M.fabric);
      mat = new THREE.MeshStandardMaterial({ color: c, map: t, roughness: 0.95 });
      break;
    }
    case 'laeder':
      mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 });
      break;
    case 'trae':
      mat = new THREE.MeshStandardMaterial({ color: c, map: withRepeat(woodTexture(), 1.2), roughness: 0.6 });
      break;
    case 'lak':
      mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.22 });
      break;
    case 'metal':
      mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 1 });
      break;
  }
  mat.name = key;
  cache.set(key, mat);
  return mat;
}

/** Faste materialer til procedurale møbler. */
export const PALETTE = {
  oak: '#c69c6d',
  walnut: '#6b4a33',
  white: '#f2f0eb',
  black: '#2a2a2a',
  steel: '#b9bcbf',
  brass: '#c9a45c',
  linen: '#d9d2c5',
  green: '#6f8f5e',
  terracotta: '#b8674a',
};

export function basic(color: string, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  const key = `basic:${color}:${roughness}:${metalness}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    m.name = key;
    cache.set(key, m);
  }
  return m;
}

export function glassMaterial(): THREE.MeshPhysicalMaterial {
  const key = 'glass';
  let m = cache.get(key) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      color: '#dfeef5',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    m.name = key;
    cache.set(key, m as unknown as THREE.MeshStandardMaterial);
  }
  return m;
}

export function emissiveMaterial(color: string): THREE.MeshStandardMaterial {
  const key = `emissive:${color}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.6 });
    m.name = key;
    cache.set(key, m);
  }
  return m;
}

/**
 * Opalglas (lampeskærme): mælkehvidt glas med let transmission, så det får en
 * blød gradient i stedet for at være kridhvidt. Når lampen er tændt, gløder det
 * indefra (stærkest midt på, svagere mod kanterne) – og bloom får lyset til at brede sig.
 */
const opalMaterials = new Set<THREE.MeshPhysicalMaterial>();
let opalTransmission = true;

export function opalMaterial(color = '#f6f2ea'): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.55,
    metalness: 0,
    transmission: 0.42,
    thickness: 0.015,
    ior: 1.46,
    attenuationColor: new THREE.Color('#efdcc0'),
    attenuationDistance: 0.06,
    specularIntensity: 0.6,
    side: THREE.DoubleSide,
    emissive: new THREE.Color('#ffd9a8'),
    emissiveIntensity: 0,
  });
  m.name = 'shade';
  m.userData.opal = true;
  applyOpalShader(m);
  return m;
}

/** Sætter glød-gradienten på (også efter clone(), som ikke tager den med). */
export function applyOpalShader(m: THREE.Material) {
  if (!(m instanceof THREE.MeshPhysicalMaterial)) return;
  m.userData.opal = true;
  m.userData.uniquePerObject = true;
  m.transmission = opalTransmission ? 0.42 : 0;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  {
    float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
    totalEmissiveRadiance *= mix(0.3, 1.25, pow(facing, 0.7));
  }`,
    );
  };
  m.customProgramCacheKey = () => 'opal-v1';
  opalMaterials.add(m);
}

/** Slår transmission til/fra (kvalitet "Lav" slår den fra for at spare et render-pass). */
export function setOpalTransmission(on: boolean) {
  if (on === opalTransmission) return;
  opalTransmission = on;
  for (const m of opalMaterials) {
    m.transmission = on ? 0.42 : 0;
    m.needsUpdate = true;
  }
}
