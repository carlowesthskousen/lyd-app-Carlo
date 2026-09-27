import type { CategoryId } from '../furniture/catalog';

export type Unit = 'mm' | 'cm' | 'm' | 'in';

export const UNIT_FACTORS: Record<Unit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 };
export const UNIT_NAMES: Record<Unit, string> = { mm: 'millimeter', cm: 'centimeter', m: 'meter', in: 'tommer' };

/**
 * Gætter modellens enhed ud fra dens største mål. Møbler er typisk 0,3–2,5 m;
 * vi vælger den enhed, der giver en størrelse tættest på ~0,9 m (på log-skala).
 * Ved tvivl mellem cm og tommer foretrækkes cm (europæiske producenter).
 */
export function guessUnit(maxSize: number): Unit {
  if (!(maxSize > 0)) return 'm';
  let best: Unit = 'm';
  let bestScore = Infinity;
  for (const u of ['mm', 'cm', 'm', 'in'] as Unit[]) {
    const meters = maxSize * UNIT_FACTORS[u];
    let score = Math.abs(Math.log(meters / 0.9));
    if (meters < 0.08 || meters > 6) score += 3;
    if (u === 'in') score += 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

/** "after_chair-FBX_v2" → "After chair". */
export function guessName(fileName: string): string {
  const s = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(fbx|obj|glb|gltf|3d|model|mesh|lod\d*|v\d+|final|export)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Mit møbel';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const KEYWORDS: [CategoryId, RegExp][] = [
  ['lamper', /lamp|lampe|light|pendant|pendel|sconce|lys|chandelier|spot/i],
  ['sofaer', /sofa|couch|settee|daybed|pouf|puf|ottoman|lounge ?module/i],
  ['stole', /chair|stol|stool|taburet|armchair|bench|bænk|seat/i],
  ['borde', /table|bord|desk|skrivebord/i],
  ['senge', /bed\b|seng|bedside|nightstand|natbord/i],
  ['opbevaring', /shelf|shelving|reol|cabinet|skab|sideboard|skænk|dresser|kommode|wardrobe|garderobe|storage|drawer/i],
  ['koekken-bad', /kitchen|køkken|sink|vask|toilet|bath|bad|fridge|oven|faucet/i],
];

export function guessCategory(text: string): CategoryId {
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return 'dekoration';
}
