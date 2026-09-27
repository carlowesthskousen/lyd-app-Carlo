import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

/** En fil fra et træk-og-slip, en mappe eller en zip. */
export interface VFile {
  /** Sti inde i mappen/zip'en (fx "After/FBX/after.fbx"). */
  path: string;
  name: string;
  blob: Blob;
}

export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
/** Rækkefølge når samme model findes i flere formater. */
export const FORMAT_PRIORITY: ModelFormat[] = ['glb', 'gltf', 'fbx', 'obj'];
/** Formater vi genkender, men ikke kan åbne i browseren. */
export const UNSUPPORTED = ['dwg', 'dxf', 'skp', 'max', '3ds', 'rvt', 'rfa', 'blend', 'c4d', 'ifc', 'stp', 'step', 'igs', 'iges', '3dm', 'dae', 'usdz', 'stl', 'pdf'];

export const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';
export const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/** En model, der skal importeres, med de filer den må slå op i (teksturer, .mtl, .bin). */
export interface ImportJob {
  main: VFile;
  format: ModelFormat;
  /** Alle filer i samme træk (bruges til at finde teksturer og .mtl/.bin). */
  assets: VFile[];
  /** Mappe- eller zip-navn, hvis modellen kom fra en pakke. */
  packageName?: string;
}

export interface IntakeResult {
  jobs: ImportJob[];
  /** Filer vi sprang over, fordi browseren ikke kan læse dem. */
  skipped: string[];
  /** JSON-filer (projekt eller biblioteks-backup). */
  json: VFile[];
}

/** Læser filer fra et drop (inkl. mapper) eller en filvælger. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<VFile[]> {
  const out: VFile[] = [];
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) {
    for (const e of entries) if (e) await walk(e, '', out);
  } else {
    for (const f of dt.files) out.push({ path: f.name, name: f.name, blob: f });
  }
  return out;
}

async function walk(entry: FileSystemEntry, prefix: string, out: VFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: prefix + file.name, name: file.name, blob: file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returnerer i portioner
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

export const filesFromList = (list: FileList | File[]): VFile[] => [...list].map((f) => ({ path: f.name, name: f.name, blob: f }));

/** Pakker zip-filer ud (også zip i zip, én gang). */
async function expandZips(files: VFile[]): Promise<VFile[]> {
  const out: VFile[] = [];
  for (const f of files) {
    if (ext(f.name) !== 'zip') {
      out.push(f);
      continue;
    }
    const data = unzipSync(new Uint8Array(await f.blob.arrayBuffer()));
    const base = stem(f.name);
    for (const [p, bytes] of Object.entries(data)) {
      if (p.endsWith('/') || p.startsWith('__MACOSX/') || p.split('/').pop()!.startsWith('._')) continue;
      const name = p.split('/').pop()!;
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      if (ext(name) === 'zip') out.push(...(await expandZips([{ path: `${base}/${p}`, name, blob }])));
      else out.push({ path: `${base}/${p}`, name, blob });
    }
  }
  return out;
}

/** Normaliserer et modelnavn til gruppering: "After_Chair_FBX" og "after-chair" hører sammen. */
function groupKey(name: string) {
  return stem(name)
    .toLowerCase()
    .replace(/[_\-.\s]+/g, ' ')
    .replace(/\b(fbx|obj|glb|gltf|3d|model|mesh|low|high|lod\d*|v\d+|\d{4})\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finder de modeller, der skal importeres. Samme model i flere formater → det
 * bedste format vælges (GLB > glTF > FBX > OBJ). Filer som .dwg, .skp og .max ignoreres.
 */
export async function analyzeFiles(input: VFile[]): Promise<IntakeResult> {
  const files = await expandZips(input);
  const skipped: string[] = [];
  const json: VFile[] = [];
  const models: VFile[] = [];
  for (const f of files) {
    const e = ext(f.name);
    if ((FORMAT_PRIORITY as string[]).includes(e)) models.push(f);
    else if (e === 'json') json.push(f);
    else if (UNSUPPORTED.includes(e)) skipped.push(f.name);
  }
  const packageName = packageOf(input);
  // Gruppér: fra en pakke (mappe/zip) er det som regel ét møbel i flere formater.
  const groups = new Map<string, VFile[]>();
  const single = !!packageName && new Set(models.map((m) => groupKey(m.name))).size <= 3;
  for (const m of models) {
    const k = single ? '*' : groupKey(m.name);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(m);
  }
  const jobs: ImportJob[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => FORMAT_PRIORITY.indexOf(ext(a.name) as ModelFormat) - FORMAT_PRIORITY.indexOf(ext(b.name) as ModelFormat) || b.blob.size - a.blob.size);
    const main = g[0];
    jobs.push({ main, format: ext(main.name) as ModelFormat, assets: files, packageName });
  }
  return { jobs, skipped, json };
}

function packageOf(input: VFile[]): string | undefined {
  const zip = input.find((f) => ext(f.name) === 'zip');
  if (zip) return stem(zip.name);
  const dirs = new Set(input.map((f) => f.path.split('/')[0]).filter((_, i) => input[i].path.includes('/')));
  return dirs.size === 1 ? [...dirs][0] : undefined;
}
