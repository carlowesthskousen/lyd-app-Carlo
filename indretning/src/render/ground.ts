import * as THREE from 'three';
import { maxAnisotropy } from './anisotropy';

/**
 * Græsplænen: PBR-græs (farve + normal-map) tegnet ved opstart, med
 * "anti-tiling" i shaderen: teksturen læses i to størrelser (den ene drejet)
 * og blandes efter en langsom støj, og der lægges store, bløde farvevariationer
 * ovenpå. UV'erne regnes ud fra verdenspositionen, så plænen kan følge kameraet.
 */

/** Meter pr. teksturgentagelse (den fine skala). */
const TILE = 2.2;
const SIZE = 1024;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tegner græsstrå: farvekort + højdekort (til normal-map). */
function paintGrass() {
  const color = document.createElement('canvas');
  const height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = SIZE;
  const c = color.getContext('2d')!;
  const hc = height.getContext('2d')!;
  const rnd = rng(1337);
  c.fillStyle = '#5a7433';
  c.fillRect(0, 0, SIZE, SIZE);
  hc.fillStyle = '#202020';
  hc.fillRect(0, 0, SIZE, SIZE);
  // Jord/filt i bunden
  for (let i = 0; i < 2500; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE, r = 2 + rnd() * 6;
    c.fillStyle = `rgba(${90 + rnd() * 30},${88 + rnd() * 25},${45 + rnd() * 15},0.18)`;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  // Strå: korte, lidt bøjede streger i mange grønne nuancer. Tegnes med wrap,
  // så teksturen er sømløs.
  const blades = 60000;
  for (let i = 0; i < blades; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE;
    const len = 6 + rnd() * 16;
    const ang = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * 0.8;
    const t = rnd();
    const dry = rnd() < 0.05;
    const g = dry ? [140 + t * 30, 138 + t * 25, 72 + t * 18] : [72 + t * 42, 104 + t * 44, 38 + t * 22];
    const lw = 1 + rnd() * 1.6;
    const hv = Math.round(120 + t * 110);
    for (const ox of [-SIZE, 0, SIZE])
      for (const oy of [-SIZE, 0, SIZE]) {
        const px = x + ox, py = y + oy;
        if (px < -30 || py < -30 || px > SIZE + 30 || py > SIZE + 30) continue;
        const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
        const mx = (px + ex) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * 0.3;
        const my = (py + ey) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * 0.3;
        c.strokeStyle = `rgb(${g[0] | 0},${g[1] | 0},${g[2] | 0})`;
        c.lineWidth = lw;
        c.beginPath();
        c.moveTo(px, py);
        c.quadraticCurveTo(mx, my, ex, ey);
        c.stroke();
        hc.strokeStyle = `rgb(${hv},${hv},${hv})`;
        hc.lineWidth = lw;
        hc.beginPath();
        hc.moveTo(px, py);
        hc.quadraticCurveTo(mx, my, ex, ey);
        hc.stroke();
      }
  }
  return { color, height };
}

/** Normal-map (tangentrum) fra et højdekort med Sobel. */
function normalFromHeight(src: HTMLCanvasElement, strength: number) {
  const S = src.width;
  const hd = src.getContext('2d')!.getImageData(0, 0, S, S).data;
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const H = (x: number, y: number) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * strength;
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * strength;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Glat, sømløs værdistøj (til blanding og store farvepletter). */
function noiseCanvas() {
  const N = 16;
  const S = 256;
  const rnd = rng(99);
  const small = document.createElement('canvas');
  small.width = small.height = N * 3;
  const sc = small.getContext('2d')!;
  const vals: number[] = [];
  for (let i = 0; i < N * N; i++) vals.push(rnd());
  const img = sc.createImageData(N * 3, N * 3);
  for (let y = 0; y < N * 3; y++)
    for (let x = 0; x < N * 3; x++) {
      const v = vals[(y % N) * N + (x % N)] * 255;
      const i = (y * N * 3 + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = vals[((y + 5) % N) * N + ((x + 9) % N)] * 255;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  sc.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const oc = out.getContext('2d')!;
  oc.imageSmoothingEnabled = true;
  oc.imageSmoothingQuality = 'high';
  // Skalér det midterste felt op (naboerne sørger for sømløse kanter)
  oc.drawImage(small, N - 1, N - 1, N + 2, N + 2, -S / N, -S / N, S + (2 * S) / N, S + (2 * S) / N);
  return out;
}

function tex(canvas: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

export function createGroundMaterial(): THREE.MeshStandardMaterial {
  const { color, height } = paintGrass();
  const map = tex(color, true);
  const normalMap = tex(normalFromHeight(height, 0.7), false);
  const noise = tex(noiseCanvas(), false);
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.93, metalness: 0 });
  m.normalScale.set(0.55, 0.55);
  m.name = 'græs';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.uniforms.uTile = { value: TILE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGWorld;
uniform sampler2D uNoise;
uniform float uTile;
const mat2 ROT_B = mat2(0.6, -0.8, 0.8, 0.6);
vec2 gUvA() { return vGWorld / uTile; }
vec2 gUvB() { return ROT_B * vGWorld / (uTile * 3.3) + vec2(0.37, 0.71); }
float gBlend() { return smoothstep(0.25, 0.75, texture2D(uNoise, vGWorld / 19.0).r); }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float b = gBlend();
  vec4 cA = texture2D(map, gUvA());
  vec4 cB = texture2D(map, gUvB());
  vec4 texelColor = mix(cA, cB, b);
  // Store, bløde variationer: lysere/mørkere og lidt tørrere pletter
  float n1 = texture2D(uNoise, vGWorld / 43.0 + 0.21).g;
  float n2 = texture2D(uNoise, vGWorld / 131.0 + 0.57).r;
  texelColor.rgb *= mix(0.8, 1.12, n1);
  texelColor.rgb = mix(texelColor.rgb, texelColor.rgb * vec3(1.18, 1.08, 0.72), smoothstep(0.55, 0.9, n2) * 0.6);
  diffuseColor *= texelColor;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  float b = gBlend();
  vec3 nA = texture2D(normalMap, gUvA()).xyz * 2.0 - 1.0;
  vec3 nB = texture2D(normalMap, gUvB()).xyz * 2.0 - 1.0;
  nB.xy = transpose(ROT_B) * nB.xy;
  vec3 mapN = normalize(mix(nA, nB, b));
  mapN.xy *= normalScale;
  // Plænen er vandret: tangent = +x, bitangent = +z, normal = +y (verden)
  vec3 nWorld = normalize(vec3(mapN.x, mapN.z, mapN.y));
  normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => 'ground-antitile-v1';
  return m;
}

/** Plænens størrelse (m). Den følger kameraet, så den aldrig slutter. */
export const GROUND_SIZE = 1400;
