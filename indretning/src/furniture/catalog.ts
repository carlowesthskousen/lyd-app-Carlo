import type { Finish } from '../state/types';

export type CategoryId =
  | 'stole'
  | 'borde'
  | 'sofaer'
  | 'lamper'
  | 'opbevaring'
  | 'senge'
  | 'dekoration'
  | 'koekken-bad';

export const CATEGORIES: { id: CategoryId; name: string; icon: string }[] = [
  { id: 'stole', name: 'Stole', icon: 'chair' },
  { id: 'borde', name: 'Borde', icon: 'table' },
  { id: 'sofaer', name: 'Sofaer', icon: 'sofa' },
  { id: 'lamper', name: 'Lamper', icon: 'lamp' },
  { id: 'opbevaring', name: 'Opbevaring', icon: 'shelf' },
  { id: 'senge', name: 'Senge', icon: 'bed' },
  { id: 'dekoration', name: 'Dekoration', icon: 'plant' },
  { id: 'koekken-bad', name: 'Køkken & bad', icon: 'kitchen' },
];

/** Hvor et møbel må stå. */
export type Placement = 'floor' | 'surface' | 'wall' | 'ceiling';

/**
 * Overstyring af et navngivet materiale i en GLB-model, fx for at give træet en
 * rigtig tekstur. Stier er relative til /models/.
 */
export interface MaterialOverride {
  color?: string;
  roughness?: number;
  metalness?: number;
  /** Farvetekstur (sRGB). */
  map?: string;
  /** Normal-map (OpenGL-konvention, grøn = op). */
  normalMap?: string;
  normalScale?: number;
  /** Roughness-map (gråtoner; ganges med `roughness`). */
  roughnessMap?: string;
  /** Hvor mange meter én teksturflade dækker (standard 0,5). */
  textureSize?: number;
  /**
   * Teksturkoordinater: "auto" (standard) bruger modellens UV'er og laver selv
   * box-projicerede UV'er, hvis modellen ikke har nogen. "box" laver dem altid.
   */
  uv?: 'auto' | 'box' | 'model';
}

/** Én linje i public/models/manifest.json. Se README for forklaring af felterne. */
export interface CatalogEntry {
  id: string;
  name: string;
  manufacturer?: string;
  designer?: string;
  category: CategoryId;
  /** Rigtige mål i centimeter. Modellen skaleres, så den passer præcist. */
  dimensions: { width: number; depth: number; height: number };
  /** Sti til .glb/.gltf relativt til /models/. */
  file?: string;
  /** Navn på procedural placeholder, der bruges hvis der ikke er en fil (eller den mangler). */
  procedural?: string;
  /** Sti til thumbnail (png/jpg/webp) relativt til /models/. Genereres automatisk hvis tom. */
  thumbnail?: string;
  /** Drej modellen (grader om lodret akse), hvis dens forside ikke vender mod +z. */
  rotationY?: number;
  /** "fit" (standard) strækker til præcise mål; "uniform" bevarer proportioner. */
  scaleMode?: 'fit' | 'uniform';
  /** true = hovedmaterialet kan farves. Liste = navne på materialer i GLB-filen, der kan farves. */
  recolorable?: boolean | string[];
  defaultColor?: string;
  /** Overstyr materialer i GLB-filen efter navn (farve, teksturer, roughness). */
  materials?: Record<string, MaterialOverride>;
  finishes?: Finish[];
  defaultFinish?: Finish;
  light?: { color?: string; intensity?: number; distance?: number; height?: number };
  placement?: Placement;
  /** Standardhøjde over gulv i cm (vægmonterede ting og pendler). */
  elevation?: number;
  price?: number;
  tags?: string[];
}

export interface Manifest {
  version: number;
  items: CatalogEntry[];
}

export const FINISH_NAMES: Record<Finish, string> = {
  stof: 'Stof',
  laeder: 'Læder',
  trae: 'Træ',
  lak: 'Lak',
  metal: 'Metal',
};

export class Catalog {
  readonly entries = new Map<string, CatalogEntry>();
  readonly base: string;

  constructor(base = `${import.meta.env.BASE_URL}models/`) {
    this.base = base;
  }

  async load(url = `${this.base}manifest.json`) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as Manifest;
      for (const e of manifest.items) this.add(e);
    } catch (err) {
      console.error('Kunne ikke læse møbel-manifestet', url, err);
    }
  }

  add(e: CatalogEntry) {
    const problems = validateEntry(e);
    if (problems.length) {
      console.warn(`Manifest-linjen "${e.id ?? e.name}" springes over:`, problems.join('; '));
      return;
    }
    this.entries.set(e.id, e);
  }

  get(id: string) {
    return this.entries.get(id);
  }

  byCategory(cat: CategoryId) {
    return [...this.entries.values()].filter((e) => e.category === cat);
  }

  url(path: string) {
    return /^(https?:|data:|\/)/.test(path) ? path : this.base + path;
  }
}

export function validateEntry(e: CatalogEntry): string[] {
  const p: string[] = [];
  if (!e.id) p.push('mangler "id"');
  if (!e.name) p.push('mangler "name"');
  if (!CATEGORIES.some((c) => c.id === e.category)) p.push(`ukendt kategori "${e.category}"`);
  const d = e.dimensions;
  if (!d || !(d.width > 0) || !(d.depth > 0) || !(d.height > 0)) p.push('"dimensions" skal have width, depth og height i cm');
  if (!e.file && !e.procedural) p.push('angiv enten "file" eller "procedural"');
  return p;
}

export const dimsMeters = (e: CatalogEntry) => ({
  w: e.dimensions.width / 100,
  d: e.dimensions.depth / 100,
  h: e.dimensions.height / 100,
});

export function formatDims(e: CatalogEntry) {
  const d = e.dimensions;
  return `B ${d.width} × D ${d.depth} × H ${d.height} cm`;
}
