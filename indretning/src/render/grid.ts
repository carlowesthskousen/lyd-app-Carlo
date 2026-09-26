import * as THREE from 'three';

/**
 * Uendeligt gitter med linjer for 10 cm, 50 cm og 1 m. Fine linjer fader ud
 * på afstand, så gitteret altid er roligt at se på.
 */
export function createGrid(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const geo = new THREE.PlaneGeometry(400, 400);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    uniforms: {
      uColor: { value: new THREE.Color('#2b5d8a') },
      uOpacity: { value: 1 },
      uFine: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFine;
      varying vec3 vWorld;
      float lineAt(vec2 p, float step, float width) {
        vec2 c = p / step;
        vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
        return 1.0 - min(min(g.x, g.y) / width, 1.0);
      }
      void main() {
        float d = distance(cameraPosition, vWorld);
        float fine = lineAt(vWorld.xz, 0.1, 1.0) * (1.0 - smoothstep(4.0, 9.0, d)) * 0.18 * uFine;
        float half_ = lineAt(vWorld.xz, 0.5, 1.0) * (1.0 - smoothstep(18.0, 40.0, d)) * 0.35;
        float meter = lineAt(vWorld.xz, 1.0, 1.3) * (1.0 - smoothstep(40.0, 90.0, d)) * 0.55;
        float a = max(max(fine, half_), meter);
        float axis = (1.0 - min(abs(vWorld.x) / fwidth(vWorld.x) / 1.5, 1.0)) + (1.0 - min(abs(vWorld.z) / fwidth(vWorld.z) / 1.5, 1.0));
        a = max(a, clamp(axis, 0.0, 1.0) * 0.5);
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a * uOpacity);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.012;
  mesh.renderOrder = 2;
  mesh.name = 'grid';
  mesh.userData.helper = true;
  return mesh;
}
