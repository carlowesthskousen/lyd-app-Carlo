import * as THREE from 'three';

/**
 * Bløde kontaktskygger: en lille mørk "blob" lige under hvert møbel, der
 * binder det til gulvet (også dér, hvor solens skygge falder et andet sted).
 * Teksturen er en afrundet firkant med blød kant, så den passer til både
 * runde og firkantede møbler.
 */
let texture: THREE.CanvasTexture | null = null;

function blobTexture() {
  if (texture) return texture;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Afstand til en afrundet firkant (superellipse), 0 i midten → 1 i kanten
      const u = Math.abs((x + 0.5) / S - 0.5) * 2;
      const v = Math.abs((y + 0.5) / S - 0.5) * 2;
      const d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
      const a = 1 - THREE.MathUtils.smoothstep(d, 0.35, 1);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(255 * a * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

let material: THREE.MeshBasicMaterial | null = null;

function blobMaterial() {
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color: '#000000',
      alphaMap: blobTexture(),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    material.name = 'contact-shadow';
  }
  return material;
}

const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Kontaktskygge til et møbel med fodaftryk w × d (meter). */
export function createContactShadow(w: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, blobMaterial());
  // Lidt større end fodaftrykket; tynde ting (lampefødder) får en mindre, tættere blob
  const pad = Math.min(0.18, Math.max(0.06, Math.min(w, d) * 0.25));
  m.scale.set(w + pad, 1, d + pad);
  m.renderOrder = -1;
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.noAO = true;
  m.userData.contactShadow = true;
  m.raycast = () => {};
  return m;
}

/** Styrken af kontaktskyggerne (fx svagere om natten). */
export function setContactShadowStrength(k: number) {
  blobMaterial().opacity = 0.42 * k;
}
