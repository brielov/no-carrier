// Shapes shared across the engine.

export interface Range {
  min: number;
  max: number;
}

// A slow random walk between min and max. tauSec: how long it takes to forget.
export interface WalkRange extends Range {
  tauSec: number;
}

export interface LayerSettings {
  level: number;
  muted: boolean;
  rate: number;
}

export interface Position {
  pan: number;
  dist: number;
}

export interface Settings {
  master: number;
  macros: Record<string, number>;
  mains: 50 | 60;
  layers: Record<string, LayerSettings>;
  positions: Record<string, Position>;
  models: Record<string, string>;
  preset: string | null;
  drift: boolean;
  showLog: boolean;
  showDiag: boolean;
}

// One file from samples/manifest.json, with its audio once decoded.
export interface SampleEntry {
  file: string;
  kind: string;
  model?: string;
  speaker?: string;
  text?: string;
  mhz?: string;
  lazy?: boolean;
  buffer?: AudioBuffer;
  loading?: Promise<boolean>;
}

// A sample entry known to have its audio.
export type LoadedSample = SampleEntry & { buffer: AudioBuffer };

export interface EngineEvent {
  layer: string;
  message: string;
}
