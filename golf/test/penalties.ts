import { createTour } from '../src/data/golfers';
import { COURSES } from '../src/data/courses';
import { holeGeometry } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';

const tour = createTour();
for (const course of COURSES) {
  const conditions = conditionsFor(calmWeather(course), 'pen');
  const byHole = new Array(19).fill(0);
  let total = 0;
  for (const golfer of tour) {
    const rng = createRng(`pen:${course.id}:${golfer.id}`);
    golfer.fatigue = 0;
    for (let h = 1; h <= 18; h++) {
      const outcome = playHole({ hole: holeGeometry(course, h), golfer, conditions, rng, pressure: 0 });
      byHole[h] += outcome.penalties;
      total += outcome.penalties;
    }
  }
  const worst = byHole.map((v, i) => ({ hole: i, rate: v / tour.length })).slice(1).sort((a, b) => b.rate - a.rate);
  console.log(`${course.name}: ${(total / tour.length).toFixed(2)} penalties/round`);
  console.log('  ' + worst.slice(0, 6).map((w) => `#${w.hole} ${(w.rate * 100).toFixed(0)}%`).join('  '));
}
