import type { App } from '../app';
import { h, clear } from './dom';
import { icon } from './icons';
import { FINISH_NAMES, formatDims } from '../furniture/catalog';
import { FLOOR_PRESETS, OPENING_STYLES, WALL_PRESETS, openingStyle } from '../building/buildCatalog';
import { formatArea, formatLength, roomStyleFor } from '../building/BuildingView';
import { openingFits, wallFrame } from '../building/wallGraph';
import type { FloorMaterial, WallMaterial } from '../state/types';
import { setRoomFloor } from '../tools/PaintTool';
import { ROT_STEP } from '../tools/furniturePlacement';
import { exactGroup } from '../selection/selectionOps';

/** Egenskabspanel for det valgte objekt (Sims-agtigt infokort nederst til venstre). */
export class PropertiesPanel {
  private key = '';

  constructor(private app: App, private el: HTMLElement) {
    app.on('selection', () => this.render(true));
    app.on('doc', () => this.render(false));
    this.render(true);
  }

  private render(force: boolean) {
    if (this.app.selected.length > 1) return this.renderMulti(force);
    const sel = this.app.selection;
    const doc = this.app.store.doc;
    // Undgå at genopbygge (og miste fokus i felter) mens man trækker.
    const key = sel ? `${sel.kind}:${sel.id}:${JSON.stringify(this.dataFor())}` : '';
    if (!force && key === this.key) return;
    if (!force && document.activeElement && this.el.contains(document.activeElement) && sel && this.key.startsWith(`${sel.kind}:${sel.id}`)) {
      this.key = key;
      return;
    }
    this.key = key;
    clear(this.el);
    this.el.classList.toggle('open', !!sel);
    if (!sel) return;
    if (sel.kind === 'furniture' && doc.furniture[sel.id]) this.furniture(sel.id);
    else if (sel.kind === 'wall' && doc.walls[sel.id]) this.wall(sel.id);
    else if (sel.kind === 'opening' && doc.openings[sel.id]) this.opening(sel.id);
    else if (sel.kind === 'floor') this.floor(sel.id);
  }

  /** Panel for flere markerede objekter: "5 markeret" + handlinger på hele bunken. */
  private renderMulti(force: boolean) {
    const app = this.app;
    const doc = app.store.doc;
    const refs = app.selected;
    const group = exactGroup(doc, refs);
    const key = `multi:${refs.map((r) => r.id).join(',')}:${group?.name ?? ''}:${app.collisions.size}`;
    if (!force && key === this.key) return;
    if (!force && document.activeElement && this.el.contains(document.activeElement)) return;
    this.key = key;
    clear(this.el);
    this.el.classList.add('open');
    const count = (k: string) => refs.filter((r) => r.kind === k).length;
    const parts = [
      [count('furniture'), 'møbel', 'møbler'],
      [count('wall'), 'væg', 'vægge'],
      [count('opening'), 'dør/vindue', 'døre/vinduer'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
      .join(' · ');
    this.el.append(
      h(
        'div.props-head',
        {},
        h('div', {}, h('h3', {}, `${refs.length} markeret`), h('span.muted', {}, parts)),
        h('button.icon-btn', { html: icon('close', 18), onclick: () => app.select(null), 'aria-label': 'Fjern markering' }),
      ),
    );
    if (group) {
      const name = h('input', { type: 'text', value: group.name, id: 'group-name', 'aria-label': 'Gruppens navn' }) as HTMLInputElement;
      name.addEventListener('change', () => app.renameGroup(group.id, name.value));
      this.el.append(h('label.props-row', {}, h('span', {}, 'Gruppe'), name));
    }
    const colliding = refs.filter((r) => r.kind === 'furniture' && app.collisions.has(r.id)).length;
    if (colliding) this.el.append(h('div.props-warn', {}, `${colliding} af møblerne overlapper noget`));
    this.el.append(
      this.actions(
        this.btn('trash', 'Slet', () => app.deleteSelection(), 'danger'),
        this.btn('copy', 'Duplikér', () => app.duplicateSelection()),
        this.btn('rotate', 'Rotér 15°', () => app.rotateSelection(ROT_STEP)),
        group ? this.btn('close', 'Opløs gruppe', () => app.ungroupSelection()) : this.btn('plus', 'Grupér', () => app.groupSelection()),
        this.btn('focus', 'Fokus', () => app.focusSelection()),
      ),
      h('p.props-tip', {}, 'Træk i et markeret objekt for at flytte det hele · pile skubber 1 cm (Alt: 10 cm) · Cmd/Ctrl+C/V kopierer'),
    );
  }

  private dataFor() {
    const sel = this.app.selection;
    const d = this.app.store.doc;
    if (!sel) return null;
    if (sel.kind === 'furniture') return [d.furniture[sel.id], this.app.collisions.has(sel.id)];
    if (sel.kind === 'wall') return d.walls[sel.id];
    if (sel.kind === 'opening') return d.openings[sel.id];
    return d.rooms;
  }

  private header(title: string, sub?: string) {
    return h(
      'div.props-head',
      {},
      h('div', {}, h('h3', {}, title), sub ? h('span.muted', {}, sub) : null),
      h('button.icon-btn', { html: icon('close', 18), onclick: () => this.app.select(null), 'aria-label': 'Luk' }),
    );
  }

  private actions(...btns: HTMLElement[]) {
    return h('div.props-actions', {}, ...btns);
  }

  private btn(ic: string, label: string, fn: () => void, cls = '') {
    return h(`button.btn${cls ? '.' + cls : ''}` as 'button', { html: `${icon(ic, 16)}<span>${label}</span>`, onclick: fn });
  }

  // ---------------------------------------------------------------- møbel

  private furniture(id: string) {
    const app = this.app;
    const it = app.store.doc.furniture[id];
    const e = app.catalog.get(it.catalogId);
    if (!e) {
      this.el.append(this.header('Ukendt møbel', it.catalogId), this.actions(this.btn('trash', 'Slet', () => app.deleteSelection(), 'danger')));
      return;
    }
    const who = [e.manufacturer, e.designer && e.designer !== '—' ? `design: ${e.designer}` : null].filter(Boolean).join(' · ');
    this.el.append(this.header(e.name, who));
    this.el.append(h('div.props-row.muted', {}, formatDims(e)));
    if (app.collisions.has(id)) this.el.append(h('div.props-warn', {}, 'Overlapper et andet møbel eller en væg'));
    const err = app.library.errors.get(e.id);
    if (err) this.el.append(h('div.props-warn', {}, err));

    if (e.recolorable !== false) {
      const color = h('input', { type: 'color', value: it.color ?? e.defaultColor ?? '#cccccc' }) as HTMLInputElement;
      let pending = false;
      color.addEventListener('input', () => {
        if (!pending) {
          app.store.begin();
          pending = true;
        }
        app.store.update((d) => (d.furniture[id].color = color.value));
      });
      color.addEventListener('change', () => {
        if (pending) app.store.commit('Skift farve');
        pending = false;
      });
      const reset = h('button.link', { onclick: () => app.updateItem(id, { color: undefined }, 'Nulstil farve') }, 'Standard');
      this.el.append(h('label.props-row', {}, h('span', {}, 'Farve'), color, reset));
    }
    if (e.finishes?.length) {
      const seg = h('div.segmented.small');
      const cur = it.finish ?? e.defaultFinish ?? e.finishes[0];
      for (const f of e.finishes) {
        const b = h('button', { onclick: () => app.updateItem(id, { finish: f }, 'Skift materiale') }, FINISH_NAMES[f]);
        b.classList.toggle('active', f === cur);
        seg.append(b);
      }
      this.el.append(h('div.props-row', {}, h('span', {}, 'Materiale'), seg));
    }
    const deg = Math.round((((it.rotation * 180) / Math.PI) % 360 + 360) % 360);
    const rot = h('input.num', { type: 'number', value: deg, step: 15, min: -360, max: 720 }) as HTMLInputElement;
    rot.addEventListener('change', () => app.updateItem(id, { rotation: (Number(rot.value) * Math.PI) / 180 }, 'Drej møbel'));
    this.el.append(h('label.props-row', {}, h('span', {}, 'Rotation'), rot, h('span.unit', {}, '°')));
    if (e.placement === 'wall' || e.placement === 'ceiling' || it.y > 0) {
      const y = h('input.num', { type: 'number', value: Math.round(it.y * 100), step: 5 }) as HTMLInputElement;
      y.addEventListener('change', () => app.updateItem(id, { y: Math.max(0, Number(y.value) / 100) }, 'Skift højde'));
      this.el.append(h('label.props-row', {}, h('span', {}, 'Højde over gulv'), y, h('span.unit', {}, 'cm')));
    }
    if (e.light) {
      const on = it.lightOn !== false;
      const t = h('button.toggle', { html: `${icon('bulb', 16)}<span>${on ? 'Tændt' : 'Slukket'}</span>`, onclick: () => app.updateItem(id, { lightOn: !on }, on ? 'Sluk lampe' : 'Tænd lampe') });
      t.classList.toggle('on', on);
      this.el.append(h('div.props-row', {}, h('span', {}, 'Lys'), t));
    }
    this.el.append(
      this.actions(
        this.btn('rotate', '15°', () => app.updateItem(id, { rotation: it.rotation + ROT_STEP }, 'Drej møbel')),
        this.btn('copy', 'Duplikér', () => app.duplicateSelection()),
        this.btn('focus', 'Fokus', () => app.focusSelection()),
        this.btn('trash', 'Slet', () => app.deleteSelection(), 'danger'),
      ),
    );
  }

  // ---------------------------------------------------------------- væg

  private wall(id: string) {
    const app = this.app;
    const doc = app.store.doc;
    const w = doc.walls[id];
    const f = wallFrame(doc, w);
    const openings = Object.values(doc.openings).filter((o) => o.wallId === id).length;
    this.el.append(this.header('Væg', `${formatLength(f.length)} lang${openings ? ` · ${openings} åbning${openings > 1 ? 'er' : ''}` : ''}`));
    const height = h('input.num', { type: 'number', value: Math.round(w.height * 100), step: 5, min: 50, max: 600 }) as HTMLInputElement;
    height.addEventListener('change', () =>
      app.store.transact('Skift væghøjde', (d) => {
        const v = Math.max(0.5, Math.min(6, Number(height.value) / 100));
        d.walls[id].height = v;
      }),
    );
    const thick = h('input.num', { type: 'number', value: Math.round(w.thickness * 100), step: 1, min: 4, max: 60 }) as HTMLInputElement;
    thick.addEventListener('change', () =>
      app.store.transact('Skift vægtykkelse', (d) => {
        d.walls[id].thickness = Math.max(0.04, Math.min(0.6, Number(thick.value) / 100));
      }),
    );
    this.el.append(
      h('label.props-row', {}, h('span', {}, 'Højde'), height, h('span.unit', {}, 'cm')),
      h('label.props-row', {}, h('span', {}, 'Tykkelse'), thick, h('span.unit', {}, 'cm')),
      this.wallSide(id, 'A', 'Side 1'),
      this.wallSide(id, 'B', 'Side 2'),
      this.actions(this.btn('focus', 'Fokus', () => app.focusSelection()), this.btn('trash', 'Slet væg', () => app.deleteSelection(), 'danger')),
    );
  }

  private wallSide(id: string, side: 'A' | 'B', label: string) {
    const app = this.app;
    const w = app.store.doc.walls[id];
    const m = side === 'A' ? w.sideA : w.sideB;
    const sel = h('select') as HTMLSelectElement;
    sel.append(h('option', { value: '' }, 'Vælg …'));
    for (const p of WALL_PRESETS) sel.append(h('option', { value: p.id }, p.name));
    const match = WALL_PRESETS.find((p) => p.value.type === m.type && p.value.color.toLowerCase() === m.color.toLowerCase());
    sel.value = match?.id ?? '';
    const color = h('input', { type: 'color', value: m.color }) as HTMLInputElement;
    const set = (mat: WallMaterial) =>
      app.store.transact('Mal væg', (d) => {
        d.walls[id][side === 'A' ? 'sideA' : 'sideB'] = mat;
      });
    sel.addEventListener('change', () => {
      const p = WALL_PRESETS.find((x) => x.id === sel.value);
      if (p) set({ ...p.value });
    });
    color.addEventListener('change', () => set({ type: m.type, color: color.value }));
    return h('div.props-row', {}, h('span', {}, label), sel, color);
  }

  // ---------------------------------------------------------------- åbning

  private opening(id: string) {
    const app = this.app;
    const doc = app.store.doc;
    const o = doc.openings[id];
    const st = openingStyle(o.style);
    this.el.append(this.header(o.kind === 'door' ? 'Dør' : 'Vindue', st.name));
    const styleSel = h('select') as HTMLSelectElement;
    for (const s of OPENING_STYLES.filter((s) => s.kind === o.kind)) styleSel.append(h('option', { value: s.id }, s.name));
    styleSel.value = o.style;
    styleSel.addEventListener('change', () => {
      const s = openingStyle(styleSel.value);
      this.tryOpening(id, { style: s.id, width: s.width, height: s.height, sill: s.sill }, 'Skift type');
    });
    this.el.append(h('label.props-row', {}, h('span', {}, 'Type'), styleSel));
    const num = (label: string, key: 'width' | 'height' | 'sill', min: number, max: number) => {
      const input = h('input.num', { type: 'number', value: Math.round(o[key] * 100), step: 5, min, max }) as HTMLInputElement;
      input.addEventListener('change', () => this.tryOpening(id, { [key]: Number(input.value) / 100 }, 'Skift mål'));
      return h('label.props-row', {}, h('span', {}, label), input, h('span.unit', {}, 'cm'));
    };
    this.el.append(num('Bredde', 'width', 30, 400), num('Højde', 'height', 30, 300));
    if (o.kind === 'window') this.el.append(num('Brystning', 'sill', 0, 200));
    const extra: HTMLElement[] = [];
    if (o.kind === 'door') extra.push(this.btn('flip', 'Spejlvend', () => this.tryOpening(id, { flip: !o.flip }, 'Spejlvend dør')));
    this.el.append(
      this.actions(...extra, this.btn('copy', 'Duplikér', () => app.duplicateSelection()), this.btn('trash', 'Slet', () => app.deleteSelection(), 'danger')),
    );
  }

  private tryOpening(id: string, patch: Record<string, unknown>, label: string) {
    const app = this.app;
    const doc = app.store.doc;
    const o = { ...doc.openings[id], ...patch };
    if (!openingFits(doc, o.wallId, o, id)) {
      app.toast('Der er ikke plads til de mål i væggen');
      this.render(true);
      return;
    }
    app.store.transact(label, (d) => Object.assign(d.openings[id], patch));
  }

  // ---------------------------------------------------------------- gulv / rum

  private floor(key: string) {
    const app = this.app;
    const room = app.building.rooms.find((r) => r.key === key);
    if (!room) return;
    const style = roomStyleFor(app.store.doc, room);
    this.el.append(this.header(style?.name || 'Rum', formatArea(room.area)));
    const name = h('input', { type: 'text', value: style?.name ?? '', placeholder: 'Fx Stue' }) as HTMLInputElement;
    name.addEventListener('change', () => {
      app.store.transact('Navngiv rum', () => {
        setRoomFloor(app, room, style?.floor ?? { ...FLOOR_PRESETS[0].value });
        const s = roomStyleFor(app.store.doc, room);
        if (s) s.name = name.value.trim() || undefined;
      });
    });
    this.el.append(h('label.props-row', {}, h('span', {}, 'Navn'), name));
    const cur = style?.floor ?? FLOOR_PRESETS[0].value;
    const sel = h('select') as HTMLSelectElement;
    sel.append(h('option', { value: '' }, 'Vælg …'));
    for (const p of FLOOR_PRESETS) sel.append(h('option', { value: p.id }, p.name));
    sel.value = FLOOR_PRESETS.find((p) => p.value.type === cur.type && p.value.color === cur.color)?.id ?? '';
    const color = h('input', { type: 'color', value: cur.color }) as HTMLInputElement;
    const set = (m: FloorMaterial) => app.store.transact('Skift gulv', () => setRoomFloor(app, room, m));
    sel.addEventListener('change', () => {
      const p = FLOOR_PRESETS.find((x) => x.id === sel.value);
      if (p) set({ ...p.value });
    });
    color.addEventListener('change', () => set({ type: cur.type, color: color.value }));
    this.el.append(h('div.props-row', {}, h('span', {}, 'Gulv'), sel, color));
    this.el.append(
      this.actions(
        this.btn('paint', 'Mal alle vægge', () => {
          app.paint = { target: 'wall', material: { ...WALL_PRESETS[0].value } };
          app.setTool('paint');
          app.toast('Vælg en farve til højre, og Shift+klik på en væg i rummet');
          app.setMode('build');
        }),
        this.btn('focus', 'Fokus', () => app.focusSelection()),
      ),
    );
  }
}
