import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { CONFIG } from './engine/config';
import { Engine } from './engine/engine';
import { Console } from './lib/console.svelte';
import { CONSOLE } from './lib/context';
import { loadSettings, saveSettings } from './engine/settings';

const SAVE_DELAY_MS = 1000;

const engine = new Engine(CONFIG);
engine.restore(loadSettings(engine.defaults));
const ui = new Console(engine);
mount(App, { target: document.body, context: new Map([[CONSOLE, ui]]) });
window.addEventListener('error', ({ message }) => ui.write(`FAULT: ${message}`));
window.addEventListener('unhandledrejection', ({ reason }) => ui.write(`FAULT: ${reason}`));

// Knobs and drift can change settings many times a second; save after a lull.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
engine.onChange(() => {
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    saveSettings(engine.settings);
  }, SAVE_DELAY_MS);
});
window.addEventListener('pagehide', () => saveSettings(engine.settings));

// For tests and the curious: the running engine, from the console.
declare global {
  interface Window {
    noCarrier?: Engine;
  }
}
if (import.meta.env.DEV) window.noCarrier = engine;
