import type { Quality, Viewport } from './Viewport';

/**
 * Brugerens grafikvalg (gemmes i browseren).
 * - auto:   dynamisk opløsning – sænkes kun midlertidigt ved lav fps, mens kameraet bevæger sig
 * - sharp:  altid fuld skarphed; opløsningen sænkes aldrig automatisk
 * - normal / fast: fast 1× / 0,75×
 */
export type ResolutionMode = 'auto' | 'sharp' | 'normal' | 'fast';

/** Samlet kvalitetsniveau. "Mellem" er lavet til at holde 60 fps på en MacBook Pro (Retina, 2×). */
export type QualityPreset = 'lav' | 'mellem' | 'hoej' | 'ultra';

export interface PresetDef {
  label: string;
  ssao: boolean;
  shadowSize: number;
  /** Højeste pixel ratio (Lav: 1×). */
  maxRatio: number;
  effects: Omit<Quality, 'ssao' | 'shadowSize' | 'pixelRatio'>;
}

export const PRESETS: Record<QualityPreset, PresetDef> = {
  lav: {
    label: 'Lav',
    ssao: false,
    shadowSize: 1024,
    maxRatio: 1,
    effects: { ssaoSamples: 8, shadowSoftness: 1.5, bloom: false, smaa: false, probeSize: 64, transmission: false, msaa: 4 },
  },
  mellem: {
    label: 'Mellem',
    ssao: true,
    shadowSize: 2048,
    maxRatio: 2,
    effects: { ssaoSamples: 8, shadowSoftness: 2.5, bloom: true, smaa: true, probeSize: 128, transmission: true, msaa: 4 },
  },
  hoej: {
    label: 'Høj',
    ssao: true,
    shadowSize: 4096,
    maxRatio: 2,
    effects: { ssaoSamples: 16, shadowSoftness: 3, bloom: true, smaa: true, probeSize: 256, transmission: true, msaa: 4 },
  },
  ultra: {
    label: 'Ultra',
    ssao: true,
    shadowSize: 4096,
    maxRatio: 2,
    effects: { ssaoSamples: 24, shadowSoftness: 3.5, bloom: true, smaa: true, probeSize: 256, transmission: true, msaa: 8 },
  },
};

export interface GraphicsSettings {
  preset: QualityPreset;
  resolution: ResolutionMode;
  ssao: boolean;
  shadowSize: number;
}

const KEY = 'indretning:grafik';
const DEFAULTS: GraphicsSettings = { preset: 'mellem', resolution: 'auto', ssao: true, shadowSize: 2048 };

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GraphicsSettings>) };
  } catch {
    /* brug standard */
  }
  return { ...DEFAULTS };
}

function saveGraphicsSettings(s: GraphicsSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorer */
  }
}

/** Grænser for fps (under → sænk, over → hæv). */
const LOW_FPS = 40;
const HIGH_FPS = 55;
/** Så længe skal fps være lav/høj, før der ændres et trin (sekunder). */
const LOW_HOLD = 1.5;
const HIGH_HOLD = 2;
/** Kameraet regnes som stille efter så lang tid uden bevægelse (sekunder). */
const STILL_AFTER = 0.35;

/**
 * Dynamisk kvalitet. Ved vedvarende lav fps *mens kameraet bevæger sig*:
 * 1) SSAO slås midlertidigt fra, 2) opløsningen sænkes i små trin (fx 2 → 1,75 → 1,5).
 * Når fps er stabil over 55, hæves den trin for trin igen. Står kameraet stille,
 * renderes der altid i fuld kvalitet. Intet ændres permanent.
 * Målinger ignoreres under indlæsning, dialoger, import og lige efter fanen bliver aktiv.
 */
export class AdaptiveQuality {
  readonly settings: GraphicsSettings = loadGraphicsSettings();
  /** Antal trin, opløsningen er sænket (0 = fuld). */
  private level = 0;
  private ssaoSuppressed = false;
  /** Intern tid (s) summeret fra frame-dt, så pauser følger spillets egen tid. */
  private clock = 0;
  private pausedUntil = 0;
  private windowTime = 0;
  private windowFrames = 0;
  private lowTime = 0;
  private highTime = 0;
  private cooldown = 0;
  private stillFor = 0;
  onChange?: () => void;

  constructor(
    private viewport: Viewport,
    private isBlocked: () => boolean,
  ) {
    if (!PRESETS[this.settings.preset]) this.settings.preset = 'mellem';
    this.viewport.setQuality({ ...PRESETS[this.settings.preset].effects, shadowSize: this.settings.shadowSize });
    this.apply(false, true);
  }

  /** Fuld opløsning for den valgte tilstand. */
  fullRatio() {
    const device = Math.min(window.devicePixelRatio || 1, PRESETS[this.settings.preset].maxRatio);
    switch (this.settings.resolution) {
      case 'normal':
        return Math.min(1, device);
      case 'fast':
        return 0.75;
      default:
        return device;
    }
  }

  private ratioAt(level: number) {
    const full = this.fullRatio();
    const step = full >= 1.5 ? 0.25 : 0.125;
    const min = Math.max(0.75, full * 0.5);
    return Math.max(min, full - level * step);
  }

  private canLowerResolution() {
    return this.settings.resolution === 'auto' && this.ratioAt(this.level + 1) < this.ratioAt(this.level);
  }

  /** Ignorér fps-målinger i et stykke tid (indlæsning, fane aktiv igen …). */
  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.clock + ms / 1000);
    this.resetWindows();
  }

  private resetWindows() {
    this.windowTime = this.windowFrames = this.lowTime = this.highTime = 0;
  }

  /** Brugeren ændrer grafikindstillinger (gemmes). */
  update(patch: Partial<GraphicsSettings>) {
    if (patch.preset && patch.preset !== this.settings.preset) {
      // Et kvalitetsniveau sætter også SSAO og skygger (kan justeres bagefter)
      const p = PRESETS[patch.preset];
      patch = { ssao: p.ssao, shadowSize: p.shadowSize, ...patch };
    }
    Object.assign(this.settings, patch);
    saveGraphicsSettings(this.settings);
    // Et nyt valg starter forfra i fuld kvalitet
    this.level = 0;
    this.ssaoSuppressed = false;
    if (patch.preset) this.viewport.setQuality({ ...PRESETS[this.settings.preset].effects });
    if (patch.shadowSize) this.viewport.setQuality({ shadowSize: patch.shadowSize });
    this.pause(1500);
    this.apply(false, true);
  }

  /** Kaldes hver frame. `moving` = kameraet (eller dets animation) bevæger sig. */
  tick(dt: number, moving: boolean) {
    this.stillFor = moving ? 0 : this.stillFor + dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.clock += dt;
    if (document.hidden || this.clock < this.pausedUntil || this.isBlocked()) {
      this.resetWindows();
      this.apply(this.stillFor >= STILL_AFTER);
      return;
    }
    this.windowTime += dt;
    this.windowFrames++;
    if (this.windowTime >= 0.5) {
      const fps = this.windowFrames / this.windowTime;
      const span = this.windowTime;
      this.windowTime = this.windowFrames = 0;
      if (fps < LOW_FPS && this.stillFor < STILL_AFTER) {
        this.lowTime += span;
        this.highTime = 0;
      } else if (fps > HIGH_FPS) {
        this.highTime += span;
        this.lowTime = 0;
      } else {
        this.lowTime = 0;
        this.highTime = 0;
      }
      if (this.lowTime >= LOW_HOLD && this.cooldown <= 0) {
        this.degrade();
        this.lowTime = 0;
        this.cooldown = LOW_HOLD;
      } else if (this.highTime >= HIGH_HOLD) {
        this.improve();
        this.highTime = 0;
      }
    }
    this.apply(this.stillFor >= STILL_AFTER);
  }

  /** Først effekter (SSAO), derefter opløsning i små trin. */
  private degrade() {
    if (this.settings.ssao && !this.ssaoSuppressed) this.ssaoSuppressed = true;
    else if (this.canLowerResolution()) this.level++;
  }

  /** Omvendt rækkefølge: først opløsning op, til sidst effekterne. */
  private improve() {
    if (this.level > 0) this.level--;
    else if (this.ssaoSuppressed) this.ssaoSuppressed = false;
  }

  private lastKey = '';

  /** Vises billedet lige nu i fuld kvalitet (kameraet står stille)? */
  private showingFull = false;

  private apply(still: boolean, force = false) {
    // Står kameraet stille, er billedet altid skarpt og fuldt.
    const ratio = still ? this.fullRatio() : this.ratioAt(this.level);
    const ssao = this.settings.ssao && (still || !this.ssaoSuppressed);
    this.showingFull = still;
    const key = `${ratio}|${ssao}|${this.degraded}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.viewport.setQuality({ pixelRatio: ratio, ssao });
    this.onChange?.();
  }

  /** Er kvaliteten midlertidigt sænket (til fps-tælleren)? */
  get degraded() {
    return !this.showingFull && (this.level > 0 || this.ssaoSuppressed);
  }

  /** Kort beskrivelse til fps-tælleren, fx "opløsning 1,5× · SSAO fra". */
  get note(): string {
    const parts: string[] = [];
    if (this.showingFull) return '';
    if (this.level > 0) parts.push(`opløsning ${this.ratioAt(this.level).toString().replace('.', ',')}×`);
    if (this.ssaoSuppressed) parts.push('SSAO fra');
    return parts.join(' · ');
  }
}
