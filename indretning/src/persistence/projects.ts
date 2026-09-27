import type { ProjectDoc } from '../state/types';
import { emptyProject } from '../state/defaults';
import { uid } from '../state/ids';

const PREFIX = 'indretning:';
const INDEX_KEY = `${PREFIX}index`;
const LAST_KEY = `${PREFIX}last`;

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  walls: number;
  furniture: number;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn('Kunne ikke gemme i localStorage', err);
    return false;
  }
}

export function listProjects(): ProjectMeta[] {
  try {
    const list = JSON.parse(safeGet(INDEX_KEY) ?? '[]') as ProjectMeta[];
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveProject(doc: ProjectDoc): boolean {
  const ok = safeSet(`${PREFIX}project:${doc.id}`, JSON.stringify(doc));
  if (!ok) return false;
  const list = listProjects().filter((p) => p.id !== doc.id);
  list.push({
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updatedAt,
    walls: Object.keys(doc.walls).length,
    furniture: Object.keys(doc.furniture).length,
  });
  safeSet(INDEX_KEY, JSON.stringify(list));
  safeSet(LAST_KEY, doc.id);
  return true;
}

export function loadProject(id: string): ProjectDoc | null {
  const raw = safeGet(`${PREFIX}project:${id}`);
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.error('Projektet kunne ikke læses', err);
    return null;
  }
}

export function lastProjectId(): string | null {
  return safeGet(LAST_KEY);
}

export function deleteProject(id: string) {
  try {
    localStorage.removeItem(`${PREFIX}project:${id}`);
  } catch {
    /* ignorer */
  }
  safeSet(INDEX_KEY, JSON.stringify(listProjects().filter((p) => p.id !== id)));
}

/** Gør et indlæst/importeret dokument gyldigt og opdateret til nyeste format. */
export function migrate(raw: unknown): ProjectDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Filen indeholder ikke et projekt');
  const d = raw as Partial<ProjectDoc>;
  if (d.version !== 1) throw new Error(`Ukendt projektversion: ${String(d.version)}`);
  const base = emptyProject(d.name ?? 'Importeret projekt');
  const doc: ProjectDoc = {
    ...base,
    ...d,
    nodes: d.nodes ?? {},
    walls: d.walls ?? {},
    openings: d.openings ?? {},
    rooms: d.rooms ?? [],
    furniture: d.furniture ?? {},
    groups: d.groups ?? {},
    settings: { ...base.settings, ...(d.settings ?? {}) },
  } as ProjectDoc;
  // Fjern dinglende referencer.
  for (const [id, w] of Object.entries(doc.walls)) if (!doc.nodes[w.a] || !doc.nodes[w.b]) delete doc.walls[id];
  for (const [id, o] of Object.entries(doc.openings)) if (!doc.walls[o.wallId]) delete doc.openings[id];
  return doc;
}

export function exportJson(doc: ProjectDoc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = doc.name.replace(/[^\wæøåÆØÅ -]+/g, '').trim() || 'projekt';
  a.download = `${safe}.indretning.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importJson(file: File): Promise<ProjectDoc> {
  const text = await file.text();
  const doc = migrate(JSON.parse(text));
  // Importerede projekter får et nyt id, så de ikke overskriver eksisterende.
  doc.id = uid('p');
  doc.updatedAt = Date.now();
  return doc;
}
