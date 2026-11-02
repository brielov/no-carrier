<script lang="ts">
  import { Recorder, canRender, renderCost } from '../engine/recorder';
  import { clock } from './console.svelte';
  import { getConsole } from './context';
  import Pressable from './Pressable.svelte';

  // RECORD: either capture what is playing, or render faster than real time.
  // The panel says plainly what each costs before anything starts.
  let { open, busy = $bindable(false) }: { open: boolean; busy?: boolean } = $props();

  const ui = getConsole();
  const { engine } = ui;
  const recorder = new Recorder(engine);

  let mode = $state<'live' | 'render'>('live');
  let minutes = $state(engine.cfg.recorder.defaultMinutes);
  let progress = $state<number | null>(null);
  // Bumped whenever the recorder changes state on its own.
  let changes = $state(0);

  const powered = $derived(ui.read(() => engine.powered));
  const rec = $derived.by(() => {
    void changes;
    void ui.second;
    return { live: Boolean(recorder.live), rendering: recorder.rendering, busy: recorder.busy, left: recorder.liveRemaining() };
  });
  $effect(() => {
    busy = rec.busy;
  });

  // Ends a live recording on time, or if the power goes off under it.
  $effect(() => {
    void ui.second;
    recorder.check();
  });

  const cost = $derived(renderCost(minutes));
  const note = $derived(
    mode === 'live'
      ? powered
        ? 'Records what you hear, in real time, as a compressed audio file of about 1 MB a minute. Keep this tab open until it finishes; it can stay in the background.'
        : 'Records what you hear, in real time. Power on first.'
      : !canRender
        ? 'Rendering needs a Chromium-based browser, such as Chrome or Edge. In this browser, use LIVE.'
        : `Builds the recording from your current settings, faster than real time. It holds everything in memory first: about ${cost.memoryGB.toFixed(1)} GB for ${minutes} minutes, then saves a ${Math.round(cost.fileMB)} MB WAV file. Fine on a desktop with plenty of memory; it may crash this tab on a laptop or phone.`,
  );
  const startText = $derived(mode === 'live' && rec.live ? 'STOP' : 'START');
  const startDisabled = $derived(
    mode === 'live' ? rec.rendering || (!rec.live && !powered) : !canRender || rec.busy,
  );
  const status = $derived(
    rec.live && rec.left !== null
      ? `RECORDING ${clock(rec.left)}`
      : rec.rendering && progress !== null
        ? `RENDERING ${Math.floor(progress * 100)}%`
        : '',
  );

  async function start(): Promise<void> {
    if (recorder.live) {
      recorder.stopLive();
    } else if (mode === 'live') {
      recorder.startLive(minutes, () => (changes += 1));
    } else if (!recorder.rendering) {
      progress = null;
      const rendering = recorder.render(minutes, (share) => (progress = share));
      changes += 1;
      await rendering;
      progress = null;
    }
    changes += 1;
  }
</script>

<div class="recorder" hidden={!open && !rec.busy}>
  <div class="button-row">
    <Pressable pressed={mode === 'live'} disabled={rec.busy} onclick={() => (mode = 'live')}>LIVE</Pressable>
    <Pressable pressed={mode === 'render'} disabled={rec.busy} onclick={() => (mode = 'render')}>RENDER</Pressable>
    <select aria-label="Recording length" disabled={rec.busy} bind:value={minutes}>
      {#each engine.cfg.recorder.minutes as choice (choice)}
        <option value={choice}>{choice} MIN</option>
      {/each}
    </select>
    <button type="button" class="record-start" disabled={startDisabled} onclick={start}>{startText}</button>
    <output class="record-status">{status}</output>
  </div>
  <p class="recorder-note">{note}</p>
</div>
