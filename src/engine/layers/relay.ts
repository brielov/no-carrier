import type { LayerConfigs } from '../config';
import type { LoadedSample } from '../types';
import { Layer, type Triggers } from './layer';
import { pick, rand, randInt, randRange, varyDb } from '../random';

const BANKS = 'ABCD';

// Sparse relay clicks, alone or in small clusters. Each cluster sits at its
// own spot, as though one rack were switching.
export class RelayLayer extends Layer<LayerConfigs['relay']> {
  static override readonly id = 'relay';
  static override readonly bus = 'machine';
  static override readonly placed = true;
  static override readonly triggerLabels = ['CLICK'];

  positions!: GainNode[];
  private lastClip?: LoadedSample;

  override start(): void {
    const { meanIdleSec, minIdleSec, panWidth } = this.cfg;
    this.positions = [-panWidth, -panWidth / 3, panWidth / 3, panWidth].map((pan) => this.panned(pan));
    this.events(meanIdleSec, minIdleSec, (time) => this.cluster(time));
  }

  override triggers(): Triggers {
    return { CLICK: (time: number) => this.cluster(time) };
  }

  override previewModel(time: number): void {
    this.cluster(time);
  }

  cluster(time: number): void {
    const { cluster } = this.cfg;
    const bank = Math.floor(rand(0, this.positions.length));
    const dest = this.positions[bank];
    const clicks = randInt(cluster.clicks);
    const state = clicks % 2 ? 'CLOSED' : 'OPEN';
    this.event(time, `RELAY ${BANKS[bank]}${randInt({ min: 1, max: 16 })} ${state}`);
    this.series(time, clicks, () => this.burstGap(cluster), (at) => this.click(at, dest));
  }

  click(time: number, dest: AudioNode): void {
    const clips = this.modelSamples('click');
    if (clips.length) {
      this.clickRecorded(time, dest, clips);
      return;
    }
    const { hitGain, levelVaryDb, pitchVary, bounce } = this.cfg;
    const pitch = rand(1 - pitchVary, 1 + pitchVary);
    let gain = varyDb(hitGain, levelVaryDb);
    let at = time;
    this.hit(at, 'relay', { gain, pitch, dest });
    const bounces = randInt(bounce.count);
    for (let i = 0; i < bounces; i += 1) {
      at += randRange(bounce.gapSec);
      gain *= bounce.decay;
      this.hit(at, 'relay', { gain, pitch: pitch * 1.06, dest });
    }
  }

  // A real relay. Never the same click twice running.
  clickRecorded(time: number, dest: AudioNode, clips: LoadedSample[]): void {
    const { recording, levelVaryDb, models } = this.cfg;
    const others = clips.filter((clip) => clip !== this.lastClip);
    const clip = pick(others.length ? others : clips);
    this.lastClip = clip;
    const trim = models.find(({ id }) => id === clip.model)?.gain ?? 1;
    this.playSample(time, clip, {
      gain: varyDb(recording.gain * trim, levelVaryDb),
      pitch: rand(1 - recording.pitchVary, 1 + recording.pitchVary),
      dest,
    });
  }
}
