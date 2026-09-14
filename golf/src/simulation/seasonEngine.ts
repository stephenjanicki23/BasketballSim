/**
 * The universe: a tour, a calendar, a world ranking and a history.
 *
 * This module owns the only mutable state in the game. Everything else takes
 * state in and hands a result back, which is what makes the whole thing
 * testable from a command line and serialisable into localStorage.
 */

import { type Rng, clamp, createRng } from './rng';
import { createTour } from '../data/golfers';
import { createRookie } from '../data/rookies';
import { SCHEDULE } from '../data/tournaments';
import { COURSE_BY_ID } from '../data/courses';
import {
  applyCut,
  applyResults,
  buildLeaderboard,
  createTournament,
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
import type { Golfer, SeasonRecord } from './types';

export const UNIVERSE_VERSION = 4;

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
  return SCHEDULE.map((definition) => createTournament(definition, season, golfers, rng.fork(definition.id)));
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
  const rows = payout(tournament);
  applyResults(tournament, golfers, rows);
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
    notes.push(developGolfer(golfer, rng.fork(golfer.id), record.rank));
    golfer.season = emptySeason();
    golfer.fatigue = 0;
  }

  // Retirements, and a graduate for each one.
  const retiring = new Set(notes.filter((n) => n.retired).map((n) => n.golferId));
  universe.golfers = universe.golfers.filter((g) => !retiring.has(g.id));
  let index = 0;
  while (universe.golfers.length < 50) {
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
