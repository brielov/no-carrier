import type { LoadedSample, SampleEntry } from './types';

// Optional recordings, listed in samples/manifest.json by layer. Everything
// works without them: a layer with no samples uses its synthesized sound.
// Served as-is from public/samples, so files keep their names.
const SAMPLES = `${import.meta.env.BASE_URL}samples/`;
const MANIFEST = `${SAMPLES}manifest.json`;

type Manifest = Record<string, SampleEntry[]>;

export class SampleBank {
  readonly ctx: BaseAudioContext;
  private readonly layers = new Map<string, SampleEntry[]>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
  }

  // One failed file only loses that file; a missing manifest loses nothing.
  async load(): Promise<void> {
    let manifest: Manifest;
    try {
      const response = await fetch(MANIFEST);
      if (!response.ok) return;
      manifest = (await response.json()) as Manifest;
    } catch {
      return;
    }
    await Promise.all(
      Object.entries(manifest).map(async ([layer, entries]) => {
        // Lazy entries are listed now and fetched the first time they play.
        const loaded = await Promise.all(entries.map((entry) => (entry.lazy ? { ...entry } : this.decode(entry))));
        this.layers.set(layer, loaded.filter((entry): entry is SampleEntry => entry !== null));
      }),
    );
  }

  private async decode(entry: SampleEntry): Promise<LoadedSample | null> {
    try {
      const response = await fetch(`${SAMPLES}${entry.file}`);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      return { ...entry, buffer };
    } catch {
      return null;
    }
  }

  // Make sure a lazy entry has its audio. Resolves to false if it can't load.
  async ready(entry: SampleEntry): Promise<boolean> {
    if (entry.buffer) return true;
    entry.loading ??= this.decode(entry).then((loaded) => {
      entry.buffer = loaded?.buffer;
      return Boolean(entry.buffer);
    });
    return entry.loading;
  }

  // Entries for a layer matching every given field, e.g. { model: 'pc' }.
  find(layer: string, match: Partial<Record<keyof SampleEntry, unknown>> = {}): SampleEntry[] {
    const entries = this.layers.get(layer) ?? [];
    return entries.filter((entry) =>
      Object.entries(match).every(([key, value]) => entry[key as keyof SampleEntry] === value),
    );
  }

  // Only entries whose audio has loaded. Lazy entries appear once played.
  loaded(layer: string, match: Partial<Record<keyof SampleEntry, unknown>> = {}): LoadedSample[] {
    return this.find(layer, match).filter((entry): entry is LoadedSample => entry.buffer !== undefined);
  }
}
