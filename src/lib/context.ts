import { getContext } from 'svelte';
import type { Console } from './console.svelte';

// The console is made before the app mounts and handed in through context.
export const CONSOLE = Symbol('console');
export const getConsole = (): Console => getContext<Console>(CONSOLE);
