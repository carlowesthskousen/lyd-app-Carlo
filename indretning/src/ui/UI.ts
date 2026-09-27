import type { App } from '../app';
import type { ToolId } from '../tools/Tool';
import type { WallMode } from '../state/types';
import { h, clear } from './dom';
import { icon } from './icons';
import { CatalogPanel } from './CatalogPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { CameraHud } from './CameraHud';
import { listProjects, deleteProject } from '../persistence/projects';
import { formatArea } from '../building/BuildingView';

const TOOLS: { id: ToolId; name: string; key: string; icon: string }[] = [
  { id: 'select', name: 'Vælg & flyt', key: 'V', icon: 'select' },
  { id: 'wall', name: 'Væg', key: 'B', icon: 'wall' },
  { id: 'room', name: 'Rum', key: 'N', icon: 'room' },
  { id: 'opening', name: 'Døre & vinduer', key: 'O', icon: 'door' },
  { id: 'paint', name: 'Maling & gulve', key: 'P', icon: 'paint' },
  { id: 'delete', name: 'Slet', key: 'X', icon: 'trash' },
];

/** Opbygger hele brugerfladen omkring 3D-visningen. */
export class UI {
  private toolButtons = new Map<ToolId, HTMLButtonElement>();

  constructor(private app: App, root: HTMLElement) {
    const topbar = root.querySelector<HTMLElement>('#topbar')!;
    const toolbar = root.querySelector<HTMLElement>('#toolbar')!;
    const sidebar = root.querySelector<HTMLElement>('#sidebar')!;
    const stage = root.querySelector<HTMLElement>('#stage')!;

    this.buildTopbar(topbar);
    this.buildToolbar(toolbar);
    new CatalogPanel(app, sidebar);
    new PropertiesPanel(app, stage.querySelector('#props')!);
    this.buildStats(stage.querySelector('#stats')!);
    new CameraHud(app, stage);
    app.attachUi(stage.querySelector('#hint')!, stage.querySelector('#toasts')!);
    this.buildHelp(document.querySelector('#help')!);

    app.on('tool', () => this.syncTools());
    this.syncTools();
  }

  // ------------------------------------------------------------------ topbar

  private buildTopbar(el: HTMLElement) {
    const app = this.app;
    const brand = h('div.brand', {
      html: `<svg width="22" height="30" viewBox="0 0 22 30" aria-hidden="true"><path d="M11 0l9 12-9 18-9-18z" fill="#3fb45f"/><path d="M11 0l9 12H2z" fill="#6fd08a"/><path d="M11 30L2 12h9z" fill="#2f9a4d"/></svg><span>Indretning</span>`,
    });

    const modeSeg = h('div.segmented.mode');
    const bBuild = h('button', { onclick: () => app.setMode('build'), title: 'Byggetilstand (K)', html: `${icon('build', 18)}<span>Byg</span>` });
    const bBuy = h('button', { onclick: () => app.setMode('buy'), title: 'Indretningstilstand (K)', html: `${icon('buy', 18)}<span>Indret</span>` });
    modeSeg.append(bBuild, bBuy);
    const syncMode = () => {
      bBuild.classList.toggle('active', app.mode === 'build');
      bBuy.classList.toggle('active', app.mode === 'buy');
    };
    app.on('mode', syncMode);
    syncMode();

    const name = h('input.project-name', { value: app.store.doc.name, title: 'Projektets navn', 'aria-label': 'Projektets navn' });
    name.addEventListener('change', () => app.rename(name.value));
    app.on('doc', () => {
      if (document.activeElement !== name) name.value = app.store.doc.name;
    });

    const undo = h('button.icon-btn', { onclick: () => app.undo(), html: icon('undo'), title: 'Fortryd (Ctrl+Z)' });
    const redo = h('button.icon-btn', { onclick: () => app.redo(), html: icon('redo'), title: 'Gentag (Ctrl+Y)' });
    const syncHistory = () => {
      undo.disabled = !app.store.canUndo();
      redo.disabled = !app.store.canRedo();
      undo.title = app.store.undoLabel() ? `Fortryd: ${app.store.undoLabel()} (Ctrl+Z)` : 'Fortryd (Ctrl+Z)';
      redo.title = app.store.redoLabel() ? `Gentag: ${app.store.redoLabel()} (Ctrl+Y)` : 'Gentag (Ctrl+Y)';
    };
    app.on('history', syncHistory);
    app.on('doc', syncHistory);
    syncHistory();

    const saved = h('span.saved', {}, '');
    app.on('saved', () => {
      const t = new Date();
      saved.textContent = `Gemt ${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
    });

    // Markeringsfilter
    const filterSeg = h('div.segmented.small.select-filter', { title: 'Hvad markeringsboks og Cmd/Ctrl+A må markere' });
    const fAll = h('button', { onclick: () => app.setSelectionFilter('all') }, 'Alt');
    const fFurn = h('button', { onclick: () => app.setSelectionFilter('furniture') }, 'Kun møbler');
    filterSeg.append(h('span.seg-label', {}, 'Markér'), fFurn, fAll);
    const syncFilter = () => {
      fAll.classList.toggle('active', app.selectionFilter === 'all');
      fFurn.classList.toggle('active', app.selectionFilter === 'furniture');
    };
    app.on('selection', syncFilter);
    syncFilter();

    // Vægvisning
    const wallSeg = h('div.segmented.walls', { title: 'Vægvisning (L)' });
    const wallModes: { m: WallMode; icon: string; t: string }[] = [
      { m: 'up', icon: 'wallsUp', t: 'Vægge oppe' },
      { m: 'cutaway', icon: 'wallsCut', t: 'Cutaway – vægge foran sænkes' },
      { m: 'down', icon: 'wallsDown', t: 'Vægge nede' },
    ];
    const wallBtns = wallModes.map((w) => {
      const b = h('button', { onclick: () => app.setWallMode(w.m), html: icon(w.icon), title: `${w.t} (L)` });
      wallSeg.append(b);
      return { b, m: w.m };
    });
    const syncWalls = () => wallBtns.forEach(({ b, m }) => b.classList.toggle('active', app.store.doc.settings.wallMode === m));
    app.on('settings', syncWalls);
    app.on('doc', syncWalls);
    syncWalls();

    // Tidspunkt på dagen
    const timeIcon = h('span.time-icon', { html: icon('sun', 18) });
    const time = h('input', { type: 'range', min: 5, max: 23.5, step: 0.25, 'aria-label': 'Tidspunkt' }) as HTMLInputElement;
    const timeLabel = h('span.time-label');
    const syncTime = () => {
      const t = app.store.doc.settings.timeOfDay;
      time.value = String(t);
      const hh = Math.floor(t);
      const mm = Math.round((t - hh) * 60);
      timeLabel.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      timeIcon.innerHTML = icon(t < 6.5 || t > 19.5 ? 'moon' : 'sun', 18);
    };
    time.addEventListener('input', () => app.store.setSettings({ timeOfDay: Number(time.value) }));
    app.on('settings', syncTime);
    app.on('doc', syncTime);
    syncTime();
    const timeBox = h('label.time', { title: 'Tidspunkt på dagen' }, timeIcon, time, timeLabel);

    const projects = h('button.icon-btn', { onclick: () => this.openProjects(), html: icon('folder'), title: 'Projekter – gem, åbn, eksportér' });
    const settingsBtn = h('button.icon-btn', { html: icon('settings'), title: 'Indstillinger' });
    const settings = this.buildSettings();
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.classList.toggle('open');
    });
    document.addEventListener('pointerdown', (e) => {
      if (!settings.contains(e.target as Node) && e.target !== settingsBtn) settings.classList.remove('open');
    });
    const help = h('button.icon-btn', { onclick: () => app.emit('help'), html: icon('help'), title: 'Hurtigtaster (H)' });

    el.append(
      brand,
      modeSeg,
      h('div.sep'),
      name,
      undo,
      redo,
      saved,
      h('div.spacer'),
      filterSeg,
      wallSeg,
      timeBox,
      h('div.sep'),
      projects,
      h('div.popover-anchor', {}, settingsBtn, settings),
      help,
    );
  }

  private buildSettings(): HTMLElement {
    const app = this.app;
    const panel = h('div.popover.settings');
    const row = (label: string, control: HTMLElement) => h('label.row', {}, h('span', {}, label), control);
    const check = (get: () => boolean, set: (v: boolean) => void) => {
      const c = h('input', { type: 'checkbox' }) as HTMLInputElement;
      c.checked = get();
      c.addEventListener('change', () => set(c.checked));
      app.on('settings', () => (c.checked = get()));
      return c;
    };
    const select = (options: [string, string][], get: () => string, set: (v: string) => void) => {
      const s = h('select') as HTMLSelectElement;
      for (const [v, t] of options) s.append(h('option', { value: v }, t));
      s.value = get();
      s.addEventListener('change', () => set(s.value));
      app.on('settings', () => (s.value = get()));
      return s;
    };
    const cam = app.camera;
    const range = (min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const input = h('input', { type: 'range', min, max, step }) as HTMLInputElement;
      const out = h('output', {}, '');
      const sync = () => {
        input.value = String(get());
        out.textContent = fmt(get());
      };
      input.addEventListener('input', () => {
        set(Number(input.value));
        out.textContent = fmt(Number(input.value));
      });
      app.on('settings', sync);
      app.on('speed', sync);
      sync();
      return h('span.range', {}, input, out);
    };
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const ms = (v: number) => `${v.toFixed(1).replace('.', ',')} m/s`;

    panel.append(
      h('h4', {}, 'Kamera'),
      row(
        'Tilstand (Tab)',
        select(
          [['build', 'Byg (orbit)'], ['drone', 'Drone (fri flyvning)']],
          () => cam.mode,
          (v) => cam.setMode(v as 'build' | 'drone'),
        ),
      ),
      row('Musefølsomhed', range(0.2, 3, 0.05, () => cam.settings.sensitivity, (v) => cam.updateSettings({ sensitivity: v }), pct)),
      row('Invertér Y', check(() => cam.settings.invertY, (v) => cam.updateSettings({ invertY: v }))),
      row('Byggekamera, fart', range(0.2, 4, 0.05, () => cam.settings.buildSpeed, (v) => cam.updateSettings({ buildSpeed: v }), pct)),
      h('h4', {}, 'Drone'),
      row('Flyvehastighed', range(0.3, 30, 0.1, () => cam.settings.droneSpeed, (v) => cam.updateSettings({ droneSpeed: v }), ms)),
      row(
        'Glid (inerti)',
        range(0, 1, 0.01, () => cam.settings.glide, (v) => cam.updateSettings({ glide: v }), (v) => (v < 0.2 ? 'Stram' : v > 0.75 ? 'Flydende' : 'Mellem')),
      ),
      row('Krængning', check(() => cam.settings.bank, (v) => cam.updateSettings({ bank: v }))),
      row('Væg-kollision', check(() => cam.settings.wallCollision, (v) => cam.updateSettings({ wallCollision: v }))),
      h('h4', {}, 'Byggeri'),
      row('Snap til gitter', check(() => app.store.doc.settings.snapEnabled, (v) => app.store.setSettings({ snapEnabled: v }))),
      row(
        'Snap-afstand',
        select(
          [['0.1', '10 cm'], ['0.5', '50 cm']],
          () => String(app.store.doc.settings.snapStep),
          (v) => app.store.setSettings({ snapStep: Number(v) }),
        ),
      ),
      row('Vis gitter altid (G)', check(() => app.gridForced, () => app.toggleGrid())),
      row('Vis rum-mål (m²)', check(() => app.building.showRoomLabels, (v) => app.building.setRoomLabelsVisible(v))),
      h('h4', {}, 'Grafik'),
      row('SSAO (bløde skygger i hjørner)', check(() => app.viewport.quality.ssao, (v) => app.viewport.setQuality({ ssao: v }))),
      row(
        'Skyggekvalitet',
        select(
          [['1024', 'Lav'], ['2048', 'Mellem'], ['4096', 'Høj']],
          () => String(app.viewport.quality.shadowSize),
          (v) => app.viewport.setQuality({ shadowSize: Number(v) }),
        ),
      ),
      row(
        'Opløsning',
        select(
          [[String(Math.min(window.devicePixelRatio, 2)), 'Skarp'], ['1', 'Normal'], ['0.75', 'Hurtig']],
          () => String(app.viewport.quality.pixelRatio),
          (v) => app.viewport.setQuality({ pixelRatio: Number(v) }),
        ),
      ),
    );
    return panel;
  }

  // ------------------------------------------------------------------ toolbar

  private buildToolbar(el: HTMLElement) {
    const app = this.app;
    for (const t of TOOLS) {
      const b = h('button.tool', {
        onclick: () => app.setTool(t.id),
        html: `${icon(t.icon, 22)}<span class="tip">${t.name} <kbd>${t.key}</kbd></span>`,
        'aria-label': t.name,
      });
      if (t.id === 'delete') b.classList.add('danger');
      this.toolButtons.set(t.id, b);
      el.append(b);
    }
    el.append(h('div.tool-sep'));
    const view = [
      { icon: 'focus', name: 'Fokusér på valgt', key: 'G', fn: () => app.focusSelection() },
      { icon: 'top', name: 'Set oppefra', key: 'Y', fn: () => app.topDown() },
      { icon: 'home', name: 'Nulstil visning', key: 'Home', fn: () => app.resetView() },
      { icon: 'grid', name: 'Gitter', key: 'M', fn: () => app.toggleGrid() },
    ];
    for (const v of view) {
      el.append(h('button.tool', { onclick: v.fn, html: `${icon(v.icon, 22)}<span class="tip">${v.name} <kbd>${v.key}</kbd></span>`, 'aria-label': v.name }));
    }
  }

  private syncTools() {
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', this.app.toolId === id || (id === 'select' && this.app.toolId === 'furniture'));
  }

  // ------------------------------------------------------------------ stats

  private buildStats(el: HTMLElement) {
    const app = this.app;
    const sync = () => {
      const s = app.stats;
      el.textContent = `${Math.round(s.fps)} fps · ${s.furniture} møbler · ${s.rooms} rum · ${formatArea(s.area)}`;
      el.classList.toggle('slow', s.fps < 40);
    };
    app.on('stats', sync);
    app.on('doc', sync);
  }

  // ------------------------------------------------------------------ help

  private buildHelp(el: HTMLElement) {
    const groups: [string, [string, string][]][] = [
      [
        'Drone-kamera (Tab)',
        [
          ['W A S D', 'Flyv dertil du kigger'],
          ['Space · Shift', 'Lodret op · ned'],
          ['Venstre/højre + træk', 'Kig rundt (markøren låses)'],
          ['Midterklik / Alt + træk', 'Orbit om punktet'],
          ['Klik (under 5 px)', 'Brug aktivt værktøj'],
          ['Ctrl · Alt', 'Boost · præcision'],
          ['Scroll', 'Flyvehastighed'],
        ],
      ],
      [
        'Byg-kamera',
        [
          ['W A S D', 'Flyv vandret'],
          ['Space · C', 'Op · ned'],
          ['Shift', 'Boost'],
          ['Højreklik + træk', 'Orbit om punktet'],
          ['Midterklik + træk', 'Panorér'],
          ['Scroll', 'Zoom mod musen'],
        ],
      ],
      [
        'Begge kameraer',
        [
          ['Q · E', 'Drej venstre · højre'],
          ['R · F', 'Kig op · ned (R drejer markeringen, når noget er markeret)'],
          ['Tab', 'Skift Drone / Byg'],
          ['[ · ]', 'Langsommere · hurtigere'],
          ['G', 'Fokusér på valgt'],
          ['Y', 'Set oppefra'],
          ['Home', 'Nulstil visning'],
        ],
      ],
      [
        'Værktøjer',
        [
          ['V', 'Vælg & flyt'],
          ['B', 'Tegn vægge'],
          ['N', 'Byg rum (træk rektangel)'],
          ['O', 'Døre & vinduer'],
          ['P', 'Maling & gulve'],
          ['X', 'Slet-værktøj'],
          ['K', 'Skift Byg / Indret'],
          ['Esc / højreklik', 'Afslut værktøj'],
        ],
      ],
      [
        'Markering',
        [
          ['Klik', 'Markér (hele gruppen)'],
          ['Shift+klik', 'Tilføj / fjern'],
          ['Træk på tom plads', 'Markeringsboks (Shift: tilføj)'],
          ['Dobbeltklik', 'Ét objekt i en gruppe'],
          ['Cmd/Ctrl+A · Esc', 'Markér alt · fjern markering'],
          ['Træk i markeringen', 'Flyt hele bunken'],
          ['Pile · Alt+pile', 'Skub 1 cm · 10 cm'],
          ['R / T · Shift', 'Drej 15° · modsat'],
          ['Alt+R · Alt+scroll', 'Drej frit'],
        ],
      ],
      [
        'Redigering',
        [
          ['Cmd/Ctrl+Z · Y', 'Fortryd · gentag'],
          ['Cmd/Ctrl+D', 'Duplikér (følger musen)'],
          ['Cmd/Ctrl+C · V', 'Kopiér · indsæt'],
          ['Cmd/Ctrl+G', 'Gem som gruppe'],
          ['Cmd/Ctrl+Shift+G', 'Opløs gruppe'],
          ['Delete / Backspace', 'Slet markeret'],
          ['T (døre)', 'Spejlvend dør'],
          ['Alt (hold)', 'Placér uden snap'],
          ['Shift (væg)', 'Lås vinkel til 45°'],
        ],
      ],
      [
        'Visning',
        [
          ['Shift+klik (maling)', 'Mal hele rummet'],
          ['L', 'Vægge oppe / cutaway / nede'],
          ['M', 'Vis/skjul gitter'],
          ['Cmd/Ctrl+S', 'Gem'],
          ['H', 'Denne oversigt'],
        ],
      ],
    ];
    const card = h('div.help-card');
    card.append(
      h('div.help-head', {}, h('h2', {}, 'Hurtigtaster'), h('button.icon-btn', { html: icon('close'), onclick: () => toggle(false), 'aria-label': 'Luk' })),
    );
    const cols = h('div.help-cols');
    for (const [title, rows] of groups) {
      const col = h('div', {}, h('h3', {}, title));
      for (const [k, v] of rows) col.append(h('div.help-row', {}, h('kbd', {}, k), h('span', {}, v)));
      cols.append(col);
    }
    card.append(cols, h('p.help-foot', {}, 'Controller: venstre stick bevæger, højre stick kigger, RT/LT op/ned, RB boost, LB præcision, Y skifter tilstand. Bemærk: Ctrl+W (boost frem) lukker fanen i nogle browsere – i drone-tilstand spørger browseren først.'));
    el.append(card);
    const toggle = (open?: boolean) => el.classList.toggle('open', open);
    el.addEventListener('pointerdown', (e) => e.target === el && toggle(false));
    this.app.on('help', () => toggle());
    this.app.on('escape', () => toggle(false));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') toggle(false);
    });
  }

  // ------------------------------------------------------------------ projects

  private openProjects() {
    const app = this.app;
    app.saveNow();
    const overlay = h('div.modal-bg');
    const close = () => overlay.remove();
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());
    const list = h('div.project-list');
    const render = () => {
      clear(list);
      for (const p of listProjects()) {
        const current = p.id === app.store.doc.id;
        const date = new Date(p.updatedAt).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' });
        list.append(
          h(
            'div.project-row',
            { class: current ? 'project-row current' : 'project-row' },
            h('div.meta', {}, h('b', {}, p.name), h('span', {}, `${date} · ${p.walls} vægge · ${p.furniture} møbler`)),
            h('button.btn', { onclick: () => (app.openProject(p.id), close()), disabled: current }, current ? 'Åben' : 'Åbn'),
            h('button.btn.danger', {
              html: icon('trash', 16),
              title: 'Slet projekt',
              disabled: current,
              onclick: (e: Event) => {
                // To klik: første klik beder om bekræftelse (ingen browser-dialog).
                const b = e.currentTarget as HTMLButtonElement;
                if (b.dataset.armed) {
                  deleteProject(p.id);
                  render();
                } else {
                  b.dataset.armed = '1';
                  b.innerHTML = `${icon('trash', 16)}<span>Klik igen for at slette</span>`;
                }
              },
            }),
          ),
        );
      }
    };
    render();
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true }) as HTMLInputElement;
    file.addEventListener('change', () => {
      if (file.files?.[0]) app.importProject(file.files[0]).then(close);
    });
    const dialog = h(
      'div.modal',
      { role: 'dialog', 'aria-label': 'Projekter' },
      h('div.help-head', {}, h('h2', {}, 'Projekter'), h('button.icon-btn', { html: icon('close'), onclick: close, 'aria-label': 'Luk' })),
      h('p.muted', {}, 'Projekter gemmes automatisk i din browser. Eksportér som JSON for at tage backup eller dele.'),
      h(
        'div.actions',
        {},
        h('button.btn', { html: `${icon('plus', 16)} Nyt tomt projekt`, onclick: () => (app.newProject(true), close()) }),
        h('button.btn', { html: `${icon('home', 16)} Nyt fra starterhus`, onclick: () => (app.newProject(false), close()) }),
        h('button.btn', { html: `${icon('download', 16)} Eksportér JSON`, onclick: () => app.exportProject() }),
        h('button.btn', { html: `${icon('upload', 16)} Importér JSON`, onclick: () => file.click() }),
        file,
      ),
      list,
    );
    overlay.append(dialog);
    document.body.append(overlay);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        window.removeEventListener('keydown', onKey);
      }
    };
    window.addEventListener('keydown', onKey);
  }
}
