/**
 * Playing a hole.
 *
 * This is the module that makes the simulated tour honest: the fifty golfers in
 * the field do not roll dice against a rating, they stand over the ball, decide
 * what to hit and where to aim, and then play the shot through exactly the same
 * `planShot` / `resolveShot` pair the human player uses.
 *
 * The decision is made in expected strokes. For each candidate — club, shot
 * shape, aim point — the dispersion is integrated over the actual terrain, and
 * the golfer picks the line that leaves them closest to holing out. Course
 * management decides how much they discount a hazard; decision making decides
 * how often they simply get it wrong.
 */

import { type Vec2, add, dist, norm, perp, pointAlongPolyline, scale, sub } from './geometry';
import { type Rng, clamp } from './rng';
import { CLUB_BY_ID, LIES, type ShotTypeId } from './config';
import {
  type ShotContext,
  type ShotPlan,
  legalClubs,
  planShot,
  reachTable,
  resolveShot,
} from './shotEngine';
import { planPutt, resolvePutt } from './puttingEngine';
import { type DailyTouch, effective, fatigueForHole } from './golferEngine';
import { terrainAt } from './courseEngine';
import type { ClubId, Conditions, Golfer, HoleGeometry, LieType } from './types';

export interface ShotLog {
  stroke: number;
  club: ClubId;
  shotType: ShotTypeId | 'putt';
  from: Vec2;
  to: Vec2;
  lieBefore: LieType;
  lieAfter: LieType;
  distance: number;
  toPinBefore: number;
  toPinAfter: number;
  penalty: number;
  holed: boolean;
  quality: string;
  note: string;
}

export interface HoleOutcome {
  hole: number;
  par: number;
  strokes: number;
  toPar: number;
  putts: number;
  penalties: number;
  /** On the green in regulation (par minus two). */
  gir: boolean;
  /** Null on a par 3, where nobody is trying to hit a fairway. */
  fairwayHit: boolean | null;
  driveDistance: number | null;
  /** Missed the green in regulation but still made par or better. */
  scrambled: boolean | null;
  shots: ShotLog[];
}

export interface PlayHoleOptions {
  hole: HoleGeometry;
  golfer: Golfer;
  conditions: Conditions;
  rng: Rng;
  /** 0–1. */
  pressure: number;
  /** Fewer candidate shots, for simulating a whole season quickly. */
  fast?: boolean;
  /** Shot counter, so gusts vary through the round. */
  shotSeed?: number;
  /** What the golfer has with them today; generated once per round. */
  touch?: DailyTouch;
}

const MAX_STROKES = 12;

// ---------------------------------------------------------------------------
// Choosing a shot
// ---------------------------------------------------------------------------

interface Candidate {
  club: ClubId;
  shotType: ShotTypeId;
  target: Vec2;
}

/** Perpendicular aim offsets from a target. */
function offsetTargets(ball: Vec2, target: Vec2, offsets: number[]): Vec2[] {
  const line = norm(sub(target, ball));
  const side = perp(line);
  return offsets.map((o) => add(target, scale(side, o)));
}

function candidatesFor(ctx: ShotContext, fast: boolean): Candidate[] {
  const { hole, ball } = ctx;
  const toPin = dist(ball, hole.pin);
  const clubs = legalClubs(ctx);
  const candidates: Candidate[] = [];

  // --- Around the green ---------------------------------------------------
  if (ctx.lie === 'greensideBunker') {
    for (const club of ['SW', 'LW'] as ClubId[]) {
      if (!clubs.some((c) => c.id === club)) continue;
      candidates.push({ club, shotType: 'explosion', target: hole.pin });
    }
    if (candidates.length === 0) candidates.push({ club: 'SW', shotType: 'explosion', target: hole.pin });
    return candidates;
  }

  if (toPin <= 45) {
    const wedges: ClubId[] = toPin <= 20 ? ['LW', 'SW', 'PW'] : ['SW', 'GW', 'PW'];
    for (const club of wedges) {
      if (!clubs.some((c) => c.id === club)) continue;
      candidates.push({ club, shotType: toPin <= 22 ? 'chip' : 'pitch', target: hole.pin });
    }
    if (toPin <= 30 && !fast) {
      candidates.push({ club: 'LW', shotType: 'flop', target: hole.pin });
      candidates.push({ club: '9i', shotType: 'chip', target: hole.pin });
    }
    // Play to the fat of the green rather than at a tucked flag.
    candidates.push({ club: toPin <= 22 ? 'SW' : 'GW', shotType: toPin <= 22 ? 'chip' : 'pitch', target: hole.greenCenter });
    return candidates;
  }

  const lineToPin = norm(sub(hole.pin, ball));

  // --- Tee shot on a par 4 or 5 ------------------------------------------
  if (ctx.onTee && hole.spec.par !== 3) {
    const teeClubs: ClubId[] = fast ? ['D', '3W', '5i'] : ['D', '3W', '5W', '4i', '7i'];
    const offsets = fast ? [0, -16, 16] : [0, -14, 14, -28, 28];
    const projection = terrainAt(hole, ball);
    const reaches = reachTable(ctx, lineToPin);
    for (const club of teeClubs) {
      if (!clubs.some((c) => c.id === club)) continue;
      const reach = reaches.get(club) ?? 0;
      if (reach < 120) continue;
      const along = Math.min(projection.along + reach, hole.centerlineLength - 12);
      const base = pointAlongPolyline(hole.centerline, along).point;
      for (const target of offsetTargets(ball, base, offsets)) {
        candidates.push({ club, shotType: 'full', target });
      }
    }
    if (!fast && ctx.conditions.weather.windSpeed > 16) {
      const reach = reachTable(ctx, lineToPin, 'punch').get('D') ?? 0;
      const base = pointAlongPolyline(hole.centerline, Math.min(projection.along + reach, hole.centerlineLength - 12)).point;
      candidates.push({ club: 'D', shotType: 'punch', target: base });
    }
    return candidates;
  }

  // --- Everything else: a shot at a green, or a lay-up -------------------
  const allReaches = reachTable(ctx, lineToPin);
  const reachByClub = new Map<ClubId, number>();
  for (const club of clubs) reachByClub.set(club.id, allReaches.get(club.id) ?? 0);

  // The club that gets closest to the flag, plus one either side.
  const sorted = [...reachByClub.entries()].sort((a, b) => Math.abs(a[1] - toPin) - Math.abs(b[1] - toPin));
  const chosen = sorted.slice(0, fast ? 2 : 3).map(([club]) => club);
  const canReach = sorted.some(([, reach]) => reach >= toPin - 4);

  const offsets = fast ? [0, -11, 11] : [0, -9, 9, -20, 20];
  for (const club of chosen) {
    for (const target of offsetTargets(ball, hole.pin, offsets)) {
      candidates.push({ club, shotType: 'full', target });
    }
  }
  // Middle of the green is always an option.
  candidates.push({ club: chosen[0], shotType: 'full', target: hole.greenCenter });

  if (!fast && ctx.conditions.weather.windSpeed > 15 && chosen.length > 0) {
    candidates.push({ club: chosen[0], shotType: 'punch', target: hole.pin });
  }

  // Cannot get there, or in trouble: lay up to a comfortable number.
  if (!canReach || LIES[ctx.lie].maxCarryRatio < 0.8) {
    const layupDistance = Math.max(60, toPin - 100);
    const layup = add(ball, scale(lineToPin, layupDistance));
    const longest = sorted.reduce((best, entry) => (entry[1] > best[1] ? entry : best), sorted[0]);
    const layupClub = [...reachByClub.entries()].sort(
      (a, b) => Math.abs(a[1] - layupDistance) - Math.abs(b[1] - layupDistance),
    )[0][0];
    candidates.push({ club: layupClub, shotType: 'full', target: layup });
    if (longest && longest[1] < toPin) {
      candidates.push({ club: longest[0], shotType: 'full', target: add(ball, scale(lineToPin, longest[1])) });
    }
  }

  return candidates;
}

/**
 * How much this golfer inflates the cost of a hazard. A course manager plays
 * away from water they could probably carry; a volatile superstar does not.
 */
function riskAversion(golfer: Golfer): number {
  const care = (effective(golfer, 'courseManagement') + effective(golfer, 'decisionMaking')) / 2;
  return clamp((care - 50) * 0.012, -0.28, 0.62);
}

export function chooseShot(ctx: ShotContext, rng: Rng, fast = false): ShotPlan {
  const candidates = candidatesFor(ctx, fast);
  const aversion = riskAversion(ctx.golfer);
  const judgement = (100 - effective(ctx.golfer, 'decisionMaking')) * 0.0045;

  let best: ShotPlan | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const plan = planShot(ctx, candidate, { fastOdds: true });
    const odds = plan.odds;
    let score =
      odds.expectedStrokes +
      aversion * (odds.water * 1.15 + odds.ob * 1.6 + odds.trees * 0.45 + odds.sand * 0.12);
    // Nobody reads a golf course perfectly. Weak decision makers read it worse.
    score += rng.normal() * judgement;
    if (score < bestScore) {
      bestScore = score;
      best = plan;
    }
  }
  return best ?? planShot(ctx, { club: '7i', shotType: 'full', target: ctx.hole.pin });
}

// ---------------------------------------------------------------------------
// Playing the hole
// ---------------------------------------------------------------------------

export function playHole(options: PlayHoleOptions): HoleOutcome {
  const { hole, golfer, conditions, rng, pressure, fast } = options;
  const shots: ShotLog[] = [];
  let ball = hole.tee;
  let strokes = 0;
  let putts = 0;
  let penalties = 0;
  let onTee = true;
  let shotIndex = options.shotSeed ?? 0;
  let fairwayHit: boolean | null = hole.spec.par === 3 ? null : false;
  let driveDistance: number | null = null;
  let girStroke: number | null = null;

  while (strokes < MAX_STROKES) {
    const info = terrainAt(hole, ball, { onTee });
    const lie: LieType = info.lie;
    const ctx: ShotContext = {
      hole,
      golfer,
      ball,
      lie,
      onTee,
      conditions,
      shotIndex: shotIndex++,
      pressure,
      deepBunker: info.deepBunker,
      touch: options.touch,
    };
    const toPinBefore = dist(ball, hole.pin);

    if (lie === 'green') {
      if (girStroke === null) girStroke = strokes;
      const provisional = planPutt(ctx, hole.pin);
      const plan = planPutt(ctx, provisional.recommendedAim);
      const result = resolvePutt(ctx, plan, rng);
      strokes++;
      putts++;
      shots.push({
        stroke: strokes,
        club: 'P',
        shotType: 'putt',
        from: ball,
        to: result.final,
        lieBefore: 'green',
        lieAfter: result.holed ? 'green' : 'green',
        distance: plan.distanceFeet / 3,
        toPinBefore,
        toPinAfter: result.holed ? 0 : result.leaveFeet / 3,
        penalty: 0,
        holed: result.holed,
        quality: result.holed ? 'Holed' : `${result.leaveFeet.toFixed(1)} ft left`,
        note: result.notes.join(' '),
      });
      if (result.holed) break;
      ball = result.final;
      onTee = false;
      continue;
    }

    const plan = chooseShot(ctx, rng, fast);
    const result = resolveShot(ctx, plan, rng);
    strokes++;
    penalties += result.penalty;
    strokes += result.penalty;

    if (onTee && hole.spec.par !== 3) {
      driveDistance = result.total;
      fairwayHit = result.finalLie === 'fairway' || result.finalLie === 'firstCut';
    }

    shots.push({
      stroke: strokes - result.penalty,
      club: plan.club.id,
      shotType: plan.shotType,
      from: ball,
      to: result.final,
      lieBefore: lie,
      lieAfter: result.finalLie,
      distance: result.total,
      toPinBefore,
      toPinAfter: result.holed ? 0 : dist(result.final, hole.pin),
      penalty: result.penalty,
      holed: result.holed,
      quality: result.quality,
      note: result.notes.join(' '),
    });

    if (result.holed) break;
    ball = result.final;
    onTee = false;
  }

  const par = hole.spec.par;
  const regulation = par - 2;
  const gir = girStroke !== null && girStroke <= regulation;
  const scrambled = gir ? null : strokes <= par;

  golfer.fatigue = clamp(golfer.fatigue + fatigueForHole(golfer, conditions.weather, hole.spec.yards), 0, 100);

  return {
    hole: hole.spec.number,
    par,
    strokes,
    toPar: strokes - par,
    putts,
    penalties,
    gir,
    fairwayHit,
    driveDistance,
    scrambled,
    shots,
  };
}

/** Club label for the log, including the putter. */
export function clubLabel(club: ClubId): string {
  return CLUB_BY_ID[club].short;
}
