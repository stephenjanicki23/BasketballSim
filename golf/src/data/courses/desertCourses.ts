/**
 * Four more desert venues, separated by altitude and by what the desert is.
 *
 * Desert golf reads as one thing from a distance and is not: Vermilion is a
 * wide, hot, sea-level target course where the ball flies and nothing is in the
 * way, Caldera is at 6,800 feet where a 7 iron goes 195, Red Butte is cut
 * through rock with no room at all, and Ocotillo is short enough that the
 * professionals hit 3 wood off half the tees and still cannot get at it.
 */

import { buildCourse, type CourseBrief } from './generate';

const RED_BUTTE: CourseBrief = {
  id: 'redbutte',
  name: 'Red Butte',
  location: 'Moab, Utah',
  style: 'desert',
  altitude: 4400,
  surroundWidth: 70,
  blurb: 'Cut through red sandstone with a bulldozer and a great deal of nerve. The corridors are the narrowest in desert golf and the rock on either side is not a hazard you recover from.',
  identity: [
    'Fairway corridors of 28–34 yards, walled by sandstone',
    '4,400 feet of altitude: the ball carries nine per cent further',
    'Drops of up to 90 feet from tee to green on four holes',
    'Rock, not sand, outside the corridor — an unplayable lie rather than a bad one',
    'The 16th plays 210 yards downhill off a cliff to a green with nothing behind it',
  ],
  difficulty: 79,
  fit: { distance: 0.60, accuracy: 0.95, rough: 0.30, wind: 0.30, greens: 0.65, water: 0.20, elevation: 1.00, strategy: 0.75, heat: 0.70, rain: 0.05 },
  pars: [4, 4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 3, 4, 4, 5, 3, 4, 4],
  yards: 7280,
  names: [
    'Sandstone', 'The Narrows', 'Anvil', 'Devil’s Garden', 'Slickrock', 'Fiery Furnace',
    'Balanced Rock', 'Window', 'Courthouse', 'Wall Street', 'Dead Horse', 'Skyline',
    'Castle Valley', 'The Portal', 'Colorado', 'Cliffhanger', 'Fisher Towers', 'Redlands',
  ],
  character: {
    width: [15, 21],
    greens: [13, 17],
    dogleg: [8, 40],
    relief: 44,
    sand: [2, 6],
    water: [4, 15],
    slope: 2.1,
    grove: 0.18,
    waste: true,
    treeLine: 16,
  },
};

const VERMILION: CourseBrief = {
  id: 'vermilion',
  name: 'Vermilion Wash',
  location: 'Scottsdale, Arizona',
  style: 'desert',
  altitude: 1500,
  blurb: 'The longest golf course on tour, in the hottest week of the year, and still the easiest scoring week on the calendar. Everything is wide, everything runs, and everything is reachable.',
  identity: [
    '7,560 yards, and it plays shorter than that in the heat',
    'Fairways of 50–58 yards; the driver is the club on sixteen tees',
    'Three par 5s reachable with an iron',
    'Temperatures of 100–110°F and no shade anywhere on the property',
    'Twenty-under has won here twice',
  ],
  difficulty: 73,
  fit: { distance: 1.00, accuracy: 0.30, rough: 0.20, wind: 0.30, greens: 0.55, water: 0.45, elevation: 0.40, strategy: 0.35, heat: 1.00, rain: 0.05 },
  pars: [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5],
  yards: 7560,
  names: [
    'Ocotillo Flat', 'The Wash', 'Ironwood', 'Palo Verde', 'Creosote', 'Chollas',
    'Long Arroyo', 'Barrel', 'Gila Bend', 'Roadrunner', 'Mesquite', 'Kiln',
    'Superstition', 'Jackrabbit', 'Prickly Pear', 'Furnace', 'Coyote', 'Vermilion',
  ],
  character: {
    width: [26, 34],
    greens: [16, 18],
    dogleg: [0, 34],
    relief: 18,
    sand: [3, 8],
    water: [6, 11, 14, 18],
    slope: 1.7,
    grove: 0.12,
    waste: true,
    treeLine: 20,
  },
};

const OCOTILLO: CourseBrief = {
  id: 'ocotillo',
  name: 'Ocotillo Springs',
  location: 'Henderson, Nevada',
  style: 'desert',
  altitude: 2100,
  surroundWidth: 80,
  blurb: 'Under 7,000 yards, a par 70, and the field does not eat it alive. The greens are severe enough that being below the hole matters more than being close.',
  identity: [
    'Par 70 at 6,960 yards — the shortest desert course on tour',
    'Only two par 5s, both of them genuinely reachable',
    'Greens with four feet of fall on them; above the hole is a bogey',
    'Six par 4s between 430 and 480 yards',
    'The professionals hit 3 wood off eight tees here and still cannot control it',
  ],
  difficulty: 76,
  fit: { distance: 0.35, accuracy: 0.80, rough: 0.35, wind: 0.40, greens: 1.00, water: 0.30, elevation: 0.45, strategy: 0.85, heat: 0.85, rain: 0.05 },
  pars: [4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 4],
  yards: 6960,
  names: [
    'Spring', 'Blackbrush', 'Yucca', 'The Spine', 'Bighorn', 'Lava',
    'Kiln Rock', 'Anthem', 'Cottonwood', 'Sloan Canyon', 'The Punchbowl', 'Bootleg',
    'Dry Falls', 'River Mountain', 'Tortoise', 'Nevada', 'Black Mountain', 'Springs Home',
  ],
  character: {
    width: [19, 26],
    greens: [12, 16],
    dogleg: [6, 34],
    relief: 24,
    sand: [3, 8],
    water: [5, 13],
    slope: 3.0,
    grove: 0.14,
    waste: true,
    treeLine: 18,
  },
};

const CALDERA: CourseBrief = {
  id: 'caldera',
  name: 'Caldera Ridge',
  location: 'Taos, New Mexico',
  style: 'desert',
  altitude: 6800,
  blurb: 'Nearly 7,000 feet above the sea, where a 7 iron goes 195 yards and nobody can trust a number all week. Long on the card and short in the air.',
  identity: [
    '6,800 feet of altitude — the ball carries fourteen per cent further',
    '7,420 yards on the card that plays nearer 6,500',
    'Cool mornings and thin, still air; the wind almost never gets up',
    'Volcanic rock outside the corridor, and juniper stands inside it',
    'The hardest week of the year for club selection, and the field knows it',
  ],
  difficulty: 75,
  fit: { distance: 0.55, accuracy: 0.70, rough: 0.35, wind: 0.25, greens: 0.70, water: 0.20, elevation: 0.90, strategy: 0.80, heat: 0.30, rain: 0.15 },
  pars: [4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 5, 3, 4, 4, 4, 3, 4, 5],
  yards: 7420,
  names: [
    'Rio Grande', 'Juniper', 'Pueblo', 'Sangre', 'Wheeler', 'The Rift',
    'Arroyo Seco', 'Kiva', 'Long Mesa', 'Cinder', 'Caldera', 'Chamisa',
    'Carson', 'The Gorge', 'Valle Vidal', 'Piñon', 'Ranchos', 'Taos',
  ],
  character: {
    // Tightened from the first draft, which played to -2.7 a round and was won
    // at 27 under — the easiest week ever played on this tour. Seven thousand
    // feet of altitude is worth fourteen per cent of carry, and a course that
    // short has to defend itself some other way.
    width: [18, 25],
    greens: [13, 17],
    dogleg: [0, 36],
    relief: 30,
    sand: [4, 9],
    water: [4, 7, 12, 16],
    slope: 2.0,
    grove: 0.3,
    waste: true,
    treeLine: 14,
    specimens: true,
  },
};

export const RED_BUTTE_COURSE = buildCourse(RED_BUTTE);
export const VERMILION_WASH = buildCourse(VERMILION);
export const OCOTILLO_SPRINGS = buildCourse(OCOTILLO);
export const CALDERA_RIDGE = buildCourse(CALDERA);

export const DESERT_COURSES = [RED_BUTTE_COURSE, VERMILION_WASH, OCOTILLO_SPRINGS, CALDERA_RIDGE];
