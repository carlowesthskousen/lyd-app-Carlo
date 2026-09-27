import * as THREE from 'three';
import type { Opening } from '../state/types';
import type { Vec2 } from '../core/math2d';
import type { WallCorners, WallFrame } from './wallGraph';

export interface WallGeometries {
  sideA: THREE.BufferGeometry;
  sideB: THREE.BufferGeometry;
  rest: THREE.BufferGeometry;
}

/**
 * Bygger en vægs geometri i lokale koordinater (x langs væggen fra a, z mod side A, y op).
 * Døre og vinduer skæres ud som ægte huller, og hullernes indersider (lysninger) lukkes.
 */
export function buildWallGeometry(
  frame: WallFrame,
  corners: WallCorners,
  height: number,
  thickness: number,
  openings: Opening[],
): WallGeometries {
  const local = (p: Vec2) => {
    const rx = p.x - frame.a.x;
    const rz = p.z - frame.a.z;
    return { u: rx * frame.d.x + rz * frame.d.z, v: rx * frame.n.x + rz * frame.n.z };
  };
  const aA = local(corners.aA);
  const aB = local(corners.aB);
  const bA = local(corners.bA);
  const bB = local(corners.bB);
  const t2 = thickness / 2;
  const ops = [...openings].sort((p, q) => p.offset - q.offset);

  const side = (u0: number, u1: number, mirror: boolean) => {
    const s = mirror ? -1 : 1;
    const shape = new THREE.Shape();
    const pts: [number, number][] = [[u0, 0]];
    for (const o of ops) {
      if (o.sill > 0.001) continue;
      const l = o.offset - o.width / 2;
      const r = o.offset + o.width / 2;
      pts.push([l, 0], [l, o.height], [r, o.height], [r, 0]);
    }
    pts.push([u1, 0], [u1, height], [u0, height]);
    const mapped = pts.map(([u, y]) => new THREE.Vector2(u * s, y));
    if (mirror) mapped.reverse();
    shape.setFromPoints(mapped);
    for (const o of ops) {
      if (o.sill <= 0.001) continue;
      const l = o.offset - o.width / 2;
      const r = o.offset + o.width / 2;
      const hole = new THREE.Path();
      const hp = [
        [l, o.sill],
        [r, o.sill],
        [r, o.sill + o.height],
        [l, o.sill + o.height],
      ].map(([u, y]) => new THREE.Vector2(u * s, y));
      if (mirror) hp.reverse();
      hole.setFromPoints(hp);
      shape.holes.push(hole);
    }
    const g = new THREE.ShapeGeometry(shape);
    if (mirror) g.rotateY(Math.PI);
    g.translate(0, 0, mirror ? -t2 : t2);
    return g;
  };

  const sideA = side(aA.u, bA.u, false);
  const sideB = side(aB.u, bB.u, true);

  // Top, ender og lysninger
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (p: THREE.Vector3[], normal: THREE.Vector3, uvs?: [number, number][]) => {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    const order = n.dot(normal) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const defaultUv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const i of order) {
      pos.push(p[i].x, p[i].y, p[i].z);
      const q = (uvs ?? defaultUv)[i];
      uv.push(q[0], q[1]);
    }
  };
  const V = (u: number, y: number, v: number) => new THREE.Vector3(u, y, v);
  const up = new THREE.Vector3(0, 1, 0);

  // Top (to trekanter over hele fodaftrykket)
  quad([V(aA.u, height, aA.v), V(bA.u, height, bA.v), V(bB.u, height, bB.v), V(aB.u, height, aB.v)], up);
  // Endeflader (geringsplanerne)
  quad([V(aA.u, 0, aA.v), V(aB.u, 0, aB.v), V(aB.u, height, aB.v), V(aA.u, height, aA.v)], new THREE.Vector3(-1, 0, 0));
  quad([V(bA.u, 0, bA.v), V(bB.u, 0, bB.v), V(bB.u, height, bB.v), V(bA.u, height, bA.v)], new THREE.Vector3(1, 0, 0));
  // Lysninger
  for (const o of ops) {
    const l = o.offset - o.width / 2;
    const r = o.offset + o.width / 2;
    const y0 = o.sill;
    const y1 = o.sill + o.height;
    quad([V(l, y0, -t2), V(l, y0, t2), V(l, y1, t2), V(l, y1, -t2)], new THREE.Vector3(1, 0, 0));
    quad([V(r, y0, -t2), V(r, y0, t2), V(r, y1, t2), V(r, y1, -t2)], new THREE.Vector3(-1, 0, 0));
    quad([V(l, y1, -t2), V(r, y1, -t2), V(r, y1, t2), V(l, y1, t2)], new THREE.Vector3(0, -1, 0));
    if (y0 > 0.001) quad([V(l, y0, -t2), V(r, y0, -t2), V(r, y0, t2), V(l, y0, t2)], up);
  }
  const rest = new THREE.BufferGeometry();
  rest.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rest.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rest.computeVertexNormals();

  return { sideA, sideB, rest };
}

/** Trianguleret gulv fra en polygon i x/z-planet med normal opad og UV i meter. */
export function buildFloorGeometry(poly: Vec2[], y = 0.004): THREE.BufferGeometry {
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [i, j, k] of tris) {
    const a = poly[i], b = poly[j], c = poly[k];
    // Normal skal pege op (+y): (b-a)×(c-a) har y = dz*dx' - dx*dz'
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const tri = ny >= 0 ? [a, b, c] : [a, c, b];
    for (const p of tri) {
      pos.push(p.x, y, p.z);
      uv.push(p.x, -p.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Lav vægstump til "vægge nede"/cutaway (som i The Sims). Døre bliver ægte
 * åbninger i stumpen; vinduer (der sidder højere) påvirker ikke stumpen.
 * Stumpen deles i stykker mellem dørene; kun væggens yderender er geringsskåret.
 */
export function buildWallStub(
  frame: WallFrame,
  corners: WallCorners,
  height: number,
  thickness: number,
  openings: Opening[],
): WallGeometries {
  const local = (p: Vec2) => {
    const rx = p.x - frame.a.x;
    const rz = p.z - frame.a.z;
    return { u: rx * frame.d.x + rz * frame.d.z, v: rx * frame.n.x + rz * frame.n.z };
  };
  const aA = local(corners.aA), aB = local(corners.aB), bA = local(corners.bA), bB = local(corners.bB);
  const t2 = thickness / 2;
  // Døråbninger (alt der går helt ned til gulvet) skærer stumpen over
  const gaps = openings
    .filter((o) => o.sill <= 0.001)
    .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  type P = { u: number; v: number };
  const pieces: { sA: P; eA: P; eB: P; sB: P }[] = [];
  let startA: P = aA, startB: P = aB;
  for (const [l, r] of gaps) {
    pieces.push({ sA: startA, eA: { u: l, v: t2 }, eB: { u: l, v: -t2 }, sB: startB });
    startA = { u: r, v: t2 };
    startB = { u: r, v: -t2 };
  }
  pieces.push({ sA: startA, eA: bA, eB: bB, sB: startB });

  const sideA: number[] = [], sideAuv: number[] = [];
  const sideB: number[] = [], sideBuv: number[] = [];
  const rest: number[] = [], restUv: number[] = [];
  const quad = (pos: number[], uv: number[], p: THREE.Vector3[], normal: THREE.Vector3, uvs: [number, number][]) => {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    const order = n.dot(normal) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) {
      pos.push(p[i].x, p[i].y, p[i].z);
      uv.push(uvs[i][0], uvs[i][1]);
    }
  };
  const V = (p: P, y: number) => new THREE.Vector3(p.u, y, p.v);
  const h = height;
  for (const pc of pieces) {
    if (Math.max(pc.eA.u, pc.eB.u) - Math.min(pc.sA.u, pc.sB.u) < 0.005) continue;
    quad(sideA, sideAuv, [V(pc.sA, 0), V(pc.eA, 0), V(pc.eA, h), V(pc.sA, h)], new THREE.Vector3(0, 0, 1), [[pc.sA.u, 0], [pc.eA.u, 0], [pc.eA.u, h], [pc.sA.u, h]]);
    quad(sideB, sideBuv, [V(pc.sB, 0), V(pc.eB, 0), V(pc.eB, h), V(pc.sB, h)], new THREE.Vector3(0, 0, -1), [[-pc.sB.u, 0], [-pc.eB.u, 0], [-pc.eB.u, h], [-pc.sB.u, h]]);
    const box: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    quad(rest, restUv, [V(pc.sA, h), V(pc.eA, h), V(pc.eB, h), V(pc.sB, h)], new THREE.Vector3(0, 1, 0), box);
    quad(rest, restUv, [V(pc.sA, 0), V(pc.sB, 0), V(pc.sB, h), V(pc.sA, h)], new THREE.Vector3(-1, 0, 0), box);
    quad(rest, restUv, [V(pc.eA, 0), V(pc.eB, 0), V(pc.eB, h), V(pc.eA, h)], new THREE.Vector3(1, 0, 0), box);
  }
  const make = (pos: number[], uv: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return { sideA: make(sideA, sideAuv), sideB: make(sideB, sideBuv), rest: make(rest, restUv) };
}

/**
 * Dørens svingbue på gulvet (kvart cirkel + åbent dørblad), i vægens lokale
 * koordinater. Døren svinger ud til væggens side A.
 */
export function doorSwing(o: Opening, thickness: number, frameWidth = 0.05): { fill: THREE.BufferGeometry; line: THREE.BufferGeometry } {
  const leaves = o.style === 'door-double' ? 2 : 1;
  const inner = o.width - frameWidth * 2;
  const lw = inner / leaves;
  const left = o.offset - o.width / 2 + frameWidth;
  const v0 = thickness / 2;
  const y = 0.012;
  const fill: number[] = [];
  const line: number[] = [];
  const SEG = 18;
  for (let i = 0; i < leaves; i++) {
    // Hængsel: som i dørmodellen (spejlvendt med "flip")
    const hingeLeft = leaves === 2 ? i === 0 : !o.flip;
    const hu = hingeLeft ? left + lw * i : left + lw * (i + 1);
    const dir = hingeLeft ? 1 : -1;
    let prev: [number, number] | null = null;
    for (let s = 0; s <= SEG; s++) {
      const th = (s / SEG) * (Math.PI / 2);
      const p: [number, number] = [hu + dir * lw * Math.cos(th), v0 + lw * Math.sin(th)];
      if (prev) {
        fill.push(hu, y, v0, prev[0], y, prev[1], p[0], y, p[1]);
        line.push(prev[0], y, prev[1], p[0], y, p[1]);
      }
      prev = p;
    }
    // Det åbne dørblad
    line.push(hu, y, v0, hu, y, v0 + lw);
  }
  const f = new THREE.BufferGeometry();
  f.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
  f.computeVertexNormals();
  const l = new THREE.BufferGeometry();
  l.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  return { fill: f, line: l };
}
