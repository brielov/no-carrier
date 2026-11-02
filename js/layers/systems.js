import { Layer } from './layer.js';
import { chance, pick, rand, randInt, randRange, varyDb } from '../random.js';

// The capsule's own systems. Each runs a real recording for a while, with the
// knock of a relay or valve at the start and end, and reports what it did.
class SystemLayer extends Layer {
  static bus = 'machine';

  // Play `seconds` from somewhere inside a recording. Returns how long.
  run(time, kind, seconds, { gain, pitch = 1, lowpassHz } = {}) {
    const clips = this.engine.samples.find(this.id, { kind });
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
  knock(time, level = 1) {
    const { knockGain, knockPitch } = this.cfg;
    this.hit(time, 'relay', { gain: knockGain * level, pitch: knockPitch * rand(0.95, 1.05) });
  }

  // One cycle at a time.
  cycle(time, start) {
    if (this.busy) return;
    this.busy = true;
    const seconds = start(time);
    this.scheduler.at(time + seconds, () => {
      this.busy = false;
    });
  }
}

export class LifeSupportLayer extends SystemLayer {
  static id = 'lifesupport';
  static triggerLabels = ['CYCLE'];

  start() {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.scrub(time));
  }

  triggers() {
    return { CYCLE: (time) => this.scrub(time) };
  }

  scrub(time) {
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

export class HydroponicsLayer extends SystemLayer {
  static id = 'hydroponics';
  static triggerLabels = ['WATER'];

  start() {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.water(time));
  }

  triggers() {
    return { WATER: (time) => this.water(time) };
  }

  water(time) {
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
export class AntennaLayer extends SystemLayer {
  static id = 'antenna';
  static triggerLabels = ['SLEW'];

  start() {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.slew(time, randRange(this.cfg.slewSec)));
  }

  triggers() {
    return { SLEW: (time) => this.slew(time, randRange(this.cfg.slewSec)) };
  }

  slew(time, seconds) {
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
export class ThrustersLayer extends SystemLayer {
  static id = 'thrusters';
  static triggerLabels = ['FIRE'];

  start() {
    const { meanIdleSec, minIdleSec } = this.cfg;
    this.events(meanIdleSec, minIdleSec, (time) => this.correct(time));
  }

  triggers() {
    return { FIRE: (time) => this.correct(time) };
  }

  correct(time) {
    const clips = this.engine.samples.find('thrusters', { kind: 'puff' });
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
