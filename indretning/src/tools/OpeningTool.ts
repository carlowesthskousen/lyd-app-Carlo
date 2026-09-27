import * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import type { Overlay } from './overlay';
import { ghostClone } from './overlay';
import { findWallNear, openingFits, wallFrame } from '../building/wallGraph';
import { openingStyle } from '../building/buildCatalog';
import { buildOpeningModel } from '../building/openingModels';
import type { Opening } from '../state/types';
import { uid } from '../state/ids';
import { formatLength } from '../building/BuildingView';

/** Indsæt døre og vinduer i vægge. T spejlvender døren. */
export class OpeningTool implements Tool {
  readonly id = 'opening' as const;
  cursor = 'copy';
  hint = 'Peg på en væg og klik for at indsætte · T spejlvender døren · Alt = frit uden snap · Esc afslutter';
  private ghost: THREE.Object3D | null = null;
  private candidate: (Omit<Opening, 'id'> & { valid: boolean }) | null = null;
  private flip = false;

  constructor(private ed: Editor, private overlay: Overlay) {}

  deactivate() {
    this.ed.keepUpWall = null;
    this.clearGhost();
    this.overlay.clear();
    this.ed.hover.red = [];
    this.ed.refreshHighlights();
  }

  private clearGhost() {
    if (this.ghost) this.ghost.removeFromParent();
    this.ghost = null;
    this.candidate = null;
  }

  pointerMove(e: ToolPointer) {
    this.clearGhost();
    this.overlay.hideLabels();
    const doc = this.ed.store.doc;
    let hit: { id: string; kind: string; point: THREE.Vector3 } | null = this.ed.picker.pick(e.ndc, ['wall', 'opening']);
    if (!hit) {
      // Sænkede vægge: peg på gulvet ved væggen.
      const g = this.ed.picker.groundPoint(e.ndc, 0);
      const near = g && findWallNear(doc, { x: g.x, z: g.z }, 0.5);
      if (g && near) hit = { kind: 'wall', id: near.wall.id, point: g };
    }
    if (!hit) {
      this.ed.keepUpWall = null;
      this.ed.hover.red = [];
      this.ed.hover.blue = [];
      this.ed.refreshHighlights();
      return;
    }
    const wallId = hit.kind === 'wall' ? hit.id : doc.openings[hit.id]?.wallId;
    const wall = wallId ? doc.walls[wallId] : undefined;
    if (!wall) return;
    // Som i The Sims rejser væggen under musen sig, så man kan se døren.
    this.ed.keepUpWall = wall.id;
    const style = openingStyle(this.ed.openingStyleId);
    const f = wallFrame(doc, wall);
    let offset = (hit.point.x - f.a.x) * f.d.x + (hit.point.z - f.a.z) * f.d.z;
    const st = doc.settings;
    if (st.snapEnabled && !e.alt) offset = Math.round(offset / st.snapStep) * st.snapStep;
    // Skub ind, så den passer i væggen, hvis muligt.
    offset = Math.max(style.width / 2 + 0.06, Math.min(f.length - style.width / 2 - 0.06, offset));
    const height = Math.min(style.height, wall.height - 0.1 - style.sill);
    const cand = {
      wallId: wall.id,
      kind: style.kind,
      style: style.id,
      offset,
      width: style.width,
      height,
      sill: style.sill,
      flip: this.flip,
    };
    const valid = openingFits(doc, wall.id, cand);
    this.candidate = { ...cand, valid };

    const model = ghostClone(buildOpeningModel({ ...cand, id: 'ghost' }, wall.thickness), 0.85);
    const group = new THREE.Group();
    group.position.set(f.a.x, 0, f.a.z);
    group.rotation.y = Math.atan2(-f.d.z, f.d.x);
    model.position.x = offset;
    group.add(model);
    group.userData.helper = true;
    this.overlay.root.add(group);
    this.ghost = group;
    this.ed.hover.red = valid ? [] : [model];
    this.ed.hover.blue = valid ? [model] : [];
    this.ed.refreshHighlights();

    // Afstande til væggens ender
    const l = offset - style.width / 2;
    const r = f.length - offset - style.width / 2;
    const y = style.sill + height + 0.25;
    const at = (u: number) => new THREE.Vector3(f.a.x + f.d.x * u, y, f.a.z + f.d.z * u);
    this.overlay.label(0, formatLength(l), at(l / 2));
    this.overlay.label(1, formatLength(r), at(offset + style.width / 2 + r / 2));
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0) return;
    const c = this.candidate;
    if (!c) return;
    if (!c.valid) {
      this.ed.toast('Der er ikke plads her');
      return;
    }
    const id = uid('o');
    const { valid: _valid, ...data } = c;
    this.ed.store.transact(c.kind === 'door' ? 'Indsæt dør' : 'Indsæt vindue', (doc) => {
      doc.openings[id] = { id, ...data };
    });
    this.clearGhost();
    this.pointerMove(e);
  }

  keyDown(e: KeyboardEvent) {
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) {
      this.flip = !this.flip;
      return true;
    }
    return false;
  }

  pointerLeave() {
    this.ed.keepUpWall = null;
    this.clearGhost();
    this.overlay.hideLabels();
  }
}
