/**
 * Every change a career can undergo, as pure functions.
 *
 * This is the module both storage backends run. The local browser store and the
 * HTTP server do not each implement the rules and hope they agree — they call
 * these, and the rules exist once. Each returns either a new career or a list of
 * problems, and none of them mutates its input, so a rejected request cannot
 * leave a half-applied career behind.
 *
 * The guards here are the ones requirement 21 asks for, and the one that matters
 * most is the shape of the interface rather than any single check: nothing in this
 * file accepts an amount of XP. A caller says what happened and `xpForEvent`
 * prices it. There is no number to tamper with.
 */

import { PROGRESSION, XP } from './config';
import { lineCaps, ratingsFromLines, type SkillLines } from './archetypes';
import { ageAdjustment, effectiveLines, validateSpend } from './progression';
import { mergeLedger, xpForEvent, xpForSeason, type EventOutcome, type SeasonOutcome } from './xp';
import { emptyLedger, type Career, type CareerSeasonRecord, type XpLedger } from './types';
import type { RatingKey } from '../simulation/types';

export interface Problem {
  field: string;
  message: string;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

const fail = (field: string, message: string): Outcome<never> => ({ ok: false, problems: [{ field, message }] });

/** Ratings as the simulation should see them: bought, aged, capped. */
export function ratingsForCareer(career: Career): Record<RatingKey, number> {
  return ratingsFromLines(career.archetype, effectiveLines(career));
}

function touched(career: Career): Career {
  return { ...career, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// A tournament finishes
// ---------------------------------------------------------------------------

export interface RecordedEvent {
  season: number;
  outcome: EventOutcome;
}

/**
 * Award a week's XP.
 *
 * Idempotent by construction: an event is identified by its season and its
 * tournament id, and one that has already been counted is refused rather than
 * paid twice. That single check is what stops the obvious replay — finishing an
 * event, submitting it, and submitting it again.
 */
export function applyEvent(career: Career, request: unknown): Outcome<{ career: Career; awarded: XpLedger }> {
  const body = request as Partial<RecordedEvent> | undefined;
  const season = body?.season;
  const outcome = body?.outcome;
  if (typeof season !== 'number' || !Number.isInteger(season)) return fail('season', 'A season is required.');
  if (!outcome || typeof outcome !== 'object') return fail('outcome', 'An event outcome is required.');

  const problems = checkEventOutcome(outcome);
  if (problems.length) return { ok: false, problems };

  const key = `${season}:${outcome.tournamentId}`;
  if (career.countedEvents.includes(key)) {
    return fail('outcome', 'That event has already been counted towards this career.');
  }
  if (career.countedEvents.filter((entry) => entry.startsWith(`${season}:`)).length >= XP.maxEventsPerSeason) {
    return fail('outcome', `A season cannot contain more than ${XP.maxEventsPerSeason} events.`);
  }

  const awarded = xpForEvent(outcome);
  if (awarded.total > XP.maxPerEvent) {
    // Trim proportionally rather than refusing: a legitimate monster week at a
    // major should still be the best week of somebody's life, just not unbounded.
    const scale = XP.maxPerEvent / awarded.total;
    for (const entry of awarded.entries) entry.xp = Math.round(entry.xp * scale);
    awarded.total = awarded.entries.reduce((acc, entry) => acc + entry.xp, 0);
  }

  const next: Career = touched({
    ...career,
    experience: career.experience + awarded.total,
    availableXp: career.availableXp + awarded.total,
    pending: mergeLedger({ total: career.pending.total, entries: career.pending.entries.map((e) => ({ ...e })) }, awarded),
    countedEvents: [...career.countedEvents, key],
  });
  return { ok: true, value: { career: next, awarded } };
}

/** Everything about a submitted event that has to be true of a real one. */
function checkEventOutcome(outcome: EventOutcome): Problem[] {
  const problems: Problem[] = [];
  const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;

  if (typeof outcome.tournamentId !== 'string' || !outcome.tournamentId || outcome.tournamentId.length > 64) {
    problems.push({ field: 'outcome.tournamentId', message: 'A tournament id is required.' });
  }
  if (!['regular', 'invitational', 'major'].includes(outcome.tier as string)) {
    problems.push({ field: 'outcome.tier', message: 'Unknown tournament tier.' });
  }
  if (!integer(outcome.position) || outcome.position > 400) {
    problems.push({ field: 'outcome.position', message: 'A finishing position is 0 (missed cut) or a place.' });
  }
  if (typeof outcome.madeCut !== 'boolean') {
    problems.push({ field: 'outcome.madeCut', message: 'madeCut must be true or false.' });
  }
  if (outcome.madeCut === false && outcome.position > 0) {
    problems.push({ field: 'outcome.position', message: 'A missed cut has no finishing position.' });
  }
  if (!integer(outcome.worldRankBefore) || outcome.worldRankBefore > 5000) {
    problems.push({ field: 'outcome.worldRankBefore', message: 'A world ranking is a small positive number.' });
  }
  if (!integer(outcome.previousBestFinish) || outcome.previousBestFinish > 400) {
    problems.push({ field: 'outcome.previousBestFinish', message: 'A previous best finish is a place or zero.' });
  }
  if (!Array.isArray(outcome.rounds) || outcome.rounds.length > 4) {
    problems.push({ field: 'outcome.rounds', message: 'A tournament is at most four rounds.' });
  } else {
    for (const [index, round] of outcome.rounds.entries()) {
      // A round of 18 holes cannot contain more than 18 of anything, and no
      // golfer has ever shot 40 under par for one.
      if (typeof round?.toPar !== 'number' || !Number.isInteger(round.toPar) || round.toPar < -20 || round.toPar > 40) {
        problems.push({ field: `outcome.rounds.${index}.toPar`, message: 'That is not a score anybody shot.' });
      }
      for (const field of ['birdies', 'eagles', 'albatrosses'] as const) {
        const value = round?.[field];
        if (!integer(value) || (value as number) > 18) {
          problems.push({ field: `outcome.rounds.${index}.${field}`, message: `A round has at most 18 ${field}.` });
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// A season ends
// ---------------------------------------------------------------------------

/** What the client reports about a finished season, for the record and the bonus. */
export interface SeasonReport {
  season: number;
  outcome: SeasonOutcome;
  record: Omit<CareerSeasonRecord, 'careerSeason' | 'xpEarned' | 'abilityBefore' | 'abilityAfter' | 'age'>;
  /** The golfer's overall ability before the offseason, for the summary. */
  abilityBefore: number;
}

/**
 * Close the season: pay the season bonus, write the record, age the golfer and
 * open the offseason.
 *
 * Seasons must arrive in order and each one only once — `career.lastSeason` is
 * the guard, and it is the reason a player cannot roll the same winter over and
 * over to bank the bonus.
 */
export function applySeasonEnd(career: Career, request: unknown): Outcome<{ career: Career; awarded: XpLedger }> {
  const body = request as Partial<SeasonReport> | undefined;
  const season = body?.season;
  if (typeof season !== 'number' || !Number.isInteger(season)) return fail('season', 'A season is required.');
  if (career.lastSeason !== 0 && season <= career.lastSeason) {
    return fail('season', `The ${season} season has already been recorded for this career.`);
  }
  if (career.offseasonOpen) return fail('season', 'Finish the current offseason first.');
  const outcome = body?.outcome;
  if (!outcome || typeof outcome !== 'object') return fail('outcome', 'A season summary is required.');
  const record = body?.record;
  if (!record || typeof record !== 'object') return fail('record', 'A season record is required.');

  const numbers: [string, unknown][] = [
    ['events', record.events], ['cutsMade', record.cutsMade], ['wins', record.wins],
    ['top10s', record.top10s], ['top25s', record.top25s], ['standingsRank', record.standingsRank],
    ['worldRank', record.worldRank], ['birdies', record.birdies], ['eagles', record.eagles],
  ];
  for (const [field, value] of numbers) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) {
      return fail(`record.${field}`, `${field} is not a number from a season anybody played.`);
    }
  }
  if ((record.events ?? 0) > XP.maxEventsPerSeason) {
    return fail('record.events', `A season has at most ${XP.maxEventsPerSeason} events.`);
  }
  if (record.wins > record.cutsMade || record.cutsMade > record.events) {
    return fail('record', 'Those season totals do not add up.');
  }

  const awarded = xpForSeason({
    cutsMade: Math.min(record.cutsMade, XP.maxEventsPerSeason),
    wins: Math.min(record.wins, XP.maxEventsPerSeason),
    top10s: Math.min(record.top10s, XP.maxEventsPerSeason),
    standingsRank: outcome.standingsRank ?? record.standingsRank,
    scoringAverage: typeof outcome.scoringAverage === 'number' ? outcome.scoringAverage : 0,
    bestPreviousScoringAverage: bestScoringAverage(career),
  });
  if (awarded.total > XP.maxPerSeasonBonus) {
    const scale = XP.maxPerSeasonBonus / awarded.total;
    for (const entry of awarded.entries) entry.xp = Math.round(entry.xp * scale);
    awarded.total = awarded.entries.reduce((acc, entry) => acc + entry.xp, 0);
  }

  const pending = mergeLedger(
    { total: career.pending.total, entries: career.pending.entries.map((e) => ({ ...e })) },
    awarded,
  );
  const abilityBefore = typeof body?.abilityBefore === 'number' ? Math.round(body.abilityBefore) : 0;
  const nextAge = career.age + 1;

  const seasonRecord: CareerSeasonRecord = {
    season,
    careerSeason: career.careerSeason,
    age: career.age,
    events: record.events,
    cutsMade: record.cutsMade,
    wins: record.wins,
    top10s: record.top10s,
    top25s: record.top25s,
    earnings: Math.max(0, Math.round(record.earnings ?? 0)),
    standingsRank: record.standingsRank,
    worldRank: record.worldRank,
    scoringAverage: Math.max(0, record.scoringAverage ?? 0),
    birdies: record.birdies,
    eagles: record.eagles,
    bestFinish: Math.max(0, Math.round(record.bestFinish ?? 0)),
    xpEarned: pending.total,
    abilityBefore,
    abilityAfter: 0,
  };

  const next: Career = touched({
    ...career,
    experience: career.experience + awarded.total,
    availableXp: career.availableXp + awarded.total,
    pending,
    age: nextAge,
    careerSeason: career.careerSeason + 1,
    lastSeason: season,
    seasons: [seasonRecord, ...career.seasons].slice(0, 40),
    offseasonOpen: true,
    // Each offseason's per-line limit starts again.
    gainedThisOffseason: {},
  });
  return { ok: true, value: { career: next, awarded } };
}

function bestScoringAverage(career: Career): number {
  const averages = career.seasons.map((season) => season.scoringAverage).filter((value) => value > 0);
  return averages.length ? Math.min(...averages) : 0;
}

// ---------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------

/**
 * Buy rating points. The arithmetic and every rule live in `validateSpend`; this
 * adds the one thing that is a property of the career rather than of the request,
 * which is that a line can only move so far in a single winter.
 */
export function applySpend(career: Career, request: unknown): Outcome<{ career: Career; xpSpent: number }> {
  if (!career.offseasonOpen) return fail('buy', 'XP is spent in the offseason.');

  const gained = career.gainedThisOffseason ?? {};
  const buy = ((request as { buy?: Record<string, unknown> })?.buy ?? {}) as Record<string, number>;
  for (const [line, count] of Object.entries(buy)) {
    const already = gained[line as keyof typeof gained] ?? 0;
    if (typeof count === 'number' && already + count > PROGRESSION.maxGainPerLinePerOffseason) {
      return fail(
        `buy.${line}`,
        `That line can only improve by ${PROGRESSION.maxGainPerLinePerOffseason} in one offseason, and has already gained ${already}.`,
      );
    }
  }

  const result = validateSpend(career, request);
  if (!result.ok) return { ok: false, problems: result.problems };

  const nextGained = { ...gained };
  for (const step of result.value.steps) {
    nextGained[step.line] = (nextGained[step.line] ?? 0) + 1;
  }

  const next: Career = touched({
    ...career,
    lines: result.value.lines,
    availableXp: career.availableXp - result.value.xpSpent,
    spentXp: career.spentXp + result.value.xpSpent,
    history: [...career.history, ...result.value.steps].slice(-500),
    gainedThisOffseason: nextGained,
  });
  return { ok: true, value: { career: next, xpSpent: result.value.xpSpent } };
}

/** Finish the offseason. The pending ledger is cleared; the XP is not. */
export function closeOffseason(career: Career, abilityAfter: number): Outcome<Career> {
  if (!career.offseasonOpen) return fail('offseason', 'There is no offseason open.');
  const seasons = career.seasons.map((season, index) =>
    index === 0 ? { ...season, abilityAfter: Math.round(abilityAfter) } : season,
  );
  return {
    ok: true,
    value: touched({ ...career, offseasonOpen: false, pending: emptyLedger(), seasons, gainedThisOffseason: {} }),
  };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Everything that must be true of a stored career, checked on the way out of
 * storage as well as on the way in.
 *
 * A save file is not a trusted input: it may have been written by an older
 * version of this program, or edited by hand. Rather than let a career whose
 * ratings exceed its ceilings into the simulation, catch it here.
 */
export function careerProblems(career: Career): string[] {
  const problems: string[] = [];
  const caps = lineCaps(career.archetype);
  for (const [line, value] of Object.entries(career.lines) as [keyof SkillLines, number][]) {
    if (!Number.isInteger(value)) problems.push(`${line} is not a whole number`);
    if (value > caps[line]) problems.push(`${line} is ${value}, above the ceiling of ${caps[line]}`);
  }
  if (career.availableXp < 0) problems.push('available XP is negative');
  if (career.spentXp < 0) problems.push('spent XP is negative');
  if (career.experience < 0) problems.push('total XP is negative');
  if (career.availableXp + career.spentXp !== career.experience) {
    problems.push(`XP does not balance: ${career.availableXp} available + ${career.spentXp} spent ≠ ${career.experience} earned`);
  }
  return problems;
}

/** The age offset, exported here so the offseason screen and the store agree. */
export { ageAdjustment };
