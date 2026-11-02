<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  // A latching key: it shows whether its setting is on.
  let { pressed, children, ...rest }: { pressed: boolean; children: Snippet } & HTMLButtonAttributes = $props();
</script>

<button type="button" aria-pressed={pressed} {...rest}>{@render children()}</button>
