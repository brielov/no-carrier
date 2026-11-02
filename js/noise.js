import { rand } from './random.js';

// Noise is generated once per colour and variant, then shared. Layers only
// ever create cheap playback nodes on top of these buffers.
const generators = {
  white(data) {
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  },

  // Paul Kellet's filter: a good match for -3 dB/octave.
  pink(data) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  },

  // Atmospheric crackle: random impulses, mostly tiny, now and then bigger.
  crackle(data, { crackleDensity, crackleTailSec }, sampleRate) {
    const fall = Math.exp(-1 / (crackleTailSec * sampleRate));
    const chance = crackleDensity / sampleRate;
    let tail = 0;
    for (let i = 0; i < data.length; i += 1) {
      if (Math.random() < chance) {
        const size = Math.min(Math.random() ** -0.7, 8);
        tail += size * (Math.random() < 0.5 ? -1 : 1);
      }
      data[i] = tail * (Math.random() * 2 - 1);
      tail *= fall;
    }
  },

  // Leaky integrator: -6 dB/octave, without the unbounded wander of pure brown.
  brown(data, { brownLeak }) {
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = (last + brownLeak * (Math.random() * 2 - 1)) / (1 + brownLeak);
      data[i] = last;
    }
  },
};

// Blend the tail into the head so the loop point has no seam. Equal-power,
// because the two ends are uncorrelated. Returns the shorter, loopable length.
function makeLoop(data, fade) {
  const length = data.length - fade;
  for (let i = 0; i < fade; i += 1) {
    const x = (i + 0.5) / fade;
    data[i] = data[i] * Math.sin(x * Math.PI * 0.5) + data[length + i] * Math.cos(x * Math.PI * 0.5);
  }
  return data.subarray(0, length);
}

function normalise(data, rms) {
  let mean = 0;
  for (let i = 0; i < data.length; i += 1) mean += data[i];
  mean /= data.length;
  let power = 0;
  for (let i = 0; i < data.length; i += 1) {
    data[i] -= mean;
    power += data[i] * data[i];
  }
  const gain = rms / Math.sqrt(power / data.length);
  for (let i = 0; i < data.length; i += 1) data[i] *= gain;
}

export class NoiseBank {
  constructor(ctx, cfg) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.buffers = new Map();
  }

  buffer(colour, variant = 0) {
    const key = `${colour}:${variant}`;
    if (!this.buffers.has(key)) this.buffers.set(key, this.render(colour, variant));
    return this.buffers.get(key);
  }

  render(colour, variant) {
    const { ctx, cfg } = this;
    const seconds = cfg[colour][variant % cfg[colour].length];
    const fade = Math.round(cfg.crossfadeSec * ctx.sampleRate);
    const raw = new Float32Array(Math.round(seconds * ctx.sampleRate) + fade);
    generators[colour](raw, cfg, ctx.sampleRate);
    const loop = makeLoop(raw, fade);
    normalise(loop, cfg.rms);
    const buffer = ctx.createBuffer(1, loop.length, ctx.sampleRate);
    buffer.copyToChannel(loop, 0);
    return buffer;
  }

  // A started, endlessly looping source at a random point in the buffer.
  loop(colour, variant = 0) {
    const buffer = this.buffer(colour, variant);
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    source.start(0, rand(0, buffer.duration));
    return source;
  }
}
