<script lang="ts">
  import { getConsole } from './context';
  import Knob from './Knob.svelte';

  const ui = getConsole();
  const { engine } = ui;
  const macros = Object.entries(engine.cfg.macros);
  const settings: Record<string, number> = $derived(
    ui.read(() => ({ master: engine.settings.master, ...engine.settings.macros })),
  );
</script>

<section id="macros" class="plate" aria-label="Main controls">
  <div class="macro-knobs">
    <Knob
      label="MASTER"
      large
      value={settings.master}
      write={(value) => engine.director.touch('master', value)}
      home={() => engine.defaults.master}
    />
    {#each macros as [name, { label }] (name)}
      <Knob
        {label}
        large
        value={settings[name]}
        write={(value) => engine.director.touch(`macros.${name}`, value)}
        home={() => engine.defaults.macros[name]}
      />
    {/each}
  </div>
</section>
