import type { Engine } from '../engine/engine';

const MAX_LOG_LINES = 200;

export interface LogLine {
  id: number;
  text: string;
  fault: boolean;
}

export const clock = (seconds: number): string => {
  const s = Math.floor(seconds);
  const part = (n: number): string => String(n).padStart(2, '0');
  return `${part(Math.floor(s / 3600))}:${part(Math.floor(s / 60) % 60)}:${part(s % 60)}`;
};

// The bridge between the engine, which knows nothing of Svelte, and the
// console. The engine's settings are a plain object it changes itself, so
// anything reading them goes through read(), which ties the reading to the
// engine's change signal.
export class Console {
  readonly engine: Engine;
  log = $state<LogLine[]>([]);
  // Once a second, for clocks and countdowns.
  second = $state(0);
  private changes = $state(0);
  private nextLine = 0;
  private readonly lamps = new Map<string, Set<HTMLElement>>();

  constructor(engine: Engine) {
    this.engine = engine;
    engine.onChange(() => {
      this.changes += 1;
    });
    engine.on(({ layer, message }) => {
      this.write(message);
      this.flash(layer);
    });
    engine.onFlash((layer) => this.flash(layer));
    setInterval(() => {
      this.second += 1;
    }, 1000);
  }

  // Read engine state reactively: reruns whenever the engine reports a change.
  read<T>(get: () => T): T {
    void this.changes;
    return get();
  }

  write(message: string): void {
    const fault = message.startsWith('FAULT') || message.startsWith('IMPORT FAILED');
    const lines = [...this.log, { id: this.nextLine++, text: `> ${message}`, fault }];
    this.log = lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES) : lines;
  }

  // An attachment for a lamp's glow: it blinks for each sound of its layer.
  lamp(id: string) {
    return (glow: HTMLElement) => {
      const set = this.lamps.get(id) ?? new Set();
      this.lamps.set(id, set.add(glow));
      return () => set.delete(glow);
    };
  }

  // A lamp is a real indicator: it blinks for each sound, not on a loop.
  private flash(id: string): void {
    if (document.hidden) return;
    for (const glow of this.lamps.get(id) ?? []) {
      glow.getAnimations().forEach((animation) => animation.cancel());
      glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
    }
  }
}
