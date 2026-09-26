import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Lighting } from './lighting';
import { createGrid } from './grid';
import { grassTexture, TEXTURE_SIZE_M } from './textures';

export interface Quality {
  ssao: boolean;
  shadowSize: number;
  pixelRatio: number;
}

/**
 * Renderer, scene, efterbehandling (SSAO, omrids, ACES) og labels.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly labels = new CSS2DRenderer();
  readonly lighting: Lighting;
  readonly grid = createGrid();
  readonly ground: THREE.Mesh;
  /** Omrids for markering / hover (blå). */
  readonly selectOutline: OutlinePass;
  /** Rødt glødende omrids (slet-værktøj og kollisioner). */
  readonly dangerOutline: OutlinePass;
  private gtao: GTAOPass;
  private shadowDirty = true;
  quality: Quality = { ssao: true, shadowSize: 2048, pixelRatio: Math.min(window.devicePixelRatio, 2) };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setPixelRatio(this.quality.pixelRatio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    host.appendChild(r.domElement);
    r.domElement.classList.add('viewport-canvas');

    this.labels.domElement.classList.add('viewport-labels');
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    this.scene.background = new THREE.Color('#dfe8ee');

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.lighting = new Lighting(this.scene);
    this.lighting.onChange = () => this.markShadowsDirty();

    const grass = grassTexture().clone();
    grass.repeat.set(400 / TEXTURE_SIZE_M.grass, 400 / TEXTURE_SIZE_M.grass);
    grass.needsUpdate = true;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#7e9a5c', map: grass, roughness: 1 }),
    );
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground, this.grid);

    const size = this.size();
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // Hjælpeobjekter (gitter, spøgelser) må ikke kaste AO.
    const origRender = this.gtao.render.bind(this.gtao);
    this.gtao.render = (...args: Parameters<GTAOPass['render']>) => {
      const hidden: THREE.Object3D[] = [];
      this.scene.traverseVisible((o) => {
        if (o.userData.helper || o === this.lighting.sky) hidden.push(o);
      });
      for (const o of hidden) o.visible = false;
      origRender(...args);
      for (const o of hidden) o.visible = true;
    };
    this.composer.addPass(this.gtao);

    this.selectOutline = new OutlinePass(size.clone(), this.scene, this.camera);
    this.styleOutline(this.selectOutline, '#4fb3ff', '#1d6fb8', 3, 1.6);
    this.composer.addPass(this.selectOutline);

    this.dangerOutline = new OutlinePass(size.clone(), this.scene, this.camera);
    this.styleOutline(this.dangerOutline, '#ff3b30', '#ff6b5e', 5, 2.5);
    this.dangerOutline.pulsePeriod = 0;
    this.composer.addPass(this.dangerOutline);

    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private styleOutline(p: OutlinePass, visible: string, hidden: string, strength: number, thickness: number) {
    p.visibleEdgeColor.set(visible);
    p.hiddenEdgeColor.set(hidden);
    p.edgeStrength = strength;
    p.edgeThickness = thickness;
    p.edgeGlow = 0.6;
  }

  size() {
    return new THREE.Vector2(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight));
  }

  resize() {
    const s = this.size();
    this.camera.aspect = s.x / s.y;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(s.x, s.y);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
    this.labels.setSize(s.x, s.y);
  }

  setQuality(q: Partial<Quality>) {
    Object.assign(this.quality, q);
    this.gtao.enabled = this.quality.ssao;
    this.lighting.setShadowQuality(this.quality.shadowSize);
    if (this.renderer.getPixelRatio() !== this.quality.pixelRatio) {
      this.renderer.setPixelRatio(this.quality.pixelRatio);
      this.resize();
    }
    this.markShadowsDirty();
  }

  markShadowsDirty() {
    this.shadowDirty = true;
  }

  render() {
    if (this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.selectOutline.enabled = this.selectOutline.selectedObjects.length > 0;
    this.dangerOutline.enabled = this.dangerOutline.selectedObjects.length > 0;
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }
}
