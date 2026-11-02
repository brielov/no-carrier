import { pick, rand } from './random.js';

// Bringing the ship up and shutting it down, one system at a time. Every sound
// goes through its machine's own channel, so mutes and the room plan still
// apply. Each step checks a token, so pressing POWER mid-sequence simply
// abandons the old sequence and starts the new one.
export class PowerSequence {
  constructor(engine) {
    this.engine = engine;
    this.cfg = engine.cfg.power;
    this.token = 0;
  }

  layer(id) {
    return this.engine.layers.get(id);
  }

  // Run fn at `offset` seconds, unless the sequence has been replaced.
  step(start, offset, fn) {
    const { token } = this;
    this.engine.scheduler.at(start + offset, (time) => {
      if (token === this.token) fn(time);
    });
  }

  // Play a recorded power sound on a machine's channel. Returns its length.
  sound(time, kind, layerId, gain) {
    const layer = this.layer(layerId);
    const [sample] = this.engine.samples.find('power', { kind });
    if (!layer) return 0;
    if (sample) return layer.playSample(time, sample, { gain });
    layer.hit(time, 'clunk', { gain: gain * 0.6, pitch: 0.8 });
    return 0;
  }

  relays(time, count) {
    const relay = this.layer('relay');
    const { gapSec } = this.cfg.relays;
    if (relay) relay.series(time, count, () => rand(gapSec.min, gapSec.max), (at) => relay.click(at, pick(relay.positions)));
  }

  allOff(time, tc) {
    for (const layer of this.engine.layers.values()) layer.switchPower(0, time, tc);
  }

  start(time) {
    const { engine, cfg } = this;
    const { steps, gains } = cfg;
    this.token += 1;
    engine.operating = false;
    this.allOff(engine.ctx.currentTime, 0.001);

    this.layer('relay')?.switchPower(1, time, 0.001); // the breaker lives on this wall
    this.step(time, steps.breaker, (at) => {
      this.sound(at, 'breakerOn', 'relay', gains.breaker);
      engine.report('MAIN BREAKER CLOSED');
    });
    this.step(time, steps.hum, (at) => {
      this.layer('hum')?.switchPower(1, at, cfg.humRiseTc);
      this.layer('hull')?.switchPower(1, at, 0.001);
      engine.report('POWER BUS ONLINE');
    });
    this.step(time, steps.display, (at) => {
      this.layer('keyboard')?.switchPower(1, at, 0.001);
      this.sound(at, 'crtOn', 'keyboard', gains.crt);
      engine.report('DISPLAY ONLINE');
    });
    this.step(time, steps.fans, (at) => {
      this.layer('air')?.powerUp(at);
      engine.report('COOLING FANS ON');
    });
    this.step(time, steps.relays, (at) => {
      this.relays(at, cfg.relays.onClicks);
      engine.report('RELAY BANKS ENERGIZED');
    });
    this.step(time, steps.drive, (at) => {
      const drive = this.layer('drive');
      drive?.switchPower(1, at, 0.001);
      drive?.setWhine(1, at + cfg.whineDelaySec, cfg.whineRiseTc);
      const seconds = this.sound(at, 'spinUp', 'drive', gains.spin);
      engine.report('DRIVE SPIN UP');
      this.step(at, seconds * cfg.headsLoadedAt, () => engine.report('DRIVE HEADS LOADED'));
    });
    this.step(time, steps.tape, (at) => {
      const tape = this.layer('tape');
      tape?.switchPower(1, at, 0.001);
      tape?.units.forEach((unit, index) => unit.clunk(at + index * cfg.tapeGapSec, cfg.tapeClunkLevel));
      engine.report('TAPE UNITS READY');
    });
    this.step(time, steps.selfTest, (at) => {
      for (const id of ['beeps', 'printer', 'modem']) this.layer(id)?.switchPower(1, at, 0.001);
      this.layer('beeps')?.selfTest(at);
      engine.report('SELF TEST PASSED');
    });
    this.step(time, steps.receiver, (at) => {
      for (const id of ['signal', 'drone', 'morse', 'teleprinter', 'carrier', 'broadcast']) {
        this.layer(id)?.switchPower(1, at, cfg.outsideRiseTc);
      }
      engine.operating = true;
      engine.report('RECEIVER ONLINE');
      engine.story.greet(at + 0.6);
      engine.story.dailyReport(at + cfg.reportDelaySec);
    });
  }

  // Returns how long the wind-down takes.
  stop(time) {
    const { engine, cfg } = this;
    const { gains, off } = cfg;
    this.token += 1;
    engine.operating = false;

    this.sound(time, 'breakerOff', 'relay', gains.breaker);
    this.step(time, off.outputsCut, (at) => {
      for (const id of ['beeps', 'printer', 'modem']) this.layer(id)?.switchPower(0, at, 0.008);
      this.layer('signal')?.switchPower(0, at, 0.03);
      this.layer('tape')?.powerDown(at);
    });
    this.step(time, off.hum, (at) => this.layer('hum')?.switchPower(0, at, cfg.humFallTc));
    this.step(time, off.display, (at) => this.sound(at, 'crtOff', 'keyboard', gains.crt));
    this.step(time, off.relays, (at) => this.relays(at, cfg.relays.offClicks));
    this.step(time, off.fans, (at) => this.layer('air')?.powerDown(at));
    this.step(time, off.drive, (at) => {
      this.layer('drive')?.setWhine(0, at, cfg.whineFallTc);
      this.sound(at, 'spinDown', 'drive', gains.spin);
    });
    this.step(time, off.outside, (at) => this.layer('drone')?.switchPower(0, at, cfg.outsideFallTc));
    // Channels held open for their power sounds close as soon as those finish,
    // so nothing left over can sound in the silence after shutdown.
    this.step(time, off.closeRoom, (at) => {
      for (const id of ['relay', 'keyboard']) this.layer(id)?.switchPower(0, at, 0.02);
    });
    this.step(time, off.closeDrive, (at) => this.layer('drive')?.switchPower(0, at, 0.05));
    engine.report('SYSTEM SHUTDOWN');
    return off.done;
  }
}
