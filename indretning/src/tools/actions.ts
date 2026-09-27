import type { ProjectDoc, PickRef } from '../state/types';
import type { Room } from '../building/wallGraph';
import { removeWall } from '../building/wallGraph';
import { roomStyleFor } from '../building/BuildingView';
import { uid } from '../state/ids';
import { DEFAULT_FLOOR_MATERIAL } from '../state/defaults';
import { removeFromGroups } from '../selection/selectionOps';

/** Sletter elementer. En væg tager sine døre og vinduer med. Et gulv skjules. */
export function deleteRefs(doc: ProjectDoc, refs: PickRef[], rooms: Room[]) {
  // Døre/vinduer i slettede vægge forsvinder også fra grupper
  const gone: PickRef[] = [...refs];
  for (const r of refs) if (r.kind === 'wall') for (const o of Object.values(doc.openings)) if (o.wallId === r.id) gone.push({ kind: 'opening', id: o.id });
  removeFromGroups(doc, gone);
  for (const ref of refs) {
    switch (ref.kind) {
      case 'furniture':
        delete doc.furniture[ref.id];
        break;
      case 'opening':
        delete doc.openings[ref.id];
        break;
      case 'wall':
        removeWall(doc, ref.id);
        break;
      case 'floor': {
        const room = rooms.find((r) => r.key === ref.id);
        if (!room) break;
        const style = roomStyleFor(doc, room);
        if (style) style.hidden = true;
        else doc.rooms.push({ id: uid('r'), x: room.labelPoint.x, z: room.labelPoint.z, floor: { ...DEFAULT_FLOOR_MATERIAL }, hidden: true });
        break;
      }
    }
  }
}

/** Duplikerer et møbel eller en åbning. Returnerer det nye id. */
export function duplicateRef(doc: ProjectDoc, ref: PickRef): PickRef | null {
  if (ref.kind === 'furniture') {
    const it = doc.furniture[ref.id];
    if (!it) return null;
    const id = uid('f');
    // Læg kopien ved siden af originalen (i møblets egen x-retning).
    const off = 0.5;
    doc.furniture[id] = {
      ...structuredClone(it),
      id,
      x: it.x + Math.cos(it.rotation) * off,
      z: it.z - Math.sin(it.rotation) * off,
    };
    return { kind: 'furniture', id };
  }
  if (ref.kind === 'opening') {
    const o = doc.openings[ref.id];
    if (!o) return null;
    const id = uid('o');
    doc.openings[id] = { ...structuredClone(o), id, offset: o.offset + o.width + 0.2 };
    return { kind: 'opening', id };
  }
  return null;
}
