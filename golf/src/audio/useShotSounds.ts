/**
 * What the round sounds like.
 *
 * The session already says everything that matters — which club, out of what
 * lie, into what, and whether it went in — so the sound is a reaction to the
 * state rather than a second set of callbacks threaded through the engine. Two
 * moments make a noise: the strike, when the shot starts, and the landing, when
 * the flight ends. A hole finishing adds the crowd.
 */

import { useEffect, useRef } from 'react';
import { CLUB_BY_ID } from '../simulation/config';
import { COURSE_BY_ID } from '../data/courses';

import type { PlaySession, ShotRecord } from '../game/session';
import { playSfx, type SfxId } from './sfx';

/** Which club it sounded like. */
function strikeFor(shot: ShotRecord): SfxId {
  if (shot.shotType === 'putt') return 'putt';
  const family = CLUB_BY_ID[shot.club]?.family;
  if (family === 'driver') return 'drive';
  if (family === 'wood') return 'wood';
  if (family === 'wedge') return 'wedge';
  return 'iron';
}

/** How flush it was, 0.25 to 1, for the volume and the body of the strike. */
function powerFor(shot: ShotRecord): number {
  if (shot.lieBefore === 'greensideBunker' || shot.lieBefore === 'fairwayBunker') return 0.55;
  if (shot.quality.startsWith('Flushed')) return 1;
  if (shot.quality.startsWith('Middled')) return 0.88;
  if (shot.quality.startsWith('Slightly')) return 0.72;
  if (shot.quality.startsWith('Off the toe')) return 0.55;
  if (shot.quality.startsWith('Nowhere')) return 0.4;
  if (shot.quality.startsWith('Heavy') || shot.quality.startsWith('Thin')) return 0.45;
  return 0.8;
}

/** What it landed in. Null where silence is right — a putt that stays out. */
function landingFor(shot: ShotRecord): SfxId | null {
  if (shot.holed) return 'holed';
  if (shot.shotType === 'putt') return null;
  switch (shot.lieAfter) {
    case 'water': return 'splash';
    case 'fairwayBunker':
    case 'greensideBunker': return 'sand';
    case 'heavyRough':
    case 'deepRough':
    case 'lightRough':
    case 'pineStraw': return 'rough';
    case 'recovery': return 'timber';
    default: return 'bounce';
  }
}

export function useShotSounds(session: PlaySession | null): void {
  const lastShot = useRef('');
  const lastStatus = useRef<string | null>(null);
  const lastHole = useRef(-1);

  useEffect(() => {
    if (!session) {
      lastShot.current = '';
      lastStatus.current = null;
      return;
    }
    const shot = session.shots[session.shots.length - 1] ?? null;
    const key = `${session.holeNumber}:${session.shots.length}`;

    // The strike, as the shot leaves.
    if (shot && key !== lastShot.current && session.status === 'animating') {
      playSfx(strikeFor(shot), powerFor(shot));
    }
    lastShot.current = key;

    // The landing, as the flight ends.
    if (lastStatus.current === 'animating' && session.status !== 'animating' && shot) {
      const sound = landingFor(shot);
      if (sound) playSfx(sound);
    }

    // And the gallery, once the hole is done with. A birdie gets a cheer, a
    // double gets the other noise a crowd makes, and a par gets nothing —
    // applause on all eighteen would wear out in a round.
    if (session.status === 'holeComplete' && session.holeNumber !== lastHole.current) {
      lastHole.current = session.holeNumber;
      const par = COURSE_BY_ID[session.courseId]?.holes.find((hole) => hole.number === session.holeNumber)?.par;
      if (par) {
        const toPar = session.strokesThisHole - par;
        if (toPar <= -2) window.setTimeout(() => playSfx('cheer'), 260);
        else if (toPar === -1) window.setTimeout(() => playSfx('applause'), 300);
        else if (toPar >= 2) window.setTimeout(() => playSfx('groan'), 320);
      }
    }
    lastStatus.current = session.status;
  }, [session]);
}
