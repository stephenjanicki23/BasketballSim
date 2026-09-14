/**
 * A full tournament at every venue.
 *
 * One hundred and fifty-six players, four rounds, a cut after two, the weather
 * each course actually generates — the same engine the season runs on. This is
 * the report that says what each course is worth: what wins, what makes the
 * cut, and which holes do the damage.
 *
 *   node tools/tsrun.mjs test/venueCheck.ts [tier]
 */
import { createTour } from '../src/data/golfers';
import { COURSES } from '../src/data/courses';
import { describeWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import {
  applyCut, buildLeaderboard, createTournament, simulateRound, toParLabel,
  type PlayerRound, type Tournament,
} from '../src/simulation/tournamentEngine';
import type { Golfer } from '../src/simulation/types';

const tier = (process.argv[2] ?? 'regular') as 'regular' | 'invitational' | 'major';
const tour = createTour();
const byId = new Map(tour.map((g) => [g.id, g]));

function rounds(tournament: Tournament): PlayerRound[] {
  return Object.values(tournament.results).flat();
}

for (const course of COURSES) {
  const rng = createRng(`venue:${course.id}`);
  const tournament = createTournament(
    { id: `venue-${course.id}`, name: `${course.name} Invitational`, courseId: course.id, week: 1, purse: 9_000_000, tier, blurb: '' },
    2026,
    tour,
    rng,
  );
  for (const golfer of tour) golfer.fatigue = 0;

  const start = performance.now();
  const perRound: number[] = [];
  for (let round = 1; round <= 4; round++) {
    simulateRound(tournament, byId, round, createRng(`venue:${course.id}:${round}`), { fast: true });
    tournament.roundsPlayed = round;
    const scores = Object.values(tournament.results).map((list) => list[round - 1]).filter(Boolean) as PlayerRound[];
    perRound.push(scores.reduce((sum, r) => sum + r.strokes, 0) / scores.length);
    if (round === 2) applyCut(tournament);
  }
  const seconds = (performance.now() - start) / 1000;

  const board = buildLeaderboard(tournament, 4);
  const all = rounds(tournament);
  const sum = (pick: (r: PlayerRound) => number) => all.reduce((total, r) => total + pick(r), 0);
  const low = all.reduce((best, r) => Math.min(best, r.strokes), 99);
  const holeTotals = new Array(19).fill(0);
  const holeCounts = new Array(19).fill(0);
  for (const round of all) {
    round.holeScores.forEach((strokes, index) => {
      if (!strokes) return;
      holeTotals[index + 1] += strokes;
      holeCounts[index + 1]++;
    });
  }
  const versusPar = course.holes.map((hole) => ({
    hole: hole.number,
    par: hole.par,
    delta: holeCounts[hole.number] ? holeTotals[hole.number] / holeCounts[hole.number] - hole.par : 0,
  }));
  const hardest = [...versusPar].sort((a, b) => b.delta - a.delta).slice(0, 3);
  const easiest = [...versusPar].sort((a, b) => a.delta - b.delta).slice(0, 3);
  // The winner comes off the board: applyResults is the season's job, not this report's.
  const winner = byId.get(board[0].golferId) as Golfer;
  const margin = board[1] ? board[1].total - board[0].total : 0;
  const madeCut = tournament.madeCut.length;

  console.log(`\n=== ${course.name} — par ${course.par}, ${course.yards.toLocaleString()} yd, ${course.altitude.toLocaleString()} ft`);
  console.log(`  weather: ${tournament.weather.map((w) => describeWeather(w)).join(' | ')}`);
  console.log(`  field average by round: ${perRound.map((a) => a.toFixed(1)).join('  ')}   (${(perRound.reduce((a, b) => a + b, 0) / 4 - course.par >= 0 ? '+' : '')}${(perRound.reduce((a, b) => a + b, 0) / 4 - course.par).toFixed(2)} a round)`);
  console.log(`  cut ${toParLabel(tournament.cutLine ?? 0)} — ${madeCut} played the weekend; low round of the week ${low}`);
  console.log(`  won by ${winner.name} at ${toParLabel(board[0].toPar)}, by ${margin === 0 ? 'a playoff' : `${margin}`}`);
  console.log(
    `  field: GIR ${((sum((r) => r.stats.girHit) / sum((r) => r.stats.girAttempts)) * 100).toFixed(0)}%  ` +
      `FIR ${((sum((r) => r.stats.fairwaysHit) / sum((r) => r.stats.fairwayAttempts)) * 100).toFixed(0)}%  ` +
      `putts ${(sum((r) => r.stats.putts) / all.length).toFixed(1)}  ` +
      `drive ${(sum((r) => r.stats.driveTotal) / sum((r) => r.stats.drives)).toFixed(0)} yd  ` +
      `scrambling ${((sum((r) => r.stats.scrambleSaves) / sum((r) => r.stats.scrambleAttempts)) * 100).toFixed(0)}%  ` +
      `penalties ${(sum((r) => r.stats.penalties) / all.length).toFixed(2)}`,
  );
  console.log(
    `  scoring: eagles ${(sum((r) => r.stats.eagles) / all.length).toFixed(2)}  birdies ${(sum((r) => r.stats.birdies) / all.length).toFixed(1)}  ` +
      `pars ${(sum((r) => r.stats.pars) / all.length).toFixed(1)}  bogeys ${(sum((r) => r.stats.bogeys) / all.length).toFixed(1)}  ` +
      `doubles+ ${(sum((r) => r.stats.doubles) / all.length).toFixed(2)} per round`,
  );
  console.log(`  hardest: ${hardest.map((h) => `#${h.hole} (${h.par}) ${h.delta >= 0 ? '+' : ''}${h.delta.toFixed(2)}`).join('  ')}`);
  console.log(`  easiest: ${easiest.map((h) => `#${h.hole} (${h.par}) ${h.delta >= 0 ? '+' : ''}${h.delta.toFixed(2)}`).join('  ')}`);
  console.log(`  top five: ${board.slice(0, 5).map((row) => `${byId.get(row.golferId)?.name} ${toParLabel(row.toPar)}`).join(', ')}`);
  console.log(`  (${seconds.toFixed(1)}s)`);
}
