import type { LayerConfigs } from '../config';
import { Layer, type LayerConfig, type Triggers } from './layer';
import { chance, pick, rand, randInt, randRange, varyDb } from '../random';

// Settings a system needs to run a recording, or to knock.
interface RunConfig extends LayerConfig {
  edgeSec: number;
}

interface KnockConfig extends LayerConfig {
  knockGain: number;
  knockPitch: number;
}

interface RunOptions {
  gain: number;
  pitch?: number;
  lowpassHz?: number;
}

// The capsule's own systems. Each runs a real recording for a while, with the
// knock of a relay or valve at the start and end, and reports what it did.
class SystemLayer<C extends LayerConfig = LayerConfig> extends Layer<C> {
  static override readonly bus = 'machine';

  busy?: boolean;

  // Play `seconds` from somewhere inside a recording. Returns how long.
  run(this: SystemLayer<RunConfig>, time: number, kind: string, seconds: number, { gain, pitch = 1, lowpassHz }: RunOptions): number {
    const clips = this.engine.samples.loaded(this.id, { kind });
    if (!clips.length) return 0;
    const clip = pick(clips);
    const length = Math.min(seconds * pitch, clip.buffer.duration);
    return this.playSample(time, clip, {
      gain: varyDb(gain, 1.5),
      pitch,
      offset: rand(0, clip.buffer.duration - length),
      duration: length,
      fadeSec: this.cfg.edgeSec,
      lowpassHz,
    });
  }

  // A switch or valve: a dull knock, borrowed from the relay recipe.
  knock(this: SystemLayer<KnockConfig>, time: number, level = 1): void {
    const { knockGain, knockPitch } = this.cfg;
    this.hit(time, 'relay', { gain: knockGain * level, pitch: knockPitch * rand(0.95, 1.05) });
  }

  // One cycle at a time.
  cycle(time: number, start: (time: number) => number): void {
    if (this.busy) return;
    this.busy = true;
    const seconds = start(time);
    this.scheduler.at(time + seconds, () => {
      this.busy = false;
    });
  }
}

export class LifeSupportLayer extends SystemLayer<LayerConfigs['lifesupport']> {
  static override readonly id = 'lifesupport';
  static override readonly triggerLabels = ['CYCLE'];

  override start(): void {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.scrub(time));
  }

  override triggers(): Triggers {
    return { CYCLE: (time: number) => this.scrub(time) };
  }

  scrub(time: number): void {
    this.cycle(time, (at) => {
      const { runSec, gain } = this.cfg;
      this.knock(at);
      const seconds = this.run(at + 0.05, 'run', randRange(runSec), { gain });
      this.knock(at + 0.05 + seconds, 0.8);
      this.event(at, 'CO2 SCRUBBER CYCLE');
      return seconds + 0.3;
    });
  }
}

export class HydroponicsLayer extends SystemLayer<LayerConfigs['hydroponics']> {
  static override readonly id = 'hydroponics';
  static override readonly triggerLabels = ['WATER'];

  override start(): void {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.water(time));
  }

  override triggers(): Triggers {
    return { WATER: (time: number) => this.water(time) };
  }

  water(time: number): void {
    this.cycle(time, (at) => {
      const { runSec, gain, trickleGain } = this.cfg;
      this.knock(at, 0.6);
      const seconds = this.run(at + 0.04, 'water', randRange(runSec), { gain });
      // The last of the water finding its way down after the pump stops.
      const trickle = this.run(at + 0.04 + seconds, 'trickle', 3, { gain: trickleGain, pitch: rand(0.85, 1.05) });
      this.event(at, 'HYDROPONICS: WATERING CYCLE');
      return seconds + trickle + 0.3;
    });
  }
}

// Outside the hull, the antenna turns to follow the receiver's scan.
export class AntennaLayer extends SystemLayer<LayerConfigs['antenna']> {
  static override readonly id = 'antenna';
  static override readonly triggerLabels = ['SLEW'];

  override start(): void {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.slew(time, randRange(this.cfg.slewSec)));
  }

  override triggers(): Triggers {
    return { SLEW: (time: number) => this.slew(time, randRange(this.cfg.slewSec)) };
  }

  slew(time: number, seconds: number): void {
    this.cycle(time, (at) => {
      const { gain, pitch, lowpassHz } = this.cfg;
      this.knock(at, 0.5);
      const length = this.run(at + 0.03, 'motor', seconds, { gain, pitch: pitch * rand(0.92, 1.08), lowpassHz });
      this.knock(at + 0.03 + length, 0.7);
      this.event(at, `ANTENNA SLEW AZ ${rand(0, 360).toFixed(1).padStart(5, '0')}`);
      return length + 0.2;
    });
  }
}

// Now and then the capsule corrects its drift: a soft puff, felt through the hull.
export class ThrustersLayer extends SystemLayer<LayerConfigs['thrusters']> {
  static override readonly id = 'thrusters';
  static override readonly triggerLabels = ['FIRE'];

  override start(): void {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.correct(time));
  }

  override triggers(): Triggers {
    return { FIRE: (time: number) => this.correct(time) };
  }

  correct(time: number): void {
    const clips = this.engine.samples.loaded('thrusters', { kind: 'puff' });
    const { puffs, gapSec, gain, lowpassHz, thumpGain } = this.cfg;
    this.event(time, chance(0.5) ? 'STATION KEEPING' : 'HOLDING POSITION');
    this.series(time, randInt(puffs), () => randRange(gapSec), (at) => {
      this.hit(at, 'clunk', { gain: thumpGain * rand(0.7, 1), pitch: 0.42 });
      if (clips.length) {
        this.playSample(at + 0.01, pick(clips), {
          gain: varyDb(gain, 2),
          pitch: rand(0.6, 0.8),
          lowpassHz,
        });
      }
    });
  }
}
