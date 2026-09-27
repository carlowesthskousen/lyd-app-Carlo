import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Lighting } from './lighting';
import { createGrid } from './grid';
import { setMaxAnisotropy } from './anisotropy';
import { EnvironmentLight } from './environment';
import { GROUND_SIZE, createGroundMaterial } from './ground';
import { ReflectionProbes } from './reflectionProbes';
import { setOpalTransmission } from './materials';

export interface Quality {
  ssao: boolean;
  /** Antal SSAO-prøver pr. pixel (altid fuld opløsning – halv giver lyse, takkede kanter). */
  ssaoSamples: number;
  shadowSize: number;
  /** Blødhed af skyggekanter (PCF-radius i skyggepixels). */
  shadowSoftness: number;
  pixelRatio: number;
  bloom: boolean;
  smaa: boolean;
  /** Størrelse på rummenes refleksionsprober (pixels pr. kubeside). */
  probeSize: number;
  /** Transmission i opalglas (koster et ekstra render-pass). */
  transmission: boolean;
  /** MSAA-samples i hovedbufferen. */
  msaa: number;
}

/** Eksponering: ACES med lidt lavere eksponering, så hvide flader ikke brænder ud. */
const EXPOSURE = 0.9;

/**
 * Renderer, scene, efterbehandling og labels.
 * Kæde: Render (MSAA) → GTAO (SSAO) → Bloom → Omrids → Output (ACES + sRGB) → SMAA.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly labels = new CSS2DRenderer();
  readonly lighting: Lighting;
  readonly environment: EnvironmentLight;
  readonly probes: ReflectionProbes;
  readonly grid = createGrid();
  readonly ground: THREE.Mesh;
  /** Omrids for markering / hover (blå). */
  readonly selectOutline: OutlinePass;
  /** Rødt glødende omrids (slet-værktøj og kollisioner). */
  readonly dangerOutline: OutlinePass;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private smaa: SMAAPass;
  private shadowDirty = true;
  /** Objekter, der ikke må give SSAO (kontaktskygger, hjælpere) – sættes af app'en. */
  noAO: THREE.Object3D[] = [];
  quality: Quality = {
    ssao: true,
    ssaoSamples: 8,
    shadowSize: 2048,
    shadowSoftness: 2.5,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    bloom: true,
    smaa: true,
    probeSize: 128,
    transmission: true,
    msaa: 4,
  };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const r = this.renderer;
    // Brug grafikkortets maksimale anisotropi (før der laves teksturer)
    setMaxAnisotropy(r.capabilities.getMaxAnisotropy());
    r.setPixelRatio(this.quality.pixelRatio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = EXPOSURE;
    r.shadowMap.enabled = true;
    // PCF i three r18x er blød (Vogel-disk); den gamle PCFSoftShadowMap er lagt ind i den.
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    // Opalglassets transmission er alligevel sløret – halv opløsning er nok
    r.transmissionResolutionScale = 0.5;
    host.appendChild(r.domElement);
    r.domElement.classList.add('viewport-canvas');

    this.labels.domElement.classList.add('viewport-labels');
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    this.scene.background = new THREE.Color('#dfe8ee');
    // Dis i horisontens farve (sættes af lyset), så græsset glider ud i himlen
    this.scene.fog = new THREE.Fog('#cdd9e3', 30, 330);

    this.lighting = new Lighting(this.scene);
    this.lighting.onChange = () => {
      this.environment.setSun(this.lighting.sunDirection, this.lighting.daylight);
      (this.scene.fog as THREE.Fog).color.copy(this.lighting.measureHorizon(r, this.scene));
      this.probes.schedule();
      this.markShadowsDirty();
    };

    // Rigtigt miljølys (HDRI); indtil det er hentet, bruges en neutral himmelfarve
    this.environment = new EnvironmentLight(r, this.scene);
    this.environment.onReady = () => this.probes.schedule(50);
    this.environment.onChange = () =>
      this.probes?.setOutdoor(this.environment.texture, this.scene.environmentRotation.y, this.scene.environmentIntensity);
    void this.environment.load();

    this.probes = new ReflectionProbes(r, this.scene);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2), createGroundMaterial());
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground, this.grid);

    const size = this.size();
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 1;
    // Radius og eksponent giver tydelig mørkning dér, hvor møbler rører gulvet
    this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 2, thickness: 1.5, scale: 1.15, samples: this.quality.ssaoSamples });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    // Hjælpeobjekter (gitter, spøgelser, kontaktskygger) og himlen må ikke give AO.
    const origRender = this.gtao.render.bind(this.gtao);
    this.gtao.render = (...args: Parameters<GTAOPass['render']>) => {
      const hidden: THREE.Object3D[] = [];
      this.scene.traverseVisible((o) => {
        if (o.userData.helper || o.userData.noAO || o === this.lighting.sky || this.noAO.includes(o)) hidden.push(o);
      });
      for (const o of hidden) o.visible = false;
      origRender(...args);
      for (const o of hidden) o.visible = true;
    };
    this.composer.addPass(this.gtao);

    // Svag bloom: kun det, der er meget lyst (tændte lampeskærme, solglimt i metal)
    this.bloom = new UnrealBloomPass(size.clone(), 0.22, 0.3, 4.2);
    this.composer.addPass(this.bloom);

    this.selectOutline = new OutlinePass(size.clone(), this.scene, this.camera);
    this.styleOutline(this.selectOutline, '#4fb3ff', '#1d6fb8', 3, 1.6);
    this.composer.addPass(this.selectOutline);

    this.dangerOutline = new OutlinePass(size.clone(), this.scene, this.camera);
    this.styleOutline(this.dangerOutline, '#ff3b30', '#ff6b5e', 5, 2.5);
    this.dangerOutline.pulsePeriod = 0;
    this.composer.addPass(this.dangerOutline);

    this.composer.addPass(new OutputPass());
    // SMAA efter tonemapping: fjerner flimmer på tynde ting (stænger, ben) oven i MSAA
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);

    this.lighting.setShadowQuality(this.quality.shadowSize);
    this.lighting.sun.shadow.radius = this.quality.shadowSoftness;

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
    const prev = { ...this.quality };
    Object.assign(this.quality, q);
    const cur = this.quality;
    this.gtao.enabled = cur.ssao;
    this.bloom.enabled = cur.bloom;
    this.smaa.enabled = cur.smaa;
    setOpalTransmission(cur.transmission);
    this.probes.setSize(cur.probeSize);
    if (cur.shadowSize !== prev.shadowSize) {
      this.lighting.setShadowQuality(cur.shadowSize);
      this.markShadowsDirty();
    }
    if (cur.msaa !== prev.msaa) {
      for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        t.samples = cur.msaa;
        t.dispose();
      }
    }
    if (cur.shadowSoftness !== prev.shadowSoftness) {
      this.lighting.sun.shadow.radius = cur.shadowSoftness;
    }
    if (cur.ssaoSamples !== prev.ssaoSamples) {
      this.gtao.updateGtaoMaterial({ samples: cur.ssaoSamples });
      this.gtao.updatePdMaterial({ samples: cur.ssaoSamples >= 16 ? 12 : 8 });
    }
    if (this.renderer.getPixelRatio() !== cur.pixelRatio) {
      this.renderer.setPixelRatio(cur.pixelRatio);
      this.resize();
    }
  }

  markShadowsDirty() {
    this.shadowDirty = true;
  }

  /**
   * Lader skygger og græsplæne følge kameraet. `focus` er det punkt, man kigger på.
   */
  follow(focus: THREE.Vector3) {
    const cam = this.camera.position;
    const dist = Math.min(20, cam.distanceTo(focus));
    const half = THREE.MathUtils.clamp(Math.round(dist * 0.55), 7, 10);
    // Centrum ligger mellem kameraet og fokuspunktet, så både det nære og det,
    // man kigger på, er dækket (vigtigt i øjenhøjde, hvor fokus ligger langt ude).
    const dx = focus.x - cam.x;
    const dz = focus.z - cam.z;
    const hd = Math.hypot(dx, dz);
    const k = hd > 1e-3 ? Math.min(hd, half * 0.9) / hd : 0;
    const center = new THREE.Vector3(cam.x + dx * k, 0, cam.z + dz * k);
    if (this.lighting.follow(center, dist)) this.markShadowsDirty();
    // Plænen flytter sig med kameraet (UV'erne følger verden, så teksturen står stille)
    this.ground.position.set(Math.round(cam.x / 50) * 50, 0, Math.round(cam.z / 50) * 50);
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
