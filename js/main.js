import { CONFIG } from './config.js';
import { Engine } from './engine.js';
import { loadSettings, saveSettings } from './settings.js';
import { createUI } from './ui.js';

const SAVE_DELAY_MS = 1000;

const engine = new Engine(CONFIG);
engine.restore(loadSettings(engine.defaults));
createUI(engine, CONFIG, document.body);

// Knobs and drift can change settings many times a second; save after a lull.
let saveTimer = null;
engine.onChange(() => {
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    saveSettings(engine.settings);
  }, SAVE_DELAY_MS);
});
window.addEventListener('pagehide', () => saveSettings(engine.settings));
