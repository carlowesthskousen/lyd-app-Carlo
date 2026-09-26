import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** Hjælpeobjekter til værktøjer: mål-labels, snap-markør og forhåndsvisninger. */
export class Overlay {
  readonly root = new THREE.Group();
  private labels: CSS2DObject[] = [];
  readonly cursor: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.root.userData.helper = true;
    this.root.name = 'overlay';
    scene.add(this.root);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#1d6fb8', depthTest: false, transparent: true, opacity: 0.9 }),
    );
    ring.renderOrder = 10;
    ring.visible = false;
    ring.userData.helper = true;
    this.cursor = ring;
    this.root.add(ring);
  }

  showCursor(x: number, z: number, snapped: boolean) {
    this.cursor.visible = true;
    this.cursor.position.set(x, 0.02, z);
    (this.cursor.material as THREE.MeshBasicMaterial).color.set(snapped ? '#22a06b' : '#1d6fb8');
  }

  hideCursor() {
    this.cursor.visible = false;
  }

  label(i: number, text: string, pos: THREE.Vector3, cls = 'measure-label') {
    let l = this.labels[i];
    if (!l) {
      const el = document.createElement('div');
      l = new CSS2DObject(el);
      l.userData.helper = true;
      this.labels[i] = l;
      this.root.add(l);
    }
    l.element.className = cls;
    l.element.textContent = text;
    l.position.copy(pos);
    l.visible = true;
  }

  hideLabels(from = 0) {
    for (let i = from; i < this.labels.length; i++) this.labels[i].visible = false;
  }

  clear() {
    this.hideCursor();
    this.hideLabels();
  }
}

/** Halvgennemsigtig forhåndsvisning af en væg. */
export function wallPreviewMesh(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: '#8fc3ec', transparent: true, opacity: 0.55, roughness: 0.8 }),
  );
  m.userData.helper = true;
  m.visible = false;
  return m;
}

export function placeWallPreview(m: THREE.Mesh, ax: number, az: number, bx: number, bz: number, h: number, t: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  m.visible = len > 0.01;
  m.position.set(ax, 0, az);
  m.rotation.y = Math.atan2(-dz, dx);
  m.scale.set(Math.max(len, 0.001), h, t);
}

/** Dyb kopi med egne, gennemsigtige materialer (til forhåndsvisning og slet-animation). */
export function ghostClone(obj: THREE.Object3D, opacity = 1): THREE.Object3D {
  const c = obj.clone(true);
  const labels: THREE.Object3D[] = [];
  c.traverse((o) => {
    if ((o as { isCSS2DObject?: boolean }).isCSS2DObject) labels.push(o);
  });
  for (const l of labels) l.removeFromParent();
  c.traverse((o) => {
    o.userData = { ...o.userData, helper: true };
    delete o.userData.pick;
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = mats.map((m: THREE.Material) => {
        const n = m.clone();
        n.transparent = true;
        n.opacity = Math.min(n.opacity, opacity);
        n.depthWrite = opacity >= 1;
        return n;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      o.castShadow = false;
    }
  });
  return c;
}

/** Skrumper og fader et objekt ud (bruges ved sletning). */
export function animateOut(scene: THREE.Scene, source: THREE.Object3D, duration = 0.22) {
  source.updateMatrixWorld(true);
  const ghost = ghostClone(source, 1);
  ghost.matrixAutoUpdate = false;
  // Skalér om objektets midtpunkt i verdenskoordinater.
  const box = new THREE.Box3().setFromObject(source);
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const base = source.matrixWorld.clone();
  scene.add(ghost);
  const mats: THREE.Material[] = [];
  ghost.traverse((o) => {
    if (o instanceof THREE.Mesh) mats.push(...(Array.isArray(o.material) ? o.material : [o.material]));
  });
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / (duration * 1000));
    const e = t * t * (3 - 2 * t);
    const s = 1 - 0.25 * e;
    const m = new THREE.Matrix4()
      .makeTranslation(center.x, center.y, center.z)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
      .multiply(base);
    ghost.matrix.copy(m);
    ghost.matrixWorldNeedsUpdate = true;
    for (const mat of mats) mat.opacity = 1 - e;
    if (t < 1) requestAnimationFrame(step);
    else {
      scene.remove(ghost);
      for (const mat of mats) mat.dispose();
    }
  };
  requestAnimationFrame(step);
}
