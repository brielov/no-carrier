import { Layer } from './layer';
import type { Triggers } from './layer';
import type { LayerConfigs } from '../config';
import type { LoadedSample } from '../types';
import { chance, pick, rand, randInt, randRange, varyDb } from '../random';

type TapeUnitConfig = LayerConfigs['tape']['units'][number];
type TapeJob = 'read' | 'shuttle';

// One reel-to-reel transport. Nodes run all the time and stay silent when
// idle, so a job only moves a few parameters. Speed is in cents, shared by the
// motor, the reel pulsing and the harmonic bands of moving tape.
class TapeUnit {
  readonly layer: TapeLayer;
  readonly name: string;
  busy: boolean;
  readonly dest: GainNode;
  readonly speed: ConstantSourceNode;
  readonly amp: GainNode;

  constructor(layer: TapeLayer, unit: TapeUnitConfig) {
    const { ctx, cfg, noise } = layer;
    this.layer = layer;
    this.name = unit.name;
    this.busy = false;
    this.dest = layer.panned(unit.pan);

    this.speed = new ConstantSourceNode(ctx, { offset: cfg.restCents });
    const wander = new ConstantSourceNode(ctx, { offset: 0 });
    this.speed.start();
    wander.start();
    layer.drift(wander.offset, cfg.speedDriftCents);

    this.amp = new GainNode(ctx, { gain: 0 });
    this.amp.connect(this.dest);

    const reelAmp = new GainNode(ctx, { gain: cfg.bandGain });
    reelAmp.connect(this.amp);
    const source = noise.loop('pink', 1);
    const tuned: AudioParam[] = [];
    cfg.bandHarmonics.forEach((gain, index) => {
      const band = new BiquadFilterNode(ctx, {
        type: 'bandpass',
        frequency: unit.bandHz * (index + 1),
        Q: cfg.bandQ,
      });
      source.connect(band).connect(new GainNode(ctx, { gain })).connect(reelAmp);
      tuned.push(band.detune);
    });

    const reel = new OscillatorNode(ctx, { frequency: unit.reelHz });
    const reelDepth = new GainNode(ctx, { gain: cfg.bandGain * cfg.reelDepth });
    reel.connect(reelDepth).connect(reelAmp.gain);

    const motor = new OscillatorNode(ctx, { type: 'sawtooth', frequency: unit.motorHz });
    const motorLowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cfg.motorLowpassHz, Q: 0.4 });
    const motorAmp = new GainNode(ctx, { gain: cfg.motorGain });
    motor.connect(motorLowpass).connect(motorAmp).connect(this.amp);

    for (const param of [...tuned, reel.detune, motor.detune]) {
      this.speed.connect(param);
      wander.connect(param);
    }
    reel.start();
    motor.start();
  }

  // Motors take time to change speed, but the sound of moving tape starts with
  // the mechanism: pitch glides while the level arrives at once. Stopping is
  // slower: reels have weight, so a brake has to bring them down.
  move(time: number, cents: number, level: number, tc: number, levelTc: number = this.layer.cfg.levelTc): void {
    this.speed.offset.setTargetAtTime(cents, time, tc);
    this.amp.gain.setTargetAtTime(level, time, levelTc);
  }

  clunk(time: number, level = 1, pitch = 1): void {
    const { clunkGain, clunkPitchVary, levelVaryDb } = this.layer.cfg;
    this.layer.hit(time, 'clunk', {
      gain: varyDb(clunkGain * level, levelVaryDb),
      pitch: pitch * rand(1 - clunkPitchVary, 1 + clunkPitchVary),
      dest: this.dest,
    });
  }

  halt(time: number): void {
    const { cfg } = this.layer;
    this.move(time, cfg.restCents, 0, cfg.stopTc, cfg.stopLevelTc);
    this.clunk(time + cfg.stopTc);
    this.busy = false;
  }

  // Bring a fast shuttle down on the brake: the whir sags, then the latch.
  brake(time: number): void {
    const { brakeTc, brakeLevelTc, brakeSec, restCents } = this.layer.cfg;
    this.move(time, restCents, 0, brakeTc, brakeLevelTc);
    this.clunk(time + brakeSec);
    this.busy = false;
  }

  // Tape moves in blocks: run, stop, wait, run again.
  read(time: number): void {
    const { read } = this.layer.cfg;
    this.busy = true;
    const block = Math.floor(rand(1, 2400));
    this.layer.event(time, `TAPE UNIT ${this.name} READ BLOCK ${block}`);
    this.readBlocks(time, randInt(read.blocks));
  }

  readBlocks(time: number, left: number): void {
    const { scheduler, cfg } = this.layer;
    this.clunk(time);
    this.move(time + 0.03, 0, cfg.read.level, cfg.read.riseTc);
    scheduler.at(time + randRange(cfg.read.blockSec), (stop) => {
      if (left > 1) {
        const { restCents, stopTc, stopLevelTc } = cfg;
        this.move(stop, restCents, 0, stopTc, stopLevelTc);
        this.clunk(stop + stopTc);
        scheduler.at(stop + randRange(cfg.read.restSec), (next) => this.readBlocks(next, left - 1));
      } else {
        this.halt(stop);
      }
    });
  }

  // Climb to a whir, then let the pitch slide as one reel fills. A rewind
  // falls and may finish with the tape end slapping; a fast forward rises.
  shuttle(time: number): void {
    const recordings = this.layer.modelSamples('shuttle');
    if (recordings.length) this.shuttleRecorded(time, pick(recordings));
    else this.shuttleSynth(time);
  }

  // A real shuttle, with its own start, run and stop.
  shuttleRecorded(time: number, take: LoadedSample): void {
    const { layer } = this;
    const { models, recording } = layer.cfg;
    const { gain } = models.find(({ id }) => id === take.model)!;
    this.busy = true;
    layer.event(time, `TAPE UNIT ${this.name} ${chance(recording.forwardChance) ? 'FAST FORWARD' : 'REWIND'}`);
    const seconds = layer.playSample(time, take, {
      gain: varyDb(recording.gain * gain, recording.levelVaryDb),
      pitch: rand(1 - recording.pitchVary, 1 + recording.pitchVary),
      dest: this.dest,
    });
    layer.scheduler.at(time + seconds, () => {
      this.busy = false;
    });
  }

  shuttleSynth(time: number): void {
    const { scheduler, cfg } = this.layer;
    const { shuttle, flap } = cfg;
    const forward = chance(shuttle.forwardChance);
    const rise = randRange(shuttle.riseSec);
    const slide = randRange(shuttle.slideSec);
    const start = randRange(shuttle.startCents);
    const end = start + randRange(forward ? shuttle.forwardSlideCents : shuttle.rewindSlideCents);

    this.busy = true;
    this.layer.event(time, `TAPE UNIT ${this.name} ${forward ? 'FAST FORWARD' : 'REWIND'}`);
    this.clunk(time);
    this.move(time + 0.03, start, shuttle.level, rise / 3);
    scheduler.at(time + rise, (at) => this.speed.offset.setTargetAtTime(end, at, slide / 2));
    scheduler.at(time + rise + slide, (stop) => {
      if (!forward && chance(flap.chance)) this.flap(stop);
      else this.brake(stop);
    });
  }

  flap(time: number): void {
    const { flap } = this.layer.cfg;
    let gap = flap.firstGapSec;
    this.layer.series(
      time,
      randInt(flap.slaps),
      () => {
        gap *= flap.growth;
        return gap;
      },
      (at) => this.clunk(at, flap.level, flap.pitch),
      (at) => this.halt(at + gap),
    );
  }
}

export class TapeLayer extends Layer<LayerConfigs['tape']> {
  static override readonly id = 'tape';
  static override readonly bus = 'machine';
  static override readonly placed = true;
  static override readonly triggerLabels = ['READ', 'SHUTTLE'];

  units!: TapeUnit[];

  override start(): void {
    const { units, meanIdleSec, minIdleSec, shuttleChance } = this.cfg;
    this.units = units.map((unit) => new TapeUnit(this, unit));
    this.events(meanIdleSec, minIdleSec, (time) => {
      this.startJob(time, chance(shuttleChance) ? 'shuttle' : 'read');
    });
  }

  override previewModel(time: number): void {
    this.startJob(time, 'shuttle');
  }

  powerDown(time: number): void {
    for (const unit of this.units) {
      unit.move(time, this.cfg.restCents, 0, this.cfg.stopTc);
      unit.busy = false;
    }
  }

  override triggers(): Triggers {
    return {
      READ: (time) => this.startJob(time, 'read'),
      SHUTTLE: (time) => this.startJob(time, 'shuttle'),
    };
  }

  startJob(time: number, job: TapeJob): void {
    const idle = this.units.filter((unit) => !unit.busy);
    if (idle.length) pick(idle)[job](time);
  }
}
