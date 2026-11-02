// Each preset lists only what it changes. Anything left out returns to its
// default, so a preset always sounds the same whatever came before it.
//
// macros are 0..1. In layers, level is the volume knob and rate the RATE knob
// (0.5 is normal).
export const PRESETS = {
  'NIGHT SHIFT': {
    macros: { distance: 0.36, age: 0.14, activity: 0.38, signal: 0.28 },
    layers: {
      keyboard: { level: 0.52 },
      printer: { level: 0.45 },
    },
  },
  SEARCHING: {
    macros: { distance: 0.28, age: 0.12, activity: 0.36, signal: 0.68 },
    layers: {
      morse: { level: 0.6 },
      carrier: { level: 0.58 },
      broadcast: { level: 0.66, rate: 0.62 },
      drive: { level: 0.26 },
      tape: { level: 0.42 },
    },
  },
  'DATA RUN': {
    macros: { distance: 0.14, age: 0.08, activity: 0.86, signal: 0.2 },
    layers: {
      drive: { level: 0.38 },
      tape: { rate: 0.6 },
      printer: { rate: 0.72 },
      modem: { rate: 0.7 },
    },
  },
  'DEEP SPACE': {
    macros: { distance: 0.5, age: 0.1, activity: 0.14, signal: 0.42 },
    layers: {
      hum: { level: 0.42 },
      air: { level: 0.22 },
      beeps: { level: 0.4 },
      keyboard: { rate: 0.25 },
      drone: { level: 0.62 },
    },
  },
};

export type PresetName = keyof typeof PRESETS;
