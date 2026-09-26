import * as THREE from 'three';
import type { PickKind } from '../state/types';

export interface PickHit {
  kind: PickKind;
  id: string;
  side?: 'A' | 'B';
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  object: THREE.Object3D;
  distance: number;
}

/**
 * Raycasting mod alle valgbare objekter. Returnerer det nærmeste objekt
 * under musen (præcis ét), evt. filtreret på typer.
 */
export class Picker {
  readonly raycaster = new THREE.Raycaster();
  roots: THREE.Object3D[] = [];

  constructor(private camera: THREE.Camera) {}

  setFromNdc(ndc: THREE.Vector2) {
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  pick(ndc: THREE.Vector2, kinds?: PickKind[], exclude?: Set<THREE.Object3D>): PickHit | null {
    this.setFromNdc(ndc);
    const hits = this.raycaster.intersectObjects(this.roots, true);
    for (const h of hits) {
      if (!isVisible(h.object)) continue;
      if (exclude && hasAncestorIn(h.object, exclude)) continue;
      const info = findPick(h.object);
      if (!info) continue;
      // Glas og andre gennemsigtige flader i åbninger tæller stadig som åbningen.
      if (kinds && !kinds.includes(info.kind)) {
        // Et objekt af en anden type ligger foran: det skjuler det bagvedliggende,
        // undtagen gulve/åbninger, som man gerne må "se forbi" for møbler.
        if (info.kind === 'floor') continue;
        if (kinds.includes('furniture') && info.kind === 'opening') continue;
        return null;
      }
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : undefined;
      return { kind: info.kind, id: info.id, side: info.side, point: h.point.clone(), normal, object: h.object, distance: h.distance };
    }
    return null;
  }

  groundPoint(ndc: THREE.Vector2, y = 0): THREE.Vector3 | null {
    this.setFromNdc(ndc);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out);
  }
}

function isVisible(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function hasAncestorIn(o: THREE.Object3D, set: Set<THREE.Object3D>) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (set.has(p)) return true;
  return false;
}

export function findPick(o: THREE.Object3D): { kind: PickKind; id: string; side?: 'A' | 'B' } | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (p.userData.pick) return p.userData.pick;
  }
  return null;
}
