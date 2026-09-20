/**
 * Regression tests for the simulation.
 *
 * These are not unit tests of arithmetic — they are the assertions that stop the
 * game quietly stopping being golf. Driving distances, fairways hit, make
 * percentages, scoring averages and win concentration all have a range that a
 * real tour lives in, and every one of them is cheap to check and expensive to
 * notice by eye.
 *
 *   node tools/tsrun.mjs test/regression.ts
 */

import assert from 'node:assert/strict';

import { COURSES, COURSE_BY_ID } from '../src/data/courses';
import { traceHole } from '../src/data/courses/trace';
import { SCHEDULE } from '../src/data/tournaments';
import { createTour, TOUR_SIZE } from '../src/data/golfers';
import { holeGeometry, onGreen, pinForRound, terrainAt, withPin } from '../src/simulation/courseEngine';
import { bagFor, dailyTouch, driverCarry, groupScores } from '../src/simulation/golferEngine';
import { calmWeather, conditionsFor, windComponents } from '../src/simulation/weatherEngine';
import { choosePuttIntent, type PuttSituation } from '../src/simulation/puttingEngine';
import { planShot, reachTable, resolveShot, sigmaForShare, type ShotContext } from '../src/simulation/shotEngine';
import {
  type PuttIntentId, makeProbability, puttDecision, resolvePutt,
} from '../src/simulation/puttingEngine';
import { playHole } from '../src/simulation/holeEngine';
import { createRng } from '../src/simulation/rng';
import { add, dist, pointAlongPolyline, polylineLength, scale, vec } from '../src/simulation/geometry';
import { courseFit } from '../src/simulation/courseFit';
import { sampleFlight } from '../src/components/render/flight';
import type { FlightAnimation } from '../src/game/session';
import {
  advanceSeason, createUniverse, currentTournament, seasonComplete, simulateNextRound,
  simulateTournament,
} from '../src/simulation/seasonEngine';
import {
  conditionsForSession, createSession, hit, nextHole, puttWith, settle, standingFor, toPlayerRound,
} from '../src/game/session';
import { serializeUniverse } from '../src/simulation/persistence';
import { buildLeaderboard, payout, recordRound } from '../src/simulation/tournamentEngine';
import type { Golfer } from '../src/simulation/types';

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

function between(value: number, low: number, high: number, what: string): void {
  assert.ok(value >= low && value <= high, `${what} was ${value.toFixed(3)}, expected ${low}–${high}`);
}

const tour = createTour();
const byName = (name: string): Golfer => {
  const golfer = tour.find((g) => g.name === name);
  assert.ok(golfer, `no golfer called ${name}`);
  return golfer;
};

// ---------------------------------------------------------------------------
console.log('\nThe tour');
// ---------------------------------------------------------------------------

test('a full field of golfers, all distinct', () => {
  assert.equal(tour.length, TOUR_SIZE);
  assert.equal(new Set(tour.map((g) => g.id)).size, TOUR_SIZE);
  assert.equal(new Set(tour.map((g) => g.name)).size, TOUR_SIZE);
  assert.ok(tour.every((g) => !/^player\s*\d+$/i.test(g.name)), 'placeholder names');
});

test('every golfer is described, not just rated', () => {
  for (const golfer of tour) {
    assert.ok(golfer.personality.length > 20, `${golfer.name} has no personality`);
    assert.ok(golfer.playingStyle.length > 20, `${golfer.name} has no playing style`);
    assert.ok(golfer.preferredConditions.length > 10, `${golfer.name} has no preferred conditions`);
    assert.ok(golfer.weakness.length > 10, `${golfer.name} has no weakness`);
  }
  assert.ok(new Set(tour.map((g) => g.country)).size >= 15, 'not enough nationalities');
  assert.ok(new Set(tour.map((g) => g.archetype)).size >= 10, 'not enough archetypes');
});

test('golfers are lopsided, not uniformly good', () => {
  // The spread of a golfer's own group scores should be comparable with the
  // spread of ability across the field. If it is not, everybody is the same
  // player at different volumes and the best one wins everything.
  const internal =
    tour.reduce((sum, golfer) => {
      const scores = Object.values(groupScores(golfer));
      return sum + (Math.max(...scores) - Math.min(...scores));
    }, 0) / tour.length;
  const abilities = tour.map((g) => g.hidden.currentAbility);
  const external = Math.max(...abilities) - Math.min(...abilities);
  between(internal, 12, 45, 'average spread within a golfer');
  between(external, 8, 24, 'ability spread across the field');
  assert.ok(internal > external * 0.8, `players are too uniform (${internal.toFixed(1)} vs ${external})`);
});

test('signature ratings survive generation', () => {
  assert.ok(byName('Jae-won Park').ratings.putting >= 95, 'the elite putter is not an elite putter');
  assert.ok(byName('Lars Öhlund').ratings.driverDistance >= 95, 'the power player is not long');
  assert.ok(byName('Kaito Shirakawa').ratings.driverAccuracy >= 94, 'the precision player is not straight');
  assert.ok(byName('Rory Ballantyne').ratings.wind >= 95, 'the wind specialist cannot play in wind');
  assert.ok(byName('Diego Sandoval').ratings.putting <= 70, 'the ball striker can putt after all');
});

test('driver distances span a tour-realistic range', () => {
  const totals = tour.map((g) => bagFor(g).D.total).sort((a, b) => a - b);
  between(totals[0], 240, 275, 'shortest hitter');
  between(totals[totals.length - 1], 300, 330, 'longest hitter');
  for (const golfer of tour) {
    const bag = bagFor(golfer);
    assert.ok(bag.D.total > bag['3W'].total, `${golfer.name} hits 3 wood past driver`);
    assert.ok(bag['7i'].total > bag['8i'].total, `${golfer.name}'s irons are out of order`);
    between(bag['7i'].total, 140, 205, `${golfer.name} 7 iron`);
    between(bag.SW.total, 80, 125, `${golfer.name} sand wedge`);
  }
});

// ---------------------------------------------------------------------------
console.log('\nThe courses');
// ---------------------------------------------------------------------------

test('twenty courses, eighteen holes each', () => {
  // Six are authored hole by hole — the Concord, The Ranch and Pebble Beach off
  // their own overheads and cards — and fourteen are built from a design brief.
  // Everything below applies to all twenty, which is the point of holding a
  // generated course to the same rules as a drawn one.
  assert.equal(COURSES.length, 20);
  for (const course of COURSES) {
    assert.equal(course.holes.length, 18);
    assert.equal(new Set(course.holes.map((h) => h.index)).size, 18, `${course.name} stroke indexes`);
    assert.equal(new Set(course.holes.map((h) => h.number)).size, 18, `${course.name} hole numbers`);
    const pars = course.holes.map((h) => h.par);
    assert.ok(pars.includes(3) && pars.includes(4) && pars.includes(5), `${course.name} lacks hole variety`);
    between(course.par, 70, 73, `${course.name} par`);
    between(course.yards, 5600, 7600, `${course.name} yardage`);
    between(course.altitude, 0, 8000, `${course.name} altitude`);
  }
  // A season visits every venue exactly once: twenty weeks, twenty golf courses.
  // The schedule names a venue by its base id — `concord`, not `concord@black` —
  // because which set of markers a tournament is played off is the event's
  // business and not the golf course's.
  const hosted = SCHEDULE.map((event) => event.courseId);
  assert.equal(new Set(hosted).size, 20, 'every event should be at a different course');
  for (const course of COURSES) {
    assert.ok(hosted.includes(course.baseId ?? course.id), `${course.name} is not on the schedule`);
  }
});

test('tracing an image puts the hole where the card says it is', () => {
  // A hole traced diagonally across an image, y growing downward, with a bend.
  const traced = {
    tee: [100, 900] as [number, number],
    pin: [500, 100] as [number, number],
    playLine: [[100, 900], [300, 500], [500, 100]] as [number, number][],
    green: [[480, 80], [520, 80], [520, 120], [480, 120]] as [number, number][],
    bunkers: [{ shape: [[300, 520], [330, 520], [330, 550], [300, 550]] as [number, number][] }],
  };
  const spec = traceHole(traced, { number: 1, name: 'Traced', par: 4, yards: 400, index: 1, bearing: 90 });

  assert.equal(spec.yards, 400);
  const line = spec.centreline!;
  // The scale comes from the card: the played line is 400 yards, whatever the
  // image's pixels say.
  between(polylineLength(line), 399.5, 400.5, 'traced play line');
  // The tee sits at the origin and the green straight up the y-axis, which is
  // what the wind model and the camera both assume.
  between(dist(line[0], vec(0, 0)), 0, 0.01, 'tee at the origin');
  between(Math.abs(line[line.length - 1].x), 0, 0.01, 'pin on the axis');
  between(line[line.length - 1].y, 393, 400, 'pin up the axis');

  // A feature traced beside the corner lands beside the corner, at the same scale.
  const green = spec.greenShape!;
  between(green.length, 4, 4, 'green points kept');
  const hole = holeGeometry(
    { ...COURSE_BY_ID.woodland, id: 'traced-test', holes: [{ ...spec, index: 1 }] },
    1,
  );
  assert.ok(onGreen(hole, hole.green.centre), 'the traced green is a green');
  between(hole.centerlineLength, 399, 401, 'built centreline');
  assert.equal(hole.bunkers.length, 1);
  between(dist(hole.bunkers[0].shape.centre, hole.centerline[1]), 0, 30, 'bunker near the corner it was traced at');
});

test('every hole builds with a pin on the green', () => {
  for (const course of COURSES) {
    for (const spec of course.holes) {
      const hole = holeGeometry(course, spec.number);
      assert.ok(onGreen(hole, hole.pin), `${course.name} #${spec.number} pin is off the green`);
      assert.equal(terrainAt(hole, hole.tee, { onTee: true }).lie, 'tee');
      for (let round = 1; round <= 4; round++) {
        assert.ok(onGreen(hole, pinForRound(hole, round)), `${course.name} #${spec.number} round ${round} pin`);
      }
    }
  }
});

test('no hazard swallows a green', () => {
  for (const course of COURSES) {
    for (const spec of course.holes) {
      const hole = holeGeometry(course, spec.number);
      let wet = 0;
      const samples = 240;
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        const point = add(hole.greenCenter, vec(Math.cos(angle) * spec.greenSize * 1.25, Math.sin(angle) * spec.greenSize * 1.25));
        if (terrainAt(hole, point).lie === 'water') wet++;
      }
      assert.ok(wet / samples < 0.3, `${course.name} #${spec.number} is ${((wet / samples) * 100).toFixed(0)}% water around the green`);
    }
  }
});

test('the three courses ask different questions', () => {
  const [coastal, desert, woodland] = COURSES;
  assert.ok(desert.fit.distance > woodland.fit.distance * 2, 'the desert should reward length');
  assert.ok(woodland.fit.accuracy > desert.fit.accuracy * 2, 'the parkland should reward accuracy');
  assert.ok(coastal.fit.wind > desert.fit.wind * 2, 'the links should reward wind play');
  const wind = byName('Rory Ballantyne');
  const bomber = byName('Kwame Asante');
  assert.ok(courseFit(wind, coastal).score > courseFit(wind, desert).score, 'the wind player should prefer the links');
  assert.ok(courseFit(bomber, desert).score > courseFit(bomber, woodland).score, 'the bomber should prefer the desert');
});

// ---------------------------------------------------------------------------
console.log('\nThe shot engine');
// ---------------------------------------------------------------------------

const desert = COURSE_BY_ID.desert;
const conditions = conditionsFor(calmWeather(desert), 'regression');
const rng = createRng('regression');

function context(golfer: Golfer, holeNumber: number, ball: { x: number; y: number }, lie: ShotContext['lie'], onTee = false): ShotContext {
  return { hole: holeGeometry(desert, holeNumber), golfer, ball, lie, onTee, conditions, shotIndex: 0, pressure: 0 };
}

test('dispersion is elliptical, and driver is wider than wedge', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 1);
  const driver = planShot(context(golfer, 1, hole.tee, 'tee', true), {
    club: 'D', shotType: 'full', target: add(hole.tee, scale(vec(0, 1), 290)),
  });
  const wedge = planShot(context(golfer, 1, add(hole.pin, scale(vec(0, -1), 100)), 'fairway'), {
    club: 'GW', shotType: 'full', target: hole.pin,
  });
  assert.ok(driver.sigmaLat > driver.sigmaLong * 1.6, 'driver dispersion is not elliptical');
  assert.ok(driver.sigmaLat > wedge.sigmaLat * 2.5, 'driver is not wider than a wedge');
  assert.ok(wedge.sigmaLong > 1, 'wedges should still have distance variance');
});

test('skill tightens dispersion', () => {
  const hole = holeGeometry(desert, 1);
  const straight = byName('Kaito Shirakawa');
  const wild = byName('Tevita Fonoti');
  const plan = (golfer: Golfer) =>
    planShot(context(golfer, 1, hole.tee, 'tee', true), { club: 'D', shotType: 'full', target: add(hole.tee, scale(vec(0, 1), 280)) });
  assert.ok(plan(straight).sigmaLat < plan(wild).sigmaLat * 0.8, 'the accurate driver is not tighter');
  assert.ok(plan(straight).odds.fairway > plan(wild).odds.fairway + 0.1, 'the accurate driver does not hit more fairways');
});

test('lies cost distance and control, in that order of severity', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 3);
  const ball = add(hole.pin, scale(vec(0, -1), 200));
  // Aimed at a target the club can reach, the engine simply swings softer, so
  // compare what a *full* swing gets out of each lie.
  const reach = (lie: ShotContext['lie']) => {
    const ctx = context(golfer, 3, ball, lie);
    const plan = planShot(ctx, { club: '5i', shotType: 'full', target: hole.pin }, { skipOdds: true });
    return { total: reachTable(ctx, vec(0, 1)).get('5i') ?? 0, sigma: plan.sigmaLat };
  };
  const order: ShotContext['lie'][] = ['fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough'];
  for (let i = 1; i < order.length; i++) {
    const worse = reach(order[i]);
    const better = reach(order[i - 1]);
    assert.ok(worse.total <= better.total + 0.01, `${order[i]} is not shorter than ${order[i - 1]}`);
    assert.ok(worse.sigma > better.sigma, `${order[i]} is not less accurate than ${order[i - 1]}`);
  }
  assert.ok(reach('deepRough').total < reach('fairway').total * 0.93, 'deep rough costs too little distance');
});

test('wind changes what a shot plays like, and skill blunts it', () => {
  const coastal = COURSE_BY_ID.coastal;
  const hole = holeGeometry(coastal, 8);
  const ball = add(hole.pin, scale(vec(0, -1), 165));
  const forRating = (golfer: Golfer, speed: number) => {
    const weather = { ...calmWeather(coastal), windSpeed: speed, gust: 0, windFrom: hole.spec.bearing };
    const ctx: ShotContext = {
      hole, golfer, ball, lie: 'fairway', onTee: false,
      conditions: conditionsFor(weather, 'wind'), shotIndex: 0, pressure: 0,
    };
    return planShot(ctx, { club: '6i', shotType: 'full', target: hole.pin }, { skipOdds: true });
  };
  const specialist = byName('Rory Ballantyne');
  const poor = byName('Tevita Fonoti');
  assert.ok(forRating(specialist, 25).playsLike > forRating(specialist, 0).playsLike + 8, 'headwind does not lengthen the shot');
  assert.ok(
    forRating(specialist, 25).playsLike < forRating(poor, 25).playsLike,
    'the wind specialist does not flight it better',
  );
  assert.ok(
    forRating(specialist, 25).sigmaLat < forRating(poor, 25).sigmaLat,
    'the wind specialist is not steadier in a gale',
  );
  const head = windComponents({ ...calmWeather(coastal), windSpeed: 20, windFrom: 0 }, 0);
  between(head.head, 19, 21, 'a wind from straight ahead should be a headwind');
});

test('elevation changes what a shot plays like', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 9); // 34 feet of climb
  const ball = add(hole.pin, scale(vec(0, -1), 170));
  const plan = planShot(context(golfer, 9, ball, 'fairway'), { club: '7i', shotType: 'full', target: hole.pin }, { skipOdds: true });
  assert.ok(Math.abs(plan.elevationDelta) > 4, 'no elevation change measured');
  const expected = plan.distanceToTarget + plan.elevationDelta * (plan.elevationDelta > 0 ? 0.32 : 0.27);
  assert.ok(Math.abs(plan.playsLike - expected) < 6, 'plays-like does not follow the elevation');
});

test('shot outcomes are believable off the tee', () => {
  const hole = holeGeometry(desert, 1);
  const golfer = byName('Marcus Vandehey');
  const ctx = context(golfer, 1, hole.tee, 'tee', true);
  // Down the middle of the hole, which bends: aiming at a point 290 yards due
  // north of the tee is aiming at the rough on a hole that turns.
  const target = pointAlongPolyline(hole.centerline, 290).point;
  const plan = planShot(ctx, { club: 'D', shotType: 'full', target });
  let fairway = 0;
  let total = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const result = resolveShot(ctx, plan, rng);
    if (result.finalLie === 'fairway' || result.finalLie === 'firstCut') fairway++;
    total += result.total;
  }
  between(total / N, 270, 330, 'average drive');
  between(fairway / N, 0.55, 0.95, 'fairways hit on a wide desert hole');
  // The model's own odds should agree with what the sampler does.
  assert.ok(Math.abs(plan.odds.fairway - fairway / N) < 0.15, 'predicted odds disagree with the sampler');
});

test('dispersion zones mean what they say', () => {
  between(sigmaForShare(0.5), 1.17, 1.18, '50% contour');
  between(sigmaForShare(0.75), 1.66, 1.67, '75% contour');
  between(sigmaForShare(0.9), 2.14, 2.15, '90% contour');
});

// ---------------------------------------------------------------------------
console.log('\nPutting');
// ---------------------------------------------------------------------------

test('make percentages sit in the specified bands', () => {
  // The brief: 3ft 90–95%, 5ft 70–80%, 8ft 40–50%, 15ft 15–20%, 30ft 3–6% for an
  // average putter, with elite above and poor below.
  const bands: [number, number, number][] = [
    [3, 0.88, 0.97], [5, 0.68, 0.82], [8, 0.38, 0.52], [10, 0.30, 0.45],
    [15, 0.13, 0.22], [20, 0.08, 0.16], [30, 0.025, 0.07],
  ];
  for (const [feet, low, high] of bands) {
    between(makeProbability(feet, 72), low, high, `${feet} ft make rate`);
  }
  for (let feet = 4; feet <= 40; feet += 4) {
    assert.ok(makeProbability(feet, 95) > makeProbability(feet, 55), `skill does not help from ${feet} ft`);
    assert.ok(makeProbability(feet, 72) > makeProbability(feet + 4, 72), `longer putts are not harder at ${feet} ft`);
  }
  // Distance has to dominate: an elite putter from 15 feet holes fewer than a
  // poor one from five.
  assert.ok(makeProbability(15, 97) < makeProbability(5, 45), 'distance is not the dominant term');
});

test('the panel agrees with the ball', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 12);
  for (const feet of [4, 9, 18, 32]) {
    const ball = add(hole.pin, scale({ x: -0.7, y: -0.71 }, feet / 3));
    const ctx = context(golfer, 12, ball, 'green');
    const plan = puttDecision(ctx);
    for (const option of plan.options) {
      let made = 0;
      const N = 2500;
      for (let i = 0; i < N; i++) if (resolvePutt(ctx, option.intent, rng, plan.read).holed) made++;
      assert.ok(
        Math.abs(made / N - option.make) < 0.06,
        `${feet} ft ${option.intent}: predicted ${option.make.toFixed(2)}, simulated ${(made / N).toFixed(2)}`,
      );
    }
  }
});

test('lagging and attacking are a real trade-off', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 4);
  const option = (feet: number, intent: PuttIntentId) => {
    const ball = add(hole.pin, scale({ x: -0.7, y: -0.71 }, feet / 3));
    const plan = puttDecision(context(golfer, 4, ball, 'green'));
    const found = plan.options.find((o) => o.intent === intent);
    assert.ok(found, `${intent} was not offered from ${feet} ft`);
    return found;
  };
  for (const feet of [6, 12, 25, 45]) {
    const lag = option(feet, 'lag');
    const attack = option(feet, 'attack');
    assert.ok(attack.expectedLeaveFeet > lag.expectedLeaveFeet, `${feet} ft: attacking does not leave it further`);
    assert.ok(attack.threePutt > lag.threePutt, `${feet} ft: attacking does not risk more`);
    assert.ok(attack.make >= lag.make - 0.015, `${feet} ft: attacking should not hole fewer`);
  }
  // Short: attacking is worth it. Long: it is not.
  assert.ok(option(6, 'attack').expectedPutts < option(6, 'lag').expectedPutts, 'should attack from six feet');
  assert.ok(option(45, 'lag').expectedPutts < option(45, 'attack').expectedPutts, 'should lag from forty-five');
  // The safe option only appears where it is a real alternative.
  const shortPutt = puttDecision(context(golfer, 4, add(hole.pin, scale({ x: -0.7, y: -0.71 }, 2)), 'green'));
  assert.equal(shortPutt.options.length, 2, 'the safe lag should not clutter a six-footer');
});

test('conditions make putts harder in the right directions', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 12);
  const ball = add(hole.pin, scale({ x: -0.7, y: -0.71 }, 18 / 3));
  const withSpeed = (stimp: number) => {
    const weather = { ...calmWeather(desert), greenSpeed: stimp };
    const ctx: ShotContext = {
      ...context(golfer, 12, ball, 'green'),
      conditions: conditionsFor(weather, 'speed'),
    };
    return puttDecision(ctx);
  };
  const slow = withSpeed(9.5);
  const fast = withSpeed(13.2);
  assert.ok(Math.abs(fast.read.breakFeet) > Math.abs(slow.read.breakFeet), 'a faster green does not break more');
  const slowLag = slow.options.find((o) => o.intent === 'lag')!;
  const fastLag = fast.options.find((o) => o.intent === 'lag')!;
  assert.ok(fastLag.expectedLeaveFeet > slowLag.expectedLeaveFeet, 'a faster green is not harder to judge');
  assert.ok(fastLag.threePutt > slowLag.threePutt, 'a faster green does not raise the three-putt risk');
});

test('pressure widens the stroke without simply missing putts', () => {
  const golfer = byName('Nate Hollingsworth'); // low composure
  const hole = holeGeometry(desert, 12);
  const ball = add(hole.pin, scale({ x: -0.7, y: -0.71 }, 8 / 3));
  const calm = puttDecision({ ...context(golfer, 12, ball, 'green'), pressure: 0 });
  const tense = puttDecision({ ...context(golfer, 12, ball, 'green'), pressure: 1 });
  const calmAttack = calm.options.find((o) => o.intent === 'attack')!;
  const tenseAttack = tense.options.find((o) => o.intent === 'attack')!;
  assert.ok(tenseAttack.make < calmAttack.make, 'pressure does nothing');
  assert.ok(tenseAttack.make > calmAttack.make * 0.72, 'pressure is overpowering');
  const steady = byName('Marcus Vandehey'); // high composure
  const steadyCalm = puttDecision({ ...context(steady, 12, ball, 'green'), pressure: 0 });
  const steadyTense = puttDecision({ ...context(steady, 12, ball, 'green'), pressure: 1 });
  const drop = (a: number, b: number) => (a - b) / a;
  assert.ok(
    drop(steadyCalm.options.find((o) => o.intent === 'attack')!.make, steadyTense.options.find((o) => o.intent === 'attack')!.make) <
      drop(calmAttack.make, tenseAttack.make),
    'composure does not protect the stroke',
  );
});

test('personality and the leaderboard change the strategy', () => {
  const hole = holeGeometry(desert, 4);
  const ball = add(hole.pin, scale({ x: -0.7, y: -0.71 }, 20 / 3));
  const pick = (name: string, situation: PuttSituation) =>
    choosePuttIntent({ ...context(byName(name), 4, ball, 'green'), pressure: 0.6 }, situation).intent;
  const chasing: PuttSituation = { round: 4, behind: 3, holesRemaining: 5, toPar: -1 };
  const leading: PuttSituation = { round: 4, behind: -2, holesRemaining: 4, toPar: -1 };
  // Personality shows up across a range of putts rather than on any single one:
  // some putts are clear-cut and everybody plays them the same way.
  const attacksAt = (name: string, situation: PuttSituation) =>
    [10, 14, 18, 22, 26].filter((feet) => {
      const at = add(hole.pin, scale({ x: -0.7, y: -0.71 }, feet / 3));
      return choosePuttIntent({ ...context(byName(name), 4, at, 'green'), pressure: 0.6 }, situation).intent === 'attack';
    }).length;
  assert.ok(
    attacksAt('Lars Öhlund', chasing) > attacksAt('Ben Cartwright', chasing),
    'the aggressor should take on more putts than the course manager',
  );
  assert.ok(
    attacksAt('Ben Cartwright', chasing) > attacksAt('Ben Cartwright', leading),
    'chasing should be more aggressive than protecting a lead',
  );
  assert.ok(
    attacksAt('Lars Öhlund', leading) >= attacksAt('Ben Cartwright', leading),
    'the aggressor should never be the more cautious of the two',
  );
  // Everybody attacks a four-footer.
  const tiddler = add(hole.pin, scale({ x: -0.7, y: -0.71 }, 4 / 3));
  for (const name of ['Ben Cartwright', 'Lars Öhlund', 'Gerrit Bakker']) {
    assert.equal(
      choosePuttIntent(context(byName(name), 4, tiddler, 'green'), leading).intent,
      'attack',
      `${name} should hole out from four feet`,
    );
  }
});

// ---------------------------------------------------------------------------
console.log('\nPlaying a round');
// ---------------------------------------------------------------------------

test('a full round produces a plausible card', () => {
  const golfer = byName('Marcus Vandehey');
  golfer.fatigue = 0;
  const roundRng = createRng('regression:round');
  const touch = dailyTouch(golfer, roundRng.fork('touch'));
  let strokes = 0;
  let putts = 0;
  let holesWithGir = 0;
  for (let h = 1; h <= 18; h++) {
    const base = holeGeometry(desert, h);
    const hole = withPin(base, pinForRound(base, 2));
    const outcome = playHole({ hole, golfer, conditions, rng: roundRng, pressure: 0.2, touch });
    assert.ok(outcome.strokes >= 1 && outcome.strokes <= 12, `hole ${h} produced ${outcome.strokes} strokes`);
    assert.ok(outcome.shots.length > 0, `hole ${h} recorded no shots`);
    assert.equal(outcome.shots[outcome.shots.length - 1].holed || outcome.strokes >= 12, true, `hole ${h} never holed out`);
    strokes += outcome.strokes;
    putts += outcome.putts;
    if (outcome.gir) holesWithGir++;
  }
  between(strokes, 60, 82, 'round total for an elite golfer');
  between(putts, 24, 38, 'putts in a round');
  between(holesWithGir, 8, 18, 'greens in regulation');
  assert.ok(golfer.fatigue > 8, 'walking eighteen holes produced no fatigue');
});

test('fatigue and pressure make a golfer worse, but not a different player', () => {
  const golfer = byName('Marcus Vandehey');
  const hole = holeGeometry(desert, 3);
  const ball = add(hole.pin, scale(vec(0, -1), 160));
  const measure = (fatigue: number, pressure: number) => {
    golfer.fatigue = fatigue;
    const ctx = { ...context(golfer, 3, ball, 'fairway'), pressure };
    return planShot(ctx, { club: '7i', shotType: 'full', target: hole.pin }, { skipOdds: true });
  };
  const fresh = measure(0, 0);
  const tired = measure(100, 0);
  const nervous = measure(0, 1);
  golfer.fatigue = 0;
  assert.ok(tired.sigmaLat > fresh.sigmaLat, 'fatigue does not cost control');
  assert.ok(tired.sigmaLat < fresh.sigmaLat * 1.25, 'fatigue is overpowering');
  assert.ok(nervous.sigmaLat > fresh.sigmaLat, 'pressure does not cost control');
  assert.ok(nervous.sigmaLat < fresh.sigmaLat * 1.45, 'pressure is overpowering');
});

test('a hole is played the same way twice from the same seed', () => {
  const golfer = byName('Ben Cartwright');
  const play = () => {
    golfer.fatigue = 0;
    const hole = holeGeometry(desert, 5);
    return playHole({ hole, golfer, conditions, rng: createRng('determinism'), pressure: 0.3 }).strokes;
  };
  assert.equal(play(), play());
});

// ---------------------------------------------------------------------------
console.log('\nThe universe');
// ---------------------------------------------------------------------------

const universe = createUniverse('regression');

test('a season is twenty events at twenty courses, with four majors', () => {
  assert.equal(universe.schedule.length, 20);
  assert.equal(universe.schedule.filter((t) => t.tier === 'major').length, 4);
  assert.equal(new Set(universe.schedule.map((t) => t.courseId)).size, 20);
  // The four majors are on four different kinds of golf course, so no one sort
  // of player can own all of them.
  const majorStyles = universe.schedule
    .filter((t) => t.tier === 'major')
    .map((t) => COURSE_BY_ID[t.courseId].style);
  assert.ok(new Set(majorStyles).size >= 2, `all four majors are ${majorStyles[0]} courses`);
  assert.equal(universe.golfers.length, TOUR_SIZE);
});

test('a tournament cuts, pays and ranks correctly', () => {
  const tournament = simulateTournament(universe, { fast: true });
  assert.ok(tournament, 'no tournament played');
  assert.equal(tournament.status, 'complete');
  assert.equal(tournament.roundsPlayed, 4);
  // Low sixty-five and ties: the line itself is shared, so the weekend field
  // is sixty-five plus however many players are level with the last qualifier.
  assert.ok(tournament.madeCut.length >= 65 && tournament.madeCut.length <= 90, `cut left ${tournament.madeCut.length}`);

  const board = buildLeaderboard(tournament, 4);
  const active = board.filter((r) => r.status === 'active');
  assert.equal(active[0].position, 1);
  for (let i = 1; i < active.length; i++) {
    assert.ok(active[i].total >= active[i - 1].total, 'leaderboard is out of order');
  }
  assert.equal(active[0].golferId, tournament.winnerId);
  for (const row of active) assert.equal(row.rounds.filter(Boolean).length, 4, 'a qualifier is missing a round');
  for (const row of board.filter((r) => r.status === 'cut')) {
    assert.equal(row.rounds.filter(Boolean).length, 2, 'a cut player played the weekend');
  }

  const paid = payout(tournament).reduce((sum, row) => sum + row.money, 0);
  assert.ok(Math.abs(paid - tournament.purse) / tournament.purse < 0.02, `paid out ${paid} of a ${tournament.purse} purse`);
  const winner = universe.golfers.find((g) => g.id === tournament.winnerId);
  assert.ok(winner && winner.career.wins >= 1, 'the winner was not credited with a win');
  between(board[0].toPar, -30, 2, 'winning score');
});

test('scoring across a season stays in the tour band', () => {
  while (!seasonComplete(universe)) simulateTournament(universe, { fast: true });
  const played = universe.golfers.filter((g) => g.season.rounds >= 20);
  assert.ok(played.length >= 20, 'not enough golfers completed a season');
  const averages = played.map((g) => g.season.strokes / g.season.rounds).sort((a, b) => a - b);
  const field = averages.reduce((a, b) => a + b, 0) / averages.length;
  between(field, 69, 75, 'field scoring average');
  between(averages[0], 66, 71, 'best scoring average');
  // Raw season averages are wider than the difference in ability, because a
  // player who misses cuts only ever banks their two worst rounds of the week.
  between(averages[averages.length - 1] - averages[0], 2, 8.5, 'spread between best and worst averages');
  between(averages[averages.length - 1], 71, 78, 'worst qualifying average');

  const winners = new Set(universe.schedule.map((t) => t.winnerId));
  assert.ok(winners.size >= 4, `only ${winners.size} different winners in a season`);
  const mostWins = Math.max(...universe.golfers.map((g) => g.season.wins));
  assert.ok(mostWins <= 14, `one golfer won ${mostWins} of 20 events`);
});

test('statistics come out at tour levels', () => {
  const sum = (pick: (g: Golfer) => number) => universe.golfers.reduce((total, g) => total + pick(g), 0);
  between(sum((g) => g.career.driveDistanceTotal) / sum((g) => g.career.drives), 270, 305, 'field driving distance');
  between(sum((g) => g.career.fairwaysHit) / sum((g) => g.career.fairwayAttempts), 0.45, 0.72, 'field driving accuracy');
  between(sum((g) => g.career.greensHit) / sum((g) => g.career.greenAttempts), 0.55, 0.75, 'field greens in regulation');
  between(sum((g) => g.career.scrambleSaves) / sum((g) => g.career.scrambleAttempts), 0.35, 0.62, 'field scrambling');
  between((sum((g) => g.career.putts) / sum((g) => g.career.puttHoles)) * 18, 28, 33, 'field putts per round');
  between(sum((g) => g.career.birdies) / sum((g) => g.career.holes), 0.13, 0.23, 'field birdie rate');
});

test('the news wire reports what happened', () => {
  assert.ok(universe.news.length > 20, 'not enough stories');
  const results = universe.news.filter((n) => n.kind === 'result');
  assert.ok(results.length >= 15, 'not every event was reported');
  for (const item of results) {
    assert.ok(item.headline.length > 10 && item.body.length > 40, 'empty story');
    assert.ok(item.golferIds.length > 0, 'a result with nobody in it');
  }
  const winnerNames = new Set(universe.schedule.map((t) => universe.golfers.find((g) => g.id === t.winnerId)?.name));
  assert.ok(results.some((item) => [...winnerNames].some((name) => name && item.headline.includes(name))), 'no winner named in a headline');
});

test('the save round-trips and stays inside localStorage', () => {
  const payload = serializeUniverse(universe);
  const parsed = JSON.parse(payload);
  assert.equal(parsed.golfers.length, TOUR_SIZE);
  assert.equal(parsed.schedule.length, 20);
  assert.equal(parsed.season, universe.season);
  assert.ok(payload.length < 2_500_000, `save is ${(payload.length / 1024 / 1024).toFixed(2)} MB`);
});

test('the season rolls over and the field stays full', () => {
  const before = universe.season;
  const abilities = new Map(universe.golfers.map((g) => [g.id, g.hidden.currentAbility]));
  const summary = advanceSeason(universe);
  assert.equal(universe.season, before + 1);
  assert.equal(universe.golfers.length, TOUR_SIZE);
  assert.equal(universe.eventIndex, 0);
  assert.ok(summary.championName.length > 0, 'no Player of the Year');
  assert.equal(summary.majorWinners.length, 4, 'majors were not recorded');
  assert.ok(universe.golfers.every((g) => g.season.events === 0), 'season counters were not reset');
  assert.ok(universe.schedule.every((t) => t.status === 'upcoming'), 'the new schedule is not fresh');

  const survivors = universe.golfers.filter((g) => abilities.has(g.id));
  const improved = survivors.filter((g) => g.hidden.currentAbility > (abilities.get(g.id) ?? 0));
  const declined = survivors.filter((g) => g.hidden.currentAbility < (abilities.get(g.id) ?? 0));
  // Ability is an integer over a band only sixteen points wide, so a season's
  // drift often rounds to nothing; the arc is in the averages below.
  assert.ok(improved.length > 3, 'nobody improved');
  assert.ok(declined.length >= 2, 'nobody declined');
  const young = survivors.filter((g) => g.age <= 25);
  const old = survivors.filter((g) => g.age >= 36);
  if (young.length > 2 && old.length > 2) {
    const delta = (list: Golfer[]) =>
      list.reduce((sum, g) => sum + (g.hidden.currentAbility - (abilities.get(g.id) ?? 0)), 0) / list.length;
    assert.ok(delta(young) > delta(old), 'the young are not developing faster than the old are declining');
  }
  assert.ok(currentTournament(universe), 'no next event');
});

test('a played round posts into the tournament and the field plays around it', () => {
  const world = createUniverse('played');
  const me = world.golfers[7];
  world.userGolferId = me.id;
  const event = currentTournament(world);
  assert.ok(event, 'no event to play');

  // Play all eighteen holes through the session API, the way the screen does:
  // take the caddie's suggested line, hit, settle, move on.
  let session = createSession({
    mode: 'tournament',
    golfer: me,
    courseId: event.courseId,
    round: 1,
    conditions: conditionsForSession(event, 1),
    seed: 'played:round1',
    standing: standingFor(event, me.id, event.field.length),
  });
  let guard = 0;
  while (session.status !== 'roundComplete' && guard++ < 400) {
    if (session.status === 'aiming') {
      session = session.lie === 'green' ? puttWith(session, me, 'lag').session : hit(session, me).session;
    }
    else if (session.status === 'animating') session = settle(session, me);
    else if (session.status === 'holeComplete') session = nextHole(session, me);
  }
  assert.equal(session.status, 'roundComplete', 'the round never finished');
  assert.equal(session.holeScores.filter((s) => s !== null).length, 18, 'not every hole was scored');
  assert.ok(session.log.length >= 18, 'no commentary was written');
  assert.ok(session.shots.every((shot) => shot.stroke > 0), 'a shot was logged without a stroke');

  const card = toPlayerRound(session);
  between(card.strokes, 60, 90, 'played round total');
  assert.equal(card.holeScores.length, 18);
  assert.equal(card.strokes, card.holeScores.reduce((a, b) => a + b, 0), 'card does not add up');

  recordRound(event, me.id, 1, card);
  simulateNextRound(world, { skipGolferId: me.id, fast: true });

  assert.equal(event.roundsPlayed, 1);
  const board = buildLeaderboard(event, 1);
  assert.equal(board.length, event.field.length, 'somebody is missing from the board');
  const mine = board.find((row) => row.golferId === me.id);
  assert.ok(mine, 'the played round is not on the leaderboard');
  assert.equal(mine.rounds[0], card.strokes, 'the posted score does not match the card');
  assert.ok(board.every((row) => row.rounds[0] !== null), 'the field did not all play');
  // And the played round is not double-counted when the next one is simulated.
  simulateNextRound(world, { fast: true });
  assert.equal(buildLeaderboard(event, 2).find((row) => row.golferId === me.id)?.rounds[0], card.strokes);
});

test('the same seed builds the same universe', () => {
  const a = createUniverse('twins');
  const b = createUniverse('twins');
  assert.equal(
    a.schedule.map((t) => t.weather.map((w) => w.windSpeed.toFixed(3)).join()).join(),
    b.schedule.map((t) => t.weather.map((w) => w.windSpeed.toFixed(3)).join()).join(),
  );
  simulateTournament(a, { fast: true });
  simulateTournament(b, { fast: true });
  assert.equal(a.schedule[0].winnerId, b.schedule[0].winnerId);
  assert.equal(a.schedule[0].leaderboard[0].total, b.schedule[0].leaderboard[0].total);
});

// ---------------------------------------------------------------------------
// The shot animation. It draws nothing here — the sampler is the part that has
// to be right, because a shot that snaps between path points or slides to a stop
// at a constant speed reads as a bug however well the course is drawn.

function flight(carryYards: number, apexFeet: number, rollYards: number, seconds: number): FlightAnimation {
  const steps = 26;
  const path: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({ x: 0, y: carryYards * t, h: apexFeet * 4 * Math.pow(t, 0.92) * (1 - t) });
  }
  return {
    path,
    rollPath: [{ x: 0, y: carryYards }, { x: 0, y: carryYards + rollYards }],
    duration: seconds,
    putt: null,
  };
}

function samples(animation: FlightAnimation, fps = 60): ReturnType<typeof sampleFlight>[] {
  const out: ReturnType<typeof sampleFlight>[] = [];
  const frames = Math.ceil(animation.duration * fps);
  for (let i = 0; i <= frames; i++) out.push(sampleFlight(animation, i / fps));
  return out;
}

test('the ball flies from the strike to where it lands and stops there', () => {
  const animation = flight(290, 108, 16, 3.4);
  const frames = samples(animation);
  assert.ok(frames.length > 100, 'too few frames to judge');

  // Always moving forward, never backward, never standing still.
  for (let i = 1; i < frames.length; i++) {
    const step = frames[i].position.y - frames[i - 1].position.y;
    assert.ok(step >= -1e-9, `the ball went backwards at frame ${i}`);
    if (frames[i].phase === 'flight') {
      assert.ok(step > 0.02, `the ball snapped between path points at frame ${i} (step ${step.toFixed(4)})`);
    }
  }

  // And it comes to rest exactly where the simulation put it.
  const last = frames[frames.length - 1];
  assert.ok(last.done, 'the animation never reported itself finished');
  assert.equal(last.position.h, 0, 'the ball finished in the air');
  assert.ok(Math.abs(last.position.y - 306) < 0.5, `the ball rested at ${last.position.y.toFixed(1)}, not 306`);
});

test('the shot climbs to its apex and comes back down', () => {
  const animation = flight(290, 108, 16, 3.4);
  const frames = samples(animation);
  const airborne = frames.filter((f) => f.phase === 'flight');
  const peak = airborne.reduce((best, f) => (f.position.h > best.position.h ? f : best), airborne[0]);

  // The flight curve peaks a touch above the club's nominal apex, at 1.057x.
  assert.ok(peak.position.h > 108, `the apex sampled only ${peak.position.h.toFixed(1)}ft of 114`);
  assert.equal(peak.apex, airborne[0].apex, 'the apex moved during the shot');
  assert.ok(peak.apex > 110 && peak.apex < 116, `apex reported as ${peak.apex.toFixed(1)}ft`);

  // The height goes up, then down, and only once each way: the ball drawn bigger
  // at the apex depends on there being exactly one apex to be biggest at.
  let turns = 0;
  for (let i = 2; i < airborne.length; i++) {
    const before = airborne[i - 1].position.h - airborne[i - 2].position.h;
    const after = airborne[i].position.h - airborne[i - 1].position.h;
    if (before > 0 && after < 0) turns++;
  }
  assert.ok(turns <= 1, `the flight turned over ${turns} times`);
  assert.ok(airborne[airborne.length - 1].position.h < peak.position.h * 0.35, 'the ball never came down');
});

test('a running shot skips before it settles, a dead one does not', () => {
  const hot = samples(flight(240, 92, 18, 3.0)).filter((f) => f.sinceLanding !== null);
  assert.ok(hot.some((f) => f.position.h > 3), 'a shot running eighteen yards never bounced');
  assert.ok(hot[hot.length - 1].position.h === 0, 'the bounce never settled');

  const dead = samples(flight(120, 96, 0.2, 2.0)).filter((f) => f.sinceLanding !== null);
  assert.ok(dead.every((f) => f.position.h === 0), 'a wedge that stopped dead hopped anyway');

  // The pitch mark is the landing point, not the resting point.
  assert.ok(hot[0].landing, 'no pitch mark was reported');
  assert.ok(Math.abs((hot[0].landing as { y: number }).y - 240) < 0.001, 'the pitch mark is not where the ball landed');
});

test('a putt dies rather than sliding at a constant speed', () => {
  const putt: FlightAnimation = {
    path: [],
    rollPath: [],
    duration: 1.4,
    putt: Array.from({ length: 27 }, (_, i) => ({ x: 0, y: (i / 26) * 24 })),
  };
  const frames = samples(putt);
  const early = frames[Math.round(frames.length * 0.1)].position.y - frames[0].position.y;
  const late = frames[frames.length - 1].position.y - frames[Math.round(frames.length * 0.9)].position.y;
  assert.ok(early > late * 2, `the putt did not slow down (${early.toFixed(2)} then ${late.toFixed(2)})`);
  assert.ok(frames.every((f) => f.position.h === 0), 'the putt left the ground');
  assert.ok(Math.abs(frames[frames.length - 1].position.y - 24) < 0.2, 'the putt stopped short of its own path');
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
// keep the unused-import checker honest about helpers used only in assertions
void dist;
