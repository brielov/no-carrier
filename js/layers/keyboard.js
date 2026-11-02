import { Layer } from './layer.js';
import { logNormal, pick, rand, randRange, varyDb } from '../random.js';

// Someone, or something, typing a command in the next room. The log shows
// what was typed, and each character is a real keystroke.
export class KeyboardLayer extends Layer {
  static id = 'keyboard';
  static bus = 'machine';
  static placed = true;
  static triggerLabels = ['TYPE'];

  start() {
    const { meanIdleSec, minIdleSec, pan } = this.cfg;
    this.dest = this.panned(pan);
    this.events(meanIdleSec, minIdleSec, (time) => this.type(time));
  }

  triggers() {
    return { TYPE: (time) => this.type(time) };
  }

  previewModel(time) {
    this.type(time);
  }

  type(time) {
    const { commands, keyGapSec, wordPauseSec, returnPauseSec, spaceBar, returnKey } = this.cfg;
    const command = pick(commands);
    const keys = command.length + 1; // the extra one is RETURN
    const gap = (index) => {
      const typed = logNormal(keyGapSec);
      if (index === keys - 2) return typed + randRange(returnPauseSec);
      return command[index] === ' ' ? typed + randRange(wordPauseSec) : typed;
    };
    const press = (at, index) => {
      if (index === keys - 1) {
        this.press(at, returnKey);
        this.event(at, `TERM 2 > ${command}`);
      } else {
        this.press(at, command[index] === ' ' ? spaceBar : {});
      }
    };
    this.series(time, keys, gap, press);
  }

  press(time, key) {
    const clips = this.modelSamples(key.level ? 'heavy' : 'key');
    if (clips.length) this.pressRecorded(time, clips, key);
    else this.pressSynth(time, key);
  }

  // Never the same clip twice running: that is what makes samples sound fake.
  pressRecorded(time, clips, { level = 1 }) {
    const { models, recording } = this.cfg;
    const { gain, pitchVary, levelVaryDb } = recording;
    const others = clips.filter((clip) => clip !== this.lastClip);
    this.lastClip = pick(others.length ? others : clips);
    const model = models.find(({ id }) => id === this.lastClip.model);
    this.playSample(time, this.lastClip, {
      gain: varyDb(gain * model.gain * level, levelVaryDb),
      pitch: rand(1 - pitchVary, 1 + pitchVary),
      dest: this.dest,
    });
  }

  pressSynth(time, { level = 1, pitch = 1 }) {
    const { hitGain, levelVaryDb, pitchVary, bottom, release } = this.cfg;
    const gain = varyDb(hitGain * level, levelVaryDb);
    const tuned = pitch * rand(1 - pitchVary, 1 + pitchVary);
    const dest = this.dest;
    this.hit(time, 'keyB', { gain, pitch: tuned, dest });
    this.hit(time + randRange(bottom.gapSec), 'keyF', { gain: gain * bottom.level, pitch: tuned, dest });
    this.hit(time + randRange(release.gapSec), 'keyF', {
      gain: gain * release.level,
      pitch: tuned * release.pitch,
      dest,
    });
  }
}
