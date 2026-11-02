// Balances the recordings in public/samples by writing a `gain` for each file
// into the manifest. The audio files themselves are never touched.
//
//   npm run levels            measure and write gains
//   npm run levels -- --check measure and report only
//
// Loudness is measured the way ears weight it (the K-weighting of ITU-R
// BS.1770, with the channels' energy added), over the loudest tenth of a
// second of each file. Most of these sounds are clicks and seeks, and ears
// judge those by their strongest moment, not by their tails. Continuous beds
// (STEADY) are judged by their average instead. Two rules:
//
// - Within a group (one layer, model and kind), takes keep their natural
//   variation up to SPREAD_DB either side of the group's average. Only
//   outliers are brought in.
// - Between models of the same kind, each model is matched to the median, so
//   choosing another model never jumps in level.
//
// Radio material is degraded on purpose and the power sounds are one of a
// kind, so neither is touched.

import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../public/samples/', import.meta.url);
const MANIFEST = new URL('manifest.json', ROOT);
const SKIP = new Set(['signal', 'power']);
const STEADY = new Set(['air:fan']); // layer:kind measured by their average loudness
const SPREAD_DB = 2.5;
const WINDOW_SEC = 0.1; // about how long ears take to judge a click's loudness
const HOP_SEC = 0.01;
const MIN_CHANGE_DB = 0.3; // smaller corrections aren't worth writing down

// Each channel's samples from a PCM or float WAV file.
function readWav(path) {
  const data = readFileSync(path);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let format;
  let offset = 12;
  while (offset < data.length - 8) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        type: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data' && format) {
      const { type, channels, rate, bits } = format;
      const width = bits / 8;
      const frames = Math.floor(size / (width * channels));
      const samples = Array.from({ length: channels }, () => new Float64Array(frames));
      for (let i = 0; i < frames; i += 1) {
        for (let c = 0; c < channels; c += 1) {
          const at = body + (i * channels + c) * width;
          let value = 0;
          if (type === 3) value = view.getFloat32(at, true);
          else if (bits === 16) value = view.getInt16(at, true) / 32768;
          else if (bits === 24) value = (view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)) / 8388608;
          else if (bits === 32) value = view.getInt32(at, true) / 2147483648;
          samples[c][i] = value;
        }
      }
      return { samples, rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: not a WAV file this script can read`);
}

function biquad(x, [b0, b1, b2, a0, a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

// The two K-weighting stages, worked out for any sample rate.
function kWeight(x, rate) {
  const shelf = (() => {
    const A = 10 ** (3.999843853973347 / 40);
    const w = (2 * Math.PI * 1681.974450955533) / rate;
    const alpha = Math.sin(w) / (2 * 0.7071752369554196);
    const c = Math.cos(w);
    const s = 2 * Math.sqrt(A) * alpha;
    return [A * (A + 1 + (A - 1) * c + s), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - s), A + 1 - (A - 1) * c + s, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - s];
  })();
  const highpass = (() => {
    const w = (2 * Math.PI * 38.13547087602444) / rate;
    const alpha = Math.sin(w) / (2 * 0.5003270373238773);
    const c = Math.cos(w);
    return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha];
  })();
  return biquad(biquad(x, shelf), highpass);
}

// Loudness in LUFS: of the loudest tenth of a second, or with `steady`, of
// the whole recording. Channels' energies add, as in BS.1770.
function loudness(path, steady) {
  const { samples, rate } = readWav(path);
  const length = samples[0].length;
  // Running sum of squares over all channels, so each window costs nothing.
  const squares = new Float64Array(length + 1);
  const weighted = samples.map((channel) => kWeight(channel, rate));
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const channel of weighted) sum += channel[i] * channel[i];
    squares[i + 1] = squares[i] + sum;
  }
  if (steady) return -0.691 + 10 * Math.log10(squares[length] / length);
  const size = Math.min(length, Math.max(1, Math.round(WINDOW_SEC * rate)));
  const hop = Math.max(1, Math.round(HOP_SEC * rate));
  let loudest = 0;
  for (let start = 0; start + size <= length; start += hop) {
    loudest = Math.max(loudest, (squares[start + size] - squares[start]) / size);
  }
  return -0.691 + 10 * Math.log10(loudest);
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

const check = process.argv.includes('--check');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const rows = [];

for (const [layer, entries] of Object.entries(manifest)) {
  if (SKIP.has(layer)) continue;
  const measured = entries.map((entry) => ({ entry, lufs: loudness(new URL(entry.file, ROOT), STEADY.has(`${layer}:${entry.kind}`)) }));

  // Bring outliers in towards their group's average.
  const groups = new Map();
  for (const item of measured) {
    const key = `${item.entry.model ?? '-'}:${item.entry.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const items of groups.values()) {
    const average = mean(items.map(({ lufs }) => lufs));
    for (const item of items) {
      const off = item.lufs - average;
      item.correction = Math.max(-SPREAD_DB, Math.min(SPREAD_DB, off)) - off;
    }
  }

  // Match each model to the median for the same kind.
  const kinds = new Map();
  for (const [key, items] of groups) {
    const [model, kind] = key.split(':');
    const level = mean(items.map(({ lufs, correction }) => lufs + correction));
    kinds.set(kind, [...(kinds.get(kind) ?? []), { model, level, items }]);
  }
  for (const [kind, models] of kinds) {
    const target = median(models.map(({ level }) => level));
    for (const { model, level, items } of models) {
      for (const item of items) item.correction += target - level;
      rows.push({ group: `${layer}:${model}:${kind}`, files: items });
    }
  }

  for (const { entry, correction } of measured) {
    if (Math.abs(correction) >= MIN_CHANGE_DB) entry.gain = round(10 ** (correction / 20), 3);
    else delete entry.gain;
  }
}

for (const { group, files } of rows) {
  const before = files.map(({ lufs }) => lufs);
  const after = files.map(({ lufs, correction }) => lufs + correction);
  const span = (values) => Math.max(...values) - Math.min(...values);
  console.log(
    `${group.padEnd(28)} ${String(files.length).padStart(3)} files   ${mean(before).toFixed(1)} -> ${mean(after).toFixed(1)} LUFS   spread ${span(before).toFixed(1)} -> ${span(after).toFixed(1)} dB`,
  );
}

if (check) {
  console.log('\nChecked only; nothing written.');
} else {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('\nGains written to public/samples/manifest.json.');
}
