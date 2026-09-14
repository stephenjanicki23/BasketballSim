/**
 * Win concentration over several seasons. A tour where one player wins half the
 * events is not a tour; one where the world number one never wins is not golf.
 */
import { advanceSeason, createUniverse, seasonComplete, simulateTournament, currentTournament } from '../src/simulation/seasonEngine';

const universe = createUniverse('concentration');
const wins = new Map<string, number>();
const SEASONS = Number(process.argv[2] ?? 3);
const scores: number[] = [];

for (let season = 0; season < SEASONS; season++) {
  while (!seasonComplete(universe)) {
    const event = currentTournament(universe)!;
    void event;
    const done = simulateTournament(universe, { fast: true })!;
    const winner = universe.golfers.find((g) => g.id === done.winnerId);
    if (winner) wins.set(winner.name, (wins.get(winner.name) ?? 0) + 1);
    scores.push(done.leaderboard[0].toPar);
  }
  advanceSeason(universe);
}

const total = SEASONS * 20;
const sorted = [...wins.entries()].sort((a, b) => b[1] - a[1]);
console.log(`${total} events over ${SEASONS} seasons — ${wins.size} different winners`);
console.log('  ' + sorted.slice(0, 10).map(([name, count]) => `${name} ${count}`).join(', '));
const top = sorted[0][1];
console.log(`  most wins by one player: ${top} (${((top / total) * 100).toFixed(0)}% of events)`);
console.log(`  winning score: best ${Math.min(...scores)}, worst ${Math.max(...scores)}, average ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}`);
