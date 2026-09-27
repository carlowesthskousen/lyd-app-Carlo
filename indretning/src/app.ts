import * as THREE from 'three';
import { Store, type ChangeReason } from './state/store';
import type { PickRef, ProjectDoc, WallMode } from './state/types';
import { Viewport } from './render/Viewport';
import { DEFAULT_POSE, FlyCamera } from './camera/FlyCamera';
import { Picker } from './core/picking';
import { BuildingView } from './building/BuildingView';
import { FurnitureView } from './furniture/FurnitureView';
import { Catalog, type CatalogEntry, dimsMeters } from './furniture/catalog';
import { ModelLibrary } from './furniture/modelLibrary';
import { findCollisions } from './furniture/placement';
import type { Editor, PaintChoice } from './editor';
import type { Tool, ToolId, ToolPointer } from './tools/Tool';
import { Overlay } from './tools/overlay';
import { SelectTool } from './tools/SelectTool';
import { WallTool } from './tools/WallTool';
import { RoomTool } from './tools/RoomTool';
import { OpeningTool } from './tools/OpeningTool';
import { FurnitureTool } from './tools/FurnitureTool';
import { PaintTool } from './tools/PaintTool';
import { DeleteTool } from './tools/DeleteTool';
import { deleteRefs, duplicateRef } from './tools/actions';
import { animateOut } from './tools/overlay';
import { openingFits } from './building/wallGraph';
import { type Vec2, snapTo } from './core/math2d';
import { emptyProject } from './state/defaults';
import { exportJson, importJson, lastProjectId, loadProject, saveProject } from './persistence/projects';
import { demoProject } from './persistence/demo';
import { WALL_PRESETS } from './building/buildCatalog';
import { sweepSphere } from './camera/collision';
import { ImportManager } from './import/ImportManager';
import { AdaptiveQuality } from './render/adaptiveQuality';
import { thumbnailsPending } from './ui/Thumbnails';
import {
  type Clip,
  copySelection,
  createGroup,
  isClip,
  sameRef,
  suggestGroupName,
  ungroup,
  uniqueRefs,
} from './selection/selectionOps';

const CLIP_KEY = 'indretning:udklip';

export type Mode = 'build' | 'buy';
type AppEvent =
  | 'selection'
  | 'tool'
  | 'doc'
  | 'mode'
  | 'settings'
  | 'history'
  | 'stats'
  | 'catalog'
  | 'saved'
  | 'help'
  | 'escape'
  | 'camera'
  | 'cameraMode'
  | 'speed'
  | 'showMine'
  | 'walls';

export interface Stats {
  fps: number;
  furniture: number;
  area: number;
  rooms: number;
}

/** Spillets kerne: binder state, 3D-visning, kamera, værktøjer og UI sammen. */
export class App implements Editor {
  readonly store: Store;
  readonly viewport: Viewport;
  readonly camera: FlyCamera;
  readonly picker: Picker;
  readonly building: BuildingView;
  readonly furniture: FurnitureView;
  readonly catalog = new Catalog();
  readonly library: ModelLibrary;
  readonly overlay: Overlay;
  readonly importer: ImportManager;
  readonly quality: AdaptiveQuality;
  private lastCameraMove = 0;
  /** Katalogvarer, der er ændret siden sidste visning (thumbnails skal laves igen). */
  readonly changedEntries = new Set<string>();

  /** Alle markerede objekter (multi-markering). */
  selected: PickRef[] = [];
  /** Markeringsfilter: kun møbler eller alt (møbler, vægge, døre, vinduer). */
  selectionFilter: 'furniture' | 'all' = 'all';
  toolId: ToolId = 'select';
  mode: Mode = 'buy';
  openingStyleId = 'door-90';
  paint: PaintChoice = { target: 'wall', material: { ...WALL_PRESETS[2].value } };
  placingEntry: CatalogEntry | null = null;
  hover = { blue: [] as THREE.Object3D[], red: [] as THREE.Object3D[] };
  gridForced = false;
  readonly keepUpWalls = new Set<string>();
  collisions = new Set<string>();
  stats: Stats = { fps: 60, furniture: 0, area: 0, rooms: 0 };

  private tools: Record<ToolId, Tool>;
  private listeners = new Map<AppEvent, Set<() => void>>();
  private timer = new THREE.Timer();
  private saveTimer = 0;
  private cameraSaveTimer = 0;
  private hintEl: HTMLElement | null = null;
  private toastHost: HTMLElement | null = null;
  private lastPointer: ToolPointer | null = null;

  constructor(readonly host: HTMLElement) {
    this.store = new Store(emptyProject());
    this.viewport = new Viewport(host);
    this.picker = new Picker(this.viewport.camera);
    this.building = new BuildingView(this.viewport.scene);
    this.library = new ModelLibrary(this.catalog);
    this.furniture = new FurnitureView(this.viewport.scene, this.catalog, this.library);
    this.picker.roots = [this.building.root, this.furniture.root];
    this.overlay = new Overlay(this.viewport.scene);
    this.importer = new ImportManager(this);
    // Dynamisk kvalitet: ingen målinger mens dialoger, import eller thumbnails kører
    this.quality = new AdaptiveQuality(
      this.viewport,
      () => !!document.querySelector('.modal-bg, .import-bg, #help.open') || this.importer.isBusy || thumbnailsPending > 0,
    );
    this.quality.onChange = () => this.emit('stats');
    this.quality.pause(5000); // indlæsning
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.quality.pause(2500); // fanen er lige blevet aktiv
    });
    window.addEventListener('focus', () => this.quality.pause(1500));
    this.camera = new FlyCamera(this.viewport.camera, host, (ndc) => {
      const hit = this.picker.pick(ndc);
      return hit?.point ?? this.picker.groundPoint(ndc);
    });
    this.camera.onRightClick = () => {
      if (!this.tool.rightClick?.()) {
        if (this.toolId !== 'select') this.setTool('select');
      }
    };
    this.camera.onChange = () => {
      this.lastCameraMove = performance.now();
      this.scheduleCameraSave();
    };
    this.camera.collide = (from, delta) => this.collideWalls(from, delta);
    // R og piletaster styrer markeringen, når noget er markeret i markeringsværktøjet
    this.camera.keyFilter = (code) =>
      this.toolId === 'select' &&
      (this.selected.some((r) => r.kind !== 'floor') || (this.tools.select as SelectTool).isFloating) &&
      (code === 'KeyR' || code.startsWith('Arrow'));
    this.camera.onModeChange = (mode) => {
      this.toast(mode === 'drone' ? 'Drone-tilstand – træk med musen for at kigge rundt' : 'Byg-tilstand');
      this.emit('cameraMode');
      this.emit('settings');
    };
    this.camera.onSpeedChange = () => this.emit('speed');
    this.building.onRebuilt = () => {
      this.viewport.lighting.fitTo(this.sceneBounds());
      this.viewport.markShadowsDirty();
    };
    this.furniture.onChanged = () => {
      this.viewport.markShadowsDirty();
      this.refreshHighlights();
    };

    this.tools = {
      select: new SelectTool(this),
      wall: new WallTool(this, this.overlay),
      room: new RoomTool(this, this.overlay),
      opening: new OpeningTool(this, this.overlay),
      furniture: new FurnitureTool(this, this.overlay),
      paint: new PaintTool(this),
      delete: new DeleteTool(this),
    };

    this.store.subscribe((reason) => this.onStoreChange(reason));
    this.bindPointer();
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('beforeunload', (e) => {
      this.saveNow();
      // Ctrl+W lukker fanen i browseren – spørg, hvis man er ved at dykke med Ctrl.
      if (this.camera.mode === 'drone' && this.camera.ctrlHeld) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('visibilitychange', () => document.hidden && this.saveNow());
  }

  async init() {
    await this.catalog.load();
    // Mine møbler skal være i kataloget, før et projekt, der bruger dem, åbnes.
    await this.importer.init();
    this.importer.bindDropZone();
    this.emit('catalog');
    const last = lastProjectId();
    const doc = (last && loadProject(last)) || this.createDemo();
    this.loadDoc(doc);
    this.loop();
  }

  createDemo(): ProjectDoc {
    return demoProject((id) => {
      const e = this.catalog.get(id);
      return e ? dimsMeters(e) : undefined;
    });
  }

  // ---------------------------------------------------------------- events

  on(ev: AppEvent, fn: () => void) {
    let s = this.listeners.get(ev);
    if (!s) this.listeners.set(ev, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }

  emit(ev: AppEvent) {
    this.listeners.get(ev)?.forEach((f) => f());
  }

  get tool(): Tool {
    return this.tools[this.toolId];
  }

  // ---------------------------------------------------------------- state

  private onStoreChange(reason: ChangeReason) {
    const doc = this.store.doc;
    const buildingChanged = this.building.sync(doc);
    this.furniture.sync(doc);
    if (reason !== 'settings') {
      this.collisions = findCollisions(doc, (id) => this.catalog.get(id));
    }
    const alive = this.selected.filter((r) => this.exists(r));
    if (alive.length !== this.selected.length) this.setSelection(alive);
    if (buildingChanged) this.viewport.lighting.fitTo(this.sceneBounds());
    this.viewport.lighting.setTime(doc.settings.timeOfDay);
    this.updateGridVisibility();
    this.refreshHighlights();
    this.updateStats();
    if (reason === 'undo' || reason === 'redo' || reason === 'edit') this.emit('history');
    if (reason === 'settings') this.emit('settings');
    this.emit('doc');
    if (reason !== 'preview') this.scheduleSave();
  }

  private exists(ref: PickRef) {
    const d = this.store.doc;
    if (ref.kind === 'furniture') return !!d.furniture[ref.id];
    if (ref.kind === 'wall') return !!d.walls[ref.id];
    if (ref.kind === 'opening') return !!d.openings[ref.id];
    return this.building.rooms.some((r) => r.key === ref.id);
  }

  loadDoc(doc: ProjectDoc) {
    this.quality?.pause(3000); // nyt projekt: modeller og thumbnails indlæses
    this.select(null);
    this.store.load(doc);
    this.camera.setPose(doc.camera ?? this.framingPose(), false);
    this.emit('settings');
    this.emit('history');
  }

  newProject(blank: boolean) {
    this.saveNow();
    const doc = blank ? emptyProject() : this.createDemo();
    if (blank) doc.camera = { ...DEFAULT_POSE };
    this.loadDoc(doc);
    this.saveNow();
    this.toast(blank ? 'Nyt, tomt projekt' : 'Nyt projekt ud fra starterhuset');
  }

  openProject(id: string) {
    this.saveNow();
    const doc = loadProject(id);
    if (!doc) {
      this.toast('Projektet kunne ikke åbnes');
      return;
    }
    this.loadDoc(doc);
    this.toast(`Åbnede "${doc.name}"`);
  }

  exportProject() {
    this.saveNow();
    exportJson(this.store.doc);
    this.toast('Projektet er eksporteret som JSON');
  }

  async importProject(file: File) {
    try {
      const doc = await importJson(file);
      this.saveNow();
      this.loadDoc(doc);
      this.saveNow();
      this.toast(`Importerede "${doc.name}"`);
    } catch (err) {
      this.toast(`Import fejlede: ${(err as Error).message}`);
    }
  }

  rename(name: string) {
    this.store.doc.name = name.trim() || 'Uden navn';
    this.saveNow();
    this.emit('saved');
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 600);
  }

  private scheduleCameraSave() {
    clearTimeout(this.cameraSaveTimer);
    this.cameraSaveTimer = window.setTimeout(() => {
      this.store.doc.camera = this.camera.getPose();
      this.scheduleSave();
    }, 1200);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.store.doc.camera = this.camera.getPose();
    if (saveProject(this.store.doc)) this.emit('saved');
    else this.toast('Kunne ikke gemme lokalt (lagerplads fuld?) – brug Eksportér');
  }

  undo() {
    if (this.store.inTransaction) return;
    const label = this.store.undo();
    this.toast(label ? `Fortrudt: ${label}` : 'Intet at fortryde');
  }

  redo() {
    if (this.store.inTransaction) return;
    const label = this.store.redo();
    this.toast(label ? `Gentaget: ${label}` : 'Intet at gentage');
  }

  /** En katalogvare er tilføjet eller ændret: indlæs modellen igen overalt. */
  catalogItemChanged(id: string) {
    this.library.invalidate(id);
    this.changedEntries.add(id);
    this.furniture.refreshEntry(id, this.store.doc);
    this.emit('catalog');
  }

  /** Vis kategorien "Mine møbler" i kataloget. */
  showMine() {
    this.setMode('buy');
    this.emit('showMine');
  }

  // ---------------------------------------------------------------- tools & selection

  setTool(id: ToolId) {
    if (id === this.toolId && id !== 'furniture') return;
    this.tool.deactivate?.();
    this.keepUpWalls.clear();
    this.overlay.clear();
    this.hover.blue = [];
    this.hover.red = [];
    this.toolId = id;
    if (['wall', 'room', 'opening', 'paint'].includes(id)) this.setMode('build');
    if (id === 'furniture') this.setMode('buy');
    this.tool.activate?.();
    this.setCursor(this.tool.cursor);
    this.setHint(this.tool.hint);
    this.updateGridVisibility();
    this.refreshHighlights();
    this.emit('tool');
    if (this.lastPointer) this.tool.pointerMove?.(this.lastPointer);
  }

  setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    // I Byg-tilstand står væggene op som standard, så man kan se, hvad man bygger.
    if (mode === 'build' && this.store.doc.settings.wallMode !== 'up') {
      this.store.setSettings({ wallMode: 'up' });
      this.toast('Vægge oppe (Byg) · L skifter vægvisning');
    }
    this.updateGridVisibility();
    this.emit('mode');
  }

  startPlacing(entry: CatalogEntry, drag: boolean) {
    this.placingEntry = entry;
    this.select(null);
    this.setTool('furniture');
    (this.tools.furniture as FurnitureTool).dragMode = drag;
  }

  stopDragPlacing(stayActive: boolean) {
    const t = this.tools.furniture as FurnitureTool;
    if (this.toolId !== 'furniture' || !t.dragMode) return;
    if (stayActive) t.dragMode = false;
    else this.setTool('select');
  }

  /** Den markerede genstand, hvis præcis én er markeret (til egenskabspanelet). */
  get selection(): PickRef | null {
    return this.selected.length === 1 ? this.selected[0] : null;
  }

  select(ref: PickRef | null) {
    this.setSelection(ref ? [ref] : []);
  }

  setSelection(refs: PickRef[]) {
    const next = uniqueRefs(refs);
    const same = next.length === this.selected.length && next.every((r, i) => sameRef(r, this.selected[i]));
    this.selected = next;
    if (!same) {
      this.refreshHighlights();
      this.emit('selection');
    }
  }

  isSelected(ref: PickRef) {
    return this.selected.some((r) => sameRef(r, ref));
  }

  /** Tjekker om en type må markeres med det aktuelle filter. */
  selectable(kind: PickRef['kind']) {
    if (kind === 'floor') return false;
    return this.selectionFilter === 'all' || kind === 'furniture';
  }

  setSelectionFilter(f: 'furniture' | 'all') {
    this.selectionFilter = f;
    if (f === 'furniture') this.setSelection(this.selected.filter((r) => r.kind === 'furniture'));
    this.emit('selection');
  }

  selectAll() {
    const d = this.store.doc;
    const refs: PickRef[] = Object.keys(d.furniture).map((id) => ({ kind: 'furniture', id }));
    if (this.selectionFilter === 'all') {
      refs.push(...Object.keys(d.walls).map((id) => ({ kind: 'wall' as const, id })));
      refs.push(...Object.keys(d.openings).map((id) => ({ kind: 'opening' as const, id })));
    }
    if (this.toolId !== 'select') this.setTool('select');
    this.setSelection(refs);
    this.toast(`${refs.length} markeret`);
  }

  objectsFor(ref: PickRef): THREE.Object3D[] {
    if (ref.kind === 'furniture') {
      const o = this.furniture.objectFor(ref.id);
      return o ? [o] : [];
    }
    return this.building.objectsFor(ref.kind, ref.id);
  }

  refreshHighlights() {
    const blue = [...this.hover.blue];
    for (const r of this.selected) blue.push(...this.objectsFor(r));
    const red = [...this.hover.red];
    if (this.toolId !== 'delete') {
      for (const id of this.collisions) {
        const o = this.furniture.objectFor(id);
        if (o) red.push(o);
      }
    }
    this.viewport.selectOutline.selectedObjects = blue.filter((o) => !red.includes(o));
    this.viewport.dangerOutline.selectedObjects = red;
  }

  deleteSelection() {
    const refs = [...this.selected];
    if (!refs.length) return;
    for (const r of refs) for (const obj of this.objectsFor(r)) animateOut(this.viewport.scene, obj);
    this.store.transact(refs.length === 1 ? 'Slet' : `Slet ${refs.length} objekter`, (doc) => deleteRefs(doc, refs, this.building.rooms));
    this.select(null);
  }

  /**
   * Cmd/Ctrl+D: én dør/ét vindue duplikeres langs væggen; alt andet duplikeres
   * som en bunke, der følger musen, til man klikker den på plads.
   */
  duplicateSelection() {
    const refs = this.selected.filter((r) => r.kind !== 'floor');
    if (!refs.length) return;
    if (refs.length === 1 && refs[0].kind === 'opening') return this.duplicateOpening(refs[0]);
    const clip = copySelection(this.store.doc, refs);
    if (!clip.furniture.length && !clip.walls.length) return;
    this.setTool('select');
    (this.tools.select as SelectTool).startFloating(clip, 'Duplikér');
  }

  private duplicateOpening(sel: PickRef) {
    let created: PickRef | null = null;
    this.store.transact('Duplikér', (doc) => {
      created = duplicateRef(doc, sel);
      if (created?.kind === 'opening') {
        const o = doc.openings[created.id];
        if (!openingFits(doc, o.wallId, o, o.id)) {
          o.offset = doc.openings[sel.id].offset - o.width - 0.2;
          if (!openingFits(doc, o.wallId, o, o.id)) {
            delete doc.openings[o.id];
            created = null;
          }
        }
      }
    });
    if (created) this.select(created);
    else this.toast('Der er ikke plads til en kopi');
  }

  /** Cmd/Ctrl+C: kopiér til browserens udklipsholder (virker mellem projekter). */
  copySelection() {
    const refs = this.selected.filter((r) => r.kind !== 'floor');
    if (!refs.length) return;
    const clip = copySelection(this.store.doc, refs);
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
    } catch {
      this.memoryClip = clip;
    }
    this.memoryClip = clip;
    const n = clip.furniture.length + clip.walls.length;
    this.toast(`Kopieret: ${n} objekt${n === 1 ? '' : 'er'}${clip.openings.length ? ` (+${clip.openings.length} døre/vinduer)` : ''}`);
  }

  /** Cmd/Ctrl+V: indsæt; kopien følger musen, til man klikker den på plads. */
  paste() {
    let clip: Clip | null = null;
    try {
      const raw = localStorage.getItem(CLIP_KEY);
      if (raw) clip = JSON.parse(raw);
    } catch {
      /* brug hukommelsen */
    }
    clip ??= this.memoryClip;
    if (!clip || !isClip(clip)) {
      this.toast('Udklipsholderen er tom – markér noget og tryk Cmd/Ctrl+C');
      return;
    }
    const missing = clip.furniture.filter((f) => !this.catalog.get(f.catalogId)).length;
    if (missing) this.toast(`${missing} møbler findes ikke i dette katalog og vises som kasser`);
    this.setTool('select');
    (this.tools.select as SelectTool).startFloating(clip, 'Indsæt');
  }

  private memoryClip: Clip | null = null;

  /** Cmd/Ctrl+G: gem markeringen som en gruppe. */
  groupSelection() {
    const refs = this.selected.filter((r) => r.kind !== 'floor');
    if (refs.length < 2) {
      this.toast('Markér mindst to ting for at gruppere');
      return;
    }
    const name = suggestGroupName(this.store.doc, refs, (id) => this.catalog.get(id)?.name);
    this.store.transact('Gruppér', (doc) => createGroup(doc, refs, name));
    this.toast(`Gruppe: ${name}`);
    this.emit('selection');
  }

  /** Cmd/Ctrl+Shift+G: opløs gruppen. */
  ungroupSelection() {
    let n = 0;
    this.store.transact('Opløs gruppe', (doc) => (n = ungroup(doc, this.selected)));
    this.toast(n ? 'Gruppen er opløst' : 'Markeringen er ikke en gruppe');
    this.emit('selection');
  }

  renameGroup(id: string, name: string) {
    this.store.transact('Omdøb gruppe', (doc) => {
      const g = doc.groups?.[id];
      if (g) g.name = name.trim() || g.name;
    });
  }

  rotateSelection(angle: number) {
    (this.tools.select as SelectTool).rotateSelection(angle);
  }

  updateItem(id: string, patch: Partial<ProjectDoc['furniture'][string]>, label: string) {
    this.store.transact(label, (doc) => {
      const it = doc.furniture[id];
      if (it) Object.assign(it, patch);
    });
  }

  // ---------------------------------------------------------------- camera & view

  sceneBounds(): THREE.Box3 {
    const b = this.building.bounds();
    const f = this.furniture.bounds();
    if (!f.isEmpty()) b.union(f);
    return b;
  }

  framingPose() {
    const b = this.sceneBounds();
    if (b.isEmpty()) return { ...DEFAULT_POSE };
    const c = b.getCenter(new THREE.Vector3());
    const r = Math.max(4, b.getSize(new THREE.Vector3()).length() / 2);
    const yaw = 0.35;
    const pitch = -0.68;
    const dist = r * 1.9 + 2;
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const p = c.clone().addScaledVector(fwd, -dist);
    return { x: p.x, y: Math.max(1, p.y), z: p.z, yaw, pitch };
  }

  focusSelection() {
    const objs = this.selected.flatMap((r) => this.objectsFor(r));
    const box = new THREE.Box3();
    for (const o of objs) box.expandByObject(o);
    if (box.isEmpty()) box.copy(this.sceneBounds());
    if (box.isEmpty()) return;
    this.camera.focusOn(box.getBoundingSphere(new THREE.Sphere()));
  }

  resetView() {
    this.camera.setPose(this.framingPose(), true);
  }

  topDown() {
    const b = this.sceneBounds();
    const c = b.isEmpty() ? this.camera.focusPoint() : b.getCenter(new THREE.Vector3());
    const r = b.isEmpty() ? 8 : b.getSize(new THREE.Vector3()).length() / 2;
    this.camera.topDown(c, Math.max(8, r * 2.3));
  }

  setWallMode(mode: WallMode) {
    this.store.setSettings({ wallMode: mode });
  }

  cycleWallMode() {
    const order: WallMode[] = ['up', 'cutaway', 'down'];
    const i = order.indexOf(this.store.doc.settings.wallMode);
    const next = order[(i + 1) % 3];
    this.setWallMode(next);
    this.toast({ up: 'Vægge oppe', cutaway: 'Automatisk (cutaway)', down: 'Vægge nede' }[next]);
  }

  toggleGrid() {
    this.gridForced = !this.gridForced;
    this.updateGridVisibility();
    this.emit('settings');
  }

  gridVisible() {
    return this.gridForced || this.mode === 'build' || ['wall', 'room', 'opening'].includes(this.toolId);
  }

  private updateGridVisibility() {
    const g = this.viewport.grid;
    g.visible = this.gridVisible();
    g.material.uniforms.uFine.value = this.store.doc.settings.snapEnabled && this.store.doc.settings.snapStep < 0.2 ? 1 : 0;
  }

  snap(p: Vec2, force = false): Vec2 {
    const s = this.store.doc.settings;
    if (!s.snapEnabled && !force) return p;
    if (!s.snapEnabled) return p;
    return { x: snapTo(p.x, s.snapStep), z: snapTo(p.z, s.snapStep) };
  }

  // ---------------------------------------------------------------- UI hooks

  attachUi(hint: HTMLElement, toasts: HTMLElement) {
    this.hintEl = hint;
    this.toastHost = toasts;
    this.setHint(this.tool.hint);
  }

  toast(msg: string) {
    const host = this.toastHost;
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    host.appendChild(el);
    while (host.children.length > 3) host.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 1800);
    setTimeout(() => el.remove(), 2200);
  }

  setHint(text: string) {
    if (this.hintEl) this.hintEl.textContent = text;
  }

  setCursor(css: string) {
    this.viewport.renderer.domElement.style.cursor = css;
  }

  // ---------------------------------------------------------------- input

  /** Klik-tæller til dobbeltklik (pointer-events har altid detail = 0 i Chrome). */
  private lastDown = { t: 0, x: 0, y: 0, count: 0 };

  private countClick(e: PointerEvent) {
    const now = performance.now();
    const l = this.lastDown;
    const near = Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6;
    l.count = near && now - l.t < 400 ? l.count + 1 : 1;
    l.t = now;
    l.x = e.clientX;
    l.y = e.clientY;
  }

  private pointer(e: PointerEvent | MouseEvent): ToolPointer {
    const r = this.host.getBoundingClientRect();
    return {
      ndc: new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      clientX: e.clientX,
      clientY: e.clientY,
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      detail: e.type === 'pointerdown' || e.type === 'pointerup' ? this.lastDown.count : e.detail,
    };
  }

  private bindPointer() {
    const el = this.host;
    let leftDown = false;
    /**
     * Drone-tilstand: et venstreklik holdes tilbage, indtil vi ved, om det er et klik
     * (→ værktøjet) eller et træk over 5 px (→ kig rundt, eller orbit med Alt).
     */
    let pendingClick: ToolPointer | null = null;
    // Registrér Shift+klik (alle knapper), så dronen ikke dykker ved Shift+klik
    el.addEventListener('pointerdown', (e) => this.camera.noteClick(e.shiftKey), { capture: true });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.viewport-labels > *')) return;
      leftDown = true;
      el.setPointerCapture(e.pointerId);
      this.countClick(e);
      const p = this.pointer(e);
      if (this.camera.mode === 'drone' && (e.altKey || !this.tool.wantsDrag?.(p))) {
        pendingClick = p;
        this.camera.beginDrag(e, e.altKey ? 'orbit' : 'look');
        return;
      }
      this.tool.pointerDown?.(p);
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointer(e);
      if (pendingClick) return; // kameraet håndterer trækket
      this.lastPointer = p;
      if (this.camera.isDragging && !leftDown) return;
      this.tool.pointerMove?.(p);
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      leftDown = false;
      if (pendingClick) {
        const click = pendingClick;
        pendingClick = null;
        const dragged = this.camera.endDrag();
        if (!dragged) {
          // Et rent klik: giv det til værktøjet som tryk + slip.
          this.tool.pointerDown?.(click);
          this.tool.pointerUp?.(this.pointer(e));
        }
        return;
      }
      this.tool.pointerUp?.(this.pointer(e));
    });
    el.addEventListener('pointercancel', () => {
      if (pendingClick) {
        pendingClick = null;
        this.camera.endDrag();
      }
      leftDown = false;
    });
    el.addEventListener('pointerleave', () => {
      if (!leftDown) {
        this.lastPointer = null;
        this.tool.pointerLeave?.();
      }
    });
    // Værktøjer får første bud på scroll (fx Alt+scroll = drej møbel).
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.tool.wheel?.(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true, passive: false },
    );
    // Slip af træk fra kataloget uden for 3D-visningen.
    window.addEventListener('pointerup', (e) => {
      if (this.toolId !== 'furniture') return;
      const t = e.target as HTMLElement;
      if (el.contains(t)) return;
      this.stopDragPlacing(!!t.closest('.catalog-card'));
    });
  }

  private onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      const k = e.key.toLowerCase();
      // Drone: Ctrl er boost. Ctrl+W/A/S/D med en bevægelsestast nede er flyvning,
      // ikke genveje (Ctrl+D/S virker stadig, når dronen står stille).
      // På Mac er Cmd genvejstasten og Ctrl er boost – de kolliderer ikke.
      if (this.camera.mode === 'drone' && e.ctrlKey && !e.metaKey && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        const flying = this.camera.movementHeld(e.code) || e.repeat;
        if (flying || e.code === 'KeyW') {
          e.preventDefault();
          return;
        }
      }
      if (k === 'z' && !e.shiftKey) this.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) this.redo();
      else if (k === 'd') this.duplicateSelection();
      else if (k === 'a') this.selectAll();
      else if (k === 'c') this.copySelection();
      else if (k === 'v') this.paste();
      else if (k === 'g' && e.shiftKey) this.ungroupSelection();
      else if (k === 'g') this.groupSelection();
      else if (k === 's') {
        this.saveNow();
        this.toast('Gemt');
      } else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'Alt') e.preventDefault();
    if (this.tool.keyDown?.(e)) {
      e.preventDefault();
      return;
    }
    const map: Record<string, () => void> = {
      KeyV: () => this.setTool('select'),
      KeyB: () => this.setTool('wall'),
      KeyN: () => this.setTool('room'),
      KeyO: () => this.setTool('opening'),
      KeyP: () => this.setTool('paint'),
      KeyX: () => this.setTool('delete'),
      KeyK: () => this.setMode(this.mode === 'build' ? 'buy' : 'build'),
      KeyM: () => this.toggleGrid(),
      KeyL: () => this.cycleWallMode(),
      Tab: () => this.toggleCameraMode(),
      KeyG: () => this.focusSelection(),
      KeyY: () => this.topDown(),
      KeyH: () => this.emit('help'),
      Home: () => this.resetView(),
      Delete: () => this.deleteSelection(),
      Backspace: () => this.deleteSelection(),
      Escape: () => {
        if (this.toolId !== 'select') this.setTool('select');
        else this.select(null);
        this.emit('escape');
      },
      BracketLeft: () => this.adjustSpeed(1 / 1.25),
      BracketRight: () => this.adjustSpeed(1.25),
    };
    const fn = map[e.code];
    if (fn) {
      e.preventDefault();
      fn();
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }

  adjustSpeed(f: number) {
    const c = this.camera;
    if (c.mode === 'drone') {
      c.updateSettings({ droneSpeed: THREE.MathUtils.clamp(c.settings.droneSpeed * f, 0.3, 60) });
      this.emit('speed');
    } else {
      c.updateSettings({ buildSpeed: THREE.MathUtils.clamp(c.settings.buildSpeed * f, 0.2, 5) });
      this.toast(`Kamerahastighed ${Math.round(c.settings.buildSpeed * 100)} %`);
    }
    this.emit('settings');
  }

  // ---------------------------------------------------------------- drone-kollision

  /** Kameraet (en kugle på 20 cm) kan ikke flyve gennem vægge – kun gennem døre og vinduer. */
  collideWalls(from: THREE.Vector3, delta: THREE.Vector3): THREE.Vector3 {
    return sweepSphere(from, delta, this.building.collisionMeshes(), 0.2);
  }

  toggleCameraMode() {
    this.camera.toggleMode();
  }

  // ---------------------------------------------------------------- loop

  private hudTimer = 0;
  lastLowered = 0;
  private frames = 0;
  private fpsTime = 0;

  private loop = () => {
    requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = this.timer.getDelta();
    this.camera.update(dt);
    const s = this.store.doc.settings;
    if (this.building.updateCutaway(dt, s.wallMode, this.camera.position, this.camera.focusPoint(), this.keepUpWalls)) {
      this.viewport.markShadowsDirty();
    }
    const lowered = this.building.loweredCount;
    if (lowered !== this.lastLowered) {
      this.lastLowered = lowered;
      this.emit('walls');
    }
    this.furniture.updateLights(this.store.doc, this.camera.position, 1 - this.viewport.lighting.daylight);
    this.tool.update?.(dt);
    this.viewport.render();
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.hudTimer = 0;
      this.emit('camera');
    }
    this.measure(dt);
  };

  private measure(dt: number) {
    // Dynamisk kvalitet (se render/adaptiveQuality.ts)
    const moving = performance.now() - this.lastCameraMove < 120 || this.camera.dragArmed;
    this.quality.tick(dt, moving);
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime < 1) return;
    this.stats.fps = this.frames / this.fpsTime;
    this.frames = 0;
    this.fpsTime = 0;
    this.emit('stats');
  }

  private updateStats() {
    this.stats.furniture = Object.keys(this.store.doc.furniture).length;
    this.stats.rooms = this.building.rooms.length;
    this.stats.area = this.building.rooms.reduce((a, r) => a + r.area, 0);
  }
}
