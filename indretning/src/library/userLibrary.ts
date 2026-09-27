import type { Catalog, CatalogEntry } from '../furniture/catalog';

/**
 * "Mine møbler": møbler importeret i spillet. De gemmes KUN lokalt i browseren
 * (IndexedDB) – aldrig i repoet eller på en offentlig side. Hver vare gemmes som
 * en GLB (konverteret ved import) plus dens katalog-linje.
 */
export interface StoredFurniture {
  id: string;
  entry: CatalogEntry;
  glb: ArrayBuffer;
  createdAt: number;
  updatedAt: number;
}

/** Backup-format for hele biblioteket (én fil). */
export interface LibraryBackup {
  type: 'indretning-bibliotek';
  version: 1;
  exportedAt: string;
  items: { entry: CatalogEntry; glb: string; createdAt: number; updatedAt: number }[];
}

const DB_NAME = 'indretning';
const STORE = 'mine-moebler';

export class UserLibrary {
  private db: IDBDatabase | null = null;
  /** Hvis IndexedDB ikke er tilgængelig (fx privat vindue), holdes møblerne kun i hukommelsen. */
  private memory = new Map<string, StoredFurniture>();
  private urls = new Map<string, string>();
  available = true;

  async open(): Promise<void> {
    if (this.db) return;
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB er ikke tilgængelig – Mine møbler gemmes ikke mellem besøg', err);
      this.available = false;
    }
  }

  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = this.db!.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async all(): Promise<StoredFurniture[]> {
    await this.open();
    if (!this.db) return [...this.memory.values()];
    return this.tx('readonly', (s) => s.getAll() as IDBRequest<StoredFurniture[]>);
  }

  async get(id: string): Promise<StoredFurniture | undefined> {
    await this.open();
    if (!this.db) return this.memory.get(id);
    return this.tx('readonly', (s) => s.get(id) as IDBRequest<StoredFurniture | undefined>);
  }

  async put(item: StoredFurniture): Promise<void> {
    await this.open();
    if (!this.db) {
      this.memory.set(item.id, item);
      return;
    }
    await this.tx('readwrite', (s) => s.put(item));
  }

  async delete(id: string): Promise<void> {
    await this.open();
    if (!this.db) this.memory.delete(id);
    else await this.tx('readwrite', (s) => s.delete(id));
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  /** Gør en gemt vare klar i kataloget (GLB'en serveres som blob-URL). */
  register(catalog: Catalog, item: StoredFurniture): CatalogEntry {
    const old = this.urls.get(item.id);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(new Blob([item.glb], { type: 'model/gltf-binary' }));
    this.urls.set(item.id, url);
    const entry: CatalogEntry = { ...item.entry, file: url, source: 'user' };
    catalog.add(entry);
    return entry;
  }

  async loadInto(catalog: Catalog): Promise<number> {
    const items = await this.all();
    for (const it of items) this.register(catalog, it);
    return items.length;
  }

  async exportBackup(): Promise<Blob> {
    const items = await this.all();
    const backup: LibraryBackup = {
      type: 'indretning-bibliotek',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: items.map((it) => ({
        entry: { ...it.entry, file: undefined },
        glb: toBase64(it.glb),
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      })),
    };
    return new Blob([JSON.stringify(backup)], { type: 'application/json' });
  }

  /** Importerer en backup. Varer med samme id overskrives. Returnerer antallet. */
  async importBackup(data: unknown, catalog: Catalog): Promise<number> {
    const b = data as LibraryBackup;
    if (!b || b.type !== 'indretning-bibliotek' || !Array.isArray(b.items)) throw new Error('Filen er ikke en biblioteks-backup');
    let n = 0;
    for (const it of b.items) {
      if (!it.entry?.id || !it.glb) continue;
      const item: StoredFurniture = {
        id: it.entry.id,
        entry: { ...it.entry, source: 'user' },
        glb: fromBase64(it.glb),
        createdAt: it.createdAt ?? Date.now(),
        updatedAt: it.updatedAt ?? Date.now(),
      };
      await this.put(item);
      this.register(catalog, item);
      n++;
    }
    return n;
  }
}

export const isLibraryBackup = (d: unknown): d is LibraryBackup => (d as LibraryBackup)?.type === 'indretning-bibliotek';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}
