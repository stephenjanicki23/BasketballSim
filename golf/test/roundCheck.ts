/**
 * Round-level calibration: do fifty golfers, playing the three courses through
 * the real shot engine, produce a believable leaderboard?
 */

import { createTour } from '../src/data/golfers';
import { COURSES } from '../src/data/courses';
import { holeGeometry } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { calmWeather, conditionsFor, generateWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';

const tour = createTour();
const fast = process.argv.includes('--fast');

for (const course of COURSES) {
  const weather = process.argv.includes('--calm') ? calmWeather(course) : generateWeather(course, createRng(`w:${course.id}`));
  const conditions = conditionsFor(weather, `c:${course.id}`);
  const start = performance.now();
  const rows: { name: string; score: number; putts: number; gir: number; fir: number; drive: number; pen: number }[] = [];
  let shotCount = 0;
  const tally = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, worse: 0 };
  let threePutts = 0;
  let firstPuttFeet = 0;
  let firstPutts = 0;
  let scrambleTries = 0;
  let scrambleSaves = 0;
  const holeStrokes = new Array(19).fill(0);

  for (const golfer of tour) {
    const rng = createRng(`round:${course.id}:${golfer.id}`);
    golfer.fatigue = 0;
    let score = 0;
    let putts = 0;
    let gir = 0;
    let fir = 0;
    let firAttempts = 0;
    let drive = 0;
    let drives = 0;
    let penalties = 0;
    for (let h = 1; h <= 18; h++) {
      const hole = holeGeometry(course, h);
      const outcome = playHole({ hole, golfer, conditions, rng, pressure: 0.15, fast, shotSeed: h * 7 });
      score += outcome.strokes;
      putts += outcome.putts;
      penalties += outcome.penalties;
      if (outcome.gir) gir++;
      if (outcome.fairwayHit !== null) {
        firAttempts++;
        if (outcome.fairwayHit) fir++;
      }
      if (outcome.driveDistance !== null) {
        drive += outcome.driveDistance;
        drives++;
      }
      shotCount += outcome.shots.length;
      holeStrokes[h] += outcome.strokes;
      if (outcome.toPar <= -2) tally.eagle++;
      else if (outcome.toPar === -1) tally.birdie++;
      else if (outcome.toPar === 0) tally.par++;
      else if (outcome.toPar === 1) tally.bogey++;
      else if (outcome.toPar === 2) tally.double++;
      else tally.worse++;
      if (outcome.putts >= 3) threePutts++;
      const firstPutt = outcome.shots.find((sh) => sh.shotType === 'putt');
      if (firstPutt) {
        firstPuttFeet += firstPutt.toPinBefore * 3;
        firstPutts++;
      }
      if (outcome.scrambled !== null) {
        scrambleTries++;
        if (outcome.scrambled) scrambleSaves++;
      }
    }
    rows.push({ name: golfer.name, score, putts, gir, fir: firAttempts ? fir / firAttempts : 0, drive: drives ? drive / drives : 0, pen: penalties });
  }

  const ms = performance.now() - start;
  rows.sort((a, b) => a.score - b.score);
  const avg = rows.reduce((s, r) => s + r.score, 0) / rows.length;
  console.log(`\n=== ${course.name} (par ${course.par}) — ${weather.label}, ${Math.round(weather.temperature)}°F, wind ${Math.round(weather.windSpeed)} mph ===`);
  console.log(`  field average ${avg.toFixed(2)} (${(avg - course.par >= 0 ? '+' : '')}${(avg - course.par).toFixed(2)})  low ${rows[0].score}  high ${rows[rows.length - 1].score}`);
  console.log(`  ${(ms / 1000).toFixed(2)}s for ${tour.length} rounds (${(ms / tour.length).toFixed(0)} ms/round, ${shotCount} shots)`);
  console.log('  leaders:');
  for (const r of rows.slice(0, 5)) {
    console.log(
      `    ${r.name.padEnd(22)} ${String(r.score).padStart(3)} (${r.score - course.par >= 0 ? '+' : ''}${r.score - course.par})  ` +
        `putts ${r.putts}  GIR ${r.gir}/18  FIR ${(r.fir * 100).toFixed(0)}%  drive ${r.drive.toFixed(0)}  pen ${r.pen}`,
    );
  }
  console.log('  tail:');
  for (const r of rows.slice(-3)) {
    console.log(
      `    ${r.name.padEnd(22)} ${String(r.score).padStart(3)} (${r.score - course.par >= 0 ? '+' : ''}${r.score - course.par})  ` +
        `putts ${r.putts}  GIR ${r.gir}/18  FIR ${(r.fir * 100).toFixed(0)}%  drive ${r.drive.toFixed(0)}  pen ${r.pen}`,
    );
  }
  const fieldPutts = rows.reduce((s, r) => s + r.putts, 0) / rows.length;
  const fieldGir = rows.reduce((s, r) => s + r.gir, 0) / rows.length;
  const fieldFir = rows.reduce((s, r) => s + r.fir, 0) / rows.length;
  const fieldDrive = rows.reduce((s, r) => s + r.drive, 0) / rows.length;
  const fieldPen = rows.reduce((s, r) => s + r.pen, 0) / rows.length;
  const holes = tour.length * 18;
  console.log(
    `  scoring: eagle ${(tally.eagle / holes * 100).toFixed(1)}%  birdie ${(tally.birdie / holes * 100).toFixed(1)}%  ` +
      `par ${(tally.par / holes * 100).toFixed(1)}%  bogey ${(tally.bogey / holes * 100).toFixed(1)}%  ` +
      `double ${(tally.double / holes * 100).toFixed(1)}%  worse ${(tally.worse / holes * 100).toFixed(1)}%`,
  );
  console.log(
    `  putting: 3-putts ${(threePutts / tour.length).toFixed(2)}/round  first putt ${(firstPuttFeet / Math.max(1, firstPutts)).toFixed(0)} ft  ` +
      `scrambling ${(scrambleSaves / Math.max(1, scrambleTries) * 100).toFixed(0)}%`,
  );
  const par = (n: number) => course.holes.find((h) => h.number === n)!.par;
  const worst = holeStrokes
    .map((v, i) => ({ hole: i, avg: v / tour.length }))
    .slice(1)
    .map((w) => ({ ...w, over: w.avg - par(w.hole) }))
    .sort((a, b) => b.over - a.over);
  const byPar = [3, 4, 5].map((p) => {
    const holes = course.holes.filter((h) => h.par === p);
    const total = holes.reduce((sum, h) => sum + holeStrokes[h.number] / tour.length, 0);
    return `par ${p} ${(total / holes.length).toFixed(2)}`;
  });
  console.log('  by par: ' + byPar.join('  '));
  console.log('  hardest: ' + worst.slice(0, 4).map((w) => `#${w.hole} (${par(w.hole)}) ${w.over >= 0 ? '+' : ''}${w.over.toFixed(2)}`).join('  '));
  console.log('  easiest: ' + worst.slice(-3).map((w) => `#${w.hole} (${par(w.hole)}) ${w.over >= 0 ? '+' : ''}${w.over.toFixed(2)}`).join('  '));
  console.log(`  field: putts ${fieldPutts.toFixed(1)}  GIR ${(fieldGir / 18 * 100).toFixed(0)}%  FIR ${(fieldFir * 100).toFixed(0)}%  drive ${fieldDrive.toFixed(0)} yd  penalties ${fieldPen.toFixed(2)}`);
}
