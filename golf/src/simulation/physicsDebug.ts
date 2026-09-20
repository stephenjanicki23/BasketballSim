/**
 * The physics, with its working shown.
 *
 * One function that takes a planned shot and lays out every number the model
 * arrived at, plus the list of modifiers that moved each one. The developer
 * overlay renders it and the automated physics tests assert on it, so what the
 * panel shows and what the tests check are the same thing by construction —
 * a debug view that can drift from the engine is worse than none.
 */

import { CLUB_SURFACE } from './surfaces';
import { SHOT_TYPES } from './config';
import type { PhysicsModifier } from './impact';
import type { ShotPlan } from './shotEngine';

export interface PhysicsRow {
  label: string;
  value: string;
}

export interface PhysicsReport {
  surface: PhysicsRow[];
  club: PhysicsRow[];
  impact: PhysicsRow[];
  flight: PhysicsRow[];
  landing: PhysicsRow[];
  modifiers: PhysicsModifier[];
}

function n(value: number, digits = 0): string {
  return value.toFixed(digits);
}

export function physicsReport(plan: ShotPlan): PhysicsReport {
  const lie = plan.lieState;
  const s = lie.surface;
  const c = plan.contact;
  const clubProfile = CLUB_SURFACE[plan.club.family];
  const profile = SHOT_TYPES[plan.shotType];

  return {
    surface: [
      { label: 'Surface', value: s.name },
      { label: 'Material', value: s.kind === 'sand' ? `sand, ${n(s.sandDepth, 1)}″ deep` : s.kind },
      s.kind === 'sand'
        ? { label: 'Sand depth', value: `${n(s.sandDepth, 1)}″` }
        : { label: 'Grass height', value: `${n(s.grassHeight, 2)}″` },
      { label: 'Density / stiffness', value: `${n(s.grassDensity * 100)}% / ${n(s.grassStiffness * 100)}%` },
      { label: 'Lie quality', value: `${n(lie.quality * 100)}%${lie.sittingUp ? ' · sitting up' : ''}` },
      { label: 'Ball depth', value: `${n(lie.ballDepth * 100)}% buried` },
      { label: 'Grass above ball', value: `${n(lie.grassAbove, 2)}″` },
      { label: 'Moisture', value: `${n(lie.moisture * 100)}%` },
      { label: 'Firmness', value: `${n(lie.firmness * 100)}%` },
    ],
    club: [
      { label: 'Club', value: `${plan.club.name} · ${profile.name}` },
      { label: 'Dynamic loft', value: `${n(c.dynamicLoft, 1)}°` },
      { label: 'Attack angle', value: `${c.attackAngle >= 0 ? '+' : ''}${n(c.attackAngle, 1)}°` },
      { label: 'Grass sensitivity', value: `${n(clubProfile.grassSensitivity * 100)}%` },
      { label: 'Escape', value: `${n(clubProfile.escape * 100)}%` },
      { label: 'Swing', value: `${n(plan.swingScale * 100)}% of full` },
    ],
    impact: [
      { label: 'Ball speed', value: `${n(plan.club.ballSpeed * c.ballSpeedFactor * Math.pow(plan.swingScale, 0.55), 1)} mph` },
      { label: 'Launch angle', value: `${n(plan.club.launch + c.launchDelta, 1)}°` },
      { label: 'Backspin', value: `${n(c.backspin)} rpm` },
      { label: 'Sidespin', value: `${c.sidespin >= 0 ? '+' : ''}${n(c.sidespin)} rpm` },
      { label: 'Spin axis', value: `${c.spinAxis >= 0 ? '+' : ''}${n(c.spinAxis, 1)}°` },
      { label: 'Total spin', value: `${n(c.totalSpin)} rpm` },
      { label: 'Contact quality', value: `${n(c.contactQuality * 100)}%` },
      { label: 'Grass interference', value: `${n(c.grassInterference * 100)}%` },
      { label: 'Digging', value: `${n(c.digging * 100)}%` },
      { label: 'Flyer chance', value: `${n(c.flyerChance * 100)}%` },
    ],
    flight: [
      { label: 'Carry', value: `${n(plan.expectedCarry, 1)} yd` },
      { label: 'Peak height', value: `${n(plan.apex / 3, 1)} yd` },
      { label: 'Descent angle', value: `${n(plan.descent, 1)}°` },
      { label: 'Hang time', value: `${n(plan.flight.hangTime, 2)} s` },
    ],
    landing: [
      { label: 'Landing speed', value: `${n(plan.landingSpeed, 1)} mph` },
      { label: 'Spin at landing', value: `${n(plan.flight.landingSpin)} rpm` },
      { label: 'Roll', value: `${n(plan.expectedRoll, 1)} yd` },
      { label: 'Total', value: `${n(plan.expectedTotal, 1)} yd` },
      { label: 'Dispersion', value: `±${n(plan.sigmaLat, 1)} yd across, ±${n(plan.sigmaLong, 1)} yd long` },
    ],
    modifiers: c.modifiers,
  };
}

/** "− 18% ball speed", "+ 1.9° launch" — one modifier, as a line of text. */
export function describeModifier(modifier: PhysicsModifier): string {
  const channel: Record<PhysicsModifier['channel'], string> = {
    ballSpeed: 'ball speed',
    spin: 'spin',
    launch: 'launch',
    contact: 'contact',
    dispersion: 'dispersion',
    control: 'distance control',
    roll: 'rollout',
  };
  if (modifier.delta) {
    return `${modifier.value >= 0 ? '+' : '−'} ${Math.abs(modifier.value).toFixed(1)}° ${channel[modifier.channel]}`;
  }
  const pct = (modifier.value - 1) * 100;
  if (modifier.channel === 'contact') return `${(modifier.value * 100).toFixed(0)}% ${channel[modifier.channel]}`;
  return `${pct >= 0 ? '+' : '−'} ${Math.abs(pct).toFixed(0)}% ${channel[modifier.channel]}`;
}
