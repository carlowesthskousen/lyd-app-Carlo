import { describe, expect, it } from 'vitest';
import { guessCategory, guessName, guessUnit } from '../src/import/guess';
import { analyzeFiles, type VFile } from '../src/import/intake';
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';

const vf = (path: string, data: string | Uint8Array = 'x'): VFile => ({ path, name: path.split('/').pop()!, blob: new Blob([data as BlobPart]) });

describe('gæt ved import', () => {
  it('gætter enheden ud fra størrelsen', () => {
    expect(guessUnit(0.82)).toBe('m'); // stol i meter
    expect(guessUnit(82)).toBe('cm'); // stol i cm
    expect(guessUnit(820)).toBe('mm'); // stol i mm
    expect(guessUnit(2250)).toBe('mm'); // sofa i mm
    expect(guessUnit(2.25)).toBe('m');
    expect(guessUnit(180)).toBe('cm'); // seng i cm
    expect(guessUnit(32)).toBe('in'); // stol i tommer
  });

  it('laver et pænt navn ud fra filnavnet', () => {
    expect(guessName('after_chair-FBX_v2.fbx')).toBe('After chair');
    expect(guessName('Series7-3D-model.glb')).toBe('Series7');
  });

  it('gætter kategori', () => {
    expect(guessCategory('Egg Lounge Chair')).toBe('stole');
    expect(guessCategory('pendant_lamp')).toBe('lamper');
    expect(guessCategory('Sofa 3 pers')).toBe('sofaer');
    expect(guessCategory('Vase')).toBe('dekoration');
  });
});

describe('valg af fil i en producent-pakke', () => {
  it('foretrækker GLB > FBX > OBJ og springer CAD-filer over', async () => {
    const r = await analyzeFiles([
      vf('Stol/DWG/stol.dwg'),
      vf('Stol/SKP/stol.skp'),
      vf('Stol/OBJ/stol.obj'),
      vf('Stol/FBX/stol.fbx'),
      vf('Stol/stol.max'),
    ]);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].format).toBe('fbx');
    expect(r.skipped.sort()).toEqual(['stol.dwg', 'stol.max', 'stol.skp']);
    const r2 = await analyzeFiles([vf('Stol/stol.fbx'), vf('Stol/stol.glb')]);
    expect(r2.jobs[0].format).toBe('glb');
  });

  it('pakker zip-filer ud', async () => {
    const zip = zipSync({ 'Lampe/OBJ/lampe.obj': strToU8('v 0 0 0'), 'Lampe/OBJ/lampe.mtl': strToU8(''), 'Lampe/lampe.dwg': strToU8('') });
    const r = await analyzeFiles([vf('lampe.zip', zip)]);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].main.name).toBe('lampe.obj');
    expect(r.jobs[0].assets.map((a) => a.name)).toContain('lampe.mtl');
    expect(r.skipped).toEqual(['lampe.dwg']);
  });

  it('importerer flere forskellige løse filer hver for sig', async () => {
    const r = await analyzeFiles([vf('stol.fbx'), vf('bord.obj'), vf('bord.mtl')]);
    expect(r.jobs.map((j) => j.main.name).sort()).toEqual(['bord.obj', 'stol.fbx']);
  });
});
