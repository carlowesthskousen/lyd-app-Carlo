/**
 * Enkel gamepad-læsning (standard-layout: Xbox/PlayStation).
 * Venstre stick = bevæg, højre stick = kig, RT/LT = op/ned,
 * RB = boost, LB = præcision, Y/△ = skift Drone/Byg.
 */
export interface PadState {
  connected: boolean;
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  up: number;
  down: number;
  boost: boolean;
  precision: boolean;
  toggleMode: boolean;
}

const DEAD = 0.15;
let lastToggle = false;

function dz(v: number) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * ((a - DEAD) / (1 - DEAD)) ** 1.6;
}

export function readGamepad(): PadState {
  const none: PadState = { connected: false, moveX: 0, moveY: 0, lookX: 0, lookY: 0, up: 0, down: 0, boost: false, precision: false, toggleMode: false };
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = [...pads].find((p) => p && p.connected);
  if (!pad) return none;
  const b = (i: number) => pad.buttons[i]?.value ?? 0;
  const pressed = (i: number) => !!pad.buttons[i]?.pressed;
  const toggleNow = pressed(3);
  const toggleMode = toggleNow && !lastToggle;
  lastToggle = toggleNow;
  return {
    connected: true,
    moveX: dz(pad.axes[0] ?? 0),
    moveY: dz(pad.axes[1] ?? 0),
    lookX: dz(pad.axes[2] ?? 0),
    lookY: dz(pad.axes[3] ?? 0),
    up: b(7) > 0.05 ? b(7) : 0,
    down: b(6) > 0.05 ? b(6) : 0,
    boost: pressed(5) || pressed(10),
    precision: pressed(4),
    toggleMode,
  };
}
