/**
 * Grafikkortets maksimale anisotropiske filtrering (skarpe teksturer på skrå
 * flader som gulve). Sættes af Viewport, så snart rendereren findes.
 */
let max = 8;

export function setMaxAnisotropy(n: number) {
  if (n > 0) max = n;
}

export function maxAnisotropy() {
  return max;
}
