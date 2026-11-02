import { Layer } from './layer.js';
import { chance, pick, rand, randInt, randRange, varyDb } from '../random.js';

const STATUS = ['NOMINAL', 'READY', 'ACK', 'NO FAULT', 'STANDBY', 'CHECK OK'];

// Terminal beeps: a single beep, a two-tone chirp, or a short coded report.
export class BeepLayer extends Layer {
  static id = 'beeps';
  static bus = 'machine';
  static placed = true;
  static triggerLabels = ['BEEP', 'CHIRP', 'REPORT'];

  start() {
    const { meanIdleSec, minIdleSec, pan } = this.cfg;
    this.dest = this.panned(pan);
    this.events(meanIdleSec, minIdleSec, (time) => this.signal(time));
  }

  triggers() {
    return {
      BEEP: (time) => this.single(time),
      CHIRP: (time) => this.chirp(time),
      REPORT: (time) => this.report(time),
    };
  }

  // The short power-on-self-test beep, the same every time, as on a real machine.
  selfTest(time) {
    const { pitchHz, holdSec } = this.cfg.selfTest;
    this.beep(time, pitchHz, holdSec);
  }

  signal(time) {
    const { chirpChance, reportChance } = this.cfg;
    const roll = Math.random();
    if (roll < chirpChance) this.chirp(time);
    else if (roll < chirpChance + reportChance) this.report(time);
    else this.single(time);
  }

  beep(time, hz, holdSec) {
    const { wave, lowpassHz, gain, attackSec, decaySec, levelVaryDb, detuneCents } = this.cfg;
    this.toneStrike(time, {
      hz: hz * 2 ** (rand(-detuneCents, detuneCents) / 1200),
      gain: varyDb(gain, levelVaryDb),
      attackSec,
      holdSec,
      decay: decaySec,
      wave,
      lowpassHz,
      dest: this.dest,
    });
  }

  single(time) {
    this.beep(time, pick(this.cfg.pitchesHz), randRange(this.cfg.single.holdSec));
    this.event(time, `TERM 1 ${pick(STATUS)}`);
  }

  chirp(time) {
    const { pitchesHz, chirp } = this.cfg;
    const first = pick(pitchesHz);
    const second = pick(pitchesHz.filter((hz) => hz !== first));
    this.beep(time, first, chirp.holdSec);
    this.beep(time + chirp.holdSec + chirp.gapSec, second, chirp.holdSec);
    this.event(time, 'TERM 1 ACK');
  }

  report(time) {
    const { pitchesHz, report } = this.cfg;
    const first = pick(pitchesHz);
    const pair = pick(pitchesHz.filter((hz) => hz !== first));
    const useSecond = chance(report.secondPitchChance);
    this.event(time, `UNIT ${randInt({ min: 1, max: 9 })} REPORT ${pick(STATUS)}`);
    let lastHold = 0;
    this.series(
      time,
      randInt(report.pips),
      () => lastHold + randRange(report.gapSec),
      (at) => {
        lastHold = chance(report.longChance) ? report.longSec : report.shortSec;
        this.beep(at, useSecond && chance(0.4) ? pair : first, lastHold);
      },
    );
  }
}
