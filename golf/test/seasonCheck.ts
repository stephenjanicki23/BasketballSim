/**
 * A whole season, then the next one: does the universe produce believable
 * champions, believable statistics and believable careers?
 */
import {
  advanceSeason, createUniverse, currentTournament, moneyStandings, pointsStandings,
  seasonComplete, seasonScoringAverage, simulateTournament, worldRanking,
} from '../src/simulation/seasonEngine';
import { courseFit, fitVerdict } from '../src/simulation/courseFit';
import { COURSE_BY_ID } from '../src/data/courses';
import { toParLabel } from '../src/simulation/tournamentEngine';

const fast = !process.argv.includes('--full');
const universe = createUniverse();
const start = performance.now();

console.log('Simulating a season' + (fast ? ' (fast decisions)' : ' (full decisions)') + '...\n');
const winners: string[] = [];
while (!seasonComplete(universe)) {
  const event = currentTournament(universe)!;
  const eventStart = performance.now();
  const done = simulateTournament(universe, { fast })!;
  const board = done.leaderboard;
  const winner = universe.golfers.find((g) => g.id === done.winnerId)!;
  const course = COURSE_BY_ID[done.courseId];
  const fieldAvg =
    board.filter((r) => r.status !== 'cut').reduce((s, r) => s + r.total / (r.rounds.filter(Boolean).length || 1), 0) /
    Math.max(1, board.filter((r) => r.status !== 'cut').length);
  winners.push(winner.name);
  console.log(
    `w${String(event.week).padStart(2)} ${done.name.padEnd(24)} ${course.name.slice(0, 8).padEnd(8)} ` +
      `${winner.name.padEnd(20)} ${toParLabel(board[0].toPar).padStart(4)}  cut ${toParLabel(done.cutLine ?? 0).padStart(3)}  ` +
      `avg ${fieldAvg.toFixed(1)}  ${((performance.now() - eventStart) / 1000).toFixed(1)}s`,
  );
}
const elapsed = (performance.now() - start) / 1000;
console.log(`\nSeason simulated in ${elapsed.toFixed(1)}s (${(elapsed / 20).toFixed(2)}s per event)`);

console.log('\n--- Points standings ---');
for (const [i, g] of pointsStandings(universe).slice(0, 12).entries()) {
  console.log(
    `${String(i + 1).padStart(2)}. ${g.flag} ${g.name.padEnd(22)} ${String(Math.round(g.season.points)).padStart(5)} pts  ` +
      `${g.season.wins}W ${g.season.top10s}T10  ${g.season.cutsMade}/${g.season.events} cuts  ` +
      `avg ${seasonScoringAverage(g).toFixed(2)}  $${(g.season.earnings / 1e6).toFixed(2)}m  ability ${g.hidden.currentAbility}`,
  );
}

console.log('\n--- World ranking top 8 ---');
for (const g of worldRanking(universe).slice(0, 8)) {
  console.log(`  ${String(g.worldRank).padStart(2)}. ${g.name.padEnd(22)} ${g.rankingPoints.toFixed(1)} pts  form ${g.hidden.form.toFixed(1)}`);
}

console.log('\n--- Unique winners: ' + new Set(winners).size + ' of 20 events ---');

const leader = pointsStandings(universe)[0];
console.log('\n--- Course fit, points leader ---');
for (const course of Object.values(COURSE_BY_ID)) {
  const fit = courseFit(leader, course);
  console.log(`  ${course.name.padEnd(24)} ${fit.score}/100  ${fitVerdict(fit)}  (edge ${fit.edge >= 0 ? '+' : ''}${fit.edge})`);
}

console.log('\n--- Statistical leaders ---');
const qualified = universe.golfers.filter((g) => g.season.rounds >= 20);
const stat = (label: string, pick: (g: typeof qualified[0]) => number, format: (v: number) => string, desc = true) => {
  const sorted = [...qualified].sort((a, b) => (desc ? pick(b) - pick(a) : pick(a) - pick(b)));
  console.log(`  ${label.padEnd(22)} ${sorted[0].name.padEnd(22)} ${format(pick(sorted[0]))}`);
};
stat('Scoring average', (g) => seasonScoringAverage(g), (v) => v.toFixed(2), false);
stat('Driving distance', (g) => g.career.driveDistanceTotal / Math.max(1, g.career.drives), (v) => v.toFixed(1) + ' yd');
stat('Driving accuracy', (g) => g.career.fairwaysHit / Math.max(1, g.career.fairwayAttempts), (v) => (v * 100).toFixed(1) + '%');
stat('Greens in regulation', (g) => g.career.greensHit / Math.max(1, g.career.greenAttempts), (v) => (v * 100).toFixed(1) + '%');
stat('Scrambling', (g) => g.career.scrambleSaves / Math.max(1, g.career.scrambleAttempts), (v) => (v * 100).toFixed(1) + '%');
stat('Putts per round', (g) => (g.career.putts / Math.max(1, g.career.puttHoles)) * 18, (v) => v.toFixed(2), false);
stat('Birdie %', (g) => g.career.birdies / Math.max(1, g.career.holes), (v) => (v * 100).toFixed(1) + '%');
stat('Bogey %', (g) => g.career.bogeys / Math.max(1, g.career.holes), (v) => (v * 100).toFixed(1) + '%', false);

console.log('\n--- News wire (most recent 6) ---');
for (const item of universe.news.slice(0, 6)) {
  console.log(`  [${item.kind}] ${item.headline}`);
  console.log(`      ${item.body.slice(0, 150)}${item.body.length > 150 ? '…' : ''}`);
}

const summary = advanceSeason(universe);
console.log(`\n--- ${summary.season} season complete ---`);
console.log(`  Player of the Year: ${summary.championName}`);
console.log(`  Majors: ${summary.majorWinners.map((m) => `${m.name} (${m.tournament})`).join(', ')}`);
console.log(`  Low scoring average: ${summary.lowScoringAverage.name} ${summary.lowScoringAverage.average.toFixed(2)}`);
console.log('\n--- Biggest movers in development ---');
for (const note of universe.developmentNotes.slice(0, 10)) {
  console.log(`  ${note.delta >= 0 ? '+' : ''}${note.delta}  ${note.headline} — ${note.detail}`);
}
console.log(`\nField size after rollover: ${universe.golfers.length}; season is now ${universe.season}`);
