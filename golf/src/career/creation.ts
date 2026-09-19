/**
 * Creating a golfer, and deciding whether a creation is legal.
 *
 * `validateCreation` is the whole of the rulebook for step one, and it is the
 * only thing any caller — the creation screen, the HTTP handler, the local
 * store — is allowed to decide with. It takes a request that may be complete
 * nonsense and returns either a golfer or a list of reasons, so a client that
 * lies gets the same answer the honest one would.
 */

import { blankRatings, currentAbility, emptyCareer, emptySeason } from '../simulation/golferEngine';
import type { ArchetypeId, Golfer, PuttingStyleId, RatingKey } from '../simulation/types';
import { PUTTING_STYLES } from '../simulation/golferEngine';
import { CREATION, SKILL_LINES, SKILL_LINE_IDS, type SkillLineId } from './config';
import { isCareerArchetype, lineCaps, ratingsFromLines, type SkillLines } from './archetypes';
import { emptyLedger, type Career } from './types';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface CreationRequest {
  firstName: string;
  lastName: string;
  displayName?: string;
  /** Country name as shown; the flag comes with it. */
  country: string;
  archetype: ArchetypeId;
  puttingStyle: PuttingStyleId;
  /** Every line's chosen starting value. Missing lines are taken as the base. */
  lines: Partial<SkillLines>;
}

export interface CreationProblem {
  field: string;
  message: string;
}

/** Nationalities on offer. The flag is part of the identity, not decoration. */
export const NATIONALITIES: { country: string; flag: string }[] = [
  { country: 'United States', flag: '🇺🇸' },
  { country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { country: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { country: 'Ireland', flag: '🇮🇪' },
  { country: 'Australia', flag: '🇦🇺' },
  { country: 'New Zealand', flag: '🇳🇿' },
  { country: 'South Africa', flag: '🇿🇦' },
  { country: 'Japan', flag: '🇯🇵' },
  { country: 'South Korea', flag: '🇰🇷' },
  { country: 'Spain', flag: '🇪🇸' },
  { country: 'Sweden', flag: '🇸🇪' },
  { country: 'Denmark', flag: '🇩🇰' },
  { country: 'Germany', flag: '🇩🇪' },
  { country: 'France', flag: '🇫🇷' },
  { country: 'Italy', flag: '🇮🇹' },
  { country: 'Argentina', flag: '🇦🇷' },
  { country: 'Canada', flag: '🇨🇦' },
  { country: 'Mexico', flag: '🇲🇽' },
  { country: 'India', flag: '🇮🇳' },
  { country: 'Thailand', flag: '🇹🇭' },
  { country: 'Chinese Taipei', flag: '🇹🇼' },
  { country: 'Norway', flag: '🇳🇴' },
];

/**
 * Putting styles a player may choose.
 *
 * All seven of the game's own, because unlike an archetype a putting style is not
 * a ceiling — it biases the ratings it describes and shifts how boldly a putt is
 * taken on, and there is no such thing as one that makes a golfer unviable. "The
 * Poor Green Reader" is a real way to putt for a living and somebody will pick it
 * on purpose.
 */
export const PUTTING_STYLE_CHOICES: PuttingStyleId[] = [
  'steady', 'technician', 'aggressor', 'conservative', 'clutch', 'streaky', 'poorReader',
];

export const FLAG_BY_COUNTRY: Record<string, string> = Object.fromEntries(
  NATIONALITIES.map((entry) => [entry.country, entry.flag]),
);

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/** What it costs at creation to take one line from `rating` to `rating + 1`. */
export function startingStepCost(rating: number): number {
  for (const band of CREATION.costBands) if (rating < band.upTo) return band.cost;
  return CREATION.costBands[CREATION.costBands.length - 1].cost;
}

/** What it costs at creation to move one line from the base up to `rating`. */
export function startingLineCost(rating: number): number {
  let total = 0;
  for (let at = CREATION.baseRating; at < rating; at++) total += startingStepCost(at);
  // Below the base the points come back, at the same price, so a player can fund
  // a strength by accepting a genuine weakness — down to the floor and no further.
  for (let at = rating; at < CREATION.baseRating; at++) total -= startingStepCost(at);
  return total;
}

export function startingSpend(lines: SkillLines): number {
  return SKILL_LINE_IDS.reduce((acc, id) => acc + startingLineCost(lines[id]), 0);
}

export function startingPointsLeft(lines: SkillLines): number {
  return CREATION.startingSkillPoints - startingSpend(lines);
}

/** Every line at the base value. The starting point of the creation screen. */
export function baseLines(): SkillLines {
  return Object.fromEntries(SKILL_LINE_IDS.map((id) => [id, CREATION.baseRating])) as SkillLines;
}

/**
 * The most a line may be set to at creation: the archetype's own ceiling, or the
 * global starting maximum, whichever is lower. An archetype whose ceiling for a
 * line is 70 cannot start that line at 82 just because the global rule allows it.
 */
export function startingCapForLine(archetype: ArchetypeId, line: SkillLineId): number {
  return Math.min(CREATION.maxStartingRating, lineCaps(archetype)[line]);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Collapse whitespace and drop control characters — a display name is shown on
  // a leaderboard next to 155 other people and has no business carrying newlines.
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

function checkName(problems: CreationProblem[], field: string, value: string, label: string): void {
  if (value.length < CREATION.nameMinLength) {
    problems.push({ field, message: `${label} needs at least ${CREATION.nameMinLength} characters.` });
  } else if (value.length > CREATION.nameMaxLength) {
    problems.push({ field, message: `${label} cannot be longer than ${CREATION.nameMaxLength} characters.` });
  }
}

export interface ValidatedCreation {
  firstName: string;
  lastName: string;
  displayName: string;
  country: string;
  flag: string;
  archetype: ArchetypeId;
  puttingStyle: PuttingStyleId;
  lines: SkillLines;
  spent: number;
  pointsLeft: number;
}

/**
 * Check a creation request against every rule there is.
 *
 * Deliberately paranoid about types as well as values: this function is what the
 * server runs on a JSON body from the open internet, so "lines" arriving as a
 * string, or an archetype of `__proto__`, has to come out the other side as a
 * polite error rather than an exception or a golfer.
 */
export function validateCreation(request: unknown): { ok: true; value: ValidatedCreation } | { ok: false; problems: CreationProblem[] } {
  const problems: CreationProblem[] = [];
  const body = (request ?? {}) as Partial<CreationRequest>;

  const firstName = cleanName(body.firstName);
  const lastName = cleanName(body.lastName);
  checkName(problems, 'firstName', firstName, 'A first name');
  checkName(problems, 'lastName', lastName, 'A last name');

  const displayName = cleanName(body.displayName) || `${firstName} ${lastName}`.trim();
  if (displayName.length > CREATION.nameMaxLength * 2) {
    problems.push({ field: 'displayName', message: 'That display name is too long.' });
  }

  const country = typeof body.country === 'string' ? body.country : '';
  const flag = FLAG_BY_COUNTRY[country];
  if (!flag) problems.push({ field: 'country', message: 'Choose a nationality from the list.' });

  if (!isCareerArchetype(body.archetype)) {
    problems.push({ field: 'archetype', message: 'Choose one of the career archetypes.' });
  }
  const puttingStyle = body.puttingStyle as PuttingStyleId;
  if (!puttingStyle || !Object.prototype.hasOwnProperty.call(PUTTING_STYLES, puttingStyle)) {
    problems.push({ field: 'puttingStyle', message: 'Choose a putting style.' });
  }

  // Without a legal archetype there are no caps to check the lines against, so
  // stop here rather than reporting sixteen confusing follow-on errors.
  if (!isCareerArchetype(body.archetype)) return { ok: false, problems };
  const archetype = body.archetype;

  const lines = baseLines();
  const requested = (body.lines ?? {}) as Record<string, unknown>;
  for (const id of SKILL_LINE_IDS) {
    const raw = requested[id];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      problems.push({ field: `lines.${id}`, message: `${label(id)} must be a whole number.` });
      continue;
    }
    const cap = startingCapForLine(archetype, id);
    if (raw < CREATION.minRating) {
      problems.push({ field: `lines.${id}`, message: `${label(id)} cannot start below ${CREATION.minRating}.` });
    } else if (raw > cap) {
      problems.push({
        field: `lines.${id}`,
        message: cap < CREATION.maxStartingRating
          ? `${label(id)} cannot start above ${cap} — that is this archetype's career ceiling.`
          : `${label(id)} cannot start above ${cap}.`,
      });
    } else {
      lines[id] = raw;
    }
  }
  // Any line named in the request that is not a line at all.
  for (const key of Object.keys(requested)) {
    if (!SKILL_LINE_IDS.includes(key as SkillLineId)) {
      problems.push({ field: `lines.${key}`, message: `${key} is not a skill.` });
    }
  }

  const spent = startingSpend(lines);
  if (spent > CREATION.startingSkillPoints) {
    problems.push({
      field: 'lines',
      message: `That build costs ${spent} points and you have ${CREATION.startingSkillPoints}.`,
    });
  }

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      firstName, lastName, displayName, country, flag,
      archetype, puttingStyle: puttingStyle!, lines,
      spent, pointsLeft: CREATION.startingSkillPoints - spent,
    },
  };
}

function label(id: SkillLineId): string {
  return SKILL_LINES.find((line) => line.id === id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// Building the golfer
// ---------------------------------------------------------------------------

/**
 * Turn a validated creation into a `Golfer` the simulation will accept.
 *
 * The result is an ordinary tour player in every respect — same shape, same
 * ratings, same career counters — which is the whole point. Nothing in the shot
 * engine, the tournament engine or the leaderboard knows or needs to know that
 * this one was made by a person.
 */
export function buildCreatedGolfer(id: string, created: ValidatedCreation, season: number): Golfer {
  const ratings = blankRatings();
  const derived = ratingsFromLines(created.archetype, created.lines);
  for (const key of Object.keys(ratings) as RatingKey[]) ratings[key] = derived[key];

  const golfer: Golfer = {
    id,
    name: created.displayName,
    country: created.country,
    flag: created.flag,
    age: CREATION.startingAge,
    turnedPro: season,
    archetype: created.archetype,
    puttingStyle: created.puttingStyle,
    personality: 'Yours.',
    playingStyle: 'Whatever you make of it.',
    preferredConditions: 'To be discovered.',
    weakness: 'To be discovered.',
    ratings,
    hidden: {
      currentAbility: 50,
      /**
       * Potential is what the *AI* development engine aims a golfer at, and a
       * created golfer is never developed by it — every rating point they ever
       * gain is bought with XP. Setting it to the archetype's own mean ceiling
       * keeps the number honest wherever the UI shows it, and keeps it from
       * implying growth that will not arrive on its own.
       */
      potential: Math.round(
        SKILL_LINE_IDS.reduce((acc, line) => acc + lineCaps(created.archetype)[line], 0) / SKILL_LINE_IDS.length,
      ),
      form: 0,
      confidence: 50,
      injuryRisk: 14,
      adaptability: 55,
    },
    career: emptyCareer(),
    season: emptySeason(),
    history: [],
    rankingPoints: 0,
    worldRank: 0,
    recentFinishes: [],
    fatigue: 0,
    injuredWeeks: 0,
  };
  golfer.hidden.currentAbility = currentAbility(golfer);
  // A rookie has no ranking points and therefore starts last in the world, which
  // is correct: nobody has done anything yet.
  golfer.rankingPoints = 0;
  return golfer;
}

/**
 * A fresh career record, from a validated creation.
 *
 * Both storage backends build careers through this, so a career created in the
 * browser and one created by the server are the same object down to the field
 * order — which matters the day somebody's local save is uploaded to a server.
 */
export function newCareer(input: {
  id: string;
  accountId: string;
  golferId: string;
  created: ValidatedCreation;
  now?: string;
}): Career {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    accountId: input.accountId,
    golferId: input.golferId,
    firstName: input.created.firstName,
    lastName: input.created.lastName,
    displayName: input.created.displayName,
    country: input.created.country,
    flag: input.created.flag,
    archetype: input.created.archetype,
    puttingStyle: input.created.puttingStyle,
    startingLines: { ...input.created.lines },
    lines: { ...input.created.lines },
    experience: 0,
    availableXp: 0,
    spentXp: 0,
    careerSeason: 1,
    age: CREATION.startingAge,
    pending: emptyLedger(),
    history: [],
    seasons: [],
    offseasonOpen: false,
    gainedThisOffseason: {},
    countedEvents: [],
    lastSeason: 0,
    createdAt: now,
    updatedAt: now,
  };
}
