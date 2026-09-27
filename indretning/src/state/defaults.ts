import type { FloorMaterial, ProjectDoc, WallMaterial } from './types';
import { uid } from './ids';

export const DEFAULT_WALL_MATERIAL: WallMaterial = { type: 'paint', color: '#f1ede6' };
export const DEFAULT_FLOOR_MATERIAL: FloorMaterial = { type: 'wood', color: '#c8a27a' };

export function emptyProject(name = 'Nyt projekt'): ProjectDoc {
  return {
    version: 1,
    id: uid('p'),
    name,
    nodes: {},
    walls: {},
    openings: {},
    rooms: [],
    furniture: {},
    groups: {},
    settings: {
      timeOfDay: 14,
      wallMode: 'up',
      snapEnabled: true,
      snapStep: 0.1,
      defaultWallHeight: 2.6,
      defaultWallThickness: 0.15,
    },
    updatedAt: Date.now(),
  };
}
