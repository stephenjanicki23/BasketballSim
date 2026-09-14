/**
 * Tee sets.
 *
 * A course is one piece of ground with several sets of markers on it. The holes
 * are authored once, at one card, and every other card is the same hole with the
 * tee moved: distances measured *from the tee* move with it, distances measured
 * from the green stay exactly where they are, and nothing lateral moves at all,
 * because a back tee does not shift a fairway sideways or lift a green.
 *
 * Each tee set becomes its own Course object, sharing a `baseId`. Everything
 * downstream already keys on course id — the geometry cache, the lie grid, the
 * save file — so playing from the blue tees needs no engine changes whatsoever.
 */

import type { Course, HoleSpec, TeeSet } from '../../simulation/types';

/** Move a hole's tee to a new yardage. */
export function stretchHole(spec: HoleSpec, yards: number, index = spec.index): HoleSpec {
  const extra = yards - spec.yards;
  if (extra === 0 && index === spec.index) return spec;
  const at = (fraction: number) => (fraction * spec.yards + extra) / yards;
  const along = (value: number) => Math.round(value + extra);
  // A traced centreline is in yards from the tee: extending it means walking
  // back down its own opening bearing.
  const centreline = spec.centreline && extra !== 0
    ? (() => {
        const [first, second] = spec.centreline;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const length = Math.hypot(dx, dy) || 1;
        const back = { x: first.x - (dx / length) * extra, y: first.y - (dy / length) * extra };
        return [back, ...spec.centreline];
      })()
    : spec.centreline;

  return {
    ...spec,
    yards,
    index,
    centreline,
    doglegAt: at(spec.doglegAt),
    bends: spec.bends?.map((bend) => ({ ...bend, at: at(bend.at), turn: (bend.turn ?? 0.16) * (spec.yards / yards) })),
    widths: spec.widths?.map((width) => ({ ...width, at: at(width.at) })),
    landforms: spec.landforms?.map((form) => ({ ...form, at: at(form.at) })),
    bunkers: spec.bunkers.map((bunker) => ({ ...bunker, along: along(bunker.along) })),
    water: spec.water.map((water) => ({
      ...water,
      along: water.strip ? water.along : along(water.along),
      strip: water.strip && { ...water.strip, from: along(water.strip.from), to: along(water.strip.to) },
    })),
    waste: spec.waste?.map((waste) => ({ ...waste, from: along(waste.from), to: along(waste.to) })),
    groves: spec.groves?.map((grove) => ({ ...grove, from: along(grove.from), to: along(grove.to) })),
    specimens: spec.specimens?.map((tree) => ({ ...tree, along: along(tree.along) })),
  };
}

/**
 * Build the course as played from one tee set. The authored holes are the
 * reference card; every other set stretches from it.
 */
export function courseFromTee(base: Course, tee: TeeSet): Course {
  const holes = base.holes.map((spec, index) => stretchHole(spec, tee.yards[index], tee.index?.[index] ?? spec.index));
  return {
    ...base,
    id: `${base.baseId ?? base.id}@${tee.id}`,
    baseId: base.baseId ?? base.id,
    teeId: tee.id,
    holes,
    par: holes.reduce((sum, hole) => sum + hole.par, 0),
    yards: holes.reduce((sum, hole) => sum + hole.yards, 0),
  };
}

/** Every playable version of a course: one per tee set, the default first. */
export function withTees(base: Course): Course[] {
  if (!base.tees || base.tees.length === 0) return [base];
  const defaultId = base.teeId ?? base.tees[0].id;
  const ordered = [...base.tees].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0));
  return ordered.map((tee) => courseFromTee(base, tee));
}
