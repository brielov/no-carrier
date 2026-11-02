# Contributing

Thanks for wanting to help. NO CARRIER is small and deliberately simple, so a
few notes go a long way.

## Ground rules

- **The engine stays framework-free.** `src/engine/` is strict TypeScript over
  the Web Audio API, with no runtime dependencies and nothing from Svelte. The
  console in `src/lib/` reads it through `console.svelte.ts`.
- **`npm run check` must pass** with no errors or warnings.
- **Calm over busy.** Nothing harsh, shrill or startling. Silence matters as much
  as sound, and nothing should ever feel looped.
- **Tunable values belong in `src/engine/config.ts`,** with a short note on what they do
  and which way to turn them.

## Running it

```sh
npm install
npm run dev
```

Open <http://localhost:5173> and press **POWER ON**. The **DIAGNOSTICS** key
shows the audio clock, scheduler health and how many sounds are playing. During
a long session `STARVED` should stay at 0 and `VOICES` should not keep growing.

## Adding recordings

Recordings must be CC0 or public domain, so the project stays free to share.
[Freesound](https://freesound.org) with the Creative Commons 0 filter is a good
place to look.

1. Put the file under `public/samples/<layer>/`. WAV, mono or stereo, any sample rate.
2. List it in `public/samples/manifest.json` with its `kind`, and `model` where the
   layer has a choice of machine. The README describes the values.
3. Add a row to the sources table in the README, linking the original.

Trim silence at the edges, keep levels consistent with similar files, and avoid
fades on mechanical sounds: real machines start and stop abruptly.

## Writing transmissions

New story messages are welcome. Read [docs/STORY.md](docs/STORY.md) first:
keep each one short, in one character's voice, calm, and mostly ordinary life.
Open an issue with the text and the character; the voices are generated
separately so they stay consistent.

## Reporting a problem

Open an issue with your browser and operating system, what you heard or saw,
and anything from the system log or the **DIAGNOSTICS** panel. For sound
problems, describing it in plain words helps a lot: "too harsh", "too regular",
"too close".

## Pull requests

Keep each pull request to one change, describe how it sounds different, and
check it in at least one Chromium-based browser and Firefox.
