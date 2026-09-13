import type { Course } from '../../simulation/types';
import { COASTAL_CHAMPIONSHIP } from './coastal';
import { DESERT_CLASSIC } from './desert';
import { WOODLAND_NATIONAL } from './woodland';

/** Exactly three courses. Each one is a different examination. */
export const COURSES: readonly Course[] = [COASTAL_CHAMPIONSHIP, DESERT_CLASSIC, WOODLAND_NATIONAL];

export const COURSE_BY_ID: Record<string, Course> = Object.fromEntries(COURSES.map((c) => [c.id, c]));

export { COASTAL_CHAMPIONSHIP, DESERT_CLASSIC, WOODLAND_NATIONAL };
