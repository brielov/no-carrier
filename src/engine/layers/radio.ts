import type { LayerConfigs } from '../config';
import type { SignalLayer } from './signal';
import { Layer, type LayerConfig, type Triggers } from './layer';

// Settings every radio part has.
interface RadioConfig extends LayerConfig {
  meanIdleSec: number;
  minIdleSec: number;
}

// What the receiver can pick up, one layer each, so each has its own level,
// rate, mute and lamp. The sound itself is made by the receiver (signal.js),
// which plays it through its shared channel, fading and squelch.
abstract class RadioPart<C extends RadioConfig = RadioConfig> extends Layer<C> {
  static override readonly bus = 'sky';
  static override readonly triggerLabels = ['TUNE IN'];

  get receiver(): SignalLayer | undefined {
    return this.engine.layer('signal');
  }

  abstract tuneIn(time: number): void;

  override start(): void {
    const { meanIdleSec, minIdleSec } = this.cfg;
    // The Signal macro sets how often the receiver almost catches something.
    const almost = () => this.macroScale('signal');
    this.events(meanIdleSec, minIdleSec, (time) => {
      if (!this.receiver?.onAir) this.tuneIn(time);
    }, almost);
  }

  override triggers(): Triggers {
    return { 'TUNE IN': (time: number) => this.tuneIn(time) };
  }
}

export class MorseLayer extends RadioPart<LayerConfigs['morse']> {
  static override readonly id = 'morse';

  tuneIn(time: number): void {
    this.receiver?.morse(time, this);
  }
}

export class TeleprinterLayer extends RadioPart<LayerConfigs['teleprinter']> {
  static override readonly id = 'teleprinter';

  tuneIn(time: number): void {
    this.receiver?.data(time, this);
  }
}

export class CarrierLayer extends RadioPart<LayerConfigs['carrier']> {
  static override readonly id = 'carrier';

  tuneIn(time: number): void {
    this.receiver?.carrier(time, this);
  }
}

export class BroadcastLayer extends RadioPart<LayerConfigs['broadcast']> {
  static override readonly id = 'broadcast';

  tuneIn(time: number): void {
    this.receiver?.broadcast(time, this);
  }
}

export class TimeSignalLayer extends RadioPart<LayerConfigs['timesignal']> {
  static override readonly id = 'timesignal';

  tuneIn(time: number): void {
    this.receiver?.timeSignal(time, this);
  }
}
