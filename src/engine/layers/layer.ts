import type { Engine } from '../engine';
import type { NoiseBank } from '../noise';
import type { Scheduler } from '../scheduler';
import type { LoadedSample, WalkRange } from '../types';
import { Placement } from '../effects';
import { Walk, exponential, pick, rand } from '../random';

export type BusName = 'machine' | 'room' | 'outside' | 'sky';
import type { RecipeName } from '../recipes';

// What every layer's settings in config.ts have in common.
export interface LayerConfig {
  label: string;
  defaultLevel: number;
  maxGain: number;
  position?: { pan: number; dist: number };
  models?: readonly { id: string; label: string }[];
  defaultModel?: string;
}

// A layer class: what the engine needs before making one.
export interface LayerClass {
  new (engine: Engine, id: string, bus: AudioNode): Layer;
  readonly id: string;
  readonly bus: BusName;
  readonly placed: boolean;
  readonly triggerLabels: readonly string[];
}

export type Triggers = Record<string, (time: number) => void>;

interface StrikeShape {
  peak: number;
  attackSec?: number;
  holdSec?: number;
  decay: number;
}

export interface SampleOptions {
  gain?: number;
  pitch?: number;
  dest?: AudioNode;
  offset?: number;
  duration?: number;
  fadeSec?: number;
  lowpassHz?: number;
}

export interface ToneOptions {
  hz: number;
  gain: number;
  decay: number;
  attackSec?: number;
  holdSec?: number;
  from?: number;
  wave?: OscillatorType;
  lowpassHz?: number;
  dest?: AudioNode;
}

// Shape a gain into a strike: quick rise, optional hold, exponential fall, and
// a final touch down to true zero. Returns the end time.
function strike(param: AudioParam, time: number, { peak, attackSec = 0.001, holdSec = 0, decay }: StrikeShape): number {
  const top = time + attackSec;
  const fall = top + holdSec;
  const end = fall + decay;
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, top);
  param.setValueAtTime(peak, fall);
  param.exponentialRampToValueAtTime(peak * 0.001, end);
  param.linearRampToValueAtTime(0, end + 0.002);
  return end + 0.002;
}

export class Layer<C extends LayerConfig = LayerConfig> {
  static readonly id: string;
  static readonly bus: BusName;
  static readonly placed: boolean = false;
  static readonly triggerLabels: readonly string[] = [];

  readonly engine: Engine;
  readonly id: string;
  readonly ctx: BaseAudioContext;
  readonly scheduler: Scheduler;
  readonly noise: NoiseBank;
  readonly cfg: C;
  readonly output: GainNode;
  readonly mains: GainNode;
  readonly placement?: Placement;

  constructor(engine: Engine, id: string, bus: AudioNode) {
    this.engine = engine;
    this.id = id;
    this.ctx = engine.audio;
    this.scheduler = engine.scheduler;
    this.noise = engine.noise;
    this.cfg = (engine.cfg.layers as Record<string, LayerConfig>)[id] as C;
    this.output = new GainNode(this.ctx, { gain: this.targetGain() });
    this.mains = new GainNode(this.ctx); // this machine's own power switch
    this.output.connect(this.mains);
    if ((this.constructor as LayerClass).placed) {
      this.placement = new Placement(this.ctx, engine.cfg.effects.placement, bus, engine.buses.room);
      this.mains.connect(this.placement.input);
      this.applyPosition(0.01);
    } else {
      this.mains.connect(bus);
    }
  }

  // Start the layer's sounds and events. Runs once, when the graph is built.
  start(): void {}

  // Play something typical of the chosen model, so it can be heard.
  previewModel(_time: number): void {}

  switchPower(level: number, time: number, tc: number): void {
    this.mains.gain.cancelScheduledValues(time);
    this.mains.gain.setTargetAtTime(level, time, tc);
  }

  applyPosition(tc: number): void {
    this.placement?.apply(this.engine.settings.positions[this.id], tc);
  }

  targetGain(): number {
    const { level, muted } = this.engine.settings.layers[this.id];
    return muted ? 0 : level * level * this.cfg.maxGain;
  }

  applyGain(): void {
    const tc = this.engine.cfg.engine.knobTc;
    this.output.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, tc);
  }

  // Keep one or more AudioParams wandering on a slow random walk. `map` turns
  // walk values into param values. Gaps between steps are randomised too.
  drift(
    params: AudioParam | AudioParam[],
    range: WalkRange,
    map: (value: number) => number = (value) => value,
    { gapSec = [2, 6], tc = 1.5 }: { gapSec?: readonly number[]; tc?: number } = {},
  ): void {
    const targets = Array.isArray(params) ? params : [params];
    const walk = new Walk(range);
    const stepGap = () => rand(gapSec[0], gapSec[1]);
    for (const param of targets) param.value = map(walk.value);
    this.scheduler.every(stepGap, (time, dt) => {
      const value = map(walk.step(dt));
      for (const param of targets) param.setTargetAtTime(value, time, tc);
    });
  }

  // Recordings of the chosen model of this machine. A model short of one kind
  // borrows from its others, so it never falls back to synthesis midway.
  modelSamples(kind: string): LoadedSample[] {
    const { models, defaultModel } = this.cfg;
    const chosen = this.engine.settings.models[this.id];
    const model = models?.some(({ id }) => id === chosen) ? chosen : defaultModel;
    const { samples } = this.engine;
    const exact = samples.loaded(this.id, { model, kind });
    return exact.length ? exact : samples.loaded(this.id, { model });
  }

  // Manual buttons for this layer: { LABEL: (time) => ... }. None by default.
  triggers(): Triggers {
    return {};
  }

  // A 0..1 macro as a multiplier: 0.5 is ×1, the ends are ×range and ÷range.
  macroScale(name: 'activity' | 'signal'): number {
    const { range } = this.engine.cfg.macros[name];
    return range ** (2 * this.engine.settings.macros[name] - 1);
  }

  // How much the layer's RATE knob and the Activity macro speed events up.
  // Zero stops them altogether.
  rateScale(): number {
    const { rate } = this.engine.settings.layers[this.id];
    if (rate === 0 || !this.engine.operating) return 0;
    const knob = this.engine.cfg.engine.rateRange ** (2 * rate - 1);
    return (this.constructor as LayerClass).bus === 'machine' ? knob * this.macroScale('activity') : knob;
  }

  // Random events at the layer's rate. Knob moves apply straight away.
  // `boost` returns any extra speed-up, read each time.
  events(meanSec: number, minSec: number, fn: (time: number) => void, boost: () => number = () => 1): void {
    const scale = () => this.rateScale() * boost();
    this.scheduler.poisson({
      meanGap: () => meanSec / scale(),
      minGap: () => minSec / Math.max(scale(), 1e-3),
      fn,
    });
  }

  // A fixed stereo position inside this layer, for one unit of a machine.
  panned(pan: number, gain = 1): GainNode {
    const amp = new GainNode(this.ctx, { gain });
    amp.connect(new StereoPannerNode(this.ctx, { pan })).connect(this.output);
    return amp;
  }

  // Run fn(time, index) `count` times. gap(index) returns the seconds to the
  // next run. Each step is planned only when it comes due, so a long sequence
  // holds nothing in memory, and done(time) runs after the last step.
  series(
    time: number,
    count: number,
    gap: (index: number) => number,
    fn: (time: number, index: number) => void,
    done?: (time: number) => void,
  ): void {
    const { epoch } = this.engine; // work in progress stops at power off
    const step = (at: number, index: number): void => {
      if (epoch !== this.engine.epoch) {
        done?.(at);
        return;
      }
      fn(at, index);
      if (index + 1 < count) this.scheduler.at(at + gap(index), (next) => step(next, index + 1));
      else done?.(at);
    };
    this.scheduler.at(time, (at) => step(at, 0));
  }

  // Gap for bursts of events: exponential, with a floor.
  burstGap({ meanGapSec, minGapSec }: { meanGapSec: number; minGapSec: number }): number {
    return minGapSec + exponential() * (meanGapSec - minGapSec);
  }

  // One-shots. Each creates a few cheap nodes over the shared noise buffers
  // and releases them all when it ends. Over the voice limit, it just skips.
  claimVoice(): boolean {
    if (this.engine.voices >= this.engine.cfg.engine.maxVoices) return false;
    this.engine.voices += 1;
    return true;
  }

  releaseOnEnd(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    source.onended = () => {
      for (const node of nodes) node.disconnect();
      this.engine.voices -= 1;
    };
  }

  // Play one variant of a measured hit from the shared bank.
  hit(time: number, recipe: RecipeName, { gain = 1, pitch = 1, dest = this.output as AudioNode } = {}): void {
    if (!this.claimVoice()) return;
    const { ctx } = this;
    const source = new AudioBufferSourceNode(ctx, {
      buffer: pick(this.engine.hits.buffers(recipe)),
      playbackRate: pitch,
    });
    const amp = new GainNode(ctx, { gain });
    source.connect(amp).connect(dest);
    source.start(time);
    this.releaseOnEnd(source, [source, amp]);
    this.engine.flash(this.id, time);
  }

  // Play a recording from the sample bank, a little different each time.
  // offset and duration pick a stretch of it; fadeSec softens that stretch's
  // edges, and lowpassHz darkens this one playback. Returns the time it takes.
  playSample(time: number, { buffer }: LoadedSample, options: SampleOptions = {}): number {
    if (!this.claimVoice()) return 0;
    const { gain = 1, pitch = 1, dest = this.output, offset = 0, duration, fadeSec, lowpassHz } = options;
    const { ctx } = this;
    const seconds = duration ?? buffer.duration - offset;
    const heard = seconds / pitch;
    const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: pitch });
    const amp = new GainNode(ctx, { gain: fadeSec ? 0 : gain });
    const nodes: AudioNode[] = [source, amp];
    if (lowpassHz) {
      const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: lowpassHz, Q: 0.5 });
      source.connect(lowpass).connect(amp);
      nodes.push(lowpass);
    } else {
      source.connect(amp);
    }
    amp.connect(dest);
    if (fadeSec) {
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(gain, time + fadeSec);
      amp.gain.setValueAtTime(gain, time + heard - fadeSec);
      amp.gain.linearRampToValueAtTime(0, time + heard);
    }
    source.start(time, offset, seconds);
    this.releaseOnEnd(source, nodes);
    this.engine.flash(this.id, time);
    return heard;
  }

  // A short tone. `from` is a frequency ratio it falls from, for a knock.
  toneStrike(time: number, { hz, gain, decay, attackSec, holdSec, from = 1, wave = 'sine', lowpassHz, dest = this.output }: ToneOptions): void {
    if (!this.claimVoice()) return;
    const { ctx } = this;
    const osc = new OscillatorNode(ctx, { type: wave, frequency: hz * from });
    const amp = new GainNode(ctx, { gain: 0 });
    const nodes: AudioNode[] = [osc, amp];
    if (from !== 1) {
      osc.frequency.setValueAtTime(hz * from, time);
      osc.frequency.exponentialRampToValueAtTime(hz, time + decay * 0.5);
    }
    if (lowpassHz) {
      const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: lowpassHz, Q: 0.5 });
      osc.connect(lowpass).connect(amp);
      nodes.push(lowpass);
    } else {
      osc.connect(amp);
    }
    amp.connect(dest);
    const end = strike(amp.gain, time, { peak: gain, attackSec, holdSec, decay });
    osc.start(time);
    osc.stop(end + 0.01);
    this.releaseOnEnd(osc, nodes);
    this.engine.flash(this.id, time);
  }

  // Report a sound event to the UI, timed to when it is heard.
  event(time: number, message: string): void {
    this.engine.emitEvent(this.id, time, message);
  }
}
