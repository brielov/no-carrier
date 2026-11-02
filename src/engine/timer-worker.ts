// Timers in a worker are not throttled when the tab is in the background,
// which is where this app will spend most of its life.
let handle: ReturnType<typeof setInterval> | undefined;

self.onmessage = ({ data }: MessageEvent<{ tickMs: number }>) => {
  clearInterval(handle);
  handle = data.tickMs ? setInterval(() => self.postMessage(0), data.tickMs) : undefined;
};
