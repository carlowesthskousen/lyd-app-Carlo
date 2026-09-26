/**
 * Projektets dokumentmodel. Alt, hvad der gemmes, fortrydes og eksporteres,
 * ligger her. 3D-scenen er en afledning af dokumentet.
 * Enheder: meter og radianer. Koordinater: x/z er gulvplanet, y er op.
 */

export type FloorMaterialType = 'wood' | 'tiles' | 'concrete' | 'carpet';
export type WallMaterialType = 'paint' | 'brick' | 'plaster';

export interface FloorMaterial {
  type: FloorMaterialType;
  color: string;
}

export interface WallMaterial {
  type: WallMaterialType;
  color: string;
}

export interface WallNode {
  id: string;
  x: number;
  z: number;
}

export interface Wall {
  id: string;
  a: string;
  b: string;
  height: number;
  thickness: number;
  /** Materiale på +v-siden (venstre, set fra a mod b). */
  sideA: WallMaterial;
  /** Materiale på -v-siden (højre, set fra a mod b). */
  sideB: WallMaterial;
}

export type OpeningKind = 'door' | 'window';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Id i bygge-kataloget (fx "door-90"). */
  style: string;
  /** Afstand fra væggens startpunkt (a) til åbningens midte. */
  offset: number;
  width: number;
  height: number;
  /** Brystningshøjde (0 for døre). */
  sill: number;
  /** Spejlvend dørens hængsel/åbningsretning. */
  flip?: boolean;
}

/** Stil for et automatisk fundet rum, forankret i et punkt inde i rummet. */
export interface RoomStyle {
  id: string;
  x: number;
  z: number;
  floor: FloorMaterial;
  hidden?: boolean;
  name?: string;
}

export type Finish = 'stof' | 'laeder' | 'trae' | 'lak' | 'metal';

export interface FurnitureItem {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  color?: string;
  finish?: Finish;
  lightOn?: boolean;
}

export type WallMode = 'up' | 'cutaway' | 'down';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface ProjectSettings {
  timeOfDay: number;
  wallMode: WallMode;
  snapEnabled: boolean;
  snapStep: number;
  defaultWallHeight: number;
  defaultWallThickness: number;
}

export interface ProjectDoc {
  version: 1;
  id: string;
  name: string;
  nodes: Record<string, WallNode>;
  walls: Record<string, Wall>;
  openings: Record<string, Opening>;
  rooms: RoomStyle[];
  furniture: Record<string, FurnitureItem>;
  settings: ProjectSettings;
  camera?: CameraPose;
  updatedAt: number;
}

export type PickKind = 'furniture' | 'wall' | 'opening' | 'floor';

export interface PickRef {
  kind: PickKind;
  id: string;
}
