/** The numbers quoted in the README, recomputed. */
import { createTour } from '../src/data/golfers';
import { COURSES } from '../src/data/courses';
import { bagFor } from '../src/simulation/golferEngine';
import { makeProbability } from '../src/simulation/puttingEngine';

const tour = createTour();
const totals = tour.map((g) => bagFor(g).D.total).sort((a, b) => a - b);
console.log(`driver totals: ${totals[0].toFixed(0)}–${totals[49].toFixed(0)}, field ${(totals.reduce((a, b) => a + b, 0) / 50).toFixed(0)}`);
const acc = tour.map((g) => g.ratings.driverAccuracy).sort((a, b) => a - b);
console.log(`driver accuracy ratings: ${acc[0]}–${acc[49]}`);
console.log('make %: ' + [3, 10, 20, 30].map((f) => `${f}ft ${(makeProbability(f, 76) * 100).toFixed(0)}`).join(' / '));
for (const course of COURSES) {
  const widths = course.holes.filter((h) => h.par !== 3).map((h) => h.fairwayWidth * 2).sort((a, b) => a - b);
  const greens = course.holes.map((h) => h.greenSize * 2).sort((a, b) => a - b);
  console.log(`${course.name}: par ${course.par}, ${course.yards} yd, fairways ${widths[0]}–${widths[widths.length - 1]} yd, greens ${greens[0]}–${greens[greens.length - 1]} yd`);
}
