<script lang="ts">
  import type { LayerConfig } from '../engine/layers/layer';
  import type { Position } from '../engine/types';
  import { getConsole } from './context';
  import Lamp from './Lamp.svelte';

  const ui = getConsole();
  const { engine } = ui;
  const placed = engine.layerInfo().filter(({ placed }) => placed);
  const label = (id: string): string => (engine.cfg.layers as Record<string, LayerConfig>)[id].label;
  const positions = $derived(ui.read(() => ({ ...engine.settings.positions })));

  let floor: HTMLDivElement;
  let dragging: string | null = null;

  const describe = ({ pan, dist }: Position): string => {
    const side = Math.abs(pan) < 0.08 ? 'centre' : `${Math.round(Math.abs(pan) * 100)} percent ${pan < 0 ? 'left' : 'right'}`;
    return `${side}, ${Math.round(dist * 100)} percent away`;
  };

  const moveTo = (id: string, pan: number, dist: number): void =>
    engine.setPosition(id, { pan: Math.min(1, Math.max(-1, pan)), dist: Math.min(1, Math.max(0, dist)) });

  function follow(id: string, event: PointerEvent): void {
    const box = floor.getBoundingClientRect();
    moveTo(id, ((event.clientX - box.left) / box.width) * 2 - 1, 1 - (event.clientY - box.top) / box.height);
  }

  function onkeydown(id: string, event: KeyboardEvent): void {
    const { pan, dist } = engine.settings.positions[id];
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [pan - 0.05, dist],
      ArrowRight: [pan + 0.05, dist],
      ArrowUp: [pan, dist + 0.05],
      ArrowDown: [pan, dist - 0.05],
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    moveTo(id, ...moves[event.key]);
  }
</script>

<!-- A plan of the room seen from above. You sit at the bottom. Left and right on
     the plan are left and right in your ears; further up is further away. -->
<section class="plate plan" aria-label="Room plan">
  <h2>ROOM PLAN</h2>
  <div class="plan-floor" bind:this={floor}>
    <span class="listener" title="You"></span>
    {#each placed as { id } (id)}
      {@const position = positions[id]}
      <div
        class="marker"
        tabindex="0"
        role="slider"
        aria-label="{label(id)} position"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(position.dist.toFixed(2))}
        aria-valuetext={describe(position)}
        style:left="{((position.pan + 1) / 2) * 100}%"
        style:top="{(1 - position.dist) * 100}%"
        style:--near={1 - position.dist * 0.14}
        onpointerdown={(event) => {
          dragging = id;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
        }}
        onpointermove={(event) => {
          if (dragging === id) follow(id, event);
        }}
        onpointerup={() => (dragging = null)}
        onpointercancel={() => (dragging = null)}
        ondblclick={() => {
          const { pan, dist } = engine.defaults.positions[id];
          moveTo(id, pan, dist);
        }}
        onkeydown={(event) => onkeydown(id, event)}
      >
        <Lamp {id} />
        <span>{label(id)}</span>
      </div>
    {/each}
  </div>
</section>
