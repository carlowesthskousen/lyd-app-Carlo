import { beforeEach, describe, expect, it } from 'vitest';
import { AdaptiveQuality } from '../src/render/adaptiveQuality';
import type { Viewport } from '../src/render/Viewport';

// Minimal browser-omgivelse til node
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: { devicePixelRatio: 2 },
  document: { hidden: false },
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
});

function fakeViewport() {
  const q = { pixelRatio: 2, ssao: true, shadowSize: 2048 };
  return { quality: q, setQuality: (p: Partial<typeof q>) => Object.assign(q, p) } as unknown as Viewport & { quality: typeof q };
}

/** Kør et antal sekunder ved en given fps. */
function run(aq: AdaptiveQuality, seconds: number, fps: number, moving: boolean) {
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) aq.tick(dt, moving);
}

describe('dynamisk kvalitet', () => {
  let vp: ReturnType<typeof fakeViewport>;
  let aq: AdaptiveQuality;
  beforeEach(() => {
    store.clear();
    vp = fakeViewport();
    aq = new AdaptiveQuality(vp, () => false);
  });

  it('slår først SSAO fra og sænker så opløsningen i små trin – kun under bevægelse', () => {
    run(aq, 2, 25, true);
    expect(vp.quality.ssao).toBe(false);
    expect(vp.quality.pixelRatio).toBe(2);
    run(aq, 2, 25, true);
    expect(vp.quality.pixelRatio).toBe(1.75);
    run(aq, 2, 25, true);
    expect(vp.quality.pixelRatio).toBe(1.5);
    expect(aq.degraded).toBe(true);
    expect(aq.note).toContain('1,5×');
  });

  it('renderer altid i fuld opløsning, når kameraet står stille', () => {
    run(aq, 6, 25, true);
    expect(vp.quality.pixelRatio).toBeLessThan(2);
    run(aq, 0.5, 25, false);
    expect(vp.quality.pixelRatio).toBe(2);
    expect(vp.quality.ssao).toBe(true);
    // Lav fps mens man står stille sænker ikke noget yderligere
    run(aq, 5, 20, false);
    expect(vp.quality.pixelRatio).toBe(2);
  });

  it('går automatisk op igen, når fps er stabil over 55', () => {
    run(aq, 6, 25, true);
    expect(aq.degraded).toBe(true);
    run(aq, 20, 60, true);
    expect(aq.degraded).toBe(false);
    expect(vp.quality.pixelRatio).toBe(2);
    expect(vp.quality.ssao).toBe(true);
  });

  it('ignorerer målinger mens noget blokerer (dialog, import, indlæsning)', () => {
    let blocked = true;
    aq = new AdaptiveQuality(vp, () => blocked);
    run(aq, 10, 10, true);
    expect(aq.degraded).toBe(false);
    blocked = false;
    aq.pause(3000); // fx fanen er lige blevet aktiv
    run(aq, 1, 10, true);
    expect(aq.degraded).toBe(false);
  });

  it('"Skarp" sænker aldrig opløsningen (kun SSAO) og huskes', () => {
    aq.update({ resolution: 'sharp' });
    run(aq, 20, 15, true);
    expect(vp.quality.pixelRatio).toBe(2);
    expect(vp.quality.ssao).toBe(false);
    const again = new AdaptiveQuality(fakeViewport(), () => false);
    expect(again.settings.resolution).toBe('sharp');
  });
});
