/**
 * Is the played game easier than the simulated one?
 *
 * The same golfer, the same course, the same conditions, three ways round:
 * the tournament AI as it actually plays (fast candidate set), the AI with the
 * full candidate set, and a player who accepts the caddie's club, the caddie's
 * aim and the caddie's putt every time. If the third column is lower than the
 * first, the game is easier in the hand than on the leaderboard, and by how much.
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry, pinForRound, withPin } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { calmWeather, conditionsFor, generateWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import { choosePuttIntent } from '../src/simulation/puttingEngine';
import {
  createSession, currentPlan, hit, nextHole, puttWith, sessionContext, settle, roundTotal,
} from '../src/game/session';
import type { Conditions, Golfer } from '../src/simulation/types';

const tour = createTour();
const name = process.argv[2] ?? 'Luca Brennan';
const courseId = process.argv[3] ?? 'concord';
const ROUNDS = Number(process.argv[4] ?? 40);
const golfer = tour.find((g) => g.name === name)!;
const course = COURSE_BY_ID[courseId];

interface RoundLine { strokes: number; gir: number; putts: number }

function aiRound(round: number, conditions: Conditions, fast: boolean): RoundLine {
  const rng = createRng(`ai:${fast}:${round}`);
  golfer.fatigue = 0;
  let strokes = 0;
  let gir = 0;
  let putts = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = withPin(holeGeometry(course, h), pinForRound(holeGeometry(course, h), ((round - 1) % 4) + 1));
    const outcome = playHole({ hole, golfer, conditions, rng, pressure: 0.1, fast, shotSeed: h * 7 });
    strokes += outcome.strokes;
    putts += outcome.putts;
    if (outcome.gir) gir++;
  }
  return { strokes, gir, putts };
}

/** A player who never overrules the caddie. */
function caddieRound(round: number, conditions: Conditions): RoundLine {
  golfer.fatigue = 0;
  let session = createSession({
    mode: 'practice', golfer, courseId, round: ((round - 1) % 4) + 1, conditions, seed: `caddie:${round}`,
  });
  for (let hole = 0; hole < 18; hole++) {
    for (let shot = 0; shot < 20; shot++) {
      const view = currentPlan(session, golfer);
      if (view.kind === 'putt') {
        const { intent } = choosePuttIntent(sessionContext(session, golfer), session.situation, view.decision);
        session = settle(puttWith(session, golfer, intent).session, golfer);
      } else {
        session = settle(hit(session, golfer).session, golfer);
      }
      if (session.status === 'holeComplete' || session.status === 'roundComplete') break;
    }
    if (hole < 17) session = nextHole(session, golfer);
  }
  return { strokes: roundTotal(session), gir: session.stats.girHit, putts: session.stats.putts };
}

for (const [label, weather] of [['calm', calmWeather(course)], ['weather', generateWeather(course, createRng(`w:${courseId}`))]] as const) {
  const conditions = conditionsFor(weather, `compare:${courseId}:${label}`);
  const rows: Record<string, RoundLine[]> = { 'AI (tournament)': [], 'AI (full search)': [], 'Caddie-following player': [] };
  for (let round = 1; round <= ROUNDS; round++) {
    rows['AI (tournament)'].push(aiRound(round, conditions, true));
    rows['AI (full search)'].push(aiRound(round, conditions, false));
    rows['Caddie-following player'].push(caddieRound(round, conditions));
  }
  console.log(`\n${course.name} — ${golfer.name} (ability ${golfer.hidden.currentAbility}), ${label}, ${ROUNDS} rounds`);
  for (const [label2, lines] of Object.entries(rows)) {
    const scores = lines.map((l) => l.strokes);
    const sorted = [...scores].sort((a, b) => a - b);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sd = Math.sqrt(scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length);
    const gir = lines.reduce((sum, l) => sum + l.gir, 0) / lines.length;
    const putts = lines.reduce((sum, l) => sum + l.putts, 0) / lines.length;
    const bestGir = Math.max(...lines.map((l) => l.gir));
    console.log(
      `  ${label2.padEnd(24)} mean ${mean.toFixed(2)} (${mean - course.par >= 0 ? '+' : ''}${(mean - course.par).toFixed(2)})  ` +
        `sd ${sd.toFixed(2)}  best ${sorted[0]}  worst ${sorted[sorted.length - 1]}  ` +
        `GIR ${gir.toFixed(1)}/18 (best ${bestGir})  putts ${putts.toFixed(1)}  ` +
        `under par ${Math.round((scores.filter((s) => s < course.par).length / scores.length) * 100)}%`,
    );
  }
}
