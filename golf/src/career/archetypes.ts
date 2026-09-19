/**
 * Career archetypes: the identity a created golfer picks, and the ceiling it
 * gives them for the rest of their life.
 *
 * These are not a new taxonomy invented for the creation screen. They *are* the
 * archetypes the existing tour is built from — the same `ARCHETYPES` record the
 * simulation has always used to make a Bomber a bomber — filtered down to the
 * ones that work as a permanent identity and annotated with what a player needs
 * to know before committing to one.
 *
 * Two of the game's fourteen are deliberately not offered. `veteran` and
 * `prospect` are life stages rather than identities: a Young Prospect's defining
 * trait is that they grow out of it, so freezing one in as a career ceiling
 * ("you will never manage a golf course, at 41, because you were 23 once") is
 * nonsense. Everything else is on the table, including Volatile Superstar, which
 * is a genuine way to play golf for a living and not merely a bad one.
 */

import { ARCHETYPES } from '../simulation/golferEngine';
import type { ArchetypeId, RatingKey } from '../simulation/types';
import { CAPS, LINE_FOR_RATING, SKILL_LINES, SKILL_LINE_BY_ID, type SkillLineId } from './config';

/** The archetypes offered at creation, in the order they are shown. */
export const CAREER_ARCHETYPE_IDS: ArchetypeId[] = [
  'allRounder',
  'power',
  'bomber',
  'precision',
  'ballStriker',
  'shortGame',
  'elitePutter',
  'scrambler',
  'courseManager',
  'grinder',
  'windSpecialist',
  'volatile',
];

/**
 * How each identity is sold to the player, and how it is meant to be played.
 * The strengths and weaknesses are *not* written here — they are computed from
 * the caps, so the card can never disagree with the rules.
 */
const PITCH: Record<ArchetypeId, { tagline: string; plan: string }> = {
  allRounder: {
    tagline: 'Nothing to attack.',
    plan: 'No ceiling worth bragging about and no hole in the bag either. Wins on courses that punish a weakness, because you do not have one.',
  },
  power: {
    tagline: 'Overpower it.',
    plan: 'Take the trouble out of play by flying over it, and accept that you will play a lot of golf from the rough. Long courses are yours.',
  },
  bomber: {
    tagline: 'Length nobody can match.',
    plan: 'The most extreme driving ceiling in the game and the worst driving accuracy ceiling to go with it. Par 5s are par 4s; par 4s are an adventure.',
  },
  precision: {
    tagline: 'Never leave the fairway.',
    plan: 'Give up thirty yards for good and take it back with wedges from flat lies. Tight, tree-lined golf is where you beat the bombers.',
  },
  ballStriker: {
    tagline: 'Thirteen greens a round.',
    plan: 'The purest iron play available, and strokes handed back on the green every week. You win by hitting it closer than anybody, not by holing more.',
  },
  shortGame: {
    tagline: 'Magic from forty yards.',
    plan: 'Miss greens and it costs you nothing. Ordinary off the tee for ever, so you score by never making a bogey from a bad position.',
  },
  elitePutter: {
    tagline: 'Hole everything.',
    plan: 'The highest putting ceiling in the game. Get it on the green and the round takes care of itself; getting it there is the problem.',
  },
  scrambler: {
    tagline: 'Get away with it.',
    plan: 'Trees, rough, sand, hardpan — you have a shot from everywhere and a ceiling on hitting it straight in the first place.',
  },
  courseManager: {
    tagline: 'Never the wrong decision.',
    plan: 'Short, relentless, and almost incapable of a double bogey. Thrives where par is a good score and the field is making mistakes.',
  },
  grinder: {
    tagline: 'Make every cut.',
    plan: 'The smallest gap between your best and worst days of any identity. You will not shoot 62; you will not shoot 77 either.',
  },
  windSpecialist: {
    tagline: 'Love an ugly forecast.',
    plan: 'Flight it under the weather. On a links in a gale you are the best player in the field; on a soft, still parkland you are not.',
  },
  volatile: {
    tagline: '62 on Thursday, 78 on Friday.',
    plan: 'High ceilings across the bag and a consistency cap twenty points below the field median. Wins more than you would think, and misses cuts nobody else misses.',
  },
  veteran: { tagline: '', plan: '' },
  prospect: { tagline: '', plan: '' },
};

// ---------------------------------------------------------------------------
// Deriving the ceilings
// ---------------------------------------------------------------------------

/**
 * Within one line, how far each of its ratings sits from the line's own number.
 *
 * A line sets all of its ratings, but not to the same value: the archetype's bias
 * still has something to say about which of them it favours. A Bomber's Power line
 * covers driver distance (+26) and ball speed (+24), so the distance comes out a
 * point clear of the speed — small, but it is the difference between a model that
 * knows what a bomber is and one that averages it away.
 */
function withinLineOffsets(archetype: ArchetypeId, line: SkillLineId): Partial<Record<RatingKey, number>> {
  const keys = SKILL_LINE_BY_ID[line].keys;
  const bias = ARCHETYPES[archetype].bias;
  const mean = keys.reduce((acc, key) => acc + (bias[key] ?? 0), 0) / keys.length;
  const out: Partial<Record<RatingKey, number>> = {};
  for (const key of keys) out[key] = ((bias[key] ?? 0) - mean) * CAPS.withinLineBias;
  return out;
}

/**
 * How far a line's ceiling sits from neutral, before the budget is applied:
 * the mean of what the archetype's bias does to each rating the line owns,
 * with a weakness weighted harder than a strength.
 */
function rawDeviation(archetype: ArchetypeId, line: SkillLineId): number {
  const bias = ARCHETYPES[archetype].bias;
  const keys = SKILL_LINE_BY_ID[line].keys;
  const total = keys.reduce((acc, key) => {
    const value = bias[key] ?? 0;
    return acc + (value >= 0 ? value * CAPS.perPositiveBias : value * CAPS.perNegativeBias);
  }, 0);
  return total / keys.length;
}

/**
 * The deviations, scaled so every archetype pays the same price for its shape.
 *
 * Both sides are scaled to a budget rather than one being scaled to the other,
 * which is what keeps the two degenerate cases honest. An archetype whose bias has
 * no negatives at all (the Complete Player) has nothing to sell, so it gets no
 * surplus either and comes out flat at neutral — which is exactly what a player
 * with no weakness should be. And an archetype whose bias is mostly negative (the
 * Volatile Superstar) is not punished for it: its deficits shrink to the budget
 * and its handful of strengths grow to fill the other side.
 */
function normalisedDeviations(archetype: ArchetypeId): Record<SkillLineId, number> {
  const raw = Object.fromEntries(
    SKILL_LINES.map((line) => [line.id, rawDeviation(archetype, line.id)]),
  ) as Record<SkillLineId, number>;

  let surplus = 0;
  let deficit = 0;
  for (const line of SKILL_LINES) {
    const value = raw[line.id];
    if (value > 0) surplus += value;
    else deficit += -value;
  }

  // Nothing to trade in one direction means nothing to spend in the other: an
  // archetype with no weakness in its vector gets no strength out of this either.
  const deficitBudget = surplus > 0 ? CAPS.surplusBudget * CAPS.weaknessRatio : 0;
  const surplusBudget = deficit > 0 ? CAPS.surplusBudget : 0;

  const up = surplus > 0 ? surplusBudget / surplus : 0;
  const down = deficit > 0 ? deficitBudget / deficit : 0;

  const out = {} as Record<SkillLineId, number>;
  for (const line of SKILL_LINES) {
    const value = raw[line.id];
    out[line.id] = value > 0 ? value * up : value * down;
  }
  return out;
}

const deviationCache = new Map<ArchetypeId, Record<SkillLineId, number>>();

function deviations(archetype: ArchetypeId): Record<SkillLineId, number> {
  const cached = deviationCache.get(archetype);
  if (cached) return cached;
  const computed = normalisedDeviations(archetype);
  deviationCache.set(archetype, computed);
  return computed;
}

/** The career ceiling for a skill line under an archetype. */
export function careerCapForLine(archetype: ArchetypeId, line: SkillLineId): number {
  const value = CAPS.neutral + deviations(archetype)[line];
  return Math.round(Math.max(CAPS.min, Math.min(CAPS.max, value)));
}

/**
 * The career ceiling for one rating: its line's ceiling, offset by whichever of
 * the line's ratings the archetype favours. Derived from the line rather than
 * independently, so a rating's ceiling can never disagree with its line's.
 */
export function careerCapForRating(archetype: ArchetypeId, key: RatingKey): number {
  const line = LINE_FOR_RATING[key];
  // `launch` belongs to no line; it is a trait the archetype sets outright.
  if (!line) return Math.round(Math.max(30, Math.min(CAPS.max, CAPS.launchBase + (ARCHETYPES[archetype].bias.launch ?? 0))));
  const offset = withinLineOffsets(archetype, line)[key] ?? 0;
  return Math.round(Math.max(CAPS.min - 8, Math.min(CAPS.max, careerCapForLine(archetype, line) + offset)));
}

export type LineCaps = Record<SkillLineId, number>;

const capCache = new Map<ArchetypeId, LineCaps>();

/** Every line's ceiling for an archetype. Computed once. */
export function lineCaps(archetype: ArchetypeId): LineCaps {
  const cached = capCache.get(archetype);
  if (cached) return cached;
  const caps = Object.fromEntries(
    SKILL_LINES.map((line) => [line.id, careerCapForLine(archetype, line.id)]),
  ) as LineCaps;
  capCache.set(archetype, caps);
  return caps;
}

// ---------------------------------------------------------------------------
// What the player is shown
// ---------------------------------------------------------------------------

export interface CareerArchetype {
  id: ArchetypeId;
  name: string;
  tagline: string;
  /** The simulation's own one-line description of the type. */
  blurb: string;
  plan: string;
  caps: LineCaps;
  /** Lines whose ceiling is meaningfully above neutral, best first. */
  strengths: SkillLineId[];
  /** Lines whose ceiling is meaningfully below neutral, worst first. */
  weaknesses: SkillLineId[];
  /** The one line this identity is really about. */
  signature: SkillLineId;
}

/** How far from neutral a ceiling has to be before it is worth naming. */
const NOTABLE = 3;

function buildCareerArchetype(id: ArchetypeId): CareerArchetype {
  const caps = lineCaps(id);
  const ranked = SKILL_LINES.map((line) => ({ id: line.id, cap: caps[line.id] })).sort((a, b) => b.cap - a.cap);
  const strengths = ranked.filter((row) => row.cap >= CAPS.neutral + NOTABLE).map((row) => row.id);
  const weaknesses = [...ranked].reverse().filter((row) => row.cap <= CAPS.neutral - NOTABLE).map((row) => row.id);
  return {
    id,
    name: ARCHETYPES[id].name,
    tagline: PITCH[id].tagline,
    blurb: ARCHETYPES[id].blurb,
    plan: PITCH[id].plan,
    caps,
    strengths,
    weaknesses,
    signature: ranked[0].id,
  };
}

export const CAREER_ARCHETYPES: CareerArchetype[] = CAREER_ARCHETYPE_IDS.map(buildCareerArchetype);

export const CAREER_ARCHETYPE_BY_ID: Partial<Record<ArchetypeId, CareerArchetype>> = Object.fromEntries(
  CAREER_ARCHETYPES.map((archetype) => [archetype.id, archetype]),
);

/** Whether an id is one a player is allowed to choose. Used by every validator. */
export function isCareerArchetype(id: unknown): id is ArchetypeId {
  return typeof id === 'string' && CAREER_ARCHETYPE_IDS.includes(id as ArchetypeId);
}

export function careerArchetype(id: ArchetypeId): CareerArchetype {
  const found = CAREER_ARCHETYPE_BY_ID[id];
  if (!found) throw new Error(`${id} is not an archetype a player can choose`);
  return found;
}

// ---------------------------------------------------------------------------
// Lines to ratings
// ---------------------------------------------------------------------------

export type SkillLines = Record<SkillLineId, number>;

/**
 * The engine's 33 ratings, from 16 lines and an archetype.
 *
 * This is the only bridge between the career system and the simulation, and it
 * is one-way: ratings are always recomputed from the lines, never edited
 * directly. That is what makes the caps inescapable — there is no code path that
 * writes a rating, so there is no code path that can write one over its ceiling.
 */
export function ratingsFromLines(archetype: ArchetypeId, lines: SkillLines): Record<RatingKey, number> {
  const out = {} as Record<RatingKey, number>;
  for (const line of SKILL_LINES) {
    const offsets = withinLineOffsets(archetype, line.id);
    const cap = careerCapForLine(archetype, line.id);
    const value = Math.min(lines[line.id], cap);
    for (const key of line.keys) {
      const raw = value + (offsets[key] ?? 0);
      out[key] = Math.round(Math.max(CAPS.min - 8, Math.min(careerCapForRating(archetype, key), raw)));
    }
  }
  // `launch` is the one rating no line owns — a trait, not a skill. The archetype
  // sets it and nothing else moves it.
  out.launch = Math.round(
    Math.max(30, Math.min(97, CAPS.launchBase + (ARCHETYPES[archetype].bias.launch ?? 0))),
  );
  return out;
}
