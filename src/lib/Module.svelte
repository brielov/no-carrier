<script lang="ts">
  import type { LayerConfig } from '../engine/layers/layer';
  import { getConsole } from './context';
  import Knob from './Knob.svelte';
  import Lamp from './Lamp.svelte';
  import Pressable from './Pressable.svelte';

  let { id, triggerLabels }: { id: string; triggerLabels: readonly string[] } = $props();

  const ui = getConsole();
  const { engine } = ui;
  const cfg = $derived((engine.cfg.layers as Record<string, LayerConfig>)[id]);
  const label = $derived(cfg.label);
  const state = $derived(ui.read(() => ({ ...engine.settings.layers[id] })));
  const model = $derived(ui.read(() => engine.settings.models[id]));
  const mains = $derived(ui.read(() => engine.settings.mains));

  // The rate as a multiple of normal, so a centred knob reads "x1.0".
  const rateText = (rate: number): string =>
    rate === 0 ? 'OFF' : `x${(engine.cfg.engine.rateRange ** (2 * rate - 1)).toFixed(1)}`;

  function setMains(hz: 50 | 60): void {
    engine.setMains(hz);
    engine.notifyChange();
  }
</script>

<div class="module">
  <div class="module-head">
    <Lamp {id} />
    <span>{label}</span>
    <Pressable
      class="mute"
      aria-label="Mute {label}"
      pressed={state.muted}
      onclick={() => {
        engine.setLayerMuted(id, !state.muted);
        engine.notifyChange();
      }}>MUTE</Pressable
    >
  </div>
  <div class="knobs">
    <Knob
      label="LEVEL"
      aria="{label} level"
      value={state.level}
      write={(value) => engine.director.touch(`layers.${id}.level`, value)}
      home={() => engine.defaults.layers[id].level}
    />
    {#if triggerLabels.length}
      <Knob
        label="RATE"
        aria="{label} rate"
        value={state.rate}
        write={(value) => engine.director.touch(`layers.${id}.rate`, value)}
        home={() => engine.defaults.layers[id].rate}
        format={rateText}
      />
    {/if}
  </div>
  <div class="triggers">
    {#each triggerLabels as text (text)}
      <button type="button" onclick={() => engine.trigger(id, text)}>{text}</button>
    {/each}
    {#if id === 'hum'}
      {#each [50, 60] as const as hz (hz)}
        <Pressable pressed={mains === hz} onclick={() => setMains(hz)}>{hz} HZ</Pressable>
      {/each}
    {/if}
  </div>
  {#if cfg.models}
    <div class="triggers" role="group" aria-label="{label} model">
      {#each cfg.models as choice (choice.id)}
        <Pressable pressed={model === choice.id} onclick={() => engine.setModel(id, choice.id)}>{choice.label}</Pressable>
      {/each}
    </div>
  {/if}
</div>
