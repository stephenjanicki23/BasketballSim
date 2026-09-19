/**
 * Spending XP, and what it costs.
 *
 * Two curves do the work and they answer two different questions. The *cost
 * curve* is absolute — a point at 90 costs five and a half times a point at 70,
 * for everybody, which is what makes the top of the rating scale expensive. The
 * *soft cap* is relative to the archetype's own ceiling — the last two points
 * before any ceiling cost nearly four times list price, which is what makes the
 * top of an identity an achievement rather than an inevitability.
 *
 * The two compose. An Elite Putter buying their stroke from 90 to 91 pays the
 * absolute price of a point at 90 with no soft cap on top, because their ceiling
 * is 95 and they have headroom. A Ball Striker cannot buy that point at all.
 */

import { clamp } from '../simulation/rng';
import type { ArchetypeId } from '../simulation/types';
import { CREATION, PROGRESSION, SKILL_LINE_BY_ID, SKILL_LINE_IDS, type SkillLineId } from './config';
import { lineCaps, type SkillLines } from './archetypes';
import type { Career, ProgressionStep } from './types';

/** The age a career starts at, from which experience is counted. */
const CREATION_AGE = CREATION.startingAge;
/** Age can take a line below the creation floor, but not indefinitely. */
const FLOOR = CREATION.minRating - 10;

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** The soft-cap multiplier for a step taken at `from` against a ceiling of `cap`. */
export function softCapMultiplier(from: number, cap: number): number {
  const headroom = cap - from;
  // Bands are declared widest-first, so the first one the headroom clears is the
  // gentlest that applies.
  for (const band of PROGRESSION.softCaps) if (headroom > band.headroomAbove) return band.multiplier;
  return PROGRESSION.softCaps[PROGRESSION.softCaps.length - 1].multiplier;
}

/** XP to take a line from `from` to `from + 1`, against a ceiling of `cap`. */
export function stepCost(from: number, cap: number): number {
  const absolute = PROGRESSION.costBase * Math.pow(PROGRESSION.costGrowth, from - PROGRESSION.costPivot);
  return Math.round(absolute * softCapMultiplier(from, cap));
}

/** XP for the next point on a line, or null when the line is already at its ceiling. */
export function nextStepCost(archetype: ArchetypeId, lines: SkillLines, line: SkillLineId): number | null {
  const cap = lineCaps(archetype)[line];
  const from = lines[line];
  if (from >= cap) return null;
  return stepCost(from, cap);
}

/** XP to move a line from `from` all the way to `to`. */
export function rangeCost(from: number, to: number, cap: number): number {
  let total = 0;
  for (let at = from; at < Math.min(to, cap); at++) total += stepCost(at, cap);
  return total;
}

/** XP to take a line from where it is now to its ceiling. The price of a specialism. */
export function costToCap(archetype: ArchetypeId, lines: SkillLines, line: SkillLineId): number {
  const cap = lineCaps(archetype)[line];
  return rangeCost(lines[line], cap, cap);
}

// ---------------------------------------------------------------------------
// What the offseason screen offers
// ---------------------------------------------------------------------------

export interface UpgradeOption {
  line: SkillLineId;
  name: string;
  section: string;
  from: number;
  to: number;
  cap: number;
  /** Null when the line is at its ceiling. */
  cost: number | null;
  affordable: boolean;
  /** How many points are still available on this line this offseason. */
  remainingThisOffseason: number;
  /** True while the soft cap is charging more than list price. */
  inSoftCap: boolean;
  softCapMultiplier: number;
}

/**
 * Every line, priced, given what has already been bought this offseason.
 *
 * `gainedThisOffseason` is passed in rather than stored on the career because it
 * is a property of the *session* of spending, not of the golfer: the per-line
 * annual limit exists so a player cannot bank four seasons of XP and jump a line
 * twenty points in one winter.
 */
export function upgradeOptions(
  career: Career,
  gainedThisOffseason: Partial<Record<SkillLineId, number>> = {},
): UpgradeOption[] {
  const caps = lineCaps(career.archetype);
  return SKILL_LINE_IDS.map((line) => {
    const definition = SKILL_LINE_BY_ID[line];
    const from = career.lines[line];
    const cap = caps[line];
    const gained = gainedThisOffseason[line] ?? 0;
    const remainingThisOffseason = Math.max(0, PROGRESSION.maxGainPerLinePerOffseason - gained);
    const atCeiling = from >= cap || remainingThisOffseason === 0;
    const cost = atCeiling ? null : stepCost(from, cap);
    const multiplier = softCapMultiplier(from, cap);
    return {
      line,
      name: definition.name,
      section: definition.section,
      from,
      to: Math.min(from + 1, cap),
      cap,
      cost,
      affordable: cost !== null && cost <= career.availableXp,
      remainingThisOffseason,
      inSoftCap: multiplier > 1,
      softCapMultiplier: multiplier,
    };
  });
}

// ---------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------

export interface SpendRequest {
  /** How many points to buy on each line. Anything absent is zero. */
  buy: Partial<Record<SkillLineId, number>>;
}

export interface SpendProblem {
  field: string;
  message: string;
}

export interface SpendResult {
  lines: SkillLines;
  steps: ProgressionStep[];
  xpSpent: number;
}

/**
 * Validate and price a whole offseason's spending, atomically.
 *
 * Atomicity matters more than it looks: a request to buy three points of Putting
 * and two of Power has to be priced *in order*, because the second point of
 * Putting costs more than the first, and it has to be all-or-nothing, because a
 * partially applied spend would leave a career whose XP and ratings disagree.
 * So nothing is written until every point in the request has been paid for.
 *
 * This is the function the server runs. It trusts the request for nothing: not
 * the line names, not the counts, not that the numbers are integers, and above
 * all not that the client did the arithmetic.
 */
export function validateSpend(career: Career, request: unknown): { ok: true; value: SpendResult } | { ok: false; problems: SpendProblem[] } {
  const problems: SpendProblem[] = [];
  const buy = ((request as SpendRequest)?.buy ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(buy)) {
    if (!SKILL_LINE_IDS.includes(key as SkillLineId)) {
      problems.push({ field: `buy.${key}`, message: `${key} is not a skill.` });
    }
  }

  const caps = lineCaps(career.archetype);
  const lines = { ...career.lines } as SkillLines;
  const steps: ProgressionStep[] = [];
  let xpSpent = 0;

  for (const line of SKILL_LINE_IDS) {
    const raw = buy[line];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      problems.push({ field: `buy.${line}`, message: `${SKILL_LINE_BY_ID[line].name}: expected a whole number of points.` });
      continue;
    }
    if (raw === 0) continue;
    if (raw > PROGRESSION.maxGainPerLinePerOffseason) {
      problems.push({
        field: `buy.${line}`,
        message: `${SKILL_LINE_BY_ID[line].name} can only improve by ${PROGRESSION.maxGainPerLinePerOffseason} in one offseason.`,
      });
      continue;
    }
    const cap = caps[line];
    for (let n = 0; n < raw; n++) {
      const from = lines[line];
      if (from >= cap) {
        problems.push({
          field: `buy.${line}`,
          message: `${SKILL_LINE_BY_ID[line].name} is at ${cap}, the career ceiling for a ${career.archetype}.`,
        });
        break;
      }
      const cost = stepCost(from, cap);
      xpSpent += cost;
      lines[line] = from + 1;
      steps.push({ season: career.careerSeason, line, from, to: from + 1, xp: cost });
    }
  }

  if (xpSpent > career.availableXp) {
    problems.push({
      field: 'buy',
      message: `That costs ${xpSpent.toLocaleString()} XP and you have ${career.availableXp.toLocaleString()}.`,
    });
  }

  if (problems.length) return { ok: false, problems };
  return { ok: true, value: { lines, steps, xpSpent } };
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

/**
 * What the years do, as an offset on top of what the player has bought.
 *
 * A created golfer gets no free skill growth — that is the deal, and it is what
 * makes XP worth earning. What they do get is older. The power and the fitness go
 * after thirty, a little more each winter; the head keeps improving into the
 * forties. Late career therefore means spending XP to hold on to the distance
 * while the course management climbs for nothing, which is the shape of a real
 * one.
 *
 * Computed from age alone and never stored, which is why it cannot fall out of
 * step with the golfer, and why `career.lines` stays exactly the sum of what the
 * player paid for — the property the ceiling check depends on.
 */
export function ageAdjustment(age: number): Partial<Record<SkillLineId, number>> {
  const config = PROGRESSION.age;
  const out: Partial<Record<SkillLineId, number>> = {};

  const years = Math.max(0, age - config.declineFrom);
  const loss = Math.round(Math.min(config.declineCap, years * config.declinePerYear));
  if (loss > 0) for (const line of config.physicalLines) out[line] = -loss;

  const learning = Math.max(0, Math.min(age, config.experienceUntilAge) - CREATION_AGE);
  const gain = Math.round(Math.min(config.experienceCap, learning * config.experiencePerYear));
  if (gain > 0) for (const line of config.experienceLines) out[line] = (out[line] ?? 0) + gain;

  return out;
}

/**
 * The lines as they actually play: bought, plus age, clamped to the archetype.
 *
 * Everything that derives ratings goes through here. Note the upper clamp: a
 * golfer whose course management is already at its ceiling gets nothing from
 * another season's experience, because an archetype ceiling that a birthday can
 * walk through is not a ceiling.
 */
export function effectiveLines(career: Pick<Career, 'archetype' | 'lines' | 'age'>): SkillLines {
  const caps = lineCaps(career.archetype);
  const adjust = ageAdjustment(career.age);
  const out = {} as SkillLines;
  for (const line of SKILL_LINE_IDS) {
    const raw = career.lines[line] + (adjust[line] ?? 0);
    out[line] = clamp(Math.round(raw), FLOOR, caps[line]);
  }
  return out;
}

/** How age is reported on the offseason screen. */
export function ageNotes(career: Pick<Career, 'archetype' | 'lines' | 'age'>, age: number): string[] {
  const caps = lineCaps(career.archetype);
  const before = effectiveLines(career);
  const after = effectiveLines({ ...career, age });
  const notes: string[] = [];
  for (const line of SKILL_LINE_IDS) {
    if (after[line] === before[line]) continue;
    const name = SKILL_LINE_BY_ID[line].name;
    const why = after[line] < before[line] ? `you are ${age}` : "another season's experience";
    notes.push(`${name} ${before[line]} → ${after[line]} — ${why}.`);
  }
  // Worth saying out loud, because it is the one case where a gain silently is not one.
  for (const line of PROGRESSION.age.experienceLines) {
    if (career.lines[line] >= caps[line]) {
      notes.push(`${SKILL_LINE_BY_ID[line].name} is at its ceiling of ${caps[line]}; experience adds nothing more.`);
    }
  }
  return notes;
}
