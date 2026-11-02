import type { LayerConfigs } from '../config';
import { Layer } from './layer';

// Very low, very slow, wide. A few unrelated tones and some deep filtered
// noise, each wandering on its own, so the sound never settles into a chord.
export class DroneLayer extends Layer<LayerConfigs['drone']> {
  static override readonly id = 'drone';
  static override readonly bus = 'outside';

  override start(): void {
    const { ctx, cfg, noise } = this;
    for (const { hz, gain, pan, detuneCents, levelDrift } of cfg.tones) {
      const osc = new OscillatorNode(ctx, { frequency: hz });
      const amp = new GainNode(ctx);
      osc.connect(amp).connect(this.panned(pan));
      this.drift(osc.detune, detuneCents);
      this.drift(amp.gain, levelDrift, (value) => value * gain);
      osc.start();
    }

    const { lowpassHz, gain, pan, ampDrift } = cfg.rumble;
    const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.7 });
    const amp = new GainNode(ctx);
    noise.loop('brown').connect(lowpass).connect(amp).connect(this.panned(pan));
    this.drift(lowpass.frequency, lowpassHz);
    this.drift(amp.gain, ampDrift, (value) => value * gain);
  }
}
