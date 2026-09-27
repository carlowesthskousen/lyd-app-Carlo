import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import type { Overlay } from './overlay';
import { ghostClone } from './overlay';
import { computePlacement, FINE_ROT_STEP, ROT_STEP, type FurniturePose } from './furniturePlacement';
import type { CatalogEntry } from '../furniture/catalog';
import { uid } from '../state/ids';

/**
 * Placér et nyt møbel fra kataloget. Møblet følger musen, snapper til gulv,
 * gitter og vægge. Klik placerer (Shift+klik placerer flere). T drejer 15°,
 * Alt+T eller Alt+scroll drejer frit.
 */
export class FurnitureTool implements Tool {
  readonly id = 'furniture' as const;
  cursor = 'grabbing';
  hint = 'Klik for at placere · T / Shift+T drejer 15° · Alt+scroll eller Alt+T drejer frit · Alt = uden snap · Shift+klik placerer flere · Esc annullerer';
  private ghost: THREE.Object3D | null = null;
  private entry: CatalogEntry | null = null;
  private rotation = 0;
  private wallOffset = 0;
  private pose: FurniturePose | null = null;
  private lastNdc: THREE.Vector2 | null = null;
  private lastAlt = false;
  /** Sat når værktøjet blev startet ved at trække fra kataloget. */
  dragMode = false;

  constructor(private ed: Editor, private overlay: Overlay) {}

  activate() {
    this.entry = this.ed.placingEntry;
    this.rotation = 0;
    this.wallOffset = 0;
    this.pose = null;
    this.loadGhost();
  }

  deactivate() {
    this.ghost?.removeFromParent();
    this.ghost = null;
    this.ed.placingEntry = null;
    this.dragMode = false;
    this.ed.hover.red = [];
    this.ed.hover.blue = [];
    this.ed.refreshHighlights();
  }

  private loadGhost() {
    const entry = this.entry;
    if (!entry) return;
    this.ed.library.get(entry).then((tpl) => {
      if (this.entry !== entry || this.ed.toolId !== 'furniture') return;
      this.ghost?.removeFromParent();
      const holder = new THREE.Group();
      const body = tpl.clone(true);
      // Vis møblet i sin standardfarve.
      holder.add(body);
      this.ed.furniture.applyPreviewAppearance(body, entry);
      this.ghost = ghostClone(holder, 0.8);
      this.ghost.visible = false;
      this.overlay.root.add(this.ghost);
      if (this.lastNdc) this.updatePose(this.lastNdc, this.lastAlt);
    });
  }

  private updatePose(ndc: THREE.Vector2, alt: boolean) {
    this.lastNdc = ndc.clone();
    this.lastAlt = alt;
    if (!this.entry) return;
    this.pose = computePlacement(this.ed, this.entry, ndc, {
      alt,
      excludeId: null,
      rotation: this.rotation,
      wallOffset: this.wallOffset,
    });
    const g = this.ghost;
    if (!g) return;
    if (!this.pose) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(this.pose.x, this.pose.y, this.pose.z);
    g.rotation.y = this.pose.rotation;
    const bad = this.pose.colliding || !this.pose.valid;
    this.ed.hover.red = bad ? [g] : [];
    this.ed.hover.blue = bad ? [] : [g];
    this.ed.refreshHighlights();
    this.ed.viewport.markShadowsDirty();
  }

  pointerMove(e: ToolPointer) {
    this.updatePose(e.ndc, e.alt);
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0 || this.dragMode) return;
    this.place(e.shift);
  }

  pointerUp(e: ToolPointer) {
    if (e.button !== 0 || !this.dragMode) return;
    this.place(false);
  }

  /** Kaldes når man slipper et katalog-træk uden for 3D-visningen. */
  cancelDrag() {
    this.ed.setTool('select');
  }

  private place(keep: boolean) {
    const entry = this.entry;
    const p = this.pose;
    if (!entry || !p) return;
    if (!p.valid) {
      this.ed.toast(entry.placement === 'wall' ? 'Skal hænge på en væg' : 'Kan ikke stå her');
      return;
    }
    const id = uid('f');
    this.ed.store.transact(`Placér ${entry.name.toLowerCase()}`, (doc) => {
      doc.furniture[id] = {
        id,
        catalogId: entry.id,
        x: round(p.x),
        y: round(p.y),
        z: round(p.z),
        rotation: p.rotation,
      };
    });
    if (p.colliding) this.ed.toast('Bemærk: møblet overlapper noget andet');
    if (keep) return;
    this.dragMode = false;
    this.ed.setTool('select');
    this.ed.select({ kind: 'furniture', id });
  }

  private rotate(delta: number) {
    if (this.pose?.wallSnapped) this.wallOffset += delta;
    else this.rotation += delta;
    if (this.lastNdc) this.updatePose(this.lastNdc, this.lastAlt);
  }

  keyDown(e: KeyboardEvent) {
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) {
      const step = e.altKey ? FINE_ROT_STEP : ROT_STEP;
      this.rotate(e.shiftKey ? -step : step);
      return true;
    }
    if (e.key === 'Escape') {
      this.ed.setTool('select');
      return true;
    }
    return false;
  }

  wheel(e: WheelEvent) {
    if (!e.altKey) return false;
    this.rotate(Math.sign(e.deltaY) * FINE_ROT_STEP * 3);
    return true;
  }

  rightClick() {
    this.ed.setTool('select');
    return true;
  }

  pointerLeave() {
    if (this.ghost) this.ghost.visible = false;
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
