import type { Config } from './config';
import type { NoiseBank } from './noise';
import type { Position } from './types';

type EffectsConfig = Config['effects'];
type MasterConfig = Config['master'];
type CompressorConfig = MasterConfig['compressor'];
interface Span {
  near: number;
  far: number;
}

export interface MasterBus {
  input: GainNode;
  volume: GainNode;
  sleep: GainNode;
  power: GainNode;
}

const dbToGain = (db: number): number => 10 ** (db / 20);

function compressor(ctx: BaseAudioContext, { thresholdDb, kneeDb, ratio, attackSec, releaseSec }: CompressorConfig): DynamicsCompressorNode {
  return new DynamicsCompressorNode(ctx, {
    threshold: thresholdDb,
    knee: kneeDb,
    ratio,
    attack: attackSec,
    release: releaseSec,
  });
}

// input -> compressor -> trim -> volume -> limiter -> sleep -> power -> speakers
export function createMasterBus(ctx: BaseAudioContext, cfg: MasterConfig): MasterBus {
  const input = new GainNode(ctx);
  const comp = compressor(ctx, cfg.compressor);
  const trim = new GainNode(ctx, { gain: dbToGain(cfg.makeupTrimDb) });
  const volume = new GainNode(ctx, { gain: 0 });
  const limiter = compressor(ctx, cfg.limiter);
  const sleep = new GainNode(ctx);
  const power = new GainNode(ctx, { gain: 0 });

  input.connect(comp).connect(trim).connect(volume).connect(limiter).connect(sleep).connect(power);
  power.connect(ctx.destination);

  return { input, volume, sleep, power };
}

// A small metal room: a few early reflections, a fast dark tail, and the faint
// ring of steel panels. Generated here, so no impulse file is needed.
function roomImpulse(
  ctx: BaseAudioContext,
  { lengthSec, tailT60, reflections, panels, panelLevel, darkening }: EffectsConfig['distance']['room'],
): AudioBuffer {
  const { sampleRate } = ctx;
  const length = Math.round(lengthSec * sampleRate);
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const fall = Math.log(1000) / (tailT60 * sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      // Highs die sooner than lows, so the filter closes as the tail goes on.
      const coefficient = Math.exp(-(i / sampleRate) * darkening);
      low += coefficient * (Math.random() * 2 - 1 - low);
      data[i] = low * Math.exp(-fall * i);
    }
    for (const [hz, gain, t60] of panels) {
      const phase = Math.random() * Math.PI * 2;
      const panelFall = Math.log(1000) / (t60 * sampleRate);
      for (let i = 0; i < length; i += 1) {
        const ring = Math.sin((2 * Math.PI * hz * i) / sampleRate + phase);
        data[i] += panelLevel * gain * ring * Math.exp(-panelFall * i);
      }
    }
    for (const [seconds, gain] of reflections) {
      const offset = (channel ? 1.09 : 1) * seconds;
      data[Math.round(offset * sampleRate)] += gain * (Math.random() < 0.5 ? -1 : 1);
    }
  }
  return impulse;
}

const between = ({ near, far }: Span, amount: number): number => near + (far - near) * amount;
const sweep = ({ near, far }: Span, amount: number): number => near * (far / near) ** amount;

// Global closeness of the room. Machines placed on the room plan feed `room`
// directly; the air and hum feed it a little through this filter.
export class Distance {
  readonly ctx: BaseAudioContext;
  readonly cfg: EffectsConfig['distance'];
  readonly input: GainNode;
  readonly output: GainNode;
  readonly room: ConvolverNode;
  private readonly lowpassA: BiquadFilterNode;
  private readonly lowpassB: BiquadFilterNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;

  constructor(ctx: BaseAudioContext, cfg: EffectsConfig['distance']) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.lowpassA = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    this.lowpassB = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    this.dry = new GainNode(ctx);
    this.wet = new GainNode(ctx);
    this.room = new ConvolverNode(ctx, { buffer: roomImpulse(ctx, cfg.room) });
    const feed = new GainNode(ctx, { gain: cfg.roomFeed });

    this.input.connect(this.lowpassA).connect(this.lowpassB);
    this.lowpassB.connect(this.dry).connect(this.output);
    this.lowpassB.connect(feed).connect(this.room);
    this.room.connect(this.wet).connect(this.output);
  }

  apply(amount: number, tc: number): void {
    const { cfg, ctx } = this;
    const now = ctx.currentTime;
    const hz = sweep(cfg.cutoffHz, amount);
    this.lowpassA.frequency.setTargetAtTime(hz, now, tc);
    this.lowpassB.frequency.setTargetAtTime(hz * cfg.secondFilterRatio, now, tc);
    this.dry.gain.setTargetAtTime(between(cfg.dry, amount), now, tc);
    this.wet.gain.setTargetAtTime(between(cfg.wet, amount), now, tc);
  }
}

// One machine's place in the room. Further away means darker, quieter and more
// room sound. Left and right use both level and a tiny arrival-time difference
// between the ears, which is what makes a position feel solid on headphones.
export class Placement {
  readonly ctx: BaseAudioContext;
  readonly cfg: EffectsConfig['placement'];
  readonly input: GainNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly delayLeft: DelayNode;
  private readonly delayRight: DelayNode;
  private readonly send: GainNode;

  constructor(ctx: BaseAudioContext, cfg: EffectsConfig['placement'], dryBus: AudioNode, roomBus: AudioNode) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.input = new GainNode(ctx);
    this.lowpass = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      Q: 0.5,
      channelCount: 2, // fixed, so one-shots starting and ending can't change it
      channelCountMode: 'explicit',
    });
    this.level = new GainNode(ctx);
    this.panner = new StereoPannerNode(ctx);
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.delayLeft = new DelayNode(ctx, { maxDelayTime: 0.01 });
    this.delayRight = new DelayNode(ctx, { maxDelayTime: 0.01 });
    const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.send = new GainNode(ctx);

    this.input.connect(this.lowpass).connect(this.level).connect(this.panner).connect(split);
    split.connect(this.delayLeft, 0).connect(merge, 0, 0);
    split.connect(this.delayRight, 1).connect(merge, 0, 1);
    merge.connect(dryBus);
    this.panner.connect(this.send).connect(roomBus);
  }

  apply({ pan, dist }: Position, tc: number): void {
    const { cfg, ctx } = this;
    const now = ctx.currentTime;
    const { maxEarDelaySec, panLaw } = cfg;
    this.lowpass.frequency.setTargetAtTime(sweep(cfg.cutoffHz, dist), now, tc);
    this.level.gain.setTargetAtTime(sweep(cfg.level, dist), now, tc);
    this.send.gain.setTargetAtTime(between(cfg.send, dist), now, tc);
    this.panner.pan.setTargetAtTime(pan * panLaw, now, tc);
    // Sound reaches the far ear later.
    this.delayLeft.delayTime.setTargetAtTime(Math.max(pan, 0) * maxEarDelaySec, now, tc);
    this.delayRight.delayTime.setTargetAtTime(Math.max(-pan, 0) * maxEarDelaySec, now, tc);
  }
}

// Soft saturation. A shaper clips hard past ±1, so the curve spans a wide input
// range and the drive is scaled down by `span` to match.
function tapeCurve(points: number, span: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) curve[i] = Math.tanh(((i / (points - 1)) * 2 - 1) * span);
  return curve;
}

// Everything played back off an old tape: saturation, wow and flutter, a
// narrower top end, and hiss.
export class Age {
  readonly ctx: BaseAudioContext;
  readonly cfg: EffectsConfig['age'];
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly drive: GainNode;
  private readonly makeup: GainNode;
  private readonly top: BiquadFilterNode;
  private readonly wowDepth: GainNode;
  private readonly flutterDepth: GainNode;
  private readonly wow: OscillatorNode;
  private readonly flutter: OscillatorNode;
  private readonly hiss: GainNode;

  constructor(ctx: BaseAudioContext, cfg: EffectsConfig['age'], noise: NoiseBank) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);

    this.drive = new GainNode(ctx);
    const shaper = new WaveShaperNode(ctx, { curve: tapeCurve(cfg.curvePoints, cfg.curveSpan), oversample: '2x' });
    this.makeup = new GainNode(ctx);
    const delay = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: cfg.delaySec });
    this.top = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    this.input.connect(this.drive).connect(shaper).connect(this.makeup).connect(delay).connect(this.top);
    this.top.connect(this.output);

    this.wowDepth = new GainNode(ctx, { gain: 0 });
    this.flutterDepth = new GainNode(ctx, { gain: 0 });
    this.wow = new OscillatorNode(ctx, { frequency: cfg.wowHz });
    this.flutter = new OscillatorNode(ctx, { frequency: cfg.flutterHz });
    this.wow.connect(this.wowDepth).connect(delay.delayTime);
    this.flutter.connect(this.flutterDepth).connect(delay.delayTime);
    this.wow.start();
    this.flutter.start();

    this.hiss = new GainNode(ctx, { gain: 0 });
    const hissBand = new BiquadFilterNode(ctx, { type: 'highpass', frequency: cfg.hissHighpassHz });
    noise.loop('white', 1).connect(hissBand).connect(this.hiss).connect(this.output);
  }

  apply(amount: number, tc: number): void {
    const { cfg, ctx } = this;
    const now = ctx.currentTime;
    const strength = amount ** cfg.curve;
    const drive = cfg.drive.near * (cfg.drive.far / cfg.drive.near) ** amount;
    this.drive.gain.setTargetAtTime(drive / cfg.curveSpan, now, tc);
    this.makeup.gain.setTargetAtTime(1 / drive, now, tc);
    this.top.frequency.setTargetAtTime(sweep(cfg.topHz, amount), now, tc);
    this.wowDepth.gain.setTargetAtTime(cfg.wowSec * strength, now, tc);
    this.flutterDepth.gain.setTargetAtTime(cfg.flutterSec * strength, now, tc);
    this.hiss.gain.setTargetAtTime(cfg.hiss * strength, now, tc);
  }
}
