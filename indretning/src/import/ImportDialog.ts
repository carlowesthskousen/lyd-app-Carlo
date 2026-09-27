import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { h, clear } from '../ui/dom';
import { icon } from '../ui/icons';
import { CATEGORIES, type CatalogEntry, type CategoryId, type MaterialOverride, type Placement } from '../furniture/catalog';
import { MATERIAL_PRESETS, createPresetMaterial, presetById } from '../materials/presets';
import { applyBoxUv } from '../furniture/modelLibrary';
import type { ImportJob } from './intake';
import { type LoadedModel, loadModel } from './loadModel';
import { type Unit, UNIT_FACTORS, UNIT_NAMES, guessCategory, guessName, guessUnit } from './guess';

export interface DialogResult {
  entry: CatalogEntry;
  glb: ArrayBuffer;
}

export interface DialogOptions {
  /** Ved redigering: den eksisterende katalog-linje. */
  existing?: CatalogEntry;
  index: number;
  total: number;
}

interface MaterialRow {
  original: THREE.MeshStandardMaterial;
  preset: string;
  recolorable: boolean;
  display: THREE.Material;
}

const PLACEMENTS: [Placement, string][] = [
  ['floor', 'På gulvet'],
  ['surface', 'På bord/hylde'],
  ['wall', 'På væggen'],
  ['ceiling', 'Fra loftet'],
];

/**
 * Import-dialog: live 3D-forhåndsvisning (drej med musen), 180 cm figur til
 * størrelsessammenligning, automatiske mål med gættet enhed, materialer med
 * forudindstillinger og "kan farves".
 */
export class ImportDialog {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private controls!: OrbitControls;
  private holder = new THREE.Group();
  private spin = new THREE.Group();
  private tilt = new THREE.Group();
  private human = createHuman();
  private model!: LoadedModel;
  private rows: MaterialRow[] = [];
  private selected: MaterialRow | null = null;
  private raf = 0;
  private unit: Unit = 'm';
  /** Mål i cm (bredde x, højde y, dybde z). */
  private dims = new THREE.Vector3();
  private dimsEdited = false;
  private lockRatio = true;
  private onChange: () => void = () => {};

  async open(job: ImportJob, opts: DialogOptions): Promise<DialogResult | 'skip' | null> {
    const bg = h('div.modal-bg.import-bg');
    const card = h('div.import-modal', { role: 'dialog', 'aria-label': 'Importér møbel' });
    bg.append(card);
    document.body.append(bg);
    const loading = h('div.import-loading', {}, `Indlæser ${job.main.name} …`);
    card.append(loading);

    try {
      this.model = await loadModel(job);
    } catch (err) {
      clear(card);
      card.append(
        h('div.help-head', {}, h('h2', {}, 'Kunne ikke importere')),
        h('p', {}, `${job.main.name}: ${(err as Error).message}`),
        h('p.muted', {}, 'Prøv at eksportere modellen som .glb, .fbx eller .obj igen fra programmet, den kom fra.'),
      );
      const close = h('button.btn', {}, 'Luk');
      card.append(h('div.import-actions', {}, close));
      return new Promise((resolve) =>
        close.addEventListener('click', () => {
          bg.remove();
          resolve(opts.total > 1 ? 'skip' : null);
        }),
      );
    }
    loading.remove();

    const ex = opts.existing;
    this.spin.add(this.tilt);
    this.holder.add(this.spin);
    this.tilt.add(this.model.root);
    for (const m of this.model.root.children) m.updateMatrixWorld(true);
    // Rækker for materialerne
    this.rows = this.model.materials.map((m) => {
      const ov = ex?.materials?.[m.name];
      const rec = Array.isArray(ex?.recolorable) ? ex!.recolorable.includes(m.name) : false;
      return { original: m, preset: ov?.preset ?? '', recolorable: rec, display: m };
    });
    this.model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.userData.origMats = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
    });

    // Enhed og mål
    const native = this.nativeSize();
    if (ex) {
      this.dims.set(ex.dimensions.width, ex.dimensions.height, ex.dimensions.depth);
      this.unit = guessUnit(Math.max(native.x, native.y, native.z));
      this.dimsEdited = true;
    } else {
      this.unit = guessUnit(Math.max(native.x, native.y, native.z));
      this.updateDimsFromModel();
    }

    return new Promise((resolve) => {
      const done = (r: DialogResult | 'skip' | null) => {
        cancelAnimationFrame(this.raf);
        this.renderer.dispose();
        this.controls.dispose();
        window.removeEventListener('keydown', onKey, true);
        bg.remove();
        resolve(r);
      };
      const onKey = (e: KeyboardEvent) => {
        e.stopPropagation(); // tasterne må ikke styre spillet bag dialogen
        if (e.key === 'Escape') done(null);
      };
      window.addEventListener('keydown', onKey, true);
      this.build(card, job, opts, done);
      void Promise.all(this.rows.filter((r) => r.preset).map((r) => this.applyPreset(r, r.preset)));
    });
  }

  // ------------------------------------------------------------------ opbygning

  private build(card: HTMLElement, job: ImportJob, opts: DialogOptions, done: (r: DialogResult | 'skip' | null) => void) {
    const ex = opts.existing;
    const head = h(
      'div.import-head',
      {},
      h('div', {}, h('h2', {}, ex ? 'Redigér møbel' : 'Importér møbel'), h('span.muted', {}, `${job.main.name}${opts.total > 1 ? ` · ${opts.index + 1} af ${opts.total}` : ''}`)),
      h('button.icon-btn', { html: icon('close'), 'aria-label': 'Luk', onclick: () => done(null) }),
    );

    // --- forhåndsvisning
    const canvasBox = h('div.import-preview');
    const figureNote = h('div.import-figure-note', {}, 'Figuren er 180 cm høj');
    const hint = h('div.import-preview-hint', {}, 'Træk for at dreje · scroll for at zoome · klik på en del for at vælge dens materiale');
    canvasBox.append(figureNote, hint);
    const tools = h(
      'div.import-tools',
      {},
      h('button.btn', { html: `${icon('rotate', 16)}<span>Drej forside 90°</span>`, title: 'Hvis møblets forside ikke vender mod dig', onclick: () => this.rotateFront() }),
      h('button.btn', { html: `${icon('flip', 16)}<span>Stå på gulvet</span>`, title: 'Vip modellen 90°, hvis den ligger ned (Z-op → Y-op)', onclick: () => this.tiltUp() }),
    );
    const left = h('div.import-left', {}, canvasBox, tools);

    // --- formular
    const f = (label: string, control: HTMLElement, note?: HTMLElement) => h('label.import-field', {}, h('span', {}, label), control, note ?? null);
    const nameIn = h('input', { type: 'text', value: ex?.name ?? guessName(job.main.name), id: 'imp-name' }) as HTMLInputElement;
    const mfrIn = h('input', { type: 'text', value: ex?.manufacturer ?? (job.packageName ? '' : ''), placeholder: 'Fx Fritz Hansen', id: 'imp-mfr' }) as HTMLInputElement;
    const desIn = h('input', { type: 'text', value: ex?.designer ?? '', placeholder: 'Fx Arne Jacobsen', id: 'imp-des' }) as HTMLInputElement;
    const catSel = h('select', { id: 'imp-cat' }) as HTMLSelectElement;
    for (const c of CATEGORIES) if (c.id !== 'mine') catSel.append(h('option', { value: c.id }, c.name));
    catSel.value = ex?.category ?? guessCategory(`${job.main.name} ${job.packageName ?? ''}`);
    const placeSel = h('select', { id: 'imp-place' }) as HTMLSelectElement;
    for (const [v, t] of PLACEMENTS) placeSel.append(h('option', { value: v }, t));
    placeSel.value = ex?.placement ?? (catSel.value === 'lamper' && /pendant|pendel/i.test(job.main.name) ? 'ceiling' : 'floor');

    const unitSel = h('select', { id: 'imp-unit' }) as HTMLSelectElement;
    for (const u of ['mm', 'cm', 'm', 'in'] as Unit[]) unitSel.append(h('option', { value: u }, UNIT_NAMES[u]));
    unitSel.value = this.unit;
    const unitNote = h('span.import-note', {}, ex ? '' : 'gættet');
    unitSel.addEventListener('change', () => {
      this.unit = unitSel.value as Unit;
      unitNote.textContent = '';
      this.dimsEdited = false;
      this.updateDimsFromModel();
      syncDims();
    });

    const dimIn = (id: string) => h('input.num', { type: 'number', min: 1, step: 0.5, id }) as HTMLInputElement;
    const wIn = dimIn('imp-w'), dIn = dimIn('imp-d'), hIn = dimIn('imp-h');
    // Advarsel ved usandsynlige mål (fx modeller uden rigtig enhed)
    const sizeWarn = h('div.props-warn.import-size-warn');
    const fitBtn = h('button.link', {}, 'Skalér til 80 cm høj');
    fitBtn.addEventListener('click', () => {
      this.dims.multiplyScalar(80 / (this.dims.y || 80));
      this.dimsEdited = true;
      syncDims();
    });
    const syncDims = () => {
      wIn.value = fmt(this.dims.x);
      hIn.value = fmt(this.dims.y);
      dIn.value = fmt(this.dims.z);
      const max = Math.max(this.dims.x, this.dims.y, this.dims.z);
      const odd = max > 600 || max < 3;
      sizeWarn.hidden = !odd;
      if (odd) {
        sizeWarn.textContent = `Målene ser usandsynlige ud for et møbel (${fmt(max)} cm). Tjek enheden, skriv målene, eller `;
        sizeWarn.append(fitBtn);
      }
      this.layout();
    };
    const onDim = (axis: 'x' | 'y' | 'z', input: HTMLInputElement) => {
      const v = Number(input.value);
      if (!(v > 0)) return;
      if (this.lockRatio) {
        const k = v / (this.dims[axis] || v);
        this.dims.multiplyScalar(k);
        this.dims[axis] = v;
      } else this.dims[axis] = v;
      this.dimsEdited = true;
      syncDims();
    };
    wIn.addEventListener('change', () => onDim('x', wIn));
    dIn.addEventListener('change', () => onDim('z', dIn));
    hIn.addEventListener('change', () => onDim('y', hIn));
    const lock = h('input', { type: 'checkbox', id: 'imp-lock' }) as HTMLInputElement;
    lock.checked = this.lockRatio;
    lock.addEventListener('change', () => (this.lockRatio = lock.checked));
    const dimsRow = h(
      'div.import-dims',
      {},
      h('label', {}, h('span', {}, 'Bredde'), wIn),
      h('label', {}, h('span', {}, 'Dybde'), dIn),
      h('label', {}, h('span', {}, 'Højde'), hIn),
      h('span.unit', {}, 'cm'),
    );

    const matList = h('div.import-materials');
    const renderRows = () => {
      clear(matList);
      for (const r of this.rows) {
        const count = this.model.meshesByMaterial.get(r.original)?.length ?? 0;
        const sel = h('select', { 'aria-label': `Materiale for ${r.original.name}` }) as HTMLSelectElement;
        sel.append(h('option', { value: '' }, 'Original'));
        for (const p of MATERIAL_PRESETS) sel.append(h('option', { value: p.id }, p.name));
        sel.value = r.preset;
        sel.addEventListener('change', () => {
          void this.applyPreset(r, sel.value).then(renderSwatch);
        });
        sel.addEventListener('click', (e) => e.stopPropagation());
        const rec = h('input', { type: 'checkbox', title: 'Kan farves i spillet' }) as HTMLInputElement;
        rec.checked = r.recolorable;
        rec.addEventListener('change', () => (r.recolorable = rec.checked));
        const recLabel = h('label.import-rec', { onclick: (e: Event) => e.stopPropagation() }, rec, h('span', {}, 'Kan farves'));
        const sw = h('span.import-swatch');
        const renderSwatch = () => {
          const p = presetById(r.preset);
          sw.style.background = p ? p.swatch : `#${r.original.color.getHexString()}`;
          sw.classList.toggle('textured', !!r.original.map && !p);
        };
        renderSwatch();
        const row = h(
          'div.import-mat',
          { tabindex: 0, 'data-name': r.original.name, onclick: () => this.select(r === this.selected ? null : r) },
          sw,
          h('div.import-mat-name', {}, h('b', {}, r.original.name), h('small', {}, `${count} del${count === 1 ? '' : 'e'}`)),
          sel,
          recLabel,
        );
        row.classList.toggle('active', r === this.selected);
        matList.append(row);
      }
    };
    this.onChange = renderRows;
    renderRows();

    const warnings = this.model.warnings.length
      ? h('div.props-warn', {}, [...new Set(this.model.warnings)].slice(0, 3).join(' · '))
      : null;

    const form = h(
      'div.import-form',
      {},
      f('Navn', nameIn),
      h('div.import-two', {}, f('Producent', mfrIn), f('Designer', desIn)),
      h('div.import-two', {}, f('Kategori', catSel), f('Placering', placeSel)),
      h('h4', {}, 'Mål'),
      h('div.import-two', {}, f('Modellens enhed', unitSel, unitNote), h('label.import-field.import-lock', {}, lock, h('span', {}, 'Lås proportioner'))),
      dimsRow,
      sizeWarn,
      h('h4', {}, 'Materialer'),
      h('p.import-help', {}, 'Klik på en del for at se den i forhåndsvisningen. Vælg en forudindstilling for et rigtigt materiale.'),
      matList,
      warnings,
    );

    const skip = opts.total > 1 ? h('button.btn', { onclick: () => done('skip') }, 'Spring over') : null;
    const save = h('button.btn.primary', { html: `${icon('plus', 16)}<span>${ex ? 'Gem ændringer' : 'Tilføj til katalog'}</span>` }) as HTMLButtonElement;
    save.addEventListener('click', async () => {
      if (!nameIn.value.trim()) {
        nameIn.focus();
        return;
      }
      save.disabled = true;
      save.lastElementChild!.textContent = 'Gemmer …';
      try {
        const glb = await this.exportGlb();
        const entry: CatalogEntry = {
          id: ex?.id ?? makeId(nameIn.value),
          name: nameIn.value.trim(),
          manufacturer: mfrIn.value.trim() || undefined,
          designer: desIn.value.trim() || undefined,
          category: catSel.value as CategoryId,
          placement: placeSel.value as Placement,
          dimensions: { width: round1(this.dims.x), depth: round1(this.dims.z), height: round1(this.dims.y) },
          recolorable: this.rows.filter((r) => r.recolorable).map((r) => r.original.name),
          materials: Object.fromEntries(
            this.rows.filter((r) => r.preset).map((r) => [r.original.name, { preset: r.preset, uv: 'box' } satisfies MaterialOverride]),
          ),
          tags: ['importeret'],
          source: 'user',
        };
        if (entry.category === 'lamper') entry.light = { color: '#ffd9a8', intensity: 5, distance: 6, height: Math.round(this.dims.y * (entry.placement === 'ceiling' ? 0.1 : 0.85)) };
        if (entry.placement === 'wall') entry.elevation = 140;
        done({ entry, glb });
      } catch (err) {
        save.disabled = false;
        save.lastElementChild!.textContent = 'Prøv igen';
        alertInline(form, `Kunne ikke gemme: ${(err as Error).message}`);
      }
    });

    card.append(
      head,
      h('div.import-body', {}, left, form),
      h('div.import-actions', {}, h('span.muted', {}, 'Gemmes kun lokalt i din browser (Mine møbler).'), h('div.spacer'), skip, h('button.btn', { onclick: () => done(null) }, 'Annullér'), save),
    );

    this.initViewer(canvasBox);
    syncDims();
    setTimeout(() => nameIn.select(), 50);
  }

  // ------------------------------------------------------------------ 3D-visning

  private initViewer(box: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    box.prepend(r.domElement);
    this.renderer = r;
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#eeebe5');
    const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
    sun.position.set(2, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -2.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 2.5;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, new THREE.HemisphereLight('#ffffff', '#b8b0a4', 0.6));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e4dfd6', roughness: 1 }));
    floor.receiveShadow = true;
    const grid = new THREE.GridHelper(8, 16, '#cfc8bb', '#d9d3c9');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    grid.position.y = 0.001;
    this.scene.add(floor, grid, this.holder, this.human);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // Klik (uden træk) på en del vælger dens materiale
    let down: { x: number; y: number } | null = null;
    r.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = r.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
      const hit = ray.intersectObject(this.holder, true)[0];
      if (!hit) return this.select(null);
      const mesh = hit.object as THREE.Mesh;
      const orig = (mesh.userData.origMats as THREE.Material[])[hit.face?.materialIndex ?? 0] ?? mesh.userData.origMats[0];
      this.select(this.rows.find((x) => x.original === orig) ?? null);
    });

    const resize = () => {
      const w = box.clientWidth, hgt = box.clientHeight;
      if (!w || !hgt) return;
      r.setSize(w, hgt, false);
      r.domElement.style.width = '100%';
      r.domElement.style.height = '100%';
      this.camera.aspect = w / hgt;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(box);
    resize();
    this.layout(true);
    const t0 = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      // Valgt materiale pulserer blødt
      if (this.selected) {
        const k = 0.25 + 0.2 * Math.sin((performance.now() - t0) / 180);
        for (const m of this.displayMaterials(this.selected)) if ('emissive' in m) (m as THREE.MeshStandardMaterial).emissiveIntensity = k;
      }
      this.controls.update();
      r.render(this.scene, this.camera);
    };
    loop();
  }

  /** Modellens størrelse i filens egne enheder, efter drejning. */
  private nativeSize(): THREE.Vector3 {
    const saved = this.holder.scale.clone();
    const pos = this.holder.position.clone();
    this.holder.scale.set(1, 1, 1);
    this.holder.position.set(0, 0, 0);
    this.holder.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(this.spin, true).getSize(new THREE.Vector3());
    this.holder.scale.copy(saved);
    this.holder.position.copy(pos);
    this.holder.updateMatrixWorld(true);
    return size;
  }

  private updateDimsFromModel() {
    const n = this.nativeSize();
    const k = UNIT_FACTORS[this.unit] * 100;
    this.dims.set(roundHalf(n.x * k), roundHalf(n.y * k), roundHalf(n.z * k));
  }

  /** Skalerer modellen til målene, stiller den på gulvet og placerer figuren ved siden af. */
  private layout(frame = false) {
    const n = this.nativeSize();
    const safe = (v: number) => (v > 1e-6 ? v : 1);
    this.holder.scale.set(this.dims.x / 100 / safe(n.x), this.dims.y / 100 / safe(n.y), this.dims.z / 100 / safe(n.z));
    this.holder.position.set(0, 0, 0);
    this.holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(this.holder, true);
    const c = b.getCenter(new THREE.Vector3());
    this.holder.position.set(-c.x, -b.min.y, -c.z);
    this.holder.updateMatrixWorld(true);
    const w = this.dims.x / 100;
    this.human.position.set(-w / 2 - 0.35, 0, 0);
    // Opdater box-UV'er for teksturerede materialer (de afhænger af størrelsen)
    for (const r of this.rows) if (r.preset) this.boxUvFor(r);
    if (frame || !this.framed) this.frame();
  }

  private framed = false;

  private frame() {
    this.framed = true;
    const b = new THREE.Box3().setFromObject(this.holder, true).union(new THREE.Box3().setFromObject(this.human));
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(dist));
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
  }

  private rotateFront() {
    this.spin.rotation.y += Math.PI / 2;
    // Bredde og dybde bytter plads
    const x = this.dims.x;
    this.dims.x = this.dims.z;
    this.dims.z = x;
    this.layout();
    this.syncDimInputs();
  }

  private tiltUp() {
    this.tilt.rotation.x -= Math.PI / 2;
    if (!this.dimsEdited) this.updateDimsFromModel();
    else {
      const y = this.dims.y;
      this.dims.y = this.dims.z;
      this.dims.z = y;
    }
    this.layout(true);
    this.syncDimInputs();
  }

  private syncDimInputs() {
    const set = (id: string, v: number) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = fmt(v);
    };
    set('imp-w', this.dims.x);
    set('imp-h', this.dims.y);
    set('imp-d', this.dims.z);
  }

  // ------------------------------------------------------------------ materialer

  private displayMaterials(r: MaterialRow): THREE.Material[] {
    return [r.display];
  }

  private select(r: MaterialRow | null) {
    if (this.selected) for (const m of this.displayMaterials(this.selected)) if ('emissive' in m) (m as THREE.MeshStandardMaterial).emissiveIntensity = (m.userData.baseEmissive as number) ?? 0;
    this.selected = r;
    if (r) {
      for (const m of this.displayMaterials(r)) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!('emissive' in sm)) continue;
        m.userData.baseEmissive ??= sm.emissiveIntensity;
        m.userData.baseEmissiveColor ??= sm.emissive.getHex();
        sm.emissive.set('#2f7fd0');
      }
    }
    // Gendan emissive-farve på alle andre
    for (const row of this.rows) {
      if (row === r) continue;
      const sm = row.display as THREE.MeshStandardMaterial;
      if (sm.userData.baseEmissiveColor !== undefined) sm.emissive.setHex(sm.userData.baseEmissiveColor);
    }
    this.onChange();
    document.querySelector(`.import-mat[data-name="${CSS.escape(r?.original.name ?? '')}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private async applyPreset(r: MaterialRow, presetId: string) {
    const wasSelected = this.selected === r;
    if (wasSelected) this.select(null);
    r.preset = presetId;
    if (!presetId) {
      r.display = r.original;
      this.restoreUv(r);
    } else {
      const p = await createPresetMaterial(presetId, r.original.name);
      if (!p || r.preset !== presetId) return;
      r.display = p.material;
      r.display.userData.textureSize = p.textureSize;
      this.boxUvFor(r);
    }
    this.assignMaterials();
    if (wasSelected) this.select(r);
  }

  /** Sætter hver meshs materialer ud fra rækkernes visningsmaterialer. */
  private assignMaterials() {
    const map = new Map(this.rows.map((r) => [r.original as THREE.Material, r.display]));
    this.model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const orig = mesh.userData.origMats as THREE.Material[];
      const mats = orig.map((m) => map.get(m) ?? m);
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    });
  }

  /** Box-UV'er i meter på de dele, der bruger en tekstureret forudindstilling (kun til forhåndsvisning). */
  private boxUvFor(r: MaterialRow) {
    const size = (r.display.userData.textureSize as number) ?? 0.5;
    this.holder.updateMatrixWorld(true);
    for (const mesh of this.model.meshesByMaterial.get(r.original) ?? []) {
      const g = mesh.geometry;
      if (!g.userData.origUv) g.userData.origUv = g.attributes.uv ?? 'none';
      // Beregn i verdenskoordinater (meter) på en midlertidig kopi
      const tmp = new THREE.BufferGeometry();
      const pos = g.attributes.position.clone();
      const nor = (g.attributes.normal ?? (g.computeVertexNormals(), g.attributes.normal)).clone();
      tmp.setAttribute('position', pos);
      tmp.setAttribute('normal', nor);
      tmp.applyMatrix4(mesh.matrixWorld);
      applyBoxUv(tmp, size);
      g.setAttribute('uv', tmp.attributes.uv);
    }
  }

  private restoreUv(r: MaterialRow) {
    for (const mesh of this.model.meshesByMaterial.get(r.original) ?? []) {
      const g = mesh.geometry;
      const o = g.userData.origUv;
      if (o === undefined) continue;
      if (o === 'none') g.deleteAttribute('uv');
      else g.setAttribute('uv', o);
      delete g.userData.origUv;
    }
  }

  // ------------------------------------------------------------------ eksport

  /** Eksporterer modellen (med drejning, originale materialer og UV'er) som GLB. */
  private async exportGlb(): Promise<ArrayBuffer> {
    const current = this.rows.map((r) => r.display);
    for (const r of this.rows) {
      r.display = r.original;
      this.restoreUv(r);
      const sm = r.original;
      if (sm.userData.baseEmissiveColor !== undefined) sm.emissive.setHex(sm.userData.baseEmissiveColor);
      if (sm.userData.baseEmissive !== undefined) sm.emissiveIntensity = sm.userData.baseEmissive;
    }
    this.assignMaterials();
    const wrapper = new THREE.Group();
    const spin = new THREE.Group();
    spin.rotation.copy(this.spin.rotation);
    const tilt = new THREE.Group();
    tilt.rotation.copy(this.tilt.rotation);
    wrapper.add(spin);
    spin.add(tilt);
    const parent = this.model.root.parent!;
    tilt.add(this.model.root);
    try {
      const out = await new GLTFExporter().parseAsync(wrapper, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
      return out as ArrayBuffer;
    } finally {
      parent.add(this.model.root);
      this.rows.forEach((r, i) => (r.display = current[i]));
      for (const r of this.rows) if (r.preset) this.boxUvFor(r);
      this.assignMaterials();
    }
  }
}

// ---------------------------------------------------------------------- hjælpere

/** Enkel, neutral menneskefigur på 180 cm til størrelsessammenligning. */
function createHuman(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#7d8894', roughness: 0.85 });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.105, 24, 16), 0, 1.695);
  add(new THREE.CapsuleGeometry(0.17, 0.42, 6, 16), 0, 1.24);
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.065, 0.76, 6, 12), s * 0.09, 0.47);
    add(new THREE.CapsuleGeometry(0.045, 0.56, 6, 12), s * 0.23, 1.16);
  }
  g.userData.helper = true;
  return g;
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
const round1 = (v: number) => Math.round(v * 10) / 10;
const roundHalf = (v: number) => Math.max(0.5, Math.round(v * 2) / 2);

function makeId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `mine-${slug || 'moebel'}-${Date.now().toString(36).slice(-5)}`;
}

function alertInline(host: HTMLElement, msg: string) {
  host.append(h('div.props-warn', {}, msg));
}
