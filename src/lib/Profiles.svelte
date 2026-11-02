<script lang="ts">
  import { PRESETS, type PresetName } from '../engine/presets';
  import { downloadSettings, sanitize } from '../engine/settings';
  import { clock } from './console.svelte';
  import { getConsole } from './context';
  import Pressable from './Pressable.svelte';
  import Recorder from './Recorder.svelte';

  const ui = getConsole();
  const { engine } = ui;
  const { director } = engine;
  const presets = Object.keys(PRESETS) as PresetName[];
  const settings = $derived(
    ui.read(() => ({
      preset: engine.settings.preset,
      drift: engine.settings.drift,
      showLog: engine.settings.showLog,
      showDiag: engine.settings.showDiag,
    })),
  );

  let recordOpen = $state(false);
  let recordBusy = $state(false);

  // The sleep countdown, redrawn every second and on every change.
  let sleepChoice = $state(0);
  const sleepLeft = $derived.by(() => {
    void ui.second;
    return ui.read(() => (engine.ctx ? director.sleepRemaining() : null));
  });
  $effect(() => {
    if (sleepLeft === null) sleepChoice = 0;
  });

  function toggle(field: 'showLog' | 'showDiag'): void {
    engine.settings[field] = !engine.settings[field];
    engine.notifyChange();
  }

  let file: HTMLInputElement;

  async function importSettings(): Promise<void> {
    const [chosen] = file.files ?? [];
    file.value = '';
    if (!chosen) return;
    try {
      const parsed: unknown = JSON.parse(await chosen.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not settings');
      const incoming = sanitize(parsed, engine.settings);
      for (const [id, { muted }] of Object.entries(incoming.layers)) engine.setLayerMuted(id, muted);
      if (incoming.mains !== engine.settings.mains) engine.setMains(incoming.mains);
      for (const [id, position] of Object.entries(incoming.positions)) engine.setPosition(id, position);
      Object.assign(engine.settings.models, incoming.models);
      engine.settings.drift = incoming.drift;
      director.goTo(incoming, incoming.preset, engine.cfg.director.crossfadeSec);
      ui.write('SETTINGS IMPORTED');
    } catch {
      ui.write('IMPORT FAILED: NOT A SETTINGS FILE');
    }
  }
</script>

<section id="profiles" class="plate" aria-label="Profiles and timer">
  <div class="button-row">
    {#each presets as name (name)}
      <Pressable pressed={settings.preset === name} onclick={() => director.preset(name)}>{name}</Pressable>
    {/each}
    <button type="button" onclick={() => director.reset()}>DEFAULT</button>
  </div>
  <div class="button-row">
    <Pressable pressed={settings.drift} onclick={() => director.setDrift(!engine.settings.drift)}>AUTO DRIFT</Pressable>
    <label class="field"
      >SLEEP <select aria-label="Sleep timer" bind:value={sleepChoice} onchange={() => director.setSleep(sleepChoice)}>
        <option value={0}>OFF</option>
        {#each engine.cfg.director.sleep.minutes as minutes (minutes)}
          <option value={minutes}>{minutes} MIN</option>
        {/each}
      </select>
      <output>{sleepLeft === null ? '' : clock(sleepLeft)}</output></label
    >
    <Pressable pressed={recordOpen || recordBusy} onclick={() => (recordOpen = !recordOpen)}>RECORD</Pressable>
  </div>
  <div class="button-row">
    <Pressable pressed={settings.showLog} onclick={() => toggle('showLog')}>LOG</Pressable>
    <Pressable pressed={settings.showDiag} onclick={() => toggle('showDiag')}>DIAGNOSTICS</Pressable>
    <button type="button" onclick={() => downloadSettings(engine.settings)}>EXPORT</button>
    <button type="button" onclick={() => file.click()}>IMPORT</button>
    <input bind:this={file} type="file" accept="application/json,.json" hidden onchange={importSettings} />
  </div>
  <Recorder open={recordOpen} bind:busy={recordBusy} />
</section>
