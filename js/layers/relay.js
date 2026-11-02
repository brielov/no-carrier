import { Layer } from './layer.js';
import { rand, randInt, randRange, varyDb } from '../random.js';

const BANKS = 'ABCD';

// Sparse relay clicks, alone or in small clusters. Each cluster sits at its
// own spot, as though one rack were switching.
export class RelayLayer extends Layer {
  static id = 'relay';
  static bus = 'machine';
  static placed = true;
  static triggerLabels = ['CLICK'];

  start() {
    const { meanIdleSec, minIdleSec, panWidth } = this.cfg;
    this.positions = [-panWidth, -panWidth / 3, panWidth / 3, panWidth].map((pan) => this.panned(pan));
    this.events(meanIdleSec, minIdleSec, (time) => this.cluster(time));
  }

  triggers() {
    return { CLICK: (time) => this.cluster(time) };
  }

  cluster(time) {
    const { cluster } = this.cfg;
    const bank = Math.floor(rand(0, this.positions.length));
    const dest = this.positions[bank];
    const clicks = randInt(cluster.clicks);
    const state = clicks % 2 ? 'CLOSED' : 'OPEN';
    this.event(time, `RELAY ${BANKS[bank]}${randInt({ min: 1, max: 16 })} ${state}`);
    this.series(time, clicks, () => this.burstGap(cluster), (at) => this.click(at, dest));
  }

  click(time, dest) {
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
}
