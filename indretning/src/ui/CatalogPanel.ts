import type { App } from '../app';
import { h, clear } from './dom';
import { icon } from './icons';
import { CATEGORIES, type CatalogEntry, type CategoryId, formatDims } from '../furniture/catalog';
import { Thumbnails } from './Thumbnails';
import { FLOOR_PRESETS, OPENING_STYLES, WALL_PRESETS, type MaterialPreset } from '../building/buildCatalog';
import type { FloorMaterial, WallMaterial } from '../state/types';

const WALL_TYPE_NAMES = { paint: 'Maling', brick: 'Mursten', plaster: 'Puds' };
const FLOOR_TYPE_NAMES = { wood: 'Træ', tiles: 'Fliser', concrete: 'Beton', carpet: 'Tæppe' };

/** Højre panel: møbelkatalog (Indret) eller byggekatalog (Byg). */
export class CatalogPanel {
  private category: CategoryId = 'sofaer';
  private query = '';
  private thumbs: Thumbnails;
  private body: HTMLElement;
  private title: HTMLElement;

  constructor(private app: App, private el: HTMLElement) {
    this.thumbs = new Thumbnails(app.catalog, app.library, app.furniture);
    this.title = h('div.panel-title');
    this.body = h('div.panel-body');
    el.append(this.title, this.body);
    app.on('mode', () => this.render());
    app.on('catalog', () => this.render());
    app.on('tool', () => this.syncActive());
    this.render();
  }

  private render() {
    clear(this.title);
    clear(this.body);
    if (this.app.mode === 'buy') this.renderBuy();
    else this.renderBuild();
    this.syncActive();
  }

  // ---------------------------------------------------------------- Indret (møbler)

  private renderBuy() {
    this.title.append(h('h2', {}, 'Møbler'), h('span.muted', {}, `${this.app.catalog.entries.size} varer`));
    const search = h('input.search', { type: 'search', placeholder: 'Søg i kataloget …', value: this.query }) as HTMLInputElement;
    const searchBox = h('label.search-box', { html: icon('search', 16) }, search);
    const cats = h('div.cats');
    for (const c of CATEGORIES) {
      const count = this.app.catalog.byCategory(c.id).length;
      if (!count) continue;
      const b = h('button.cat', {
        html: `${icon(c.icon, 20)}<span>${c.name}</span>`,
        title: c.name,
        onclick: () => {
          this.category = c.id;
          this.query = '';
          this.render();
        },
      });
      b.classList.toggle('active', !this.query && this.category === c.id);
      cats.append(b);
    }
    const grid = h('div.catalog-grid');
    const fill = () => {
      clear(grid);
      const q = this.query.trim().toLowerCase();
      const items = q
        ? [...this.app.catalog.entries.values()].filter((e) =>
            [e.name, e.manufacturer, e.designer, e.category, ...(e.tags ?? [])].join(' ').toLowerCase().includes(q),
          )
        : this.app.catalog.byCategory(this.category);
      if (!items.length) grid.append(h('p.muted', {}, 'Ingen møbler fundet.'));
      for (const e of items) grid.append(this.card(e));
    };
    search.addEventListener('input', () => {
      this.query = search.value;
      cats.querySelectorAll('.cat').forEach((b) => b.classList.toggle('active', false));
      fill();
    });
    fill();
    this.body.append(searchBox, cats, grid, h('p.panel-foot', {}, 'Træk et møbel ind i rummet, eller klik og placér. Tilføj dine egne modeller i public/models (se README).'));
  }

  private card(e: CatalogEntry) {
    const img = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
    const thumb = h('div.thumb', {}, img);
    this.thumbs.get(e).then((url) => {
      img.src = url;
      thumb.classList.add('loaded');
    });
    const err = this.app.library.errors.get(e.id);
    const who = [e.manufacturer, e.designer && e.designer !== '—' ? e.designer : null].filter(Boolean).join(' · ');
    const card = h(
      'div.catalog-card',
      { title: `${e.name}\n${who}\n${formatDims(e)}${err ? `\n⚠ ${err}` : ''}`, 'data-id': e.id, tabindex: 0 },
      thumb,
      h('div.card-name', {}, e.name),
      h('div.card-meta', {}, who || ' '),
      h('div.card-dims', {}, `${e.dimensions.width}×${e.dimensions.depth}×${e.dimensions.height}`),
    );
    if (e.light) card.append(h('span.badge', { html: icon('bulb', 14), title: 'Udsender lys' }));
    card.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      this.app.startPlacing(e, true);
    });
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.app.startPlacing(e, false);
    });
    return card;
  }

  // ---------------------------------------------------------------- Byg

  private renderBuild() {
    const app = this.app;
    this.title.append(h('h2', {}, 'Byg'), h('span.muted', {}, 'Vægge, døre, vinduer og overflader'));

    // Tegneværktøjer
    const tools = h(
      'div.build-tools',
      {},
      this.bigTool('wall', 'Væg', 'Tegn punkt for punkt', 'B'),
      this.bigTool('room', 'Rum', 'Træk et rektangel', 'N'),
    );
    const s = app.store.doc.settings;
    const height = this.slider('Væghøjde', 2.0, 4.0, 0.05, s.defaultWallHeight, (v) => `${v.toFixed(2).replace('.', ',')} m`, (v) =>
      app.store.setSettings({ defaultWallHeight: v }),
    );
    const thick = this.slider('Vægtykkelse', 0.06, 0.5, 0.01, s.defaultWallThickness, (v) => `${Math.round(v * 100)} cm`, (v) =>
      app.store.setSettings({ defaultWallThickness: v }),
    );
    const snapSeg = h('div.segmented.small');
    const snapOpts: [string, () => void, () => boolean][] = [
      ['Fri', () => app.store.setSettings({ snapEnabled: false }), () => !app.store.doc.settings.snapEnabled],
      ['10 cm', () => app.store.setSettings({ snapEnabled: true, snapStep: 0.1 }), () => app.store.doc.settings.snapEnabled && app.store.doc.settings.snapStep === 0.1],
      ['50 cm', () => app.store.setSettings({ snapEnabled: true, snapStep: 0.5 }), () => app.store.doc.settings.snapEnabled && app.store.doc.settings.snapStep === 0.5],
    ];
    const snapBtns = snapOpts.map(([t, fn, on]) => {
      const b = h('button', { onclick: fn }, t);
      snapSeg.append(b);
      return { b, on };
    });
    const syncSnap = () => snapBtns.forEach(({ b, on }) => b.classList.toggle('active', on()));
    app.on('settings', syncSnap);
    syncSnap();

    this.body.append(
      this.section('Vægge', tools, height, thick, h('div.field', {}, h('span', {}, 'Snap'), snapSeg)),
      this.section('Døre', this.openingGrid('door')),
      this.section('Vinduer', this.openingGrid('window')),
      this.section('Vægge: maling & materialer', this.swatches('wall', WALL_PRESETS), this.customMaterial('wall')),
      this.section('Gulve', this.swatches('floor', FLOOR_PRESETS), this.customMaterial('floor')),
    );
  }

  private section(title: string, ...children: HTMLElement[]) {
    return h('section.build-section', {}, h('h3', {}, title), ...children);
  }

  private bigTool(id: 'wall' | 'room', name: string, sub: string, key: string) {
    const b = h('button.big-tool', {
      'data-tool': id,
      html: `${icon(id, 24)}<span><b>${name}</b><small>${sub}</small></span><kbd>${key}</kbd>`,
      onclick: () => this.app.setTool(id),
    });
    return b;
  }

  private slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void) {
    const input = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
    const out = h('output', {}, fmt(value));
    input.addEventListener('input', () => {
      out.textContent = fmt(Number(input.value));
      set(Number(input.value));
    });
    return h('label.field', {}, h('span', {}, label), input, out);
  }

  private openingGrid(kind: 'door' | 'window') {
    const grid = h('div.opening-grid');
    for (const st of OPENING_STYLES.filter((s) => s.kind === kind)) {
      const b = h('button.opening-card', {
        'data-opening': st.id,
        onclick: () => {
          this.app.openingStyleId = st.id;
          this.app.setTool('opening');
          this.syncActive();
        },
        html: `${icon(kind === 'door' ? 'door' : 'window', 22)}<span>${st.name}</span><small>${Math.round(st.width * 100)}×${Math.round(st.height * 100)}</small>`,
      });
      grid.append(b);
    }
    return grid;
  }

  private swatches<T extends WallMaterial | FloorMaterial>(target: 'wall' | 'floor', presets: MaterialPreset<T>[]) {
    const grid = h('div.swatches');
    for (const p of presets) {
      const b = h('button.swatch', {
        title: p.name,
        'data-swatch': `${target}:${p.value.type}:${p.value.color}`,
        onclick: () => this.choosePaint(target, p.value),
      });
      b.style.setProperty('--c', p.value.color);
      b.classList.add(`mat-${p.value.type}`);
      b.append(h('span', {}, p.name));
      grid.append(b);
    }
    return grid;
  }

  private customMaterial(target: 'wall' | 'floor') {
    const types = target === 'wall' ? WALL_TYPE_NAMES : FLOOR_TYPE_NAMES;
    const sel = h('select') as HTMLSelectElement;
    for (const [k, v] of Object.entries(types)) sel.append(h('option', { value: k }, v));
    const color = h('input', { type: 'color', value: target === 'wall' ? '#b7c4cf' : '#b08a64' }) as HTMLInputElement;
    const apply = () => this.choosePaint(target, { type: sel.value, color: color.value } as WallMaterial & FloorMaterial);
    sel.addEventListener('change', apply);
    color.addEventListener('input', apply);
    return h('div.field.custom', {}, h('span', {}, 'Egen farve'), sel, color);
  }

  private choosePaint(target: 'wall' | 'floor', material: WallMaterial | FloorMaterial) {
    this.app.paint = target === 'wall' ? { target, material: { ...(material as WallMaterial) } } : { target, material: { ...(material as FloorMaterial) } };
    this.app.setTool('paint');
    this.app.setHint(`${target === 'wall' ? 'Klik på en vægside' : 'Klik på et gulv'} for at bruge materialet · Shift+klik maler hele rummet · Esc afslutter`);
    this.syncActive();
  }

  private syncActive() {
    const app = this.app;
    this.el.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', app.toolId === b.dataset.tool));
    this.el
      .querySelectorAll<HTMLElement>('[data-opening]')
      .forEach((b) => b.classList.toggle('active', app.toolId === 'opening' && app.openingStyleId === b.dataset.opening));
    const key = `${app.paint.target}:${app.paint.material.type}:${app.paint.material.color}`;
    this.el.querySelectorAll<HTMLElement>('[data-swatch]').forEach((b) => b.classList.toggle('active', app.toolId === 'paint' && b.dataset.swatch === key));
  }
}
