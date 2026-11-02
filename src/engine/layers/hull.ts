import type { LayerConfigs } from '../config';
import { Layer, type Triggers } from './layer';
import { pick, rand, randInt, randRange } from '../random';

// The capsule itself: metal ticking as it warms and cools, and now and then a
// soft settling creak. It comes from all around, as the hull does.
export class HullLayer extends Layer<LayerConfigs['hull']> {
  static override readonly id = 'hull';
  static override readonly bus = 'machine';
  static override readonly triggerLabels = ['TICK', 'CREAK'];

  spots!: GainNode[];

  override start(): void {
    const { ticks, creaks, width } = this.cfg;
    this.spots = [-1, -0.5, 0, 0.5, 1].map((spread) => this.panned(spread * width));
    this.events(ticks.meanIdleSec, ticks.minIdleSec, (time) => this.cooling(time));
    this.events(creaks.meanIdleSec, creaks.minIdleSec, (time) => this.settle(time));
  }

  override triggers(): Triggers {
    return {
      TICK: (time: number) => this.cooling(time),
      CREAK: (time: number) => this.settle(time),
    };
  }

  // A few ticks from one spot, irregular, as a panel contracts.
  cooling(time: number): void {
    const clips = this.engine.samples.loaded('hull', { kind: 'tick' });
    if (!clips.length) return;
    const { ticks } = this.cfg;
    const dest = pick(this.spots);
    this.series(time, randInt(ticks.count), () => randRange(ticks.gapSec), (at: number) => {
      this.playSample(at, pick(clips), {
        gain: ticks.gain * rand(0.5, 1),
        pitch: rand(0.85, 1.1),
        dest,
      });
    });
  }

  settle(time: number): void {
    const clips = this.engine.samples.loaded('hull', { kind: 'creak' });
    if (!clips.length) return;
    const { creaks } = this.cfg;
    this.playSample(time, pick(clips), {
      gain: creaks.gain * rand(0.7, 1),
      pitch: rand(0.8, 1),
      dest: pick(this.spots),
    });
  }
}
