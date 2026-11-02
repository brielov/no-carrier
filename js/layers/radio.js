import { Layer } from './layer.js';

// What the receiver can pick up, one layer each, so each has its own level,
// rate, mute and lamp. The sound itself is made by the receiver (signal.js),
// which plays it through its shared channel, fading and squelch.
class RadioPart extends Layer {
  static bus = 'sky';
  static triggerLabels = ['TUNE IN'];

  get receiver() {
    return this.engine.layers.get('signal');
  }

  start() {
    const { meanIdleSec, minIdleSec } = this.cfg;
    // The Signal macro sets how often the receiver almost catches something.
    const almost = () => this.macroScale('signal');
    this.events(meanIdleSec, minIdleSec, (time) => {
      if (!this.receiver?.onAir) this.tuneIn(time);
    }, almost);
  }

  triggers() {
    return { 'TUNE IN': (time) => this.tuneIn(time) };
  }
}

export class MorseLayer extends RadioPart {
  static id = 'morse';

  tuneIn(time) {
    this.receiver?.morse(time, this);
  }
}

export class TeleprinterLayer extends RadioPart {
  static id = 'teleprinter';

  tuneIn(time) {
    this.receiver?.data(time, this);
  }
}

export class CarrierLayer extends RadioPart {
  static id = 'carrier';

  tuneIn(time) {
    this.receiver?.carrier(time, this);
  }
}

export class BroadcastLayer extends RadioPart {
  static id = 'broadcast';

  tuneIn(time) {
    this.receiver?.broadcast(time, this);
  }
}
