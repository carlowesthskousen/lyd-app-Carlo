import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ImportJob } from './intake';
import { toFloat } from '../furniture/modelLibrary';

export interface LoadedModel {
  root: THREE.Group;
  /** Unikke materialer i modellen (navngivne). */
  materials: THREE.MeshStandardMaterial[];
  /** Hvilke meshes der bruger hvert materiale (til fremhævning). */
  meshesByMaterial: Map<THREE.Material, THREE.Mesh[]>;
  warnings: string[];
}

/**
 * Indlæser en model i browseren og gør den klar til spillet:
 * lys/kameraer fjernes, alle materialer bliver MeshStandardMaterial (PBR) med unikke navne.
 */
export async function loadModel(job: ImportJob): Promise<LoadedModel> {
  const warnings: string[] = [];
  const urls = new Map<string, string>();
  const created: string[] = [];
  const blobUrl = (b: Blob) => {
    const u = URL.createObjectURL(b);
    created.push(u);
    return u;
  };
  // Opslag på filnavn (teksturer refereres ofte med absolutte Windows-stier fra eksportøren)
  for (const f of job.assets) {
    const key = f.name.toLowerCase();
    if (!urls.has(key)) urls.set(key, blobUrl(f.blob));
  }
  const manager = new THREE.LoadingManager();
  const mainUrl = urls.get(job.main.name.toLowerCase())!;
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || created.includes(url)) return url;
    const name = decodeURIComponent(url.split(/[\\/]/).pop() ?? '').toLowerCase();
    const hit = urls.get(name);
    if (!hit && !/\.(glb|gltf|fbx|obj)$/i.test(name)) warnings.push(`Mangler filen "${name}" (teksturen springes over)`);
    return hit ?? url;
  });

  let root: THREE.Object3D;
  try {
    switch (job.format) {
      case 'glb':
      case 'gltf': {
        const loader = new GLTFLoader(manager);
        const draco = new DRACOLoader();
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        root = (await loader.loadAsync(mainUrl)).scene;
        break;
      }
      case 'fbx':
        root = await new FBXLoader(manager).loadAsync(mainUrl);
        break;
      case 'obj': {
        const text = await job.main.blob.text();
        const loader = new OBJLoader(manager);
        const mtlName = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
        const mtlFile = mtlName && job.assets.find((f) => f.name.toLowerCase() === mtlName.split(/[\\/]/).pop()!.toLowerCase());
        if (mtlFile) {
          const mtl = new MTLLoader(manager).parse(await mtlFile.blob.text(), '');
          mtl.preload();
          loader.setMaterials(mtl);
        } else if (mtlName) warnings.push(`Materialefilen "${mtlName}" mangler – bruger standardmaterialer`);
        root = loader.parse(text);
        break;
      }
    }
  } finally {
    // Teksturer er indlæst som billeder; blob-URL'erne kan frigives lidt senere.
    setTimeout(() => created.forEach((u) => URL.revokeObjectURL(u)), 30000);
  }

  // Fjern lys, kameraer og hjælpeobjekter fra eksportøren.
  const junk: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera || (o.type === 'Bone' && !o.children.length)) junk.push(o);
  });
  for (const j of junk) j.removeFromParent();

  // Komprimerede (kvantiserede) attributter pakkes ud til almindelige tal.
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g?.attributes) return;
    for (const name of ['position', 'normal', 'uv']) if (g.getAttribute(name)) g.setAttribute(name, toFloat(g.getAttribute(name)));
    if (!g.attributes.normal) g.computeVertexNormals();
  });
  const group = new THREE.Group();
  group.add(root);
  const { materials, meshesByMaterial } = normalizeMaterials(group);
  let meshes = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  if (!meshes) throw new Error('Filen indeholder ingen 3D-geometri');
  return { root: group, materials, meshesByMaterial, warnings };
}

/** Gør alle materialer til MeshStandardMaterial med unikke, læsbare navne. */
function normalizeMaterials(root: THREE.Object3D) {
  const converted = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const used = new Set<string>();
  const meshesByMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  let n = 0;
  const convert = (m: THREE.Material): THREE.MeshStandardMaterial => {
    let c = converted.get(m);
    if (c) return c;
    const src = m as THREE.MeshStandardMaterial & THREE.MeshPhongMaterial;
    c =
      m instanceof THREE.MeshStandardMaterial
        ? m
        : new THREE.MeshStandardMaterial({
            color: src.color?.clone() ?? new THREE.Color('#cccccc'),
            map: src.map ?? null,
            normalMap: src.normalMap ?? null,
            alphaMap: src.alphaMap ?? null,
            transparent: src.transparent,
            opacity: src.opacity ?? 1,
            side: src.side,
            // Phong "shininess" → roughness (groft)
            roughness: src.shininess !== undefined ? THREE.MathUtils.clamp(1 - Math.sqrt(src.shininess / 100), 0.15, 1) : 0.7,
            metalness: 0,
          });
    let name = (m.name || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim();
    if (!name || /^(material|mat|default|lambert|phong|standardsurface)\s*#?\d*$/i.test(name)) name = `Materiale ${++n}`;
    let unique = name;
    for (let i = 2; used.has(unique); i++) unique = `${name} ${i}`;
    used.add(unique);
    c.name = unique;
    if (c.map) c.map.colorSpace = THREE.SRGBColorSpace;
    converted.set(m, c);
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(convert);
    else mesh.material = convert(mesh.material);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      let l = meshesByMaterial.get(m);
      if (!l) meshesByMaterial.set(m, (l = []));
      l.push(mesh);
    }
  });
  return { materials: [...new Set(converted.values())], meshesByMaterial };
}
