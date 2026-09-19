import type { Course } from '../../simulation/types';
import { COASTAL_CHAMPIONSHIP } from './coastal';
import { DESERT_CLASSIC } from './desert';
import { WOODLAND_NATIONAL } from './woodland';
import { REVERE_CONCORD } from './concord';
import { THE_RANCH } from './ranch';
import { PEBBLE_BEACH } from './pebble';
import { LINKS_COURSES } from './links';
import { DESERT_COURSES } from './desertCourses';
import { PARKLAND_COURSES } from './parkland';
import { withTees } from './tees';

/**
 * Twenty venues: one for every week of the season.
 *
 * Six are authored hole by hole — three of them traced off real photographs —
 * and fourteen are built from a design brief by `generate.ts`. Nothing
 * downstream can tell the difference, and neither can the audit, which is the
 * point: a generated hole is held to exactly the same rules as a drawn one.
 */
const BASE: readonly Course[] = [
  COASTAL_CHAMPIONSHIP, DESERT_CLASSIC, WOODLAND_NATIONAL, REVERE_CONCORD, THE_RANCH, PEBBLE_BEACH,
  ...LINKS_COURSES, ...DESERT_COURSES, ...PARKLAND_COURSES,
];

/**
 * One entry per venue for the menus — the default tee set — and every other set
 * of markers as its own playable Course beside it, sharing a baseId. Ids look
 * like `concord@black`, and everything downstream already keys on the id.
 */
export const COURSE_VARIANTS: readonly Course[] = BASE.flatMap((course) => withTees(course));
export const COURSES: readonly Course[] = COURSE_VARIANTS.filter(
  (course, index, all) => all.findIndex((other) => (other.baseId ?? other.id) === (course.baseId ?? course.id)) === index,
);

export const COURSE_BY_ID: Record<string, Course> = Object.fromEntries(
  COURSE_VARIANTS.flatMap((course) => [[course.id, course] as const, ...(course.baseId ? [[course.baseId, course] as const] : [])]).reverse(),
);

/** Every tee set a venue can be played from. */
export function teeSetsFor(course: Course): Course[] {
  const base = course.baseId ?? course.id;
  return COURSE_VARIANTS.filter((option) => (option.baseId ?? option.id) === base);
}

export { COASTAL_CHAMPIONSHIP, DESERT_CLASSIC, WOODLAND_NATIONAL, REVERE_CONCORD, THE_RANCH, PEBBLE_BEACH };
export * from './links';
export * from './desertCourses';
export * from './parkland';
