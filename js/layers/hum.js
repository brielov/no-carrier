import { Layer } from './layer.js';

const dbToGain = (db) => 10 ** (db / 20);

// Mains hum: a stack of harmonics that drift in pitch together and in level
// separately, plus a second transformer sitting very slightly off.
export class HumLayer extends Layer {
  static id = 'hum';
  static bus = 'machine';

  start() {
    const { ctx, cfg } = this;
    const mains = this.engine.settings.mains;

    this.switchGain = new GainNode(ctx);
    const breath = new GainNode(ctx);
    this.switchGain.connect(breath).connect(this.output);
    this.drift(breath.gain, cfg.ampDrift);

    const pitch = new ConstantSourceNode(ctx, { offset: 0 });
    pitch.start();
    this.drift(pitch.offset, cfg.pitchDriftCents);

    this.oscillators = [];
    const addVoice = (n, gain) => {
      const osc = new OscillatorNode(ctx, { frequency: n * mains });
      const voice = new GainNode(ctx, { gain });
      pitch.connect(osc.detune);
      osc.connect(voice).connect(this.switchGain);
      osc.start();
      this.oscillators.push({ osc, n });
      return { osc, voice };
    };

    for (const { n, gain, driftDb, tauSec } of cfg.harmonics) {
      const { voice } = addVoice(n, gain);
      this.drift(voice.gain, { min: -driftDb, max: driftDb, tauSec }, (db) => gain * dbToGain(db));
    }

    const { n, gain, detuneCents } = cfg.secondUnit;
    const { osc } = addVoice(n, gain);
    this.drift(osc.detune, detuneCents);
  }

  // Duck, retune, come back: a pitch glide from 50 to 60 Hz would be very audible.
  setMains(hz) {
    const now = this.ctx.currentTime;
    const swap = now + this.cfg.mainsSwitchSec;
    const { gain } = this.switchGain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(0, now, this.cfg.mainsSwitchSec / 6);
    for (const { osc, n } of this.oscillators) {
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(n * hz, swap);
    }
    gain.setTargetAtTime(1, swap, this.cfg.mainsSwitchSec / 2);
    this.event(swap, `MAINS REFERENCE ${hz} HZ`);
  }
}
