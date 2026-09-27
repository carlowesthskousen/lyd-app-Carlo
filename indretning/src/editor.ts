import type * as THREE from 'three';
import type { Store } from './state/store';
import type { Viewport } from './render/Viewport';
import type { FlyCamera } from './camera/FlyCamera';
import type { Picker } from './core/picking';
import type { BuildingView } from './building/BuildingView';
import type { FurnitureView } from './furniture/FurnitureView';
import type { Catalog, CatalogEntry } from './furniture/catalog';
import type { ModelLibrary } from './furniture/modelLibrary';
import type { FloorMaterial, PickRef, WallMaterial } from './state/types';
import type { ToolId } from './tools/Tool';
import type { Vec2 } from './core/math2d';

export type PaintChoice = { target: 'wall'; material: WallMaterial } | { target: 'floor'; material: FloorMaterial };

/** Fælles kontekst, som værktøjer og UI arbejder mod. */
export interface Editor {
  store: Store;
  viewport: Viewport;
  camera: FlyCamera;
  picker: Picker;
  building: BuildingView;
  furniture: FurnitureView;
  catalog: Catalog;
  library: ModelLibrary;

  /** Den markerede genstand, når præcis én er markeret. */
  readonly selection: PickRef | null;
  /** Alle markerede objekter. */
  selected: PickRef[];
  select(ref: PickRef | null): void;
  setSelection(refs: PickRef[]): void;
  isSelected(ref: PickRef): boolean;
  /** Må denne type markeres (filteret "Kun møbler" / "Alt")? */
  selectable(kind: PickRef['kind']): boolean;
  /** Elementet som værktøjer kan tegne markeringsboksen i. */
  readonly host: HTMLElement;
  /** 3D-objekt(er) for et element, fx til omrids. */
  objectsFor(ref: PickRef): THREE.Object3D[];

  setTool(id: ToolId, options?: unknown): void;
  toolId: ToolId;

  /** Valgt dør/vindue-stil og maling fra bygge-kataloget. */
  openingStyleId: string;
  paint: PaintChoice;
  /** Møbel der placeres lige nu (fra kataloget). */
  placingEntry: CatalogEntry | null;

  /** Snapper et punkt til gitteret, hvis snap er slået til. */
  snap(p: Vec2, force?: boolean): Vec2;
  toast(msg: string): void;
  setHint(text: string): void;
  setCursor(css: string): void;
  /** Kaldes når markering/hover skal genberegnes. */
  refreshHighlights(): void;
  /** Væg der holdes oppe i cutaway (fx mens man sætter en dør i). */
  keepUpWall: string | null;
  /** Hover-omrids fra værktøjer (blå eller rød). */
  hover: { blue: THREE.Object3D[]; red: THREE.Object3D[] };
}
