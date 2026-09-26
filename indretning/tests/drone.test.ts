import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { droneWish, stepBank, stepVelocity, lookDirection, type MotionInput } from '../src/camera/droneMotion';
import { sweepSphere } from '../src/camera/collision';

const idle: MotionInput = { forward: 0, strafe: 0, vertical: 0, boost: false, precision: false };

/** Simulerer: hold W i `hold` sekunder, slip, og flyv videre i `coast` sekunder. */
function fly(fps: number, glide: number, hold = 1, coast = 3, pitch = 0) {
  const dt = 1 / fps;
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const speeds: number[] = [];
  const frames = Math.round((hold + coast) * fps);
  for (let i = 0; i < frames; i++) {
    const input = i < hold * fps ? { ...idle, forward: 1 } : idle;
    pos.add(stepVelocity(vel, droneWish(input, 0, pitch, 4), glide, dt));
    speeds.push(vel.length());
  }
  return { pos, vel, speeds };
}

describe('drone-bevægelse', () => {
  it('W følger blikket: kigger man skråt ned, dykker man', () => {
    const w = droneWish({ ...idle, forward: 1 }, 0, -Math.PI / 4, 4);
    expect(w.y).toBeLessThan(-2.5);
    expect(w.z).toBeLessThan(-2.5);
    expect(w.length()).toBeCloseTo(4);
  });

  it('Space/C er altid lodret, uanset blik', () => {
    const w = droneWish({ ...idle, vertical: 1 }, 1.2, -1.2, 4);
    expect(w.x).toBeCloseTo(0);
    expect(w.z).toBeCloseTo(0);
    expect(w.y).toBeCloseTo(4);
  });

  it('boost og præcision skalerer farten', () => {
    expect(droneWish({ ...idle, forward: 1, boost: true }, 0, 0, 4).length()).toBeCloseTo(12);
    expect(droneWish({ ...idle, forward: 1, precision: true }, 0, 0, 4).length()).toBeCloseTo(0.6);
  });

  it('opfører sig ens ved 30, 60 og 144 fps', () => {
    const a = fly(60, 0.5).pos;
    for (const fps of [30, 144]) {
      expect(fly(fps, 0.5).pos.distanceTo(a)).toBeLessThan(0.001);
    }
  });

  it('accelererer blødt uden spring og glider videre efter slip', () => {
    const { speeds } = fly(60, 0.5);
    for (let i = 1; i < speeds.length; i++) {
      // Aldrig mere end ~0,5 m/s ændring på én frame ved 60 fps.
      expect(Math.abs(speeds[i] - speeds[i - 1])).toBeLessThan(0.5);
    }
    // 0,25 s efter slip glider den stadig
    expect(speeds[60 + 15]).toBeGreaterThan(0.5);
  });

  it('"glid" styrer hvor langt dronen glider efter slip', () => {
    const tight = fly(60, 0, 1, 3).pos.length() - fly(60, 0, 1, 0).pos.length();
    const floaty = fly(60, 1, 1, 3).pos.length() - fly(60, 1, 1, 0).pos.length();
    expect(tight).toBeLessThan(0.5);
    expect(floaty).toBeGreaterThan(3);
  });

  it('krængning retter sig selv op', () => {
    let roll = 0;
    for (let i = 0; i < 60; i++) roll = stepBank(roll, 4, 0, 4, true, 1 / 60);
    expect(roll).toBeLessThan(-0.05);
    for (let i = 0; i < 120; i++) roll = stepBank(roll, 0, 0, 4, true, 1 / 60);
    expect(Math.abs(roll)).toBeLessThan(0.002);
    expect(stepBank(0, 4, 1, 4, false, 1 / 60)).toBe(0);
  });

  it('lookDirection er en enhedsvektor', () => {
    expect(lookDirection(0.7, -0.3).length()).toBeCloseTo(1);
  });
});

describe('væg-kollision', () => {
  // En 4 m bred væg i z = 0 med et hul (dør) fra x = 1 til 2.
  const shape = new THREE.Shape([new THREE.Vector2(-2, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 2.1), new THREE.Vector2(2, 2.1), new THREE.Vector2(2, 0), new THREE.Vector2(4, 0), new THREE.Vector2(4, 2.6), new THREE.Vector2(-2, 2.6)]);
  const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  wall.updateMatrixWorld();

  it('stopper foran væggen', () => {
    const d = sweepSphere(new THREE.Vector3(0, 1.5, 1), new THREE.Vector3(0, 0, -2), [wall], 0.2);
    expect(1 + d.z).toBeCloseTo(0.2, 3);
  });

  it('glider langs væggen ved skrå indflyvning', () => {
    const d = sweepSphere(new THREE.Vector3(-1, 1.5, 0.5), new THREE.Vector3(-1, 0, -1), [wall], 0.2);
    expect(0.5 + d.z).toBeGreaterThan(0.19);
    expect(d.x).toBeLessThan(-0.9);
  });

  it('kan flyve gennem en døråbning', () => {
    const d = sweepSphere(new THREE.Vector3(1.5, 1, 1), new THREE.Vector3(0, 0, -2), [wall], 0.2);
    expect(d.z).toBeCloseTo(-2);
  });
});
