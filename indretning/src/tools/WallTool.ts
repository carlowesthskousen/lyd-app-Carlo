import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import { type Overlay, placeWallPreview, wallPreviewMesh } from './overlay';
import { type Vec2, dist } from '../core/math2d';
import { addWall, findWallNear } from '../building/wallGraph';
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
  /** Vægge tegnet i denne omgang – de står i fuld højde, mens man bygger videre. */
  private created = new Set<string>();

  constructor(private ed: Editor, private overlay: Overlay) {
    overlay.root.add(this.preview);
  }

  activate() {
    this.reset();
  }

  deactivate() {
    this.reset();
    this.created.clear();
    this.overlay.clear();
  }

  /** Hold den væg, man peger på, og de nye vægge i fuld højde. */
  private keepUp(e: ToolPointer) {
    const keep = this.ed.keepUpWalls;
    keep.clear();
    for (const id of this.created) if (this.ed.store.doc.walls[id]) keep.add(id);
    const hit = this.ed.picker.pick(e.ndc, ['wall']);
    if (hit) keep.add(hit.id);
    else {
      const g = this.ed.picker.groundPoint(e.ndc, 0);
      const near = g && findWallNear(this.ed.store.doc, { x: g.x, z: g.z }, 0.5);
      if (near) keep.add(near.wall.id);
    }
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
    this.keepUp(e);
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
      // Væghøjden ved den nye vægs ende
      this.overlay.label(1, `↕ ${formatLength(s.defaultWallHeight)}`, new THREE.Vector3(p.x, s.defaultWallHeight / 2, p.z), 'measure-label height');
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
      for (const id of addWall(doc, a, p, { height: s.defaultWallHeight, thickness: s.defaultWallThickness })) this.created.add(id);
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
