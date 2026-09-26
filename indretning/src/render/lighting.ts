import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * Sollys med bløde skygger, himmel og hemisfærelys, styret af tidspunktet på dagen.
 * Nord er -z, øst er +x.
 */
export class Lighting {
  readonly sun = new THREE.DirectionalLight('#fff4e0', 3);
  readonly hemi = new THREE.HemisphereLight('#cfe3ff', '#8a7a62', 0.9);
  readonly sky = new Sky();
  /** 0 om natten, 1 midt på dagen. */
  daylight = 1;
  private target = new THREE.Object3D();
  private center = new THREE.Vector3();
  private radius = 15;
  onChange?: () => void;

  constructor(private scene: THREE.Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    this.sun.target = this.target;
    scene.add(this.sun, this.target, this.hemi);

    this.sky.scale.setScalar(1500);
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

  /** Tilpasser skyggekameraet, så hele bygningen er dækket med størst mulig opløsning. */
  fitTo(box: THREE.Box3) {
    if (box.isEmpty()) {
      this.center.set(0, 0, 0);
      this.radius = 12;
    } else {
      box.getCenter(this.center);
      this.radius = Math.max(8, box.getSize(new THREE.Vector3()).length() / 2 + 3);
    }
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -this.radius;
    c.right = c.top = this.radius;
    c.near = 0.5;
    c.far = this.radius * 4 + 50;
    c.updateProjectionMatrix();
    this.place();
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
    this.hemi.intensity = 0.12 + 0.95 * this.daylight;
    this.hemi.color.set('#cfe3ff').lerp(new THREE.Color('#1b2340'), 1 - this.daylight);
    this.hemi.groundColor.set('#8a7a62').lerp(new THREE.Color('#141414'), 1 - this.daylight);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.dir).multiplyScalar(1000);
    if (elev < 0) u.sunPosition.value.set(this.dir.x, Math.sin(elev) * 1000, this.dir.z);
    u.rayleigh.value = 0.6 + 2.2 * (1 - this.daylight);
    this.scene.environmentIntensity = 0.08 + 0.4 * this.daylight;
    this.place();
    this.onChange?.();
  }

  private place() {
    this.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(this.dir, this.radius * 2 + 20);
    this.sun.updateMatrixWorld();
    this.target.updateMatrixWorld();
  }
}
