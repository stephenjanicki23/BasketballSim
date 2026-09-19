/**
 * A tournament: four rounds, a cut after two, prize money, points and a
 * leaderboard that decides how much pressure everybody is under.
 *
 * Rounds are played hole-by-hole across the whole field in lockstep rather than
 * player-by-player. That costs nothing and buys something important: when a
 * golfer stands on the 16th tee on Sunday, the leaderboard beside them is the
 * real one, so "two clear with three to play" is a fact the engine knows about
 * and can turn into pressure.
 */

import { type Rng, clamp, createRng } from './rng';
import { holeGeometry, pinForRound, withPin } from './courseEngine';
import { playHole, type HoleOutcome } from './holeEngine';
import { conditionsFor, generateWeather } from './weatherEngine';
import { type DailyTouch, addPuttingStats, dailyTouch, emptyPuttingStats } from './golferEngine';
import { COURSE_BY_ID } from '../data/courses';
import type { Conditions, Golfer, PuttingStats, Weather } from './types';

export interface RoundStats {
  putts: number;
  putting: PuttingStats;
  girHit: number;
  girAttempts: number;
  fairwaysHit: number;
  fairwayAttempts: number;
  driveTotal: number;
  drives: number;
  penalties: number;
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  doubles: number;
  scrambleSaves: number;
  scrambleAttempts: number;
}

export interface PlayerRound {
  strokes: number;
  toPar: number;
  holeScores: number[];
  stats: RoundStats;
}

export interface LeaderboardRow {
  golferId: string;
  position: number;
  label: string;
  rounds: (number | null)[];
  total: number;
  toPar: number;
  today: number | null;
  thru: number;
  status: 'active' | 'cut' | 'withdrawn';
  money: number;
  points: number;
  movement: number;
}

export interface TournamentDefinition {
  id: string;
  name: string;
  courseId: string;
  week: number;
  purse: number;
  /** Points and world-ranking weight. */
  tier: 'regular' | 'invitational' | 'major';
  blurb: string;
}

export interface Tournament extends TournamentDefinition {
  season: number;
  field: string[];
  weather: Weather[];
  results: Record<string, PlayerRound[]>;
  cutLine: number | null;
  madeCut: string[];
  status: 'upcoming' | 'inProgress' | 'complete';
  /** Rounds completed. */
  roundsPlayed: number;
  leaderboard: LeaderboardRow[];
  winnerId: string | null;
  runnerUpIds: string[];
  /** Margin of victory in strokes. */
  margin: number;
  teeTimes: { round: number; groups: string[][] }[];
  recaps: string[];
}

const ROUNDS = 4;
const CUT_AFTER = 2;
/** The low this many and ties play the weekend. */
const CUT_SIZE = 65;
/** An invitational takes the top of the world ranking rather than the whole tour. */
const INVITATIONAL_FIELD = 78;

// ---------------------------------------------------------------------------
// Money and points
// ---------------------------------------------------------------------------

/**
 * Share of the purse by finishing position, first through sixty-fifth — the
 * shape of a tour payout. The weights are normalised at load so the whole purse
 * is paid out rather than most of it.
 */
const MONEY_WEIGHTS = [
  0.1800, 0.1090, 0.0690, 0.0490, 0.0410, 0.03625, 0.03375, 0.03125, 0.02925, 0.02725,
  0.02525, 0.02325, 0.02125, 0.01975, 0.01825, 0.01675, 0.01575, 0.01475, 0.01375, 0.01275,
  0.01175, 0.01075, 0.00995, 0.00915, 0.00835, 0.00755, 0.00725, 0.00695, 0.00670, 0.00645,
  0.00620, 0.00595, 0.00570, 0.00545, 0.00525, 0.00505, 0.00485, 0.00465, 0.00445, 0.00425,
  0.00405, 0.00385, 0.00365, 0.00345, 0.00325, 0.00305, 0.00285, 0.00265, 0.00252, 0.00246,
  0.00240, 0.00234, 0.00228, 0.00222, 0.00216, 0.00210, 0.00204, 0.00198, 0.00192, 0.00186,
  0.00180, 0.00174, 0.00168, 0.00162, 0.00156,
];

const MONEY_TOTAL = MONEY_WEIGHTS.reduce((sum, share) => sum + share, 0);
const MONEY_SHARE = MONEY_WEIGHTS.map((share) => share / MONEY_TOTAL);

/** Points by finishing position: 500 for a win, down to a single point at 65th. */
const POINTS_BASE = (() => {
  const head = [
    500, 300, 190, 135, 110, 100, 90, 85, 80, 75,
    70, 65, 60, 57, 54, 51, 48, 46, 44, 42,
    40, 38, 36, 34, 32.5, 31, 29.5, 28, 26.5, 25,
  ];
  const tail: number[] = [];
  for (let position = 31; position <= 65; position++) {
    // Smooth decay from 24 down to 1 across the rest of the field.
    tail.push(Math.round((24 * Math.pow(0.9, position - 31) + 1) * 10) / 10);
  }
  return [...head, ...tail];
})();

export function tierMultiplier(tier: TournamentDefinition['tier']): number {
  return tier === 'major' ? 2 : tier === 'invitational' ? 1.4 : 1;
}

// ---------------------------------------------------------------------------
// Creating a tournament
// ---------------------------------------------------------------------------

/**
 * Who is in this week. Full-field events take everybody with a card; an
 * invitational takes the top of the world ranking, which is how those weeks get
 * the best field of the regular season.
 */
export function fieldFor(definition: TournamentDefinition, tour: Golfer[]): Golfer[] {
  if (definition.tier !== 'invitational') return [...tour];
  return [...tour].sort((a, b) => a.worldRank - b.worldRank).slice(0, INVITATIONAL_FIELD);
}

export function createTournament(
  definition: TournamentDefinition,
  season: number,
  field: Golfer[],
  rng: Rng,
): Tournament {
  const course = COURSE_BY_ID[definition.courseId];
  const weather: Weather[] = [];
  let previous: Weather | undefined;
  for (let round = 0; round < ROUNDS; round++) {
    previous = generateWeather(course, rng, previous);
    weather.push(previous);
  }

  const ids = field.map((g) => g.id);
  const teeTimes = [1, 2, 3, 4].map((round) => ({ round, groups: [] as string[][] }));

  return {
    ...definition,
    season,
    field: ids,
    weather,
    results: Object.fromEntries(ids.map((id) => [id, [] as PlayerRound[]])),
    cutLine: null,
    madeCut: [],
    status: 'upcoming',
    roundsPlayed: 0,
    leaderboard: [],
    winnerId: null,
    runnerUpIds: [],
    margin: 0,
    teeTimes,
    recaps: [],
  };
}

/** Threeballs, seeded by world ranking so the leaders go out together late. */
export function makeTeeTimes(tournament: Tournament, golfers: Map<string, Golfer>, round: number): string[][] {
  const entrants = round <= CUT_AFTER ? tournament.field : tournament.madeCut;
  const ordered = [...entrants].sort((a, b) => {
    if (round <= CUT_AFTER) {
      return (golfers.get(a)?.worldRank ?? 99) - (golfers.get(b)?.worldRank ?? 99);
    }
    return totalStrokes(tournament, a) - totalStrokes(tournament, b);
  });
  // Weakest out first, leaders last.
  ordered.reverse();
  const groups: string[][] = [];
  for (let i = 0; i < ordered.length; i += 3) groups.push(ordered.slice(i, i + 3));
  return groups;
}

export function teeTimeLabel(groupIndex: number, round: number): string {
  const startMinutes = (round === 3 || round === 4 ? 10 * 60 + 15 : 7 * 60 + 30) + groupIndex * 11;
  const hour = Math.floor(startMinutes / 60);
  const minute = startMinutes % 60;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const display = hour > 12 ? hour - 12 : hour;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Pressure
// ---------------------------------------------------------------------------

export interface PressureInput {
  round: number;
  hole: number;
  /** Strokes behind the lead; 0 means leading. */
  behind: number;
  /** Position in the field. */
  position: number;
  /** Strokes relative to the projected cut line, negative is safe. */
  toCut: number | null;
  /** Stroke index of the hole, 1 = hardest. */
  holeIndex: number;
  fieldSize: number;
}

/**
 * Pressure, 0 to 1. Thursday morning on the 3rd is nothing; Sunday on the 17th
 * one behind is everything. The cut line has its own kind of pressure on Friday
 * afternoon, which is the one that ends careers.
 */
export function pressureFor(input: PressureInput): number {
  let pressure = 0.08;
  pressure += [0, 0.05, 0.12, 0.24][clamp(input.round - 1, 0, 3)];
  // The closing stretch.
  pressure += Math.pow(input.hole / 18, 2.4) * (input.round >= 3 ? 0.3 : 0.12);
  // In contention.
  if (input.round >= 3 && input.behind <= 4) {
    pressure += (1 - input.behind / 5) * (input.round === 4 ? 0.34 : 0.18);
  }
  // On the cut line, late on Friday.
  if (input.round === 2 && input.toCut !== null && Math.abs(input.toCut) <= 2) {
    pressure += (1 - Math.abs(input.toCut) / 3) * 0.22 * Math.pow(input.hole / 18, 1.6);
  }
  if (input.holeIndex <= 5) pressure += 0.05;
  return clamp(pressure, 0, 1);
}

// ---------------------------------------------------------------------------
// Playing a round
// ---------------------------------------------------------------------------

function emptyStats(): RoundStats {
  return {
    putts: 0, putting: emptyPuttingStats(), girHit: 0, girAttempts: 0,
    fairwaysHit: 0, fairwayAttempts: 0, driveTotal: 0, drives: 0, penalties: 0,
    eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0,
    scrambleSaves: 0, scrambleAttempts: 0,
  };
}

function accumulate(stats: RoundStats, outcome: HoleOutcome): void {
  stats.putts += outcome.putts;
  addPuttingStats(stats.putting, outcome.putting);
  stats.penalties += outcome.penalties;
  stats.girAttempts++;
  if (outcome.gir) stats.girHit++;
  if (outcome.fairwayHit !== null) {
    stats.fairwayAttempts++;
    if (outcome.fairwayHit) stats.fairwaysHit++;
  }
  if (outcome.driveDistance !== null) {
    stats.driveTotal += outcome.driveDistance;
    stats.drives++;
  }
  if (outcome.scrambled !== null) {
    stats.scrambleAttempts++;
    if (outcome.scrambled) stats.scrambleSaves++;
  }
  if (outcome.toPar <= -2) stats.eagles++;
  else if (outcome.toPar === -1) stats.birdies++;
  else if (outcome.toPar === 0) stats.pars++;
  else if (outcome.toPar === 1) stats.bogeys++;
  else stats.doubles++;
}

export function totalStrokes(tournament: Tournament, golferId: string): number {
  return (tournament.results[golferId] ?? []).reduce((sum, round) => sum + round.strokes, 0);
}

export interface SimulateRoundOptions {
  /** Skip this golfer — the human player is playing their own round. */
  skipGolferId?: string | null;
  /** Fewer candidate shots per decision. */
  fast?: boolean;
}

/**
 * Play one round for the whole field, hole by hole so the leaderboard — and the
 * pressure that comes with it — is live.
 */
export function simulateRound(
  tournament: Tournament,
  golfers: Map<string, Golfer>,
  round: number,
  rng: Rng,
  options: SimulateRoundOptions = {},
): void {
  const course = COURSE_BY_ID[tournament.courseId];
  const weather = tournament.weather[round - 1];
  const conditions: Conditions = conditionsFor(weather, `${tournament.id}:${round}`);
  const entrants = (round <= CUT_AFTER ? tournament.field : tournament.madeCut).filter(
    (id) => id !== options.skipGolferId,
  );

  // Overnight recovery, then the day's work.
  for (const id of entrants) {
    const golfer = golfers.get(id);
    if (golfer) golfer.fatigue = Math.max(0, golfer.fatigue - 26);
  }

  const running = new Map<string, { strokes: number; holes: number[]; stats: RoundStats }>();
  const touches = new Map<string, DailyTouch>();
  for (const id of entrants) {
    running.set(id, { strokes: 0, holes: [], stats: emptyStats() });
    const golfer = golfers.get(id);
    if (golfer) touches.set(id, dailyTouch(golfer, rng.fork(`touch:${round}:${id}`)));
  }

  const priorStrokes = new Map<string, number>();
  for (const id of entrants) priorStrokes.set(id, totalStrokes(tournament, id));

  for (let holeNumber = 1; holeNumber <= 18; holeNumber++) {
    const base = holeGeometry(course, holeNumber);
    const hole = withPin(base, pinForRound(base, round));

    // Live leaderboard entering this hole.
    const standings = entrants
      .map((id) => ({ id, score: (priorStrokes.get(id) ?? 0) + (running.get(id)?.strokes ?? 0) }))
      .sort((a, b) => a.score - b.score);
    const leadScore = standings.length > 0 ? standings[0].score : 0;
    const cutIndex = Math.min(CUT_SIZE - 1, standings.length - 1);
    const projectedCut = round === 2 && cutIndex >= 0 ? standings[cutIndex].score : null;
    const positions = new Map(standings.map((s, i) => [s.id, i + 1]));

    for (const id of entrants) {
      const golfer = golfers.get(id);
      const state = running.get(id);
      if (!golfer || !state) continue;
      const score = (priorStrokes.get(id) ?? 0) + state.strokes;
      const pressure = pressureFor({
        round,
        hole: holeNumber,
        behind: score - leadScore,
        position: positions.get(id) ?? entrants.length,
        toCut: projectedCut === null ? null : score - projectedCut,
        holeIndex: hole.spec.index,
        fieldSize: entrants.length,
      });
      const outcome = playHole({
        hole,
        golfer,
        conditions,
        rng,
        pressure,
        fast: options.fast,
        shotSeed: holeNumber * 11 + round * 3,
        touch: touches.get(id),
        situation: {
          round,
          behind: score - leadScore,
          holesRemaining: (ROUNDS - round) * 18 + (18 - holeNumber + 1),
          toPar: 0,
        },
      });
      state.strokes += outcome.strokes;
      state.holes.push(outcome.strokes);
      accumulate(state.stats, outcome);
    }
  }

  for (const id of entrants) {
    const state = running.get(id);
    if (!state) continue;
    recordRound(tournament, id, round, {
      strokes: state.strokes,
      toPar: state.strokes - course.par,
      holeScores: state.holes,
      stats: state.stats,
    });
  }
}

/** Store a completed round — used by the simulation and by the played game alike. */
export function recordRound(tournament: Tournament, golferId: string, round: number, result: PlayerRound): void {
  const rounds = tournament.results[golferId] ?? [];
  rounds[round - 1] = result;
  tournament.results[golferId] = rounds;
}

// ---------------------------------------------------------------------------
// Leaderboard, cut and payout
// ---------------------------------------------------------------------------

export function buildLeaderboard(tournament: Tournament, roundsComplete: number): LeaderboardRow[] {
  const course = COURSE_BY_ID[tournament.courseId];
  const rows: LeaderboardRow[] = tournament.field.map((golferId) => {
    const rounds = tournament.results[golferId] ?? [];
    const played = rounds.filter(Boolean);
    const total = played.reduce((sum, r) => sum + r.strokes, 0);
    const cut = tournament.cutLine !== null && !tournament.madeCut.includes(golferId);
    const last = rounds[roundsComplete - 1];
    return {
      golferId,
      position: 0,
      label: '',
      rounds: [0, 1, 2, 3].map((i) => (rounds[i] ? rounds[i].strokes : null)),
      total,
      toPar: total - course.par * played.length,
      today: last ? last.strokes - course.par : null,
      thru: played.length * 18,
      status: cut ? 'cut' : 'active',
      money: 0,
      points: 0,
      movement: 0,
    };
  });

  const active = rows.filter((r) => r.status === 'active' && r.thru > 0);
  const cutRows = rows.filter((r) => r.status === 'cut');
  active.sort((a, b) => a.total - b.total || a.toPar - b.toPar);
  cutRows.sort((a, b) => a.total - b.total);

  let position = 1;
  for (let i = 0; i < active.length; i++) {
    if (i > 0 && active[i].total !== active[i - 1].total) position = i + 1;
    active[i].position = position;
    const tied = active.filter((r) => r.total === active[i].total).length > 1;
    active[i].label = `${tied ? 'T' : ''}${position}`;
  }
  for (const row of cutRows) {
    row.position = 0;
    row.label = 'MC';
  }
  return [...active, ...cutRows];
}

/** Apply the cut after two rounds: the low 65 and ties play the weekend. */
export function applyCut(tournament: Tournament): { line: number; missed: string[] } {
  const course = COURSE_BY_ID[tournament.courseId];
  const scores = tournament.field
    .map((id) => ({ id, strokes: totalStrokes(tournament, id) }))
    .filter((entry) => (tournament.results[entry.id] ?? []).filter(Boolean).length >= CUT_AFTER)
    .sort((a, b) => a.strokes - b.strokes);

  const lineIndex = Math.min(CUT_SIZE - 1, scores.length - 1);
  const line = scores[lineIndex]?.strokes ?? 0;
  tournament.madeCut = scores.filter((s) => s.strokes <= line).map((s) => s.id);
  tournament.cutLine = line - course.par * CUT_AFTER;
  const missed = tournament.field.filter((id) => !tournament.madeCut.includes(id));
  return { line: tournament.cutLine, missed };
}

export interface PayoutRow {
  golferId: string;
  position: number;
  money: number;
  points: number;
  rankingPoints: number;
}

/** Money and points, sharing evenly between tied positions. */
export function payout(tournament: Tournament): PayoutRow[] {
  const leaderboard = buildLeaderboard(tournament, ROUNDS);
  const multiplier = tierMultiplier(tournament.tier);
  const rows: PayoutRow[] = [];
  const active = leaderboard.filter((r) => r.status === 'active');

  let index = 0;
  while (index < active.length) {
    const position = active[index].position;
    const tied = active.filter((r) => r.position === position);
    let money = 0;
    let points = 0;
    for (let k = 0; k < tied.length; k++) {
      const slot = position - 1 + k;
      money += (MONEY_SHARE[slot] ?? 0) * tournament.purse;
      points += (POINTS_BASE[slot] ?? 0) * multiplier;
    }
    const shareMoney = money / tied.length;
    const sharePoints = points / tied.length;
    for (const row of tied) {
      row.money = shareMoney;
      row.points = sharePoints;
      rows.push({
        golferId: row.golferId,
        position,
        money: shareMoney,
        points: sharePoints,
        rankingPoints: rankingPointsFor(position, tournament.tier),
      });
    }
    index += tied.length;
  }

  for (const row of leaderboard.filter((r) => r.status === 'cut')) {
    rows.push({ golferId: row.golferId, position: 0, money: 0, points: 0, rankingPoints: 0 });
  }

  tournament.leaderboard = leaderboard;
  const winners = leaderboard.filter((r) => r.position === 1);
  tournament.winnerId = winners[0]?.golferId ?? null;
  tournament.runnerUpIds = leaderboard.filter((r) => r.position === 2).map((r) => r.golferId);
  const second = leaderboard.find((r) => r.position > 1);
  tournament.margin = second && winners[0] ? second.total - winners[0].total : 0;
  return rows;
}

function rankingPointsFor(position: number, tier: TournamentDefinition['tier']): number {
  if (position <= 0) return 0;
  const base = tier === 'major' ? 100 : tier === 'invitational' ? 72 : 52;
  return base * Math.pow(position, -0.78);
}

/** Everything the season engine needs to write back into a golfer. */
export function applyResults(
  tournament: Tournament,
  golfers: Map<string, Golfer>,
  rows: PayoutRow[],
): void {
  const course = COURSE_BY_ID[tournament.courseId];
  for (const row of rows) {
    const golfer = golfers.get(row.golferId);
    if (!golfer) continue;
    const rounds = (tournament.results[row.golferId] ?? []).filter(Boolean);
    const madeCut = tournament.madeCut.includes(row.golferId);

    golfer.career.events++;
    golfer.season.events++;
    golfer.career.earnings += row.money;
    golfer.season.earnings += row.money;
    golfer.season.points += row.points;
    if (madeCut) {
      golfer.career.cutsMade++;
      golfer.season.cutsMade++;
    }
    if (row.position === 1) {
      golfer.career.wins++;
      golfer.season.wins++;
      if (tournament.tier === 'major') golfer.career.majors++;
    }
    if (row.position >= 1 && row.position <= 10) {
      golfer.career.top10s++;
      golfer.season.top10s++;
    }
    if (row.position >= 1 && row.position <= 25) golfer.season.top25s++;
    if (row.position >= 1 && (golfer.career.bestFinishRank === 0 || row.position < golfer.career.bestFinishRank)) {
      golfer.career.bestFinishRank = row.position;
    }
    if (row.position >= 1 && (golfer.season.bestFinish === 0 || row.position < golfer.season.bestFinish)) {
      golfer.season.bestFinish = row.position;
    }

    for (const round of rounds) {
      golfer.career.rounds++;
      golfer.season.rounds++;
      golfer.career.strokes += round.strokes;
      golfer.season.strokes += round.strokes;
      golfer.career.parTotal += course.par;
      golfer.season.parTotal += course.par;
      golfer.career.holes += 18;
      const s = round.stats;
      golfer.career.putts += s.putts;
      golfer.career.puttHoles += 18;
      addPuttingStats(golfer.career.putting, s.putting);
      golfer.career.greensHit += s.girHit;
      golfer.career.greenAttempts += s.girAttempts;
      golfer.career.fairwaysHit += s.fairwaysHit;
      golfer.career.fairwayAttempts += s.fairwayAttempts;
      golfer.career.drives += s.drives;
      golfer.career.driveDistanceTotal += s.driveTotal;
      golfer.career.scrambleSaves += s.scrambleSaves;
      golfer.career.scrambleAttempts += s.scrambleAttempts;
      golfer.career.eagles += s.eagles;
      golfer.career.birdies += s.birdies;
      golfer.season.eagles += s.eagles;
      golfer.season.birdies += s.birdies;
      golfer.career.pars += s.pars;
      golfer.career.bogeys += s.bogeys;
      golfer.career.doubles += s.doubles;
    }

    // Ranking points decay, then the week's haul is added.
    golfer.rankingPoints = golfer.rankingPoints * 0.975 + row.rankingPoints;

    // Form follows results, and confidence follows form.
    const finish = row.position === 0 ? 45 : row.position;
    golfer.recentFinishes = [finish, ...golfer.recentFinishes].slice(0, 8);
    const formShift = row.position === 0 ? -1.5 : clamp((14 - finish) * 0.22, -1.4, 3.2);
    golfer.hidden.form = clamp(golfer.hidden.form * 0.72 + formShift, -10, 10);
    golfer.hidden.confidence = clamp(
      golfer.hidden.confidence + (row.position === 1 ? 9 : row.position <= 10 ? 3.5 : row.position === 0 ? -4 : 0),
      12,
      99,
    );
    golfer.fatigue = Math.max(0, golfer.fatigue - 45);
  }
  tournament.status = 'complete';
}

/** Field strength, for the news and for ranking weight. */
export function fieldStrength(tournament: Tournament, golfers: Map<string, Golfer>): number {
  const abilities = tournament.field
    .map((id) => golfers.get(id)?.hidden.currentAbility ?? 50)
    .sort((a, b) => b - a);
  const top = abilities.slice(0, 20);
  return Math.round(top.reduce((sum, a) => sum + a, 0) / Math.max(1, top.length));
}

/** Convenience for the UI. */
export function toParLabel(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

export function roundSeed(tournament: Tournament, round: number): Rng {
  return createRng(`${tournament.season}:${tournament.id}:${round}`);
}

export { ROUNDS, CUT_AFTER, CUT_SIZE, INVITATIONAL_FIELD };
