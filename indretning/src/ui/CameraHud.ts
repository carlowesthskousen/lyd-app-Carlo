import type { App } from '../app';
import { h } from './dom';
import { icon } from './icons';
import { DRONE_SPEED_MAX, DRONE_SPEED_MIN } from '../camera/cameraSettings';

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

/** Lille HUD i hjørnet: tilstand, højde over gulv, fart – og kort hastighedsvisning ved scroll. */
export class CameraHud {
  constructor(app: App, host: HTMLElement) {
    const bDrone = h('button', { onclick: () => app.camera.setMode('drone'), html: `${icon('drone', 16)}<span>Drone</span>`, title: 'Drone-tilstand (Tab)' });
    const bBuild = h('button', { onclick: () => app.camera.setMode('build'), html: `${icon('build', 16)}<span>Byg</span>`, title: 'Byg-kamera (Tab)' });
    const seg = h('div.segmented.small.hud-mode', {}, bDrone, bBuild);
    const alt = h('span.hud-val');
    const spd = h('span.hud-val');
    const max = h('span.hud-val');
    const flags = h('span.hud-flags');
    const legend = h('div.hud-legend');
    const legendToggle = h('button.hud-toggle', { type: 'button' }, '');
    const hud = h(
      'div.camera-hud',
      {},
      seg,
      h('div.hud-row', {}, h('span.hud-key', {}, 'Højde'), alt),
      h('div.hud-row', {}, h('span.hud-key', {}, 'Fart'), spd),
      h('div.hud-row.drone-only', {}, h('span.hud-key', {}, 'Maks'), max),
      flags,
      legendToggle,
      legend,
    );
    const LEGEND: Record<'drone' | 'build', [string, string][]> = {
      drone: [
        ['W A S D', 'flyv dertil du kigger'],
        ['Space · Shift', 'op · ned'],
        ['Træk (venstre/højre)', 'kig rundt'],
        ['Midt- / Alt+træk', 'orbit om punkt'],
        ['Q E · R F', 'drej · kig op/ned'],
        ['Ctrl · Alt', 'boost · præcision'],
        ['Scroll', 'flyvehastighed'],
        ['Klik', 'brug værktøj'],
      ],
      build: [
        ['W A S D', 'flyv vandret'],
        ['Space · C', 'op · ned'],
        ['Højreklik-træk', 'orbit om punkt'],
        ['Midterklik-træk', 'panorér'],
        ['Q E · R F', 'drej · kig op/ned'],
        ['Shift', 'boost'],
        ['Scroll', 'zoom mod musen'],
      ],
    };
    let showLegend = true;
    try {
      showLegend = localStorage.getItem('indretning:hud-legend') !== '0';
    } catch {
      /* ignorer */
    }
    const renderLegend = () => {
      legend.innerHTML = LEGEND[app.camera.mode].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('');
      legend.hidden = !showLegend;
      legendToggle.textContent = showLegend ? 'Skjul taster' : 'Vis taster';
    };
    legendToggle.addEventListener('click', () => {
      showLegend = !showLegend;
      try {
        localStorage.setItem('indretning:hud-legend', showLegend ? '1' : '0');
      } catch {
        /* ignorer */
      }
      renderLegend();
    });
    const flash = h('div.speed-flash', { 'aria-live': 'polite' });
    host.append(hud, flash);

    const syncMode = () => {
      const drone = app.camera.mode === 'drone';
      bDrone.classList.toggle('active', drone);
      bBuild.classList.toggle('active', !drone);
      hud.classList.toggle('is-drone', drone);
      renderLegend();
    };
    const sync = () => {
      const c = app.camera;
      alt.textContent = `${fmt(Math.max(0, c.position.y))} m`;
      spd.textContent = `${fmt(c.speed)} m/s`;
      max.textContent = `${fmt(c.settings.droneSpeed)} m/s`;
      const f: string[] = [];
      if (c.mode === 'drone') f.push(c.settings.wallCollision ? 'Væg-kollision til' : 'Flyv gennem vægge');
      if (c.gamepadConnected) f.push('Controller');
      flags.textContent = f.join(' · ');
    };
    let timer = 0;
    const showSpeed = () => {
      const s = app.camera.settings.droneSpeed;
      const frac = Math.log(s / DRONE_SPEED_MIN) / Math.log(DRONE_SPEED_MAX / DRONE_SPEED_MIN);
      flash.innerHTML = `<span>Flyvehastighed</span><b>${fmt(s)} m/s</b><i style="--p:${(frac * 100).toFixed(1)}%"></i>`;
      flash.classList.add('show');
      clearTimeout(timer);
      timer = window.setTimeout(() => flash.classList.remove('show'), 1100);
      sync();
    };
    app.on('camera', sync);
    app.on('cameraMode', syncMode);
    app.on('speed', showSpeed);
    syncMode();
    sync();
  }
}
