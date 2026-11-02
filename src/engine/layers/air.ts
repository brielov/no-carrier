import { Layer } from './layer';
import type { Triggers } from './layer';
import type { LayerConfigs } from '../config';
import type { LoadedSample } from '../types';
import { chance, pick, rand, randRange } from '../random';

type AirConfig = LayerConfigs['air'];
type FanConfig = AirConfig['fans'][number];
type SpinDirection = 'up' | 'down' | 'home';

const centsToRatio = (cents: number): number => 2 ** (cents / 1200);

// One cooling fan. Speed is held in cents and fed to every pitched part at
// once, so a spin-up moves the tone, the blade pulsing and the whoosh together.
// The fan is either synthesized or a looping recording; a recording follows
// the same speed, by playing faster or slower.
class Fan {
  readonly name: string;
  cents: number;
  readonly exponent: number;
  readonly speed: ConstantSourceNode;
  readonly wander: ConstantSourceNode;
  readonly level: GainNode;
  readonly synth: GainNode;
  private readonly ctx: BaseAudioContext;
  private recording: { source: AudioBufferSourceNode; amp: GainNode } | null = null;

  constructor(layer: AirLayer, fan: FanConfig, shared: AirConfig) {
    const { ctx, noise } = layer;
    this.name = fan.name;
    this.cents = 0;
    this.exponent = shared.fanLevelExponent;

    this.speed = new ConstantSourceNode(ctx, { offset: shared.startupCents });
    this.wander = new ConstantSourceNode(ctx, { offset: 0 });
    this.speed.start();
    this.wander.start();
    layer.drift(this.wander.offset, shared.fanSpeedDriftCents);

    const startLevel = centsToRatio(shared.startupCents) ** this.exponent;
    this.ctx = ctx;
    this.level = new GainNode(ctx, { gain: startLevel });
    const pan = new StereoPannerNode(ctx, { pan: fan.pan });
    this.level.connect(pan).connect(layer.output);
    this.synth = new GainNode(ctx);
    this.synth.connect(this.level);

    // Blade tone. One oscillator also supplies the pulsing of the whoosh, so
    // the two stay locked together as they would on a real fan.
    const real = new Float32Array(shared.fanHarmonics.length + 1);
    const imag = Float32Array.from([0, ...shared.fanHarmonics]);
    const blade = new OscillatorNode(ctx, {
      frequency: fan.bladeHz,
      periodicWave: new PeriodicWave(ctx, { real, imag }),
    });

    // Slight imbalance: a flutter at the rotation rate of the shaft.
    const shaft = new OscillatorNode(ctx, { frequency: fan.bladeHz / fan.blades });
    const shaftDepth = new GainNode(ctx, { gain: fan.toneGain * fan.wobbleDepth });
    const tone = new GainNode(ctx, { gain: fan.toneGain });
    blade.connect(tone).connect(this.synth);
    shaft.connect(shaftDepth).connect(tone.gain);

    // Air chopped by the blades.
    const band = new BiquadFilterNode(ctx, {
      type: 'bandpass',
      frequency: fan.bladeHz * fan.whooshMul,
      Q: fan.whooshQ,
    });
    const chop = new GainNode(ctx, { gain: fan.whooshGain });
    const chopDepth = new GainNode(ctx, { gain: fan.whooshGain * fan.amDepth });
    noise.loop('pink', 1).connect(band).connect(chop).connect(this.synth);
    blade.connect(chopDepth).connect(chop.gain);

    for (const param of [blade.detune, shaft.detune, band.detune]) {
      this.speed.connect(param);
      this.wander.connect(param);
    }
    blade.start();
    shaft.start();
  }

  // Crossfade to a recording, or back to synthesis when there is none.
  play(clip: LoadedSample | null, gain: number, time: number, fadeSec: number): void {
    const { ctx } = this;
    const tc = fadeSec / 3;
    const old = this.recording;
    if (old) {
      old.amp.gain.setTargetAtTime(0, time, tc);
      old.source.stop(time + fadeSec * 2);
      old.source.onended = () => {
        old.source.disconnect();
        old.amp.disconnect();
      };
    }
    this.recording = null;
    this.synth.gain.setTargetAtTime(clip ? 0 : 1, time, tc);
    if (!clip) return;
    const source = new AudioBufferSourceNode(ctx, { buffer: clip.buffer, loop: true });
    const amp = new GainNode(ctx, { gain: 0 });
    this.speed.connect(source.detune);
    this.wander.connect(source.detune);
    source.connect(amp).connect(this.level);
    source.start(time, rand(0, clip.buffer.duration));
    amp.gain.setTargetAtTime(gain * (clip.gain ?? 1), time, tc);
    this.recording = { source, amp };
  }

  jumpTo(cents: number, time: number): void {
    this.speed.offset.cancelScheduledValues(time);
    this.speed.offset.setValueAtTime(cents, time);
    this.level.gain.cancelScheduledValues(time);
    this.level.gain.setValueAtTime(centsToRatio(cents) ** this.exponent, time);
  }

  setSpeed(cents: number, time: number, tc: number): void {
    this.cents = cents;
    this.speed.offset.setTargetAtTime(cents, time, tc);
    this.level.gain.setTargetAtTime(centsToRatio(cents) ** this.exponent, time, tc);
  }
}

// Air handling: low duct rumble, air in the vents, and a couple of fans whose
// speed slowly changes every few minutes.
export class AirLayer extends Layer<AirConfig> {
  static override readonly id = 'air';
  static override readonly bus = 'machine';
  static override readonly triggerLabels = ['FAN UP', 'FAN DOWN'];

  fans!: Fan[];
  vent!: GainNode; // the synthesized air in the vents, which recordings already have
  private switching: Promise<void> = Promise.resolve();
  private chosen: string | null = null;

  override start(): void {
    this.startRumble();
    this.startVent();

    const { fans, spin, startupTc } = this.cfg;
    this.fans = fans.map((fan) => new Fan(this, fan, this.cfg));
    const now = this.ctx.currentTime;
    for (const fan of this.fans) fan.setSpeed(0, now, startupTc);

    this.events(spin.meanGapSec, spin.minGapSec, (time) => this.changeFanSpeed(time));
    this.applyModel();
  }

  override ready(): Promise<void> {
    return this.switching;
  }

  // Load the chosen model's recordings, then crossfade every fan to them.
  // Each fan gets a different loop. A model with no recordings is synthesized.
  override applyModel(): void {
    const model = this.engine.settings.models[this.id] ?? this.cfg.defaultModel;
    if (model === this.chosen) return;
    this.chosen = model;
    this.switching = (async () => {
      const { samples } = this.engine;
      await samples.load();
      const entries = samples.find(this.id, { model, kind: 'fan' });
      const loaded = await Promise.all(entries.map((entry) => samples.ready(entry)));
      if (this.chosen !== model) return; // chosen again while loading
      const clips = entries.filter((_, i) => loaded[i]) as LoadedSample[];
      const { gain, crossfadeSec } = this.cfg.recording;
      const time = this.ctx.currentTime + 0.05;
      this.fans.forEach((fan, i) => fan.play(clips.length ? clips[i % clips.length] : null, gain, time, crossfadeSec));
      this.vent.gain.setTargetAtTime(clips.length ? 0 : 1, time, crossfadeSec / 3);
    })();
  }

  startRumble(): void {
    const { ctx, noise } = this;
    const { gain, highpassHz, lowpassHz, ampDrift } = this.cfg.rumble;
    const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: highpassHz });
    const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.3 });
    const amp = new GainNode(ctx);
    noise.loop('brown').connect(highpass).connect(lowpass).connect(amp).connect(this.output);
    this.drift(lowpass.frequency, lowpassHz);
    this.drift(amp.gain, ampDrift, (value) => value * gain);
  }

  startVent(): void {
    const { ctx, noise } = this;
    const { gain, widthPan, bandpassHz, bandpassQ, highShelf, ampDrift } = this.cfg.vent;
    const amp = new GainNode(ctx);
    const bands: AudioParam[] = [];
    // Separate noise left and right, so the width is real rather than panned.
    [-widthPan, widthPan].forEach((pan, side) => {
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', Q: bandpassQ });
      const shelf = new BiquadFilterNode(ctx, {
        type: 'highshelf',
        frequency: highShelf.hz,
        gain: highShelf.db,
      });
      const panner = new StereoPannerNode(ctx, { pan });
      noise.loop('pink', side).connect(band).connect(shelf).connect(panner).connect(amp);
      bands.push(band.frequency);
    });
    this.vent = new GainNode(ctx);
    amp.connect(this.vent).connect(this.output);
    this.drift(bands, bandpassHz);
    this.drift(amp.gain, ampDrift, (value) => value * gain);
  }

  // Fans start from nothing and take a while to reach speed.
  powerUp(time: number): void {
    const { startupCents, startupTc, mainsRiseTc } = this.cfg;
    this.switchPower(1, time, mainsRiseTc);
    for (const fan of this.fans) {
      fan.jumpTo(startupCents, time);
      fan.setSpeed(0, time + 0.01, startupTc);
    }
  }

  // With the power gone, they coast.
  powerDown(time: number): void {
    const { stopCents, stopTc, mainsFallTc } = this.cfg;
    this.switchPower(0, time, mainsFallTc);
    for (const fan of this.fans) fan.setSpeed(stopCents, time, stopTc);
  }

  override triggers(): Triggers {
    return {
      'FAN UP': (time) => this.spinFan(time, pick(this.fans), 'up'),
      'FAN DOWN': (time) => this.spinFan(time, pick(this.fans), 'down'),
    };
  }

  changeFanSpeed(time: number): void {
    const { spin } = this.cfg;
    const fan = pick(this.fans);
    const home = fan.cents !== 0 && chance(spin.returnChance);
    if (home) this.spinFan(time, fan, 'home');
    else this.spinFan(time, fan, chance(spin.upChance) ? 'up' : 'down');
  }

  spinFan(time: number, fan: Fan, direction: SpinDirection): void {
    const { spin } = this.cfg;
    const targets = {
      up: () => randRange(spin.upCents),
      down: () => randRange(spin.downCents),
      home: () => 0,
    };
    const cents = targets[direction]();
    const word = cents < fan.cents ? 'SPIN DOWN' : 'SPIN UP';
    const percent = Math.round(centsToRatio(cents) * 100);
    fan.setSpeed(cents, time, randRange(spin.durationSec) / 3);
    this.event(time, `${fan.name} ${word} ${percent}%`);
  }
}
