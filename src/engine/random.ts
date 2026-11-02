import type { Range, WalkRange } from './types';

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);
export const randRange = ({ min, max }: Range): number => rand(min, max);
export const chance = (p: number): boolean => Math.random() < p;
export const randInt = ({ min, max }: Range): number => Math.floor(rand(min, max + 1));
export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

// Standard normal, via Box-Muller.
export function gauss(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Many small independent delays multiply: human timing looks like this.
export const logNormal = ({ median, spread }: { median: number; spread: number }): number =>
  median * Math.exp(spread * gauss());

// Scatter a gain by up to ±db.
export const varyDb = (gain: number, db: number): number => gain * 10 ** (rand(-db, db) / 20);

// Unit-mean exponential, the gap between events of a Poisson process.
export const exponential = (): number => -Math.log(1 - Math.random());

// Slow random walk that keeps returning to the middle of its range
// (an Ornstein-Uhlenbeck process). Unlike an LFO it has no period to notice.
export class Walk {
  readonly min: number;
  readonly max: number;
  readonly tau: number;
  readonly mean: number;
  readonly spread: number;
  value: number;

  constructor({ min, max, tauSec }: WalkRange) {
    this.min = min;
    this.max = max;
    this.tau = tauSec;
    this.mean = (min + max) / 2;
    this.spread = (max - min) / 4; // ±2 spreads fill the range
    this.value = rand(min, max);
  }

  step(dt: number): number {
    const pull = (this.mean - this.value) * (dt / this.tau);
    const push = this.spread * Math.sqrt((2 * dt) / this.tau) * gauss();
    let next = this.value + pull + push;
    // Reflect off the edges instead of sticking to them.
    if (next > this.max) next = 2 * this.max - next;
    if (next < this.min) next = 2 * this.min - next;
    this.value = Math.min(this.max, Math.max(this.min, next));
    return this.value;
  }
}
