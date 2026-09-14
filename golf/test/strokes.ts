/**
 * Where the strokes actually go, player by player.
 *
 * The field average can be right while the spread across it is wrong, so this
 * takes a handful of players from the top, middle and bottom of the tour and
 * plays them through the same engine, reporting the parts of the game a
 * scorecard hides: greens, fairways, putts, three-putts, scrambling, penalties.
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry, pinForRound, withPin } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { conditionsFor, generateWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import { dailyTouch } from '../src/simulation/golferEngine';

const tour = createTour().sort((a, b) => b.hidden.currentAbility - a.hidden.currentAbility);
const course = COURSE_BY_ID[process.argv[2] ?? 'woodland'];
const ROUNDS = Number(process.argv[3] ?? 16);
const sample = [0, 20, 60, 110, 155].map((i) => tour[i]).concat(tour.filter((g) => g.name === 'Tevita Fonoti'));

console.log(`${course.name}, ${ROUNDS} rounds each`);
console.log('  name                  abil  score   gir   fir  putts 3putt scram  pen  bogey+ prox');
for (const golfer of sample) {
  let strokes = 0, gir = 0, fir = 0, firTries = 0, putts = 0, three = 0, pen = 0, bogeys = 0, saves = 0, tries = 0, prox = 0, proxN = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const rng = createRng(`who:${golfer.id}:${r}`);
    const touch = dailyTouch(golfer, rng.fork('touch'));
    const weather = generateWeather(course, createRng(`whow:${r}`));
    const conditions = conditionsFor(weather, `who:${r}`);
    golfer.fatigue = 0;
    for (let h = 1; h <= 18; h++) {
      const base = holeGeometry(course, h);
      const hole = withPin(base, pinForRound(base, (r % 4) + 1));
      const out = playHole({ hole, golfer, conditions, rng, pressure: 0.15, fast: true, touch, shotSeed: h * 7 });
      strokes += out.strokes; putts += out.putts; pen += out.penalties;
      if (out.gir) gir++;
      if (out.fairwayHit !== null) { firTries++; if (out.fairwayHit) fir++; }
      if (out.putts >= 3) three++;
      if (out.toPar >= 1) bogeys++;
      if (out.scrambled !== null) { tries++; if (out.scrambled) saves++; }
      const firstPutt = out.shots.find((s) => s.shotType === 'putt');
      if (firstPutt) { prox += firstPutt.toPinBefore * 3; proxN++; }
    }
  }
  const n = ROUNDS;
  console.log(
    `  ${golfer.name.padEnd(22)}${String(golfer.hidden.currentAbility).padStart(3)}  ` +
    `${(strokes / n).toFixed(2)}  ${((gir / (n * 18)) * 100).toFixed(0)}%  ${((fir / firTries) * 100).toFixed(0)}%  ` +
    `${(putts / n).toFixed(1)}  ${(three / n).toFixed(2)}  ${((saves / tries) * 100).toFixed(0)}%  ` +
    `${(pen / n).toFixed(2)}  ${(bogeys / n).toFixed(1)}  ${(prox / proxN).toFixed(0)}ft`,
  );
}
