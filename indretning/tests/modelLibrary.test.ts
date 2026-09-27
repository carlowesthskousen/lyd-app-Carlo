import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyBoxUv, bakeAndMerge } from '../src/furniture/modelLibrary';

describe('model-bagning', () => {
  it('bevarer kvantiseret (komprimeret) geometri, når skala bages ind', () => {
    // Som i en meshopt/KHR_mesh_quantization-GLB: Int16-positioner normaliseret til [-1, 1]
    const pos = new Int16Array([-32767, 0, 0, 32767, 0, 0, 0, 32767, 0]);
    const nor = new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3, true));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    mesh.scale.setScalar(0.34);
    const root = new THREE.Group();
    const scaler = new THREE.Group();
    scaler.scale.setScalar(2); // fx skalering til manifestets mål
    scaler.add(mesh);
    root.add(scaler);
    const out = bakeAndMerge(root, null);
    const p = (out.children[0] as THREE.Mesh).geometry.attributes.position;
    expect(p.array).toBeInstanceOf(Float32Array);
    expect(p.getX(1)).toBeCloseTo(0.68, 3); // 1 · 0.34 · 2 – ikke klippet til 1
    expect(p.getY(2)).toBeCloseTo(0.68, 3);
  });

  it('laver box-UV\'er i meter med årerne lodret på lodrette flader', () => {
    const g = new THREE.BoxGeometry(0.4, 0.8, 0.4);
    g.deleteAttribute('uv');
    applyBoxUv(g, 0.4);
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getZ(i)) > 0.9) {
        expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / 0.4);
        expect(uv.getY(i)).toBeCloseTo(pos.getY(i) / 0.4);
      }
    }
  });
});
