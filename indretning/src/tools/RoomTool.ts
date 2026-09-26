import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import { type Overlay, placeWallPreview, wallPreviewMesh } from './overlay';
import type { Vec2 } from '../core/math2d';
import { addWall } from '../building/wallGraph';
import { formatArea, formatLength } from '../building/BuildingView';
import { snapBuildPoint } from './snapping';

/** Træk et rektangel for at bygge et helt rum med fire vægge (som i The Sims). */
export class RoomTool implements Tool {
  readonly id = 'room' as const;
  cursor = 'crosshair';
  hint = 'Træk (eller klik to hjørner) for at bygge et rum · Esc annullerer';
  private start: Vec2 | null = null;
  private current: Vec2 | null = null;
  private previews = [wallPreviewMesh(), wallPreviewMesh(), wallPreviewMesh(), wallPreviewMesh()];

  constructor(private ed: Editor, private overlay: Overlay) {
    for (const p of this.previews) overlay.root.add(p);
  }

  deactivate() {
    this.cancel();
    this.overlay.clear();
  }

  private cancel() {
    this.start = null;
    for (const p of this.previews) p.visible = false;
    this.overlay.hideLabels();
  }

  pointerMove(e: ToolPointer) {
    const s = snapBuildPoint(this.ed, e.ndc, e.alt);
    if (!s) return;
    this.current = s.p;
    this.overlay.showCursor(s.p.x, s.p.z, s.kind === 'node' || s.kind === 'wall');
    if (!this.start) return;
    const a = this.start;
    const b = s.p;
    const st = this.ed.store.doc.settings;
    const pts = [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }];
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % 4];
      placeWallPreview(this.previews[i], p.x, p.z, q.x, q.z, st.defaultWallHeight, st.defaultWallThickness);
    }
    const w = Math.abs(b.x - a.x);
    const d = Math.abs(b.z - a.z);
    const t = st.defaultWallThickness;
    const inner = Math.max(0, w - t) * Math.max(0, d - t);
    this.overlay.label(
      0,
      `${formatLength(w)} × ${formatLength(d)} · ${formatArea(inner)}`,
      new THREE.Vector3((a.x + b.x) / 2, st.defaultWallHeight + 0.3, (a.z + b.z) / 2),
    );
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0 || !this.current) return;
    if (!this.start) {
      this.start = this.current;
      return;
    }
    this.commit();
  }

  pointerUp(e: ToolPointer) {
    if (e.button !== 0 || !this.start || !this.current) return;
    if (Math.abs(this.current.x - this.start.x) > 0.3 && Math.abs(this.current.z - this.start.z) > 0.3) this.commit();
  }

  private commit() {
    const a = this.start!;
    const b = this.current!;
    if (Math.abs(b.x - a.x) < 0.3 || Math.abs(b.z - a.z) < 0.3) return;
    const st = this.ed.store.doc.settings;
    const opts = { height: st.defaultWallHeight, thickness: st.defaultWallThickness };
    const pts = [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }];
    this.ed.store.transact('Byg rum', (doc) => {
      for (let i = 0; i < 4; i++) addWall(doc, pts[i], pts[(i + 1) % 4], opts);
    });
    this.cancel();
  }

  keyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.start) {
      this.cancel();
      return true;
    }
    return false;
  }

  rightClick() {
    if (this.start) {
      this.cancel();
      return true;
    }
    return false;
  }
}
