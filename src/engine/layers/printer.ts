import type { LayerConfigs } from '../config';
import type { LoadedSample } from '../types';
import { Layer, type Triggers } from './layer';
import { pick, rand, randInt, randRange } from '../random';

export interface PrintOptions {
  document?: string;
  report?: readonly string[];
}

// A dot-matrix printer, rarely. With samples it plays a stretch of a real
// print job. Without them, each line is a buzzing head moving across the page.
export class PrinterLayer extends Layer<LayerConfigs['printer']> {
  static override readonly id = 'printer';
  static override readonly bus = 'machine';
  static override readonly placed = true;
  static override readonly triggerLabels = ['PRINT'];

  busy!: boolean;
  dest!: GainNode;

  override start(): void {
    const { meanIdleSec, minIdleSec, pan } = this.cfg;
    this.busy = false;
    this.dest = this.panned(pan);
    this.events(meanIdleSec, minIdleSec, (time) => this.print(time));
  }

  override triggers(): Triggers {
    return { PRINT: (time: number) => this.print(time) };
  }

  // `report`, if given, is text to log line by line as the paper comes out.
  print(time: number, { document = pick(this.cfg.documents), report }: PrintOptions = {}): void {
    if (this.busy) return;
    this.busy = true;
    this.event(time, `PRINTING ${document}...`);
    const lines = this.engine.samples.loaded('printer', { kind: 'line' });
    if (lines.length) {
      this.printLines(time, lines, report);
      return;
    }
    report?.forEach((text, index) => this.event(time + index * 0.8, text));
    const seconds = this.printSynth(time);
    this.scheduler.at(time + seconds, (end) => {
      this.busy = false;
      this.event(end, 'PRINT JOB COMPLETE');
    });
  }

  // Line after line of real printing, with the head returning in the gaps.
  printLines(time: number, lines: LoadedSample[], report: readonly string[] | undefined): void {
    const { sample } = this.cfg;
    const { gain, pitchVary, feedGain } = sample;
    const take = pick(lines);
    const family = lines.filter(({ file }) => file.slice(0, 14) === take.file.slice(0, 14));
    let length = 0;
    const pitch = rand(1 - pitchVary, 1 + pitchVary);
    const level = gain * rand(0.85, 1.1);
    const gap = (): number => length + randRange(sample.returnSec);
    const line = (at: number, index: number): void => {
      if (report?.[index]) this.event(at, report[index]);
      length = this.playSample(at, pick(family), { gain: level, pitch, dest: this.dest });
      this.hit(at + length + 0.02, 'clunk', { gain: feedGain, pitch: 1.5, dest: this.dest });
    };
    this.series(time, report ? report.length : randInt(sample.lines), gap, line, (at) => {
      this.scheduler.at(at + length + 0.1, (end) => {
        this.busy = false;
        this.event(end, 'PRINT JOB COMPLETE');
      });
    });
  }

  printSynth(time: number): number {
    const { synth } = this.cfg;
    let at = time;
    const lines = randInt(synth.lines);
    for (let line = 0; line < lines; line += 1) {
      const seconds = randRange(synth.lineSec);
      this.headPass(at, seconds, line % 2 ? 1 : -1);
      at += seconds + synth.feedSec;
      this.hit(at - synth.feedSec * 0.5, 'clunk', { gain: synth.feedGain, pitch: 1.5, dest: this.dest });
    }
    return at - time;
  }

  // Noise chopped at the rate the print pins fire, moving across the page.
  headPass(time: number, seconds: number, direction: number): void {
    if (!this.claimVoice()) return;
    const { ctx, noise, cfg } = this;
    const { synth } = cfg;
    const source = noise.loop('pink', 1);
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: synth.bandHz, Q: synth.bandQ });
    const chop = new GainNode(ctx, { gain: 0.5 });
    const pins = new OscillatorNode(ctx, { type: 'square', frequency: synth.pinHz });
    const amp = new GainNode(ctx, { gain: 0 });
    const panner = new StereoPannerNode(ctx);
    pins.connect(chop.gain);
    source.connect(band).connect(chop).connect(amp).connect(panner).connect(this.dest);
    panner.pan.setValueAtTime(-direction * synth.travel, time);
    panner.pan.linearRampToValueAtTime(direction * synth.travel, time + seconds);
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(synth.gain, time + 0.01);
    amp.gain.setValueAtTime(synth.gain, time + seconds - 0.01);
    amp.gain.linearRampToValueAtTime(0, time + seconds);
    pins.start(time);
    pins.stop(time + seconds);
    source.stop(time + seconds + 0.01);
    this.releaseOnEnd(pins, [pins, chop, band, amp, panner, source]);
  }
}
