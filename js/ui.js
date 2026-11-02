import { createKnob } from './knob.js';
import { PRESETS } from './presets.js';
import { Recorder, canRender, renderCost } from './recorder.js';
import { downloadSettings, sanitize } from './settings.js';

const MAX_LOG_LINES = 200;

const clock = (seconds) => {
  const s = Math.floor(seconds);
  const part = (n) => String(n).padStart(2, '0');
  return `${part(Math.floor(s / 3600))}:${part(Math.floor(s / 60) % 60)}:${part(s % 60)}`;
};

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Each control registers how to redraw itself, for when something other than
// a person moves it.
const redraws = [];
const lamps = new Map();

const ZONES = [
  { id: 'room', name: 'THIS ROOM', layers: ['hum', 'air', 'hull', 'lifesupport', 'hydroponics'] },
  { id: 'outside', name: 'OUTSIDE THE HULL', layers: ['drone', 'thrusters'] },
  { id: 'radio', name: 'RADIO', layers: ['signal', 'antenna', 'morse', 'teleprinter', 'carrier', 'broadcast', 'timesignal'] },
  { id: 'machines', name: 'MACHINES', layers: ['drive', 'tape', 'relay', 'keyboard', 'beeps', 'printer', 'modem'] },
];

function knob(options) {
  const control = createKnob(options);
  redraws.push(control.draw);
  return control.element;
}

function pressable(text, onClick, isPressed) {
  const button = element('button', { type: 'button', textContent: text });
  button.addEventListener('click', onClick);
  const draw = () => button.setAttribute('aria-pressed', String(isPressed()));
  draw();
  redraws.push(draw);
  return button;
}

// The rate as a multiple of normal, so a centred knob reads "x1.0".
function rateText(engine, rate) {
  if (rate === 0) return 'OFF';
  return `x${(engine.cfg.engine.rateRange ** (2 * rate - 1)).toFixed(1)}`;
}

function mainsKeys(engine) {
  const key = (hz) =>
    pressable(
      `${hz} HZ`,
      () => {
        engine.setMains(hz);
        engine.notifyChange();
      },
      () => engine.settings.mains === hz,
    );
  return [key(50), key(60)];
}

function addLamp(id) {
  const lamp = element('span', { className: 'lamp' }, element('span', { className: 'glow' }));
  lamps.set(id, [...(lamps.get(id) ?? []), lamp]);
  return lamp;
}

function modelKeys(engine, id, label) {
  const keys = engine.cfg.layers[id].models.map(({ id: model, label: text }) =>
    pressable(text, () => engine.setModel(id, model), () => engine.settings.models[id] === model),
  );
  const row = element('div', { className: 'triggers' }, ...keys);
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${label} model`);
  return row;
}

function layerModule(engine, { id, triggerLabels }, label) {
  const { director, defaults } = engine;
  const state = () => engine.settings.layers[id];
  const lamp = addLamp(id);
  const mute = pressable(
    'MUTE',
    () => {
      engine.setLayerMuted(id, !state().muted);
      engine.notifyChange();
    },
    () => state().muted,
  );
  mute.className = 'mute';
  mute.setAttribute('aria-label', `Mute ${label}`);

  const knobs = [
    knob({
      label: { text: 'LEVEL', aria: `${label} level` },
      read: () => state().level,
      write: (value) => director.touch(`layers.${id}.level`, value),
      home: () => defaults.layers[id].level,
    }),
  ];
  if (triggerLabels.length) {
    knobs.push(
      knob({
        label: { text: 'RATE', aria: `${label} rate` },
        read: () => state().rate,
        write: (value) => director.touch(`layers.${id}.rate`, value),
        home: () => defaults.layers[id].rate,
        format: (value) => rateText(engine, value),
      }),
    );
  }

  const keys = triggerLabels.map((text) => {
    const button = element('button', { type: 'button', textContent: text });
    button.addEventListener('click', () => engine.trigger(id, text));
    return button;
  });
  if (id === 'hum') keys.push(...mainsKeys(engine));

  const models = engine.cfg.layers[id].models ? [modelKeys(engine, id, label)] : [];
  return element(
    'div',
    { className: 'module' },
    element('div', { className: 'module-head' }, lamp, element('span', { textContent: label }), mute),
    element('div', { className: 'knobs' }, ...knobs),
    element('div', { className: 'triggers' }, ...keys),
    ...models,
  );
}

function rackBank(engine, cfg, { id, name, layers }, info) {
  const heading = element('h2', { textContent: name });
  const modules = layers.map((layer) =>
    layerModule(engine, info.find((entry) => entry.id === layer), cfg.layers[layer].label),
  );
  const bank = element('section', { className: 'bank' }, heading, element('div', { className: 'modules' }, ...modules));
  bank.dataset.zone = id;
  bank.style.setProperty('--modules', layers.length); // banks share a row in proportion to this
  return bank;
}

const describe = ({ pan, dist }) => {
  const side = Math.abs(pan) < 0.08 ? 'centre' : `${Math.round(Math.abs(pan) * 100)} percent ${pan < 0 ? 'left' : 'right'}`;
  return `${side}, ${Math.round(dist * 100)} percent away`;
};

// A plan of the room seen from above. You sit at the bottom. Left and right on
// the plan are left and right in your ears; further up is further away.
function machineMarker(engine, plan, { id }, label) {
  const position = () => engine.settings.positions[id];
  const marker = element('div', { className: 'marker', tabIndex: 0 }, addLamp(id), element('span', { textContent: label }));
  marker.setAttribute('role', 'slider');
  marker.setAttribute('aria-label', `${label} position`);
  marker.setAttribute('aria-valuemin', '0');
  marker.setAttribute('aria-valuemax', '1');

  const draw = () => {
    const { pan, dist } = position();
    marker.style.left = `${((pan + 1) / 2) * 100}%`;
    marker.style.top = `${(1 - dist) * 100}%`;
    marker.style.setProperty('--near', 1 - dist * 0.14);
    marker.setAttribute('aria-valuenow', dist.toFixed(2));
    marker.setAttribute('aria-valuetext', describe(position()));
  };
  draw();
  redraws.push(draw);

  const clampPan = (value) => Math.min(1, Math.max(-1, value));
  const clampDist = (value) => Math.min(1, Math.max(0, value));
  const moveTo = (pan, dist) => engine.setPosition(id, { pan: clampPan(pan), dist: clampDist(dist) });

  let dragging = false;
  const follow = (event) => {
    const box = plan.getBoundingClientRect();
    moveTo(((event.clientX - box.left) / box.width) * 2 - 1, 1 - (event.clientY - box.top) / box.height);
  };
  marker.addEventListener('pointerdown', (event) => {
    dragging = true;
    marker.setPointerCapture(event.pointerId);
    marker.focus();
  });
  marker.addEventListener('pointermove', (event) => {
    if (dragging) follow(event);
  });
  marker.addEventListener('pointerup', () => {
    dragging = false;
  });
  marker.addEventListener('pointercancel', () => {
    dragging = false;
  });
  marker.addEventListener('dblclick', () => {
    const { pan, dist } = engine.defaults.positions[id];
    moveTo(pan, dist);
  });
  marker.addEventListener('keydown', (event) => {
    const { pan, dist } = position();
    const moves = {
      ArrowLeft: [pan - 0.05, dist],
      ArrowRight: [pan + 0.05, dist],
      ArrowUp: [pan, dist + 0.05],
      ArrowDown: [pan, dist - 0.05],
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    moveTo(...moves[event.key]);
  });
  return marker;
}

function roomPlan(engine, cfg, info) {
  const plan = element('div', { className: 'plan-floor' });
  plan.append(
    element('span', { className: 'listener', title: 'You' }),
    ...info.filter(({ placed }) => placed).map((entry) => machineMarker(engine, plan, entry, cfg.layers[entry.id].label)),
  );
  return element(
    'section',
    { className: 'plate plan', ariaLabel: 'Room plan' },
    element('h2', { textContent: 'ROOM PLAN' }),
    plan,
  );
}

// A lamp is a real indicator: it blinks for each sound, not on a loop.
function flashLamp(id) {
  if (document.hidden) return;
  for (const lamp of lamps.get(id) ?? []) {
    const light = lamp.querySelector('.glow');
    light.getAnimations().forEach((animation) => animation.cancel());
    light.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
  }
}

function sleepControl(engine, cfg) {
  const { director } = engine;
  const select = element(
    'select',
    { ariaLabel: 'Sleep timer' },
    element('option', { value: 0, textContent: 'OFF' }),
    ...cfg.director.sleep.minutes.map((minutes) =>
      element('option', { value: minutes, textContent: `${minutes} MIN` }),
    ),
  );
  const left = element('output', { textContent: '' });
  select.addEventListener('change', () => director.setSleep(Number(select.value)));
  const draw = () => {
    const remaining = engine.ctx ? director.sleepRemaining() : null;
    left.textContent = remaining === null ? '' : clock(remaining);
    if (remaining === null) select.value = 0;
  };
  redraws.push(draw);
  setInterval(draw, 1000);
  return element('label', { className: 'field' }, 'SLEEP ', select, ' ', left);
}

function settingsControls(engine, log) {
  const file = element('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const exporter = element('button', { type: 'button', textContent: 'EXPORT' });
  const importer = element('button', { type: 'button', textContent: 'IMPORT' });
  exporter.addEventListener('click', () => downloadSettings(engine.settings));
  importer.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const [chosen] = file.files;
    file.value = '';
    if (!chosen) return;
    try {
      const parsed = JSON.parse(await chosen.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not settings');
      const incoming = sanitize(parsed, engine.settings);
      for (const [id, { muted }] of Object.entries(incoming.layers)) engine.setLayerMuted(id, muted);
      if (incoming.mains !== engine.settings.mains) engine.setMains(incoming.mains);
      for (const [id, position] of Object.entries(incoming.positions)) engine.setPosition(id, position);
      Object.assign(engine.settings.models, incoming.models);
      engine.settings.drift = incoming.drift;
      engine.director.goTo(incoming, incoming.preset, engine.cfg.director.crossfadeSec);
      logLine(log, 'SETTINGS IMPORTED');
    } catch {
      logLine(log, 'IMPORT FAILED: NOT A SETTINGS FILE');
    }
  });
  return [exporter, importer, file];
}

// RECORD: either capture what is playing, or render faster than real time.
// The panel says plainly what each costs before anything starts.
function recordControl(engine, cfg) {
  const recorder = new Recorder(engine);
  const state = { open: false, mode: 'live', minutes: cfg.recorder.defaultMinutes, progress: 0 };
  const panel = element('div', { className: 'recorder', hidden: true });
  const key = pressable('RECORD', () => {
    state.open = !state.open;
    draw();
  }, () => state.open || recorder.busy);
  const modes = ['LIVE', 'RENDER'].map((text) =>
    pressable(text, () => {
      state.mode = text.toLowerCase();
      draw();
    }, () => state.mode === text.toLowerCase()),
  );
  const length = element(
    'select',
    { ariaLabel: 'Recording length' },
    ...cfg.recorder.minutes.map((minutes) => element('option', { value: minutes, textContent: `${minutes} MIN` })),
  );
  length.value = state.minutes;
  length.addEventListener('change', () => {
    state.minutes = Number(length.value);
    draw();
  });
  const start = element('button', { type: 'button', className: 'record-start' });
  const status = element('output', { className: 'record-status' });
  const note = element('p', { className: 'recorder-note' });

  start.addEventListener('click', async () => {
    if (recorder.live) {
      recorder.stopLive();
    } else if (state.mode === 'live') {
      recorder.startLive(state.minutes, draw);
    } else if (!recorder.rendering) {
      state.progress = 0;
      const rendering = recorder.render(state.minutes, (progress) => {
        state.progress = progress;
        status.textContent = `RENDERING ${Math.floor(progress * 100)}%`;
      });
      draw();
      await rendering;
    }
    draw();
  });

  function draw() {
    panel.hidden = !state.open && !recorder.busy;
    const live = state.mode === 'live';
    for (const control of [...modes, length]) control.disabled = recorder.busy;
    if (live) {
      start.textContent = recorder.live ? 'STOP' : 'START';
      start.disabled = recorder.rendering || (!recorder.live && !engine.powered);
      note.textContent = engine.powered
        ? 'Records what you hear, in real time, as a compressed audio file of about 1 MB a minute. Keep this tab open until it finishes; it can stay in the background.'
        : 'Records what you hear, in real time. Power on first.';
    } else if (!canRender) {
      start.textContent = 'START';
      start.disabled = true;
      note.textContent = 'Rendering needs a Chromium-based browser, such as Chrome or Edge. In this browser, use LIVE.';
    } else {
      const { memoryGB, fileMB } = renderCost(state.minutes);
      start.textContent = 'START';
      start.disabled = recorder.busy;
      note.textContent = `Builds the recording from your current settings, faster than real time. It holds everything in memory first: about ${memoryGB.toFixed(1)} GB for ${state.minutes} minutes, then saves a ${Math.round(fileMB)} MB WAV file. Fine on a desktop with plenty of memory; it may crash this tab on a laptop or phone.`;
    }
    if (recorder.live) {
      const left = recorder.liveRemaining();
      status.textContent = `RECORDING ${clock(left)}`;
    } else if (!recorder.rendering) {
      status.textContent = '';
    }
  }

  setInterval(() => {
    recorder.check();
    if (recorder.live) draw();
  }, 1000);
  redraws.push(draw);
  panel.append(
    element('div', { className: 'button-row' }, ...modes, length, start, status),
    note,
  );
  draw();
  return { key, panel };
}

function profilePanel(engine, cfg, log, screen) {
  const { director } = engine;
  const record = recordControl(engine, cfg);
  const presets = Object.keys(PRESETS).map((name) =>
    pressable(name, () => director.preset(name), () => engine.settings.preset === name),
  );
  const reset = element('button', { type: 'button', textContent: 'DEFAULT' });
  reset.addEventListener('click', () => director.reset());
  const drift = pressable(
    'AUTO DRIFT',
    () => director.setDrift(!engine.settings.drift),
    () => engine.settings.drift,
  );
  const panelKey = (text, field, target) => {
    const draw = () => {
      target.hidden = !engine.settings[field];
    };
    draw();
    redraws.push(draw);
    return pressable(
      text,
      () => {
        engine.settings[field] = !engine.settings[field];
        engine.notifyChange();
      },
      () => engine.settings[field],
    );
  };
  return [
      element('div', { className: 'button-row' }, ...presets, reset),
      element('div', { className: 'button-row' }, drift, sleepControl(engine, cfg), record.key),
      element(
        'div',
        { className: 'button-row' },
        panelKey('LOG', 'showLog', screen.log),
        panelKey('DIAGNOSTICS', 'showDiag', screen.diag),
        ...settingsControls(engine, log),
      ),
      record.panel,
  ];
}

function logLine(log, message) {
  const fault = message.startsWith('FAULT') || message.startsWith('IMPORT FAILED');
  log.append(element('div', { textContent: `> ${message}`, className: fault ? 'fault' : '' }));
  while (log.childElementCount > MAX_LOG_LINES) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

function diagnostics(engine) {
  const { ctx, scheduler } = engine;
  const { ticks, fired, maxGapSec, starved } = scheduler.stats;
  const heap = performance.memory ? `${(performance.memory.usedJSHeapSize / 1e6).toFixed(1)} MB` : 'N/A';
  return [
    `AUDIO ${ctx.state.toUpperCase()}  ${ctx.sampleRate} HZ  LATENCY ${(ctx.baseLatency * 1000).toFixed(0)} MS`,
    `UPTIME ${clock(ctx.currentTime)}  TICKS ${ticks}  EVENTS ${fired}`,
    `MAX TICK GAP ${(maxGapSec * 1000).toFixed(0)} MS  STARVED ${starved}  QUEUE ${scheduler.tasks.length}  VOICES ${engine.voices}`,
    `HEAP ${heap}`,
  ].join('\n');
}

export function createUI(engine, cfg, root) {
  const power = root.querySelector('#power');
  const log = root.querySelector('#log');
  const diag = root.querySelector('#diag');

  const info = engine.layerInfo();
  root.querySelector('#profiles').append(...profilePanel(engine, cfg, log, { log, diag }));
  const macroKnobs = element('div', { className: 'macro-knobs' });
  root.querySelector('#macros').append(macroKnobs);
  macroKnobs.append(
    knob({
      label: { text: 'MASTER' },
      read: () => engine.settings.master,
      write: (value) => engine.director.touch('master', value),
      home: () => engine.defaults.master,
      large: true,
    }),
    ...Object.entries(cfg.macros).map(([name, { label }]) =>
      knob({
        label: { text: label },
        read: () => engine.settings.macros[name],
        write: (value) => engine.director.touch(`macros.${name}`, value),
        home: () => engine.defaults.macros[name],
        large: true,
      }),
    ),
  );
  root.querySelector('#racks').append(...ZONES.map((zone) => rackBank(engine, cfg, zone, info)));
  root.querySelector('#plan').append(roomPlan(engine, cfg, info));

  const drawPower = () => {
    power.textContent = engine.powered ? 'POWER OFF' : 'POWER ON';
    power.setAttribute('aria-pressed', String(engine.powered));
    root.dataset.power = engine.powered ? 'on' : 'off';
  };
  redraws.push(drawPower);

  power.addEventListener('click', async () => {
    const on = !engine.powered;
    logLine(log, on ? 'SYSTEM POWER ON' : 'SYSTEM POWER OFF');
    const starting = on ? engine.powerOn() : engine.powerOff();
    drawPower();
    await starting;
    engine.notifyChange();
  });

  engine.onChange(() => {
    for (const redraw of redraws) redraw();
  });

  engine.on(({ layer, message }) => {
    logLine(log, message);
    flashLamp(layer);
  });
  engine.onFlash(flashLamp);
  window.addEventListener('error', ({ message }) => logLine(log, `FAULT: ${message}`));
  window.addEventListener('unhandledrejection', ({ reason }) => logLine(log, `FAULT: ${reason}`));

  setInterval(() => {
    if (engine.ctx && !diag.hidden) diag.textContent = diagnostics(engine);
  }, 1000);
}
