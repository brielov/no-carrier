import type { HitRecipe } from './hits';

// Hit recipes measured from real recordings. See hits.ts for the format.
//
// These numbers are the only thing taken from the recordings: no audio is
// included or played. All sources are CC0 on Freesound.
//
// Each recipe was fitted to an average of many hits so that its spectrum
// matches the recording. To make a hit brighter or darker, edit the gains.

export const RECIPES = {
  // Western Digital Caviar 32500, by galeku (freesound.org/s/116033)
  driveA: {
    modes: [[205.1, 0.119, 0.1282], [334.0, 0.185, 0.1334], [416.0, 0.214, 0.178], [492.2, 0.186, 0.1409], [591.8, 0.501, 0.1194], [855.5, 0.552, 0.0678], [1037.1, 0.328, 0.1494], [2197.3, 0.207, 0.1352]],
    noise: [[1000, 0.746, 0.1283], [2000, 1.0, 0.1171], [4000, 0.095, 0.1082]],
    lengthSec: 0.09,
  },
  // Conner CFS420A, by Klerrp (freesound.org/s/155882)
  driveB: {
    modes: [[205.1, 0.106, 0.0974], [293.0, 0.469, 0.1209], [480.5, 0.1, 0.22], [1078.1, 0.172, 0.22], [1582.0, 0.501, 0.0599], [2003.9, 0.383, 0.1504], [2736.3, 0.462, 0.0749], [3462.9, 0.397, 0.1573]],
    noise: [[500, 0.571, 0.22], [1000, 0.254, 0.22], [4000, 1.0, 0.0939], [8000, 0.045, 0.1638]],
    lengthSec: 0.12,
  },
  // Relay and loud click, by bassmosphere (freesound.org/s/384701)
  relay: {
    modes: [[873.0, 0.131, 0.22], [972.7, 0.197, 0.1961], [1130.9, 0.18, 0.2121], [1605.5, 0.235, 0.22], [2162.1, 0.14, 0.22]],
    noise: [[250, 0.235, 0.22], [500, 0.55, 0.22], [1000, 1.0, 0.1653], [2000, 0.571, 0.22], [4000, 0.269, 0.1903], [8000, 0.209, 0.1758]],
    lengthSec: 0.1,
  },
  // IBM Model F keyboard, by Fractal_ (freesound.org/s/500430)
  keyF: {
    modes: [[117.2, 0.201, 0.1733], [222.7, 0.043, 0.22], [298.8, 0.13, 0.1243], [1500.0, 0.258, 0.0995], [2003.9, 0.094, 0.1088]],
    noise: [[250, 0.142, 0.1584], [1000, 0.521, 0.1102], [2000, 1.0, 0.1091], [4000, 0.575, 0.1202], [8000, 0.261, 0.1]],
    lengthSec: 0.09,
  },
  // Buckling spring keyboard, by nakkivene66 (freesound.org/s/551404)
  keyB: {
    modes: [[603.5, 0.029, 0.1829], [1013.7, 0.095, 0.1001], [1746.1, 0.055, 0.0799], [3087.9, 0.118, 0.0759]],
    noise: [[1000, 0.297, 0.0998], [2000, 1.0, 0.0706], [4000, 0.203, 0.0754]],
    lengthSec: 0.08,
  },
  // Tape Deck Startup, by soundjoao (freesound.org/s/331385)
  clunk: {
    modes: [[228.5, 0.066, 0.22], [679.7, 0.11, 0.1384], [1418.0, 0.117, 0.0807], [1623.0, 0.056, 0.1802]],
    noise: [[250, 1.0, 0.22], [1000, 0.727, 0.1054], [2000, 0.52, 0.0917], [4000, 0.391, 0.0907], [8000, 0.299, 0.0605]],
    lengthSec: 0.16,
  },
} satisfies Record<string, HitRecipe>;

export type RecipeName = keyof typeof RECIPES;
