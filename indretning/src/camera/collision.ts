import * as THREE from 'three';

const ray = new THREE.Raycaster();

/**
 * Flytter en kugle med radius R fra `from` med `delta` og stopper den R fra
 * første væg. Resten af bevægelsen glider langs væggen (op til 3 gange, så
 * hjørner også føles bløde). Døre og vinduer er huller i vægmeshene, så de
 * kan passeres. Returnerer den justerede bevægelse.
 */
export function sweepSphere(from: THREE.Vector3, delta: THREE.Vector3, meshes: THREE.Object3D[], R: number): THREE.Vector3 {
  if (!meshes.length) return delta.clone();
  const origin = from.clone();
  let d = delta.clone();
  for (let i = 0; i < 3; i++) {
    const len = d.length();
    if (len < 1e-7) break;
    const dir = d.clone().divideScalar(len);
    ray.set(origin, dir);
    ray.near = 0;
    ray.far = len + R * 4;
    const hit = ray.intersectObjects(meshes, false).find((h) => h.face);
    if (!hit || !hit.face) {
      origin.add(d);
      d.set(0, 0, 0);
      break;
    }
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(dir) > 0) n.negate();
    // Afstanden langs bevægelsen, før kuglen rører væggen.
    const cos = Math.max(0.05, -n.dot(dir));
    const allowed = hit.distance - R / cos;
    if (allowed >= len) {
      origin.add(d);
      d.set(0, 0, 0);
      break;
    }
    const travel = Math.max(0, allowed);
    origin.addScaledVector(dir, travel);
    const rest = d.clone().multiplyScalar(1 - travel / len);
    rest.addScaledVector(n, -rest.dot(n));
    d = rest;
  }
  origin.add(d);
  return origin.sub(from);
}
