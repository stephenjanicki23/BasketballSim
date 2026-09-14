/**
 * What the field would have done today.
 *
 * A number on its own — 65, seven under — does not tell you whether you played
 * well or whether the course was there for the taking. This plays a sample of
 * the tour over the same holes, the same pins and the same weather, through the
 * same engine, so a round can be read against the only thing that means
 * anything: what everybody else shot.
 */

import type { Conditions, Course, Golfer } from './types';
import { holeGeometry, pinForRound, withPin } from './courseEngine';
import { playHole } from './holeEngine';
import { createRng } from './rng';

export interface FieldBenchmark {
  /** How many golfers were played. */
  sample: number;
  average: number;
  best: number;
  /** Fraction of the sample the round beat, 0..1. */
  beaten: number;
  /** Where the round would have finished, 1 = leading. */
  position: number;
}

export function benchmarkRound(
  course: Course,
  conditions: Conditions,
  round: number,
  golfers: readonly Golfer[],
  strokes: number,
  sample = 24,
): FieldBenchmark {
  // Spread the sample across the ranking rather than taking the top: the field
  // average is a field average.
  const ranked = [...golfers].sort((a, b) => a.worldRank - b.worldRank);
  const step = Math.max(1, Math.floor(ranked.length / sample));
  const picked = ranked.filter((_, index) => index % step === 0).slice(0, sample);

  const scores: number[] = [];
  for (const golfer of picked) {
    const rng = createRng(`benchmark:${course.id}:${round}:${golfer.id}`);
    const fatigue = golfer.fatigue;
    golfer.fatigue = 0;
    let total = 0;
    for (let number = 1; number <= 18; number++) {
      const base = holeGeometry(course, number);
      const hole = withPin(base, pinForRound(base, round));
      total += playHole({ hole, golfer, conditions, rng, pressure: 0.15, fast: true, shotSeed: number * 7 }).strokes;
    }
    golfer.fatigue = fatigue;
    scores.push(total);
  }

  scores.sort((a, b) => a - b);
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return {
    sample: scores.length,
    average,
    best: scores[0],
    beaten: scores.filter((score) => score > strokes).length / scores.length,
    position: scores.filter((score) => score < strokes).length + 1,
  };
}
