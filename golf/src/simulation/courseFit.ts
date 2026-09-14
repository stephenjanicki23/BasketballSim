/**
 * Course fit.
 *
 * An important thing about this number: it is a *readout*, not an input. The
 * simulation never consults it. A wind specialist scores better at the Coastal
 * Championship because the shot engine actually gives him less dispersion and
 * less drift in a 25 mph crosswind — not because a fit score nudged his
 * probability. Course fit simply tells the player, in advance, what the engine is
 * going to do, which is why it can be honest about "influences rather than
 * guarantees": a fit of 92 is still going to shoot 76 in the wrong week.
 */

import { clamp } from './rng';
import { effective } from './golferEngine';
import type { Course, Golfer } from './types';

export interface FitBreakdown {
  /** 1–100. */
  score: number;
  /** Score minus the golfer's overall ability: positive means this suits them. */
  edge: number;
  /** The strongest and weakest components, for the UI. */
  strengths: { label: string; value: number }[];
  concerns: { label: string; value: number }[];
}

interface Component {
  key: keyof Course['fit'];
  label: string;
  value: (golfer: Golfer) => number;
}

const COMPONENTS: Component[] = [
  {
    key: 'distance', label: 'Length off the tee',
    value: (g) => effective(g, 'driverDistance') * 0.65 + effective(g, 'ballSpeed') * 0.35,
  },
  {
    key: 'accuracy', label: 'Driving accuracy',
    value: (g) => effective(g, 'driverAccuracy') * 0.75 + effective(g, 'approachConsistency') * 0.25,
  },
  {
    key: 'rough', label: 'Play from the rough',
    value: (g) => effective(g, 'difficultLies') * 0.5 + effective(g, 'recovery') * 0.3 + effective(g, 'chipping') * 0.2,
  },
  {
    key: 'wind', label: 'Wind play',
    value: (g) => effective(g, 'wind') * 0.8 + effective(g, 'composure') * 0.2,
  },
  {
    key: 'greens', label: 'Putting and green play',
    value: (g) => effective(g, 'putting') * 0.5 + effective(g, 'longPutting') * 0.2 + effective(g, 'shortIron') * 0.3,
  },
  {
    key: 'water', label: 'Avoiding disaster',
    value: (g) => effective(g, 'decisionMaking') * 0.4 + effective(g, 'courseManagement') * 0.3 + effective(g, 'consistency') * 0.3,
  },
  { key: 'elevation', label: 'Judging elevation', value: (g) => elevationValue(g) },
  {
    key: 'strategy', label: 'Course management',
    value: (g) => effective(g, 'courseManagement') * 0.6 + effective(g, 'decisionMaking') * 0.4,
  },
  {
    key: 'heat', label: 'Heat endurance',
    value: (g) => effective(g, 'hotWeather') * 0.6 + effective(g, 'stamina') * 0.2 + effective(g, 'fatigueResistance') * 0.2,
  },
  {
    key: 'rain', label: 'Wet conditions',
    value: (g) => effective(g, 'rain') * 0.7 + effective(g, 'difficultLies') * 0.3,
  },
];

/** Elevation judgement leans on ball-striking and adaptability. */
function elevationValue(golfer: Golfer): number {
  return effective(golfer, 'longIron') * 0.4 + effective(golfer, 'midIron') * 0.25 + golfer.hidden.adaptability * 0.35;
}

export function courseFit(golfer: Golfer, course: Course): FitBreakdown {
  let total = 0;
  let weight = 0;
  const parts: { label: string; value: number; weight: number }[] = [];

  for (const component of COMPONENTS) {
    const w = course.fit[component.key];
    if (w <= 0.02) continue;
    const value = component.key === 'elevation' ? elevationValue(golfer) : component.value(golfer);
    total += value * w;
    weight += w;
    parts.push({ label: component.label, value: Math.round(value), weight: w });
  }

  const raw = weight > 0 ? total / weight : 50;
  const score = clamp(Math.round(raw), 1, 99);
  parts.sort((a, b) => b.value * b.weight - a.value * a.weight);

  return {
    score,
    edge: score - golfer.hidden.currentAbility,
    strengths: parts.slice(0, 3).map(({ label, value }) => ({ label, value })),
    concerns: parts.slice(-2).reverse().map(({ label, value }) => ({ label, value })),
  };
}

/** Short verdict for the UI. */
export function fitVerdict(fit: FitBreakdown): string {
  if (fit.edge >= 6) return 'Made for him';
  if (fit.edge >= 2.5) return 'Suits his game';
  if (fit.edge >= -2.5) return 'Neutral test';
  if (fit.edge >= -6) return 'Awkward fit';
  return 'Wrong course for him';
}
