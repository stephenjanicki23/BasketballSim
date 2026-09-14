/**
 * Expected strokes to hole out, by lie and distance.
 *
 * This is the currency the whole game thinks in. The dispersion overlay uses it
 * to tell the player what a shot is really worth, and the simulation AI uses it
 * to choose between a 3 wood up the safe side and a driver at the corner. The
 * numbers are a tour-level baseline; a weaker field is scaled up by a few
 * percent rather than given its own table.
 */

import type { LieType } from './types';

type Table = readonly [number, number][];

/** Distance in yards → strokes. */
const FAIRWAY: Table = [
  [5, 2.10], [10, 2.18], [20, 2.40], [30, 2.52], [40, 2.58], [60, 2.67], [80, 2.73],
  [100, 2.79], [120, 2.84], [140, 2.90], [160, 2.98], [180, 3.07], [200, 3.18],
  [220, 3.31], [240, 3.44], [260, 3.57], [300, 3.80], [400, 4.30],
];

const ROUGH: Table = [
  [5, 2.32], [10, 2.44], [20, 2.62], [30, 2.72], [40, 2.80], [60, 2.90], [80, 2.98],
  [100, 3.05], [120, 3.12], [140, 3.20], [160, 3.30], [180, 3.42], [200, 3.55],
  [220, 3.68], [240, 3.82], [260, 3.95], [300, 4.20], [400, 4.75],
];

const SAND: Table = [
  [5, 2.50], [10, 2.58], [20, 2.72], [30, 2.83], [40, 2.92], [60, 3.05], [80, 3.18],
  [100, 3.30], [120, 3.42], [140, 3.56], [160, 3.72], [180, 3.90], [200, 4.08],
  [240, 4.35], [300, 4.70], [400, 5.10],
];

const RECOVERY: Table = [
  [5, 2.60], [10, 2.72], [20, 2.92], [30, 3.05], [40, 3.16], [60, 3.32], [80, 3.46],
  [100, 3.58], [120, 3.70], [140, 3.82], [160, 3.95], [180, 4.08], [200, 4.22],
  [240, 4.48], [300, 4.85], [400, 5.30],
];

const TEE_PAR45: Table = [
  [100, 2.80], [150, 2.92], [200, 3.05], [250, 3.30], [300, 3.60], [350, 3.82],
  [400, 4.00], [450, 4.20], [500, 4.42], [550, 4.66], [600, 4.92], [650, 5.20],
];

/** Putting, by distance in feet. */
const GREEN: Table = [
  [1, 1.001], [2, 1.01], [3, 1.05], [4, 1.13], [5, 1.23], [6, 1.34], [7, 1.42],
  [8, 1.50], [9, 1.56], [10, 1.61], [12, 1.68], [15, 1.78], [20, 1.87], [25, 1.94],
  [30, 2.00], [40, 2.10], [50, 2.20], [60, 2.30], [90, 2.55],
];

function lookup(table: Table, x: number): number {
  if (x <= table[0][0]) {
    // Below the table, ease toward 1 stroke at zero distance.
    const [x0, y0] = table[0];
    return 1 + (y0 - 1) * (x / x0);
  }
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  const last = table[table.length - 1];
  const prev = table[table.length - 2];
  const slope = (last[1] - prev[1]) / (last[0] - prev[0]);
  return last[1] + slope * (x - last[0]);
}

/**
 * Strokes to hole out from a given lie at a given distance in yards.
 * `abilityScale` shifts the whole surface for a weaker or stronger player.
 */
export function strokesToHoleOutExact(lie: LieType, yards: number, abilityScale = 1): number {
  if (lie === 'green') return lookup(GREEN, yards * 3) * (1 + (abilityScale - 1) * 0.6);
  let base: number;
  switch (lie) {
    case 'tee':
      base = yards > 240 ? lookup(TEE_PAR45, yards) : lookup(FAIRWAY, yards) - 0.06;
      break;
    case 'fairway':
    case 'fringe':
      base = lookup(FAIRWAY, yards);
      break;
    case 'firstCut':
      base = lookup(FAIRWAY, yards) + 0.04;
      break;
    case 'lightRough':
      base = lookup(ROUGH, yards) - 0.07;
      break;
    case 'heavyRough':
      base = lookup(ROUGH, yards) + 0.06;
      break;
    case 'deepRough':
      base = lookup(ROUGH, yards) + 0.26;
      break;
    case 'fairwayBunker':
      base = lookup(SAND, yards) + 0.04;
      break;
    case 'greensideBunker':
      base = lookup(SAND, yards);
      break;
    case 'pineStraw':
      base = lookup(ROUGH, yards) + 0.10;
      break;
    case 'waste':
      base = lookup(ROUGH, yards) + 0.08;
      break;
    case 'recovery':
      base = lookup(RECOVERY, yards);
      break;
    case 'water':
      // A penalty stroke, then playing from around where you went in.
      base = lookup(FAIRWAY, Math.max(30, yards)) + 1.05;
      break;
    case 'ob':
      base = lookup(FAIRWAY, Math.max(60, yards)) + 1.9;
      break;
    default:
      base = lookup(FAIRWAY, yards);
  }
  return base * abilityScale;
}

/** A tour-average player is 1.0; a fringe player needs a few percent more. */
export function abilityScaleFor(currentAbility: number): number {
  return 1 + (72 - currentAbility) * 0.0034;
}

// ---------------------------------------------------------------------------
// Precomputed lookup
// ---------------------------------------------------------------------------

/**
 * The interpolation above is called several hundred times per simulated shot —
 * tens of millions of times in a season — so it is baked into a flat array at
 * module load, one entry per yard per lie, and read with an array index.
 */
const LIE_KEYS: LieType[] = [
  'tee', 'fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough',
  'fairwayBunker', 'greensideBunker', 'pineStraw', 'waste', 'recovery',
  'fringe', 'green', 'water', 'ob',
];
const MAX_YARDS = 620;
const TABLE: Record<string, Float32Array> = Object.fromEntries(
  LIE_KEYS.map((lie) => {
    const values = new Float32Array(MAX_YARDS + 1);
    for (let yard = 0; yard <= MAX_YARDS; yard++) values[yard] = strokesToHoleOutExact(lie, yard);
    return [lie, values];
  }),
);

export function strokesToHoleOut(lie: LieType, yards: number, abilityScale = 1): number {
  const table = TABLE[lie];
  if (!table) return strokesToHoleOutExact(lie, yards, abilityScale);
  const index = yards <= 0 ? 0 : yards >= MAX_YARDS ? MAX_YARDS : Math.round(yards);
  return table[index] * abilityScale;
}
