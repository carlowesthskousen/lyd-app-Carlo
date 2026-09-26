import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import { computePlacement, FINE_ROT_STEP, ROT_STEP } from './furniturePlacement';
import { openingFits, wallFrame } from '../building/wallGraph';
import type { PickRef } from '../state/types';

type Drag =
  | { kind: 'furniture'; id: string; startX: number; startY: number; grab: THREE.Vector2; moved: boolean; rotation: number; wallOffset: number }
  | { kind: 'opening'; id: string; startX: number; startY: number; grabDelta: number; moved: boolean };

/**
 * Markér, flyt og drej. Klik vælger det objekt, der er nærmest kameraet under musen.
 * Træk flytter møbler (med snap) og skubber døre/vinduer langs væggen.
 */
export class SelectTool implements Tool {
  readonly id = 'select' as const;
  cursor = 'default';
  hint = 'Klik for at vælge · træk for at flytte · R drejer · Ctrl+D duplikerer · Delete sletter · F fokuserer';
  private drag: Drag | null = null;
  private hovered: PickRef | null = null;

  constructor(private ed: Editor) {}

  deactivate() {
    this.endDrag(false);
    this.hovered = null;
    this.ed.hover.blue = [];
    this.ed.hover.red = [];
    this.ed.refreshHighlights();
  }

  pointerMove(e: ToolPointer) {
    const d = this.drag;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      if (!d.moved) {
        d.moved = true;
        this.ed.store.begin();
      }
      if (d.kind === 'furniture') this.dragFurniture(d, e);
      else this.dragOpening(d, e);
      return;
    }
    const hit = this.ed.picker.pick(e.ndc);
    const ref = hit && hit.kind !== 'floor' ? { kind: hit.kind, id: hit.id } : null;
    if (ref?.kind !== this.hovered?.kind || ref?.id !== this.hovered?.id) {
      this.hovered = ref;
      this.ed.hover.blue = ref ? this.ed.objectsFor(ref) : [];
      this.ed.refreshHighlights();
    }
    this.ed.setCursor(ref && (ref.kind === 'furniture' || ref.kind === 'opening') ? 'grab' : 'default');
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0) return;
    const hit = this.ed.picker.pick(e.ndc);
    if (!hit) {
      this.ed.select(null);
      return;
    }
    const ref: PickRef = { kind: hit.kind, id: hit.id };
    this.ed.select(ref);
    const doc = this.ed.store.doc;
    if (hit.kind === 'furniture') {
      const it = doc.furniture[hit.id];
      const ground = this.ed.picker.groundPoint(e.ndc, 0) ?? hit.point;
      this.drag = {
        kind: 'furniture',
        id: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        grab: new THREE.Vector2(it.x - ground.x, it.z - ground.z),
        moved: false,
        rotation: it.rotation,
        wallOffset: 0,
      };
    } else if (hit.kind === 'opening') {
      const o = doc.openings[hit.id];
      const w = doc.walls[o.wallId];
      const f = wallFrame(doc, w);
      const u = (hit.point.x - f.a.x) * f.d.x + (hit.point.z - f.a.z) * f.d.z;
      this.drag = { kind: 'opening', id: hit.id, startX: e.clientX, startY: e.clientY, grabDelta: o.offset - u, moved: false };
    }
  }

  pointerUp() {
    this.endDrag(true);
  }

  private endDrag(commit: boolean) {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.moved) return;
    if (!commit) {
      this.ed.store.cancel();
      return;
    }
    this.ed.store.commit(d.kind === 'furniture' ? 'Flyt møbel' : 'Flyt åbning');
    this.ed.hover.red = [];
    this.ed.refreshHighlights();
  }

  private dragFurniture(d: Extract<Drag, { kind: 'furniture' }>, e: ToolPointer) {
    const doc = this.ed.store.doc;
    const it = doc.furniture[d.id];
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
    this.ed.store.update((doc2) => {
      const x = doc2.furniture[d.id];
      x.x = round(pose.x);
      x.y = round(pose.y);
      x.z = round(pose.z);
      x.rotation = pose.rotation;
    });
    const obj = this.ed.furniture.objectFor(d.id);
    this.ed.hover.red = obj && (pose.colliding || !pose.valid) ? [obj] : [];
    this.ed.refreshHighlights();
    (d as { lastWallSnapped?: boolean }).lastWallSnapped = pose.wallSnapped;
  }

  private dragOpening(d: Extract<Drag, { kind: 'opening' }>, e: ToolPointer) {
    const doc = this.ed.store.doc;
    const o = doc.openings[d.id];
    if (!o) return;
    const hit = this.ed.picker.pick(e.ndc, ['wall', 'opening']);
    let wallId = o.wallId;
    let point = hit?.point;
    if (hit?.kind === 'wall' && hit.id !== o.wallId) wallId = hit.id; // flyt til en anden væg
    if (!point) point = this.ed.picker.groundPoint(e.ndc, o.sill + o.height / 2) ?? undefined;
    if (!point) return;
    const w = doc.walls[wallId];
    const f = wallFrame(doc, w);
    let offset = (point.x - f.a.x) * f.d.x + (point.z - f.a.z) * f.d.z + (wallId === o.wallId ? d.grabDelta : 0);
    const st = doc.settings;
    if (st.snapEnabled && !e.alt) offset = Math.round(offset / st.snapStep) * st.snapStep;
    offset = Math.max(o.width / 2 + 0.06, Math.min(f.length - o.width / 2 - 0.06, offset));
    const cand = { offset, width: o.width, height: o.height, sill: o.sill };
    if (!openingFits(doc, wallId, cand, o.id)) return;
    this.ed.store.update((doc2) => {
      doc2.openings[d.id].offset = offset;
      doc2.openings[d.id].wallId = wallId;
    });
  }

  rotateSelection(delta: number) {
    const sel = this.ed.selection;
    if (sel?.kind !== 'furniture') return false;
    const d = this.drag;
    if (d?.kind === 'furniture' && d.moved) {
      if ((d as { lastWallSnapped?: boolean }).lastWallSnapped) d.wallOffset += delta;
      else d.rotation += delta;
      const it = this.ed.store.doc.furniture[d.id];
      this.ed.store.update((doc) => {
        doc.furniture[d.id].rotation = it.rotation + delta;
      });
      return true;
    }
    this.ed.store.transact('Drej møbel', (doc) => {
      const it = doc.furniture[sel.id];
      if (it) it.rotation = normalizeAngle(it.rotation + delta);
    });
    return true;
  }

  keyDown(e: KeyboardEvent) {
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
      const step = e.altKey ? FINE_ROT_STEP : ROT_STEP;
      return this.rotateSelection(e.shiftKey ? -step : step);
    }
    if (e.key === 'Escape') {
      if (this.drag?.moved) {
        this.endDrag(false);
        return true;
      }
      if (this.ed.selection) {
        this.ed.select(null);
        return true;
      }
    }
    return false;
  }

  wheel(e: WheelEvent) {
    // Alt+scroll drejer det valgte møbel frit.
    if (!e.altKey || this.ed.selection?.kind !== 'furniture') return false;
    this.rotateSelection(Math.sign(e.deltaY) * FINE_ROT_STEP * 3);
    return true;
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
