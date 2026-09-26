import * as THREE from 'three';
import type { CameraPose } from '../state/types';

/** Funktion der finder det punkt i verden, som ligger under en skærmposition (NDC). */
export type PickPoint = (ndc: THREE.Vector2) => THREE.Vector3 | null;

const MIN_HEIGHT = 0.35;
const MIN_PITCH = THREE.MathUtils.degToRad(-89.5);
const MAX_PITCH = THREE.MathUtils.degToRad(35);

export const DEFAULT_POSE: CameraPose = { x: 9, y: 11, z: 14, yaw: THREE.MathUtils.degToRad(32), pitch: THREE.MathUtils.degToRad(-35) };

/**
 * Frit flyvende kamera i stil med Planet Coaster / The Sims.
 * - WASD/piletaster: vandret bevægelse i kameraets retning, Q/E (eller Space) ned/op
 * - Højreklik-træk: orbit omkring punktet under musen (eller drej på stedet mod himlen)
 * - Midterklik-træk: panorér ("grib" gulvet)
 * - Scroll: zoom mod musens position
 * Alle bevægelser er dæmpede (eksponentiel udglatning), uafhængigt af billedfrekvens.
 */
export class FlyCamera {
  yaw = DEFAULT_POSE.yaw;
  pitch = DEFAULT_POSE.pitch;
  readonly position = new THREE.Vector3(DEFAULT_POSE.x, DEFAULT_POSE.y, DEFAULT_POSE.z);
  /** Hastighedsfaktor (justeres fra UI). */
  speed = 1;
  enabled = true;

  private velocity = new THREE.Vector3();
  private keys = new Set<string>();
  // Ventende, udglattede bevægelser
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pendingMove = new THREE.Vector3();
  private orbitPivot: THREE.Vector3 | null = null;
  private drag: { mode: 'orbit' | 'pan'; x: number; y: number; moved: number; planeY: number } | null = null;
  private tween: { from: CameraPose; to: CameraPose; t: number; dur: number } | null = null;
  /** Kaldes når brugeren højreklikker uden at trække. */
  onRightClick?: () => void;
  onChange?: () => void;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private pickPoint: PickPoint,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.apply();
  }

  get isDragging() {
    return this.drag !== null;
  }

  /** Tastatur-bevægelse ignoreres, mens man skriver i et felt eller holder Ctrl/Cmd. */
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey) return;
    this.keys.add(e.code);
  };

  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (e.button !== 2 && e.button !== 1) return;
    e.preventDefault();
    this.tween = null;
    const hit = this.pickPoint(this.ndc(e));
    if (e.button === 2) {
      this.orbitPivot = hit && hit.distanceTo(this.position) < 400 ? hit : null;
      this.drag = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: 0, planeY: 0 };
    } else {
      this.drag = { mode: 'pan', x: e.clientX, y: e.clientY, moved: 0, planeY: hit ? Math.min(hit.y, this.position.y - 0.5) : 0 };
    }
    this.dom.setPointerCapture?.(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.mode === 'orbit') {
      this.pendingYaw -= dx * 0.0055;
      this.pendingPitch -= dy * 0.0045;
    } else {
      // Grib-panorering: punktet under musen bliver under musen.
      const prev = this.rayPlane(this.ndc({ clientX: d.x, clientY: d.y }), d.planeY);
      const cur = this.rayPlane(this.ndc(e), d.planeY);
      if (prev && cur) {
        const delta = prev.sub(cur);
        delta.y = 0;
        const maxStep = 50;
        if (delta.length() < maxStep) this.pendingMove.add(delta);
      }
    }
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if ((e.button === 2 && d.mode === 'orbit') || (e.button === 1 && d.mode === 'pan')) {
      if (d.mode === 'orbit' && d.moved < 5) this.onRightClick?.();
      this.drag = null;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.altKey) return; // Alt+scroll bruges til fri rotation af møbler
    this.tween = null;
    const ndc = this.ndc(e);
    const hit = this.pickPoint(ndc);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    let distance = hit ? hit.distanceTo(this.camera.position) : Math.max(5, this.position.y * 2.5);
    distance = Math.min(distance, 300);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = THREE.MathUtils.clamp(-delta * 0.0012, -0.5, 0.35);
    let step = distance * factor;
    if (step > 0) step = Math.min(step, distance - 0.4); // aldrig igennem punktet
    if (step > 0 || this.position.y < 250) this.pendingMove.addScaledVector(ray.ray.direction, step);
  };

  private rayPlane(ndc: THREE.Vector2, y: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    if (this.tween) {
      this.updateTween(dt);
      this.apply();
      return;
    }

    // --- Tastatur (acceleration/deceleration) ---
    const k = this.keys;
    const f = (a: string, b: string) => (k.has(a) || k.has(b) ? 1 : 0);
    const input = new THREE.Vector3(
      f('KeyD', 'ArrowRight') - f('KeyA', 'ArrowLeft'),
      f('KeyE', 'Space') - f('KeyQ', 'KeyQ'),
      f('KeyS', 'ArrowDown') - f('KeyW', 'ArrowUp'),
    );
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
    // Højere oppe = hurtigere, så det føles ens i alle højder.
    const base = 3.2 * this.speed * boost * THREE.MathUtils.clamp(0.45 + this.position.y * 0.16, 0.6, 12);
    const flatFwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(right, input.x)
      .addScaledVector(flatFwd, -input.z)
      .setY(input.y * 0.8);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(base);
    const accel = wish.lengthSq() > 0 ? 9 : 6;
    this.velocity.lerp(wish, 1 - Math.exp(-accel * dt));
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0, 0);
    this.position.addScaledVector(this.velocity, dt);

    // --- Udglattet mus: rotation/orbit ---
    const s = 1 - Math.exp(-16 * dt);
    let dyaw = this.pendingYaw * s;
    let dpitch = this.pendingPitch * s;
    this.pendingYaw -= dyaw;
    this.pendingPitch -= dpitch;
    const newPitch = THREE.MathUtils.clamp(this.pitch + dpitch, MIN_PITCH, MAX_PITCH);
    dpitch = newPitch - this.pitch;
    if (this.orbitPivot && (Math.abs(dyaw) > 1e-7 || Math.abs(dpitch) > 1e-7)) {
      const offset = this.position.clone().sub(this.orbitPivot);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dyaw);
      const rightAxis = new THREE.Vector3(Math.cos(this.yaw + dyaw), 0, -Math.sin(this.yaw + dyaw));
      const pitched = offset.clone().applyAxisAngle(rightAxis, dpitch);
      if (this.orbitPivot.y + pitched.y < MIN_HEIGHT) {
        dpitch = 0;
      } else {
        offset.copy(pitched);
      }
      this.position.copy(this.orbitPivot).add(offset);
    }
    this.yaw += dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, MIN_PITCH, MAX_PITCH);

    // --- Udglattet panorering og zoom ---
    const ms = 1 - Math.exp(-14 * dt);
    const step = this.pendingMove.clone().multiplyScalar(ms);
    this.pendingMove.sub(step);
    this.position.add(step);

    if (this.position.y < MIN_HEIGHT) {
      this.position.y = MIN_HEIGHT;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.pendingMove.y = Math.max(0, this.pendingMove.y);
    }
    this.position.y = Math.min(this.position.y, 400);
    this.position.x = THREE.MathUtils.clamp(this.position.x, -300, 300);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -300, 300);
    this.apply();
  }

  private lastPose = '';

  private apply() {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    const pose = `${this.position.x.toFixed(3)},${this.position.y.toFixed(3)},${this.position.z.toFixed(3)},${this.yaw.toFixed(4)},${this.pitch.toFixed(4)}`;
    if (pose !== this.lastPose) {
      this.lastPose = pose;
      this.onChange?.();
    }
  }

  getPose(): CameraPose {
    return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw, pitch: this.pitch };
  }

  setPose(p: CameraPose, animate = false, duration = 0.7) {
    this.velocity.set(0, 0, 0);
    this.pendingMove.set(0, 0, 0);
    this.pendingYaw = this.pendingPitch = 0;
    if (animate) {
      this.tween = { from: this.getPose(), to: { ...p }, t: 0, dur: duration };
    } else {
      this.tween = null;
      this.position.set(p.x, p.y, p.z);
      this.yaw = p.yaw;
      this.pitch = p.pitch;
      this.apply();
    }
  }

  private updateTween(dt: number) {
    const tw = this.tween!;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
    let dyaw = tw.to.yaw - tw.from.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.position.set(
      THREE.MathUtils.lerp(tw.from.x, tw.to.x, e),
      THREE.MathUtils.lerp(tw.from.y, tw.to.y, e),
      THREE.MathUtils.lerp(tw.from.z, tw.to.z, e),
    );
    this.yaw = tw.from.yaw + dyaw * e;
    this.pitch = THREE.MathUtils.lerp(tw.from.pitch, tw.to.pitch, e);
    if (tw.t >= 1) this.tween = null;
  }

  /** Flyver hen og kigger på en kugle (fx et valgt objekt) fra den nuværende retning. */
  focusOn(sphere: THREE.Sphere) {
    const fwd = this.forward();
    // Kig lidt nedad for et behageligt overblik.
    const pitch = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(-60), THREE.MathUtils.degToRad(-20));
    fwd.set(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = Math.max(1.6, (sphere.radius * 1.4) / Math.sin(fov / 2));
    const pos = sphere.center.clone().addScaledVector(fwd, -distance);
    pos.y = Math.max(pos.y, MIN_HEIGHT + 0.2);
    this.setPose({ x: pos.x, y: pos.y, z: pos.z, yaw: this.yaw, pitch }, true);
  }

  /** Top-down-visning over punktet kameraet kigger på. */
  topDown(center: THREE.Vector3, height: number) {
    this.setPose({ x: center.x, y: height, z: center.z + 0.001, yaw: 0, pitch: MIN_PITCH }, true);
  }

  /** Punktet på gulvet (y=0), som kameraet kigger på (midt i billedet). */
  focusPoint(maxDistance = 40): THREE.Vector3 {
    const fwd = this.forward();
    if (fwd.y < -0.05) {
      const t = Math.min(-this.position.y / fwd.y, maxDistance);
      return this.position.clone().addScaledVector(fwd, t).setY(0);
    }
    return this.position.clone().addScaledVector(fwd.setY(0).normalize(), Math.min(maxDistance, 15)).setY(0);
  }
}
