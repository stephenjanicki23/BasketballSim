/**
 * The bridge between a career and the tour it is played on.
 *
 * Everything in /career up to this point knows nothing about universes,
 * tournaments or leaderboards, and everything in /simulation knows nothing about
 * careers or XP. This module is the only place the two meet, and it is
 * deliberately one-directional in both halves:
 *
 *   - Ratings flow *out* of the career. `syncGolfer` recomputes the tour golfer's
 *     thirty-three ratings from the sixteen lines and never the reverse, which is
 *     why nothing the simulation does to a golfer can raise them past a ceiling.
 *   - Results flow *in* from the tour as claims. `eventOutcomeFor` reduces a
 *     finished tournament to the handful of facts XP is paid for, and the rulebook
 *     prices them. It never computes an amount.
 */

import { COURSE_BY_ID } from '../data/courses';
import { currentAbility } from '../simulation/golferEngine';
import type { Golfer, RatingKey } from '../simulation/types';
import type { Tournament } from '../simulation/tournamentEngine';
import { buildCreatedGolfer } from './creation';
import { effectiveLines } from './progression';
import { ratingsFromLines } from './archetypes';
import type { Career } from './types';
import type { EventOutcome, EventTier, RoundOutcome, SeasonOutcome } from './xp';
import type { RecordedEvent, SeasonReport } from './actions';

export type { RecordedEvent, SeasonReport };

/**
 * Build the tour golfer for a career, ratings and all.
 *
 * Called when a career joins the tour and again after every offseason, so the
 * golfer on the leaderboard is always exactly what the career says they are.
 */
export function golferForCareer(career: Career, season: number): Golfer {
  return buildCreatedGolfer(
    career.golferId,
    {
      firstName: career.firstName,
      lastName: career.lastName,
      displayName: career.displayName,
      country: career.country,
      flag: career.flag,
      archetype: career.archetype,
      puttingStyle: career.puttingStyle,
      lines: effectiveLines(career),
      spent: 0,
      pointsLeft: 0,
    },
    season,
  );
}

/**
 * Re-derive an existing golfer's ratings from their career, in place.
 *
 * In place because the rest of the game holds references to `Golfer` objects and
 * mutates them — that is how the simulation has always worked — so replacing the
 * object would silently orphan whatever was pointing at it. Only the ratings, the
 * age and the derived ability are touched; the career record, the season counters
 * and the ranking points are the tour's, not the career's.
 */
export function syncGolfer(golfer: Golfer, career: Career): void {
  const ratings = ratingsFromLines(career.archetype, effectiveLines(career));
  for (const key of Object.keys(ratings) as RatingKey[]) golfer.ratings[key] = ratings[key];
  golfer.age = career.age;
  golfer.name = career.displayName;
  golfer.flag = career.flag;
  golfer.country = career.country;
  golfer.hidden.currentAbility = currentAbility(golfer);
}

// ---------------------------------------------------------------------------
// Reading a finished tournament
// ---------------------------------------------------------------------------

/**
 * How many shots better than the hole's par each score was, reduced to the counts
 * XP is paid for.
 *
 * Done per hole against the card rather than from the round's own stat line
 * because `RoundStats` counts eagles but has nowhere to put an albatross, and
 * "somebody holed a 3 wood on a par 5" is exactly the sort of thing a career
 * should remember.
 */
function roundOutcome(courseId: string, holeScores: number[], toPar: number): RoundOutcome {
  const course = COURSE_BY_ID[courseId];
  let birdies = 0;
  let eagles = 0;
  let albatrosses = 0;
  holeScores.forEach((score, index) => {
    const par = course?.holes[index]?.par;
    if (!par || !score) return;
    const under = par - score;
    if (under === 1) birdies++;
    else if (under === 2) eagles++;
    else if (under >= 3) albatrosses++;
  });
  return { toPar, birdies, eagles, albatrosses };
}

/**
 * What happened to one golfer at one tournament.
 *
 * `worldRankBefore` and `previousBestFinish` have to be captured *before* the
 * tournament's results are applied, because applying them is what changes both —
 * so the caller takes them at the top of `finishTournament` and hands them in.
 */
export function eventOutcomeFor(
  tournament: Tournament,
  golferId: string,
  before: { worldRank: number; bestFinish: number },
): EventOutcome | null {
  const row = tournament.leaderboard.find((entry) => entry.golferId === golferId);
  if (!row) return null;
  const rounds = (tournament.results[golferId] ?? [])
    .filter(Boolean)
    .map((round) => roundOutcome(tournament.courseId, round.holeScores, round.toPar));

  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    tier: tournament.tier as EventTier,
    position: row.status === 'active' ? row.position : 0,
    madeCut: row.status === 'active',
    worldRankBefore: Math.max(1, Math.round(before.worldRank || 1)),
    previousBestFinish: Math.max(0, Math.round(before.bestFinish || 0)),
    rounds,
  };
}

/** Queue an event for submission. Returns null when there is nothing to record. */
export function recordedEventFor(
  season: number,
  tournament: Tournament,
  golferId: string,
  before: { worldRank: number; bestFinish: number },
): RecordedEvent | null {
  const outcome = eventOutcomeFor(tournament, golferId, before);
  return outcome ? { season, outcome } : null;
}

// ---------------------------------------------------------------------------
// Reading a finished season
// ---------------------------------------------------------------------------

/**
 * The season as the career sees it, built from the golfer's own season counters
 * and the standings the tour has already computed.
 */
export function seasonReportFor(input: {
  season: number;
  golfer: Golfer;
  standingsRank: number;
  /** Top-25 finishes, which the tour does not count but a career does. */
  top25s: number;
  bestPreviousScoringAverage: number;
}): SeasonReport {
  const { golfer, season } = input;
  const scoringAverage = golfer.season.rounds ? golfer.season.strokes / golfer.season.rounds : 0;
  const outcome: SeasonOutcome = {
    cutsMade: golfer.season.cutsMade,
    wins: golfer.season.wins,
    top10s: golfer.season.top10s,
    standingsRank: input.standingsRank,
    scoringAverage,
    bestPreviousScoringAverage: input.bestPreviousScoringAverage,
  };
  return {
    season,
    abilityBefore: currentAbility(golfer),
    outcome,
    record: {
      season,
      events: golfer.season.events,
      cutsMade: golfer.season.cutsMade,
      wins: golfer.season.wins,
      top10s: golfer.season.top10s,
      top25s: input.top25s,
      earnings: Math.round(golfer.season.earnings),
      standingsRank: input.standingsRank,
      worldRank: golfer.worldRank,
      scoringAverage,
      birdies: golfer.season.birdies,
      eagles: golfer.season.eagles,
      // From the engine's own counter, not from `recentFinishes` — that list
      // stores a missed cut as 45, which would read back as a 45th-place finish.
      bestFinish: golfer.season.bestFinish,
    },
  };
}
