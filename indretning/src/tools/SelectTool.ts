import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import { computePlacement, FINE_ROT_STEP, ROT_STEP } from './furniturePlacement';
import { openingFits, wallFrame } from '../building/wallGraph';
import type { PickRef } from '../state/types';
import {
  type Clip,
  type MoveSnapshot,
  expandGroups,
  groupFor,
  mergeNodes,
  nodesOf,
  pasteClip,
  refPosition,
  rotateSelection,
  sameRef,
  selectionCenter,
  snapshotFor,
  translateSnapshot,
  uniqueRefs,
} from '../selection/selectionOps';

const DRAG_PX = 4;

interface Press {
  x: number;
  y: number;
  ndc: THREE.Vector2;
  hit: PickRef | null;
  hitPoint: THREE.Vector3 | null;
  shift: boolean;
  alt: boolean;
  detail: number;
}

type Drag =
  | { kind: 'single-furniture'; id: string; grab: THREE.Vector2; rotation: number; wallOffset: number; lastWallSnapped?: boolean }
  | { kind: 'single-opening'; id: string; grabDelta: number }
  | { kind: 'bunch'; refs: PickRef[]; snap: MoveSnapshot; start: THREE.Vector3; anchor: { x: number; z: number } }
  | { kind: 'marquee'; el: HTMLDivElement };

/**
 * Markér og flyt – også mange ting på én gang.
 * - Klik: markér (hele gruppen, hvis objektet er i en gruppe). Dobbeltklik: ét objekt i gruppen
 * - Shift+klik: tilføj/fjern. Træk på tom plads: markeringsboks (Shift+træk tilføjer)
 * - Træk i et markeret objekt: flyt hele bunken (snap + kollisionsvisning)
 * - R/T: drej bunken 15° om midten (Alt = 1°). Pile: skub 1 cm (Alt = 10 cm)
 */
export class SelectTool implements Tool {
  readonly id = 'select' as const;
  cursor = 'default';
  hint = 'Klik vælger · Shift+klik tilføjer · træk på tom plads = markeringsboks · træk i markeringen = flyt · R drejer · Cmd/Ctrl+D duplikerer · Delete sletter';
  private press: Press | null = null;
  private drag: Drag | null = null;
  private hovered: PickRef[] = [];
  private floating: { refs: PickRef[]; snap: MoveSnapshot; center: { x: number; z: number }; label: string } | null = null;
  private lastNdc: THREE.Vector2 | null = null;

  constructor(private ed: Editor) {}

  deactivate() {
    if (this.floating) this.cancelFloating();
    this.endDrag(false);
    this.press = null;
    this.hovered = [];
    this.ed.hover.blue = [];
    this.ed.hover.red = [];
    this.ed.refreshHighlights();
  }

  /** Markeringsværktøjet håndterer selv venstre-træk (boks og flyt) – også i drone-tilstand. */
  wantsDrag() {
    return true;
  }

  private pick(ndc: THREE.Vector2): { ref: PickRef | null; point: THREE.Vector3 | null; floor: PickRef | null } {
    const kinds = this.ed.selectable('wall') ? undefined : (['furniture'] as PickRef['kind'][]);
    const hit = this.ed.picker.pick(ndc, kinds);
    if (!hit) return { ref: null, point: null, floor: null };
    const ref = { kind: hit.kind, id: hit.id };
    if (hit.kind === 'floor') return { ref: null, point: hit.point, floor: ref };
    if (!this.ed.selectable(hit.kind)) return { ref: null, point: hit.point, floor: null };
    return { ref, point: hit.point, floor: null };
  }

  // ------------------------------------------------------------------ mus

  pointerDown(e: ToolPointer) {
    if (e.button !== 0) return;
    if (this.floating) {
      this.placeFloating();
      return;
    }
    const p = this.pick(e.ndc);
    this.press = { x: e.clientX, y: e.clientY, ndc: e.ndc.clone(), hit: p.ref, hitPoint: p.point, shift: e.shift, alt: e.alt, detail: e.detail };
    (this.press as Press & { floor?: PickRef | null }).floor = p.floor;
  }

  pointerMove(e: ToolPointer) {
    this.lastNdc = e.ndc.clone();
    if (this.floating) {
      this.moveFloating(e);
      return;
    }
    const pr = this.press;
    if (pr && !this.drag) {
      if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < DRAG_PX) return;
      this.beginDrag(pr);
    }
    if (this.drag) {
      this.updateDrag(e);
      return;
    }
    this.updateHover(e);
  }

  pointerUp(e: ToolPointer) {
    const pr = this.press;
    this.press = null;
    if (this.drag) {
      if (this.drag.kind === 'marquee') this.finishMarquee(e, pr?.shift ?? false);
      else this.endDrag(true);
      return;
    }
    if (pr) this.click(pr);
  }

  pointerLeave() {
    this.hovered = [];
    this.ed.hover.blue = [];
    this.ed.refreshHighlights();
  }

  private click(pr: Press) {
    const ed = this.ed;
    const doc = ed.store.doc;
    const hit = pr.hit;
    if (!hit) {
      const floor = (pr as Press & { floor?: PickRef | null }).floor;
      if (pr.shift) return;
      ed.setSelection(floor ? [floor] : []);
      return;
    }
    if (pr.shift) {
      // Tilføj/fjern (hele gruppen, hvis objektet er i en)
      const unit = expandGroups(doc, [hit]);
      const sel = ed.selected.filter((r) => r.kind !== 'floor');
      if (ed.isSelected(hit)) ed.setSelection(sel.filter((r) => !unit.some((u) => sameRef(u, r))));
      else ed.setSelection([...sel, ...unit]);
      return;
    }
    // Dobbeltklik på en gruppe: markér kun dette ene objekt
    if (pr.detail === 2 && groupFor(doc, hit)) {
      ed.setSelection([hit]);
      return;
    }
    ed.setSelection(expandGroups(doc, [hit]));
  }

  private updateHover(e: ToolPointer) {
    const p = this.pick(e.ndc);
    const refs = p.ref ? expandGroups(this.ed.store.doc, [p.ref]) : [];
    const same = refs.length === this.hovered.length && refs.every((r, i) => sameRef(r, this.hovered[i]));
    if (!same) {
      this.hovered = refs;
      this.ed.hover.blue = refs.flatMap((r) => this.ed.objectsFor(r));
      this.ed.refreshHighlights();
    }
    this.ed.setCursor(p.ref ? 'grab' : 'default');
  }

  // ------------------------------------------------------------------ træk

  private beginDrag(pr: Press) {
    const ed = this.ed;
    const doc = ed.store.doc;
    if (!pr.hit) {
      // Markeringsboks
      const el = document.createElement('div');
      el.className = 'marquee';
      ed.host.append(el);
      this.drag = { kind: 'marquee', el };
      return;
    }
    // Træk i et objekt: markér det (hvis det ikke allerede er markeret) og flyt bunken
    if (!ed.isSelected(pr.hit)) {
      const unit = expandGroups(doc, [pr.hit]);
      ed.setSelection(pr.shift ? [...ed.selected.filter((r) => r.kind !== 'floor'), ...unit] : unit);
    }
    const refs = ed.selected.filter((r) => r.kind !== 'floor');
    ed.store.begin();
    if (refs.length === 1 && refs[0].kind === 'furniture') {
      const it = doc.furniture[refs[0].id];
      const ground = ed.picker.groundPoint(pr.ndc, 0) ?? pr.hitPoint ?? new THREE.Vector3(it.x, 0, it.z);
      this.drag = { kind: 'single-furniture', id: it.id, grab: new THREE.Vector2(it.x - ground.x, it.z - ground.z), rotation: it.rotation, wallOffset: 0 };
    } else if (refs.length === 1 && refs[0].kind === 'opening') {
      const o = doc.openings[refs[0].id];
      const f = wallFrame(doc, doc.walls[o.wallId]);
      const pt = pr.hitPoint ?? new THREE.Vector3();
      const u = (pt.x - f.a.x) * f.d.x + (pt.z - f.a.z) * f.d.z;
      this.drag = { kind: 'single-opening', id: o.id, grabDelta: o.offset - u };
    } else {
      const start = ed.picker.groundPoint(pr.ndc, 0) ?? pr.hitPoint ?? new THREE.Vector3();
      const anchor = refPosition(doc, pr.hit) ?? selectionCenter(doc, refs);
      this.drag = { kind: 'bunch', refs, snap: snapshotFor(doc, refs), start, anchor };
    }
  }

  private updateDrag(e: ToolPointer) {
    const d = this.drag!;
    if (d.kind === 'marquee') return this.updateMarquee(e);
    if (d.kind === 'single-furniture') return this.dragFurniture(d, e);
    if (d.kind === 'single-opening') return this.dragOpening(d, e);
    const p = this.ed.picker.groundPoint(e.ndc, 0);
    if (!p) return;
    let dx = p.x - d.start.x;
    let dz = p.z - d.start.z;
    const st = this.ed.store.doc.settings;
    if (st.snapEnabled && !e.alt) {
      // Snap det objekt, man holder i, til gitteret – resten følger med
      const snapped = this.ed.snap({ x: d.anchor.x + dx, z: d.anchor.z + dz }, true);
      dx = snapped.x - d.anchor.x;
      dz = snapped.z - d.anchor.z;
    }
    this.ed.store.update((doc) => translateSnapshot(doc, d.snap, dx, dz));
  }

  private endDrag(commit: boolean) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      d.el.remove();
      return;
    }
    if (!commit) {
      this.ed.store.cancel();
      return;
    }
    if (d.kind === 'bunch') {
      this.ed.store.update((doc) => mergeNodes(doc, Object.keys(d.snap.nodes)));
      this.ed.store.commit(`Flyt ${d.refs.length} objekter`);
    } else this.ed.store.commit(d.kind === 'single-furniture' ? 'Flyt møbel' : 'Flyt åbning');
    this.ed.hover.red = [];
    this.ed.refreshHighlights();
  }

  private dragFurniture(d: Extract<Drag, { kind: 'single-furniture' }>, e: ToolPointer) {
    const it = this.ed.store.doc.furniture[d.id];
    const entry = it && this.ed.catalog.get(it.catalogId);
    if (!entry) return;
    const floorLike = (entry.placement ?? 'floor') !== 'wall';
    const pose = computePlacement(this.ed, entry, e.ndc, {
      alt: e.alt,
      excludeId: d.id,
      rotation: d.rotation,
      wallOffset: d.wallOffset,
      grabOffset: floorLike && entry.placement !== 'surface' ? d.grab : undefined,
    });
    if (!pose) return;
    this.ed.store.update((doc) => {
      const x = doc.furniture[d.id];
      x.x = round(pose.x);
      x.y = round(pose.y);
      x.z = round(pose.z);
      x.rotation = pose.rotation;
    });
    const obj = this.ed.furniture.objectFor(d.id);
    this.ed.hover.red = obj && (pose.colliding || !pose.valid) ? [obj] : [];
    this.ed.refreshHighlights();
    d.lastWallSnapped = pose.wallSnapped;
  }

  private dragOpening(d: Extract<Drag, { kind: 'single-opening' }>, e: ToolPointer) {
    const doc = this.ed.store.doc;
    const o = doc.openings[d.id];
    if (!o) return;
    const hit = this.ed.picker.pick(e.ndc, ['wall', 'opening']);
    let wallId = o.wallId;
    let point = hit?.point;
    if (hit?.kind === 'wall' && hit.id !== o.wallId) wallId = hit.id; // flyt til en anden væg
    if (!point) point = this.ed.picker.groundPoint(e.ndc, o.sill + o.height / 2) ?? undefined;
    if (!point) return;
    const f = wallFrame(doc, doc.walls[wallId]);
    let offset = (point.x - f.a.x) * f.d.x + (point.z - f.a.z) * f.d.z + (wallId === o.wallId ? d.grabDelta : 0);
    const st = doc.settings;
    if (st.snapEnabled && !e.alt) offset = Math.round(offset / st.snapStep) * st.snapStep;
    offset = Math.max(o.width / 2 + 0.06, Math.min(f.length - o.width / 2 - 0.06, offset));
    if (!openingFits(doc, wallId, { offset, width: o.width, height: o.height, sill: o.sill }, o.id)) return;
    this.ed.store.update((doc2) => {
      doc2.openings[d.id].offset = offset;
      doc2.openings[d.id].wallId = wallId;
    });
  }

  // ------------------------------------------------------------------ markeringsboks

  private rectOf(e: ToolPointer) {
    const pr = this.press ?? { x: e.clientX, y: e.clientY };
    return {
      x0: Math.min(pr.x, e.clientX),
      y0: Math.min(pr.y, e.clientY),
      x1: Math.max(pr.x, e.clientX),
      y1: Math.max(pr.y, e.clientY),
    };
  }

  private marqueeStart: { x: number; y: number } | null = null;

  private updateMarquee(e: ToolPointer) {
    const d = this.drag as Extract<Drag, { kind: 'marquee' }>;
    if (!this.marqueeStart && this.press) this.marqueeStart = { x: this.press.x, y: this.press.y };
    const r = this.rectOf(e);
    const host = this.ed.host.getBoundingClientRect();
    Object.assign(d.el.style, {
      left: `${r.x0 - host.left}px`,
      top: `${r.y0 - host.top}px`,
      width: `${r.x1 - r.x0}px`,
      height: `${r.y1 - r.y0}px`,
    });
    // Vis hvad der vil blive markeret
    const found = this.inRect(r);
    this.ed.hover.blue = found.flatMap((ref) => this.ed.objectsFor(ref));
    this.ed.refreshHighlights();
  }

  private finishMarquee(e: ToolPointer, add: boolean) {
    const r = this.rectOf({ ...e, clientX: e.clientX, clientY: e.clientY });
    const start = this.marqueeStart;
    this.marqueeStart = null;
    if (start) {
      r.x0 = Math.min(start.x, e.clientX);
      r.x1 = Math.max(start.x, e.clientX);
      r.y0 = Math.min(start.y, e.clientY);
      r.y1 = Math.max(start.y, e.clientY);
    }
    const found = this.inRect(r);
    this.endDrag(false);
    this.ed.hover.blue = [];
    const base = add ? this.ed.selected.filter((x) => x.kind !== 'floor') : [];
    this.ed.setSelection(uniqueRefs([...base, ...found]));
  }

  /** Alt hvis midtpunkt ligger inden for skærm-firkanten. */
  private inRect(r: { x0: number; y0: number; x1: number; y1: number }): PickRef[] {
    const ed = this.ed;
    const doc = ed.store.doc;
    const host = ed.host.getBoundingClientRect();
    const cam = ed.viewport.camera;
    const candidates: PickRef[] = Object.keys(doc.furniture).map((id) => ({ kind: 'furniture', id }));
    if (ed.selectable('wall')) {
      candidates.push(...Object.keys(doc.walls).map((id) => ({ kind: 'wall' as const, id })));
      candidates.push(...Object.keys(doc.openings).map((id) => ({ kind: 'opening' as const, id })));
    }
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    const out: PickRef[] = [];
    for (const ref of candidates) {
      box.makeEmpty();
      for (const o of ed.objectsFor(ref)) box.expandByObject(o);
      if (box.isEmpty()) continue;
      box.getCenter(c);
      // Midtpunktet skal være foran kameraet
      if (c.clone().applyMatrix4(cam.matrixWorldInverse).z > 0) continue;
      c.project(cam);
      const sx = host.left + ((c.x + 1) / 2) * host.width;
      const sy = host.top + ((1 - c.y) / 2) * host.height;
      if (sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1) out.push(ref);
    }
    // Hele grupper kommer med
    return expandGroups(doc, out);
  }

  // ------------------------------------------------------------------ svævende kopi (duplikér / indsæt)

  /** Indsætter et udklip, der følger musen, til man klikker det på plads. Esc annullerer. */
  startFloating(clip: Clip, label: string) {
    if (this.floating) this.cancelFloating();
    const ed = this.ed;
    const at = (this.lastNdc && ed.picker.groundPoint(this.lastNdc, 0)) || null;
    const target = at ? ed.snap({ x: at.x, z: at.z }) : { x: clip.center.x + 0.5, z: clip.center.z + 0.5 };
    ed.store.begin();
    let refs: PickRef[] = [];
    ed.store.update((doc) => (refs = pasteClip(doc, clip, target)));
    const doc = ed.store.doc;
    this.floating = { refs, snap: snapshotFor(doc, refs), center: selectionCenter(doc, refs), label };
    ed.setSelection(refs);
    ed.setHint('Flyt musen og klik for at placere kopien · R drejer · Esc annullerer');
  }

  private moveFloating(e: ToolPointer) {
    const f = this.floating!;
    const p = this.ed.picker.groundPoint(e.ndc, 0);
    if (!p) return;
    const target = e.alt ? { x: p.x, z: p.z } : this.ed.snap({ x: p.x, z: p.z });
    const dx = target.x - f.center.x;
    const dz = target.z - f.center.z;
    this.ed.store.update((doc) => translateSnapshot(doc, f.snap, dx, dz));
  }

  private placeFloating() {
    const f = this.floating!;
    this.floating = null;
    this.ed.store.update((doc) => mergeNodes(doc, nodesOf(doc, f.refs)));
    const n = f.refs.length;
    this.ed.store.commit(`${f.label}${n > 1 ? ` ${n} objekter` : ''}`);
    this.ed.setSelection(f.refs.filter((r) => this.ed.store.doc.furniture[r.id] || this.ed.store.doc.walls[r.id]));
    this.ed.setHint(this.hint);
  }

  private cancelFloating() {
    this.floating = null;
    this.ed.store.cancel();
    this.ed.setSelection([]);
    this.ed.setHint(this.hint);
  }

  get isFloating() {
    return !!this.floating;
  }

  // ------------------------------------------------------------------ tastatur

  /** Drejer markeringen (eller den svævende kopi) om dens fælles midtpunkt. */
  rotateSelection(angle: number) {
    const ed = this.ed;
    if (this.floating) {
      const f = this.floating;
      ed.store.update((doc) => rotateSelection(doc, f.refs, angle));
      const doc = ed.store.doc;
      // Ny udgangsposition, så musen stadig styrer midten
      const c = selectionCenter(doc, f.refs);
      f.snap = snapshotFor(doc, f.refs);
      f.center = c;
      return true;
    }
    const refs = ed.selected.filter((r) => r.kind === 'furniture' || r.kind === 'wall');
    if (!refs.length) return false;
    ed.store.transact(refs.length === 1 ? 'Drej' : `Drej ${refs.length} objekter`, (doc) => {
      rotateSelection(doc, refs, angle);
      mergeNodes(doc, nodesOf(doc, refs));
    });
    return true;
  }

  private nudge(dx: number, dz: number) {
    const refs = this.ed.selected.filter((r) => r.kind !== 'floor');
    if (!refs.length) return false;
    this.ed.store.transact(refs.length === 1 ? 'Skub' : `Skub ${refs.length} objekter`, (doc) => {
      translateSnapshot(doc, snapshotFor(doc, refs), dx, dz);
    });
    return true;
  }

  keyDown(e: KeyboardEvent) {
    if ((e.code === 'KeyR' || e.code === 'KeyT') && !e.ctrlKey && !e.metaKey) {
      if (!this.ed.selected.length && !this.floating) return false;
      const step = e.altKey ? FINE_ROT_STEP : ROT_STEP;
      return this.rotateSelection(e.shiftKey ? -step : step);
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.code] && this.ed.selected.some((r) => r.kind !== 'floor') && !e.ctrlKey && !e.metaKey) {
      // Skub i kameraets retning (op = væk fra kameraet)
      const step = e.altKey ? 0.1 : 0.01;
      const [ax, az] = arrows[e.code];
      const yaw = this.ed.camera.yaw;
      const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      // Rund til nærmeste hovedakse, så skub følger gitteret
      const snapAxis = (v: { x: number; z: number }) => (Math.abs(v.x) > Math.abs(v.z) ? { x: Math.sign(v.x), z: 0 } : { x: 0, z: Math.sign(v.z) });
      const F = snapAxis(fwd), R = snapAxis(right);
      return this.nudge((R.x * ax - F.x * az) * step, (R.z * ax - F.z * az) * step);
    }
    if (e.key === 'Escape') {
      if (this.floating) {
        this.cancelFloating();
        return true;
      }
      if (this.drag) {
        this.endDrag(false);
        return true;
      }
      if (this.ed.selected.length) {
        this.ed.select(null);
        return true;
      }
    }
    return false;
  }

  wheel(e: WheelEvent) {
    // Alt+scroll drejer markeringen frit
    if (!e.altKey || (!this.ed.selected.length && !this.floating)) return false;
    this.rotateSelection(Math.sign(e.deltaY) * FINE_ROT_STEP * 3);
    return true;
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
