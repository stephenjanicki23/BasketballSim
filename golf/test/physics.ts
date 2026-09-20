/**
 * The surface physics, tested as relationships rather than as numbers.
 *
 * Every assertion here is of the form "this should be more/less than that",
 * because the point of the system is that the *ordering* is right and stays
 * right when the constants are retuned. Pinning exact yardages would turn every
 * balance change into a test failure and teach us nothing.
 *
 *   node tools/tsrun.mjs test/physics.ts
 */

import assert from 'node:assert/strict';

import { COURSE_BY_ID } from '../src/data/courses';
import { createTour } from '../src/data/golfers';
import { holeGeometry, pinForRound, withPin } from '../src/simulation/courseEngine';
import { calmWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import { add, norm, scale, sub, type Vec2 } from '../src/simulation/geometry';
import { planShot, resolveShot, type ShotContext, type ShotPlan } from '../src/simulation/shotEngine';
import { contactFor, flyerChanceFor, interferenceFor } from '../src/simulation/impact';
import { neutralLie } from '../src/simulation/lieState';
import { simulateFlight, NEUTRAL_FLIGHT } from '../src/simulation/ballFlight';
import { landingFor } from '../src/simulation/landing';
import { SURFACES, CLUB_SURFACE } from '../src/simulation/surfaces';
import { CLUB_BY_ID, SHOT_TYPES, type ShotTypeId } from '../src/simulation/config';
import type { ClubId, Golfer, HoleGeometry, LieType, Weather } from '../src/simulation/types';

let passed = 0;
let failed = 0;
function test(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// A fixed stage: one hole, one golfer, one calm day.
// ---------------------------------------------------------------------------

const course = COURSE_BY_ID.concord;
const base = holeGeometry(course, 1);
const hole: HoleGeometry = withPin(base, pinForRound(base, 1));
const golfer: Golfer = createTour()[0];
const weather = calmWeather(course);
const line = norm(sub(hole.pin, hole.tee));

function ctx(lie: LieType, options: { weather?: Weather; deepBunker?: boolean } = {}): ShotContext {
  return {
    hole,
    golfer,
    ball: hole.tee,
    lie,
    onTee: false,
    conditions: { weather: options.weather ?? weather, gustPhase: 0 },
    shotIndex: 3,
    pressure: 0,
    deepBunker: options.deepBunker,
  };
}

function plan(lie: LieType, club: ClubId, shotType: ShotTypeId, yards: number, options?: { weather?: Weather; deepBunker?: boolean }): ShotPlan {
  return planShot(ctx(lie, options), { club, shotType, target: add(hole.tee, scale(line, yards)) }, { skipOdds: true });
}

/** Average outcome over many resolves, which is how a stochastic model is read. */
function sample(p: ShotPlan, lie: LieType, n = 260, options?: { weather?: Weather; deepBunker?: boolean }) {
  const c = ctx(lie, options);
  let carry = 0;
  let roll = 0;
  let spin = 0;
  let launch = 0;
  let flyers = 0;
  let speed = 0;
  const launches: number[] = [];
  for (let i = 0; i < n; i++) {
    const result = resolveShot(c, p, createRng(`physics:${lie}:${p.club.id}:${p.shotType}:${i}`));
    carry += result.carry;
    roll += result.roll;
    spin += result.spin;
    launch += result.launchAngle;
    speed += result.ballSpeed;
    launches.push(result.launchAngle);
    if (result.flyer) flyers++;
  }
  const mean = launch / n;
  const sd = Math.sqrt(launches.reduce((a, l) => a + (l - mean) ** 2, 0) / n);
  return {
    carry: carry / n,
    roll: roll / n,
    spin: spin / n,
    launch: mean,
    launchSd: sd,
    ballSpeed: speed / n,
    flyerRate: flyers / n,
  };
}

// ---------------------------------------------------------------------------
section('The flight model');

test('the integrator reproduces tour launch-monitor carries', () => {
  // Fitted against published averages. The driver is the known outlier and is
  // documented as such in ballFlight.ts; everything else lands within 3%.
  const targets: Partial<Record<ClubId, number>> = {
    '3W': 243, '5W': 230, '3i': 212, '4i': 203, '5i': 194, '6i': 183, '7i': 172, '8i': 160, '9i': 148,
  };
  for (const [id, want] of Object.entries(targets)) {
    const got = NEUTRAL_FLIGHT[id as ClubId].carry;
    assert.ok(
      Math.abs(got - want!) / want! < 0.04,
      `${id} carries ${got.toFixed(0)} where the tour average is ${want}`,
    );
  }
});

test('more spin flies higher and lands steeper', () => {
  const low = simulateFlight({ ballSpeed: 120, launch: 16, backspin: 2000 });
  const high = simulateFlight({ ballSpeed: 120, launch: 16, backspin: 7000 });
  assert.ok(high.apexFeet > low.apexFeet * 1.3, 'the high-spin shot did not fly higher');
  assert.ok(high.descent > low.descent + 8, 'the high-spin shot did not land steeper');
  assert.ok(high.landingSpeed < low.landingSpeed, 'the high-spin shot did not land slower');
});

test('lift saturates, so past a point more spin only costs distance', () => {
  // The reason spin loft has diminishing returns, and the reason a flyer that
  // drops from 7,000 rpm to 2,500 gains carry rather than losing it.
  const peak = simulateFlight({ ballSpeed: 120, launch: 16, backspin: 7000 });
  const over = simulateFlight({ ballSpeed: 120, launch: 16, backspin: 11000 });
  assert.ok(over.apexFeet < peak.apexFeet * 1.02, 'four thousand more rpm still bought height');
  assert.ok(over.carry < peak.carry * 0.95, 'over-spinning it cost no distance');
});

test('two shots with the same carry can have different shapes', () => {
  // A low, hot, low-spin ball and a high, soft one, matched on carry.
  const hot = simulateFlight({ ballSpeed: 122, launch: 12.5, backspin: 2900 });
  const soft = simulateFlight({ ballSpeed: 131, launch: 20, backspin: 8500 });
  assert.ok(Math.abs(hot.carry - soft.carry) < 8, `carries differ too much: ${hot.carry.toFixed(0)} vs ${soft.carry.toFixed(0)}`);
  assert.ok(soft.apexFeet > hot.apexFeet * 1.3, 'the soft one did not fly higher');
  assert.ok(soft.descent > hot.descent + 8, 'the soft one did not come down steeper');
});

// ---------------------------------------------------------------------------
section('Grass interference');

test('taller, denser grass puts more between the face and the ball', () => {
  const club = CLUB_BY_ID['7i'];
  const order: LieType[] = ['fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough'];
  let previous = -1;
  for (const lie of order) {
    const { interference } = interferenceFor({
      lie: neutralLie(lie === 'fairway' ? 'fairway' : lie === 'firstCut' ? 'firstCut' : lie === 'lightRough' ? 'lightRough' : lie === 'heavyRough' ? 'heavyRough' : 'deepRough', lie, 0.6),
      club, shotType: 'full', swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1,
    });
    assert.ok(interference > previous, `${lie} (${interference.toFixed(3)}) did not exceed the surface before it`);
    previous = interference;
  }
});

test('a steep club carries less grass into impact than a sweeping one', () => {
  const lie = neutralLie('heavyRough', 'heavyRough', 0.5);
  const driver = interferenceFor({ lie, club: CLUB_BY_ID.D, shotType: 'full', swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1 });
  const wedge = interferenceFor({ lie, club: CLUB_BY_ID.SW, shotType: 'full', swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1 });
  assert.ok(driver.interference > wedge.interference * 2, `driver ${driver.interference.toFixed(2)} vs wedge ${wedge.interference.toFixed(2)}`);
  assert.ok(driver.attackAngle > wedge.attackAngle, 'the wedge is not the steeper club');
});

test('a worse lie in the same rough means more interference', () => {
  const club = CLUB_BY_ID['7i'];
  const good = interferenceFor({ lie: neutralLie('lightRough', 'lightRough', 0.9), club, shotType: 'full', swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1 });
  const bad = interferenceFor({ lie: neutralLie('lightRough', 'lightRough', 0.2), club, shotType: 'full', swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1 });
  assert.ok(bad.interference > good.interference * 1.4, `${bad.interference.toFixed(3)} is not meaningfully worse than ${good.interference.toFixed(3)}`);
});

// ---------------------------------------------------------------------------
section('Spin');

test('rough takes spin off, and takes more off a long iron than a wedge', () => {
  const contact = (lie: LieType, club: ClubId, quality = 0.5) =>
    contactFor({
      lie: neutralLie(lie === 'fairway' ? 'fairway' : 'heavyRough', lie, quality),
      club: CLUB_BY_ID[club], shotType: 'full', swingScale: 1, strike: 1,
      lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1,
    });
  const wedgeClean = contact('fairway', 'SW', 1);
  const wedgeRough = contact('heavyRough', 'SW');
  const ironClean = contact('fairway', '4i', 1);
  const ironRough = contact('heavyRough', '4i');

  const wedgeLoss = 1 - wedgeRough.backspin / wedgeClean.backspin;
  const ironLoss = 1 - ironRough.backspin / ironClean.backspin;
  assert.ok(wedgeLoss > 0.05, `the wedge lost only ${(wedgeLoss * 100).toFixed(0)}% of its spin in heavy rough`);
  assert.ok(ironLoss > wedgeLoss * 2, `the 4 iron lost ${(ironLoss * 100).toFixed(0)}% where the wedge lost ${(wedgeLoss * 100).toFixed(0)}%`);
  assert.ok(ironLoss > 0.4, `a long iron out of heavy rough kept too much spin (${(1 - ironLoss) * 100}%)`);
});

test('a clean wedge from the fairway keeps nearly all of its spin', () => {
  const clean = contactFor({
    lie: neutralLie('fairway', 'fairway', 1), club: CLUB_BY_ID.SW, shotType: 'full',
    swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1,
  });
  assert.ok(clean.backspin > CLUB_BY_ID.SW.spin * 0.9, `only ${clean.backspin.toFixed(0)} of ${CLUB_BY_ID.SW.spin} rpm`);
});

test('wet rough behaves differently from dry rough', () => {
  const dry = neutralLie('lightRough', 'lightRough', 0.6);
  const wet = { ...dry, moisture: 0.95 };
  const spin = (lie: typeof dry) =>
    contactFor({ lie, club: CLUB_BY_ID['7i'], shotType: 'full', swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1 }).backspin;
  assert.ok(spin(wet) < spin(dry) * 0.9, `wet ${spin(wet).toFixed(0)} vs dry ${spin(dry).toFixed(0)} rpm`);
});

test('a shot the rough has flattened cannot be curved much', () => {
  const draw = (lie: LieType, quality: number) =>
    contactFor({
      lie: neutralLie(lie === 'fairway' ? 'fairway' : 'heavyRough', lie, quality),
      club: CLUB_BY_ID['5i'], shotType: 'draw', swingScale: 1, strike: 1,
      lieSkill: 70, spinSkill: 70, curve: SHOT_TYPES.draw.curve, roll: 0.5, rollB: 1,
    });
  const clean = draw('fairway', 1);
  const rough = draw('heavyRough', 0.4);
  assert.ok(Math.abs(rough.sidespin) < Math.abs(clean.sidespin) * 0.75, `${rough.sidespin.toFixed(0)} vs ${clean.sidespin.toFixed(0)} rpm of sidespin`);
  assert.ok(Math.abs(clean.spinAxis) > 3, 'a draw from a clean lie barely tilted the axis');
});

// ---------------------------------------------------------------------------
section('Flyers');

test('flyers happen in light rough and almost never from a fairway', () => {
  const chance = (lie: LieType, club: ClubId, quality: number) => {
    const state = neutralLie(lie === 'fairway' ? 'fairway' : lie === 'lightRough' ? 'lightRough' : 'deepRough', lie, quality);
    const inputs = { lie: state, club: CLUB_BY_ID[club], shotType: 'full' as ShotTypeId, swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1 };
    return flyerChanceFor(inputs, interferenceFor(inputs).interference);
  };
  assert.ok(chance('fairway', '7i', 1) < 0.02, 'the fairway produced flyers');
  assert.ok(chance('lightRough', '7i', 0.85) > 0.15, 'light rough produced no flyers');
  assert.ok(chance('lightRough', '7i', 0.85) > chance('deepRough', '7i', 0.3) * 2, 'deep rough flyers as readily as light rough');
});

test('a flyer is hotter, lower-spinning and runs further', () => {
  const inputs = {
    lie: neutralLie('lightRough', 'lightRough', 0.9), club: CLUB_BY_ID['7i'], shotType: 'full' as ShotTypeId,
    swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5,
  };
  const normal = contactFor({ ...inputs, rollB: 1 });
  const flyer = contactFor({ ...inputs, rollB: 0 });
  assert.ok(flyer.flyer && !normal.flyer, 'the forced roll did not produce a flyer');
  assert.ok(flyer.backspin < normal.backspin * 0.5, `flyer spin ${flyer.backspin.toFixed(0)} vs ${normal.backspin.toFixed(0)}`);
  assert.ok(flyer.ballSpeedFactor > normal.ballSpeedFactor, 'the flyer was not hotter');
  assert.ok(flyer.launchDelta > normal.launchDelta, 'the flyer did not launch higher');

  const air = (c: typeof normal) =>
    simulateFlight({ ballSpeed: CLUB_BY_ID['7i'].ballSpeed * c.ballSpeedFactor, launch: CLUB_BY_ID['7i'].launch + c.launchDelta, backspin: c.backspin });
  const fly = air(flyer);
  const norm_ = air(normal);
  const run = (f: typeof fly) =>
    landingFor({ speed: f.landingSpeed, descent: f.descent, backspin: f.landingSpin, surface: SURFACES.green, firmness: 0.6, moisture: 0.4 }).run;
  assert.ok(run(fly) > run(norm_) * 1.5, `the flyer ran ${run(fly).toFixed(1)} yd against ${run(norm_).toFixed(1)}`);
});

// ---------------------------------------------------------------------------
section('Sand');

test('packed sand plays hotter and lower than fluffy sand', () => {
  const contact = (surfaceId: 'firmSand' | 'softSand' | 'deepSand') =>
    contactFor({
      lie: neutralLie(surfaceId, 'greensideBunker', 0.6), club: CLUB_BY_ID.SW, shotType: 'explosion',
      swingScale: 1, strike: 1, lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1,
    });
  const firm = contact('firmSand');
  const soft = contact('softSand');
  const deep = contact('deepSand');
  assert.ok(firm.ballSpeedFactor > soft.ballSpeedFactor, 'packed sand was not hotter than soft');
  assert.ok(soft.ballSpeedFactor > deep.ballSpeedFactor, 'soft sand was not hotter than deep');
  assert.ok(firm.launchDelta < soft.launchDelta, 'packed sand did not launch lower than soft');
  assert.ok(soft.launchDelta < deep.launchDelta, 'soft sand did not launch lower than deep');
  assert.ok(firm.backspin > soft.backspin, 'packed sand did not spin more than soft');
});

test('sand absorbs a landing where grass does not', () => {
  const flight = NEUTRAL_FLIGHT['9i'];
  const run = (id: 'fairway' | 'softSand' | 'firmSand') => {
    const s = SURFACES[id];
    return landingFor({ speed: flight.landingSpeed, descent: flight.descent, backspin: flight.landingSpin, surface: s, firmness: s.firmness, moisture: s.moisture }).run;
  };
  assert.ok(run('softSand') < run('fairway') * 0.4, `sand ran ${run('softSand').toFixed(1)} against the fairway's ${run('fairway').toFixed(1)}`);
  assert.ok(run('firmSand') > run('softSand'), 'packed sand did not run further than fluffy sand');
});

// ---------------------------------------------------------------------------
section('The same shot from different surfaces');

test('a 100-yard wedge: spin falls and rollout grows as the lie gets worse', () => {
  const rows = (['fairway', 'lightRough', 'heavyRough', 'greensideBunker'] as LieType[]).map((lie) => {
    const p = plan(lie, 'SW', lie === 'greensideBunker' ? 'explosion' : 'full', 100);
    return { lie, ...sample(p, lie, 160) };
  });
  const [fairway, light, heavy, sand] = rows;
  assert.ok(light.spin < fairway.spin, `light rough spun ${light.spin.toFixed(0)} against the fairway's ${fairway.spin.toFixed(0)}`);
  assert.ok(heavy.spin < light.spin, 'heavy rough did not spin less than light rough');
  assert.ok(sand.spin < fairway.spin * 0.8, 'the bunker shot kept too much spin');
  assert.ok(light.roll > fairway.roll, `light rough ran ${light.roll.toFixed(1)} against the fairway's ${fairway.roll.toFixed(1)}`);
  assert.ok(heavy.launchSd > fairway.launchSd * 1.5, `launch scatter ${heavy.launchSd.toFixed(2)}° against ${fairway.launchSd.toFixed(2)}°`);
});

test('the lie costs a driver far more than it costs a wedge', () => {
  const cost = (club: ClubId) => {
    const clean = plan('fairway', club, 'full', 400);
    const rough = plan('lightRough', club, 'full', 400);
    return 1 - rough.expectedCarry / clean.expectedCarry;
  };
  const driver = cost('D');
  const wedge = cost('SW');
  assert.ok(driver > wedge * 2.5, `driver loses ${(driver * 100).toFixed(1)}%, wedge ${(wedge * 100).toFixed(1)}%`);
  assert.ok(driver > 0.05, `a driver from light rough only lost ${(driver * 100).toFixed(1)}%`);
  assert.ok(wedge < 0.06, `a wedge from light rough lost ${(wedge * 100).toFixed(1)}%`);
});

test('a 7 iron: fairway, rough and a flyer are three different shots', () => {
  const fairway = plan('fairway', '7i', 'full', 400);
  const rough = plan('heavyRough', '7i', 'full', 400);
  assert.ok(rough.expectedCarry < fairway.expectedCarry, 'heavy rough did not shorten the carry');
  assert.ok(rough.contact.backspin < fairway.contact.backspin * 0.8, 'heavy rough did not cost spin');
  assert.ok(rough.expectedRoll > fairway.expectedRoll, 'heavy rough did not add rollout');
  assert.ok(rough.apex < fairway.apex, 'heavy rough did not lower the flight');
});

test('a punch out of rough is not a full swing out of rough', () => {
  const full = plan('heavyRough', '6i', 'full', 170);
  const punch = plan('heavyRough', '6i', 'punch', 170);
  assert.ok(punch.contact.grassInterference < full.contact.grassInterference, 'the punch carried as much grass as the full swing');
  assert.ok(punch.apex < full.apex * 0.8, 'the punch did not fly lower');
  assert.ok(punch.expectedRoll > full.expectedRoll, 'the punch did not run more');
});

test('a flop from thick rough is not a pitch from thick rough', () => {
  const pitch = plan('heavyRough', 'LW', 'pitch', 26);
  const flop = plan('heavyRough', 'LW', 'flop', 26);
  assert.ok(flop.contact.grassInterference > pitch.contact.grassInterference, 'the flop did not take more grass');
  assert.ok(flop.contact.launchDelta > pitch.contact.launchDelta, 'the flop did not launch higher');
  assert.ok(flop.expectedRoll < pitch.expectedRoll, 'the flop did not land softer');
});

// ---------------------------------------------------------------------------
section('Landing and roll');

test('a steep, high-spin arrival stops and a shallow, low-spin one runs', () => {
  const steep = landingFor({ speed: 48, descent: 52, backspin: 7000, surface: SURFACES.green, firmness: 0.55, moisture: 0.42 });
  const shallow = landingFor({ speed: 56, descent: 38, backspin: 2200, surface: SURFACES.green, firmness: 0.55, moisture: 0.42 });
  assert.ok(steep.run < shallow.run * 0.4, `steep ran ${steep.run.toFixed(1)}, shallow ${shallow.run.toFixed(1)}`);
});

test('a firm course runs and a soaked one does not', () => {
  const flight = NEUTRAL_FLIGHT.D;
  const run = (firmness: number, moisture: number) =>
    landingFor({ speed: flight.landingSpeed, descent: flight.descent, backspin: flight.landingSpin, surface: SURFACES.fairway, firmness, moisture }).run;
  assert.ok(run(0.85, 0.20) > run(0.45, 0.85) * 2.5, `firm ${run(0.85, 0.2).toFixed(1)} vs wet ${run(0.45, 0.85).toFixed(1)}`);
});

test('downhill adds run and uphill takes it away', () => {
  const flight = NEUTRAL_FLIGHT['5i'];
  const run = (slope: number) =>
    landingFor({ speed: flight.landingSpeed, descent: flight.descent, backspin: flight.landingSpin, surface: SURFACES.fairway, firmness: 0.7, moisture: 0.3, slope }).run;
  assert.ok(run(0.25) > run(0) && run(0) > run(-0.25), `${run(-0.25).toFixed(1)} / ${run(0).toFixed(1)} / ${run(0.25).toFixed(1)}`);
});

test('a chip off the fringe runs further than the same chip off the green', () => {
  const fringe = plan('fringe', 'SW', 'chip', 18);
  const green = plan('green', 'SW', 'chip', 18);
  assert.ok(fringe.contact.grassInterference > green.contact.grassInterference, 'the fringe offered no more resistance than the green');
  assert.ok(fringe.contact.backspin < green.contact.backspin, 'the fringe chip spun as much as one off the green');
});

// ---------------------------------------------------------------------------
section('Weather');

test('rain changes what the same lie does', () => {
  const wet: Weather = { ...weather, rain: 1, softness: 0.95, firmness: weather.firmness * 0.62, greenFirmness: 42 };
  const dry = plan('lightRough', '7i', 'full', 400);
  const soaked = plan('lightRough', '7i', 'full', 400, { weather: wet });
  assert.ok(soaked.lieState.moisture > dry.lieState.moisture + 0.2, 'rain did not wet the grass');
  assert.ok(soaked.lieState.firmness < dry.lieState.firmness, 'rain did not soften the ground');
  assert.ok(soaked.contact.backspin < dry.contact.backspin, 'wet grass did not cost spin');
  assert.ok(soaked.contact.directionalBias > dry.contact.directionalBias, 'wet grass did not grab the hosel more');
});

test('a wet bunker packs down and plays differently', () => {
  let firmCount = 0;
  const wet: Weather = { ...weather, rain: 1, softness: 0.95 };
  for (let i = 0; i < 40; i++) {
    const p = planShot(
      { ...ctx('greensideBunker', { weather: wet }), ball: { x: i * 3.1, y: i * 1.7 } as Vec2 },
      { club: 'SW', shotType: 'explosion', target: add(hole.tee, scale(line, 24)) },
      { skipOdds: true },
    );
    if (p.lieState.surface.id === 'firmSand') firmCount++;
  }
  assert.ok(firmCount > 6, `only ${firmCount} of 40 wet bunker lies packed down`);
});

// ---------------------------------------------------------------------------
section('Lie quality');

test('the same surface gives meaningfully different lies', () => {
  const qualities = new Set<string>();
  let best = 0;
  let worst = 1;
  for (let i = 0; i < 60; i++) {
    const p = planShot(
      { ...ctx('lightRough'), ball: { x: i * 4.7, y: i * 2.3 } as Vec2 },
      { club: '7i', shotType: 'full', target: add(hole.tee, scale(line, 400)) },
      { skipOdds: true },
    );
    qualities.add(p.lieState.quality.toFixed(2));
    best = Math.max(best, p.lieState.quality);
    worst = Math.min(worst, p.lieState.quality);
  }
  assert.ok(qualities.size > 25, `only ${qualities.size} distinct lies in 60 draws`);
  assert.ok(best - worst > 0.25, `lie quality only spanned ${(best - worst).toFixed(2)}`);
});

test('a good lie in the rough beats a bad one by a real margin', () => {
  const shot = (quality: number) => {
    const state = neutralLie('lightRough', 'lightRough', quality);
    return contactFor({
      lie: state, club: CLUB_BY_ID['6i'], shotType: 'full', swingScale: 1, strike: 1,
      lieSkill: 70, spinSkill: 70, curve: 0, roll: 0.5, rollB: 1,
    });
  };
  const good = shot(0.95);
  const poor = shot(0.15);
  assert.ok(good.ballSpeedFactor > poor.ballSpeedFactor * 1.03, `${good.ballSpeedFactor.toFixed(3)} vs ${poor.ballSpeedFactor.toFixed(3)}`);
  assert.ok(good.backspin > poor.backspin * 1.15, `${good.backspin.toFixed(0)} vs ${poor.backspin.toFixed(0)} rpm`);
  assert.ok(good.contactQuality > poor.contactQuality * 1.2, 'contact quality barely moved');
  // The margin here is pinned by the tour calibration rather than by taste:
  // `dispersionFromInterference` and `dispersionFromLie` were solved so the
  // *average* light-rough lie reproduces the dispersion the field was already
  // balanced around, which leaves about a sixth between the best lie in that
  // rough and the worst. That it is there at all is the thing worth asserting.
  assert.ok(poor.dispersion > good.dispersion * 1.12, `a poor lie only widened the miss by ${((poor.dispersion / good.dispersion - 1) * 100).toFixed(0)}%`);
  assert.ok(poor.distanceControl > good.distanceControl * 1.12, 'a poor lie did not cost distance control');
});

test('the same lie resolved twice gives the same lie, and different balls differ', () => {
  const a = plan('lightRough', '7i', 'full', 400);
  const b = plan('lightRough', '7i', 'full', 400);
  assert.equal(a.lieState.quality, b.lieState.quality, 'walking up to the same ball found a different lie');
  const other = planShot(
    { ...ctx('lightRough'), ball: { x: 40, y: 90 } as Vec2 },
    { club: '7i', shotType: 'full', target: add(hole.tee, scale(line, 400)) },
    { skipOdds: true },
  );
  assert.notEqual(a.lieState.quality, other.lieState.quality, 'two different balls got identical lies');
});

// ---------------------------------------------------------------------------
section('Controlled variation');

test('the same plan resolved many times is not the same shot twice', () => {
  const p = plan('lightRough', '7i', 'full', 165);
  const c = ctx('lightRough');
  const carries = new Set<string>();
  for (let i = 0; i < 40; i++) {
    carries.add(resolveShot(c, p, createRng(`vary:${i}`)).carry.toFixed(2));
  }
  assert.ok(carries.size > 35, `only ${carries.size} distinct carries in 40 swings`);
});

test('but the average is stable, and sits where the plan said', () => {
  const p = plan('fairway', '7i', 'full', 165);
  const got = sample(p, 'fairway', 400);
  assert.ok(
    Math.abs(got.carry - p.expectedCarry) < p.expectedCarry * 0.06,
    `resolved ${got.carry.toFixed(1)} against a planned ${p.expectedCarry.toFixed(1)}`,
  );
});

test('every club still reaches a sane yardage from a clean lie', () => {
  for (const club of Object.values(CLUB_BY_ID)) {
    if (club.id === 'P') continue;
    const p = plan('fairway', club.id, 'full', 400);
    assert.ok(p.expectedCarry > 60 && p.expectedCarry < 340, `${club.name} carries ${p.expectedCarry.toFixed(0)}`);
    assert.ok(p.contact.backspin > 1500 && p.contact.backspin < 13000, `${club.name} spins ${p.contact.backspin.toFixed(0)}`);
    assert.ok(p.apex / 3 > 12 && p.apex / 3 < 55, `${club.name} peaks at ${(p.apex / 3).toFixed(0)} yd`);
    assert.ok(CLUB_SURFACE[club.family].loft > 0, `${club.name} has no loft on record`);
  }
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
