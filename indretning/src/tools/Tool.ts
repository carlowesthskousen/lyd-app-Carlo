import type * as THREE from 'three';

export type ToolId = 'select' | 'wall' | 'room' | 'opening' | 'furniture' | 'paint' | 'delete';

export interface ToolPointer {
  ndc: THREE.Vector2;
  clientX: number;
  clientY: number;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  /** Antal klik (2 = dobbeltklik). */
  detail: number;
}

export interface Tool {
  readonly id: ToolId;
  /** CSS-cursor mens værktøjet er aktivt. */
  cursor: string;
  /** Kort hjælpetekst, der vises nederst i skærmen. */
  hint: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(e: ToolPointer): void;
  pointerMove?(e: ToolPointer): void;
  pointerUp?(e: ToolPointer): void;
  pointerLeave?(): void;
  /** Returnér true, hvis tasten blev håndteret. */
  keyDown?(e: KeyboardEvent): boolean;
  /** Returnér true, hvis højreklik blev håndteret (ellers skiftes til markering). */
  rightClick?(): boolean;
  /** Returnér true, hvis scroll blev brugt (så kameraet ikke zoomer). */
  wheel?(e: WheelEvent): boolean;
  update?(dt: number): void;
}
