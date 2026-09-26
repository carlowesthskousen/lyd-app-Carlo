import * as THREE from 'three';
import type { Opening } from '../state/types';
import { openingStyle } from './buildCatalog';
import { basic, glassMaterial } from '../render/materials';

const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/**
 * Bygger dør-/vinduesmodel i vægens lokale koordinater:
 * x langs væggen (centreret om 0), y op, z på tværs af væggen.
 */
export function buildOpeningModel(o: Opening, thickness: number): THREE.Group {
  const g = new THREE.Group();
  const style = openingStyle(o.style);
  const frameMat = basic('#f4f2ee', 0.5);
  const handleMat = basic('#b8bbbe', 0.3, 0.9);
  const w = o.width;
  const h = o.height;
  const fw = 0.05; // karmbredde
  const depth = thickness + 0.02;

  // Karm/indfatning
  g.add(box(fw, h, depth, frameMat, -w / 2 + fw / 2, o.sill + h / 2, 0));
  g.add(box(fw, h, depth, frameMat, w / 2 - fw / 2, o.sill + h / 2, 0));
  g.add(box(w, fw, depth, frameMat, 0, o.sill + h - fw / 2, 0));

  if (o.kind === 'window') {
    g.add(box(w, fw, depth, frameMat, 0, o.sill + fw / 2, 0));
    // Vindueskarm indvendigt
    g.add(box(w + 0.08, 0.025, 0.08, basic('#ebe8e2', 0.4), 0, o.sill - 0.012, depth / 2 + 0.02));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - fw * 2, h - fw * 2), glassMaterial());
    glass.position.set(0, o.sill + h / 2, 0);
    g.add(glass);
    const glassBack = glass.clone();
    glassBack.rotation.y = Math.PI;
    g.add(glassBack);
    const split = style.variant === 'window-split' || (style.variant === 'panorama' && w > 1.5);
    if (split || w >= 1.2) {
      const n = style.variant === 'panorama' ? 3 : 2;
      for (let i = 1; i < n; i++) {
        g.add(box(0.04, h - fw * 2, 0.06, frameMat, -w / 2 + (w * i) / n, o.sill + h / 2, 0));
      }
    }
    if (style.variant === 'window-split') {
      g.add(box(w - fw * 2, 0.03, 0.05, frameMat, 0, o.sill + h * 0.62, 0));
    }
    return g;
  }

  if (o.style === 'door-opening') return g;

  // Dørblad(e)
  const leaves = style.variant === 'double' ? 2 : 1;
  const lw = (w - fw * 2) / leaves;
  const lh = h - fw - 0.01;
  for (let i = 0; i < leaves; i++) {
    const cx = -w / 2 + fw + lw * i + lw / 2;
    const leafMat = basic('#f7f6f3', 0.35);
    if (style.variant === 'glass') {
      // Ramme med glas
      const r = 0.1;
      g.add(box(lw, r, 0.04, leafMat, cx, lh - r / 2, 0));
      g.add(box(lw, r * 1.5, 0.04, leafMat, cx, r * 0.75, 0));
      g.add(box(r, lh, 0.04, leafMat, cx - lw / 2 + r / 2, lh / 2, 0));
      g.add(box(r, lh, 0.04, leafMat, cx + lw / 2 - r / 2, lh / 2, 0));
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(lw - r * 2, lh - r * 2.5), glassMaterial());
      pane.position.set(cx, r * 1.5 + (lh - r * 2.5) / 2, 0);
      g.add(pane);
      const back = pane.clone();
      back.rotation.y = Math.PI;
      g.add(back);
    } else {
      g.add(box(lw - 0.004, lh, 0.04, leafMat, cx, lh / 2, 0));
      // Fyldinger
      const panelMat = basic('#eeece8', 0.45);
      for (const side of [1, -1]) {
        g.add(box(lw * 0.62, lh * 0.34, 0.006, panelMat, cx, lh * 0.72, side * 0.022));
        g.add(box(lw * 0.62, lh * 0.34, 0.006, panelMat, cx, lh * 0.3, side * 0.022));
      }
    }
    // Håndtag på begge sider
    const hingeLeft = (i === 0) !== !!o.flip;
    const hx = hingeLeft ? cx + lw / 2 - 0.07 : cx - lw / 2 + 0.07;
    for (const side of [1, -1]) {
      const handle = box(0.12, 0.02, 0.02, handleMat, hx + (hingeLeft ? -0.04 : 0.04), 1.02, side * 0.045);
      handle.castShadow = false;
      g.add(handle);
    }
  }
  return g;
}
