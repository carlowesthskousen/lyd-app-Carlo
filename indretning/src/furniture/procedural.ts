import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, basic, emissiveMaterial, glassMaterial } from '../render/materials';

/**
 * Procedurale placeholder-møbler. Hver generator får målene i meter
 * (w = bredde langs x, d = dybde langs z, h = højde) og bygger et møbel med
 * forsiden mod +z og origo midt på gulvet under møblet.
 *
 * Materialet med navnet "main" er det, brugeren kan skifte farve/finish på.
 * Materialet med navnet "shade" lyser, når lampen er tændt.
 */

export interface ProcMaterials {
  main: THREE.Material;
}

type Gen = (w: number, d: number, h: number, m: ProcMaterials) => THREE.Group;

const oak = () => basic(PALETTE.oak, 0.6);
const walnut = () => basic(PALETTE.walnut, 0.55);
const black = () => basic(PALETTE.black, 0.5, 0.2);
const steel = () => basic(PALETTE.steel, 0.3, 0.9);
const white = () => basic(PALETTE.white, 0.4);

function box(g: THREE.Group, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rot = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = rot;
  g.add(m);
  return m;
}

function rbox(g: THREE.Group, w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number) {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function cyl(g: THREE.Group, rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/** Fire ben placeret indenfor (w, d) med afstand inset fra kanten. */
function legs(g: THREE.Group, w: number, d: number, h: number, t: number, inset: number, mat: THREE.Material, round = false) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset - t / 2);
      const z = sz * (d / 2 - inset - t / 2);
      if (round) cyl(g, t / 2, t / 2 * 0.8, h, mat, x, h / 2, z, 12);
      else box(g, t, h, t, mat, x, h / 2, z);
    }
}

const shade = (color = '#fff3dc') => {
  const m = emissiveMaterial(color).clone();
  m.name = 'shade';
  return m;
};

const gens: Record<string, Gen> = {
  diningChair(w, d, h, m) {
    const g = new THREE.Group();
    const seatH = 0.46;
    legs(g, w, d, seatH - 0.03, 0.03, 0.02, oak(), true);
    rbox(g, w, 0.04, d, 0.015, m.main, 0, seatH - 0.02, 0);
    // Ryg
    for (const sx of [-1, 1]) box(g, 0.03, h - seatH, 0.03, oak(), sx * (w / 2 - 0.035), seatH + (h - seatH) / 2, -d / 2 + 0.035);
    rbox(g, w - 0.02, 0.16, 0.025, 0.01, m.main, 0, h - 0.1, -d / 2 + 0.03);
    return g;
  },
  armchair(w, d, h, m) {
    const g = new THREE.Group();
    legs(g, w, d, 0.14, 0.035, 0.05, walnut(), true);
    rbox(g, w, 0.2, d, 0.04, m.main, 0, 0.24, 0);
    rbox(g, w - 0.24, 0.12, d - 0.2, 0.05, m.main, 0, 0.39, 0.06);
    rbox(g, w, h - 0.14, 0.18, 0.06, m.main, 0, 0.14 + (h - 0.14) / 2, -d / 2 + 0.09);
    for (const sx of [-1, 1]) rbox(g, 0.12, 0.42, d - 0.05, 0.05, m.main, sx * (w / 2 - 0.06), 0.35, 0.02);
    return g;
  },
  officeChair(w, d, h, m) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      box(g, 0.04, 0.03, w / 2, black(), (Math.sin(a) * w) / 4, 0.06, (Math.cos(a) * w) / 4, a);
      const c = cyl(g, 0.025, 0.025, 0.04, black(), (Math.sin(a) * w) / 2.1, 0.025, (Math.cos(a) * w) / 2.1, 10);
      c.rotation.z = Math.PI / 2;
    }
    cyl(g, 0.025, 0.03, 0.38, steel(), 0, 0.26, 0);
    rbox(g, w * 0.85, 0.08, d * 0.8, 0.03, m.main, 0, 0.48, 0.02);
    rbox(g, w * 0.8, h - 0.62, 0.06, 0.03, m.main, 0, 0.55 + (h - 0.62) / 2, -d * 0.36);
    box(g, 0.04, 0.2, 0.04, black(), 0, 0.5, -d * 0.36);
    return g;
  },
  stool(w, d, h, m) {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = cyl(g, 0.013, 0.016, h - 0.03, black(), Math.sin(a) * w * 0.36, (h - 0.03) / 2, Math.cos(a) * d * 0.36, 8);
      leg.rotation.set(Math.cos(a) * 0.08, 0, -Math.sin(a) * 0.08);
    }
    const r = new THREE.Mesh(new THREE.TorusGeometry(w * 0.33, 0.008, 6, 24), black());
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.28;
    g.add(r);
    cyl(g, w / 2, w / 2 - 0.01, 0.04, m.main, 0, h - 0.02, 0);
    return g;
  },
  diningTable(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w, 0.03, d, m.main, 0, h - 0.015, 0);
    legs(g, w, d, h - 0.03, 0.06, 0.08, m.main);
    box(g, w - 0.26, 0.08, 0.025, m.main, 0, h - 0.07, d / 2 - 0.1);
    box(g, w - 0.26, 0.08, 0.025, m.main, 0, h - 0.07, -d / 2 + 0.1);
    return g;
  },
  roundTable(w, _d, h, m) {
    const g = new THREE.Group();
    cyl(g, w / 2, w / 2, 0.03, m.main, 0, h - 0.015, 0, 48);
    cyl(g, 0.05, 0.05, h - 0.05, m.main, 0, (h - 0.05) / 2 + 0.02, 0);
    cyl(g, w * 0.25, w * 0.28, 0.03, m.main, 0, 0.015, 0, 36);
    return g;
  },
  coffeeTable(w, d, h, m) {
    const g = new THREE.Group();
    rbox(g, w, 0.035, d, 0.01, m.main, 0, h - 0.018, 0);
    box(g, w - 0.08, 0.02, d - 0.08, m.main, 0, 0.12, 0);
    legs(g, w, d, h - 0.035, 0.035, 0.03, black(), true);
    return g;
  },
  sideTable(w, _d, h, m) {
    const g = new THREE.Group();
    cyl(g, w / 2, w / 2, 0.02, m.main, 0, h - 0.01, 0, 40);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      cyl(g, 0.01, 0.01, h - 0.02, black(), Math.sin(a) * w * 0.38, (h - 0.02) / 2, Math.cos(a) * w * 0.38, 8);
    }
    return g;
  },
  desk(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w, 0.025, d, m.main, 0, h - 0.0125, 0);
    for (const sx of [-1, 1]) {
      box(g, 0.03, h - 0.025, d - 0.06, black(), sx * (w / 2 - 0.05), (h - 0.025) / 2, 0);
    }
    box(g, 0.4, 0.14, d - 0.08, m.main, w / 2 - 0.3, h - 0.095, 0);
    box(g, w - 0.14, 0.3, 0.015, black(), 0, h - 0.3, -d / 2 + 0.04);
    return g;
  },
  sofa(w, d, h, m) {
    const g = new THREE.Group();
    const arm = 0.18;
    const seats = w > 2 ? 3 : 2;
    legs(g, w, d, 0.12, 0.03, 0.06, walnut(), true);
    rbox(g, w, 0.2, d, 0.04, m.main, 0, 0.22, 0);
    const sw = (w - arm * 2) / seats;
    for (let i = 0; i < seats; i++) {
      rbox(g, sw - 0.01, 0.14, d - 0.24, 0.05, m.main, -w / 2 + arm + sw * i + sw / 2, 0.39, 0.06);
      rbox(g, sw - 0.02, 0.36, 0.16, 0.07, m.main, -w / 2 + arm + sw * i + sw / 2, 0.6, -d / 2 + 0.26);
    }
    rbox(g, w, h - 0.12, 0.2, 0.06, m.main, 0, 0.12 + (h - 0.12) / 2, -d / 2 + 0.1);
    for (const sx of [-1, 1]) rbox(g, arm, 0.5, d, 0.06, m.main, sx * (w / 2 - arm / 2), 0.37, 0);
    return g;
  },
  sofaChaise(w, d, h, m) {
    const g = gens.sofa(w, 0.95, h, m);
    g.position.z = -(d - 0.95) / 2;
    const out = new THREE.Group();
    out.add(g);
    // Chaiselong-del til højre
    const cw = 0.9;
    rbox(out, cw, 0.2, d - 0.95 + 0.1, 0.04, m.main, w / 2 - cw / 2, 0.22, d / 2 - (d - 0.95 + 0.1) / 2);
    rbox(out, cw - 0.2, 0.14, d - 0.95, 0.05, m.main, w / 2 - cw / 2 - 0.05, 0.39, d / 2 - (d - 0.95) / 2 - 0.02);
    rbox(out, 0.18, 0.5, d - 0.95 + 0.1, 0.06, m.main, w / 2 - 0.09, 0.37, d / 2 - (d - 0.95 + 0.1) / 2);
    return out;
  },
  pouf(w, _d, h, m) {
    const g = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 32), m.main);
    p.position.y = h / 2;
    p.scale.set(1, 1, 1);
    g.add(p);
    const t = new THREE.Mesh(new THREE.TorusGeometry(w / 2 - 0.03, 0.03, 10, 40), m.main);
    t.rotation.x = Math.PI / 2;
    t.position.y = h - 0.03;
    g.add(t);
    return g;
  },
  floorLamp(w, _d, h, m) {
    const g = new THREE.Group();
    cyl(g, w * 0.4, w * 0.42, 0.025, black(), 0, 0.0125, 0, 32);
    cyl(g, 0.012, 0.012, h - 0.3, m.main, 0, (h - 0.3) / 2, 0, 10);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.34, w / 2, 0.32, 32, 1, true), shade());
    (s.material as THREE.Material).side = THREE.DoubleSide;
    s.position.y = h - 0.16;
    g.add(s);
    return g;
  },
  tableLamp(w, _d, h, m) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(w * 0.3, 24, 16), m.main);
    body.scale.y = 1.2;
    body.position.y = w * 0.36;
    g.add(body);
    cyl(g, 0.008, 0.008, h * 0.35, black(), 0, w * 0.5 + h * 0.15, 0, 8);
    const s = cyl(g, w * 0.34, w / 2, h * 0.4, shade(), 0, h - h * 0.2, 0, 32);
    (s.material as THREE.Material).side = THREE.DoubleSide;
    return g;
  },
  pendant(w, _d, h, m) {
    const g = new THREE.Group();
    // Pendlen hænger fra loftet; modellen går fra y=0 (skærmens bund) til h.
    cyl(g, 0.004, 0.004, h * 0.6, black(), 0, h * 0.7, 0, 6);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), m.main);
    dome.scale.y = (h * 0.4) / (w / 2);
    dome.position.y = 0;
    dome.userData.doubleSide = true;
    g.add(dome);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), shade('#fff1d6'));
    bulb.position.y = 0.04;
    g.add(bulb);
    cyl(g, 0.03, 0.03, 0.02, black(), 0, h - 0.01, 0, 12);
    return g;
  },
  bookshelf(w, d, h, m) {
    const g = new THREE.Group();
    const t = 0.02;
    for (const sx of [-1, 1]) box(g, t, h, d, m.main, sx * (w / 2 - t / 2), h / 2, 0);
    box(g, w, t, d, m.main, 0, h - t / 2, 0);
    box(g, w - t * 2, 0.005, d, m.main, 0, h / 2, -d / 2 + 0.003);
    const shelves = 5;
    const colors = ['#8c5a44', '#445d7a', '#c2b28f', '#3f6150', '#a23e3e', '#d8cfbd', '#2f3542'];
    let ci = 0;
    for (let i = 0; i < shelves; i++) {
      const y = 0.05 + (i * (h - 0.1)) / shelves;
      box(g, w - t * 2, t, d - 0.01, m.main, 0, y, 0.005);
      if (i === 0) continue;
      // Bøger
      let x = -w / 2 + t + 0.02;
      while (x < w / 2 - 0.12) {
        const bw = 0.025 + ((ci * 37) % 5) * 0.008;
        const bh = 0.2 + ((ci * 13) % 7) * 0.015;
        box(g, bw, bh, d * 0.7, basic(colors[ci % colors.length], 0.8), x + bw / 2, y + t / 2 + bh / 2, 0);
        x += bw + 0.003;
        ci++;
        if (ci % 9 === 0) x += 0.12;
      }
    }
    return g;
  },
  dresser(w, d, h, m) {
    const g = new THREE.Group();
    legs(g, w, d, 0.12, 0.03, 0.04, oak(), true);
    rbox(g, w, h - 0.12, d, 0.01, m.main, 0, 0.12 + (h - 0.12) / 2, 0);
    const n = 3;
    const dh = (h - 0.16) / n;
    for (let i = 0; i < n; i++) {
      const y = 0.14 + dh * i + dh / 2;
      box(g, w - 0.03, dh - 0.012, 0.01, m.main, 0, y, d / 2);
      box(g, 0.14, 0.018, 0.02, oak(), 0, y, d / 2 + 0.012);
    }
    return g;
  },
  sideboard(w, d, h, m) {
    const g = new THREE.Group();
    legs(g, w, d, 0.16, 0.03, 0.05, black(), true);
    rbox(g, w, h - 0.16, d, 0.01, m.main, 0, 0.16 + (h - 0.16) / 2, 0);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      box(g, w / n - 0.012, h - 0.19, 0.01, m.main, x, 0.16 + (h - 0.16) / 2, d / 2);
      box(g, 0.012, 0.1, 0.02, oak(), x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.04), 0.16 + (h - 0.16) / 2, d / 2 + 0.012);
    }
    return g;
  },
  wardrobe(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w, h - 0.05, d, m.main, 0, 0.05 + (h - 0.05) / 2, 0);
    box(g, w - 0.04, 0.05, d - 0.04, black(), 0, 0.025, 0);
    const n = w > 1.2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      box(g, w / n - 0.006, h - 0.07, 0.012, m.main, x, 0.05 + (h - 0.05) / 2, d / 2 + 0.006);
      box(g, 0.015, 0.4, 0.025, steel(), x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), h * 0.55, d / 2 + 0.02);
    }
    return g;
  },
  tvBench(w, d, h, m) {
    const g = new THREE.Group();
    legs(g, w, d, 0.1, 0.025, 0.05, black(), true);
    rbox(g, w, h - 0.1, d, 0.01, m.main, 0, 0.1 + (h - 0.1) / 2, 0);
    box(g, w * 0.5, h - 0.14, 0.01, walnut(), -w * 0.2, 0.1 + (h - 0.1) / 2, d / 2);
    return g;
  },
  bed(w, d, h, m) {
    const g = new THREE.Group();
    const frameH = 0.3;
    legs(g, w, d, 0.1, 0.05, 0.03, oak());
    box(g, w, frameH - 0.1, d, m.main, 0, 0.1 + (frameH - 0.1) / 2, 0);
    rbox(g, w - 0.04, 0.22, d - 0.06, 0.04, white(), 0, frameH + 0.1, 0.01);
    // Sengetæppe
    rbox(g, w + 0.02, 0.05, d * 0.62, 0.02, basic('#d5cbb9', 0.95), 0, frameH + 0.21, d * 0.18);
    // Puder
    const pillows = w > 1.2 ? 2 : 1;
    for (let i = 0; i < pillows; i++) {
      const x = pillows === 1 ? 0 : (i - 0.5) * (w / 2);
      rbox(g, Math.min(0.6, w / pillows - 0.1), 0.12, 0.4, 0.05, basic('#f4f2ee', 0.95), x, frameH + 0.26, -d / 2 + 0.3);
    }
    // Gavl
    rbox(g, w + 0.04, h, 0.08, 0.03, m.main, 0, h / 2, -d / 2 + 0.04);
    return g;
  },
  nightstand(w, d, h, m) {
    const g = new THREE.Group();
    legs(g, w, d, 0.2, 0.025, 0.03, oak(), true);
    rbox(g, w, h - 0.2, d, 0.01, m.main, 0, 0.2 + (h - 0.2) / 2, 0);
    box(g, w - 0.03, (h - 0.2) * 0.45, 0.01, m.main, 0, h - (h - 0.2) * 0.3, d / 2);
    box(g, 0.1, 0.015, 0.02, oak(), 0, h - (h - 0.2) * 0.3, d / 2 + 0.012);
    return g;
  },
  plant(w, _d, h, m) {
    const g = new THREE.Group();
    const potH = Math.min(0.4, h * 0.28);
    cyl(g, w * 0.36, w * 0.28, potH, m.main, 0, potH / 2, 0, 28);
    cyl(g, w * 0.33, w * 0.33, 0.01, basic('#3b2d22', 1), 0, potH - 0.01, 0, 24);
    const leaf = basic('#4f7a45', 0.7);
    const leaf2 = basic('#6b9557', 0.7);
    cyl(g, 0.012, 0.015, h - potH, basic('#5b4a33', 0.9), 0, potH + (h - potH) / 2, 0, 6);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      const y = potH + (h - potH) * (0.3 + (i / 14) * 0.65);
      const s = new THREE.Mesh(new THREE.SphereGeometry(w * 0.22, 10, 8), i % 2 ? leaf : leaf2);
      s.scale.set(1, 0.35, 0.6);
      s.position.set(Math.sin(a) * w * 0.26, y, Math.cos(a) * w * 0.26);
      s.rotation.set(0.4, a, 0.3);
      g.add(s);
    }
    return g;
  },
  plantSmall(w, _d, h, m) {
    const g = new THREE.Group();
    cyl(g, w * 0.4, w * 0.32, h * 0.45, m.main, 0, h * 0.225, 0, 20);
    const leaf = basic('#5d8a4f', 0.7);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const s = new THREE.Mesh(new THREE.SphereGeometry(w * 0.2, 8, 6), leaf);
      s.scale.set(1, 0.5, 0.6);
      s.position.set(Math.sin(a) * w * 0.18, h * 0.5 + (i / 9) * h * 0.4, Math.cos(a) * w * 0.18);
      g.add(s);
    }
    return g;
  },
  rug(w, d, _h, m) {
    const g = new THREE.Group();
    const r = rbox(g, w, 0.01, d, 0.004, m.main, 0, 0.005, 0);
    r.userData.noShadow = true;
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.16, 0.002, d - 0.16),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.12 }),
    );
    border.userData.noShadow = true;
    border.position.y = 0.0105;
    g.add(border);
    return g;
  },
  picture(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w, h, d, m.main, 0, h / 2, 0);
    const colors = ['#d9b36c', '#7c9cb4', '#c2644b', '#e9e4da'];
    box(g, w - 0.08, h - 0.08, 0.004, basic('#f5f2ea', 0.9), 0, h / 2, d / 2);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(Math.min(w, h) * (0.12 + i * 0.04), 32), basic(colors[i], 0.9));
      c.position.set((i - 1) * w * 0.2, h / 2 + (i % 2 ? 0.05 : -0.04), d / 2 + 0.003 + i * 0.0005);
      g.add(c);
    }
    return g;
  },
  mirror(w, d, h, m) {
    const g = new THREE.Group();
    rbox(g, w, h, d, 0.02, m.main, 0, h / 2, 0);
    const mm = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, h - 0.06), basic('#dfe7ea', 0.02, 1));
    mm.position.set(0, h / 2, d / 2 + 0.002);
    g.add(mm);
    return g;
  },
  vase(w, _d, h, m) {
    const g = new THREE.Group();
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2((w / 2) * (0.55 + 0.45 * Math.sin(Math.PI * (0.15 + t * 0.85))) , t * h));
    }
    const v = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), m.main);
    v.userData.doubleSide = true;
    g.add(v);
    return g;
  },
  tv(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w * 0.3, 0.015, d * 3, black(), 0, 0.0075, 0);
    box(g, 0.05, 0.08, 0.03, black(), 0, 0.05, -0.01);
    box(g, w, h - 0.08, d, m.main, 0, 0.08 + (h - 0.08) / 2, 0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, h - 0.1), basic('#111316', 0.15, 0.3));
    screen.position.set(0, 0.08 + (h - 0.08) / 2, d / 2 + 0.001);
    g.add(screen);
    return g;
  },
  kitchenCounter(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w - 0.02, 0.1, d - 0.06, black(), 0, 0.05, -0.02);
    box(g, w, h - 0.14, d - 0.03, m.main, 0, 0.1 + (h - 0.14) / 2, -0.015);
    box(g, w, 0.04, d, basic('#dcd8d0', 0.3), 0, h - 0.02, 0);
    const n = Math.max(1, Math.round(w / 0.6));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      box(g, w / n - 0.006, h - 0.16, 0.012, m.main, x, 0.1 + (h - 0.14) / 2, d / 2 - 0.02);
      box(g, 0.16, 0.012, 0.02, steel(), x, h - 0.1, d / 2 - 0.005);
    }
    return g;
  },
  kitchenSink(w, d, h, m) {
    const g = gens.kitchenCounter(w, d, h, m);
    box(g, 0.5, 0.005, 0.38, steel(), 0, h + 0.001, 0);
    const tap = cyl(g, 0.012, 0.012, 0.3, steel(), 0, h + 0.15, -d / 2 + 0.1, 10);
    tap.castShadow = true;
    box(g, 0.02, 0.02, 0.18, steel(), 0, h + 0.29, -d / 2 + 0.18);
    return g;
  },
  stove(w, d, h, m) {
    const g = gens.kitchenCounter(w, d, h, m);
    box(g, w - 0.04, 0.006, d - 0.08, basic('#141414', 0.1), 0, h + 0.003, 0);
    for (const [x, z, r] of [[-0.14, -0.1, 0.09], [0.14, -0.1, 0.07], [-0.14, 0.12, 0.07], [0.14, 0.12, 0.09]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 32), basic('#555555', 0.4));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x * (w / 0.6), h + 0.007, z);
      g.add(ring);
    }
    return g;
  },
  fridge(w, d, h, m) {
    const g = new THREE.Group();
    rbox(g, w, h, d, 0.02, m.main, 0, h / 2, 0);
    box(g, w - 0.01, 0.006, 0.01, basic('#999999', 0.4), 0, h * 0.62, d / 2 + 0.001);
    for (const y of [h * 0.45, h * 0.75]) box(g, 0.02, 0.3, 0.03, steel(), w / 2 - 0.06, y, d / 2 + 0.02);
    return g;
  },
  toilet(w, d, h, m) {
    const g = new THREE.Group();
    const porcelain = m.main;
    rbox(g, w, h * 0.4, 0.18, 0.03, porcelain, 0, h - h * 0.2, -d / 2 + 0.09);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w * 0.3, 0.4, 32), porcelain);
    bowl.scale.z = 1.35;
    bowl.position.set(0, 0.2, 0.05);
    g.add(bowl);
    const seat = new THREE.Mesh(new THREE.TorusGeometry(w * 0.4, 0.03, 8, 32), porcelain);
    seat.rotation.x = Math.PI / 2;
    seat.scale.y = 1.35;
    seat.position.set(0, 0.41, 0.05);
    g.add(seat);
    return g;
  },
  bathtub(w, d, h, m) {
    const g = new THREE.Group();
    const t = 0.06;
    rbox(g, w, h, d, 0.04, m.main, 0, h / 2, 0);
    const water = new THREE.Mesh(new THREE.BoxGeometry(w - t * 2, 0.01, d - t * 2), basic('#bcd6e0', 0.05));
    water.position.y = h - 0.001;
    g.add(water);
    cyl(g, 0.015, 0.015, 0.12, steel(), 0, h + 0.06, -d / 2 + 0.03, 10);
    return g;
  },
  bathSink(w, d, h, m) {
    const g = new THREE.Group();
    box(g, w, h - 0.15, d, basic(PALETTE.oak, 0.6), 0, (h - 0.15) / 2 + 0.3, 0);
    rbox(g, w, 0.15, d, 0.03, m.main, 0, h - 0.075, 0);
    cyl(g, 0.012, 0.012, 0.18, steel(), 0, h + 0.09, -d / 2 + 0.06, 10);
    return g;
  },
  glassTable(w, d, h, _m) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), glassMaterial());
    top.position.y = h - 0.006;
    g.add(top);
    legs(g, w, d, h - 0.012, 0.02, 0.03, steel());
    return g;
  },
};

export const PROCEDURAL_KINDS = Object.keys(gens);

export function buildProcedural(kind: string, w: number, d: number, h: number, main: THREE.Material): THREE.Group {
  const gen = gens[kind] ?? fallbackBox;
  const g = gen(w, d, h, { main });
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = !o.userData.noShadow;
      o.receiveShadow = true;
    }
  });
  return g;
}

function fallbackBox(w: number, d: number, h: number, m: ProcMaterials) {
  const g = new THREE.Group();
  rbox(g, w, h, d, 0.02, m.main, 0, h / 2, 0);
  return g;
}
