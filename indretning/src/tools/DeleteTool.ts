import type { Editor } from '../editor';
import type { Tool, ToolPointer } from './Tool';
import type { PickRef } from '../state/types';
import { animateOut } from './overlay';
import { deleteRefs } from './actions';

const TRASH_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>` +
      `<circle cx='14' cy='14' r='12.5' fill='white' stroke='%23d93025' stroke-width='1.5'/>` +
      `<g fill='none' stroke='%23d93025' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>` +
      `<path d='M8.5 10h11M12 10V8.5h4V10M10 10l.8 9.5h6.4L18 10M12.6 12.8v4.4M15.4 12.8v4.4'/></g></svg>`,
  ).replace(/%2523/g, '%23')}") 14 14, not-allowed`;

/**
 * Slet-værktøj (X). Objektet under musen – præcis det nærmeste – får et rødt,
 * glødende omrids. Klik sletter; hold knappen nede og træk for at slette flere.
 * Alt kan fortrydes med Ctrl+Z. Esc eller højreklik går tilbage til markering.
 */
export class DeleteTool implements Tool {
  readonly id = 'delete' as const;
  cursor = TRASH_CURSOR;
  hint = 'Klik for at slette det markerede · hold nede og træk for at slette flere · Ctrl+Z fortryder · Esc eller højreklik afslutter';
  private hovered: PickRef | null = null;
  private dragging = false;
  private count = 0;

  constructor(private ed: Editor) {}

  activate() {
    this.ed.select(null);
  }

  deactivate() {
    this.finishDrag();
    this.setHover(null);
  }

  private setHover(ref: PickRef | null) {
    this.hovered = ref;
    this.ed.hover.red = ref ? this.ed.objectsFor(ref) : [];
    this.ed.refreshHighlights();
  }

  private updateHover(e: ToolPointer) {
    const hit = this.ed.picker.pick(e.ndc);
    const ref = hit ? { kind: hit.kind, id: hit.id } : null;
    if (ref?.kind !== this.hovered?.kind || ref?.id !== this.hovered?.id) this.setHover(ref);
  }

  pointerMove(e: ToolPointer) {
    this.updateHover(e);
    if (this.dragging && this.hovered) this.deleteHovered();
  }

  pointerDown(e: ToolPointer) {
    if (e.button !== 0) return;
    this.updateHover(e);
    this.dragging = true;
    this.count = 0;
    this.ed.store.begin();
    this.deleteHovered();
  }

  pointerUp() {
    this.finishDrag();
  }

  private finishDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    const n = this.count;
    this.ed.store.commit(n === 1 ? 'Slet' : `Slet ${n} objekter`);
  }

  private deleteHovered() {
    const ref = this.hovered;
    if (!ref) return;
    for (const obj of this.ed.objectsFor(ref)) animateOut(this.ed.viewport.scene, obj);
    this.ed.store.update((doc) => deleteRefs(doc, [ref], this.ed.building.rooms));
    this.count++;
    this.setHover(null);
  }

  keyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.ed.setTool('select');
      return true;
    }
    return false;
  }

  rightClick() {
    this.ed.setTool('select');
    return true;
  }

  pointerLeave() {
    this.setHover(null);
  }
}
