import { Director } from './director.js';
import { HitBank } from './hits.js';
import { Age, Distance, createMasterBus } from './effects.js';
import { NoiseBank } from './noise.js';
import { PowerSequence } from './power.js';
import { RECIPES } from './recipes.js';
import { SampleBank } from './samples.js';
import { Story } from './story.js';
import { Scheduler } from './scheduler.js';
import { BroadcastLayer, CarrierLayer, MorseLayer, TeleprinterLayer, TimeSignalLayer } from './layers/radio.js';
import { AntennaLayer, HydroponicsLayer, LifeSupportLayer, ThrustersLayer } from './layers/systems.js';
import { SignalLayer } from './layers/signal.js';
import { AirLayer } from './layers/air.js';
import { BeepLayer } from './layers/beeps.js';
import { DriveLayer } from './layers/drive.js';
import { DroneLayer } from './layers/drone.js';
import { HullLayer } from './layers/hull.js';
import { HumLayer } from './layers/hum.js';
import { KeyboardLayer } from './layers/keyboard.js';
import { ModemLayer } from './layers/modem.js';
import { PrinterLayer } from './layers/printer.js';
import { RelayLayer } from './layers/relay.js';
import { TapeLayer } from './layers/tape.js';

const LAYERS = [HumLayer, AirLayer, HullLayer, LifeSupportLayer, HydroponicsLayer, DriveLayer, TapeLayer, RelayLayer, KeyboardLayer, BeepLayer, PrinterLayer, ModemLayer, SignalLayer, MorseLayer, TeleprinterLayer, CarrierLayer, BroadcastLayer, TimeSignalLayer, AntennaLayer, DroneLayer, ThrustersLayer];

export class Engine {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.powered = false;
    this.voices = 0; // one-shot sounds currently alive
    this.operating = true; // false while booting or shutting down: no random events
    this.epoch = 0; // counts shutdowns, so work in progress knows to stop
    this.layers = new Map();
    this.listeners = new Set();
    this.suspendTimer = null;

    // The one place current settings live. Knobs write here, the audio graph
    // reads from here, so settings can be changed before power on.
    this.settings = {
      master: cfg.master.defaultVolume,
      macros: Object.fromEntries(Object.entries(cfg.macros).map(([name, { value }]) => [name, value])),
      mains: cfg.layers.hum.defaultMains,
      layers: Object.fromEntries(
        LAYERS.map(({ id }) => [id, { level: cfg.layers[id].defaultLevel, muted: false, rate: 0.5 }]),
      ),
      preset: null,
      drift: false,
      showLog: true,
      showDiag: false,
      positions: Object.fromEntries(
        LAYERS.filter(({ placed }) => placed).map(({ id }) => [id, { ...cfg.layers[id].position }]),
      ),
      models: Object.fromEntries(
        LAYERS.filter(({ id }) => cfg.layers[id].models).map(({ id }) => [id, cfg.layers[id].defaultModel]),
      ),
    };
    this.defaults = structuredClone(this.settings);
    this.changeListeners = new Set();
    this.flashListeners = new Set();
    this.director = new Director(this);
    this.sequence = new PowerSequence(this);
    this.story = new Story(this);
  }

  // Take settings loaded from storage. Only for use before power on.
  restore(settings) {
    this.settings = structuredClone(settings);
    this.director.sync();
  }

  // Build the whole graph on a context. Must happen after a user gesture for
  // a live context; an offline one can be passed in for rendering.
  build(ctx) {
    this.ctx = ctx;
    this.scheduler = new Scheduler(ctx, this.cfg.scheduler);
    this.noise = new NoiseBank(ctx, this.cfg.noise);
    this.hits = new HitBank(ctx, RECIPES, this.cfg.engine.hitVariants);
    this.samples = new SampleBank(ctx);
    this.master = createMasterBus(ctx, this.cfg.master);
    this.distance = new Distance(ctx, this.cfg.effects.distance);
    this.age = new Age(ctx, this.cfg.effects.age, this.noise);

    // machine -> distance -+-> age -> master
    // outside ------------/
    this.buses = { machine: this.distance.input, room: this.distance.room, outside: new GainNode(ctx) };
    this.distance.output.connect(this.age.input);
    this.buses.outside.connect(this.age.input);
    this.age.output.connect(this.master.input);

    this.applyMasterVolume();
    this.applyEffects(0.01);

    for (const LayerClass of LAYERS) {
      // One broken layer shouldn't silence the rest of the ship.
      try {
        const layer = new LayerClass(this, LayerClass.id, this.buses[LayerClass.bus]);
        this.layers.set(LayerClass.id, layer);
        layer.start();
        if (LayerClass.id === 'signal') this.buses.sky = layer.sky; // where radio parts play
      } catch (error) {
        this.reportFault(LayerClass.id, error);
      }
    }
    this.director.attach();
    this.story.start();
  }

  async powerOn() {
    if (this.powered) return;
    this.powered = true;
    clearTimeout(this.suspendTimer);
    if (!this.ctx) {
      this.build(new AudioContext({ latencyHint: this.cfg.engine.latencyHint }));
      await this.samples.load();
    }
    await this.ctx.resume();
    this.master.sleep.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.sleep.gain.setValueAtTime(1, this.ctx.currentTime);
    this.sequence.start(this.ctx.currentTime + this.cfg.engine.lookIn); // switches all off first
    this.scheduler.start();
    this.fadePower(1, this.cfg.engine.fadeInTc);
  }

  powerOff() {
    if (!this.powered) return;
    this.powered = false;
    this.director.sleepEnd = null;
    this.epoch += 1;
    const { fadeOutTc } = this.cfg.engine;
    const seconds = this.sequence.stop(this.ctx.currentTime + 0.02);
    this.suspendTimer = setTimeout(() => {
      this.fadePower(0, fadeOutTc);
      this.suspendTimer = setTimeout(() => {
        this.scheduler.stop();
        this.ctx.suspend();
      }, fadeOutTc * 6000);
    }, seconds * 1000);
  }

  fadePower(target, tc) {
    const { gain } = this.master.power;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(target, now, tc);
  }

  applyMasterVolume() {
    const k = this.settings.master;
    this.master.volume.gain.setTargetAtTime(k * k, this.ctx.currentTime, this.cfg.engine.knobTc);
  }

  applyEffects(tc) {
    this.distance.apply(this.settings.macros.distance, tc);
    this.age.apply(this.settings.macros.age, tc);
  }

  // Activity is read live by the layers, so it needs no pushing out.
  setMacro(name, value) {
    this.settings.macros[name] = value;
    if (!this.ctx) return;
    const tc = this.cfg.engine.macroTc;
    if (name === 'distance') this.distance.apply(value, tc);
    if (name === 'age') this.age.apply(value, tc);
    if (name === 'signal') this.layers.get('signal')?.applyPresence();
  }

  // Set a value by its path, such as 'macros.age' or 'layers.drive.level'.
  setValue(path, value) {
    const [group, name, field] = path.split('.');
    if (group === 'master') this.setMasterVolume(value);
    else if (group === 'macros') this.setMacro(name, value);
    else if (field === 'level') this.setLayerLevel(name, value);
    else this.setLayerRate(name, value);
  }

  setMasterVolume(value) {
    this.settings.master = value;
    if (this.ctx) this.applyMasterVolume();
  }

  setLayerLevel(id, level) {
    this.settings.layers[id].level = level;
    this.layers.get(id)?.applyGain();
  }

  setLayerMuted(id, muted) {
    this.settings.layers[id].muted = muted;
    this.layers.get(id)?.applyGain();
  }

  setLayerRate(id, rate) {
    this.settings.layers[id].rate = rate;
  }

  // Move a machine on the room plan.
  setPosition(id, position) {
    this.settings.positions[id] = position;
    this.layers.get(id)?.applyPosition(this.cfg.engine.macroTc);
    this.notifyChange();
  }

  // Choose a real machine for a layer, and play something so it can be heard.
  setModel(id, model) {
    this.settings.models[id] = model;
    this.notifyChange();
    if (!this.powered || !this.operating) return;
    this.layers.get(id)?.previewModel(this.ctx.currentTime + 0.03);
    this.scheduler.tick();
  }

  // Fire a named manual trigger now. Ignored unless the ship is fully up.
  trigger(id, label) {
    if (!this.powered || !this.operating) return;
    this.layers.get(id).triggers()[label](this.ctx.currentTime + 0.03);
    this.scheduler.tick();
  }

  // What each layer offers, for building the UI before the graph exists.
  layerInfo() {
    return LAYERS.map(({ id, placed = false, triggerLabels = [] }) => ({ id, placed, triggerLabels }));
  }

  setMains(hz) {
    this.settings.mains = hz;
    this.layers.get('hum')?.setMains(hz);
  }

  on(listener) {
    this.listeners.add(listener);
  }

  onFlash(listener) {
    this.flashListeners.add(listener);
  }

  // Blink a layer's lamp when a sound placed at `time` is heard.
  flash(layer, time) {
    if (!this.flashListeners.size) return;
    this.scheduler.notify(time, () => {
      for (const listener of this.flashListeners) listener(layer);
    });
  }

  onChange(listener) {
    this.changeListeners.add(listener);
  }

  notifyChange() {
    for (const listener of this.changeListeners) listener();
  }

  // A status line for the log that isn't tied to a sound.
  report(message) {
    for (const listener of this.listeners) listener({ layer: 'system', message });
  }

  reportFault(layer, error) {
    console.error(error);
    const message = `FAULT ${layer.toUpperCase()}: ${error.message}`;
    for (const listener of this.listeners) listener({ layer, message });
  }

  emitEvent(layer, time, message) {
    this.scheduler.notify(time, () => {
      for (const listener of this.listeners) listener({ layer, message });
    });
  }
}
