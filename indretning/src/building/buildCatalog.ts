import type { FloorMaterial, OpeningKind, WallMaterial } from '../state/types';

export type OpeningVariant = 'panel' | 'glass' | 'double' | 'window' | 'window-split' | 'panorama';

export interface OpeningStyle {
  id: string;
  name: string;
  kind: OpeningKind;
  width: number;
  height: number;
  sill: number;
  variant: OpeningVariant;
}

export const OPENING_STYLES: OpeningStyle[] = [
  { id: 'door-80', name: 'Hvid dør 80', kind: 'door', width: 0.8, height: 2.05, sill: 0, variant: 'panel' },
  { id: 'door-90', name: 'Hvid dør 90', kind: 'door', width: 0.9, height: 2.05, sill: 0, variant: 'panel' },
  { id: 'door-glass', name: 'Glasdør', kind: 'door', width: 0.9, height: 2.1, sill: 0, variant: 'glass' },
  { id: 'door-double', name: 'Fløjdør 140', kind: 'door', width: 1.4, height: 2.1, sill: 0, variant: 'double' },
  { id: 'door-opening', name: 'Åbning (uden dør)', kind: 'door', width: 1.0, height: 2.1, sill: 0, variant: 'panel' },
  { id: 'win-60', name: 'Vindue 60×60', kind: 'window', width: 0.6, height: 0.6, sill: 1.3, variant: 'window' },
  { id: 'win-100', name: 'Vindue 100×120', kind: 'window', width: 1.0, height: 1.2, sill: 0.9, variant: 'window' },
  { id: 'win-160', name: 'Sprossevindue 160×120', kind: 'window', width: 1.6, height: 1.2, sill: 0.9, variant: 'window-split' },
  { id: 'win-pano', name: 'Panoramavindue 240', kind: 'window', width: 2.4, height: 2.1, sill: 0.1, variant: 'panorama' },
];

export const openingStyle = (id: string) => OPENING_STYLES.find((s) => s.id === id) ?? OPENING_STYLES[1];

export interface MaterialPreset<T> {
  id: string;
  name: string;
  value: T;
}

export const FLOOR_PRESETS: MaterialPreset<FloorMaterial>[] = [
  { id: 'eg', name: 'Egeplank', value: { type: 'wood', color: '#c8a27a' } },
  { id: 'eg-hvid', name: 'Hvidolieret eg', value: { type: 'wood', color: '#e6d6bf' } },
  { id: 'valnod', name: 'Valnød', value: { type: 'wood', color: '#8a5f40' } },
  { id: 'fliser-hvid', name: 'Hvide fliser', value: { type: 'tiles', color: '#f2f0ec' } },
  { id: 'fliser-graa', name: 'Grå klinker', value: { type: 'tiles', color: '#9a9893' } },
  { id: 'terracotta', name: 'Terracotta', value: { type: 'tiles', color: '#c07a55' } },
  { id: 'beton', name: 'Poleret beton', value: { type: 'concrete', color: '#bdbab4' } },
  { id: 'beton-mork', name: 'Mørk beton', value: { type: 'concrete', color: '#76746f' } },
  { id: 'taeppe-sand', name: 'Tæppe, sand', value: { type: 'carpet', color: '#cfc4b0' } },
  { id: 'taeppe-bla', name: 'Tæppe, blå', value: { type: 'carpet', color: '#4d6488' } },
];

export const WALL_PRESETS: MaterialPreset<WallMaterial>[] = [
  { id: 'hvid', name: 'Kalkhvid', value: { type: 'paint', color: '#f1ede6' } },
  { id: 'gra', name: 'Varm grå', value: { type: 'paint', color: '#c9c3b9' } },
  { id: 'salvie', name: 'Salviegrøn', value: { type: 'paint', color: '#a9b59c' } },
  { id: 'dueblaa', name: 'Dueblå', value: { type: 'paint', color: '#9fb2c2' } },
  { id: 'okker', name: 'Okker', value: { type: 'paint', color: '#d9b36c' } },
  { id: 'rosa', name: 'Støvet rosa', value: { type: 'paint', color: '#d8b2a6' } },
  { id: 'antracit', name: 'Antracit', value: { type: 'paint', color: '#4b4d50' } },
  { id: 'mursten', name: 'Røde mursten', value: { type: 'brick', color: '#c7735a' } },
  { id: 'mursten-gul', name: 'Gule mursten', value: { type: 'brick', color: '#dcc28f' } },
  { id: 'mursten-hvid', name: 'Hvidmalet mur', value: { type: 'brick', color: '#efece6' } },
  { id: 'puds', name: 'Puds', value: { type: 'plaster', color: '#e8e1d6' } },
  { id: 'puds-terra', name: 'Kalkpuds, terra', value: { type: 'plaster', color: '#c99a7e' } },
];
