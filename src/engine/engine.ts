import type { Config } from './config';
import type { Layer, LayerClass, LayerConfig } from './layers/layer';
import type { EngineEvent, Position, Settings } from './types';
import { Director } from './director';
import { HitBank } from './hits';
import { Age, Distance, createMasterBus, type MasterBus } from './effects';
import { NoiseBank } from './noise';
import { PowerSequence } from './power';
import { RECIPES, type RecipeName } from './recipes';
import { SampleBank } from './samples';
import { Story } from './story';
import { Scheduler } from './scheduler';
import { BroadcastLayer, CarrierLayer, MorseLayer, TeleprinterLayer, TimeSignalLayer } from './layers/radio';
import { AntennaLayer, HydroponicsLayer, LifeSupportLayer, ThrustersLayer } from './layers/systems';
import { SignalLayer } from './layers/signal';
import { AirLayer } from './layers/air';
import { BeepLayer } from './layers/beeps';
import { DriveLayer } from './layers/drive';
import { DroneLayer } from './layers/drone';
import { HullLayer } from './layers/hull';
import { HumLayer } from './layers/hum';
import { KeyboardLayer } from './layers/keyboard';
import { ModemLayer } from './layers/modem';
import { PrinterLayer } from './layers/printer';
import { RelayLayer } from './layers/relay';
import { TapeLayer } from './layers/tape';

const LAYERS: readonly LayerClass[] = [HumLayer, AirLayer, HullLayer, LifeSupportLayer, HydroponicsLayer, DriveLayer, TapeLayer, RelayLayer, KeyboardLayer, BeepLayer, PrinterLayer, ModemLayer, SignalLayer, MorseLayer, TeleprinterLayer, CarrierLayer, BroadcastLayer, TimeSignalLayer, AntennaLayer, DroneLayer, ThrustersLayer];

// Layers that other parts of the engine talk to by name.
export interface LayerTypes {
  hum: HumLayer;
  air: AirLayer;
  drive: DriveLayer;
  tape: TapeLayer;
  beeps: BeepLayer;
  printer: PrinterLayer;
  signal: SignalLayer;
  antenna: AntennaLayer;
  relay: RelayLayer;
  hull: HullLayer;
  keyboard: KeyboardLayer;
  modem: ModemLayer;
  drone: DroneLayer;
}

type Buses = Record<'machine' | 'room' | 'outside', AudioNode> & { sky?: AudioNode };
type Listener = (event: EngineEvent) => void;

export class Engine {
  readonly cfg: Config;
  ctx: BaseAudioContext | null = null;
  powered = false;
  voices = 0; // one-shot sounds currently alive
  operating = true; // false while booting or shutting down: no random events
  epoch = 0; // counts shutdowns, so work in progress knows to stop
  readonly layers = new Map<string, Layer>();
  settings: Settings;
  readonly defaults: Settings;
  readonly director: Director;
  readonly sequence: PowerSequence;
  readonly story: Story;

  // Made by build(), on the audio context.
  scheduler!: Scheduler;
  noise!: NoiseBank;
  hits!: HitBank<RecipeName>;
  samples!: SampleBank;
  master!: MasterBus;
  distance!: Distance;
  age!: Age;
  buses!: Buses;

  private readonly listeners = new Set<Listener>();
  private readonly changeListeners = new Set<() => void>();
  private readonly flashListeners = new Set<(layer: string) => void>();
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(cfg: Config) {
    this.cfg = cfg;
    const layerCfg = (id: string) => (cfg.layers as Record<string, LayerConfig>)[id];

    // The one place current settings live. Knobs write here, the audio graph
    // reads from here, so settings can be changed before power on.
    this.settings = {
      master: cfg.master.defaultVolume,
      macros: Object.fromEntries(Object.entries(cfg.macros).map(([name, { value }]) => [name, value])),
      mains: cfg.layers.hum.defaultMains,
      layers: Object.fromEntries(
        LAYERS.map(({ id }) => [id, { level: layerCfg(id).defaultLevel, muted: false, rate: 0.5 }]),
      ),
      preset: null,
      drift: false,
      showLog: true,
      showDiag: false,
      positions: Object.fromEntries(
        LAYERS.filter(({ placed }) => placed).map(({ id }) => [id, { pan: 0, dist: 0, ...layerCfg(id).position }]),
      ),
      models: Object.fromEntries(
        LAYERS.filter(({ id }) => layerCfg(id).models).map(({ id }) => [id, layerCfg(id).defaultModel ?? '']),
      ),
    };
    this.defaults = structuredClone(this.settings);
    this.director = new Director(this);
    this.sequence = new PowerSequence(this);
    this.story = new Story(this);
  }

  // Take settings loaded from storage. Only for use before power on.
  // The context, for code that only runs once it exists.
  get audio(): BaseAudioContext {
    if (!this.ctx) throw new Error('No audio context yet');
    return this.ctx;
  }

  restore(settings: Settings): void {
    this.settings = structuredClone(settings);
    this.director.sync();
  }

  // Build the whole graph on a context. Must happen after a user gesture for
  // a live context; an offline one can be passed in for rendering.
  build(ctx: BaseAudioContext): void {
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
        const bus = this.buses[LayerClass.bus];
        if (!bus) throw new Error(`no ${LayerClass.bus} bus`);
        const layer = new LayerClass(this, LayerClass.id, bus);
        this.layers.set(LayerClass.id, layer);
        layer.start();
        if (layer instanceof SignalLayer) this.buses.sky = layer.sky; // where radio parts play
      } catch (error) {
        this.reportFault(LayerClass.id, error as Error);
      }
    }
    this.director.attach();
    this.story.start();
  }

  // A layer by name, typed for the layers that are talked to directly.
  layer<K extends keyof LayerTypes>(id: K): LayerTypes[K] | undefined;
  layer(id: string): Layer | undefined;
  layer(id: string): Layer | undefined {
    return this.layers.get(id);
  }

  async powerOn(): Promise<void> {
    if (this.powered) return;
    this.powered = true;
    clearTimeout(this.suspendTimer);
    if (!this.ctx) {
      this.build(new AudioContext({ latencyHint: this.cfg.engine.latencyHint }));
      await this.samples.load();
    }
    const ctx = this.ctx as AudioContext;
    await ctx.resume();
    this.master.sleep.gain.cancelScheduledValues(ctx.currentTime);
    this.master.sleep.gain.setValueAtTime(1, ctx.currentTime);
    this.sequence.start(ctx.currentTime + this.cfg.engine.lookIn); // switches all off first
    this.scheduler.start();
    this.fadePower(1, this.cfg.engine.fadeInTc);
  }

  powerOff(): void {
    if (!this.powered) return;
    this.powered = false;
    this.director.sleepEnd = null;
    this.epoch += 1;
    const { fadeOutTc } = this.cfg.engine;
    const ctx = this.ctx as AudioContext;
    const seconds = this.sequence.stop(ctx.currentTime + 0.02);
    this.suspendTimer = setTimeout(() => {
      this.fadePower(0, fadeOutTc);
      this.suspendTimer = setTimeout(() => {
        this.scheduler.stop();
        ctx.suspend();
      }, fadeOutTc * 6000);
    }, seconds * 1000);
  }

  fadePower(target: number, tc: number): void {
    const { gain } = this.master.power;
    const now = this.audio.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(target, now, tc);
  }

  applyMasterVolume(): void {
    const k = this.settings.master;
    this.master.volume.gain.setTargetAtTime(k * k, this.audio.currentTime, this.cfg.engine.knobTc);
  }

  applyEffects(tc: number): void {
    this.distance.apply(this.settings.macros.distance, tc);
    this.age.apply(this.settings.macros.age, tc);
  }

  // Activity is read live by the layers, so it needs no pushing out.
  setMacro(name: string, value: number): void {
    this.settings.macros[name] = value;
    if (!this.ctx) return;
    const tc = this.cfg.engine.macroTc;
    if (name === 'distance') this.distance.apply(value, tc);
    if (name === 'age') this.age.apply(value, tc);
    if (name === 'signal') this.layer('signal')?.applyPresence();
  }

  // Set a value by its path, such as 'macros.age' or 'layers.drive.level'.
  setValue(path: string, value: number): void {
    const [group, name, field] = path.split('.');
    if (group === 'master') this.setMasterVolume(value);
    else if (group === 'macros') this.setMacro(name, value);
    else if (field === 'level') this.setLayerLevel(name, value);
    else this.setLayerRate(name, value);
  }

  setMasterVolume(value: number): void {
    this.settings.master = value;
    if (this.ctx) this.applyMasterVolume();
  }

  setLayerLevel(id: string, level: number): void {
    this.settings.layers[id].level = level;
    this.layers.get(id)?.applyGain();
  }

  setLayerMuted(id: string, muted: boolean): void {
    this.settings.layers[id].muted = muted;
    this.layers.get(id)?.applyGain();
  }

  setLayerRate(id: string, rate: number): void {
    this.settings.layers[id].rate = rate;
  }

  // Move a machine on the room plan.
  setPosition(id: string, position: Position): void {
    this.settings.positions[id] = position;
    this.layers.get(id)?.applyPosition(this.cfg.engine.macroTc);
    this.notifyChange();
  }

  // Choose a real machine for a layer, and play something so it can be heard.
  setModel(id: string, model: string): void {
    this.settings.models[id] = model;
    this.notifyChange();
    if (!this.powered || !this.operating) return;
    this.layers.get(id)?.previewModel(this.audio.currentTime + 0.03);
    this.scheduler.tick();
  }

  // Fire a named manual trigger now. Ignored unless the ship is fully up.
  trigger(id: string, label: string): void {
    if (!this.powered || !this.operating) return;
    this.layers.get(id)?.triggers()[label]?.(this.audio.currentTime + 0.03);
    this.scheduler.tick();
  }

  // What each layer offers, for building the UI before the graph exists.
  layerInfo(): { id: string; placed: boolean; triggerLabels: readonly string[] }[] {
    return LAYERS.map(({ id, placed, triggerLabels }) => ({ id, placed, triggerLabels }));
  }

  setMains(hz: 50 | 60): void {
    this.settings.mains = hz;
    this.layer('hum')?.setMains(hz);
  }

  on(listener: Listener): void {
    this.listeners.add(listener);
  }

  onFlash(listener: (layer: string) => void): void {
    this.flashListeners.add(listener);
  }

  // Blink a layer's lamp when a sound placed at `time` is heard.
  flash(layer: string, time: number): void {
    if (!this.flashListeners.size) return;
    this.scheduler.notify(time, () => {
      for (const listener of this.flashListeners) listener(layer);
    });
  }

  onChange(listener: () => void): void {
    this.changeListeners.add(listener);
  }

  notifyChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  // A status line for the log that isn't tied to a sound.
  report(message: string): void {
    for (const listener of this.listeners) listener({ layer: 'system', message });
  }

  reportFault(layer: string, error: Error): void {
    console.error(error);
    const message = `FAULT ${layer.toUpperCase()}: ${error.message}`;
    for (const listener of this.listeners) listener({ layer, message });
  }

  emitEvent(layer: string, time: number, message: string): void {
    this.scheduler.notify(time, () => {
      for (const listener of this.listeners) listener({ layer, message });
    });
  }
}
