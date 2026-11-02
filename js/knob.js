const SWEEP_DEG = 270;
const DRAG_PIXELS = 180; // a full turn of the knob, dragging
const FINE_DRAG_PIXELS = 720; // the same, with Shift held
const HOVER_BEFORE_WHEEL_MS = 250; // so scrolling the page past a knob doesn't turn it
const TICKS = 11;

const clamp = (value) => Math.min(1, Math.max(0, value));

function tickMarks() {
  const ticks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ticks.setAttribute('viewBox', '-50 -50 100 100');
  ticks.setAttribute('class', 'knob-ticks');
  ticks.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < TICKS; i += 1) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const angle = (i / (TICKS - 1)) * SWEEP_DEG - SWEEP_DEG / 2;
    line.setAttribute('y1', -48);
    line.setAttribute('y2', i % 5 === 0 ? -42 : -44);
    line.setAttribute('transform', `rotate(${angle})`);
    ticks.append(line);
  }
  return ticks;
}

// A rotary knob. Drag up and down, scroll, or use the keyboard; double-click
// returns it to `home`. Works as an ARIA slider.
export function createKnob({ label, read, write, home, format = (value) => value.toFixed(2), large = false }) {
  const root = document.createElement('div');
  root.className = large ? 'knob large' : 'knob';
  const dial = document.createElement('div');
  dial.className = 'knob-dial';
  dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', label.aria ?? label.text);
  dial.setAttribute('aria-valuemin', '0');
  dial.setAttribute('aria-valuemax', '1');
  dial.setAttribute('aria-orientation', 'vertical');
  const cap = document.createElement('div');
  cap.className = 'knob-cap';
  dial.append(tickMarks(), cap);
  const name = document.createElement('span');
  name.className = 'knob-label';
  name.textContent = label.text;
  const readout = document.createElement('output');
  root.append(dial, name, readout);

  let dragging = false;
  let startY = 0;
  let startValue = 0;
  let hoveredAt = 0;

  const draw = () => {
    if (dragging) return;
    show(read());
  };

  function show(value) {
    cap.style.setProperty('--angle', `${value * SWEEP_DEG - SWEEP_DEG / 2}deg`);
    readout.textContent = format(value);
    dial.setAttribute('aria-valuenow', value.toFixed(2));
    dial.setAttribute('aria-valuetext', format(value));
  }

  function change(value) {
    const next = Math.round(clamp(value) * 1000) / 1000;
    show(next);
    write(next);
  }

  dial.addEventListener('pointerdown', (event) => {
    dragging = true;
    startY = event.clientY;
    startValue = read();
    dial.setPointerCapture(event.pointerId);
    dial.focus();
  });
  dial.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const span = event.shiftKey ? FINE_DRAG_PIXELS : DRAG_PIXELS;
    change(startValue + (startY - event.clientY) / span);
  });
  const release = () => {
    dragging = false;
  };
  dial.addEventListener('pointerup', release);
  dial.addEventListener('pointercancel', release);
  dial.addEventListener('dblclick', () => change(home()));

  dial.addEventListener('pointerenter', () => {
    hoveredAt = performance.now();
  });
  dial.addEventListener(
    'wheel',
    (event) => {
      const settled = performance.now() - hoveredAt > HOVER_BEFORE_WHEEL_MS;
      if (!settled && document.activeElement !== dial) return;
      event.preventDefault();
      change(read() + (event.deltaY < 0 ? 0.02 : -0.02));
    },
    { passive: false },
  );

  dial.addEventListener('keydown', (event) => {
    const steps = {
      ArrowUp: read() + 0.01,
      ArrowRight: read() + 0.01,
      ArrowDown: read() - 0.01,
      ArrowLeft: read() - 0.01,
      PageUp: read() + 0.1,
      PageDown: read() - 0.1,
      Home: 0,
      End: 1,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    change(steps[event.key]);
  });

  show(read());
  return { element: root, draw };
}
