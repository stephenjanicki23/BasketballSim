/**
 * Players get better and players get worse.
 *
 * Nobody is promoted by fiat. A 21-year-old with a potential of 95 moves toward
 * 95 only as fast as his own consistency and confidence let him, and plenty of
 * them stall in the low 80s — potential is a ceiling, not a plan. Meanwhile the
 * distance leaves the thirty-somethings a yard at a time while their course
 * management keeps improving, which is why a 38-year-old can still win on the
 * right golf course.
 */

import { type Rng, clamp } from './rng';
import { currentAbility } from './golferEngine';
import type { Golfer, RatingKey } from './types';

const PHYSICAL: RatingKey[] = ['driverDistance', 'ballSpeed', 'stamina', 'fatigueResistance'];
const TECHNICAL: RatingKey[] = [
  'driverAccuracy', 'launch', 'longIron', 'midIron', 'shortIron', 'wedgeAccuracy',
  'approachConsistency', 'chipping', 'pitching', 'bunkerPlay', 'recovery',
  'putting', 'longPutting', 'shortPutting',
];
const MENTAL: RatingKey[] = [
  'composure', 'decisionMaking', 'courseManagement', 'clutch', 'consistency',
  'drivingPressure', 'puttingPressure',
];
const CONDITIONS: RatingKey[] = ['wind', 'rain', 'coldWeather', 'hotWeather', 'difficultLies'];

export interface DevelopmentNote {
  golferId: string;
  name: string;
  /** Change in current ability. */
  delta: number;
  headline: string;
  detail: string;
  retired: boolean;
}

/** One off-season of development for one golfer. */
export function developGolfer(golfer: Golfer, rng: Rng, seasonRank: number): DevelopmentNote {
  const before = golfer.hidden.currentAbility;
  golfer.age++;
  golfer.career.seasons++;

  const age = golfer.age;
  const gap = golfer.hidden.potential - before;
  // How much of the remaining gap a player closes in a year. Young players with
  // the temperament to learn close it fastest; a 30-year-old is who he is.
  const youth = clamp((30 - age) / 10, 0, 1);
  const temperament =
    (golfer.ratings.consistency * 0.35 + golfer.ratings.decisionMaking * 0.25 + golfer.hidden.confidence * 0.4) / 100;
  const seasonBoost = seasonRank > 0 && seasonRank <= 15 ? 1.18 : seasonRank > 40 ? 0.8 : 1;
  const growth = Math.max(0, gap) * youth * 0.20 * (0.45 + temperament) * seasonBoost * rng.range(0.5, 1.5);

  // Physical decline, gentle at first and then not.
  const decline = age > 30 ? (age - 30) * 0.34 * rng.range(0.6, 1.5) : 0;

  for (const key of PHYSICAL) {
    const change = growth * 0.9 - decline * 1.25 + rng.range(-0.8, 0.8);
    golfer.ratings[key] = clamp(Math.round(golfer.ratings[key] + change), 10, 99);
  }
  for (const key of TECHNICAL) {
    const change = growth * 1.05 - decline * 0.28 + rng.range(-1.1, 1.1);
    golfer.ratings[key] = clamp(Math.round(golfer.ratings[key] + change), 10, 99);
  }
  for (const key of MENTAL) {
    // Experience keeps paying until the very end of a career.
    const change = growth * 0.5 + (age < 40 ? rng.range(0.2, 1.5) : rng.range(-0.4, 0.8));
    golfer.ratings[key] = clamp(Math.round(golfer.ratings[key] + change), 10, 99);
  }
  for (const key of CONDITIONS) {
    golfer.ratings[key] = clamp(Math.round(golfer.ratings[key] + growth * 0.35 + rng.range(-0.8, 1.2)), 10, 99);
  }

  // Potential itself erodes once a player is clearly not going to reach it.
  if (age >= 28 && gap > 4) golfer.hidden.potential = clamp(golfer.hidden.potential - rng.range(0.5, 2.5), before, 99);
  golfer.hidden.injuryRisk = clamp(golfer.hidden.injuryRisk + (age > 32 ? rng.range(0.5, 3) : rng.range(-1.5, 1.5)), 4, 88);
  golfer.hidden.adaptability = clamp(golfer.hidden.adaptability + rng.range(-2, 2), 10, 96);
  golfer.hidden.currentAbility = currentAbility(golfer);

  const delta = golfer.hidden.currentAbility - before;
  const retired = shouldRetire(golfer, rng, seasonRank);

  return {
    golferId: golfer.id,
    name: golfer.name,
    delta,
    headline: describe(golfer, delta, retired),
    detail: detailFor(golfer, delta, retired),
    retired,
  };
}

function shouldRetire(golfer: Golfer, rng: Rng, seasonRank: number): boolean {
  if (golfer.age < 38) return false;
  const pressure =
    (golfer.age - 38) * 0.16 + (seasonRank > 45 ? 0.3 : seasonRank > 35 ? 0.12 : 0) +
    (golfer.hidden.currentAbility < 55 ? 0.2 : 0);
  return rng.chance(clamp(pressure, 0, 0.92));
}

function describe(golfer: Golfer, delta: number, retired: boolean): string {
  if (retired) return `${golfer.name} retires at ${golfer.age}`;
  if (delta >= 4) return `${golfer.name} takes a real step forward`;
  if (delta >= 2) return `${golfer.name} improves again`;
  if (delta <= -4) return `${golfer.name} is going backwards`;
  if (delta <= -2) return `${golfer.name} loses a little ground`;
  return `${golfer.name} holds steady`;
}

function detailFor(golfer: Golfer, delta: number, retired: boolean): string {
  if (retired) {
    return `${golfer.career.wins} career wins and ${golfer.career.seasons} seasons on tour. ${
      golfer.career.majors > 0 ? `${golfer.career.majors} major${golfer.career.majors > 1 ? 's' : ''}.` : 'Never won a major.'
    }`;
  }
  if (delta >= 2) {
    return `Ability ${golfer.hidden.currentAbility} (+${delta}) at ${golfer.age}, with a ceiling of ${Math.round(golfer.hidden.potential)}.`;
  }
  if (delta <= -2) {
    return `Ability ${golfer.hidden.currentAbility} (${delta}) at ${golfer.age}. The distance is the first thing to go.`;
  }
  return `Ability ${golfer.hidden.currentAbility} at ${golfer.age}.`;
}
