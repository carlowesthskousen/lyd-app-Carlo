import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/state/defaults';
import { addWall, computeWallCorners, detectRooms, openingFits, removeWall } from '../src/building/wallGraph';
import type { ProjectDoc } from '../src/state/types';

const opts = { height: 2.6, thickness: 0.2 };

function box(doc: ProjectDoc, x0: number, z0: number, x1: number, z1: number) {
  addWall(doc, { x: x0, z: z0 }, { x: x1, z: z0 }, opts);
  addWall(doc, { x: x1, z: z0 }, { x: x1, z: z1 }, opts);
  addWall(doc, { x: x1, z: z1 }, { x: x0, z: z1 }, opts);
  addWall(doc, { x: x0, z: z1 }, { x: x0, z: z0 }, opts);
}

describe('væg-graf', () => {
  it('finder et lukket rum og dets indvendige areal', () => {
    const doc = emptyProject();
    box(doc, 0, 0, 4, 3);
    expect(Object.keys(doc.nodes)).toHaveLength(4);
    const rooms = detectRooms(doc);
    expect(rooms).toHaveLength(1);
    // Indvendigt: (4 - 0.2) x (3 - 0.2)
    expect(rooms[0].area).toBeCloseTo(3.8 * 2.8, 5);
  });

  it('laver pæne geringshjørner', () => {
    const doc = emptyProject();
    box(doc, 0, 0, 4, 3);
    const corners = computeWallCorners(doc);
    const all = [...corners.values()].flatMap((c) => [c.aA, c.aB, c.bA, c.bB]);
    // Hjørnerne ligger præcis på ±0.1 fra midterlinjen.
    for (const p of all) {
      expect([-0.1, 0.1, 3.9, 4.1]).toContainEqual(Number(p.x.toFixed(4)));
      expect([-0.1, 0.1, 2.9, 3.1]).toContainEqual(Number(p.z.toFixed(4)));
    }
  });

  it('deler et rum i to, når en væg krydser det', () => {
    const doc = emptyProject();
    box(doc, 0, 0, 6, 4);
    addWall(doc, { x: 3, z: -1 }, { x: 3, z: 5 }, opts);
    const rooms = detectRooms(doc);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].area + rooms[1].area).toBeCloseTo(2.8 * 3.8 * 2, 3);
  });

  it('flytter døre med, når en væg deles', () => {
    const doc = emptyProject();
    const [id] = addWall(doc, { x: 0, z: 0 }, { x: 6, z: 0 }, opts);
    doc.openings.o1 = { id: 'o1', wallId: id, kind: 'door', style: 'door-90', offset: 4.5, width: 0.9, height: 2.1, sill: 0 };
    addWall(doc, { x: 3, z: -1 }, { x: 3, z: 1 }, opts);
    const o = doc.openings.o1;
    expect(o.wallId).not.toBe(id);
    expect(o.offset).toBeCloseTo(1.5);
  });

  it('sletter døre og løse noder sammen med væggen', () => {
    const doc = emptyProject();
    const [id] = addWall(doc, { x: 0, z: 0 }, { x: 4, z: 0 }, opts);
    doc.openings.o1 = { id: 'o1', wallId: id, kind: 'window', style: 'w', offset: 2, width: 1, height: 1, sill: 0.9 };
    removeWall(doc, id);
    expect(Object.keys(doc.openings)).toHaveLength(0);
    expect(Object.keys(doc.nodes)).toHaveLength(0);
  });

  it('afviser åbninger der overlapper eller rager ud', () => {
    const doc = emptyProject();
    const [id] = addWall(doc, { x: 0, z: 0 }, { x: 4, z: 0 }, opts);
    expect(openingFits(doc, id, { offset: 2, width: 0.9, height: 2.1, sill: 0 })).toBe(true);
    expect(openingFits(doc, id, { offset: 0.3, width: 0.9, height: 2.1, sill: 0 })).toBe(false);
    doc.openings.o1 = { id: 'o1', wallId: id, kind: 'door', style: 'd', offset: 2, width: 0.9, height: 2.1, sill: 0 };
    expect(openingFits(doc, id, { offset: 2.5, width: 0.9, height: 2.1, sill: 0 })).toBe(false);
  });
});
