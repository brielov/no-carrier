import { Layer } from './layer.js';
import { pick, rand, randInt, randRange } from '../random.js';

// The capsule itself: metal ticking as it warms and cools, and now and then a
// soft settling creak. It comes from all around, as the hull does.
export class HullLayer extends Layer {
  static id = 'hull';
  static bus = 'machine';
  static triggerLabels = ['TICK', 'CREAK'];

  start() {
    const { ticks, creaks, width } = this.cfg;
    this.spots = [-1, -0.5, 0, 0.5, 1].map((spread) => this.panned(spread * width));
    this.events(ticks.meanIdleSec, ticks.minIdleSec, (time) => this.cooling(time));
    this.events(creaks.meanIdleSec, creaks.minIdleSec, (time) => this.settle(time));
  }

  triggers() {
    return {
      TICK: (time) => this.cooling(time),
      CREAK: (time) => this.settle(time),
    };
  }

  // A few ticks from one spot, irregular, as a panel contracts.
  cooling(time) {
    const clips = this.engine.samples.find('hull', { kind: 'tick' });
    if (!clips.length) return;
    const { ticks } = this.cfg;
    const dest = pick(this.spots);
    this.series(time, randInt(ticks.count), () => randRange(ticks.gapSec), (at) => {
      this.playSample(at, pick(clips), {
        gain: ticks.gain * rand(0.5, 1),
        pitch: rand(0.85, 1.1),
        dest,
      });
    });
  }

  settle(time) {
    const clips = this.engine.samples.find('hull', { kind: 'creak' });
    if (!clips.length) return;
    const { creaks } = this.cfg;
    this.playSample(time, pick(clips), {
      gain: creaks.gain * rand(0.7, 1),
      pitch: rand(0.8, 1),
      dest: pick(this.spots),
    });
  }
}
