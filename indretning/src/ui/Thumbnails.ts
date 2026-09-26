import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Catalog, CatalogEntry } from '../furniture/catalog';
import type { ModelLibrary } from '../furniture/modelLibrary';
import type { FurnitureView } from '../furniture/FurnitureView';

/**
 * Genererer thumbnails til kataloget ved at rendere hver model i en lille,
 * separat scene. Bruger entry.thumbnail, hvis der er angivet et billede.
 */
export class Thumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  private cache = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly size = 192;

  constructor(
    private catalog: Catalog,
    private library: ModelLibrary,
    private furniture: FurnitureView,
  ) {}

  private init() {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(this.size, this.size);
    r.setPixelRatio(1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(3, 5, 4);
    this.scene.add(key, new THREE.HemisphereLight('#ffffff', '#b0a898', 0.8));
    this.renderer = r;
    return r;
  }

  get(entry: CatalogEntry): Promise<string> {
    let p = this.cache.get(entry.id);
    if (!p) {
      p = entry.thumbnail
        ? Promise.resolve(this.catalog.url(entry.thumbnail))
        : (this.queue = this.queue.then(() => this.render(entry))) as Promise<string>;
      this.cache.set(entry.id, p);
    }
    return p;
  }

  private async render(entry: CatalogEntry): Promise<string> {
    const tpl = await this.library.get(entry);
    // Giv browseren luft mellem hver thumbnail.
    await new Promise((r) => setTimeout(r, 0));
    const r = this.init();
    const body = tpl.clone(true);
    this.furniture.applyPreviewAppearance(body, entry);
    const holder = new THREE.Group();
    holder.add(body);
    holder.rotation.y = entry.placement === 'wall' ? 0 : -Math.PI / 6;
    this.scene.add(holder);
    const box = new THREE.Box3().setFromObject(holder);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const flat = entry.dimensions.height < 5;
    const dir = flat ? new THREE.Vector3(0, 1, 0.35).normalize() : new THREE.Vector3(0, 0.45, 1).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.02;
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.lookAt(sphere.center);
    this.camera.near = dist / 50;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    r.setClearColor(0x000000, 0);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(holder);
    return url;
  }
}
