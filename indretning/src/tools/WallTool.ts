import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import { type Overlay, placeWallPreview, wallPreviewMesh } from './overlay';
import { type Vec2, dist } from '../core/math2d';
import { addWall } from '../building/wallGraph';
import { formatLength } from '../building/BuildingView';
import { constrainAngle, snapBuildPoint } from './snapping';

/**
 * Tegn vægge punkt til punkt. Klik for at sætte punkter (eller træk en væg),
 * dobbeltklik / Esc / højreklik afslutter. Shift låser vinklen til 45°-trin.
 */
export class WallTool implements Tool {
  readonly id = 'wall' as const;
  cursor = 'crosshair';
  hint = 'Klik for at starte en væg · klik igen for hvert hjørne · Shift låser vinklen · dobbeltklik, Esc eller højreklik afslutter';
  private start: Vec2 | null = null;
  private chainStart: Vec2 | null = null;
  private downAt: Vec2 | null = null;
  private current: Vec2 | null = null;
  private preview = wallPreviewMesh();

  constructor(private ed: Editor, private overlay: Overlay) {
    overlay.root.add(this.preview);
  }

  activate() {
    this.reset();
  }

  deactivate() {
    this.reset();
    this.overlay.clear();
  }

  private reset() {
    this.start = this.chainStart = this.downAt = null;
    this.preview.visible = false;
    this.overlay.hideLabels();
  }

  private point(e: ToolPointer): Vec2 | null {
    const s = snapBuildPoint(this.ed, e.ndc, e.alt);
    if (!s) return null;
    let p = s.p;
    if (this.start && e.shift) p = constrainAngle(this.ed, this.start, p);
    this.overlay.showCursor(p.x, p.z, s.kind === 'node' || s.kind === 'wall');
    return p;
  }

  pointerMove(e: ToolPointer) {
    const p = this.point(e);
    this.current = p;
    if (!p) return;
    const s = this.ed.store.doc.settings;
    if (this.start) {
      placeWallPreview(this.preview, this.start.x, this.start.z, p.x, p.z, s.defaultWallHeight, s.defaultWallThickness);
      const L = dist(this.start, p);
      const deg = ((Math.atan2(-(p.z - this.start.z), p.x - this.start.x) * 180) / Math.PI + 360) % 360;
      this.overlay.label(
        0,
        `${formatLength(L)} · ${Math.round(deg)}°`,
        new THREE.Vector3((this.start.x + p.x) / 2, s.defaultWallHeight + 0.25, (this.start.z + p.z) / 2),
      );
    } else {
      this.overlay.hideLabels();
    }
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0) return;
    const p = this.point(e);
    if (!p) return;
    if (e.detail >= 2) {
      this.reset();
      return;
    }
    if (!this.start) {
      this.start = p;
      this.chainStart = p;
      this.downAt = p;
      return;
    }
    this.downAt = null;
    this.commit(p);
  }

  pointerUp(e: ToolPointer) {
    // Træk-for-at-tegne: slip musen et andet sted end hvor man trykkede.
    if (e.button !== 0 || !this.downAt || !this.start) return;
    const p = this.current;
    this.downAt = null;
    if (p && dist(p, this.start) > 0.3) this.commit(p);
  }

  private commit(p: Vec2) {
    if (!this.start || dist(this.start, p) < 0.05) return;
    const s = this.ed.store.doc.settings;
    const a = this.start;
    this.ed.store.transact('Tegn væg', (doc) => {
      addWall(doc, a, p, { height: s.defaultWallHeight, thickness: s.defaultWallThickness });
    });
    if (this.chainStart && dist(p, this.chainStart) < 0.01) {
      this.ed.toast('Rummet er lukket');
      this.reset();
      return;
    }
    this.start = p;
    this.preview.visible = false;
  }

  keyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.start) {
      this.reset();
      return true;
    }
    return false;
  }

  rightClick() {
    if (this.start) {
      this.reset();
      return true;
    }
    return false;
  }

  pointerLeave() {
    this.overlay.hideCursor();
  }
}
