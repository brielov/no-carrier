<script lang="ts">
  import { getConsole } from './lib/context';
  import Crt from './lib/Crt.svelte';
  import Macros from './lib/Macros.svelte';
  import Module from './lib/Module.svelte';
  import Profiles from './lib/Profiles.svelte';
  import RoomPlan from './lib/RoomPlan.svelte';

  const ui = getConsole();
  const { engine } = ui;
  const info = engine.layerInfo();
  const ZONES = [
    { id: 'room', name: 'THIS ROOM', layers: ['hum', 'air', 'hull', 'lifesupport', 'hydroponics'] },
    { id: 'outside', name: 'OUTSIDE THE HULL', layers: ['drone', 'thrusters'] },
    { id: 'radio', name: 'RADIO', layers: ['signal', 'antenna', 'morse', 'teleprinter', 'carrier', 'broadcast', 'timesignal'] },
    { id: 'machines', name: 'MACHINES', layers: ['drive', 'tape', 'relay', 'keyboard', 'beeps', 'printer', 'modem'] },
  ];
  const triggerLabels = (id: string): readonly string[] => info.find((entry) => entry.id === id)?.triggerLabels ?? [];

  let powered = $state(engine.powered);
  $effect(() => {
    powered = ui.read(() => engine.powered);
  });
  $effect(() => {
    document.body.dataset.power = powered ? 'on' : 'off';
  });

  async function power(): Promise<void> {
    const on = !engine.powered;
    ui.write(on ? 'SYSTEM POWER ON' : 'SYSTEM POWER OFF');
    const starting = on ? engine.powerOn() : engine.powerOff();
    powered = engine.powered;
    await starting;
    engine.notifyChange();
  }
</script>

<main class="console">
  <header class="nameplate">
    <h1>NO CARRIER</h1>
    <button id="power" type="button" aria-pressed={powered} onclick={power}>{powered ? 'POWER OFF' : 'POWER ON'}</button>
  </header>

  <div class="deck">
    <Crt />
    <div class="desk">
      <Macros />
      <Profiles />
    </div>
    <div id="plan" class="plan-slot"><RoomPlan /></div>
  </div>

  <div id="racks" class="racks">
    {#each ZONES as zone (zone.id)}
      <section class="bank" data-zone={zone.id} style:--modules={zone.layers.length}>
        <h2>{zone.name}</h2>
        <div class="modules">
          {#each zone.layers as id (id)}
            <Module {id} triggerLabels={triggerLabels(id)} />
          {/each}
        </div>
      </section>
    {/each}
  </div>
</main>
