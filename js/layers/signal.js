import { Layer } from './layer.js';
import { chance, pick, rand, randInt, randRange } from '../random.js';

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
};
const LETTERS = Object.keys(MORSE);

// Radio dial position, for the log.
const dial = ({ min, max }) => `${rand(min, max).toFixed(3)} MHz`;

// The receiver: static in a hard-edged channel, slow fading, crackle, and
// things that almost become a signal before sinking back. All of it is
// heard through the same channel filter, as it would be on a real set.
export class SignalLayer extends Layer {
  static id = 'signal';
  static bus = 'outside';
  static triggerLabels = ['SCAN', 'CARRIER', 'MORSE', 'DATA', 'BROADCAST'];

  start() {
    const { ctx, cfg, noise } = this;
    const { channel, staticLevel, crackleGain, fading, slowFading, signalFading, signalFadingMotion, wander, scan, carrier, fragment } = cfg;

    const fade = new GainNode(ctx);
    const slowFade = new GainNode(ctx);
    this.presence = new GainNode(ctx, { gain: this.presenceGain() });
    fade.connect(slowFade).connect(this.presence).connect(this.output);
    const toGain = (db) => 10 ** (db / 20);
    this.drift(fade.gain, fading, toGain);
    this.drift(slowFade.gain, slowFading, toGain);

    this.tops = [];
    this.peaks = [];

    // Static and crackle sit behind a squelch, as on a real receiver: closed
    // while it idles, open while it is scanning or holding something.
    this.squelch = new GainNode(ctx, { gain: cfg.squelch.closed });
    this.squelch.connect(fade);
    this.openUntil = 0;

    // Static, separate left and right, so it stays wide.
    [-cfg.staticWidth, cfg.staticWidth].forEach((pan, side) => {
      const panner = new StereoPannerNode(ctx, { pan });
      panner.connect(this.squelch);
      const amp = new GainNode(ctx, { gain: staticLevel });
      noise.loop('white', side).connect(amp).connect(this.channel(panner));
    });

    // Everything with a position moves slowly across the sky.
    // Signals fade on their way through the ionosphere; the receiver's own
    // static does not, so this sits on the signals alone.
    const skyFade = new GainNode(ctx);
    const panner = new StereoPannerNode(ctx);
    panner.connect(skyFade).connect(fade);
    this.drift(panner.pan, wander);
    this.drift(skyFade.gain, signalFading, toGain, signalFadingMotion);
    this.sky = this.channel(panner);
    const crackle = new GainNode(ctx, { gain: crackleGain });
    noise.loop('crackle').connect(crackle).connect(this.channel(this.squelch));

    this.drift(this.tops, channel.topHz);
    this.drift(this.peaks.map((peak) => peak.gain), channel.humpDb);
    this.centre = rand(channel.humpHz.min, channel.humpHz.max);
    for (const peak of this.peaks) peak.frequency.value = this.centre;

    this.events(scan.meanIdleSec, scan.minIdleSec, (time) => this.scan(time));
    const almost = () => this.macroScale('signal');
    this.events(carrier.meanIdleSec, carrier.minIdleSec, (time) => {
      if (!this.onAir) this.carrier(time);
    }, almost);
    const catchSomething = (time) => {
      if (this.onAir) return;
      if (chance(fragment.morseChance)) this.morse(time);
      else this.data(time);
    };
    this.events(fragment.meanIdleSec, fragment.minIdleSec, catchSomething, almost);
    this.events(cfg.broadcast.meanIdleSec, cfg.broadcast.minIdleSec, (time) => this.broadcast(time), almost);
  }

  // The Signal macro also brings the whole receiver forward or back.
  presenceGain() {
    return this.macroScale('signal') ** this.cfg.presenceCurve;
  }

  applyPresence() {
    const { macroTc } = this.engine.cfg.engine;
    this.presence.gain.setTargetAtTime(this.presenceGain(), this.ctx.currentTime, macroTc);
  }

  previewModel(time) {
    if (chance(0.5)) this.morse(time);
    else this.data(time);
  }

  triggers() {
    return {
      SCAN: (time) => this.scan(time),
      CARRIER: (time) => this.carrier(time),
      MORSE: (time) => this.morse(time),
      DATA: (time) => this.data(time),
      BROADCAST: (time) => this.broadcast(time),
    };
  }

  // Open the receiver for a while. Overlapping activity keeps it open.
  listen(time, seconds) {
    const { squelch } = this.cfg;
    const until = time + seconds + randRange(squelch.tailSec);
    if (time >= this.openUntil) this.squelch.gain.setTargetAtTime(1, time, squelch.openTc);
    this.openUntil = Math.max(this.openUntil, until);
    this.scheduler.at(until, (at) => {
      if (at >= this.openUntil - 0.001) this.squelch.gain.setTargetAtTime(squelch.closed, at, squelch.closeTc);
    });
  }

  // Receiver filtering: steep sides, plus a soft hump the scan moves around.
  channel(dest) {
    const { ctx, cfg } = this;
    const low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: cfg.channel.bottomHz, Q: 0.9 });
    const hump = new BiquadFilterNode(ctx, { type: 'peaking', Q: cfg.channel.humpQ });
    const topA = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.9 });
    const topB = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.6 });
    low.connect(hump).connect(topA).connect(topB).connect(dest);
    this.tops.push(topA.frequency, topB.frequency);
    this.peaks.push(hump);
    return low;
  }

  // One tone. Transmitters switch on and off: edges are quick, and any
  // fading happens to the signal while it is on the air.
  voice(time, seconds, { gain, harmonics }, setup) {
    if (!this.claimVoice()) return;
    const { ctx, cfg } = this;
    const { onTc, offTc } = cfg.edges;
    const osc = new OscillatorNode(ctx);
    if (harmonics) {
      const imag = Float32Array.from([0, ...harmonics]);
      const real = new Float32Array(imag.length);
      osc.setPeriodicWave(new PeriodicWave(ctx, { real, imag }));
    }
    const key = new GainNode(ctx);
    const amp = new GainNode(ctx, { gain: 0 });
    osc.connect(key).connect(amp).connect(this.sky);
    amp.gain.setTargetAtTime(gain, time, onTc);
    amp.gain.setTargetAtTime(0, time + seconds, offTc);
    setup(osc, key);
    osc.start(time);
    osc.stop(time + seconds + offTc * 7);
    this.releaseOnEnd(osc, [osc, key, amp]);
    this.engine.flash(this.id, time);
  }

  // A real off-air recording, heard through the same receiver.
  playTake(time, kind) {
    const takes = this.modelSamples(kind);
    if (!takes.length) return 0;
    const { recording } = this.cfg;
    const seconds = this.playSample(time, pick(takes), {
      gain: recording.gain * rand(0.8, 1.1),
      pitch: rand(1 - recording.pitchVary, 1 + recording.pitchVary),
      dest: this.sky,
    });
    this.listen(time, seconds);
    return seconds;
  }

  // Turning the dial: stations slide past as a set of parallel whistles.
  scan(time) {
    const { scan, channel } = this.cfg;
    const seconds = randRange(scan.durationSec);
    this.listen(time, seconds);
    const lines = randInt(scan.lines);
    const start = randRange(scan.startHz);
    const slide = randRange(scan.slideHz) * (chance(0.5) ? 1 : -1);
    const spacing = randRange(scan.spacingHz);

    this.centre = rand(channel.humpHz.min, channel.humpHz.max);
    for (const peak of this.peaks) peak.frequency.setTargetAtTime(this.centre, time, seconds / 3);

    for (let i = 0; i < lines; i += 1) {
      const from = start + i * spacing;
      const to = Math.max(scan.lowestHz, from + slide);
      const gain = scan.gain * rand(0.35, 1);
      this.voice(time, seconds, { gain }, (osc) => {
        osc.frequency.setValueAtTime(from, time);
        osc.frequency.linearRampToValueAtTime(to, time + seconds);
      });
    }
    this.event(time + seconds, `SCANNING ${dial(scan.bandMHz)} ... NO CARRIER`);
  }

  // A steady tone that comes up out of the static and goes back down.
  carrier(time) {
    const { carrier, scan } = this.cfg;
    const mhz = dial(scan.bandMHz);
    const recorded = this.playTake(time, 'carrier');
    if (recorded) {
      this.event(time, `CARRIER ${mhz} ...`);
      this.event(time + recorded, `${mhz} NO CARRIER`);
      return;
    }
    const seconds = randRange(carrier.durationSec);
    this.listen(time, seconds);
    const drift = randRange(carrier.driftCents);
    const { dropouts } = carrier;
    const options = { gain: carrier.gain, harmonics: carrier.harmonics };
    this.voice(time, seconds, options, (osc, key) => {
      osc.frequency.value = pick(carrier.pitchesHz) * rand(0.97, 1.03);
      osc.detune.setValueAtTime(0, time);
      osc.detune.linearRampToValueAtTime(drift, time + seconds);
      // Real carriers break up: brief hard gaps, not gentle dips.
      for (let i = randInt(dropouts.count); i > 0; i -= 1) {
        const at = time + rand(0.5, seconds - 0.8);
        const gap = randRange(dropouts.gapSec);
        key.gain.setTargetAtTime(0, at, 0.006);
        key.gain.setTargetAtTime(1, at + gap, 0.006);
      }
    });
    this.event(time, `CARRIER ${mhz} ...`);
    this.event(time + seconds, `${mhz} NO CARRIER`);
  }

  // A recorded message, looping on some frequency for who knows how long. You
  // may catch it from the start or come in partway. Sometimes it goes round
  // again, which is the moment you realise it is a loop.
  broadcast(time) {
    if (this.onAir) return;
    const takes = this.engine.samples.find('signal', { kind: 'broadcast' });
    if (!takes.length) return;
    const { broadcast, scan } = this.cfg;
    const take = pick(takes);
    const mhz = dial(scan.bandMHz);
    this.onAir = true;
    this.event(time, `BROADCAST ${mhz} ...`);
    const midway = chance(broadcast.midwayChance);
    const offset = midway ? take.buffer.duration * rand(0.2, 0.5) : 0;
    const seconds = this.playBroadcast(time, take, offset);
    const again = () => {
      if (!chance(broadcast.repeatChance)) return 0;
      const next = time + seconds + randRange(broadcast.repeatGapSec);
      this.event(next, 'MESSAGE REPEATS');
      return next - time + this.playBroadcast(next, take, 0);
    };
    this.scheduler.at(time + seconds, () => {
      const total = again();
      this.scheduler.at(time + Math.max(total, seconds), (end) => {
        this.onAir = false;
        this.event(end, `${mhz} ... LOST`);
      });
    });
  }

  // Play a message from `offset`, printing each sentence as it is spoken.
  playBroadcast(time, take, offset) {
    const { broadcast } = this.cfg;
    const { duration } = take.buffer;
    const pitch = rand(1 - broadcast.pitchVary, 1 + broadcast.pitchVary);
    const seconds = this.playSample(time, take, {
      gain: broadcast.gain * rand(0.9, 1.1),
      pitch,
      offset,
      fadeSec: 0.01,
      dest: this.sky,
    });
    this.listen(time, seconds);

    // Sentence times are estimated from their length in characters.
    const { leadSec, trailSec } = broadcast;
    const spoken = duration - leadSec - trailSec;
    const sentences = take.text.match(/[^.]+\./g) ?? [take.text];
    const total = sentences.reduce((sum, line) => sum + line.length, 0);
    let chars = 0;
    for (const line of sentences) {
      const at = (leadSec + (chars / total) * spoken - offset) / pitch;
      chars += line.length;
      if (at >= 0) this.event(time + at, `RX: ${line.trim().toUpperCase()}`);
    }
    return seconds;
  }

  // A hand-keyed fragment. Real letters, cut off before they say anything.
  morse(time) {
    const { morse, fragment, scan } = this.cfg;
    const recorded = this.playTake(time, 'morse');
    if (recorded) {
      this.fragmentLog(time, recorded, scan.bandMHz);
      return;
    }
    const dit = 1.2 / randRange(morse.wpm);
    const edge = morse.edgeSec;
    const pitch = randRange(morse.pitchHz);
    const seconds = randRange(fragment.durationSec);
    this.listen(time, seconds);
    const body = seconds;

    const keying = [];
    let at = time + rand(0, 0.6);
    while (at < time + body) {
      for (const mark of MORSE[pick(LETTERS)]) {
        const length = mark === '.' ? dit : dit * 3;
        keying.push([at, length]);
        at += length * rand(0.94, 1.08) + dit; // a human fist, slightly uneven
      }
      at += dit * rand(2, 3.4);
    }

    const options = { gain: morse.gain, harmonics: morse.harmonics };
    this.voice(time, seconds, options, (osc, key) => {
      osc.frequency.value = pitch;
      key.gain.setValueAtTime(0, time);
      for (const [start, length] of keying) {
        if (start + length + edge > time + seconds) break;
        key.gain.setValueAtTime(0, start);
        key.gain.linearRampToValueAtTime(1, start + edge);
        key.gain.setValueAtTime(1, start + length - edge);
        key.gain.linearRampToValueAtTime(0, start + length);
      }
    });
    this.fragmentLog(time, seconds, scan.bandMHz);
  }

  // Teleprinter data: fast switching between two tones 170 Hz apart.
  data(time) {
    const { data, fragment, scan } = this.cfg;
    const recorded = this.playTake(time, 'data');
    if (recorded) {
      this.fragmentLog(time, recorded, scan.bandMHz);
      return;
    }
    const seconds = randRange(fragment.durationSec);
    this.listen(time, seconds);
    const low = randRange(data.pitchHz);
    const high = low + data.shiftHz;
    const step = 1 / data.baud;
    const options = { gain: data.gain };
    this.voice(time, seconds, options, (osc) => {
      osc.frequency.setValueAtTime(low, time);
      for (let at = time; at < time + seconds; at += step) {
        osc.frequency.setValueAtTime(chance(0.5) ? high : low, at);
      }
    });
    this.fragmentLog(time, seconds, scan.bandMHz);
  }

  fragmentLog(time, seconds, band) {
    this.event(time, `SIGNAL FRAGMENT ${dial(band)} ...`);
    this.event(time + seconds, '... LOST');
  }
}
