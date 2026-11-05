// Every number you might want to tune by ear lives here.
//
// Conventions
//   *Sec / *Tc   seconds (Tc = time constant: ~95% of the way there after 3 Tc)
//   *Hz          hertz
//   *Cents       pitch, 100 cents = 1 semitone
//   *Db          decibels
//   gain         linear amplitude, 1 = unchanged
//   level        a 0..1 knob position. Gain = level² × maxGain, so that the
//                middle of a knob sits about 12 dB below the top.
//
// Drift ranges ({ min, max, tauSec }) describe slow random walks. The value
// wanders between min and max; tauSec is roughly how long it takes to forget
// where it was. Larger tauSec = slower wandering. Keep the taus unrelated to
// each other so that nothing lines up into a pattern.

export const CONFIG = {
  engine: {
    latencyHint: 'playback' as AudioContextLatencyCategory, // nothing here is played live, so favour stability
    fadeInTc: 0.01, // the power sequence does the real work, so this is just a click guard
    fadeOutTc: 0.05, // the final cut, once everything has wound down
    lookIn: 0.08, // seconds between pressing POWER ON and the breaker
    knobTc: 0.06, // smoothing on every knob move
    macroTc: 0.25, // smoothing on the big macro knobs
    rateRange: 5, // a RATE knob spans this many times slower and faster than normal
    hitVariants: 6, // how many slightly different renders of each hit to keep
    maxVoices: 128, // one-shot sounds alive at once; beyond this, new ones are skipped
  },

  // The big controls. value is the starting position, 0..1.
  // range: Activity and Signal go from ÷range to ×range around the middle.
  macros: {
    distance: { label: 'DISTANCE', value: 0.2 },
    age: { label: 'AGE', value: 0.1 },
    activity: { label: 'ACTIVITY', value: 0.6, range: 4 },
    signal: { label: 'SIGNAL', value: 0.3, range: 3 },
  },

  effects: {
    // The room itself: small, close and fairly dead, like a studio.
    // near = knob at 0, far = knob at 1.
    distance: {
      cutoffHz: { near: 16000, far: 1400 }, // muffling of everything in the room
      secondFilterRatio: 1.6, // a second, higher filter steepens it
      dry: { near: 1, far: 0.7 },
      wet: { near: 0.55, far: 1 }, // overall room sound
      roomFeed: 0.08, // how much air and hum reach the room sound
      room: {
        lengthSec: 0.5,
        tailT60: 0.26, // how long the room rings: bigger = bigger room
        darkening: 14, // higher = the tail goes dark sooner
        reflections: [[0.0031, 0.34], [0.0047, 0.3], [0.0073, 0.24], [0.0109, 0.18], [0.0157, 0.12]],
        panelLevel: 0.003, // the ring of the walls; higher = more metallic
        panels: [[233, 1, 0.2], [377, 0.8, 0.17], [587, 0.6, 0.14], [947, 0.4, 0.1]],
      },
    },

    // One machine's place on the room plan. near = right by you, far = the
    // back wall. Its stereo position comes from where it sits left to right.
    placement: {
      cutoffHz: { near: 20000, far: 2600 }, // far machines lose their highs
      level: { near: 1, far: 0.3 }, // and get quieter
      send: { near: 0.05, far: 0.62 }, // and more of their sound is the room
      panLaw: 0.8, // how far left and right go: 1 is hard to one side
      maxEarDelaySec: 0.00055, // the head-width delay between the ears
    },

    // near = knob at 0, far = knob at 1. Applies to the whole mix.
    age: {
      curve: 1.6, // how late wow, flutter and hiss come in as the knob rises
      curvePoints: 8192,
      curveSpan: 8, // the widest input the saturation handles cleanly
      drive: { near: 1, far: 9 }, // saturation: higher pushes harder into the tape
      topHz: { near: 19000, far: 5200 }, // worn tape loses its top end
      delaySec: 0.012,
      wowHz: 0.73, // slow pitch sway
      wowSec: 0.0022, // sway depth at full Age
      flutterHz: 7.9, // fast pitch shimmer
      flutterSec: 0.00016,
      hiss: 0.012,
      hissHighpassHz: 2600,
    },
  },

  director: {
    stepSec: 0.2, // how often crossfades, drift and the timer update
    crossfadeSec: 7, // time to move between presets
    drift: {
      stepSec: 1,
      releaseTc: 3, // how quickly the knobs settle when Auto Drift is turned off
      // How far each macro wanders from where you set it. tauSec is how long
      // the wandering takes, so these change over many minutes.
      ranges: {
        distance: { min: -0.16, max: 0.16, tauSec: 1630 },
        age: { min: -0.1, max: 0.12, tauSec: 2370 },
        activity: { min: -0.2, max: 0.2, tauSec: 1310 },
        signal: { min: -0.22, max: 0.22, tauSec: 1910 },
      },
    },
    sleep: {
      minutes: [15, 30, 60, 90],
      fadeSec: 60, // the fade at the end of the timer
    },
  },

  // POWER ON and POWER OFF. steps and off are seconds from the button press.
  power: {
    steps: {
      breaker: 0,
      hum: 0.12,
      display: 0.55,
      fans: 0.95,
      relays: 1.5,
      drive: 2.2,
      tape: 8.4,
      selfTest: 9.1,
      receiver: 9.7,
    },
    off: {
      outputsCut: 0.02,
      hum: 0.08,
      display: 0.2,
      relays: 0.1,
      fans: 0.15,
      drive: 0.3,
      outside: 3.6,
      closeRoom: 1.8,
      closeDrive: 5.9,
      done: 6.2,
    },
    gains: { breaker: 0.34, crt: 0.2, spin: 0.75 },
    relays: { onClicks: 6, offClicks: 3, gapSec: { min: 0.05, max: 0.3 } },
    humRiseTc: 0.09,
    humFallTc: 0.06,
    whineDelaySec: 1.2,
    whineRiseTc: 1.1,
    whineFallTc: 0.9,
    headsLoadedAt: 0.82, // when in the spin-up recording the heads load
    tapeGapSec: 0.27,
    tapeClunkLevel: 0.7,
    reportDelaySec: 2.5, // after the receiver comes up, the printer prints the daily report
    outsideRiseTc: 1.2,
    outsideFallTc: 0.9,
  },

  // The story. See docs/STORY.md before changing anything here.
  story: {
    halcyonDay: 4398, // the mission day on your first visit; it advances with the calendar
    homeSilentSince: 3690, // the mission day home stopped answering; Relay Lima counts from here
    // How often each voice is picked, relative to 1. The ground is meant to be rare.
    speakerWeights: { ground: 0.15, wren: 0.15, control: 0.6, lima: 0.8 },
    attemptsBefore: 8421, // calls the Halcyon made before your first visit; each scan adds one
    unheardBias: 0.7, // chance of picking a broadcast you haven't heard to the end yet
    recentShare: 0.5, // this share of broadcasts must play before one repeats
    // Rare notes in the system log, from the Halcyon's side.
    notes: {
      meanIdleSec: 720,
      minIdleSec: 240,
      lines: [
        'HALCYON DAY {day}',
        'RELAY LIMA: NO TRAFFIC {lima} DAYS',
        'DAYS SINCE LAST CONTACT WITH HOME: {lima}',
        'MERIDIAN TRANSMISSIONS LOGGED: {heard} OF {total}',
        'OPERATOR NOTE: LAMPS ON',
        'OPERATOR NOTE: FAN 2 BEARING CHECKED',
        'BEACON 6.204 MHZ: STILL TRANSMITTING',
        'HOLDING POSITION. ALL SYSTEMS NOMINAL',
        'COMMUNICATION ATTEMPTS {attempts}. SUCCESSFUL CONTACTS 0',
      ],
    },
  },

  recorder: {
    minutes: [5, 15, 30, 60, 120], // 120 is the longest a browser can render in one piece
    defaultMinutes: 30,
  },

  scheduler: {
    tickMs: 100, // how often the clock checks for work
    lookaheadSec: 0.5, // how far ahead events are placed on the audio clock
  },

  master: {
    defaultVolume: 0.9,
    // Gentle glue. Most of the time the signal stays below the threshold.
    compressor: { thresholdDb: -24, kneeDb: 18, ratio: 2.5, attackSec: 0.03, releaseSec: 0.4 },
    // Safety net only. If this is working hard, something else is too loud.
    limiter: { thresholdDb: -6, kneeDb: 0, ratio: 20, attackSec: 0.002, releaseSec: 0.25 },
    // Browsers add fixed make-up gain inside each compressor. This takes it
    // back out so quiet material passes at unity. Re-measure if you change
    // the thresholds or ratios above.
    makeupTrimDb: -5.3,
  },

  noise: {
    // Loop lengths are unrelated primes so that loops never line up.
    white: [17, 19],
    crackle: [13],
    pink: [23, 29],
    brown: [31],
    rms: 0.25, // every buffer is normalised to this, so gains below are comparable
    crossfadeSec: 0.75, // seam smoothing at the loop point
    brownLeak: 0.02, // higher = brighter brown noise
    crackleDensity: 14, // radio crackle ticks per second
    crackleTailSec: 0.0009, // how long each tick lasts
  },

  layers: {
    hum: {
      label: 'ROOM HUM',
      defaultLevel: 0.6,
      maxGain: 0.028,
      defaultMains: 50 as 50 | 60,
      mainsSwitchSec: 0.5, // how long the hum ducks while switching

      // n = multiple of the mains frequency. Rectified power supplies put most
      // of their hum on n=2, which is also what small speakers can reproduce.
      harmonics: [
        { n: 1, gain: 0.55, driftDb: 1.5, tauSec: 47 },
        { n: 2, gain: 1.0, driftDb: 2.0, tauSec: 61 },
        { n: 3, gain: 0.28, driftDb: 3.0, tauSec: 37 },
        { n: 4, gain: 0.14, driftDb: 3.0, tauSec: 83 },
        { n: 5, gain: 0.09, driftDb: 4.0, tauSec: 29 },
        { n: 6, gain: 0.05, driftDb: 4.0, tauSec: 53 },
      ],

      // Everything drifts in pitch together, as mains frequency does.
      pitchDriftCents: { min: -5, max: 5, tauSec: 90 },
      // Overall level breathing.
      ampDrift: { min: 0.8, max: 1.1, tauSec: 71 },
      // A second transformer, very slightly off, gives a slow uneven pulse.
      // detune: bigger = faster pulsing. 1.5 cents is about one pulse every 10 s.
      secondUnit: {
        n: 2,
        gain: 0.3,
        detuneCents: { min: 0.8, max: 3, tauSec: 120 },
      },
    },

    air: {
      label: 'AIR / FANS',
      defaultLevel: 0.3,
      maxGain: 1,

      // What the fans are: synthesized, or real recordings of fans and server
      // rooms. id matches `model` in samples/manifest.json. Recordings load
      // only when chosen, and each fan plays its own loop of them.
      models: [
        { id: 'synth', label: 'SYNTH' },
        { id: 'server', label: 'SERVER' },
        { id: 'rack', label: 'RACK' },
        { id: 'fan', label: 'FAN' },
      ],
      defaultModel: 'synth',
      recording: {
        gain: 0.21, // as loud as the synthesized fans
        crossfadeSec: 3, // when switching between models
      },

      // Low duct rumble.
      rumble: {
        gain: 0.15,
        highpassHz: 28,
        lowpassHz: { min: 110, max: 210, tauSec: 67 },
        ampDrift: { min: 0.75, max: 1.15, tauSec: 41 },
      },

      // Air moving through vents: the part you hear on small speakers.
      vent: {
        gain: 0.14,
        widthPan: 0.22, // stereo spread: 0 = mono, 1 = hard left/right
        bandpassHz: { min: 480, max: 900, tauSec: 53 },
        bandpassQ: 0.45,
        highShelf: { hz: 2600, db: -9 },
        ampDrift: { min: 0.7, max: 1.15, tauSec: 31 }, // slow gusts
      },

      // bladeHz = blades × rotations per second. Deliberately not a simple
      // ratio of the mains hum or of each other, so nothing forms a chord.
      fans: [
        {
          name: 'FAN 1',
          bladeHz: 137.3,
          blades: 7,
          toneGain: 0.024,
          whooshGain: 0.42,
          whooshMul: 3.1, // whoosh band centre, as a multiple of bladeHz
          whooshQ: 0.9,
          amDepth: 0.35, // how much the whoosh pulses at the blade rate
          wobbleDepth: 0.25, // how much the tone flutters at shaft speed
          pan: -0.08,
        },
        {
          name: 'FAN 2',
          bladeHz: 211.9,
          blades: 5,
          toneGain: 0.014,
          whooshGain: 0.26,
          whooshMul: 2.7,
          whooshQ: 0.8,
          amDepth: 0.3,
          wobbleDepth: 0.2,
          pan: 0.1,
        },
      ],

      // Harmonic recipe of the blade tone.
      fanHarmonics: [1, 0.35, 0.14, 0.06],
      // Small constant speed wander.
      fanSpeedDriftCents: { min: -7, max: 7, tauSec: 43 },
      // Speed-to-level: real fans get much noisier as they speed up.
      // 3 means twice the speed gives 8× the gain.
      fanLevelExponent: 3,
      // Fans ramp up on POWER ON and coast down on POWER OFF.
      startupCents: -2400,
      startupTc: 1.6,
      mainsRiseTc: 0.5,
      stopCents: -3000,
      stopTc: 1.1,
      mainsFallTc: 1.2,

      // Occasional slow changes of fan speed.
      spin: {
        meanGapSec: 150, // average time between speed changes
        minGapSec: 40, // never closer together than this
        downCents: { min: -950, max: -450 },
        upCents: { min: 220, max: 480 },
        upChance: 0.45,
        returnChance: 0.75, // chance a fan off nominal heads back to nominal
        durationSec: { min: 10, max: 30 }, // time to complete a speed change
      },
    },

    // Hit sounds below come from js/recipes.js, measured off real machines.
    // hitGain is the peak level of a hit before the volume knobs.
    // pitch multiplies playback speed, so lower pitch also means a longer hit.
    // meanIdleSec is the average gap at the middle of that layer's RATE knob.

    drive: {
      label: 'DRIVES',
      position: { pan: 0.32, dist: 0.34 },
      defaultLevel: 0.3,
      maxGain: 1,

      meanIdleSec: 14,
      minIdleSec: 3,

      units: [
        { name: 'DRIVE 1', recipe: 'driveA', gain: 1, pitch: 1, pan: -0.1 },
        { name: 'DRIVE 2', recipe: 'driveB', gain: 0.85, pitch: 0.93, pan: 0.06 },
        { name: 'DRIVE 3', recipe: 'driveA', gain: 0.75, pitch: 1.07, pan: 0.15 },
      ],

      // Which real drive to hear. id matches `model` in samples/manifest.json.
      models: [
        { id: 'pc', label: 'OLD PC' },
        { id: 'st277n', label: 'ST277N' },
        { id: 'caviar', label: 'CAVIAR' },
        { id: 'vintage', label: 'VINTAGE' },
      ],
      defaultModel: 'pc',

      // Recorded bursts of real drive activity, used whenever samples/ has them.
      recording: {
        gain: 0.8,
        pitchVary: 0.04,
        spurtBursts: { min: 1, max: 3 },
        readBursts: { min: 3, max: 8 },
        joinSec: { min: 0.03, max: 0.5 }, // silence between bursts
        recalChance: 0.04, // how often activity is the heavy recalibrate sound
        recalGain: 0.3,
      },

      // Everything below is the synthesized fallback for when samples are absent.
      // Real drives wait for the sector to come round, so seeks land on whole
      // disk rotations. That is what gives them their purring, regular rhythm.
      rotationSec: 1 / 60, // 3600 rpm
      jitterSec: 0.0012,

      spurt: { seeks: { min: 3, max: 14 }, rotations: [2, 2, 3, 3, 4, 6, 9] },
      read: {
        chance: 0.22,
        seeks: { min: 30, max: 110 },
        rotations: [2, 2, 2, 3, 3, 3, 3, 4],
        pauseChance: 0.05,
        pauseSec: { min: 0.15, max: 0.7 },
      },

      hitGain: 0.5,
      levelVaryDb: 3.5,
      pitchVary: 0.035,
      // A seek is two hits: the arm starts, then it lands and settles.
      accel: { level: 0.5, pitch: 1.1, gapSec: { min: 0.006, max: 0.018 } },
      // Long seeks: the head crossing tracks, a quick zip of small ticks.
      step: {
        chance: 0.2,
        ticks: { min: 4, max: 12 },
        gapSec: { min: 0.006, max: 0.0095 },
        level: 0.32,
        pitch: 1.3,
      },
      // Steady spindle and bearing tones, measured on the Conner.
      whine: {
        tones: [
          { hz: 60, gain: 0.0035 },
          { hz: 1079, gain: 0.0011 },
          { hz: 2003, gain: 0.0007 },
          { hz: 3467, gain: 0.0005 },
        ],
        ampDrift: { min: 0.7, max: 1.1, tauSec: 33 },
      },
    },

    tape: {
      label: 'TAPE',
      position: { pan: -0.42, dist: 0.72 },
      defaultLevel: 0.5,
      maxGain: 1,

      meanIdleSec: 55,
      minIdleSec: 12,
      shuttleChance: 0.4, // otherwise a read job

      // Which shuttle to hear. id matches `model` in samples/manifest.json, and
      // SYNTH has no samples, so it uses the synthesized shuttle further down.
      models: [
        { id: 'reel', label: 'REEL', gain: 1 },
        { id: 'revox', label: 'REVOX', gain: 1 },
        { id: 'tonal', label: 'TONAL', gain: 1 },
        { id: 'synth', label: 'SYNTH', gain: 1 },
      ],
      defaultModel: 'reel',

      // Recorded shuttles, whole from start to stop.
      recording: {
        gain: 0.8,
        pitchVary: 0.04,
        levelVaryDb: 1.5,
        forwardChance: 0.3, // only changes the log line
      },

      units: [
        { name: 'A', motorHz: 59.6, bandHz: 310, reelHz: 3.3, pan: -0.14 },
        { name: 'B', motorHz: 60.3, bandHz: 365, reelHz: 2.7, pan: 0.12 },
      ],

      // Moving tape is a narrow pitched band with harmonics, not plain hiss.
      // Harmonic strengths measured on reel-to-reel rewind recordings.
      bandQ: 16,
      bandHarmonics: [1, 0.55, 0.32, 0.16],
      bandGain: 2.8,
      motorGain: 0.012,
      motorLowpassHz: 300,
      reelDepth: 0.2, // slow pulsing from the turning reels
      restCents: -1900, // speed when stopped, relative to read speed
      speedDriftCents: { min: -9, max: 9, tauSec: 17 },

      read: {
        level: 0.32, // reads are much quieter than a shuttle
        blocks: { min: 1, max: 5 },
        blockSec: { min: 2.5, max: 11 },
        restSec: { min: 0.7, max: 3.5 },
        riseTc: 0.16,
      },
      shuttle: {
        level: 1,
        startCents: { min: 500, max: 900 },
        // The pitch keeps sliding as tape moves from one reel to the other:
        // falling on a rewind, rising on a fast forward.
        rewindSlideCents: { min: -1400, max: -900 },
        forwardSlideCents: { min: 500, max: 800 },
        riseSec: { min: 1.5, max: 3.5 },
        slideSec: { min: 8, max: 24 },
        forwardChance: 0.3,
      },
      // At the end of a rewind the loose tape end slaps the machine, slowing down.
      flap: {
        chance: 0.5,
        slaps: { min: 10, max: 22 },
        firstGapSec: 0.05,
        growth: 1.09, // each gap is this much longer than the last
        level: 0.3,
        pitch: 1.5,
      },
      stopTc: 0.14,
      stopLevelTc: 0.05, // reads stop quickly: the capstan lets go
      // Synth shuttles stop on the brake. Real reel machines take 0.5 to 0.7 s
      // to fall away.
      brakeTc: 0.3,
      brakeLevelTc: 0.25,
      brakeSec: 0.8, // when the latch clunks
      levelTc: 0.012, // how fast tape noise starts; keep it near instant
      clunkGain: 0.5,
      clunkPitchVary: 0.08,
      levelVaryDb: 2.5,
    },

    relay: {
      label: 'RELAYS',
      position: { pan: 0.58, dist: 0.8 },
      defaultLevel: 0.6,
      maxGain: 1,

      meanIdleSec: 22,
      minIdleSec: 2,
      cluster: { clicks: { min: 1, max: 5 }, meanGapSec: 0.14, minGapSec: 0.035 },

      // Synthesized clicks, or real relays. id matches `model` in
      // samples/manifest.json. Recorded clicks bring their own contact bounce.
      // gain makes up for the relays' place at the back of the room: distance
      // dulls the bright crossbar clicks far more than the heavy ones.
      models: [
        { id: 'synth', label: 'SYNTH', gain: 1 },
        { id: 'crossbar', label: 'CROSSBAR', gain: 1.3 },
        { id: 'switchboard', label: 'SWITCHBOARD', gain: 1.07 },
        { id: 'heavy', label: 'HEAVY', gain: 0.71 },
      ],
      defaultModel: 'synth',
      recording: { gain: 0.6, pitchVary: 0.03 },

      hitGain: 0.42,
      // Contacts bounce: a few fast, shrinking ticks after the main one.
      bounce: {
        count: { min: 0, max: 3 },
        gapSec: { min: 0.006, max: 0.012 },
        decay: 0.42, // each bounce relative to the one before
      },
      levelVaryDb: 3.5,
      pitchVary: 0.1,
      panWidth: 0.16,
    },

    keyboard: {
      label: 'KEYBOARD',
      position: { pan: 0.04, dist: 0.14 },
      defaultLevel: 0.65,
      maxGain: 1,

      meanIdleSec: 75,
      minIdleSec: 20,

      // Typed for real: one keystroke per character, then RETURN.
      // Which real keyboard to hear. id matches `model` in samples/manifest.json.
      // Their levels are matched in the manifest by scripts/levels.mjs.
      models: [
        { id: 'office', label: 'OFFICE' },
        { id: 'soft', label: 'SOFT' },
        { id: 'mech', label: 'MECH' },
        { id: 'modelf', label: 'MODEL F' },
      ],
      defaultModel: 'office',

      // Recorded keystrokes, used whenever samples/ has them. Space and Return
      // use the heaviest strokes in the recording.
      recording: {
        gain: 0.33,
        pitchVary: 0.03,
        levelVaryDb: 4,
      },

      commands: [
        'STATUS', 'SCAN 7215', 'POLL ALL', 'LOG TAIL', 'RECAL ANT 2', 'CHK MEM',
        'SWEEP +40', 'DIR /A', 'SYNC CLK', 'HOLD', 'RESUME', 'LIST FREQ',
      ],

      keyGapSec: { median: 0.135, spread: 0.56 }, // spread: bigger = less even
      wordPauseSec: { min: 0.12, max: 0.4 },
      returnPauseSec: { min: 0.35, max: 0.9 },

      // Everything below is the synthesized fallback for when samples are absent,
      // apart from the level and pitch of space and Return.
      hitGain: 0.42,
      levelVaryDb: 3.5,
      pitchVary: 0.05,
      // A keystroke is three sounds: the spring buckles, the key bottoms out,
      // and the key comes back up.
      bottom: { level: 0.55, gapSec: { min: 0.006, max: 0.011 } },
      release: { level: 0.3, pitch: 1.2, gapSec: { min: 0.055, max: 0.1 } },
      spaceBar: { level: 1, pitch: 0.72 },
      returnKey: { level: 1, pitch: 0.8 },
      pan: 0,
    },

    beeps: {
      label: 'BEEPS',
      position: { pan: -0.14, dist: 0.3 },
      defaultLevel: 0.5,
      maxGain: 1,

      meanIdleSec: 50,
      minIdleSec: 8,
      chirpChance: 0.3,
      reportChance: 0.25, // whatever is left is a single beep

      // Deliberately not notes of any scale, so nothing reads as a melody.
      pitchesHz: [287, 362, 431, 518, 647, 742],
      wave: 'triangle',
      lowpassHz: 1300, // the main guard against shrillness
      gain: 0.2,
      attackSec: 0.009,
      decaySec: 0.09,
      levelVaryDb: 2.5,
      detuneCents: 7,
      pan: 0,

      selfTest: { pitchHz: 431, holdSec: 0.14 }, // the power-on beep
      single: { holdSec: { min: 0.05, max: 0.17 } },
      chirp: { holdSec: 0.06, gapSec: 0.035 },
      // A short coded report: short and long pips on one or two pitches.
      report: {
        pips: { min: 3, max: 8 },
        shortSec: 0.05,
        longSec: 0.17,
        longChance: 0.35,
        gapSec: { min: 0.07, max: 0.12 },
        secondPitchChance: 0.55,
      },
    },

    printer: {
      label: 'PRINTER',
      position: { pan: -0.74, dist: 0.46 },
      defaultLevel: 0.55,
      maxGain: 1,

      meanIdleSec: 240,
      minIdleSec: 60,
      pan: 0,
      documents: ['DIAGNOSTIC LOG', 'SIGNAL REPORT', 'NAV TABLE', 'MEMORY DUMP', 'WATCH LOG'],

      // With samples: whole lines of real printing, one after another.
      sample: {
        gain: 0.48,
        lines: { min: 3, max: 9 },
        returnSec: { min: 0.12, max: 0.34 }, // the head going back
        feedGain: 0.1, // the paper-feed knock between lines
        pitchVary: 0.02,
      },
      // Without samples.
      synth: {
        lines: { min: 3, max: 8 },
        lineSec: { min: 0.7, max: 1.5 },
        feedSec: 0.28,
        feedGain: 0.2,
        pinHz: 170, // how fast the head buzzes
        bandHz: 2400,
        bandQ: 0.8,
        gain: 0.8,
        travel: 0.3, // how far the head crosses the stereo field
      },
    },

    modem: {
      label: 'MODEM',
      position: { pan: 0.76, dist: 0.5 },
      defaultLevel: 0.4,
      maxGain: 1,

      meanIdleSec: 280,
      minIdleSec: 80,
      dataChance: 0.45, // otherwise a handshake
      pan: 0,
      baudRates: [1200, 2400, 9600, 14400],

      sample: {
        gain: 0.52,
        handshakeSec: { min: 2.5, max: 5.5 },
        dataSec: { min: 1.5, max: 5 },
        pitchVary: 0.015,
        fadeSec: 0.004, // carriers cut in and out; this only prevents a click
        lowpassHz: { min: 2600, max: 3400 }, // the width of a phone line
      },
      synth: {
        answerHz: 2100,
        answerSec: 1.6,
        pairHz: [1200, 2400, 1800, 1200],
        pairSec: 0.32,
        wave: 'sine',
        lowpassHz: 3000,
        gain: 0.05,
        dataSec: { min: 1.5, max: 5 },
        dataBandHz: 1800,
        dataBandQ: 0.7,
      },
    },

    // Measured off shortwave receivers: a hard-edged channel, slow fading
    // over 10 s or more, parallel whistles when tuning, Morse near 1.1 kHz at
    // 15 wpm, and teleprinter tones 170 Hz apart. meanIdleSec values are at
    // the middle of the RATE knob.
    hull: {
      label: 'HULL',
      defaultLevel: 0.5,
      maxGain: 1,
      width: 0.85, // how far round you the sounds can come from
      ticks: {
        meanIdleSec: 80,
        minIdleSec: 20,
        count: { min: 1, max: 6 },
        gapSec: { min: 0.4, max: 3.5 },
        gain: 0.45,
      },
      creaks: {
        meanIdleSec: 260,
        minIdleSec: 70,
        gain: 0.6,
      },
    },

    signal: {
      label: 'RECEIVER',
      defaultLevel: 0.5,
      maxGain: 1,
      position: { pan: 0.36, dist: 0.82 }, // a set murmuring at the back of the capsule

      staticLevel: 0.13,
      // The receiver stays quiet until it has something to do.
      squelch: {
        closed: 0.03, // static level while idle: 0 is silent, 1 is fully open
        openTc: 0.05,
        closeTc: 0.12,
        tailSec: { min: 0.4, max: 1.6 }, // stays open this long after activity
      },
      crackleGain: 0.045,

      channel: {
        bottomHz: 280,
        topHz: { min: 1900, max: 3100, tauSec: 41 }, // top edge of the channel
        humpHz: { min: 500, max: 1900 }, // where a scan leaves the emphasis
        humpQ: 0.8,
        humpDb: { min: 3, max: 9, tauSec: 29 },
      },

      // Fading in dB. The two speeds are unrelated, so swells never repeat.
      presenceCurve: 0.55, // how much the Signal macro moves the level

      // Real off-air recordings, or the synthesized signals below.
      models: [
        { id: 'real', label: 'OFF AIR' },
        { id: 'synth', label: 'SYNTH' },
      ],
      defaultModel: 'real',
      recording: { gain: 0.5, pitchVary: 0.02 },

      // Transmitters switch on and off. These edges are measured: a real signal
      // drops by half in about 0.1 s.
      edges: { onTc: 0.05, offTc: 0.13 },

      // Fading on the receiver as a whole, in dB.
      fading: { min: -3, max: 1, tauSec: 23 },
      slowFading: { min: -4, max: 1, tauSec: 47 },
      // Fading of signals on their way here: about 15 dB, irregular, and mostly
      // slower than twice a second, as measured on a real Morse station.
      signalFading: { min: -14, max: 1, tauSec: 2.4 },
      signalFadingMotion: { gapSec: [0.25, 0.9], tc: 0.22 },

      scan: {
        meanIdleSec: 50,
        minIdleSec: 12,
        durationSec: { min: 4, max: 11 },
        lines: { min: 2, max: 5 },
        startHz: { min: 500, max: 1900 },
        slideHz: { min: 500, max: 1400 },
        spacingHz: { min: 130, max: 220 },
        lowestHz: 120,
        gain: 0.045,
        bandMHz: { min: 3.2, max: 17.9 }, // dial readings in the log
      },

      carrier: {
        durationSec: { min: 9, max: 24 },
        pitchesHz: [640, 815, 1040, 1320],
        harmonics: [1, 0.22, 0.09],
        driftCents: { min: -35, max: 35 },
        dropouts: { count: { min: 0, max: 4 }, gapSec: { min: 0.06, max: 0.3 } },
        gain: 0.055,
      },

      // Morse and teleprinter fragments.
      fragment: {
        durationSec: { min: 6, max: 15 },
      },
      // Recorded messages going round on a loop somewhere.
      broadcast: {
        gain: 0.4,
        pitchVary: 0.015,
        midwayChance: 0.3, // chance of tuning in partway through
        repeatChance: 0.3, // chance of hearing it go round again
        repeatGapSec: { min: 1.5, max: 4 },
        leadSec: 0.45, // silence before the voice starts in each file
        trailSec: 0.5,
      },
      morse: {
        // The Meridian's own traffic, keyed by Ezra so it can be read by ear.
        // Ham shorthand: CQ = calling anyone, DE = from, K = go ahead,
        // QRZ = who is calling me, = marks a break, 73 = best regards.
        storyChance: 0.5, // otherwise another station
        fromStartChance: 0.65, // otherwise you catch it partway in
        meridianDah: 3.7, // Ezra's dahs, in dits; standard is 3
        messages: [
          'HALCYON DE MERIDIAN = EZRA HERE K',
          'CQ EARTH CQ EARTH DE MERIDIAN K',
          'ANY STATION ANY STATION QRV? K',
          'LIGHTHOUSE STILL BURNING = 73',
          'TWO VOICES BETTER THAN ONE K',
          'CQ CQ CQ DE MERIDIAN MERIDIAN K',
          'QRZ QRZ DE MERIDIAN K',
          'ANY STATION ANY STATION DE MERIDIAN = PSE QSL K',
          'MERIDIAN = ALL CREW WELL = HOLDING POSITION K',
          'DAY 4012 = NOTHING TO REPORT = LAMPS ON',
          'WE ARE STILL HERE = WE ARE STILL LISTENING',
          'IF YOU COPY ANSWER ON ANY CHANNEL K',
          'THE STARS ARE BEAUTIFUL OUT HERE = 73',
          'QTH DEEP SPACE = NO CARRIER = 73 K',
        ],
        wpm: { min: 12, max: 18 },
        pitchHz: { min: 640, max: 1150 },
        harmonics: [1, 0.18],
        edgeSec: 0.006, // softens each key press
        gain: 0.085,
      },
      data: {
        baud: 45.45,
        shiftHz: 170,
        pitchHz: { min: 900, max: 2000 },
        gain: 0.04,
      },
    },

    // What the receiver picks up, each with its own controls. They all play
    // through the receiver above. meanIdleSec is the average gap at the middle
    // of the RATE knob; the Signal macro makes all of them more or less common.
    morse: {
      label: 'MORSE',
      defaultLevel: 0.5,
      maxGain: 1,
      meanIdleSec: 145,
      minIdleSec: 25,
    },

    teleprinter: {
      label: 'TELEPRINTER',
      defaultLevel: 0.5,
      maxGain: 1,
      meanIdleSec: 270,
      minIdleSec: 25,
    },

    carrier: {
      label: 'CARRIER',
      defaultLevel: 0.5,
      maxGain: 1,
      meanIdleSec: 85,
      minIdleSec: 20,
    },

    broadcast: {
      label: 'BROADCAST',
      defaultLevel: 0.5,
      maxGain: 1,
      meanIdleSec: 190,
      minIdleSec: 90,
    },

    timesignal: {
      label: 'TIME SIGNAL',
      defaultLevel: 0.45,
      maxGain: 1,
      meanIdleSec: 520,
      minIdleSec: 150,
    },

    // The capsule's own systems. Each plays a stretch of a real recording,
    // between the knocks of a switch or valve. edgeSec softens the cut ends.
    antenna: {
      label: 'ANTENNA',
      defaultLevel: 0.45,
      maxGain: 1,
      meanIdleSec: 600, // besides turning with every scan
      minIdleSec: 120,
      slewSec: { min: 2.5, max: 6 },
      gain: 0.55,
      pitch: 0.55, // a big, slow motor
      lowpassHz: 1300, // heard through the hull
      edgeSec: 0.05,
      knockGain: 0.12,
      knockPitch: 0.6,
    },

    thrusters: {
      label: 'THRUSTERS',
      defaultLevel: 0.45,
      maxGain: 1,
      meanIdleSec: 420,
      minIdleSec: 120,
      puffs: { min: 1, max: 3 },
      gapSec: { min: 0.35, max: 1.4 },
      gain: 0.4,
      thumpGain: 0.25,
      lowpassHz: 1400, // outside the hull, felt more than heard
    },

    lifesupport: {
      label: 'LIFE SUPPORT',
      defaultLevel: 0.4,
      maxGain: 1,
      meanIdleSec: 240,
      minIdleSec: 60,
      runSec: { min: 18, max: 30 },
      gain: 0.35,
      edgeSec: 0.12,
      knockGain: 0.16,
      knockPitch: 0.55,
    },

    hydroponics: {
      label: 'HYDROPONICS',
      defaultLevel: 0.45,
      maxGain: 1,
      meanIdleSec: 300,
      minIdleSec: 90,
      runSec: { min: 9, max: 17 },
      gain: 0.18,
      trickleGain: 0.13,
      edgeSec: 0.08,
      knockGain: 0.1,
      knockPitch: 0.7,
    },

    drone: {
      label: 'SPACE DRONE',
      defaultLevel: 0.5,
      maxGain: 1,

      // Unrelated frequencies, so it stays a texture and not a chord. Most of
      // this is below what small speakers can play; the top tones are what
      // you hear on a laptop. levelDrift tau: how slowly each one swells.
      tones: [
        { hz: 36.7, gain: 0.09, pan: 0, detuneCents: { min: -14, max: 14, tauSec: 137 }, levelDrift: { min: 0.3, max: 1, tauSec: 89 } },
        { hz: 43.1, gain: 0.07, pan: -0.45, detuneCents: { min: -14, max: 14, tauSec: 173 }, levelDrift: { min: 0.2, max: 1, tauSec: 113 } },
        { hz: 58.9, gain: 0.04, pan: 0.5, detuneCents: { min: -18, max: 18, tauSec: 109 }, levelDrift: { min: 0.15, max: 1, tauSec: 149 } },
        { hz: 81.3, gain: 0.018, pan: -0.7, detuneCents: { min: -20, max: 20, tauSec: 191 }, levelDrift: { min: 0.1, max: 1, tauSec: 97 } },
        { hz: 119.7, gain: 0.007, pan: 0.7, detuneCents: { min: -24, max: 24, tauSec: 157 }, levelDrift: { min: 0.05, max: 1, tauSec: 127 } },
      ],
      rumble: {
        gain: 0.16,
        pan: 0,
        lowpassHz: { min: 45, max: 110, tauSec: 103 },
        ampDrift: { min: 0.5, max: 1.1, tauSec: 79 },
      },
    },
  },
};

export type Config = typeof CONFIG;
export type LayerConfigs = Config['layers'];
export type LayerId = keyof LayerConfigs;
