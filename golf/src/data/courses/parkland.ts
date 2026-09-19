/**
 * Five parkland venues.
 *
 * The widest category and the easiest to make samey, so these are pulled apart
 * deliberately: Thornwood is a corridor of standing timber where the miss is
 * unplayable, Ashbourne is heathland where it is merely horrible, Cascade Falls
 * is mountain golf with water on half the property, Kingsmoor is two hundred
 * years old with greens the size of a lounge, and Blackwater is flat, humid and
 * wet.
 */

import { buildCourse, type CourseBrief } from './generate';

const THORNWOOD: CourseBrief = {
  id: 'thornwood',
  name: 'Thornwood Forest',
  location: 'Bend, Oregon',
  style: 'parkland',
  altitude: 900,
  surroundWidth: 40,
  blurb: 'Eighteen corridors cut through two-hundred-foot Douglas firs. There is no such thing as a recovery here; there is only the shot you were left after finding the fairway or not.',
  identity: [
    'Tree lines within twelve yards of the fairway on every hole',
    'Not one hole where two fairways are visible from each other',
    'A punch-out is the only shot from the trees — the canopy closes over you',
    'Soft ground and no run; every yard is carried',
    'The lowest driving-accuracy figures of the year, and the highest correlation with the winner',
  ],
  difficulty: 80,
  fit: { distance: 0.45, accuracy: 1.00, rough: 0.85, wind: 0.20, greens: 0.65, water: 0.25, elevation: 0.45, strategy: 0.80, heat: 0.15, rain: 0.55 },
  pars: [4, 5, 4, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 4],
  yards: 7290,
  names: [
    'First Cut', 'Cathedral', 'Ponderosa', 'The Chapel', 'Timberline', 'Deschutes',
    'Lodgepole', 'The Keyhole', 'Long Pine', 'Sawyer', 'Black Butte', 'Tumalo',
    'Bachelor', 'Dead Fall', 'The Corridor', 'Sisters', 'Bull Pine', 'Thornwood',
  ],
  character: {
    width: [15, 21],
    greens: [13, 17],
    dogleg: [10, 42],
    relief: 20,
    sand: [2, 6],
    water: [6, 13],
    slope: 2.0,
    grove: 0.72,
    treeLine: 10,
    specimens: true,
  },
};

const ASHBOURNE: CourseBrief = {
  id: 'ashbourne',
  name: 'Ashbourne Heath',
  location: 'Surrey, England',
  style: 'parkland',
  altitude: 240,
  blurb: 'Heather, gorse and silver birch on sandy ground that drains in an hour. A par 70 that has never given up a score under 265 for four rounds.',
  identity: [
    'Heather rather than rough: playable at a cost, unplayable at a price',
    'Sandy subsoil — the only course on tour that is firm in February',
    'Par 70 with six par 4s over 460 yards',
    'Greens built on natural plateaux, with fall-offs on every side',
    'Gorse that costs a stroke and a ball in the same shot',
  ],
  difficulty: 78,
  fit: { distance: 0.55, accuracy: 0.90, rough: 0.95, wind: 0.45, greens: 0.75, water: 0.15, elevation: 0.40, strategy: 0.85, heat: 0.15, rain: 0.35 },
  pars: [4, 4, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 3, 4, 4],
  yards: 6900,
  names: [
    'Heather', 'The Sandpit', 'Birch', 'Common', 'Bracken', 'Long Heath',
    'The Punchbowl', 'Broom', 'Clubhouse Corner', 'The Warren', 'Gorse Hill', 'Chapel',
    'Ling', 'Devil’s Elbow', 'Sandy Lane', 'The Plateau', 'Furze', 'Ashbourne',
  ],
  character: {
    width: [17, 24],
    greens: [13, 17],
    dogleg: [6, 36],
    relief: 18,
    sand: [3, 8],
    water: [],
    slope: 2.4,
    grove: 0.4,
    treeLine: 13,
    specimens: true,
  },
};

const CASCADE_FALLS: CourseBrief = {
  id: 'cascade',
  name: 'Cascade Falls',
  location: 'Asheville, North Carolina',
  style: 'parkland',
  altitude: 2300,
  blurb: 'Mountain parkland with a river running through eleven holes of it. Long, dramatic, and the one week of the year where a two-shot lead is not a lead at all.',
  identity: [
    'The creek is in play on eleven holes and crosses the fairway on five',
    'Elevation changes of up to 70 feet, and almost never flat underfoot',
    'Greens running at 13 on the stimpmeter, with tiers on twelve of them',
    '7,430 yards, and at 2,300 feet it plays every inch of it',
    'The closing three holes have cost more 54-hole leaders than any stretch on tour',
  ],
  difficulty: 81,
  fit: { distance: 0.70, accuracy: 0.80, rough: 0.70, wind: 0.30, greens: 0.95, water: 1.00, elevation: 0.85, strategy: 0.90, heat: 0.35, rain: 0.50 },
  pars: [4, 4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5],
  yards: 7430,
  names: [
    'Overlook', 'Laurel', 'Riverbend', 'The Chimney', 'Rhododendron', 'Swannanoa',
    'Cataract', 'Hemlock', 'Long Falls', 'Pisgah', 'Rapids', 'Skyline',
    'Mill Race', 'Broad River', 'The Shallows', 'Blue Ridge', 'Cascade', 'Tailwater',
  ],
  character: {
    width: [18, 26],
    greens: [14, 18],
    dogleg: [8, 40],
    relief: 40,
    sand: [3, 8],
    water: [1, 3, 5, 6, 9, 11, 13, 14, 16, 17, 18],
    slope: 3.2,
    grove: 0.5,
    treeLine: 12,
    specimens: true,
  },
};

const KINGSMOOR: CourseBrief = {
  id: 'kingsmoor',
  name: 'Kingsmoor Abbey',
  location: 'North Yorkshire, England',
  style: 'parkland',
  altitude: 320,
  surroundWidth: 44,
  blurb: 'Laid out in 1823 around the ruins of an abbey, and altered as little as anybody has dared since. The greens are tiny, the bunkers are in the wrong places, and it is wonderful.',
  identity: [
    'Greens averaging fifteen yards across, several of them older than the rules',
    'Blind approaches on four holes, marked by a post and nothing else',
    'Stone walls in play on six holes, and they are out of bounds',
    'A par 3 of 122 yards that has given up more doubles than any hole on tour',
    'Nothing has been lengthened since 1954 and it does not need to be',
  ],
  difficulty: 79,
  fit: { distance: 0.30, accuracy: 0.90, rough: 0.70, wind: 0.55, greens: 0.95, water: 0.20, elevation: 0.50, strategy: 1.00, heat: 0.10, rain: 0.55 },
  pars: [4, 3, 4, 4, 5, 4, 4, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5],
  yards: 7020,
  names: [
    'Abbey Gate', 'The Post', 'Monk’s Walk', 'Tithe Barn', 'Long Meadow', 'The Wall',
    'Cloister', 'Bell Tower', 'Priory', 'Hermitage', 'Chapter House', 'The Well',
    'Ryedale', 'Scarp', 'Sanctuary', 'Rievaulx', 'Almonry', 'Abbot’s Home',
  ],
  character: {
    width: [16, 23],
    greens: [11, 14],
    dogleg: [6, 38],
    relief: 22,
    sand: [2, 7],
    water: [4],
    slope: 2.8,
    grove: 0.38,
    treeLine: 12,
    specimens: true,
  },
};

const BLACKWATER: CourseBrief = {
  id: 'blackwater',
  name: 'Blackwater Creek',
  location: 'St. Francisville, Louisiana',
  style: 'parkland',
  altitude: 20,
  blurb: 'Flat, wet and ninety-five per cent humidity. Nothing runs, nothing is downhill, and there is standing water on half the property.',
  identity: [
    'Not one hole with more than fifteen feet of elevation change',
    'Bayou and cypress swamp in play on ten holes',
    'Soft fairways all week: the ball lands and stops',
    'Heat and humidity that decide the last nine holes on Sunday',
    'Oaks a hundred and fifty years old, draped in moss and right where you want to be',
  ],
  difficulty: 76,
  fit: { distance: 0.75, accuracy: 0.70, rough: 0.60, wind: 0.25, greens: 0.60, water: 0.95, elevation: 0.05, strategy: 0.70, heat: 0.90, rain: 0.70 },
  pars: [4, 4, 5, 4, 3, 4, 4, 3, 5, 4, 3, 4, 4, 5, 4, 4, 3, 4],
  yards: 7140,
  names: [
    'Live Oak', 'Spanish Moss', 'Long Bayou', 'Cypress', 'The Slough', 'Magnolia',
    'Tupelo', 'Egret', 'Riverboat', 'Pecan', 'Heron', 'Sugarhouse',
    'Cane Field', 'Old River', 'Palmetto', 'Alligator Bend', 'Bald Cypress', 'Blackwater',
  ],
  character: {
    width: [20, 28],
    greens: [14, 18],
    dogleg: [0, 34],
    relief: 5,
    sand: [3, 8],
    water: [2, 3, 5, 7, 9, 11, 14, 16, 17, 18],
    slope: 1.8,
    grove: 0.45,
    treeLine: 13,
    specimens: true,
  },
};

export const THORNWOOD_FOREST = buildCourse(THORNWOOD);
export const ASHBOURNE_HEATH = buildCourse(ASHBOURNE);
export const CASCADE_FALLS_COURSE = buildCourse(CASCADE_FALLS);
export const KINGSMOOR_ABBEY = buildCourse(KINGSMOOR);
export const BLACKWATER_CREEK = buildCourse(BLACKWATER);

export const PARKLAND_COURSES = [
  THORNWOOD_FOREST, ASHBOURNE_HEATH, CASCADE_FALLS_COURSE, KINGSMOOR_ABBEY, BLACKWATER_CREEK,
];
