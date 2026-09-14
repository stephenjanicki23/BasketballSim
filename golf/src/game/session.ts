/**
 * The playable game.
 *
 * A session is one golfer, one hole at a time, shot by shot. Every function here
 * is pure: it takes a session and returns a new one, which is what lets the UI be
 * a thin layer over the simulation instead of a place where game rules hide.
 *
 * The player's shots go through exactly the same planShot/resolveShot as the
 * simulated field. The only thing the player gets that the AI does not is the
 * dispersion drawn on the screen — and the only thing the AI gets that the player
 * does not is its own opinion about where to aim.
 */

import { type Vec2, add, dist, norm, scale, sub } from '../simulation/geometry';
import { createRng, type Rng } from '../simulation/rng';
import { CLUB_BY_ID, LIES, PUTT_INTENTS, SHOT_TYPES, type ShotTypeId } from '../simulation/config';
import {
  type ShotContext,
  type ShotPlan,
  type ShotResult,
  availableShotTypes,
  isShortGame,
  legalClubs,
  planShot,
  resolveShot,
} from '../simulation/shotEngine';
import {
  type PuttDecision, type PuttResult, type PuttSituation, puttDecision, resolvePutt,
} from '../simulation/puttingEngine';
import { holeGeometry, pinForRound, terrainAt, withPin } from '../simulation/courseEngine';
import {
  type DailyTouch, addPuttingStats, bagFor, clubForDistance, dailyTouch, emptyPuttingStats,
  fatigueForHole,
} from '../simulation/golferEngine';
import { chooseShot } from '../simulation/holeEngine';
import { conditionsFor } from '../simulation/weatherEngine';
import { COURSE_BY_ID } from '../data/courses';
import { pressureFor, type RoundStats, type Tournament } from '../simulation/tournamentEngine';
import { strokesToHoleOut } from '../simulation/strokesBaseline';
import { puttBand } from '../simulation/holeEngine';
import type { ClubId, Conditions, Golfer, HoleGeometry, LieType, PuttingStats } from '../simulation/types';
import type { PuttIntentId } from '../simulation/config';

export interface ShotRecord {
  stroke: number;
  club: ClubId;
  shotType: ShotTypeId | 'putt';
  puttIntent?: PuttIntentId;
  from: Vec2;
  to: Vec2;
  lieBefore: LieType;
  lieAfter: LieType;
  distance: number;
  toPinAfter: number;
  penalty: number;
  holed: boolean;
  quality: string;
  note: string;
}

export interface FlightAnimation {
  path: { x: number; y: number; h: number }[];
  rollPath: Vec2[];
  /** Ball-flight seconds. */
  duration: number;
  putt: Vec2[] | null;
}

export type SessionStatus = 'aiming' | 'animating' | 'holeComplete' | 'roundComplete';

export interface PlaySession {
  mode: 'practice' | 'tournament';
  courseId: string;
  golferId: string;
  round: number;
  holeNumber: number;
  /** Practice sessions can be a single hole or all eighteen. */
  holesToPlay: number[];
  holeIndex: number;

  ball: Vec2;
  lie: LieType;
  deepBunker: boolean;
  onTee: boolean;
  strokesThisHole: number;
  puttsThisHole: number;
  penaltiesThisHole: number;
  girStroke: number | null;
  fairwayHit: boolean | null;
  driveDistance: number | null;

  holeScores: (number | null)[];
  stats: RoundStats;
  shots: ShotRecord[];
  log: string[];

  club: ClubId;
  shotType: ShotTypeId;
  target: Vec2;
  /** Set when the player has nudged the aim off the default. */
  aimTouched: boolean;

  /** Putting is a choice, not an aim: these track the hole's putting state. */
  puttsThisHoleStats: PuttingStats;
  firstPuttFeet: number;
  strokesGainedBaseline: number;
  situation: PuttSituation;

  status: SessionStatus;
  animation: FlightAnimation | null;
  lastResult: { quality: string; note: string; distance: number; toPin: number } | null;

  conditions: Conditions;
  touch: DailyTouch;
  pressure: number;
  shotIndex: number;
  seed: string;
  /** Where the ball was at the start of the stroke, for stroke-and-distance. */
  strokeStart: Vec2;
}

export interface SessionSetup {
  mode: 'practice' | 'tournament';
  golfer: Golfer;
  courseId: string;
  round: number;
  holes?: number[];
  conditions: Conditions;
  seed?: string;
  /** Leaderboard context, for pressure. */
  standing?: { behind: number; position: number; toCut: number | null; fieldSize: number };
}

export function emptyRoundStats(): RoundStats {
  return {
    putts: 0, putting: emptyPuttingStats(), girHit: 0, girAttempts: 0, fairwaysHit: 0, fairwayAttempts: 0,
    driveTotal: 0, drives: 0, penalties: 0, eagles: 0, birdies: 0, pars: 0,
    bogeys: 0, doubles: 0, scrambleSaves: 0, scrambleAttempts: 0,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function sessionHole(session: PlaySession): HoleGeometry {
  const course = COURSE_BY_ID[session.courseId];
  const base = holeGeometry(course, session.holeNumber);
  return withPin(base, pinForRound(base, session.round));
}

export function sessionContext(session: PlaySession, golfer: Golfer): ShotContext {
  return {
    hole: sessionHole(session),
    golfer,
    ball: session.ball,
    lie: session.lie,
    onTee: session.onTee,
    conditions: session.conditions,
    shotIndex: session.shotIndex,
    pressure: session.pressure,
    deepBunker: session.deepBunker,
    touch: session.touch,
  };
}

/**
 * A sensible opening target: the fat of the fairway, or — on the green — the
 * line the read says to start the ball on. Aiming a putt at the hole itself is
 * the one aim the player would never choose, so it is a bad default.
 */
export function defaultTarget(session: PlaySession, golfer: Golfer): Vec2 {
  // On the green there is nothing to aim: the hole is the target and the
  // strategy is the decision.
  if (session.lie === 'green') return sessionHole(session).pin;
  const ctx = sessionContext(session, golfer);
  const plan = chooseShot(ctx, createRng(`${session.seed}:suggest:${session.holeNumber}:${session.strokesThisHole}`), false);
  return plan.request.target;
}

/** The club the caddie would hand over for this target. */
export function suggestedClub(session: PlaySession, golfer: Golfer, target: Vec2): ClubId {
  const hole = sessionHole(session);
  const distance = dist(session.ball, target);
  if (session.lie === 'green') return 'P';
  if (session.lie === 'greensideBunker') return distance > 28 ? 'SW' : 'LW';
  const elevation = hole.elevationAt(target) - hole.elevationAt(session.ball);
  const playsLike = distance + elevation / 3;
  const legal = legalClubs({ ...sessionContext(session, golfer) });
  const preferred = clubForDistance(golfer, playsLike);
  if (legal.some((c) => c.id === preferred.id)) return preferred.id;
  // Out of a bad lie, take the longest club that is playable.
  return legal.length > 0 ? legal[legal.length - 1].id : 'SW';
}

export function suggestedShotType(session: PlaySession, target: Vec2): ShotTypeId {
  const distance = dist(session.ball, target);
  if (session.lie === 'green') return 'putt';
  if (session.lie === 'greensideBunker') return 'explosion';
  if (distance <= 22) return 'chip';
  if (distance <= 50) return 'pitch';
  return 'full';
}

// ---------------------------------------------------------------------------
// Creating and advancing
// ---------------------------------------------------------------------------

export function createSession(setup: SessionSetup): PlaySession {
  const holes = setup.holes ?? Array.from({ length: 18 }, (_, i) => i + 1);
  const seed = setup.seed ?? `session:${setup.golfer.id}:${setup.courseId}:${Date.now()}`;
  const session: PlaySession = {
    mode: setup.mode,
    courseId: setup.courseId,
    golferId: setup.golfer.id,
    round: setup.round,
    holeNumber: holes[0],
    holesToPlay: holes,
    holeIndex: 0,
    ball: { x: 0, y: 0 },
    lie: 'tee',
    deepBunker: false,
    onTee: true,
    strokesThisHole: 0,
    puttsThisHole: 0,
    penaltiesThisHole: 0,
    girStroke: null,
    fairwayHit: null,
    driveDistance: null,
    holeScores: new Array(18).fill(null),
    stats: emptyRoundStats(),
    shots: [],
    log: [],
    club: 'D',
    shotType: 'full',
    target: { x: 0, y: 200 },
    aimTouched: false,
    status: 'aiming',
    animation: null,
    lastResult: null,
    puttsThisHoleStats: emptyPuttingStats(),
    firstPuttFeet: 0,
    strokesGainedBaseline: 0,
    situation: {
      round: setup.round,
      behind: setup.standing?.behind ?? 3,
      holesRemaining: 40,
      toPar: 0,
    },
    conditions: setup.conditions,
    touch: dailyTouch(setup.golfer, createRng(`${seed}:touch:${setup.round}`)),
    pressure: 0.1,
    shotIndex: 0,
    seed,
    strokeStart: { x: 0, y: 0 },
  };
  return startHole(session, setup.golfer, holes[0], setup.standing);
}

export function startHole(
  session: PlaySession,
  golfer: Golfer,
  holeNumber: number,
  standing?: SessionSetup['standing'],
): PlaySession {
  const next: PlaySession = {
    ...session,
    holeNumber,
    ball: { x: 0, y: 0 },
    lie: 'tee',
    deepBunker: false,
    onTee: true,
    strokesThisHole: 0,
    puttsThisHole: 0,
    penaltiesThisHole: 0,
    girStroke: null,
    fairwayHit: null,
    driveDistance: null,
    shots: [],
    status: 'aiming',
    animation: null,
    lastResult: null,
    aimTouched: false,
    puttsThisHoleStats: emptyPuttingStats(),
    firstPuttFeet: 0,
    strokesGainedBaseline: 0,
  };
  const hole = sessionHole(next);
  next.ball = hole.tee;
  next.strokeStart = hole.tee;
  next.pressure = pressureFor({
    round: next.round,
    hole: holeNumber,
    behind: standing?.behind ?? 3,
    position: standing?.position ?? 20,
    toCut: standing?.toCut ?? null,
    holeIndex: hole.spec.index,
    fieldSize: standing?.fieldSize ?? 50,
  });
  next.situation = {
    round: next.round,
    behind: standing?.behind ?? 3,
    holesRemaining: next.mode === 'tournament' ? (4 - next.round) * 18 + (19 - holeNumber) : 40,
    toPar: 0,
  };
  next.target = defaultTarget(next, golfer);
  next.club = suggestedClub(next, golfer, next.target);
  next.shotType = suggestedShotType(next, next.target);
  return next;
}

/** Point the aim somewhere; the caddie re-clubs unless the player has overridden it. */
export function setTarget(session: PlaySession, golfer: Golfer, target: Vec2, keepClub = false): PlaySession {
  const next = { ...session, target, aimTouched: true };
  if (!keepClub) {
    next.club = suggestedClub(next, golfer, target);
    next.shotType = suggestedShotType(next, target);
  } else if (!availableShotTypes(sessionContext(next, golfer), dist(next.ball, target)).includes(next.shotType)) {
    next.shotType = suggestedShotType(next, target);
  }
  return next;
}

export function selectClub(session: PlaySession, golfer: Golfer, club: ClubId): PlaySession {
  const next = { ...session, club };
  const distance = dist(next.ball, next.target);
  if (club === 'P') {
    next.shotType = 'putt';
    return next;
  }
  if (next.shotType === 'putt') next.shotType = suggestedShotType(next, next.target);
  const types = availableShotTypes(sessionContext(next, golfer), distance);
  if (!types.includes(next.shotType)) next.shotType = types[0];
  // Re-aim a full swing at the club's own distance if the player has not aimed yet.
  if (!next.aimTouched) {
    const reach = bagFor(golfer)[club].total;
    const direction = norm(sub(next.target, next.ball));
    if (reach < dist(next.ball, next.target) - 10) {
      next.target = add(next.ball, scale(direction, reach));
    }
  }
  return next;
}

export function selectShotType(session: PlaySession, shotType: ShotTypeId): PlaySession {
  return { ...session, shotType };
}

/** Nudge the aim sideways, in yards, for players who would rather not click precisely. */
export function nudgeAim(session: PlaySession, yards: number): PlaySession {
  const direction = norm(sub(session.target, session.ball));
  const side = { x: direction.y, y: -direction.x };
  return { ...session, target: add(session.target, scale(side, yards)), aimTouched: true };
}

/** Push the aim further away or pull it back, in yards. */
export function nudgeDistance(session: PlaySession, yards: number): PlaySession {
  const direction = norm(sub(session.target, session.ball));
  return { ...session, target: add(session.target, scale(direction, yards)), aimTouched: true };
}

// ---------------------------------------------------------------------------
// The shot
// ---------------------------------------------------------------------------

export interface CurrentPlan {
  kind: 'swing';
  plan: ShotPlan;
}
export interface CurrentPutt {
  kind: 'putt';
  decision: PuttDecision;
}
export type PlanView = CurrentPlan | CurrentPutt;

export function isPutting(session: PlaySession): boolean {
  return session.lie === 'green';
}

export function currentPlan(session: PlaySession, golfer: Golfer): PlanView {
  const ctx = sessionContext(session, golfer);
  if (isPutting(session)) {
    const hole = sessionHole(session);
    return { kind: 'putt', decision: puttDecision(ctx, session.strokesThisHole, hole.spec.par) };
  }
  return { kind: 'swing', plan: planShot(ctx, { club: session.club, shotType: session.shotType, target: session.target }) };
}

export interface HitOutcome {
  session: PlaySession;
  swing?: ShotResult;
  putt?: PuttResult;
}

/**
 * Play the putt with the chosen strategy. No aiming, no power meter: the player
 * has already made the only decision there is, and this rolls the ball.
 */
export function puttWith(session: PlaySession, golfer: Golfer, intent: PuttIntentId): HitOutcome {
  const ctx = sessionContext(session, golfer);
  const hole = sessionHole(session);
  const rng: Rng = createRng(`${session.seed}:${session.holeNumber}:putt:${session.strokesThisHole}:${session.shotIndex}`);
  const decision = puttDecision(ctx, session.strokesThisHole, hole.spec.par);
  const situation: PuttSituation = { ...session.situation, toPar: session.strokesThisHole + 1 - hole.spec.par };
  void situation;
  const result = resolvePutt(ctx, intent, rng, decision.read);

  const next: PlaySession = {
    ...session,
    strokeStart: session.ball,
    shotIndex: session.shotIndex + 1,
    puttsThisHoleStats: { ...session.puttsThisHoleStats,
      madeByBand: [...session.puttsThisHoleStats.madeByBand],
      attemptsByBand: [...session.puttsThisHoleStats.attemptsByBand] },
  };

  if (session.puttsThisHole === 0) {
    next.puttsThisHoleStats.greensPutted++;
    next.puttsThisHoleStats.firstPuttFeet += decision.read.distanceFeet;
    next.firstPuttFeet = decision.read.distanceFeet;
    next.strokesGainedBaseline = strokesToHoleOut('green', decision.read.distanceFeet / 3);
    if (decision.read.distanceFeet >= 25) next.puttsThisHoleStats.lagAttempts++;
  }
  const band = puttBand(decision.read.distanceFeet);
  next.puttsThisHoleStats.attemptsByBand[band]++;
  if (result.holed) next.puttsThisHoleStats.madeByBand[band]++;
  if (session.pressure >= 0.5) {
    next.puttsThisHoleStats.pressureAttempts++;
    if (result.holed) next.puttsThisHoleStats.pressureMade++;
  }
  if (session.puttsThisHole === 0 && next.firstPuttFeet >= 25) {
    next.puttsThisHoleStats.lagLeaveFeet += result.holed ? 0 : result.leaveFeet;
  }

  next.strokesThisHole++;
  next.puttsThisHole++;
  next.stats = { ...session.stats, putts: session.stats.putts + 1 };
  next.shots = [
    ...session.shots,
    {
      stroke: next.strokesThisHole,
      club: 'P',
      shotType: 'putt',
      puttIntent: intent,
      from: session.ball,
      to: result.final,
      lieBefore: session.lie,
      lieAfter: 'green',
      distance: decision.read.distanceFeet / 3,
      toPinAfter: result.holed ? 0 : result.leaveFeet / 3,
      penalty: 0,
      holed: result.holed,
      quality: result.holed ? 'Holed' : `${result.leaveFeet.toFixed(1)} ft left`,
      note: result.note,
    },
  ];
  next.animation = {
    path: [],
    rollPath: [],
    duration: 0.8 + Math.min(1.5, decision.read.distanceFeet * 0.022),
    putt: result.path,
  };
  next.lastResult = {
    quality: result.holed ? 'Holed' : 'Missed',
    note: result.note,
    distance: decision.read.distanceFeet / 3,
    toPin: result.holed ? 0 : result.leaveFeet / 3,
  };
  next.ball = result.final;
  next.lie = 'green';
  next.status = 'animating';
  next.log = [...session.log, puttLine(next.strokesThisHole, intent, decision, result)];
  return { session: next, putt: result };
}

/** Play the shot. The session comes back in `animating`. */
export function hit(session: PlaySession, golfer: Golfer): HitOutcome {
  const ctx = sessionContext(session, golfer);
  const rng: Rng = createRng(`${session.seed}:${session.holeNumber}:${session.strokesThisHole}:${session.shotIndex}`);
  const next: PlaySession = { ...session, strokeStart: session.ball, shotIndex: session.shotIndex + 1 };

  const plan = planShot(ctx, { club: session.club, shotType: session.shotType, target: session.target });
  const result = resolveShot(ctx, plan, rng);
  next.strokesThisHole += 1 + result.penalty;
  next.penaltiesThisHole += result.penalty;
  next.stats.penalties += result.penalty;
  if (session.onTee && sessionHole(session).spec.par !== 3) {
    next.driveDistance = result.total;
    next.fairwayHit = result.finalLie === 'fairway' || result.finalLie === 'firstCut';
  }
  next.shots = [
    ...session.shots,
    {
      stroke: next.strokesThisHole - result.penalty,
      club: session.club,
      shotType: session.shotType,
      from: session.ball,
      to: result.final,
      lieBefore: session.lie,
      lieAfter: result.finalLie,
      distance: result.total,
      toPinAfter: result.holed ? 0 : dist(result.final, sessionHole(session).pin),
      penalty: result.penalty,
      holed: result.holed,
      quality: result.quality,
      note: result.notes.join(' '),
    },
  ];
  next.animation = {
    path: result.path,
    rollPath: result.rollPath,
    duration: Math.min(3.4, 1.0 + result.carry / 120),
    putt: null,
  };
  next.lastResult = {
    quality: result.quality,
    note: result.notes.join(' '),
    distance: result.total,
    toPin: result.holed ? 0 : dist(result.final, sessionHole(session).pin),
  };
  next.ball = result.final;
  const info = terrainAt(sessionHole(session), result.final, { onTee: false });
  next.lie = result.holed ? 'green' : info.lie;
  next.deepBunker = info.deepBunker;
  next.onTee = false;
  next.status = 'animating';
  next.log = [...session.log, swingLine(next.strokesThisHole - result.penalty, session.club, plan, result)];
  return { session: next, swing: result };
}

/** Called when the animation finishes: settle the ball, or finish the hole. */
export function settle(session: PlaySession, golfer: Golfer): PlaySession {
  const hole = sessionHole(session);
  const next: PlaySession = { ...session, animation: null };
  const holed = session.shots[session.shots.length - 1]?.holed ?? false;

  if (session.lie === 'green' && session.girStroke === null && !holed) {
    next.girStroke = session.strokesThisHole;
  }

  if (holed) {
    return completeHole(next, golfer);
  }
  if (session.strokesThisHole >= 12) {
    return completeHole(next, golfer);
  }

  next.status = 'aiming';
  next.aimTouched = false;
  next.target = defaultTarget(next, golfer);
  next.club = suggestedClub(next, golfer, next.target);
  next.shotType = suggestedShotType(next, next.target);
  void hole;
  return next;
}

function completeHole(session: PlaySession, golfer: Golfer): PlaySession {
  const hole = sessionHole(session);
  const par = hole.spec.par;
  const next: PlaySession = { ...session };
  const strokes = session.strokesThisHole;
  next.holeScores = [...session.holeScores];
  next.holeScores[hole.spec.number - 1] = strokes;

  const stats = { ...session.stats, putting: session.stats.putting };
  stats.girAttempts++;
  const gir = session.girStroke !== null && session.girStroke <= par - 2;
  if (gir) stats.girHit++;
  if (par !== 3) {
    stats.fairwayAttempts++;
    if (session.fairwayHit) stats.fairwaysHit++;
    if (session.driveDistance !== null) {
      stats.driveTotal += session.driveDistance;
      stats.drives++;
    }
  }
  if (!gir) {
    stats.scrambleAttempts++;
    if (strokes <= par) stats.scrambleSaves++;
  }
  const toPar = strokes - par;
  if (toPar <= -2) stats.eagles++;
  else if (toPar === -1) stats.birdies++;
  else if (toPar === 0) stats.pars++;
  else if (toPar === 1) stats.bogeys++;
  else stats.doubles++;

  const holePutting = { ...session.puttsThisHoleStats };
  if (session.puttsThisHole === 1) holePutting.onePutts++;
  else if (session.puttsThisHole === 2) holePutting.twoPutts++;
  else if (session.puttsThisHole >= 3) holePutting.threePutts++;
  if (session.puttsThisHole > 0) {
    holePutting.strokesGained += session.strokesGainedBaseline - session.puttsThisHole;
  }
  stats.putting = { ...stats.putting,
    madeByBand: [...stats.putting.madeByBand], attemptsByBand: [...stats.putting.attemptsByBand] };
  addPuttingStats(stats.putting, holePutting);
  next.stats = stats;

  golfer.fatigue = Math.min(100, golfer.fatigue + fatigueForHole(golfer, session.conditions.weather, hole.spec.yards));

  next.status = session.holeIndex >= session.holesToPlay.length - 1 ? 'roundComplete' : 'holeComplete';
  next.log = [...session.log, `— ${scoreName(toPar)} at the ${ordinal(hole.spec.number)}, ${strokes} (par ${par}).`];
  return next;
}

export function nextHole(session: PlaySession, golfer: Golfer, standing?: SessionSetup['standing']): PlaySession {
  if (session.holeIndex >= session.holesToPlay.length - 1) return { ...session, status: 'roundComplete' };
  const holeIndex = session.holeIndex + 1;
  const started = startHole({ ...session, holeIndex }, golfer, session.holesToPlay[holeIndex], standing);
  return started;
}

// ---------------------------------------------------------------------------
// Totals and commentary
// ---------------------------------------------------------------------------

export function roundTotal(session: PlaySession): number {
  return session.holeScores.reduce<number>((sum, score) => sum + (score ?? 0), 0);
}

export function roundToPar(session: PlaySession): number {
  const course = COURSE_BY_ID[session.courseId];
  let total = 0;
  let par = 0;
  session.holeScores.forEach((score, index) => {
    if (score === null) return;
    total += score;
    par += course.holes[index].par;
  });
  return total - par;
}

export function holesPlayed(session: PlaySession): number {
  return session.holeScores.filter((s) => s !== null).length;
}

export function scoreName(toPar: number): string {
  switch (toPar) {
    case -3: return 'Albatross';
    case -2: return 'Eagle';
    case -1: return 'Birdie';
    case 0: return 'Par';
    case 1: return 'Bogey';
    case 2: return 'Double bogey';
    case 3: return 'Triple bogey';
    default: return toPar > 0 ? `${toPar} over` : 'Something remarkable';
  }
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function swingLine(stroke: number, club: ClubId, plan: ShotPlan, result: ShotResult): string {
  const clubName = CLUB_BY_ID[club].name;
  const shape = SHOT_TYPES[plan.shotType];
  const lie = LIES[result.finalLie].name.toLowerCase();
  const shapeText = isShortGame(plan.shotType) ? `${shape.name.toLowerCase()} with the ${clubName.toLowerCase()}` : clubName;
  const miss = Math.abs(result.deviation) < 4 ? 'straight' : `${Math.round(Math.abs(result.deviation))} yards ${result.deviation > 0 ? 'right' : 'left'}`;
  if (result.penalty > 0) {
    return `${stroke}. ${shapeText}, ${Math.round(result.carry)} yards — ${result.notes.join(' ')}`;
  }
  if (result.holed) return `${stroke}. ${shapeText} from ${Math.round(plan.distanceToTarget)} yards — in the hole!`;
  return `${stroke}. ${shapeText}, ${Math.round(result.total)} yards (${miss}), ${Math.round(dist(result.final, plan.center) + 0)} yards from the target — ${lie}.`;
}

function puttLine(stroke: number, intent: PuttIntentId, decision: PuttDecision, result: PuttResult): string {
  const length = Math.round(decision.read.distanceFeet);
  const verb = PUTT_INTENTS[intent].verb;
  if (result.holed) return `${stroke}. From ${length} feet, ${verb} — holed.`;
  return `${stroke}. From ${length} feet, ${verb} — ${result.note.toLowerCase()}`;
}

/** Record the finished round into a tournament. */
export function toPlayerRound(session: PlaySession): { strokes: number; toPar: number; holeScores: number[]; stats: RoundStats } {
  const course = COURSE_BY_ID[session.courseId];
  const holeScores = session.holeScores.map((score, index) => score ?? course.holes[index].par);
  const strokes = holeScores.reduce((a, b) => a + b, 0);
  return { strokes, toPar: strokes - course.par, holeScores, stats: session.stats };
}

/** Tournament standing for pressure, from the live leaderboard. */
export function standingFor(tournament: Tournament, golferId: string, fieldSize: number): SessionSetup['standing'] {
  const board = tournament.leaderboard;
  const row = board.find((r) => r.golferId === golferId);
  const leader = board.find((r) => r.status === 'active');
  if (!row || !leader) return { behind: 3, position: 20, toCut: null, fieldSize };
  const cutRow = board.filter((r) => r.status === 'active')[29];
  return {
    behind: row.total - leader.total,
    position: row.position,
    toCut: cutRow ? row.total - cutRow.total : null,
    fieldSize,
  };
}

export function conditionsForSession(tournament: Tournament, round: number): Conditions {
  return conditionsFor(tournament.weather[round - 1], `${tournament.id}:${round}`);
}
