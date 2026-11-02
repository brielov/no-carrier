import { exponential } from './random';

type TimedFn = (time: number) => void;

interface Task {
  time: number;
  fn: TimedFn;
}

interface Process {
  meanGap: () => number;
  minGap: () => number;
  fn: TimedFn;
  cursor: number;
  budget: number;
}

interface Notice {
  time: number;
  fn: () => void;
}

export interface SchedulerStats {
  ticks: number;
  fired: number;
  maxGapSec: number;
  starved: number;
}

// The scheduler reads only the clock, so a stand-in clock works too.
export interface Clock {
  readonly currentTime: number;
  readonly outputLatency?: number;
}

// Lookahead scheduler. A timer wakes up often, and anything due within the
// lookahead window is handed the exact audio-clock time it should happen at.
// The timer only decides *when to plan*; sound timing comes from the audio clock.
export class Scheduler {
  readonly ctx: Clock;
  readonly tickMs: number;
  readonly lookahead: number;
  tasks: Task[] = [];
  readonly processes: Process[] = [];
  notices: Notice[] = [];
  lastTick: number | null = null;
  readonly stats: SchedulerStats = { ticks: 0, fired: 0, maxGapSec: 0, starved: 0 };
  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly onTick = (): void => this.tick();

  constructor(ctx: Clock, { tickMs, lookaheadSec }: { tickMs: number; lookaheadSec: number }) {
    this.ctx = ctx;
    this.tickMs = tickMs;
    this.lookahead = lookaheadSec;
  }

  start(): void {
    this.lastTick = null;
    if (!this.worker && !this.interval) this.openClock();
    this.worker?.postMessage({ tickMs: this.tickMs });
    this.tick();
  }

  stop(): void {
    this.worker?.postMessage({ tickMs: 0 });
  }

  private openClock(): void {
    try {
      this.worker = new Worker(new URL('./timer-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = this.onTick;
    } catch {
      this.worker = null;
      this.interval = setInterval(this.onTick, this.tickMs);
    }
  }

  // Run fn(time) once at an audio-clock time.
  at(time: number, fn: TimedFn): void {
    this.tasks.push({ time, fn });
  }

  // Run fn(time, dt) repeatedly. gap() returns the seconds until the next run.
  every(gap: () => number, fn: (time: number, dt: number) => void, startTime = this.ctx.currentTime): void {
    let previous = startTime;
    const run = (time: number): void => {
      fn(time, time - previous);
      previous = time;
      this.at(time + gap(), run);
    };
    this.at(startTime + gap(), run);
  }

  // Random events with exponential gaps, like radioactive decay or a busy
  // switchboard. Instead of drawing the next event time up front, this spends
  // a random budget at the current rate. That way, turning a rate knob takes
  // effect immediately, even for events that are minutes apart.
  poisson({ meanGap, minGap, fn }: { meanGap: () => number; minGap: () => number; fn: TimedFn }): void {
    this.processes.push({ meanGap, minGap, fn, cursor: this.ctx.currentTime, budget: exponential() });
  }

  // Run fn when audio placed at `time` is reaching the speakers. For UI only.
  notify(time: number, fn: () => void): void {
    this.notices.push({ time, fn });
  }

  tick(): void {
    const now = this.ctx.currentTime;
    const horizon = now + this.lookahead;

    if (this.lastTick !== null) {
      const gap = now - this.lastTick;
      this.stats.maxGapSec = Math.max(this.stats.maxGapSec, gap);
      if (gap > this.lookahead) this.stats.starved += 1;
    }
    this.lastTick = now;
    this.stats.ticks += 1;

    this.runTasks(now, horizon);
    for (const process of this.processes) this.advance(process, now, horizon);
    this.runTasks(now, horizon); // anything the events just planned
    this.flushNotices(now);
  }

  private runTasks(now: number, horizon: number): void {
    for (;;) {
      let next = -1;
      for (let i = 0; i < this.tasks.length; i += 1) {
        const { time } = this.tasks[i];
        if (time < horizon && (next < 0 || time < this.tasks[next].time)) next = i;
      }
      if (next < 0) return;
      const [task] = this.tasks.splice(next, 1);
      task.fn(Math.max(task.time, now)); // after a stall, skip ahead rather than pile up
      this.stats.fired += 1;
    }
  }

  private advance(process: Process, now: number, horizon: number): void {
    process.cursor = Math.max(process.cursor, now);
    while (process.cursor < horizon) {
      const rate = 1 / process.meanGap();
      const window = horizon - process.cursor;
      const needed = rate > 0 ? process.budget / rate : Infinity;
      if (needed > window) {
        process.budget -= rate * window;
        process.cursor = horizon;
        return;
      }
      const time = process.cursor + needed;
      process.fn(time);
      this.stats.fired += 1;
      process.cursor = time + process.minGap();
      process.budget = exponential();
    }
  }

  private flushNotices(now: number): void {
    const heard = now - (this.ctx.outputLatency || 0);
    const pending: Notice[] = [];
    for (const notice of this.notices) {
      if (notice.time <= heard) notice.fn();
      else pending.push(notice);
    }
    this.notices = pending;
  }
}
