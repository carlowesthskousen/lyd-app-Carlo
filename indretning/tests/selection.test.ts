import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/state/defaults';
import { addWall } from '../src/building/wallGraph';
import {
  copySelection, createGroup, expandGroups, exactGroup, pasteClip, rotateSelection, selectionCenter,
  snapshotFor, suggestGroupName, translateSnapshot, ungroup,
} from '../src/selection/selectionOps';
import { deleteRefs } from '../src/tools/actions';
import type { PickRef } from '../src/state/types';

function setup() {
  const doc = emptyProject();
  const [wallId] = addWall(doc, { x: 0, z: 0 }, { x: 4, z: 0 }, { height: 2.6, thickness: 0.15 });
  doc.openings.o1 = { id: 'o1', wallId, kind: 'door', style: 'door-90', offset: 2, width: 0.9, height: 2.05, sill: 0 };
  doc.furniture.t = { id: 't', catalogId: 'spisebord', x: 2, y: 0, z: 2, rotation: 0 };
  doc.furniture.c1 = { id: 'c1', catalogId: 'spisestol', x: 1.4, y: 0, z: 1.4, rotation: 0 };
  doc.furniture.c2 = { id: 'c2', catalogId: 'spisestol', x: 2.6, y: 0, z: 1.4, rotation: 0 };
  return { doc, wallId };
}
const F = (id: string): PickRef => ({ kind: 'furniture', id });

describe('bunke-handlinger', () => {
  it('flytter møbler og vægge sammen; døre følger væggen', () => {
    const { doc, wallId } = setup();
    const refs = [F('t'), F('c1'), { kind: 'wall', id: wallId } as PickRef];
    const snap = snapshotFor(doc, refs);
    translateSnapshot(doc, snap, 1, -0.5);
    translateSnapshot(doc, snap, 1.5, 0.5); // altid fra start – ingen drift
    expect(doc.furniture.t).toMatchObject({ x: 3.5, z: 2.5 });
    expect(doc.furniture.c1).toMatchObject({ x: 2.9, z: 1.9 });
    expect(doc.furniture.c2).toMatchObject({ x: 2.6, z: 1.4 }); // ikke markeret
    const w = doc.walls[wallId];
    expect(doc.nodes[w.a]).toMatchObject({ x: 1.5, z: 0.5 });
    expect(doc.openings.o1).toMatchObject({ wallId, offset: 2 }); // følger med væggen
  });

  it('drejer bunken om dens midtpunkt og bevarer den indbyrdes afstand', () => {
    const { doc } = setup();
    const refs = [F('c1'), F('c2')];
    const d0 = Math.hypot(doc.furniture.c1.x - doc.furniture.c2.x, doc.furniture.c1.z - doc.furniture.c2.z);
    const c0 = selectionCenter(doc, refs);
    rotateSelection(doc, refs, Math.PI / 2);
    const c1 = selectionCenter(doc, refs);
    expect(c1.x).toBeCloseTo(c0.x);
    expect(c1.z).toBeCloseTo(c0.z);
    expect(Math.hypot(doc.furniture.c1.x - doc.furniture.c2.x, doc.furniture.c1.z - doc.furniture.c2.z)).toBeCloseTo(d0);
    expect(doc.furniture.c1.rotation).toBeCloseTo(Math.PI / 2);
    // Stolen til venstre (−x) ender "foran" (+z) efter 90° (three.js' rotation.y)
    expect(doc.furniture.c1.z).toBeGreaterThan(c0.z);
  });

  it('kopierer og indsætter med nye id\'er – også vægge med døre', () => {
    const { doc, wallId } = setup();
    const clip = copySelection(doc, [F('t'), { kind: 'wall', id: wallId }]);
    const other = emptyProject(); // indsæt i et andet projekt
    const refs = pasteClip(other, clip, { x: 10, z: 10 });
    expect(refs).toHaveLength(2);
    expect(Object.keys(other.walls)).toHaveLength(1);
    expect(Object.keys(other.openings)).toHaveLength(1);
    expect(Object.keys(other.nodes)).toHaveLength(2);
    const f = Object.values(other.furniture)[0];
    expect(f.id).not.toBe('t');
    expect(selectionCenter(other, refs).x).toBeCloseTo(10);
  });

  it('grupper: klik på ét medlem markerer hele gruppen; sletning rydder op', () => {
    const { doc } = setup();
    const g = createGroup(doc, [F('t'), F('c1'), F('c2')], 'Spisebord');
    expect(expandGroups(doc, [F('c1')])).toHaveLength(3);
    expect(exactGroup(doc, [F('t'), F('c1'), F('c2')])?.id).toBe(g.id);
    deleteRefs(doc, [F('c1'), F('c2')], []);
    expect(doc.groups?.[g.id]).toBeUndefined(); // under 2 medlemmer → opløst
    const g2 = createGroup(doc, [F('t'), { kind: 'opening', id: 'o1' }], 'x');
    expect(ungroup(doc, [F('t')])).toBe(1);
    expect(doc.groups?.[g2.id]).toBeUndefined();
  });

  it('foreslår et gruppenavn ud fra indholdet', () => {
    const { doc } = setup();
    const names: Record<string, string> = { spisebord: 'Spisebord 180', spisestol: 'Spisestol' };
    expect(suggestGroupName(doc, [F('t'), F('c1'), F('c2')], (id) => names[id])).toBe('Spisebord 180 med 2 × spisestol');
  });
});
