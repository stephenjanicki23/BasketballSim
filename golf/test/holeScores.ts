/**
 * What each hole on a course actually costs.
 *
 * The venue check reports the three hardest and the three easiest; this reports
 * every hole, so a change to one hole's geometry can be weighed before and after
 * under identical seeds. It is the check that says whether a retrace made a hole
 * more like the photograph or merely easier.
 *
 *   node tools/tsrun.mjs test/holeScores.ts [courseId]
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import { buildHole } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';

const id = process.argv[2] ?? 'ranch@gold';
const course = COURSE_BY_ID[id];
if (!course) throw new Error(`no course ${id}`);
const tour = createTour();
const conditions = conditionsFor(calmWeather(course), 'holeScores');

console.log(`\n${course.name} — the field over every hole, four times each, calm\n`);
for (const spec of course.holes) {
  const hole = buildHole(course, spec);
  let total = 0;
  let gir = 0;
  let fairways = 0;
  let teeShots = 0;
  let sample = 0;
  for (const golfer of tour) {
    for (let round = 0; round < 4; round++) {
      const rng = createRng(`holeScores:${spec.number}:${golfer.id}:${round}`);
      const out = playHole({ hole, golfer, conditions, rng, pressure: 0.15, fast: true, shotSeed: spec.number * 7 + round });
      total += out.strokes;
      if (out.gir) gir++;
      if (out.fairwayHit !== null) {
        teeShots++;
        if (out.fairwayHit) fairways++;
      }
      sample++;
    }
  }
  const avg = total / sample;
  const toPar = avg - spec.par;
  const fir = teeShots > 0 ? `${((fairways / teeShots) * 100).toFixed(0)}%` : '—';
  console.log(
    `  ${String(spec.number).padStart(2)}  par ${spec.par}  ${String(spec.yards).padStart(3)}y   ` +
      `avg ${avg.toFixed(2)}  ${toPar >= 0 ? '+' : ''}${toPar.toFixed(2)}   ` +
      `GIR ${((gir / sample) * 100).toFixed(0).padStart(3)}%   FIR ${fir.padStart(4)}`,
  );
}
