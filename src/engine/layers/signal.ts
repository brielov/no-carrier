import type { LayerConfigs } from '../config';
import type { LoadedSample, Range, SampleEntry } from '../types';
import { Layer, type Triggers } from './layer';
import { chance, pick, rand, randInt, randRange } from '../random';

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....',
  6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '=': '-...-', '?': '..--..', '/': '-..-.', '.': '.-.-.-',
};
const LETTERS = Object.keys(MORSE).filter((key) => /[A-Z]/.test(key));

const randomLetters = (): string => Array.from({ length: 40 }, () => pick(LETTERS)).join('');

// Standard Morse timing: a dah is three dits, a gap between letters three, and
// between words seven. A slight, human unevenness, but always readable.
// Returns [start, length] for each key press, up to `until`.
function morseKeying(text: string, from: number, dit: number, until: number, dah = 3): [number, number][] {
  const keying: [number, number][] = [];
  let at = from;
  const swing = () => rand(0.95, 1.06);
  for (const char of text) {
    if (at > until) break;
    if (char === ' ') {
      at += dit * 4 * swing(); // plus the letter gap already taken: seven dits
      continue;
    }
    for (const mark of MORSE[char] ?? '') {
      const length = (mark === '.' ? dit : dit * dah) * swing();
      keying.push([at, length]);
      at += length + dit * swing();
    }
    at += dit * 2 * swing(); // with the gap after the last mark: three dits
  }
  return keying;
}

// Lazy entries have no audio until ready() has fetched it.
const isLoaded = (entry: SampleEntry): entry is LoadedSample => entry.buffer !== undefined;

interface VoiceOptions {
  gain: number;
  harmonics?: readonly number[];
}

// Radio dial position, for the log.
const dial = ({ min, max }: Range): string => `${rand(min, max).toFixed(3)} MHz`;

// The receiver: static in a hard-edged channel, slow fading, crackle and
// scanning. Morse, teleprinter, carriers and broadcasts are layers of their own
// (see radio.js) with their own controls, but they all play through this one
// receiver, so they share its channel, fading and squelch as on a real set.
//
// Each signal method takes the `part` that asked for it: that layer's output
// sets the level, and its lamp is the one that blinks.
export class SignalLayer extends Layer<LayerConfigs['signal']> {
  static override readonly id = 'signal';
  static override readonly bus = 'outside';
  static override readonly triggerLabels = ['SCAN'];

  presence!: GainNode;
  tops!: AudioParam[];
  peaks!: BiquadFilterNode[];
  squelch!: GainNode;
  openUntil!: number;
  sky!: BiquadFilterNode; // where the radio parts play
  scanIn!: GainNode; // unset until start(): applyGain() checks for it
  centre!: number;
  onAir?: boolean;

  override start(): void {
    const { ctx, cfg, noise } = this;
    const { channel, staticLevel, crackleGain, fading, slowFading, signalFading, signalFadingMotion, wander, scan } = cfg;

    // Signals: fading and the Signal macro, then straight to this layer's
    // power switch. The receiver's own level knob does not touch them.
    const fade = new GainNode(ctx);
    const slowFade = new GainNode(ctx);
    this.presence = new GainNode(ctx, { gain: this.presenceGain() });
    fade.connect(slowFade).connect(this.presence).connect(this.mains);
    const toGain = (db: number): number => 10 ** (db / 20);
    this.drift(fade.gain, fading, toGain);
    this.drift(slowFade.gain, slowFading, toGain);

    this.tops = [];
    this.peaks = [];

    // Static and crackle sit behind a squelch, as on a real receiver: closed
    // while it idles, open while it is scanning or holding something.
    this.squelch = new GainNode(ctx, { gain: cfg.squelch.closed });
    this.squelch.connect(this.output);
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
    // Scan whistles are the receiver's own, so they follow its level knob.
    this.scanIn = new GainNode(ctx, { gain: this.targetGain() });
    this.scanIn.connect(this.sky);
    const crackle = new GainNode(ctx, { gain: crackleGain });
    noise.loop('crackle').connect(crackle).connect(this.channel(this.squelch));

    this.drift(this.tops, channel.topHz);
    this.drift(this.peaks.map((peak) => peak.gain), channel.humpDb);
    this.centre = rand(channel.humpHz.min, channel.humpHz.max);
    for (const peak of this.peaks) peak.frequency.value = this.centre;

    this.events(scan.meanIdleSec, scan.minIdleSec, (time) => this.scan(time));
  }

  override applyGain(): void {
    super.applyGain();
    this.scanIn?.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, this.engine.cfg.engine.knobTc);
  }

  part(id: string): Layer {
    return this.engine.layers.get(id) ?? this;
  }

  // The Signal macro also brings the whole receiver forward or back.
  presenceGain(): number {
    return this.macroScale('signal') ** this.cfg.presenceCurve;
  }

  applyPresence(): void {
    const { macroTc } = this.engine.cfg.engine;
    this.presence.gain.setTargetAtTime(this.presenceGain(), this.ctx.currentTime, macroTc);
  }

  override previewModel(time: number): void {
    if (chance(0.5)) this.morse(time, this.part('morse'));
    else this.data(time, this.part('teleprinter'));
  }

  override triggers(): Triggers {
    return { SCAN: (time: number) => this.scan(time) };
  }

  // Open the receiver for a while. Overlapping activity keeps it open. A
  // muted part leaves it closed, so muting Morse doesn't leave empty static.
  listen(time: number, seconds: number, part: Layer = this): void {
    const { muted, level } = this.engine.settings.layers[part.id];
    if (muted || level === 0) return;
    const { squelch } = this.cfg;
    const until = time + seconds + randRange(squelch.tailSec);
    if (time >= this.openUntil) this.squelch.gain.setTargetAtTime(1, time, squelch.openTc);
    this.openUntil = Math.max(this.openUntil, until);
    this.scheduler.at(until, (at) => {
      if (at >= this.openUntil - 0.001) this.squelch.gain.setTargetAtTime(squelch.closed, at, squelch.closeTc);
    });
  }

  // Receiver filtering: steep sides, plus a soft hump the scan moves around.
  channel(dest: AudioNode): BiquadFilterNode {
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
  voice(
    time: number,
    seconds: number,
    { gain, harmonics }: VoiceOptions,
    setup: (osc: OscillatorNode, key: GainNode) => void,
    part: Layer = this,
  ): void {
    if (!part.claimVoice()) return;
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
    osc.connect(key).connect(amp).connect(part === this ? this.scanIn : part.output);
    amp.gain.setTargetAtTime(gain, time, onTc);
    amp.gain.setTargetAtTime(0, time + seconds, offTc);
    setup(osc, key);
    osc.start(time);
    osc.stop(time + seconds + offTc * 7);
    part.releaseOnEnd(osc, [osc, key, amp]);
    this.engine.flash(part.id, time);
  }

  // A real off-air recording, heard through the same receiver.
  playTake(time: number, kind: string, part: Layer): number {
    const takes = this.modelSamples(kind);
    if (!takes.length) return 0;
    const { recording } = this.cfg;
    const seconds = part.playSample(time, pick(takes), {
      gain: recording.gain * rand(0.8, 1.1),
      pitch: rand(1 - recording.pitchVary, 1 + recording.pitchVary),
      dest: part.output,
    });
    this.listen(time, seconds, part);
    return seconds;
  }

  // Turning the dial: stations slide past as a set of parallel whistles.
  scan(time: number): void {
    const { scan, channel } = this.cfg;
    const seconds = randRange(scan.durationSec);
    this.listen(time, seconds);
    this.engine.story.attempt();
    // Outside, the antenna turns to follow the scan.
    this.engine.layer('antenna')?.slew(time, Math.min(seconds * 0.6, 7));
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
  carrier(time: number, part: Layer = this.part('carrier')): void {
    const { carrier, scan } = this.cfg;
    const mhz = dial(scan.bandMHz);
    const recorded = this.playTake(time, 'carrier', part);
    if (recorded) {
      part.event(time, `CARRIER ${mhz} ...`);
      part.event(time + recorded, `${mhz} NO CARRIER`);
      return;
    }
    const seconds = randRange(carrier.durationSec);
    this.listen(time, seconds, part);
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
    }, part);
    part.event(time, `CARRIER ${mhz} ...`);
    part.event(time + seconds, `${mhz} NO CARRIER`);
  }

  // A recorded message, looping on some frequency for who knows how long. You
  // may catch it from the start or come in partway. Sometimes it goes round
  // again, which is the moment you realise it is a loop.
  broadcast(time: number, part: Layer = this.part('broadcast')): void {
    if (this.onAir) return;
    const takes = this.engine.samples.find('signal', { kind: 'broadcast' });
    if (!takes.length) return;
    const take = this.engine.story.choose(takes);
    this.onAir = true;
    // Most messages are fetched the first time they play.
    if (!isLoaded(take)) {
      this.engine.samples.ready(take).then((ok) => {
        this.onAir = false;
        // ready() resolving true means the buffer is now set.
        if (ok && this.engine.operating) this.transmit(this.ctx.currentTime + 0.1, take as LoadedSample, part);
      });
      return;
    }
    this.transmit(time, take, part);
  }

  transmit(time: number, take: LoadedSample, part: Layer): void {
    const { broadcast, scan } = this.cfg;
    const mhz = dial(scan.bandMHz);
    this.onAir = true;
    part.event(time, `BROADCAST ${mhz} ...`);
    const midway = chance(broadcast.midwayChance);
    const offset = midway ? take.buffer.duration * rand(0.2, 0.5) : 0;
    const seconds = this.playBroadcast(time, take, offset, part);
    const again = () => {
      if (!chance(broadcast.repeatChance)) return 0;
      const next = time + seconds + randRange(broadcast.repeatGapSec);
      part.event(next, 'MESSAGE REPEATS');
      return next - time + this.playBroadcast(next, take, 0, part);
    };
    this.scheduler.at(time + seconds, () => {
      const total = again();
      this.scheduler.at(time + Math.max(total, seconds), (end) => {
        this.onAir = false;
        if (!midway) this.engine.story.heard(take.file);
        part.event(end, `${mhz} ... LOST`);
      });
    });
  }

  // Play a message from `offset`, printing each sentence as it is spoken.
  playBroadcast(time: number, take: LoadedSample, offset: number, part: Layer): number {
    const { broadcast } = this.cfg;
    const { duration } = take.buffer;
    const pitch = rand(1 - broadcast.pitchVary, 1 + broadcast.pitchVary);
    const seconds = part.playSample(time, take, {
      gain: broadcast.gain * rand(0.9, 1.1),
      pitch,
      offset,
      fadeSec: 0.01,
      dest: part.output,
    });
    this.listen(time, seconds, part);

    // Sentence times are estimated from their length in characters.
    const { leadSec, trailSec } = broadcast;
    const spoken = duration - leadSec - trailSec;
    const text = take.text!; // every broadcast in the manifest has its text
    const sentences = text.match(/[^.]+\./g) ?? [text];
    const total = sentences.reduce((sum, line) => sum + line.length, 0);
    let chars = 0;
    for (const line of sentences) {
      const at = (leadSec + (chars / total) * spoken - offset) / pitch;
      chars += line.length;
      if (at >= 0) part.event(time + at, `RX: ${line.trim().toUpperCase()}`);
    }
    return seconds;
  }

  // An automated time station, still counting seconds. Nobody knows who, if
  // anyone, is left behind it.
  timeSignal(time: number, part: Layer = this.part('timesignal')): void {
    const takes = this.engine.samples.find('signal', { kind: 'time' });
    if (!takes.length || this.onAir) return;
    const take = pick(takes);
    if (!isLoaded(take)) {
      this.engine.samples.ready(take).then((ok) => {
        if (ok && this.engine.operating) this.timeSignal(this.ctx.currentTime + 0.1, part);
      });
      return;
    }
    const { recording } = this.cfg;
    const seconds = part.playSample(time, take, {
      gain: recording.gain * rand(0.8, 1.1),
      fadeSec: 0.01,
      dest: part.output,
    });
    this.listen(time, seconds, part);
    part.event(time, `TIME SIGNAL ${take.mhz} MHz ...`);
    part.event(time + seconds, `${take.mhz} MHz ... LOST`);
  }

  // A hand-keyed fragment. Sometimes it is the Meridian, sending real words
  // in proper Morse for anyone who can read it; otherwise some other station,
  // off air or in random letters. Either way it is cut off before the end, and
  // the log never shows the words: they are only there for the ear.
  morse(time: number, part: Layer = this.part('morse')): void {
    const { morse, fragment, scan } = this.cfg;
    const meridian = chance(morse.storyChance);
    if (!meridian) {
      const recorded = this.playTake(time, 'morse', part);
      if (recorded) {
        this.fragmentLog(time, recorded, scan.bandMHz, part);
        return;
      }
    }
    const dit = 1.2 / randRange(morse.wpm);
    const edge = morse.edgeSec;
    const pitch = randRange(morse.pitchHz);
    const seconds = randRange(fragment.durationSec);
    this.listen(time, seconds, part);
    // Ezra keys the Meridian's traffic, and he sends his dahs too long.
    const dah = meridian ? morse.meridianDah : 3;
    const keying = morseKeying(meridian ? this.storyText() : randomLetters(), time + rand(0.1, 0.6), dit, time + seconds, dah);

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
    }, part);
    this.fragmentLog(time, seconds, scan.bandMHz, part);
  }

  // A Meridian message, usually from the top, sometimes caught partway in.
  storyText(): string {
    const { messages, fromStartChance } = this.cfg.morse;
    const words = pick(messages).split(' ');
    const from = chance(fromStartChance) ? 0 : randInt({ min: 1, max: Math.max(1, words.length - 2) });
    return words.slice(from).join(' ');
  }

  // Teleprinter data: fast switching between two tones 170 Hz apart.
  data(time: number, part: Layer = this.part('teleprinter')): void {
    const { data, fragment, scan } = this.cfg;
    const recorded = this.playTake(time, 'data', part);
    if (recorded) {
      this.fragmentLog(time, recorded, scan.bandMHz, part);
      return;
    }
    const seconds = randRange(fragment.durationSec);
    this.listen(time, seconds, part);
    const low = randRange(data.pitchHz);
    const high = low + data.shiftHz;
    const step = 1 / data.baud;
    const options = { gain: data.gain };
    this.voice(time, seconds, options, (osc) => {
      osc.frequency.setValueAtTime(low, time);
      for (let at = time; at < time + seconds; at += step) {
        osc.frequency.setValueAtTime(chance(0.5) ? high : low, at);
      }
    }, part);
    this.fragmentLog(time, seconds, scan.bandMHz, part);
  }

  fragmentLog(time: number, seconds: number, band: Range, part: Layer): void {
    part.event(time, `SIGNAL FRAGMENT ${dial(band)} ...`);
    part.event(time + seconds, '... LOST');
  }
}
