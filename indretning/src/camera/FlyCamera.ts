import * as THREE from 'three';
import type { CameraPose } from '../state/types';
import {
  type CameraMode,
  type CameraSettings,
  DRONE_SPEED_MAX,
  DRONE_SPEED_MIN,
  loadCameraSettings,
  saveCameraSettings,
} from './cameraSettings';
import { type MotionInput, consume, droneWish, lookDirection, rightVector, stepBank, stepVelocity } from './droneMotion';
import { readGamepad } from './gamepad';

/** Funktion der finder det punkt i verden, som ligger under en skærmposition (NDC). */
export type PickPoint = (ndc: THREE.Vector2) => THREE.Vector3 | null;
/** Justerer en bevægelse, så kameraet ikke går gennem vægge. */
export type Collide = (from: THREE.Vector3, delta: THREE.Vector3) => THREE.Vector3;

/** Laveste højde over gulv/terræn. */
const MIN_HEIGHT_BUILD = 0.35;
const MIN_HEIGHT_DRONE = 0.12;
const MIN_PITCH = THREE.MathUtils.degToRad(-89.5);
const MAX_PITCH_BUILD = THREE.MathUtils.degToRad(35);
const MAX_PITCH_DRONE = THREE.MathUtils.degToRad(89);
const FOV = { build: 50, drone: 62 };
/** Så højt kan man flyve – højt nok til at se hele grunden oppefra. */
const MAX_ALTITUDE = 1500;

export const DEFAULT_POSE: CameraPose = { x: 9, y: 11, z: 14, yaw: THREE.MathUtils.degToRad(32), pitch: THREE.MathUtils.degToRad(-35) };

/**
 * Kameraet har to tilstande (Tab skifter blødt mellem dem):
 *
 * **Byg** – oversigtskamera som i The Sims / Planet Coaster:
 * WASD vandret, Q/E/Space/C op/ned, højreklik-træk = orbit om punktet under musen,
 * midterklik = panorér, scroll = zoom mod musen.
 *
 * **Drone** – fri 3D-flyvning med inerti:
 * W flyver dertil, hvor man kigger (også op/ned), A/D sidelæns, Space op, C/Ctrl ned,
 * højreklik holdt nede = kig rundt (mouselook), scroll = flyvehastighed,
 * Shift = boost, Alt = præcision. Let krængning og valgfri væg-kollision.
 */
export class FlyCamera {
  yaw = DEFAULT_POSE.yaw;
  pitch = DEFAULT_POSE.pitch;
  roll = 0;
  readonly position = new THREE.Vector3(DEFAULT_POSE.x, DEFAULT_POSE.y, DEFAULT_POSE.z);
  readonly velocity = new THREE.Vector3();
  settings: CameraSettings = loadCameraSettings();
  enabled = true;
  /** Seneste gamepad-status (til HUD). */
  gamepadConnected = false;

  private keys = new Set<string>();
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pendingMove = new THREE.Vector3();
  private orbitPivot: THREE.Vector3 | null = null;
  private drag: { mode: 'look' | 'pan'; x: number; y: number; moved: number; planeY: number; locked: boolean } | null = null;
  private tween: { from: CameraPose & { fov: number }; to: CameraPose & { fov: number }; t: number; dur: number } | null = null;
  private yawRate = 0;
  private fovTarget: number;

  onRightClick?: () => void;
  onChange?: () => void;
  onModeChange?: (mode: CameraMode) => void;
  /** Kaldes når flyvehastigheden ændres (til HUD-visning). */
  onSpeedChange?: (speed: number) => void;
  collide?: Collide;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private pickPoint: PickPoint,
  ) {
    this.fovTarget = FOV[this.settings.mode];
    camera.fov = this.fovTarget;
    camera.updateProjectionMatrix();
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.drag?.locked) this.drag.locked = false;
    });
    this.apply();
  }

  get mode(): CameraMode {
    return this.settings.mode;
  }

  get isDragging() {
    return this.drag !== null;
  }

  /** Er Ctrl nede lige nu? (Bruges til at advare mod Ctrl+W, som lukker fanen.) */
  get ctrlHeld() {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight');
  }

  updateSettings(patch: Partial<CameraSettings>) {
    Object.assign(this.settings, patch);
    saveCameraSettings(this.settings);
  }

  // ------------------------------------------------------------------ tilstande

  /** Skifter tilstand med en blød overgang. */
  setMode(mode: CameraMode, animate = true) {
    if (mode === this.settings.mode) return;
    this.updateSettings({ mode });
    this.pendingYaw = this.pendingPitch = 0;
    this.pendingMove.set(0, 0, 0);
    this.fovTarget = FOV[mode];
    if (animate) {
      if (mode === 'build') this.toBuildPose();
      else this.toDronePose();
    }
    this.onModeChange?.(mode);
  }

  toggleMode() {
    this.setMode(this.settings.mode === 'drone' ? 'build' : 'drone');
  }

  /** Fra drone til byg: løft kameraet op til et overblik over det, man kiggede på. */
  private toBuildPose() {
    const fwd = lookDirection(this.yaw, this.pitch);
    const ray = new THREE.Raycaster(this.position.clone(), fwd.clone(), 0, 60);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let target = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!target || target.distanceTo(this.position) > 40) target = this.position.clone().addScaledVector(fwd.setY(0).normalize(), 6).setY(0);
    const pitch = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(-70), THREE.MathUtils.degToRad(-35));
    const dist = THREE.MathUtils.clamp(this.position.distanceTo(target), 7, 30);
    const dir = lookDirection(this.yaw, pitch);
    const pos = target.clone().addScaledVector(dir, -dist);
    pos.y = Math.max(pos.y, 3);
    this.animateTo({ x: pos.x, y: pos.y, z: pos.z, yaw: this.yaw, pitch }, 0.9);
  }

  /** Fra byg til drone: bliv hvor du er, men løft blikket mod horisonten. */
  private toDronePose() {
    const pitch = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(-40), THREE.MathUtils.degToRad(10));
    this.animateTo({ ...this.getPose(), pitch }, 0.7);
  }

  // ------------------------------------------------------------------ input

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      this.keys.add(e.code);
      return;
    }
    if (e.metaKey) return;
    // Ctrl+Z/Y/D/S er genveje; bevægelsestaster med Ctrl ignoreres.
    if (e.ctrlKey && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) return;
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
    if (e.button === 2) {
      // Byg: orbit om punktet under musen. Drone: ren mouselook.
      const hit = this.mode === 'build' ? this.pickPoint(this.ndc(e)) : null;
      this.orbitPivot = hit && hit.distanceTo(this.position) < 400 ? hit : null;
      this.drag = { mode: 'look', x: e.clientX, y: e.clientY, moved: 0, planeY: 0, locked: false };
      if (this.mode === 'drone') this.requestLock();
    } else {
      const hit = this.pickPoint(this.ndc(e));
      this.drag = { mode: 'pan', x: e.clientX, y: e.clientY, moved: 0, planeY: hit ? Math.min(hit.y, this.position.y - 0.5) : 0, locked: false };
    }
  };

  private requestLock() {
    const d = this.drag;
    try {
      const p = this.dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (d) d.locked = true;
      p?.catch?.(() => d && (d.locked = false));
    } catch {
      if (d) d.locked = false;
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const dx = e.movementX ?? e.clientX - d.x;
    const dy = e.movementY ?? e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.mode === 'look') {
      const s = this.settings.sensitivity;
      const inv = this.settings.invertY ? -1 : 1;
      const k = this.mode === 'drone' ? 0.0024 : 0.0055;
      this.pendingYaw -= dx * k * s;
      this.pendingPitch -= dy * k * 0.85 * s * inv;
    } else {
      // Grib-panorering: punktet under musen bliver under musen.
      const prev = this.rayPlane(this.ndc({ clientX: d.x, clientY: d.y }), d.planeY);
      const cur = this.rayPlane(this.ndc(e), d.planeY);
      if (prev && cur) {
        const delta = prev.sub(cur);
        delta.y = 0;
        if (delta.length() < 50) this.pendingMove.add(delta);
      }
    }
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if ((e.button === 2 && d.mode === 'look') || (e.button === 1 && d.mode === 'pan')) {
      if (d.mode === 'look' && d.moved < 5) this.onRightClick?.();
      if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
      this.drag = null;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.altKey && this.mode === 'build') return; // Alt+scroll bruges til fri rotation af møbler
    this.tween = null;
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (this.mode === 'drone') {
      // Scroll justerer flyvehastigheden.
      const f = Math.pow(1.0015, -delta);
      const speed = THREE.MathUtils.clamp(this.settings.droneSpeed * f, DRONE_SPEED_MIN, DRONE_SPEED_MAX);
      this.updateSettings({ droneSpeed: Math.round(speed * 100) / 100 });
      this.onSpeedChange?.(this.settings.droneSpeed);
      return;
    }
    const ndc = this.ndc(e);
    const hit = this.pickPoint(ndc);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    let distance = hit ? hit.distanceTo(this.camera.position) : Math.max(5, this.position.y * 2.5);
    distance = Math.min(distance, 600);
    const factor = THREE.MathUtils.clamp(-delta * 0.0012, -0.5, 0.35);
    let step = distance * factor;
    if (step > 0) step = Math.min(step, distance - 0.4); // aldrig igennem punktet
    this.pendingMove.addScaledVector(ray.ray.direction, step);
  };

  private rayPlane(ndc: THREE.Vector2, y: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  }

  forward(out = new THREE.Vector3()) {
    return lookDirection(this.yaw, this.pitch, out);
  }

  // ------------------------------------------------------------------ opdatering

  private readInput(): MotionInput & { lookX: number; lookY: number; toggle: boolean } {
    const k = this.keys;
    const on = (...codes: string[]) => (codes.some((c) => k.has(c)) ? 1 : 0);
    const pad = readGamepad();
    this.gamepadConnected = pad.connected;
    const drone = this.mode === 'drone';
    const down = on('KeyC', 'KeyQ') || (drone && this.ctrlHeld) ? 1 : 0;
    return {
      forward: THREE.MathUtils.clamp(on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown') - pad.moveY, -1, 1),
      strafe: THREE.MathUtils.clamp(on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft') + pad.moveX, -1, 1),
      vertical: THREE.MathUtils.clamp(on('Space', 'KeyE') - down + pad.up - pad.down, -1, 1),
      boost: on('ShiftLeft', 'ShiftRight') === 1 || pad.boost,
      precision: (drone && on('AltLeft', 'AltRight') === 1) || pad.precision,
      lookX: pad.lookX,
      lookY: pad.lookY,
      toggle: pad.toggleMode,
    };
  }

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    const input = this.readInput();
    if (input.toggle) this.toggleMode();
    // Højre stick kigger rundt (rad/s).
    const inv = this.settings.invertY ? -1 : 1;
    this.pendingYaw -= input.lookX * 2.4 * this.settings.sensitivity * dt;
    this.pendingPitch -= input.lookY * 1.8 * this.settings.sensitivity * dt * inv;

    this.updateFov(dt);
    if (this.tween) {
      this.updateTween(dt);
      this.roll += (0 - this.roll) * (1 - Math.exp(-8 * dt));
      this.apply();
      return;
    }
    if (this.mode === 'drone') this.updateDrone(input, dt);
    else this.updateBuild(input, dt);
    this.apply();
  }

  private updateDrone(input: MotionInput, dt: number) {
    // Kig rundt: næsten direkte (let udglattet for at fjerne musens hak).
    const dyaw = consume(this.pendingYaw, 30, dt);
    const dpitch = consume(this.pendingPitch, 30, dt);
    this.pendingYaw -= dyaw;
    this.pendingPitch -= dpitch;
    this.yaw += dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, MIN_PITCH, MAX_PITCH_DRONE);
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, dyaw / Math.max(dt, 1e-4), 1 - Math.exp(-10 * dt));

    const wish = droneWish(input, this.yaw, this.pitch, this.settings.droneSpeed);
    const step = stepVelocity(this.velocity, wish, this.settings.glide, dt);
    this.move(step, dt, MIN_HEIGHT_DRONE);
    // Midterklik-panorering virker også i drone-tilstand.
    this.applyPendingMove(dt, MIN_HEIGHT_DRONE);

    const sideways = this.velocity.dot(rightVector(this.yaw));
    this.roll = stepBank(this.roll, sideways, this.yawRate, this.settings.droneSpeed, this.settings.bank, dt);
  }

  private updateBuild(input: MotionInput, dt: number) {
    // Tastatur: vandret bevægelse i forhold til kameraets retning.
    const boost = input.boost ? 3 : input.precision ? 0.25 : 1;
    const base = 3.2 * this.settings.buildSpeed * boost * THREE.MathUtils.clamp(0.45 + this.position.y * 0.16, 0.6, 12);
    const flatFwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(rightVector(this.yaw), input.strafe)
      .addScaledVector(flatFwd, input.forward)
      .setY(input.vertical * 0.8);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(base);
    this.velocity.lerp(wish, 1 - Math.exp(-(wish.lengthSq() > 0 ? 9 : 6) * dt));
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0, 0);
    this.position.addScaledVector(this.velocity, dt);

    // Orbit om punktet under musen (eller drej på stedet).
    let dyaw = consume(this.pendingYaw, 16, dt);
    let dpitch = consume(this.pendingPitch, 16, dt);
    this.pendingYaw -= dyaw;
    this.pendingPitch -= dpitch;
    const newPitch = THREE.MathUtils.clamp(this.pitch + dpitch, MIN_PITCH, MAX_PITCH_BUILD);
    dpitch = newPitch - this.pitch;
    if (this.orbitPivot && (Math.abs(dyaw) > 1e-7 || Math.abs(dpitch) > 1e-7)) {
      const offset = this.position.clone().sub(this.orbitPivot);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dyaw);
      const rightAxis = rightVector(this.yaw + dyaw);
      const pitched = offset.clone().applyAxisAngle(rightAxis, dpitch);
      if (this.orbitPivot.y + pitched.y < MIN_HEIGHT_BUILD) dpitch = 0;
      else offset.copy(pitched);
      this.position.copy(this.orbitPivot).add(offset);
    }
    if (!this.drag && Math.abs(this.pendingYaw) + Math.abs(this.pendingPitch) < 1e-5) this.orbitPivot = null;
    this.yaw += dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, MIN_PITCH, MAX_PITCH_BUILD);
    this.roll += (0 - this.roll) * (1 - Math.exp(-8 * dt));

    this.applyPendingMove(dt, MIN_HEIGHT_BUILD);
    this.clampHeight(MIN_HEIGHT_BUILD);
  }

  private applyPendingMove(dt: number, minHeight: number) {
    const step = this.pendingMove.clone().multiplyScalar(1 - Math.exp(-14 * dt));
    this.pendingMove.sub(step);
    if (step.lengthSq() > 1e-10) this.move(step, 0, minHeight);
  }

  /** Flytter kameraet med kollision (vægge i drone-tilstand, altid gulvet). */
  private move(delta: THREE.Vector3, dt: number, minHeight: number) {
    let d = delta;
    if (this.mode === 'drone' && this.settings.wallCollision && this.collide && d.lengthSq() > 1e-12) {
      const wanted = d.length();
      d = this.collide(this.position, d);
      // Glid langs væggen i stedet for at blive ved med at presse ind i den.
      if (dt > 0 && d.length() < wanted * 0.999) this.velocity.copy(d).divideScalar(dt);
    }
    this.position.add(d);
    this.clampHeight(minHeight);
  }

  private clampHeight(minHeight: number) {
    if (this.position.y < minHeight) {
      this.position.y = minHeight;
      if (this.velocity.y < 0) this.velocity.y = 0;
      if (this.pendingMove.y < 0) this.pendingMove.y = 0;
    }
    if (this.position.y > MAX_ALTITUDE) {
      this.position.y = MAX_ALTITUDE;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
  }

  private updateFov(dt: number) {
    const f = this.camera.fov;
    if (Math.abs(f - this.fovTarget) < 0.01) return;
    this.camera.fov = f + (this.fovTarget - f) * (1 - Math.exp(-6 * dt));
    this.camera.updateProjectionMatrix();
  }

  private lastPose = '';

  private apply() {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camera.updateMatrixWorld();
    const pose = `${this.position.x.toFixed(3)},${this.position.y.toFixed(3)},${this.position.z.toFixed(3)},${this.yaw.toFixed(4)},${this.pitch.toFixed(4)}`;
    if (pose !== this.lastPose) {
      this.lastPose = pose;
      this.onChange?.();
    }
  }

  // ------------------------------------------------------------------ poses & animation

  getPose(): CameraPose {
    return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw, pitch: this.pitch };
  }

  setPose(p: CameraPose, animate = false, duration = 0.7) {
    if (animate) {
      this.animateTo(p, duration);
      return;
    }
    this.velocity.set(0, 0, 0);
    this.pendingMove.set(0, 0, 0);
    this.pendingYaw = this.pendingPitch = 0;
    this.tween = null;
    this.position.set(p.x, p.y, p.z);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.apply();
  }

  private animateTo(p: CameraPose, duration: number) {
    this.velocity.set(0, 0, 0);
    this.pendingMove.set(0, 0, 0);
    this.pendingYaw = this.pendingPitch = 0;
    this.tween = { from: { ...this.getPose(), fov: this.camera.fov }, to: { ...p, fov: this.fovTarget }, t: 0, dur: duration };
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
    const pitch = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(-60), THREE.MathUtils.degToRad(-20));
    const fwd = lookDirection(this.yaw, pitch);
    const fov = THREE.MathUtils.degToRad(this.fovTarget);
    const distance = Math.max(1.6, (sphere.radius * 1.4) / Math.sin(fov / 2));
    const pos = sphere.center.clone().addScaledVector(fwd, -distance);
    pos.y = Math.max(pos.y, MIN_HEIGHT_BUILD + 0.2);
    this.setPose({ x: pos.x, y: pos.y, z: pos.z, yaw: this.yaw, pitch }, true);
  }

  /** Top-down-visning over et punkt. */
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

  /** Aktuel fart i m/s. */
  get speed() {
    return this.velocity.length();
  }
}
