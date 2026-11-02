import { CONFIG } from './config';
import { Engine } from './engine';

const RENDER_RATE = 48000;
const RENDER_STEP_SEC = 0.25; // how often the offline copy's clock ticks
const FILE_FADE_SEC = 1; // a short fade at each end of a rendered file

// Formats the browser can record, best first. Safari only offers MP4.
const LIVE_FORMATS: [mimeType: string, extension: string][] = [
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/mp4', 'm4a'],
];

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}

function download(blob: Blob, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

// What a render of `minutes` will cost: the audio held in memory while it
// renders, plus the WAV built from it, and the file itself.
export function renderCost(minutes: number): { memoryGB: number; fileMB: number } {
  const frames = minutes * 60 * RENDER_RATE;
  const memory = frames * 2 * 4 + frames * 2 * 2;
  const file = frames * 2 * 2 + 44;
  return { memoryGB: memory / 1e9, fileMB: file / 1e6 };
}

// 16-bit stereo WAV, written in slices so no single giant buffer is needed.
function encodeWav(buffer: AudioBuffer): Blob {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const frames = buffer.length;
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string): void => [...value].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 2, true);
  header.setUint32(24, buffer.sampleRate, true);
  header.setUint32(28, buffer.sampleRate * 4, true);
  header.setUint16(32, 4, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, frames * 4, true);

  const parts: BlobPart[] = [header];
  const slice = 1 << 20;
  for (let start = 0; start < frames; start += slice) {
    const end = Math.min(frames, start + slice);
    const pcm = new Int16Array((end - start) * 2);
    for (let i = start, j = 0; i < end; i += 1, j += 2) {
      pcm[j] = Math.max(-1, Math.min(1, left[i])) * 0x7fff;
      pcm[j + 1] = Math.max(-1, Math.min(1, right[i])) * 0x7fff;
    }
    parts.push(pcm);
  }
  return new Blob(parts, { type: 'audio/wav' });
}

// Rendering pauses the offline copy every quarter second to run its schedule,
// which only some browsers allow (Chrome, Edge and other Chromium browsers).
export const canRender = typeof OfflineAudioContext !== 'undefined' && typeof OfflineAudioContext.prototype.suspend === 'function';

export class Recorder {
  readonly engine: Engine;
  live: { recorder: MediaRecorder; end: number } | null = null;
  rendering = false;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  get busy(): boolean {
    return Boolean(this.live) || this.rendering;
  }

  // LIVE: capture what is playing, as it plays. Safe on any device.
  startLive(minutes: number, onDone?: () => void): boolean {
    const { engine } = this;
    if (this.busy || !engine.powered) return false;
    const [mimeType, extension] = LIVE_FORMATS.find(([type]) => MediaRecorder.isTypeSupported(type)) ?? ['', 'webm'];
    const tap = new MediaStreamAudioDestinationNode(engine.ctx as AudioContext);
    engine.master.power.connect(tap);
    const recorder = new MediaRecorder(tap.stream, { mimeType, audioBitsPerSecond: 160000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = ({ data }) => {
      if (data.size) chunks.push(data);
    };
    recorder.onstop = () => {
      engine.master.power.disconnect(tap);
      download(new Blob(chunks, { type: recorder.mimeType }), `no-carrier-${stamp()}-live.${extension}`);
      engine.report('RECORDING SAVED');
      this.live = null;
      onDone?.();
    };
    recorder.start(10000);
    this.live = { recorder, end: Date.now() + minutes * 60000 };
    engine.report(`RECORDING ${minutes} MIN`);
    return true;
  }

  stopLive(): void {
    if (this.live?.recorder.state === 'recording') this.live.recorder.stop();
  }

  liveRemaining(): number | null {
    return this.live ? Math.max(0, (this.live.end - Date.now()) / 1000) : null;
  }

  // Called every second by the UI: ends a live recording on time, or if the
  // power goes off under it.
  check(): void {
    if (this.live && (this.liveRemaining() === 0 || !this.engine.powered)) this.stopLive();
  }

  // RENDER: a separate copy of the engine, with today's settings, runs
  // faster than real time. Holds the whole recording in memory first.
  async render(minutes: number, onProgress?: (share: number) => void): Promise<void> {
    if (this.busy) return;
    this.rendering = true;
    const seconds = minutes * 60;
    this.engine.report(`RENDERING ${minutes} MIN`);
    try {
      const ctx = new OfflineAudioContext(2, seconds * RENDER_RATE, RENDER_RATE);
      const copy = new Engine(CONFIG);
      copy.restore(structuredClone(this.engine.settings));
      copy.story.state = structuredClone(copy.story.state);
      copy.story.save = () => {}; // a render must not change your listening history
      copy.build(ctx);
      await copy.samples.load();
      copy.powered = true;
      copy.master.power.gain.setValueAtTime(0, 0);
      copy.master.power.gain.linearRampToValueAtTime(1, FILE_FADE_SEC);
      copy.master.power.gain.setValueAtTime(1, seconds - FILE_FADE_SEC);
      copy.master.power.gain.linearRampToValueAtTime(0, seconds);
      copy.scheduler.tick();

      const tick = (at: number): void => {
        ctx.suspend(at).then(() => {
          copy.scheduler.tick();
          onProgress?.(at / seconds);
          if (at + RENDER_STEP_SEC < seconds - 0.05) tick(at + RENDER_STEP_SEC);
          ctx.resume();
        });
      };
      tick(RENDER_STEP_SEC);
      const buffer = await ctx.startRendering();
      onProgress?.(1);
      download(encodeWav(buffer), `no-carrier-${stamp()}-${minutes}min.wav`);
      this.engine.report('RENDER SAVED');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.engine.report(`RENDER FAILED: ${message.toUpperCase()}`);
    } finally {
      this.rendering = false;
    }
  }
}
