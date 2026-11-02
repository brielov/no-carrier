import type { LayerConfigs } from '../config';
import type { LoadedSample } from '../types';
import { Layer, type Triggers } from './layer';
import { pick, rand, randRange } from '../random';

type FragmentKind = 'handshake' | 'data';

// Rare, brief fragments of machines talking down a line: an answer tone and
// training, or a burst of data. They never connect to anything for long.
export class ModemLayer extends Layer<LayerConfigs['modem']> {
  static override readonly id = 'modem';
  static override readonly bus = 'machine';
  static override readonly placed = true;
  static override readonly triggerLabels = ['HANDSHAKE', 'DATA'];

  busy!: boolean;
  dest!: GainNode;

  override start(): void {
    const { meanIdleSec, minIdleSec, pan, dataChance } = this.cfg;
    this.busy = false;
    this.dest = this.panned(pan);
    this.events(meanIdleSec, minIdleSec, (time) => {
      if (Math.random() < dataChance) this.fragment(time, 'data');
      else this.fragment(time, 'handshake');
    });
  }

  override triggers(): Triggers {
    return {
      HANDSHAKE: (time: number) => this.fragment(time, 'handshake'),
      DATA: (time: number) => this.fragment(time, 'data'),
    };
  }

  fragment(time: number, kind: FragmentKind): void {
    if (this.busy) return;
    this.busy = true;
    const { baudRates } = this.cfg;
    this.event(time, kind === 'data' ? 'DATA LINK ACTIVE' : `MODEM TRAINING ${pick(baudRates)} BAUD`);
    const takes = this.engine.samples.loaded('modem', { kind });
    const seconds = takes.length ? this.playTake(time, pick(takes), kind) : this.synth(time, kind);
    this.scheduler.at(time + seconds, (end) => {
      this.busy = false;
      this.event(end, 'NO CARRIER');
    });
  }

  playTake(time: number, take: LoadedSample, kind: FragmentKind): number {
    const { sample } = this.cfg;
    const { buffer } = take;
    const wanted = randRange(sample[kind === 'data' ? 'dataSec' : 'handshakeSec']);
    const seconds = Math.min(wanted, buffer.duration);
    return this.playSample(time, take, {
      gain: sample.gain * rand(0.8, 1.1),
      pitch: rand(1 - sample.pitchVary, 1 + sample.pitchVary),
      offset: kind === 'data' ? rand(0, buffer.duration - seconds) : 0, // handshakes begin at the start
      duration: seconds,
      fadeSec: sample.fadeSec,
      lowpassHz: randRange(sample.lowpassHz),
      dest: this.dest,
    });
  }

  synth(time: number, kind: FragmentKind): number {
    return kind === 'data' ? this.synthData(time) : this.synthHandshake(time);
  }

  // Answer tone, then pairs of tones trading places.
  synthHandshake(time: number): number {
    const { answerHz, answerSec, pairHz, pairSec, wave, gain, lowpassHz } = this.cfg.synth;
    const tone = { gain, attackSec: 0.02, decay: 0.05, wave: wave as OscillatorType, lowpassHz, dest: this.dest };
    this.toneStrike(time, { ...tone, hz: answerHz, holdSec: answerSec });
    let at = time + answerSec + 0.15;
    for (const hz of pairHz) {
      this.toneStrike(at, { ...tone, hz, holdSec: pairSec });
      at += pairSec + 0.05;
    }
    return at - time;
  }

  // Scrambled data is close to noise inside the width of a phone line.
  synthData(time: number): number {
    if (!this.claimVoice()) return 0;
    const { ctx, noise, cfg } = this;
    const { dataSec, dataBandHz, dataBandQ, gain } = cfg.synth;
    const seconds = randRange(dataSec);
    const source = noise.loop('white', 0);
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: dataBandHz, Q: dataBandQ });
    const amp = new GainNode(ctx, { gain: 0 });
    source.connect(band).connect(amp).connect(this.dest);
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(gain, time + 0.05);
    amp.gain.setValueAtTime(gain, time + seconds - 0.2);
    amp.gain.linearRampToValueAtTime(0, time + seconds);
    source.stop(time + seconds + 0.01);
    this.releaseOnEnd(source, [source, band, amp]);
    return seconds;
  }
}
