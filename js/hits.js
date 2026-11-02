// Mechanical hits, synthesized from recipes measured off real recordings.
//
// A struck object rings at a few fixed frequencies, each dying at its own
// rate, on top of a very short burst of broadband noise. A recipe lists both:
//
//   modes: [[hz, gain, t60], ...]    ringing partials
//   noise: [[hz, gain, t60], ...]    noise bands (octave wide)
//
// t60 is the seconds taken to fall by 60 dB. Rendering this per event would
// take a dozen nodes, so each recipe is rendered once into a few slightly
// different variants, and events just play one back.

const TWO_PI = Math.PI * 2;
const DECAY = Math.log(1000); // 60 dB

function addMode(out, sampleRate, [hz, gain, t60], detune) {
  const step = (TWO_PI * hz * detune) / sampleRate;
  const fall = Math.exp(-DECAY / (t60 * sampleRate));
  const phase = Math.random() * TWO_PI;
  let amp = gain;
  for (let i = 0; i < out.length; i += 1) {
    out[i] += amp * Math.sin(step * i + phase);
    amp *= fall;
  }
}

// White noise through a resonant band filter, then an exponential fall.
function addNoiseBand(out, sampleRate, [hz, gain, t60]) {
  const f = 2 * Math.sin((Math.PI * Math.min(hz, sampleRate / 6)) / sampleRate);
  const damp = 1 / 1.4; // about an octave wide
  const fall = Math.exp(-DECAY / (t60 * sampleRate));
  let low = 0;
  let band = 0;
  let amp = gain;
  for (let i = 0; i < out.length; i += 1) {
    const high = Math.random() * 2 - 1 - low - damp * band;
    band += f * high;
    low += f * band;
    out[i] += amp * band;
    amp *= fall;
  }
}

// One variant as a Float32Array, peak-normalised, with clean ends.
export function renderHit({ modes, noise, lengthSec, detuneSpread = 0.012 }, sampleRate) {
  const out = new Float32Array(Math.round(lengthSec * sampleRate));
  for (const mode of modes) addMode(out, sampleRate, mode, 1 + (Math.random() * 2 - 1) * detuneSpread);
  for (const band of noise) addNoiseBand(out, sampleRate, band);

  const rise = Math.round(0.0003 * sampleRate);
  for (let i = 0; i < rise; i += 1) out[i] *= i / rise;
  const tail = Math.round(0.01 * sampleRate);
  for (let i = 0; i < tail; i += 1) out[out.length - 1 - i] *= i / tail;

  const peak = out.reduce((max, value) => Math.max(max, Math.abs(value)), 1e-9);
  for (let i = 0; i < out.length; i += 1) out[i] /= peak;
  return out;
}

export class HitBank {
  constructor(ctx, recipes, variants) {
    this.ctx = ctx;
    this.recipes = recipes;
    this.variants = variants;
    this.banks = new Map();
  }

  // Buffers are made on first use and shared from then on.
  buffers(name) {
    if (!this.banks.has(name)) {
      const { sampleRate } = this.ctx;
      const buffers = Array.from({ length: this.variants }, () => {
        const data = renderHit(this.recipes[name], sampleRate);
        const buffer = this.ctx.createBuffer(1, data.length, sampleRate);
        buffer.copyToChannel(data, 0);
        return buffer;
      });
      this.banks.set(name, buffers);
    }
    return this.banks.get(name);
  }
}
