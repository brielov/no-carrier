<script lang="ts">
  interface Props {
    label: string;
    aria?: string;
    value: number;
    write: (value: number) => void;
    home: () => number;
    format?: (value: number) => string;
    large?: boolean;
  }

  let { label, aria = label, value, write, home, format = (v) => v.toFixed(2), large = false }: Props = $props();

  const SWEEP_DEG = 270;
  const DRAG_PIXELS = 180; // a full turn of the knob, dragging
  const FINE_DRAG_PIXELS = 720; // the same, with Shift held
  const HOVER_BEFORE_WHEEL_MS = 250; // so scrolling the page past a knob doesn't turn it
  const TICKS = Array.from({ length: 11 }, (_, i) => i);

  const clamp = (v: number): number => Math.min(1, Math.max(0, v));

  // While dragging, the knob shows where the hand is, not what drifts under it.
  let held = $state<number | null>(null);
  let dragging = false;
  let startY = 0;
  let startValue = 0;
  let hoveredAt = 0;
  let dial: HTMLDivElement;

  const shown = $derived(held ?? value);
  const text = $derived(format(shown));

  function change(next: number): void {
    const rounded = Math.round(clamp(next) * 1000) / 1000;
    if (dragging) held = rounded;
    write(rounded);
  }

  function onpointerdown(event: PointerEvent): void {
    dragging = true;
    startY = event.clientY;
    startValue = value;
    dial.setPointerCapture(event.pointerId);
    dial.focus();
  }

  function onpointermove(event: PointerEvent): void {
    if (!dragging) return;
    const span = event.shiftKey ? FINE_DRAG_PIXELS : DRAG_PIXELS;
    change(startValue + (startY - event.clientY) / span);
  }

  function release(): void {
    dragging = false;
    held = null;
  }

  function onwheel(event: WheelEvent): void {
    const settled = performance.now() - hoveredAt > HOVER_BEFORE_WHEEL_MS;
    if (!settled && document.activeElement !== dial) return;
    event.preventDefault();
    change(value + (event.deltaY < 0 ? 0.02 : -0.02));
  }

  function onkeydown(event: KeyboardEvent): void {
    const steps: Record<string, number> = {
      ArrowUp: value + 0.01,
      ArrowRight: value + 0.01,
      ArrowDown: value - 0.01,
      ArrowLeft: value - 0.01,
      PageUp: value + 0.1,
      PageDown: value - 0.1,
      Home: 0,
      End: 1,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    change(steps[event.key]);
  }

  // Svelte's onwheel is passive; turning the knob must stop the page scrolling.
  function wheel(node: HTMLElement) {
    node.addEventListener('wheel', onwheel, { passive: false });
    return () => node.removeEventListener('wheel', onwheel);
  }
</script>

<!-- A rotary knob. Drag up and down, scroll, or use the keyboard; double-click
     returns it to home. Works as an ARIA slider. -->
<div class={large ? 'knob large' : 'knob'}>
  <div
    bind:this={dial}
    class="knob-dial"
    tabindex="0"
    role="slider"
    aria-label={aria}
    aria-valuemin={0}
    aria-valuemax={1}
    aria-orientation="vertical"
    aria-valuenow={Number(shown.toFixed(2))}
    aria-valuetext={text}
    {onpointerdown}
    {onpointermove}
    onpointerup={release}
    onpointercancel={release}
    ondblclick={() => change(home())}
    onpointerenter={() => (hoveredAt = performance.now())}
    {onkeydown}
    {@attach wheel}
  >
    <svg viewBox="-50 -50 100 100" class="knob-ticks" aria-hidden="true">
      {#each TICKS as i (i)}
        <line y1="-48" y2={i % 5 === 0 ? -42 : -44} transform="rotate({(i / (TICKS.length - 1)) * SWEEP_DEG - SWEEP_DEG / 2})" />
      {/each}
    </svg>
    <div class="knob-cap" style:--angle="{shown * SWEEP_DEG - SWEEP_DEG / 2}deg"></div>
  </div>
  <span class="knob-label">{label}</span>
  <output>{text}</output>
</div>
