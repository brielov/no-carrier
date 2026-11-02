// The Halcyon's side of the story: its day count, and the small notes its log
// prints now and then. Progress is kept in the browser and can never fail the
// app: if storage is unavailable, the story simply starts fresh each visit.
const KEY = 'no-carrier-story';
const DAY_MS = 86400000;

import type { Config } from './config';
import type { Engine } from './engine';
import type { SampleEntry } from './types';

export interface StoryState {
  firstSeen: number;
  heard: string[];
  attempts?: number;
}

const format = (n: number): string => n.toLocaleString('en-US');

function load(): StoryState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as StoryState | null;
    if (saved && Number.isFinite(saved.firstSeen) && Array.isArray(saved.heard)) return saved;
  } catch {
    // Start fresh.
  }
  return { firstSeen: Date.now(), heard: [], attempts: 0 };
}

export class Story {
  readonly engine: Engine;
  readonly cfg: Config['story'];
  state: StoryState;
  private recent: string[] = [];

  constructor(engine: Engine) {
    this.engine = engine;
    this.cfg = engine.cfg.story;
    this.state = load();
    this.save();
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Progress just won't survive a reload.
    }
  }

  // The mission clock, which keeps running between visits.
  day(): number {
    return this.cfg.halcyonDay + Math.floor((Date.now() - this.state.firstSeen) / DAY_MS);
  }

  // Days since home last answered, which is what Relay Lima counts.
  limaSilence(): number {
    return this.day() - this.cfg.homeSilentSince;
  }

  // Every scan is another call into the dark. The count only ever goes up.
  attempt(): void {
    this.state.attempts = (this.state.attempts ?? 0) + 1;
    if (this.state.attempts % 10 === 0) this.save();
  }

  attempts(): number {
    return this.cfg.attemptsBefore + (this.state.attempts ?? 0);
  }

  // Printed once each time the Halcyon comes up. Plain and dependable.
  dailyReport(time: number): void {
    const total = this.engine.samples.find('signal', { kind: 'broadcast' }).length;
    const report = [
      'HALCYON DAILY REPORT',
      `MISSION DAY ${format(this.day())}`,
      `DAYS SINCE LAST CONTACT WITH HOME ${format(this.limaSilence())}`,
      `COMMUNICATION ATTEMPTS ${format(this.attempts())}`,
      'SUCCESSFUL CONTACTS 0',
      'UNKNOWN SIGNALS 1',
      `MERIDIAN TRANSMISSIONS LOGGED ${this.state.heard.length} OF ${total}`,
      'ALL SYSTEMS NOMINAL',
    ];
    const printer = this.engine.layer('printer');
    if (printer) printer.print(time, { document: 'DAILY REPORT', report });
    else report.forEach((text, index) => this.engine.emitEvent('system', time + index * 0.8, text));
  }

  // A transmission was heard through to its end: log it in the archive.
  heard(id: string): void {
    if (this.state.heard.includes(id)) return;
    this.state.heard.push(id);
    this.save();
  }

  // Prefer transmissions not heard lately, so the story keeps unfolding.
  choose<T extends SampleEntry>(takes: T[]): T {
    const id = (take: T): string => take.file;
    const fresh = takes.filter((take) => !this.recent.includes(id(take)));
    const unheard = fresh.filter((take) => !this.state.heard.includes(id(take)));
    const pool = unheard.length && Math.random() < this.cfg.unheardBias ? unheard : fresh.length ? fresh : takes;
    // Some voices are rarer than others: the ground most of all.
    const weights: Record<string, number> = this.cfg.speakerWeights;
    const weight = (take: T): number => weights[take.speaker ?? ''] ?? 1;
    let roll = Math.random() * pool.reduce((sum, take) => sum + weight(take), 0);
    const take = pool.find((entry) => (roll -= weight(entry)) < 0) ?? pool[pool.length - 1];
    this.recent.push(id(take));
    if (this.recent.length > Math.floor(takes.length * this.cfg.recentShare)) this.recent.shift();
    return take;
  }

  start(): void {
    const { meanIdleSec, minIdleSec } = this.cfg.notes;
    this.engine.scheduler.poisson({
      meanGap: () => (this.engine.operating ? meanIdleSec : Infinity),
      minGap: () => minIdleSec,
      fn: (time) => this.note(time),
    });
  }

  // The first thing the log says once the receiver is up.
  greet(time: number): void {
    this.engine.emitEvent('system', time, `HALCYON DAY ${format(this.day())}`);
  }

  note(time: number): void {
    const total = this.engine.samples.find('signal', { kind: 'broadcast' }).length;
    const lines = this.cfg.notes.lines.map((line) =>
      line
        .replace('{day}', format(this.day()))
        .replace('{lima}', format(this.limaSilence()))
        .replace('{heard}', String(this.state.heard.length))
        .replace('{total}', String(total))
        .replace('{attempts}', format(this.attempts())),
    );
    this.engine.emitEvent('system', time, lines[Math.floor(Math.random() * lines.length)]);
  }
}
