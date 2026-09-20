/**
 * The universe: a tour, a calendar, a world ranking and a history.
 *
 * This module owns the only mutable state in the game. Everything else takes
 * state in and hands a result back, which is what makes the whole thing
 * testable from a command line and serialisable into localStorage.
 */

import { type Rng, clamp, createRng } from './rng';
import { TOUR_SIZE, createTour } from '../data/golfers';
import { createRookie } from '../data/rookies';
import { SCHEDULE } from '../data/tournaments';
import { COURSE_BY_ID } from '../data/courses';
import {
  applyCut,
  applyResults,
  buildLeaderboard,
  createTournament,
  fieldFor,
  makeTeeTimes,
  payout,
  ROUNDS,
  simulateRound,
  totalStrokes,
  type Tournament,
} from './tournamentEngine';
import { developGolfer, type DevelopmentNote } from './developmentEngine';
import { previewNews, seasonNews, tournamentNews, type NewsItem } from './newsEngine';
import { currentAbility, emptySeason, scoringAverage } from './golferEngine';
import { recordedEventFor, seasonReportFor, type RecordedEvent, type SeasonReport } from '../career/universe';
import type { SavedSession } from '../game/session';
import type { Golfer, SeasonRecord } from './types';

export const UNIVERSE_VERSION = 5;

export interface SeasonSummary {
  season: number;
  championId: string;
  championName: string;
  moneyLeaderId: string;
  numberOneId: string;
  majorWinners: { tournament: string; golferId: string; name: string }[];
  lowScoringAverage: { golferId: string; name: string; average: number };
}

export interface Universe {
  version: number;
  season: number;
  golfers: Golfer[];
  schedule: Tournament[];
  /** Index of the next event to be played. */
  eventIndex: number;
  news: NewsItem[];
  userGolferId: string | null;
  pastSeasons: SeasonSummary[];
  developmentNotes: DevelopmentNote[];

  /**
   * The created golfer, if an account is playing a career on this universe.
   *
   * Distinct from `userGolferId`, which is whoever's rounds the player is hitting
   * — you can take control of an existing tour professional without having made
   * one. This one is the golfer whose ratings come from a `Career`, and it is the
   * one the offseason development engine must leave alone.
   */
  createdGolferId: string | null;
  /**
   * Finished events waiting to be reported to the career store.
   *
   * A queue rather than a call, because the engines are synchronous and awarding
   * XP is not: the store drains this after each event and, if the server cannot be
   * reached, the entries stay here and go up with the next save. Submitting the
   * same event twice is refused by the store, so a retry is always safe.
   */
  careerEvents: RecordedEvent[];
  /** Set when a season rolls over with a created golfer on tour; drained by the store. */
  careerSeasonReport: SeasonReport | null;

  /**
   * The round being played by hand, shot by shot, if there is one.
   *
   * It lives in the universe rather than in React state for one reason: a shot
   * has to be on disk before the player can see where the ball finished. A round
   * held only in memory can be thrown away by reloading the page, which turns a
   * bad drive into a free re-try — and the whole point of playing your own shots
   * is that you have to live with them.
   *
   * Written the instant `hit` returns and before the ball is drawn moving, so
   * there is no window in which the outcome is known and unrecorded.
   */
  session: SavedSession | null;

  /** Bumped whenever anything changes, so React knows to re-render. */
  revision: number;
}

const FIRST_SEASON = 2026;

// ---------------------------------------------------------------------------
// Creating and indexing
// ---------------------------------------------------------------------------

export function golferMap(universe: Universe): Map<string, Golfer> {
  return new Map(universe.golfers.map((g) => [g.id, g]));
}

export function buildSchedule(season: number, golfers: Golfer[], rng: Rng): Tournament[] {
  return SCHEDULE.map((definition) =>
    createTournament(definition, season, fieldFor(definition, golfers), rng.fork(definition.id)),
  );
}

export function createUniverse(seed = 'golf-universe'): Universe {
  const rng = createRng(seed);
  const golfers = createTour();
  rankWorld(golfers);
  const schedule = buildSchedule(FIRST_SEASON, golfers, rng);
  const universe: Universe = {
    version: UNIVERSE_VERSION,
    season: FIRST_SEASON,
    golfers,
    schedule,
    eventIndex: 0,
    news: [],
    userGolferId: null,
    pastSeasons: [],
    developmentNotes: [],
    createdGolferId: null,
    careerEvents: [],
    careerSeasonReport: null,
    session: null,
    revision: 1,
  };
  universe.news.unshift(previewNews(schedule[0], golferMap(universe)));
  return universe;
}

export function currentTournament(universe: Universe): Tournament | null {
  return universe.schedule[universe.eventIndex] ?? null;
}

export function nextTournament(universe: Universe): Tournament | null {
  return universe.schedule[universe.eventIndex + 1] ?? null;
}

// ---------------------------------------------------------------------------
// World ranking and standings
// ---------------------------------------------------------------------------

export function rankWorld(golfers: Golfer[]): void {
  const sorted = [...golfers].sort((a, b) => b.rankingPoints - a.rankingPoints);
  sorted.forEach((golfer, index) => {
    golfer.worldRank = index + 1;
  });
}

export function pointsStandings(universe: Universe): Golfer[] {
  return [...universe.golfers].sort((a, b) => b.season.points - a.season.points || b.season.earnings - a.season.earnings);
}

export function moneyStandings(universe: Universe): Golfer[] {
  return [...universe.golfers].sort((a, b) => b.season.earnings - a.season.earnings);
}

export function worldRanking(universe: Universe): Golfer[] {
  return [...universe.golfers].sort((a, b) => a.worldRank - b.worldRank);
}

// ---------------------------------------------------------------------------
// Playing through an event
// ---------------------------------------------------------------------------

export interface AdvanceOptions {
  /** The human player is playing this golfer's rounds themselves. */
  skipGolferId?: string | null;
  fast?: boolean;
}

/**
 * Simulate the next round of the current event. Returns the round number that
 * was played, or null when the event is already finished.
 */
export function simulateNextRound(universe: Universe, options: AdvanceOptions = {}): number | null {
  const tournament = currentTournament(universe);
  if (!tournament || tournament.status === 'complete') return null;
  const round = tournament.roundsPlayed + 1;
  if (round > ROUNDS) return null;

  const golfers = golferMap(universe);
  if (tournament.status === 'upcoming') tournament.status = 'inProgress';
  tournament.teeTimes[round - 1] = { round, groups: makeTeeTimes(tournament, golfers, round) };

  const rng = createRng(`${universe.season}:${tournament.id}:${round}:${universe.revision}`);
  simulateRound(tournament, golfers, round, rng, { skipGolferId: options.skipGolferId, fast: options.fast });
  tournament.roundsPlayed = round;
  tournament.leaderboard = buildLeaderboard(tournament, round);
  tournament.recaps[round - 1] = recapFor(tournament, golfers, round);

  if (round === 2) {
    const { line } = applyCut(tournament);
    tournament.leaderboard = buildLeaderboard(tournament, round);
    tournament.recaps[1] += ` The cut fell at ${line >= 0 ? '+' : ''}${line}.`;
  }
  if (round === ROUNDS) finishTournament(universe, tournament);
  universe.revision++;
  return round;
}

/** Play the whole event out. */
export function simulateTournament(universe: Universe, options: AdvanceOptions = {}): Tournament | null {
  const tournament = currentTournament(universe);
  if (!tournament) return null;
  while (tournament.status !== 'complete') {
    if (simulateNextRound(universe, options) === null) break;
  }
  return tournament;
}

function finishTournament(universe: Universe, tournament: Tournament): void {
  const golfers = golferMap(universe);
  const previousNumberOne = worldRanking(universe)[0]?.id ?? null;

  // Both of these are changed by applying the results, and both are what the
  // career's XP depends on — "you finished above your ranking" and "that is a new
  // career best" are only true against where you stood before the week.
  const created = universe.createdGolferId ? golfers.get(universe.createdGolferId) : undefined;
  const before = created
    ? { worldRank: created.worldRank, bestFinish: created.career.bestFinishRank }
    : null;

  const rows = payout(tournament);
  applyResults(tournament, golfers, rows);

  if (created && before) {
    const event = recordedEventFor(universe.season, tournament, created.id, before);
    if (event) universe.careerEvents.push(event);
  }
  rankWorld(universe.golfers);
  universe.news.unshift(...tournamentNews(tournament, golfers, previousNumberOne));
  universe.eventIndex++;
  const upcoming = currentTournament(universe);
  if (upcoming) universe.news.unshift(previewNews(upcoming, golfers));
  universe.news = universe.news.slice(0, 90);
}

function recapFor(tournament: Tournament, golfers: Map<string, Golfer>, round: number): string {
  const course = COURSE_BY_ID[tournament.courseId];
  const weather = tournament.weather[round - 1];
  const board = buildLeaderboard(tournament, round).filter((r) => r.status === 'active');
  const leader = board[0];
  const leaderName = leader ? golfers.get(leader.golferId)?.name ?? '' : '';
  const tied = board.filter((r) => r.position === 1).length;
  const scores = board.map((r) => r.rounds[round - 1] ?? 0).filter((s) => s > 0);
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : course.par;
  const lead =
    tied > 1
      ? `${tied} players share the lead at ${leader ? formatPar(leader.toPar) : 'E'}`
      : `${leaderName} leads at ${leader ? formatPar(leader.toPar) : 'E'}`;
  return `Round ${round}: ${lead}. Scoring average ${average.toFixed(2)} in ${weather.label.toLowerCase()} conditions, wind ${Math.round(weather.windSpeed)} mph.`;
}

function formatPar(toPar: number): string {
  return toPar === 0 ? 'level par' : toPar > 0 ? `+${toPar}` : `${toPar}`;
}

// ---------------------------------------------------------------------------
// End of season
// ---------------------------------------------------------------------------

export function seasonComplete(universe: Universe): boolean {
  return universe.eventIndex >= universe.schedule.length;
}

/** Roll the universe over: awards, development, retirements, a new schedule. */
export function advanceSeason(universe: Universe): SeasonSummary {
  const golfers = golferMap(universe);
  const standings = pointsStandings(universe);
  const champion = standings[0];
  const moneyLeader = moneyStandings(universe)[0];
  const numberOne = worldRanking(universe)[0];

  const majors = universe.schedule
    .filter((t) => t.tier === 'major' && t.winnerId)
    .map((t) => ({ tournament: t.name, golferId: t.winnerId!, name: golfers.get(t.winnerId!)?.name ?? '' }));

  const qualified = universe.golfers.filter((g) => g.season.rounds >= 20);
  const lowAverage = qualified.length
    ? qualified.reduce((best, g) =>
        g.season.strokes / g.season.rounds < best.season.strokes / best.season.rounds ? g : best,
      )
    : champion;

  const summary: SeasonSummary = {
    season: universe.season,
    championId: champion.id,
    championName: champion.name,
    moneyLeaderId: moneyLeader.id,
    numberOneId: numberOne.id,
    majorWinners: majors,
    lowScoringAverage: {
      golferId: lowAverage.id,
      name: lowAverage.name,
      average: lowAverage.season.rounds ? lowAverage.season.strokes / lowAverage.season.rounds : 0,
    },
  };

  universe.news.unshift(...seasonNews(universe.season, champion.id, golfers, moneyLeader.id));

  // Season records, then development.
  const rng = createRng(`${universe.season}:development`);
  const notes: DevelopmentNote[] = [];
  const rankOf = new Map(standings.map((g, i) => [g.id, i + 1]));

  for (const golfer of universe.golfers) {
    const record: SeasonRecord = {
      season: universe.season,
      events: golfer.season.events,
      wins: golfer.season.wins,
      top10s: golfer.season.top10s,
      cutsMade: golfer.season.cutsMade,
      earnings: golfer.season.earnings,
      points: golfer.season.points,
      scoringAverage: golfer.season.rounds ? golfer.season.strokes / golfer.season.rounds : 0,
      rank: rankOf.get(golfer.id) ?? 0,
    };
    golfer.history.unshift(record);
    golfer.history = golfer.history.slice(0, 20);

    if (golfer.id === universe.createdGolferId) {
      /**
       * A created golfer is not developed by this engine, and that is the whole
       * bargain of the career system: the AI improves because it has potential,
       * the player improves because they earned it. Running `developGolfer` here
       * would hand out free rating points, and worse, hand them out with no regard
       * for the archetype's ceilings.
       *
       * So instead the season is written up as a report. The store sends it to the
       * career store, which pays the season bonus, has the golfer's birthday and
       * opens the offseason; the new ratings come back the other way through
       * `syncGolfer`.
       */
      universe.careerSeasonReport = seasonReportFor({
        season: universe.season,
        golfer,
        standingsRank: record.rank,
        top25s: golfer.season.top25s,
        bestPreviousScoringAverage: bestPreviousAverage(golfer),
      });
      golfer.career.seasons++;
    } else {
      notes.push(developGolfer(golfer, rng.fork(golfer.id), record.rank));
    }
    golfer.season = emptySeason();
    golfer.fatigue = 0;
  }

  // Retirements, and a graduate for each one. A created golfer never appears in
  // `notes`, so they can never be retired out from under their own account.
  const retiring = new Set(notes.filter((n) => n.retired).map((n) => n.golferId));
  universe.golfers = universe.golfers.filter((g) => !retiring.has(g.id));
  // One extra card is issued when a created golfer is on tour, so making one does
  // not quietly cost somebody else theirs.
  const cards = TOUR_SIZE + (universe.createdGolferId ? 1 : 0);
  let index = 0;
  while (universe.golfers.length < cards) {
    universe.golfers.push(createRookie(rng.fork(`rookie:${index}`), universe.season + 1, index));
    index++;
  }
  for (const golfer of universe.golfers) golfer.hidden.currentAbility = currentAbility(golfer);
  rankWorld(universe.golfers);

  universe.season++;
  universe.schedule = buildSchedule(universe.season, universe.golfers, createRng(`${universe.season}:schedule`));
  universe.eventIndex = 0;
  universe.pastSeasons.unshift(summary);
  universe.developmentNotes = notes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 24);
  universe.news.unshift(previewNews(universe.schedule[0], golferMap(universe)));
  universe.revision++;
  return summary;
}

/** The best scoring average in any completed season, for the career-best bonus. */
function bestPreviousAverage(golfer: Golfer): number {
  const averages = golfer.history.slice(1).map((season) => season.scoringAverage).filter((value) => value > 0);
  return averages.length ? Math.min(...averages) : 0;
}

// ---------------------------------------------------------------------------
// Careers
// ---------------------------------------------------------------------------

/**
 * Put a created golfer on tour.
 *
 * They arrive as a rookie in every sense: no ranking points, so last in the world,
 * and no career record. The schedule is rebuilt because the invitational fields are
 * drawn off the world ranking and a 157th player changes who is in them — and
 * because a golfer who is not in a tournament's field cannot play it.
 */
export function joinTour(universe: Universe, golfer: Golfer): void {
  if (universe.golfers.some((existing) => existing.id === golfer.id)) return;
  universe.golfers.push(golfer);
  universe.createdGolferId = golfer.id;
  universe.userGolferId = golfer.id;
  rankWorld(universe.golfers);
  // Only events not yet under way: a tournament in progress keeps its field.
  const rng = createRng(`${universe.season}:schedule:${golfer.id}`);
  universe.schedule = universe.schedule.map((tournament, index) =>
    index < universe.eventIndex || tournament.status !== 'upcoming'
      ? tournament
      : createTournament(tournament, tournament.season, fieldFor(tournament, universe.golfers), rng.fork(tournament.id)),
  );
  universe.revision++;
}

/** Take a created golfer off tour, leaving the universe playable. */
export function leaveTour(universe: Universe): void {
  const id = universe.createdGolferId;
  if (!id) return;
  universe.golfers = universe.golfers.filter((golfer) => golfer.id !== id);
  universe.createdGolferId = null;
  if (universe.userGolferId === id) universe.userGolferId = null;
  universe.careerEvents = [];
  universe.careerSeasonReport = null;
  rankWorld(universe.golfers);
  universe.revision++;
}

// ---------------------------------------------------------------------------
// Small helpers the UI wants
// ---------------------------------------------------------------------------

export function seasonScoringAverage(golfer: Golfer): number {
  return golfer.season.rounds ? golfer.season.strokes / golfer.season.rounds : 0;
}

export function careerScoringAverage(golfer: Golfer): number {
  return scoringAverage(golfer);
}

export function formOf(golfer: Golfer): number {
  return clamp(golfer.hidden.form, -10, 10);
}

export function tournamentPosition(tournament: Tournament, golferId: string): string {
  const row = tournament.leaderboard.find((r) => r.golferId === golferId);
  if (!row) return '—';
  return row.status === 'cut' ? 'MC' : row.label;
}

export { totalStrokes };
