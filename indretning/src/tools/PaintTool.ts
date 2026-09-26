import type * as THREE from 'three';
import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import { roomStyleFor } from '../building/BuildingView';
import { uid } from '../state/ids';
import type { Room } from '../building/wallGraph';

/**
 * Mal vægge (én side ad gangen) eller skift gulvbelægning i et rum.
 * Shift+klik på en væg maler alle vægge i rummet. Træk maler flere i træk.
 */
export class PaintTool implements Tool {
  readonly id = 'paint' as const;
  cursor = 'cell';
  hint = 'Klik på en vægside eller et gulv for at male · Shift+klik maler hele rummet · træk for at male flere';
  private painting = false;
  private painted = new Set<string>();

  constructor(private ed: Editor) {}

  deactivate() {
    if (this.painting) this.ed.store.commit('Mal');
    this.painting = false;
    this.ed.hover.blue = [];
    this.ed.refreshHighlights();
  }

  private target(e: ToolPointer) {
    const kind = this.ed.paint.target;
    const hit = this.ed.picker.pick(e.ndc, kind === 'wall' ? ['wall'] : ['floor', 'wall', 'furniture']);
    if (!hit || hit.kind !== kind) return null;
    if (kind === 'wall' && !hit.side) {
      // Ramte toppen: vælg siden ud fra hvor kameraet står.
      return null;
    }
    return hit;
  }

  pointerMove(e: ToolPointer) {
    const hit = this.target(e);
    const objs: THREE.Object3D[] = [];
    if (hit) objs.push(hit.object);
    this.ed.hover.blue = objs;
    this.ed.refreshHighlights();
    if (this.painting && hit) this.apply(hit.kind, hit.id, hit.side, e.shift);
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0) return;
    const hit = this.target(e);
    if (!hit) return;
    this.painting = true;
    this.painted.clear();
    this.ed.store.begin();
    this.apply(hit.kind, hit.id, hit.side, e.shift);
  }

  pointerUp() {
    if (!this.painting) return;
    this.painting = false;
    this.ed.store.commit(this.ed.paint.target === 'wall' ? 'Mal væg' : 'Skift gulv');
  }

  private apply(kind: string, id: string, side: 'A' | 'B' | undefined, wholeRoom: boolean) {
    const key = `${kind}:${id}:${side}`;
    if (this.painted.has(key)) return;
    this.painted.add(key);
    const paint = this.ed.paint;
    if (paint.target === 'wall' && kind === 'wall' && side) {
      const targets: { wallId: string; side: 'A' | 'B' }[] = [{ wallId: id, side }];
      if (wholeRoom) {
        const room = this.ed.building.rooms.find((r) => r.sides.some((s) => s.wallId === id && s.side === side));
        if (room) targets.push(...room.sides);
      }
      this.ed.store.update((doc) => {
        for (const t of targets) {
          const w = doc.walls[t.wallId];
          if (w) w[t.side === 'A' ? 'sideA' : 'sideB'] = { ...paint.material };
        }
      });
    } else if (paint.target === 'floor' && kind === 'floor') {
      const room = this.ed.building.rooms.find((r) => r.key === id);
      if (room) setRoomFloor(this.ed, room, paint.material);
    }
  }
}

export function setRoomFloor(ed: Editor, room: Room, floor: { type: 'wood' | 'tiles' | 'concrete' | 'carpet'; color: string }) {
  ed.store.update((doc) => {
    const style = roomStyleFor(doc, room);
    if (style) {
      style.floor = { ...floor };
      style.hidden = false;
    } else {
      doc.rooms.push({ id: uid('r'), x: room.labelPoint.x, z: room.labelPoint.z, floor: { ...floor } });
    }
  });
}
