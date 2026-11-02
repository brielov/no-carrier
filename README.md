# NO CARRIER

A generative ambience machine for long nights. You are alone in a small capsule
somewhere in deep space. Old computers work in the next room: drives seek, tape
shuttles, relays click, a terminal reports back. A shortwave receiver keeps
scanning for a signal and never quite finds one. Now and then a recorded
message drifts in from another ship, still looping after all these years.

It never repeats. Every event is scheduled at random, every continuous sound
drifts slowly, and the knobs let you shape the room while it plays. It runs in
the browser with the Web Audio API: plain HTML, CSS and JavaScript, with no
dependencies and no build step.

**Listen: <https://no-carrier.pages.dev>** (headphones recommended)

There is a story in here, told only in fragments, for anyone who keeps
listening. If you would rather read it than hear it,
[it is written down](docs/STORY.md), with spoilers.

## Run it locally

```sh
python3 serve.py
```

Then open <http://localhost:8000> and press **POWER ON**.

Use `serve.py` rather than `python3 -m http.server`: it tells the browser not to
cache, so a reload always gets every current file. A mix of old and new modules
can leave the app silent. If the system log shows a `FAULT` line, a hard reload
(Ctrl+Shift+R) is the first thing to try.

## Using it

- **POWER ON** brings the capsule up one system at a time; **POWER OFF** winds
  it down.
- **Distance, Age, Activity and Signal** shape the whole room: how far away the
  machines are, how worn the tape sounds, how busy the computers are and how
  often the radio almost catches something.
- **Presets** crossfade to a mood over a few seconds. **Auto Drift** wanders the
  big knobs slowly over many minutes. **Sleep** fades everything out after 15
  to 90 minutes.
- **The room plan** places each machine around you. Drag one left, right or
  further away, or focus it and use the arrow keys. Distance changes its tone
  and room sound as well as its level.
- **Each layer** has volume, mute and rate controls, buttons to trigger its
  sounds on demand, and for some, a choice of real machine to listen to. The
  radio is split the same way: the receiver itself, then Morse, teleprinter,
  carriers and broadcasts, each with its own controls.

Drag a knob up or down (hold Shift for fine control), scroll over it, or focus it
and use the arrow keys, Page Up and Down, Home and End. Double-click returns it to
its default. Settings are saved in your browser and can be exported as JSON.

## Tuning

Every frequency, rate, level and range is in `js/config.js`, with notes on what
each one does. Reload the page to hear a change.

Saved knob positions take priority over the `defaultLevel` and `value` settings
in that file. Press **DEFAULT** to return to the values in `js/config.js`.

## Layout

| Path | What it does |
| --- | --- |
| `js/config.js` | All tunable constants |
| `js/engine.js` | AudioContext, power, settings, layer registry |
| `js/scheduler.js` | Lookahead scheduler and Poisson event processes |
| `js/timer-worker.js` | Tick source that is not throttled in background tabs |
| `js/layers/` | One module per sound layer; `signal.js` is the receiver and `radio.js` what it picks up |
| `js/effects.js` | Distance, Age, placement, compressor and limiter |
| `js/power.js` | Power on and off sequences |
| `js/story.js` | The Halcyon's day count, log notes and broadcast archive |
| `docs/STORY.md` | The story bible (spoilers) |
| `js/director.js` | Crossfades, Auto Drift, sleep timer |
| `js/presets.js` | Preset definitions |
| `js/settings.js` | Saving, validating and exporting settings |
| `js/noise.js` | Shared, pre-generated noise loops |
| `js/hits.js` | Renders mechanical hits from recipes |
| `js/recipes.js` | Hit recipes measured from real recordings |
| `js/samples.js` | Optional sample loading |
| `js/random.js` | Random helpers and the slow random walk |
| `js/ui.js` | Console layout, keys, lamps, system log, diagnostics |
| `js/knob.js` | Rotary knob control |
| `samples/` | Recordings and their manifest |

## Samples

Most machines play real recordings from `samples/`, listed in
`samples/manifest.json`. They are optional: if a layer has no samples, it falls
back to its synthesized sound, and the app works with the folder removed.

Each manifest key is a layer, holding a list of files. For layers with a choice
of machine, `model` is an id from that layer's `models` in `js/config.js`.

| Layer | `kind` values |
| --- | --- |
| `drive` | `short`, `long`, `recal` (a rare heavy event: heads recalibrating) |
| `keyboard` | `key`, `heavy` |
| `tape` | `shuttle` |
| `printer` | `line`, one whole printed line per file |
| `modem` | `handshake`, `data` |
| `signal` | `morse`, `data`, `carrier`, `time` (with its `mhz`), `broadcast` (with `speaker` and its words in `text`; `lazy` files load when first played) |
| `power` | the sounds of the power sequence, named in `js/power.js` |
| `hull` | `tick`, `creak` |
| `antenna` | `motor` |
| `thrusters` | `puff` |
| `lifesupport` | `run` |
| `hydroponics` | `water`, `trickle` |

Use mono or stereo WAV at any sample rate. To find more, search
[freesound.org](https://freesound.org) and filter by Creative Commons 0.

### Sources

| Files | Source | Licence |
| --- | --- | --- |
| `drive/pc-*` | [oldcomputerbootingup](https://freesound.org/s/328683/) by vacuumfan7072 | CC0 |
| `drive/st277n-*` | [1980s Seagate ST277N 63MB SCSI hard drive](https://freesound.org/s/475216/) by jodybruchon | CC0 |
| `drive/caviar-*` | [Caviar 32500](https://freesound.org/s/116033/) by galeku | CC0 |
| `drive/recal-02.wav` | [Hard Drive 7200RPM Spin Up, Idle and Spin Down](https://freesound.org/s/465592/) by conath | CC0 |
| `hull/tick-*` | [Clicking Engine Cooldown](https://freesound.org/s/539514/) by CmdRobot | CC0 |
| `hull/creak-*` | [Foley_Object_Metal_Oven_Creaks_Mono](https://freesound.org/s/585734/) by Nox_Sound | CC0 |
| `antenna/motor-a.wav` | [Servo motor working](https://freesound.org/s/723999/) by D31V228 | CC0 |
| `thrusters/puff-a.wav`, `puff-b.wav` | [release_air_pffft](https://freesound.org/s/131302/) by reg7783 | CC0 |
| `thrusters/puff-c.wav` | [Valve_1(air, release)](https://freesound.org/s/475427/) by o_ciz | CC0 |
| `lifesupport/run-a.wav`, `run-b.wav` | [oxygen concentrator close prospect](https://freesound.org/s/378147/) by kb7clx | CC0 |
| `lifesupport/run-c.wav` | [Home Oxygen Concentrator](https://freesound.org/s/346967/) by kb7clx | CC0 |
| `hydroponics/water-*` | [Aquarium Pump and Bubbles](https://freesound.org/s/870769/) by CHallSmith | CC0 |
| `hydroponics/trickle-a.wav` | [trickle](https://freesound.org/s/189672/) by sangtao | CC0 |
| `signal/time-wwv-*` | [WWV 5 MHz](https://freesound.org/s/625313/) by Bryce835 | CC0 |
| `signal/time-chu-*` | [CHU call sign shortwave time signal](https://freesound.org/s/626118/) by klankbeeld | CC0 |
| `drive/vintage-*` | [Vintage Hard Drive Read and Idle](https://freesound.org/s/493891/) by Crinkem | CC0 |
| `printer/line-a-*` | [dot matrix printer](https://freesound.org/s/320008/) by DisasterServices | CC0 |
| `printer/line-b-*` | [old dot-matrix printer](https://freesound.org/s/181420/) by viertelnachvier | CC0 |
| `modem/handshake-a.wav`, `modem/data-a.wav` | [modem_dial](https://freesound.org/s/188828/) by 0ktober | CC0 |
| `modem/handshake-b.wav`, `modem/data-b.wav` | [The Sound of dial-up Internet](https://freesound.org/s/546450/) by wtermini | CC0 |
| `modem/handshake-c.wav` | [modem1200](https://freesound.org/s/78657/) by guitarguy1985 | CC0 |
| `keyboard/office-*` | [Keyboard typing in office](https://freesound.org/s/399823/) by BonnyOrbit | CC0 |
| `keyboard/soft-*` | [computer_keyboard_slow_1](https://freesound.org/s/417549/) by rui_aires | CC0 |
| `keyboard/mech-*` | [Mechanical keyboard clicking](https://freesound.org/s/412926/) by humi74 | CC0 |
| `keyboard/modelf-*` | [IBM Model F keyboard typing](https://freesound.org/s/500430/) by Fractal_ | CC0 |
| `power/breaker-*` | [switch big breaker metal click on, off](https://freesound.org/s/451933/) by kyles | CC0 |
| `power/crt-*` | [CRT TV Switches On](https://freesound.org/s/693860/) by Fission9 | CC0 |
| `power/spin-up.wav` | [Hard drive spin up and head alignment](https://freesound.org/s/637063/) by micropolis | CC0 |
| `power/spin-down.wav` | [Hard Drive 7200RPM Spin Up, Idle and Spin Down](https://freesound.org/s/465592/) by conath | CC0 |
| `tape/reel-*` | [reel to reel tape machine start stop rewind](https://freesound.org/s/635704/) by kyles | CC0 |
| `tape/revox-*` | [revox B77 MKII tape recorder rewind](https://freesound.org/s/826896/) by bruno.auzet | CC0 |
| `tape/tonal-a.wav` | [Reel to Reel tape rewind](https://freesound.org/s/261022/) by nomenclatures | CC0 |
| `signal/morse-*` | [Radio transmission morse code @4606.2kHz Poland](https://freesound.org/s/343740/) by NebulousRoyale | CC0 |
| `signal/data-*` | [14081.60 kHz USB RTTY](https://freesound.org/s/241327/) by Trebblofang | CC0 |
| `signal/carrier-*` | [G32-19 Short Wave Radio](https://freesound.org/s/438503/) by craigsmith | CC0 |
| `signal/broadcast-*` | Original messages from the story, voiced with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), then degraded | Apache-2.0 model |

The CC0 clips were cut from Freesound's high-quality previews and processed:
trimmed, cleaned of room noise between events, and levelled. The broadcast
voices are synthetic; confirm the Kokoro-82M terms before any commercial use.

### Reference recordings

The synthesized hits in `js/recipes.js` and much of the rhythm and timing in
`js/config.js` were measured from these CC0 recordings. Their audio is not
included.

- Drives: [Conner CFS420A](https://freesound.org/s/155882/) by Klerrp,
  [Seagate, 1999](https://freesound.org/s/321503/) by viertelnachvier
- Tape: [reel fast forward](https://freesound.org/s/361058/) by Ev-Dawg,
  [tape deck startup](https://freesound.org/s/331385/) by soundjoao
- Keyboards: [buckling spring](https://freesound.org/s/551404/) by nakkivene66
- Radio: [shortwave scanning](https://freesound.org/s/154945/) by Spectrm,
  [Hallicrafters SX-122](https://freesound.org/s/433881/) by jodybruchon,
  [shortwave noise](https://freesound.org/s/257881/) by zmobie
- Relay: [relay and loud click](https://freesound.org/s/384701/) by bassmosphere
- Fans: [old server](https://freesound.org/s/520722/) by pimstoltz,
  [PC spin up and down](https://freesound.org/s/865667/) by AyaDrevis

## Contributing

Contributions are welcome, especially new recordings, better-sounding layers and
bug reports. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

The code is released under the [MIT Licence](LICENSE). Sample licences are
listed above.
