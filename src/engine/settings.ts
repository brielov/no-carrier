import type { Settings } from './types';

const KEY = 'no-carrier-settings';
const RADIO_PARTS = ['morse', 'teleprinter', 'carrier', 'broadcast', 'timesignal'];

// Untrusted data, read field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: unknown, fallback: number): number =>
  isNumber(value) ? Math.min(1, Math.max(0, value)) : fallback;

// Build valid settings from untrusted data (storage or an imported file), by
// walking the known settings: unknown fields are dropped, bad ones keep `base`.
export function sanitize(raw: unknown, base: Settings): Settings {
  const data: Raw = raw && typeof raw === 'object' ? raw : {};
  const result = structuredClone(base);
  result.master = clamp(data.master, base.master);
  if (data.mains === 50 || data.mains === 60) result.mains = data.mains;
  if (typeof data.drift === 'boolean') result.drift = data.drift;
  if (typeof data.showLog === 'boolean') result.showLog = data.showLog;
  if (typeof data.showDiag === 'boolean') result.showDiag = data.showDiag;
  if (typeof data.driveModel === 'string') result.models.drive = data.driveModel; // older saves
  for (const [id, { pan, dist }] of Object.entries(base.positions)) {
    const saved = data.positions?.[id];
    const safePan = isNumber(saved?.pan) ? Math.min(1, Math.max(-1, saved.pan)) : pan;
    result.positions[id] = { pan: safePan, dist: clamp(saved?.dist, dist) };
  }
  for (const id of Object.keys(base.models)) {
    if (typeof data.models?.[id] === 'string') result.models[id] = data.models[id];
  }
  if (typeof data.preset === 'string' || data.preset === null) result.preset = data.preset;
  for (const name of Object.keys(base.macros)) {
    result.macros[name] = clamp(data.macros?.[name], base.macros[name]);
  }
  for (const [id, layer] of Object.entries(base.layers)) {
    // Older saves had one SIGNAL SEARCH layer for all of these.
    const saved = data.layers?.[id] ?? (RADIO_PARTS.includes(id) ? data.layers?.signal : undefined);
    result.layers[id].level = clamp(saved?.level, layer.level);
    result.layers[id].rate = clamp(saved?.rate, layer.rate);
    if (typeof saved?.muted === 'boolean') result.layers[id].muted = saved.muted;
  }
  return result;
}

// Storage can be missing or refuse, so neither of these may ever throw.
export function loadSettings(base: Settings): Settings {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? sanitize(JSON.parse(saved), base) : base;
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Settings just won't survive a reload.
  }
}

export function downloadSettings(settings: Settings): void {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'no-carrier-settings.json';
  link.click();
  URL.revokeObjectURL(link.href);
}
