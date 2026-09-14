/**
 * What a score is worth. Plays the benchmark field the round-complete panel
 * uses, so the numbers behind "you would have finished fourth" can be checked.
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { conditionsFor, generateWeather, calmWeather, describeWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import { benchmarkRound } from '../src/simulation/benchmark';

const tour = createTour();
for (const id of ['concord', 'coastal']) {
  const course = COURSE_BY_ID[id];
  for (const [label, weather] of [['calm', calmWeather(course)], ['a real day', generateWeather(course, createRng(`b:${id}`))]] as const) {
    const start = performance.now();
    const conditions = conditionsFor(weather, `bench:${id}:${label}`);
    const result = benchmarkRound(course, conditions, 1, tour, 65);
    console.log(
      `${course.name} (${label}: ${describeWeather(weather)}) — ${result.sample} golfers, average ` +
        `${result.average.toFixed(1)}, best ${result.best}, a 65 finishes ${result.position} of ${result.sample + 1} ` +
        `(${(performance.now() - start).toFixed(0)} ms)`,
    );
  }
}
