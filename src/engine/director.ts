import type { Config } from './config';
import type { Engine } from './engine';
import type { Settings } from './types';
import { PRESETS, type PresetName } from './presets';
import { Walk } from './random';

type Flat = Record<string, number>;

interface Morph {
  from: Flat;
  to: Flat;
  start: number;
  seconds: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smooth = (t: number): number => t * t * (3 - 2 * t);

function flatten(settings: Settings): Flat {
  const flat: Flat = { master: settings.master };
  for (const [name, value] of Object.entries(settings.macros)) flat[`macros.${name}`] = value;
  for (const [id, { level, rate }] of Object.entries(settings.layers)) {
    flat[`layers.${id}.level`] = level;
    flat[`layers.${id}.rate`] = rate;
  }
  return flat;
}

// Everything that moves the controls by itself: crossfades, auto drift and the
// sleep timer. It steps on the audio clock, so it keeps going in background
// tabs. Macros are held as a base value plus a drift offset, which lets a
// crossfade and the drift both act on the same knob. A person touching a
// control always wins over anything in progress.
export class Director {
  readonly engine: Engine;
  readonly cfg: Config['director'];
  base: Record<string, number>;
  readonly offsets: Record<string, number> = {};
  readonly walks: Record<string, Walk> = {};
  morph: Morph | null = null;
  sleepEnd: number | null = null;
  private lastStep: number | null = null;
  private lastWalk: number | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
    this.cfg = engine.cfg.director;
    this.base = { ...engine.settings.macros };
    for (const [name, range] of Object.entries(this.cfg.drift.ranges)) {
      this.offsets[name] = 0;
      this.walks[name] = new Walk(range);
      this.walks[name].value = 0;
    }
  }

  attach(): void {
    const { scheduler } = this.engine;
    scheduler.every(() => this.cfg.stepSec, () => this.step());
  }

  // Settings replaced before power on, from storage.
  sync(): void {
    this.base = { ...this.engine.settings.macros };
  }

  // A control moved by hand.
  touch(path: string, value: number): void {
    const { engine, morph } = this;
    if (morph) delete morph.to[path];
    const [group, name] = path.split('.');
    if (group === 'macros') {
      this.base[name] = value;
      if (name in this.offsets) {
        this.offsets[name] = 0;
        this.walks[name].value = 0;
      }
    }
    engine.setValue(path, value);
    engine.settings.preset = null;
    engine.notifyChange();
  }

  preset(name: PresetName): void {
    const { macros = {}, layers = {} }: { macros?: Record<string, number>; layers?: Record<string, Partial<Settings['layers'][string]>> } = PRESETS[name];
    const { defaults, settings } = this.engine;
    const target = structuredClone(defaults);
    target.master = settings.master;
    Object.assign(target.macros, macros);
    for (const [id, values] of Object.entries(layers)) Object.assign(target.layers[id], values);
    this.goTo(target, name, this.cfg.crossfadeSec);
    this.engine.report(`PROFILE ${name}`);
  }

  reset(): void {
    const target = structuredClone(this.engine.defaults);
    target.master = this.engine.settings.master;
    this.goTo(target, null, this.cfg.crossfadeSec);
    this.engine.report('PROFILE DEFAULT');
  }

  // Move to target settings, crossfading if there is sound to crossfade.
  goTo(target: Settings, name: string | null, seconds: number): void {
    const { engine } = this;
    const from = flatten(engine.settings);
    const to = flatten(target);
    engine.settings.preset = name;
    if (engine.powered) {
      this.morph = { from, to, start: engine.audio.currentTime, seconds };
    } else {
      this.morph = null;
      for (const [path, value] of Object.entries(to)) this.place(path, value);
      this.applyMacros();
    }
    engine.notifyChange();
  }

  place(path: string, value: number): void {
    if (path.startsWith('macros.')) this.base[path.slice(7)] = value;
    else this.engine.setValue(path, value);
  }

  setDrift(on: boolean): void {
    this.engine.settings.drift = on;
    this.engine.report(`AUTO DRIFT ${on ? 'ON' : 'OFF'}`);
    this.engine.notifyChange();
  }

  setSleep(minutes: number): void {
    const { engine } = this;
    if (!minutes) {
      if (this.sleepEnd !== null) engine.report('SLEEP TIMER CANCELLED');
      this.cancelSleep();
      engine.notifyChange();
      return;
    }
    if (!engine.powered) {
      engine.report('SLEEP TIMER NEEDS POWER ON');
      engine.notifyChange();
      return;
    }
    const { fadeSec } = this.cfg.sleep;
    const now = engine.audio.currentTime;
    this.sleepEnd = now + minutes * 60;
    const { gain } = engine.master.sleep;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(1, now, 0.1);
    gain.setTargetAtTime(0, Math.max(now, this.sleepEnd - fadeSec), fadeSec / 5);
    engine.report(`SLEEP TIMER ${minutes} MIN`);
    engine.notifyChange();
  }

  cancelSleep(): void {
    this.sleepEnd = null;
    const { ctx, master } = this.engine;
    if (!ctx) return;
    const now = ctx.currentTime;
    master.sleep.gain.cancelScheduledValues(now);
    master.sleep.gain.setTargetAtTime(1, now, 0.5);
  }

  sleepRemaining(): number | null {
    return this.sleepEnd === null ? null : Math.max(0, this.sleepEnd - this.engine.audio.currentTime);
  }

  step(): void {
    const { engine } = this;
    if (!engine.powered) return;
    const now = engine.audio.currentTime;
    const dt = this.lastStep === null ? 0 : now - this.lastStep;
    this.lastStep = now;
    let changed = false;

    if (this.morph) {
      const { from, to, start, seconds } = this.morph;
      const done = (now - start) / seconds >= 1;
      const t = smooth(Math.min(1, (now - start) / seconds));
      for (const [path, value] of Object.entries(to)) {
        if (from[path] !== value) this.place(path, from[path] + (value - from[path]) * t);
      }
      if (done) this.morph = null;
      changed = true;
    }

    if (this.moveOffsets(now, dt)) changed = true;
    if (this.applyMacros()) changed = true;

    if (this.sleepEnd !== null && now >= this.sleepEnd) {
      engine.report('SLEEP TIMER EXPIRED');
      engine.powerOff();
      changed = true;
    }
    if (changed) engine.notifyChange();
  }

  // Drift steps once a second or so. Switched off, offsets ease back to zero.
  moveOffsets(now: number, dt: number): boolean {
    const { settings } = this.engine;
    const { drift } = this.cfg;
    if (settings.drift) {
      if (this.lastWalk !== null && now - this.lastWalk < drift.stepSec) return false;
      const elapsed = this.lastWalk === null ? 0 : now - this.lastWalk;
      this.lastWalk = now;
      for (const [name, walk] of Object.entries(this.walks)) this.offsets[name] = walk.step(elapsed);
      return true;
    }
    this.lastWalk = null;
    const keep = Math.exp(-dt / drift.releaseTc);
    let moving = false;
    for (const name of Object.keys(this.offsets)) {
      if (Math.abs(this.offsets[name]) > 0.001) {
        this.offsets[name] *= keep;
        this.walks[name].value = this.offsets[name];
        moving = true;
      } else {
        this.offsets[name] = 0;
      }
    }
    return moving;
  }

  applyMacros(): boolean {
    const { engine } = this;
    let changed = false;
    for (const [name, base] of Object.entries(this.base)) {
      const value = clamp01(base + (this.offsets[name] ?? 0));
      if (Math.abs(value - engine.settings.macros[name]) > 0.0005) {
        engine.setMacro(name, value);
        changed = true;
      }
    }
    return changed;
  }
}
