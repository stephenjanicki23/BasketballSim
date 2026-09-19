/**
 * Five links, and none of them the same golf course.
 *
 * Links golf is the hardest thing to make varied, because the ingredients are so
 * few: no trees, no water to speak of, sand and wind and the shape of the ground.
 * So these are separated by the things that actually separate real ones — how
 * wide the fairways are, how much the land moves, how big the greens are, and
 * whether the sea is a hazard or only a view.
 */

import { buildCourse, type CourseBrief } from './generate';

const KILBRANNAN: CourseBrief = {
  id: 'kilbrannan',
  name: 'Kilbrannan Links',
  location: 'Isle of Arran, Scotland',
  style: 'links',
  altitude: 25,
  blurb: 'The oldest championship in the game, on ground nobody would build a golf course on today. Flat, treeless, and defended entirely by sand and weather.',
  identity: [
    '147 bunkers, most of them revetted and most of them blind',
    'Fairways wide enough to miss and firm enough to run into trouble anyway',
    'Greens the size of small fields, with twenty yards between a good putt and a bad one',
    'Prevailing wind of 20–25 mph; the front nine goes out with it and the back comes home into it',
    'Barely thirty feet of elevation change on the whole property',
    'Has been won at 18 under and at 4 over, in consecutive years',
  ],
  difficulty: 81,
  fit: { distance: 0.45, accuracy: 0.60, rough: 0.70, wind: 1.00, greens: 0.85, water: 0.05, elevation: 0.10, strategy: 0.90, heat: 0.05, rain: 0.80 },
  pars: [4, 4, 5, 3, 4, 4, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 3, 5],
  yards: 7180,
  names: [
    'Burnside', 'The Ditch', 'Long Whins', 'Kirkbrae', 'Hell Bunker', 'The Lang Whang',
    'Corbie', 'Sailor', 'Turn Point', 'Home Field', 'Shell Bay', 'Postage',
    'Machair', 'The Spectacles', 'Cardinal', 'Weary Hill', 'Calamity', 'Tom Morris',
  ],
  character: {
    width: [22, 32],
    greens: [16, 18],
    dogleg: [0, 34],
    relief: 8,
    sand: [4, 9],
    water: [2],
    slope: 2.2,
    grove: 0,
  },
};

const THORNMOUTH: CourseBrief = {
  id: 'thornmouth',
  name: 'Thornmouth Old Links',
  location: 'Fife, Scotland',
  style: 'links',
  altitude: 30,
  blurb: 'Out along the shore and back through the dunes, on a piece of ground that has been played over for four hundred years. Nothing about it is fair and nothing about it is unfair either.',
  identity: [
    'Shared fairways on four holes — you can be perfectly placed on the wrong one',
    'Double greens, some of them eighty yards deep',
    'Pot bunkers you play out sideways from, sometimes backwards',
    'The 17th has out of bounds down the right of the driving line and a road behind the green',
    'Firm ground all summer: a well-struck drive can run forty yards',
  ],
  difficulty: 79,
  fit: { distance: 0.50, accuracy: 0.65, rough: 0.55, wind: 0.95, greens: 0.90, water: 0.10, elevation: 0.15, strategy: 0.95, heat: 0.05, rain: 0.70 },
  pars: [4, 4, 4, 5, 4, 3, 4, 3, 4, 4, 3, 4, 5, 4, 4, 4, 4, 4],
  yards: 7240,
  names: [
    'The Burn', 'Dyke', 'Cartgate', 'Ginger Beer', 'Hole o’ Cross', 'Heathery',
    'High Out', 'Short', 'End Hole', 'Bobby Jones', 'High In', 'Heathery In',
    'Long Hole', 'Hell', 'Cartgate In', 'Corner of the Dyke', 'Road Hole', 'Tom Morris',
  ],
  character: {
    width: [24, 34],
    greens: [16, 18],
    dogleg: [0, 26],
    relief: 12,
    sand: [3, 8],
    water: [1, 18],
    slope: 2.0,
    grove: 0,
  },
};

const DUN_MORRA: CourseBrief = {
  id: 'dunmorra',
  name: 'Dun Morra',
  location: 'County Donegal, Ireland',
  style: 'links',
  altitude: 60,
  blurb: 'Dunes eighty feet high and fairways running through the valleys between them. Spectacular, exhausting, and the only links on tour where you cannot see the ball land.',
  identity: [
    'Dunes of up to eighty feet; nine blind or semi-blind tee shots',
    'Corridors cut between the ridges — off line is unplayable, not merely bad',
    'Elevation changes of fifty feet within a single hole',
    'A par 5 that plays 620 downwind and is unreachable into it',
    'Weather off the Atlantic that can turn twice in a round',
  ],
  difficulty: 80,
  fit: { distance: 0.60, accuracy: 0.85, rough: 0.90, wind: 0.95, greens: 0.60, water: 0.05, elevation: 0.85, strategy: 0.70, heat: 0.05, rain: 0.85 },
  pars: [4, 5, 4, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4],
  yards: 7310,
  names: [
    'Tullagh', 'The Valley', 'Sheep’s Gap', 'Glashedy', 'The Saddle', 'Bealach',
    'Ravine', 'Watchtower', 'Long Strand', 'The Ridge', 'Cnoc Mor', 'Dunaff',
    'Tra na Rossan', 'Atlantic', 'The Cliff', 'Dead Man’s Hollow', 'Malin', 'Home',
  ],
  character: {
    width: [17, 26],
    greens: [13, 17],
    dogleg: [10, 46],
    relief: 34,
    sand: [3, 7],
    water: [],
    slope: 2.4,
    grove: 0,
  },
};

const CARRICKMOOR: CourseBrief = {
  id: 'carrickmoor',
  name: 'Carrickmoor',
  location: 'County Sligo, Ireland',
  style: 'links',
  altitude: 40,
  blurb: 'A gentler links than most, and the one everybody wants to play. Wide, rumpled fairways, greens set in natural hollows, and a wind that is usually there rather than always.',
  identity: [
    'The most receptive greens on any links on tour — you can fly it in',
    'Fairways that move constantly; a flat lie is a small piece of luck',
    'Only 48 bunkers, and all of them where you would put them yourself',
    'Three short par 4s under 340 yards, all drivable and all dangerous',
    'The friendliest weather on the links rota, which is not saying very much',
  ],
  difficulty: 76,
  fit: { distance: 0.55, accuracy: 0.60, rough: 0.55, wind: 0.80, greens: 0.70, water: 0.10, elevation: 0.35, strategy: 0.75, heat: 0.05, rain: 0.65 },
  pars: [4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4, 5, 3, 4, 5],
  yards: 7060,
  names: [
    'Knocknarea', 'The Hollow', 'Benbulben', 'Rosses Point', 'The Jump', 'Ballincar',
    'Drumcliff', 'The Gully', 'Metal Man', 'Innisfree', 'Lissadell', 'Bowmore',
    'Cullenamore', 'Strandhill', 'Coney', 'Deadman’s Point', 'Yeats', 'Homeward',
  ],
  character: {
    width: [26, 36],
    greens: [15, 18],
    dogleg: [0, 30],
    relief: 16,
    sand: [2, 6],
    water: [12],
    slope: 1.8,
    grove: 0,
  },
};

const SALTMARSH: CourseBrief = {
  id: 'saltmarsh',
  name: 'Saltmarsh Point',
  location: 'Norfolk, England',
  style: 'links',
  altitude: 15,
  surroundWidth: 46,
  blurb: 'Barely 6,800 yards and nobody has ever taken it apart. The estuary is in play on six holes, the greens are the smallest on tour, and level par wins.',
  identity: [
    'The shortest course on tour at 6,840 yards — and the hardest week of the year',
    'Tidal creeks in play on six holes; a ball in one is gone',
    'Greens averaging sixteen yards across — the smallest on tour',
    'Not a single par 5 on the back nine',
    'Wind off the North Sea with nothing between here and Denmark to slow it',
  ],
  difficulty: 78,
  fit: { distance: 0.25, accuracy: 0.95, rough: 0.60, wind: 0.90, greens: 0.80, water: 0.85, elevation: 0.10, strategy: 0.95, heat: 0.05, rain: 0.75 },
  pars: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 3, 4, 4, 4],
  yards: 6840,
  names: [
    'The Quay', 'Samphire', 'Creek', 'Marram', 'The Staithe', 'Tern',
    'Cockle', 'Brancaster', 'Long Marsh', 'The Sluice', 'Redshank', 'Saltings',
    'The Cut', 'Whelk', 'Point', 'Eel Grass', 'Harbour Wall', 'Lifeboat',
  ],
  character: {
    // Measured down from the first draft, which played to +7.6 a round and was
    // won at +8. Tiny greens, tight corridors, nine water holes and a links wind
    // turned out to compound rather than add: a regular week that nobody breaks
    // par in is not a hard golf course, it is a broken one.
    width: [18, 26],
    greens: [11, 14],
    dogleg: [0, 28],
    relief: 6,
    sand: [3, 7],
    water: [2, 5, 9, 13, 16, 18],
    slope: 1.9,
    grove: 0,
  },
};

export const KILBRANNAN_LINKS = buildCourse(KILBRANNAN);
export const THORNMOUTH_OLD = buildCourse(THORNMOUTH);
export const DUN_MORRA_LINKS = buildCourse(DUN_MORRA);
export const CARRICKMOOR_LINKS = buildCourse(CARRICKMOOR);
export const SALTMARSH_POINT = buildCourse(SALTMARSH);

export const LINKS_COURSES = [
  KILBRANNAN_LINKS, THORNMOUTH_OLD, DUN_MORRA_LINKS, CARRICKMOOR_LINKS, SALTMARSH_POINT,
];
