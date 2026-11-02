// Timers in a worker are not throttled when the tab is in the background,
// which is where this app will spend most of its life.
let handle = null;

self.onmessage = ({ data }) => {
  clearInterval(handle);
  handle = data.tickMs ? setInterval(() => self.postMessage(0), data.tickMs) : null;
};
