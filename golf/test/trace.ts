import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';

const tour = createTour();
const courseId = process.argv[2] ?? 'desert';
const holeNumber = Number(process.argv[3] ?? 11);
const course = COURSE_BY_ID[courseId];
const hole = holeGeometry(course, holeNumber);
const conditions = conditionsFor(calmWeather(course), 'trace');

console.log(`${course.name} #${holeNumber} — par ${hole.spec.par}, ${hole.spec.yards} yards, ${hole.spec.name}`);
for (const name of ['Marcus Vandehey', 'Lars Öhlund', 'Hugo Marchetti']) {
  const golfer = tour.find((g) => g.name === name)!;
  golfer.fatigue = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rng = createRng(`trace:${golfer.id}:${attempt}`);
    const outcome = playHole({ hole, golfer, conditions, rng, pressure: 0 });
    console.log(`\n${golfer.name} — ${outcome.strokes} (${outcome.toPar >= 0 ? '+' : ''}${outcome.toPar}), ${outcome.putts} putts`);
    for (const shot of outcome.shots) {
      console.log(
        `  ${shot.stroke}. ${shot.club.padEnd(3)} ${String(shot.shotType).padEnd(9)} from ${shot.lieBefore.padEnd(15)} ` +
          `${shot.toPinBefore.toFixed(0)}yd → ${shot.distance.toFixed(0)}yd, ${shot.toPinAfter.toFixed(0)}yd left in ${shot.lieAfter.padEnd(15)} ${shot.quality}${shot.penalty ? ' PENALTY' : ''} ${shot.note}`,
      );
    }
  }
}
