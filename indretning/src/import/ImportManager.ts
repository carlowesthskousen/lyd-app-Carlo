import type { App } from '../app';
import { type VFile, analyzeFiles, filesFromDataTransfer, filesFromList } from './intake';
import { ImportDialog } from './ImportDialog';
import { UserLibrary, isLibraryBackup } from '../library/userLibrary';
import type { CatalogEntry } from '../furniture/catalog';

/**
 * Samler import-flowet: træk-og-slip eller filvælger → vælg bedste fil →
 * dialog → gem i Mine møbler (IndexedDB) → vis i kataloget.
 */
export class ImportManager {
  readonly library = new UserLibrary();
  private busy = false;

  constructor(private app: App) {}

  /** Indlæser Mine møbler i kataloget (før projektet åbnes, så gemte projekter virker). */
  async init() {
    const n = await this.library.loadInto(this.app.catalog);
    if (!this.library.available) this.app.toast('Browseren tillader ikke lokal lagring – importerede møbler gemmes kun, indtil siden lukkes');
    return n;
  }

  bindDropZone() {
    const overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.innerHTML = '<div><b>Slip for at importere</b><span>.glb · .gltf · .fbx · .obj · mapper · .zip</span></div>';
    document.body.append(overlay);
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      overlay.classList.add('show');
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.classList.remove('show');
    });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.classList.remove('show');
      const files = await filesFromDataTransfer(e.dataTransfer!);
      await this.handleFiles(files);
    });
  }

  pickFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.glb,.gltf,.fbx,.obj,.mtl,.bin,.zip,.png,.jpg,.jpeg,.webp,.tga,.bmp';
    input.addEventListener('change', () => {
      if (input.files?.length) void this.handleFiles(filesFromList(input.files));
    });
    input.click();
  }

  async handleFiles(files: VFile[]) {
    if (this.busy) {
      this.app.toast('Afslut den igangværende import først');
      return;
    }
    this.busy = true;
    try {
      const result = await analyzeFiles(files);
      for (const j of result.json) await this.handleJson(j);
      if (result.skipped.length) {
        const list = result.skipped.slice(0, 3).join(', ') + (result.skipped.length > 3 ? ` + ${result.skipped.length - 3} til` : '');
        this.app.toast(`Sprang over ${list} (kan ikke åbnes i browseren)`);
      }
      if (!result.jobs.length) {
        if (!result.json.length) this.app.toast('Ingen 3D-model fundet. Brug .glb, .gltf, .fbx eller .obj (evt. i en .zip)');
        return;
      }
      let added = 0;
      for (let i = 0; i < result.jobs.length; i++) {
        const r = await new ImportDialog().open(result.jobs[i], { index: i, total: result.jobs.length });
        if (r === null) break;
        if (r === 'skip') continue;
        await this.save(r.entry, r.glb, true);
        added++;
      }
      if (added) {
        this.app.showMine();
        this.app.toast(added === 1 ? 'Møblet er tilføjet til Mine møbler' : `${added} møbler er tilføjet til Mine møbler`);
      }
    } catch (err) {
      console.error(err);
      this.app.toast(`Importen fejlede: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async handleJson(f: VFile) {
    try {
      const data = JSON.parse(await f.blob.text());
      if (isLibraryBackup(data)) {
        const n = await this.library.importBackup(data, this.app.catalog);
        this.afterLibraryChange();
        this.app.toast(`Importerede ${n} møbler til Mine møbler`);
      } else if (data?.version === 1 && data?.nodes) {
        await this.app.importProject(new File([JSON.stringify(data)], f.name));
      } else this.app.toast(`${f.name} er hverken et projekt eller en biblioteks-backup`);
    } catch (err) {
      this.app.toast(`Kunne ikke læse ${f.name}: ${(err as Error).message}`);
    }
  }

  private async save(entry: CatalogEntry, glb: ArrayBuffer, isNew: boolean) {
    const now = Date.now();
    const old = isNew ? undefined : await this.library.get(entry.id);
    const item = { id: entry.id, entry: { ...entry, file: undefined }, glb, createdAt: old?.createdAt ?? now, updatedAt: now };
    await this.library.put(item);
    this.library.register(this.app.catalog, item);
    this.app.catalogItemChanged(entry.id);
  }

  async edit(id: string) {
    const stored = await this.library.get(id);
    if (!stored) return;
    const file: VFile = { path: `${stored.entry.name}.glb`, name: `${stored.entry.name}.glb`, blob: new Blob([stored.glb]) };
    const r = await new ImportDialog().open({ main: file, format: 'glb', assets: [file] }, { existing: stored.entry, index: 0, total: 1 });
    if (!r || r === 'skip') return;
    await this.save({ ...r.entry, id }, r.glb, false);
    this.app.toast(`"${r.entry.name}" er opdateret`);
  }

  /** Sletter et møbel fra biblioteket og fjerner det fra det åbne projekt. */
  async remove(id: string) {
    await this.library.delete(id);
    this.app.catalog.remove(id);
    const used = Object.values(this.app.store.doc.furniture).filter((f) => f.catalogId === id);
    if (used.length) {
      this.app.store.transact('Slet importeret møbel', (doc) => {
        for (const f of used) delete doc.furniture[f.id];
      });
    }
    this.afterLibraryChange();
  }

  async exportLibrary() {
    const blob = await this.library.exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mine-moebler-${new Date().toISOString().slice(0, 10)}.indretning-bibliotek.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  pickLibraryBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void this.handleJson({ path: f.name, name: f.name, blob: f });
    });
    input.click();
  }

  private afterLibraryChange() {
    this.app.emit('catalog');
  }
}

