// Optional recordings, listed in samples/manifest.json by layer. Everything
// works without them: a layer with no samples uses its synthesized sound.
const MANIFEST = new URL('../samples/manifest.json', import.meta.url);

export class SampleBank {
  constructor(ctx) {
    this.ctx = ctx;
    this.layers = new Map();
  }

  // One failed file only loses that file; a missing manifest loses nothing.
  async load() {
    let manifest;
    try {
      const response = await fetch(MANIFEST);
      if (!response.ok) return;
      manifest = await response.json();
    } catch {
      return;
    }
    await Promise.all(
      Object.entries(manifest).map(async ([layer, entries]) => {
        const loaded = await Promise.all(entries.map((entry) => this.decode(entry)));
        this.layers.set(layer, loaded.filter(Boolean));
      }),
    );
  }

  async decode(entry) {
    try {
      const response = await fetch(new URL(`../samples/${entry.file}`, import.meta.url));
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      return { ...entry, buffer };
    } catch {
      return null;
    }
  }

  // Entries for a layer matching every given field, e.g. { unit: 'A' }.
  find(layer, match = {}) {
    const entries = this.layers.get(layer) ?? [];
    return entries.filter((entry) => Object.entries(match).every(([key, value]) => entry[key] === value));
  }
}
