import * as THREE from 'three';

/**
 * Dronens bevægelsesfysik som rene funktioner (uden DOM), så den kan testes.
 * Alt er baseret på eksponentiel udglatning, så bevægelsen er ens ved 30, 60
 * eller 144 fps.
 */

export interface MotionInput {
  /** -1..1 (W/S, venstre stick op/ned) */
  forward: number;
  /** -1..1 (A/D, venstre stick sidelæns) */
  strafe: number;
  /** -1..1 (Space/C, triggers) – altid lodret */
  vertical: number;
  boost: boolean;
  precision: boolean;
}

export const BOOST_FACTOR = 3;
export const PRECISION_FACTOR = 0.15;

/** Retningen kameraet kigger (inkl. op/ned). */
export function lookDirection(yaw: number, pitch: number, out = new THREE.Vector3()) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/** Vandret højre-vektor. */
export function rightVector(yaw: number, out = new THREE.Vector3()) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Ønsket hastighed: W følger blikket i 3D, A/D sidelæns, Space/C lodret. */
export function droneWish(input: MotionInput, yaw: number, pitch: number, speed: number, out = new THREE.Vector3()) {
  const fwd = lookDirection(yaw, pitch);
  const right = rightVector(yaw);
  out.set(0, 0, 0).addScaledVector(fwd, input.forward).addScaledVector(right, input.strafe);
  out.y += input.vertical;
  if (out.lengthSq() > 1) out.normalize();
  const factor = input.precision ? PRECISION_FACTOR : input.boost ? BOOST_FACTOR : 1;
  return out.multiplyScalar(speed * factor);
}

/** Acceleration og glid ud fra "glid"-indstillingen (0 = stram, 1 = flydende). */
export function motionRates(glide: number) {
  const g = THREE.MathUtils.clamp(glide, 0, 1);
  return {
    accel: THREE.MathUtils.lerp(14, 3.2, g),
    decay: THREE.MathUtils.lerp(14, 0.8, g),
  };
}

/**
 * Opdaterer hastigheden mod den ønskede med inerti og returnerer den
 * tilbagelagte strækning i denne frame. Positionen integreres eksakt
 * (v nærmer sig ønsket eksponentielt), så resultatet er det samme ved
 * alle billedfrekvenser.
 */
export function stepVelocity(vel: THREE.Vector3, wish: THREE.Vector3, glide: number, dt: number, out = new THREE.Vector3()) {
  const { accel, decay } = motionRates(glide);
  const rate = wish.lengthSq() > 1e-8 ? accel : decay;
  const f = 1 - Math.exp(-rate * dt);
  // ∫ v dt = wish·dt + (v0 − wish)·(1 − e^(−k·dt)) / k
  out.copy(wish).multiplyScalar(dt).addScaledVector(vel.clone().sub(wish), f / rate);
  vel.lerp(wish, f);
  if (vel.lengthSq() < 1e-6 && wish.lengthSq() < 1e-8) vel.set(0, 0, 0);
  return out;
}

/**
 * Krængning: dronen læner sig ind i sidelæns bevægelse og drej og retter sig
 * selv op igen. Returnerer den nye rulning (radianer).
 */
export function stepBank(roll: number, sideways: number, yawRate: number, maxSpeed: number, enabled: boolean, dt: number) {
  let target = 0;
  if (enabled) {
    target = -(sideways / Math.max(maxSpeed, 0.5)) * 0.1 + yawRate * 0.035;
    target = THREE.MathUtils.clamp(target, -0.2, 0.2);
  }
  return roll + (target - roll) * (1 - Math.exp(-6 * dt));
}

/** Eksponentiel udglatning af en ventende værdi: returnerer den del, der bruges nu. */
export function consume(pending: number, rate: number, dt: number) {
  return pending * (1 - Math.exp(-rate * dt));
}
