import type { ProjectDoc, ProjectSettings } from './types';

export type ChangeReason = 'edit' | 'preview' | 'undo' | 'redo' | 'load' | 'settings';

interface HistoryEntry {
  label: string;
  before: ProjectDoc;
  after: ProjectDoc;
}

type Listener = (reason: ChangeReason) => void;

const MAX_HISTORY = 200;

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Central state med transaktionsbaseret fortryd/gentag.
 *
 * Alle ændringer af dokumentet sker i en transaktion:
 *   store.transact('Tegn væg', (doc) => { ... })
 * eller over flere frames (fx træk med musen):
 *   store.begin(); store.update(fn); ...; store.commit('Flyt møbel')
 * Hver transaktion bliver én post i historikken.
 */
export class Store {
  doc: ProjectDoc;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private pendingBefore: ProjectDoc | null = null;
  private depth = 0;
  private listeners = new Set<Listener>();

  constructor(doc: ProjectDoc) {
    this.doc = doc;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: ChangeReason) {
    for (const l of this.listeners) l(reason);
  }

  get inTransaction() {
    return this.depth > 0;
  }

  begin() {
    if (this.depth === 0) this.pendingBefore = clone(this.doc);
    this.depth++;
  }

  /** Ændring inde i en åben transaktion (vises med det samme, men gemmes først i historikken ved commit). */
  update(fn: (doc: ProjectDoc) => void) {
    const implicit = this.depth === 0;
    if (implicit) this.begin();
    fn(this.doc);
    if (implicit) this.commit('Ændring');
    else this.emit('preview');
  }

  commit(label: string): boolean {
    if (this.depth === 0) return false;
    this.depth--;
    if (this.depth > 0) return false;
    const before = this.pendingBefore!;
    this.pendingBefore = null;
    if (sameDoc(before, this.doc)) {
      this.emit('preview');
      return false;
    }
    this.doc.updatedAt = Date.now();
    this.past.push({ label, before, after: clone(this.doc) });
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.emit('edit');
    return true;
  }

  cancel() {
    if (this.depth === 0) return;
    this.depth = 0;
    if (this.pendingBefore) this.doc = this.pendingBefore;
    this.pendingBefore = null;
    this.emit('undo');
  }

  transact(label: string, fn: (doc: ProjectDoc) => void): boolean {
    this.begin();
    try {
      fn(this.doc);
    } catch (err) {
      this.cancel();
      throw err;
    }
    return this.commit(label);
  }

  /** Indstillinger (tidspunkt, vægvisning, snap) går uden om historikken. */
  setSettings(patch: Partial<ProjectSettings>) {
    Object.assign(this.doc.settings, patch);
    this.emit('settings');
  }

  canUndo() {
    return this.past.length > 0 && this.depth === 0;
  }

  canRedo() {
    return this.future.length > 0 && this.depth === 0;
  }

  undoLabel() {
    return this.past[this.past.length - 1]?.label;
  }

  redoLabel() {
    return this.future[this.future.length - 1]?.label;
  }

  undo(): string | null {
    if (!this.canUndo()) return null;
    const e = this.past.pop()!;
    this.future.push(e);
    this.restore(e.before);
    this.emit('undo');
    return e.label;
  }

  redo(): string | null {
    if (!this.canRedo()) return null;
    const e = this.future.pop()!;
    this.past.push(e);
    this.restore(e.after);
    this.emit('redo');
    return e.label;
  }

  /** Indstillinger og kamera følger ikke med i fortryd. */
  private restore(snapshot: ProjectDoc) {
    const settings = this.doc.settings;
    const camera = this.doc.camera;
    this.doc = clone(snapshot);
    this.doc.settings = settings;
    this.doc.camera = camera;
  }

  load(doc: ProjectDoc) {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.depth = 0;
    this.pendingBefore = null;
    this.emit('load');
  }
}

function sameDoc(a: ProjectDoc, b: ProjectDoc): boolean {
  const strip = (d: ProjectDoc) =>
    JSON.stringify({ ...d, updatedAt: 0, camera: undefined, settings: undefined });
  return strip(a) === strip(b);
}
