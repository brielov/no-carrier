import type { LayerConfigs } from '../config';
import type { LoadedSample } from '../types';
import { Layer, type Triggers } from './layer';
import { logNormal, pick, rand, randRange, varyDb } from '../random';

interface Key {
  level?: number;
  pitch?: number;
}

// Someone, or something, typing a command in the next room. The log shows
// what was typed, and each character is a real keystroke.
export class KeyboardLayer extends Layer<LayerConfigs['keyboard']> {
  static override readonly id = 'keyboard';
  static override readonly bus = 'machine';
  static override readonly placed = true;
  static override readonly triggerLabels = ['TYPE'];

  dest!: GainNode;
  lastClip?: LoadedSample;

  override start(): void {
    const { meanIdleSec, minIdleSec, pan } = this.cfg;
    this.dest = this.panned(pan);
    this.events(meanIdleSec, minIdleSec, (time) => this.type(time));
  }

  override triggers(): Triggers {
    return { TYPE: (time: number) => this.type(time) };
  }

  override previewModel(time: number): void {
    this.type(time);
  }

  type(time: number): void {
    const { commands, keyGapSec, wordPauseSec, returnPauseSec, spaceBar, returnKey } = this.cfg;
    const command = pick(commands);
    const keys = command.length + 1; // the extra one is RETURN
    const gap = (index: number): number => {
      const typed = logNormal(keyGapSec);
      if (index === keys - 2) return typed + randRange(returnPauseSec);
      return command[index] === ' ' ? typed + randRange(wordPauseSec) : typed;
    };
    const press = (at: number, index: number): void => {
      if (index === keys - 1) {
        this.press(at, returnKey);
        this.event(at, `TERM 2 > ${command}`);
      } else {
        this.press(at, command[index] === ' ' ? spaceBar : {});
      }
    };
    this.series(time, keys, gap, press);
  }

  press(time: number, key: Key): void {
    const clips = this.modelSamples(key.level ? 'heavy' : 'key');
    if (clips.length) this.pressRecorded(time, clips, key);
    else this.pressSynth(time, key);
  }

  // Never the same clip twice running: that is what makes samples sound fake.
  pressRecorded(time: number, clips: LoadedSample[], { level = 1 }: Key): void {
    const { models, recording } = this.cfg;
    const { gain, pitchVary, levelVaryDb } = recording;
    const others = clips.filter((clip) => clip !== this.lastClip);
    const clip = pick(others.length ? others : clips);
    this.lastClip = clip;
    const model = models.find(({ id }) => id === clip.model);
    this.playSample(time, clip, {
      gain: varyDb(gain * model!.gain * level, levelVaryDb),
      pitch: rand(1 - pitchVary, 1 + pitchVary),
      dest: this.dest,
    });
  }

  pressSynth(time: number, { level = 1, pitch = 1 }: Key): void {
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
