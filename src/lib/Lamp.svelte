<script lang="ts">
  import { getConsole } from './context';

  let { id }: { id: string } = $props();
  const ui = getConsole();
</script>

<span class="lamp"><span class="glow" {@attach ui.lamp(id)}></span></span>
