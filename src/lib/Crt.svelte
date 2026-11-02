<script lang="ts">
  import { clock } from './console.svelte';
  import { getConsole } from './context';

  const ui = getConsole();
  const { engine } = ui;
  const showLog = $derived(ui.read(() => engine.settings.showLog));
  const showDiag = $derived(ui.read(() => engine.settings.showDiag));
  let log: HTMLDivElement;

  // Keep the newest line in view.
  $effect.pre(() => {
    void ui.log.length;
    queueMicrotask(() => {
      if (log) log.scrollTop = log.scrollHeight;
    });
  });

  interface MemoryInfo {
    usedJSHeapSize: number;
  }

  const diagnostics = $derived.by(() => {
    void ui.second;
    const { ctx } = engine;
    if (!ctx || !showDiag) return '';
    const { ticks, fired, maxGapSec, starved } = engine.scheduler.stats;
    const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
    const heap = memory ? `${(memory.usedJSHeapSize / 1e6).toFixed(1)} MB` : 'N/A';
    const latency = ctx instanceof AudioContext ? ctx.baseLatency : 0;
    return [
      `AUDIO ${ctx.state.toUpperCase()}  ${ctx.sampleRate} HZ  LATENCY ${(latency * 1000).toFixed(0)} MS`,
      `UPTIME ${clock(ctx.currentTime)}  TICKS ${ticks}  EVENTS ${fired}`,
      `MAX TICK GAP ${(maxGapSec * 1000).toFixed(0)} MS  STARVED ${starved}  QUEUE ${engine.scheduler.tasks.length}  VOICES ${engine.voices}`,
      `HEAP ${heap}`,
    ].join('\n');
  });
</script>

<section class="crt" aria-label="System log">
  <div class="glass">
    <div id="log" role="log" hidden={!showLog} bind:this={log}>
      {#each ui.log as line (line.id)}
        <div class={line.fault ? 'fault' : ''}>{line.text}</div>
      {/each}
    </div>
    <pre id="diag" hidden={!showDiag}>{diagnostics}</pre>
  </div>
</section>
