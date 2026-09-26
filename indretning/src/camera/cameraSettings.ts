/** Kameraindstillinger. De følger brugeren (ikke projektet) og gemmes i browseren. */
export type CameraMode = 'build' | 'drone';

export interface CameraSettings {
  mode: CameraMode;
  /** Musefølsomhed (1 = standard). */
  sensitivity: number;
  /** Dronens flyvehastighed i m/s (justeres med scroll). */
  droneSpeed: number;
  /** Byggekameraets hastighedsfaktor. */
  buildSpeed: number;
  /** 0 = stram (stopper med det samme), 1 = flydende (glider langt). */
  glide: number;
  invertY: boolean;
  /** Let krængning, når dronen flyver sidelæns eller drejer. */
  bank: boolean;
  /** Dronen kan ikke flyve gennem vægge (døre og vinduer er åbne). */
  wallCollision: boolean;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  mode: 'build',
  sensitivity: 1,
  droneSpeed: 4,
  buildSpeed: 1,
  glide: 0.5,
  invertY: false,
  bank: true,
  wallCollision: true,
};

export const DRONE_SPEED_MIN = 0.3;
export const DRONE_SPEED_MAX = 60;

const KEY = 'indretning:camera';

export function loadCameraSettings(): CameraSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_CAMERA_SETTINGS, ...(JSON.parse(raw) as Partial<CameraSettings>) };
  } catch {
    /* ingen lagring tilgængelig – brug standard */
  }
  return { ...DEFAULT_CAMERA_SETTINGS };
}

export function saveCameraSettings(s: CameraSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorer */
  }
}
