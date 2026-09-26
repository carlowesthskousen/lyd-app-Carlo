import { describe, expect, it } from 'vitest';
import { Store } from '../src/state/store';
import { emptyProject } from '../src/state/defaults';
import { addWall } from '../src/building/wallGraph';

describe('fortryd/gentag', () => {
  it('fortryder og gentager transaktioner', () => {
    const s = new Store(emptyProject());
    s.transact('Tegn væg', (d) => addWall(d, { x: 0, z: 0 }, { x: 3, z: 0 }, { height: 2.6, thickness: 0.15 }));
    s.transact('Tegn væg', (d) => addWall(d, { x: 3, z: 0 }, { x: 3, z: 3 }, { height: 2.6, thickness: 0.15 }));
    expect(Object.keys(s.doc.walls)).toHaveLength(2);
    expect(s.undo()).toBe('Tegn væg');
    expect(Object.keys(s.doc.walls)).toHaveLength(1);
    s.redo();
    expect(Object.keys(s.doc.walls)).toHaveLength(2);
  });

  it('samler et træk over flere frames til én post', () => {
    const s = new Store(emptyProject());
    s.transact('Placér', (d) => (d.furniture.a = { id: 'a', catalogId: 'x', x: 0, y: 0, z: 0, rotation: 0 }));
    s.begin();
    for (let i = 1; i <= 10; i++) s.update((d) => (d.furniture.a.x = i));
    s.commit('Flyt');
    expect(s.undoLabel()).toBe('Flyt');
    s.undo();
    expect(s.doc.furniture.a.x).toBe(0);
  });

  it('lader indstillinger være uden for historikken', () => {
    const s = new Store(emptyProject());
    s.setSettings({ timeOfDay: 20 });
    expect(s.canUndo()).toBe(false);
  });
});
