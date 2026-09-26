import { describe, expect, it } from 'vitest';
import { obbOverlap, snapToWall } from '../src/furniture/placement';
import { emptyProject } from '../src/state/defaults';
import { addWall } from '../src/building/wallGraph';

describe('kollision', () => {
  const base = { hw: 0.5, hd: 0.5, rot: 0, y0: 0, y1: 1 };
  it('opdager overlap', () => {
    expect(obbOverlap({ ...base, cx: 0, cz: 0 }, { ...base, cx: 0.8, cz: 0 })).toBe(true);
    expect(obbOverlap({ ...base, cx: 0, cz: 0 }, { ...base, cx: 1.2, cz: 0 })).toBe(false);
  });
  it('tager højde for rotation', () => {
    // 45° drejet firkant rækker ~0.707 ud
    expect(obbOverlap({ ...base, cx: 0, cz: 0, rot: Math.PI / 4 }, { ...base, cx: 1.15, cz: 0 })).toBe(true);
    expect(obbOverlap({ ...base, cx: 0, cz: 0, rot: Math.PI / 4 }, { ...base, cx: 1.25, cz: 0 })).toBe(false);
  });
  it('ignorerer ting i forskellig højde', () => {
    expect(obbOverlap({ ...base, cx: 0, cz: 0 }, { ...base, cx: 0, cz: 0, y0: 1.5, y1: 2 })).toBe(false);
  });
});

describe('væg-snap', () => {
  it('sætter møblet med ryggen mod væggen og forsiden væk', () => {
    const doc = emptyProject();
    addWall(doc, { x: 0, z: 0 }, { x: 4, z: 0 }, { height: 2.6, thickness: 0.2 });
    const s = snapToWall(doc, { x: 2, z: 0.5 }, 0.4, 0.3)!;
    expect(s).not.toBeNull();
    expect(s.z).toBeCloseTo(0.1 + 0.2 + 0.004, 3);
    // Forsiden (+z lokalt) skal pege mod +z i verden
    expect(Math.sin(s.rotation)).toBeCloseTo(0);
    expect(Math.cos(s.rotation)).toBeCloseTo(1);
  });
});
