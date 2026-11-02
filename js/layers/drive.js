import { Layer } from './layer.js';
import { chance, pick, rand, randInt, randRange, varyDb } from '../random.js';

const hex = (value) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;

// Hard drives: spurts of seeks with idle time between them, and now and then
// a long read. Seeks land on whole disk rotations, which gives the rhythm.
export class DriveLayer extends Layer {
  static id = 'drive';
  static bus = 'machine';
  static placed = true;
  static triggerLabels = ['SEEK', 'READ', 'RECAL'];

  start() {
    const { units, meanIdleSec, minIdleSec } = this.cfg;
    this.units = units.map((unit) => ({ ...unit, dest: this.panned(unit.pan, unit.gain) }));
    this.busy = false;
    this.startWhine();
    this.events(meanIdleSec, minIdleSec, (time) => this.activity(time));
  }

  startWhine() {
    const { ctx, cfg } = this;
    const amp = new GainNode(ctx);
    this.whinePower = new GainNode(ctx);
    amp.connect(this.whinePower).connect(this.output);
    this.drift(amp.gain, cfg.whine.ampDrift);
    for (const { hz, gain } of cfg.whine.tones) {
      const osc = new OscillatorNode(ctx, { frequency: hz });
      osc.connect(new GainNode(ctx, { gain })).connect(amp);
      osc.start();
    }
  }

  // The platters: on while spinning, silent otherwise.
  setWhine(level, time, tc) {
    this.whinePower.gain.cancelScheduledValues(time);
    this.whinePower.gain.setTargetAtTime(level, time, tc);
  }

  previewModel(time) {
    this.spurt(time, pick(this.units));
  }

  triggers() {
    return {
      SEEK: (time) => this.spurt(time, pick(this.units)),
      READ: (time) => this.read(time, pick(this.units)),
      RECAL: (time) => this.recal(time, pick(this.units)),
    };
  }

  activity(time) {
    if (this.busy) return;
    this.busy = true;
    const unit = pick(this.units);
    const done = () => {
      this.busy = false;
    };
    if (chance(this.cfg.recording.recalChance) && this.recal(time, unit, done)) return;
    if (chance(this.cfg.read.chance)) this.read(time, unit, done);
    else this.spurt(time, unit, done);
  }

  rotations(choices) {
    const { rotationSec, jitterSec } = this.cfg;
    return pick(choices) * rotationSec + rand(-jitterSec, jitterSec);
  }

  playBurst(time, unit, sample) {
    const { recording, levelVaryDb } = this.cfg;
    const { pitchVary } = recording;
    return this.playSample(time, sample, {
      gain: varyDb(recording.gain, levelVaryDb),
      pitch: unit.pitch * rand(1 - pitchVary, 1 + pitchVary),
      dest: unit.dest,
    });
  }

  // Bursts played back to back, each starting after the last one ends.
  chain(time, unit, count, kinds, done) {
    const { joinSec } = this.cfg.recording;
    let length = 0;
    const gap = () => length + randRange(joinSec);
    const play = (at) => {
      const choices = this.modelSamples(pick(kinds));
      if (choices.length) length = this.playBurst(at, unit, pick(choices));
    };
    this.series(time, count, gap, play, done && ((at) => this.scheduler.at(at + length, done)));
  }

  spurt(time, unit, done) {
    const { spurt, recording } = this.cfg;
    this.event(time, `${unit.name} SEEK SECTOR ${hex(Math.floor(rand(0, 0xffff)))}`);
    if (this.modelSamples('short').length) {
      this.chain(time, unit, randInt(recording.spurtBursts), ['short', 'short', 'long'], done);
      return;
    }
    const gap = () => this.rotations(spurt.rotations);
    this.series(time, randInt(spurt.seeks), gap, (at) => this.seek(at, unit), done);
  }

  read(time, unit, done) {
    const { read, recording } = this.cfg;
    const seeks = randInt(read.seeks);
    this.event(time, `${unit.name} READ ${seeks * 8} BLOCKS`);
    if (this.modelSamples('long').length) {
      this.chain(time, unit, randInt(recording.readBursts), ['long', 'long', 'short'], done);
      return;
    }
    const gap = () =>
      chance(read.pauseChance) ? randRange(read.pauseSec) : this.rotations(read.rotations);
    this.series(time, seeks, gap, (at) => this.seek(at, unit), done);
  }

  // The rare heavy one: the drive recalibrating its heads. Needs a sample.
  recal(time, unit, done) {
    const choices = this.engine.samples.find('drive', { kind: 'recal' });
    if (!choices.length) return false;
    const { recording } = this.cfg;
    const length = this.playSample(time, pick(choices), {
      gain: recording.recalGain,
      pitch: rand(1 - recording.pitchVary, 1 + recording.pitchVary),
      dest: unit.dest,
    });
    this.event(time, `${unit.name} RECALIBRATE`);
    if (done) this.scheduler.at(time + length, done);
    return true;
  }

  seek(time, unit) {
    const { hitGain, levelVaryDb, pitchVary, accel, step } = this.cfg;
    const gain = varyDb(hitGain, levelVaryDb);
    const pitch = unit.pitch * rand(1 - pitchVary, 1 + pitchVary);
    const play = (at, level, ratio) =>
      this.hit(at, unit.recipe, { gain: gain * level, pitch: pitch * ratio, dest: unit.dest });

    let landing = time + randRange(accel.gapSec);
    play(time, accel.level, accel.pitch);
    if (chance(step.chance)) {
      const ticks = randInt(step.ticks);
      for (let i = 0; i < ticks; i += 1) {
        play(landing, step.level, step.pitch);
        landing += randRange(step.gapSec);
      }
    }
    play(landing, 1, 1);
  }
}
