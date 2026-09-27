import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Lag, som kun himlen ligger på (bruges til at måle horisontens farve til disen). */
const SKY_LAYER = 7;
/** Skyggekameraet dækker mindst/højst så mange meter til hver side af det, man ser på. */
const SHADOW_HALF_MIN = 7;
const SHADOW_HALF_MAX = 10;

/**
 * Sollys med bløde skygger, himmel, dis og lidt hemisfærelys, styret af tidspunktet på dagen.
 * Det bløde omgivelseslys kommer fra HDRI'et (se environment.ts).
 * Skyggekameraet følger det, man kigger på, så skyggerne er skarpe (15–20 m felt).
 * Nord er -z, øst er +x.
 */
export class Lighting {
  readonly sun = new THREE.DirectionalLight('#fff4e0', 3);
  readonly hemi = new THREE.HemisphereLight('#cfe3ff', '#8a7a62', 0.15);
  readonly sky = new Sky();
  /** 0 om natten, 1 midt på dagen. */
  daylight = 1;
  private target = new THREE.Object3D();
  private center = new THREE.Vector3();
  private radius = 10;
  /** Det punkt, skyggerne sidst blev centreret om (før snap). */
  private followed = new THREE.Vector3(Infinity, 0, 0);
  /** Horisontens farve (lineær) – bruges til dis/tåge. */
  readonly horizon = new THREE.Color('#cdd9e3');
  private fogTarget: THREE.WebGLRenderTarget | null = null;
  private fogCamera = new THREE.PerspectiveCamera(8, 4, 1, 5000);
  onChange?: () => void;

  constructor(scene: THREE.Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // Små bias-værdier, så tynde ting (lampestænger, stoleben) også kaster skygge,
    // og skyggen sidder fast ved foden i stedet for at være forskudt.
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.radius = 2.5;
    this.sun.target = this.target;
    scene.add(this.sun, this.target, this.hemi);

    this.sky.scale.setScalar(1500);
    this.sky.layers.enable(SKY_LAYER);
    this.fogCamera.layers.set(SKY_LAYER);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
  }

  setShadowQuality(size: number) {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }

  /**
   * Lader skyggekameraet følge det, man kigger på. `focus` er punktet, kameraet
   * ser på; `distance` er kameraets afstand til det. Returnerer true, hvis
   * skyggerne skal tegnes igen. Centrum snappes til skyggekortets pixels, så
   * kanterne ikke "kravler", når kameraet flytter sig.
   */
  follow(focus: THREE.Vector3, distance: number): boolean {
    const half = THREE.MathUtils.clamp(Math.round(distance * 0.55), SHADOW_HALF_MIN, SHADOW_HALF_MAX);
    const moved = focus.distanceTo(this.followed) > half * 0.25;
    if (!moved && half === this.radius) return false;
    this.followed.copy(focus);
    this.radius = half;
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -half;
    c.right = c.top = half;
    c.near = 1;
    c.far = 220;
    c.updateProjectionMatrix();
    this.place();
    return true;
  }

  /** Centrum i lysets koordinater, snappet til hele skyggepixels. */
  private snappedCenter() {
    const z = this.dir.clone().normalize();
    const up = Math.abs(z.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    const texel = (this.radius * 2) / this.sun.shadow.mapSize.x;
    const p = this.followed.x === Infinity ? new THREE.Vector3() : this.followed;
    const cx = Math.round(p.dot(x) / texel) * texel;
    const cy = Math.round(p.dot(y) / texel) * texel;
    return x.multiplyScalar(cx).addScaledVector(y, cy).addScaledVector(z, p.dot(z));
  }

  /**
   * Måler horisontens farve ved at tegne et lille udsnit af himlen (vinkelret
   * på solen, lidt over horisonten). Disen får samme farve, så græsset glider
   * ud i himlen i stedet for at slutte med en hård kant.
   */
  measureHorizon(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    if (!this.fogTarget) this.fogTarget = new THREE.WebGLRenderTarget(16, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const cam = this.fogCamera;
    const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x).normalize();
    if (side.lengthSq() < 0.5) side.set(1, 0, 0);
    cam.position.set(0, 0, 0);
    cam.lookAt(side.x, 0.035, side.z);
    cam.updateMatrixWorld();
    const prev = renderer.getRenderTarget();
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    renderer.setRenderTarget(this.fogTarget);
    renderer.clear();
    renderer.render(scene, cam);
    const buf = new Uint16Array(16 * 4 * 4);
    renderer.readRenderTargetPixels(this.fogTarget, 0, 0, 16, 4, buf);
    renderer.setRenderTarget(prev);
    scene.background = bg;
    scene.fog = fog;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 16 * 4; i++) {
      r += THREE.DataUtils.fromHalfFloat(buf[i * 4]);
      g += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]);
      b += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]);
    }
    const n = 16 * 4;
    if (Number.isFinite(r + g + b)) this.horizon.setRGB(r / n, g / n, b / n);
    return this.horizon;
  }

  /** Solens retning (enhedsvektor mod solen). */
  get sunDirection() {
    return this.dir;
  }

  private dir = new THREE.Vector3(0, 1, 0);

  setTime(hour: number) {
    const dayFrac = (hour - 6) / 12;
    const elev = Math.sin(Math.PI * Math.min(Math.max(dayFrac, -0.25), 1.25)) * THREE.MathUtils.degToRad(62);
    const az = THREE.MathUtils.degToRad(90 + 180 * dayFrac);
    const cosE = Math.cos(elev);
    this.dir.set(cosE * Math.sin(az), Math.sin(elev), -cosE * Math.cos(az)).normalize();

    const e = Math.max(0, Math.sin(elev));
    this.daylight = THREE.MathUtils.smoothstep(e, 0, 0.35);
    const warm = new THREE.Color('#ffb070');
    const white = new THREE.Color('#fff6ea');
    const moon = new THREE.Color('#8fa6d6');
    if (elev > -0.02) {
      this.sun.color.copy(warm).lerp(white, THREE.MathUtils.smoothstep(e, 0.05, 0.5));
      this.sun.intensity = 0.2 + 3.2 * this.daylight;
    } else {
      // Månelys fra modsat retning.
      this.dir.set(-this.dir.x, 0.6, -this.dir.z).normalize();
      this.sun.color.copy(moon);
      this.sun.intensity = 0.25;
    }
    this.hemi.intensity = 0.14 + 0.08 * this.daylight;
    this.hemi.color.set('#cfe3ff').lerp(new THREE.Color('#1b2340'), 1 - this.daylight);
    this.hemi.groundColor.set('#8a7a62').lerp(new THREE.Color('#141414'), 1 - this.daylight);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.dir).multiplyScalar(1000);
    if (elev < 0) u.sunPosition.value.set(this.dir.x, Math.sin(elev) * 1000, this.dir.z);
    u.rayleigh.value = 0.6 + 2.2 * (1 - this.daylight);
    this.place();
    this.onChange?.();
  }

  private place() {
    this.center.copy(this.snappedCenter());
    this.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(this.dir, 100);
    this.sun.updateMatrixWorld();
    this.target.updateMatrixWorld();
  }
}
