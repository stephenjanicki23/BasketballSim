/**
 * COURSE 3 — Woodland National.
 *
 * Corridors cut through mature pine and oak. Fairways 26–32 yards wide, rough
 * that costs you 15% of your distance and 40% of your control, greens of 5,000
 * square feet, and a tree in the way of every recovery. Distance is worth
 * almost nothing here; knowing where to miss is worth everything.
 */

import type { Course, HoleSpec } from '../../simulation/types';

const holes: HoleSpec[] = [
  {
    number: 1, name: 'Pine Gate', par: 4, yards: 415, bearing: 75, index: 10,
    dogleg: 18, doglegAt: 0.58, fairwayWidth: 15,
    elevation: { landing: -8, green: 6 }, greenSize: 13, pin: { x: 3, y: 4 },
    greenSlope: { x: -1.8, y: -1.6 }, trees: 0.72,
    bunkers: [
      { along: 262, lateral: 20, size: 6, kind: 'fairway' },
      { along: 404, lateral: -15, size: 6, kind: 'greenside' },
    ],
    water: [],
    strategy: 'A corridor 30 yards wide between the pines. Position off the tee is the entire hole — a drive in the trees means wedging out sideways.',
  },
  {
    number: 2, name: 'Deer Run', par: 4, yards: 440, bearing: 340, index: 4,
    dogleg: -26, doglegAt: 0.52, fairwayWidth: 14,
    elevation: { landing: 12, green: 20 }, greenSize: 12, pin: { x: -3, y: -4 },
    greenSlope: { x: 1.6, y: -2.0 }, trees: 0.78,
    bunkers: [
      { along: 256, lateral: -18, size: 6, kind: 'fairway' },
      { along: 280, lateral: 17, size: 5, kind: 'fairway' },
      { along: 430, lateral: 15, size: 6, kind: 'greenside', deep: true },
      { along: 446, lateral: -14, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Doglegs left and climbs. You cannot cut the corner — the trees are 80 feet tall — so it is a 3 wood to the turn and a long iron in.',
  },
  {
    number: 3, name: 'Chapel', par: 3, yards: 178, bearing: 250, index: 15,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 11,
    elevation: { landing: 0, green: -18 }, greenSize: 12, pin: { x: 4, y: 3 },
    greenSlope: { x: -2.2, y: 1.4 }, trees: 0.6,
    bunkers: [
      { along: 164, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 178, lateral: 14, size: 5, kind: 'greenside' },
    ],
    water: [{ along: 158, lateral: 24, size: 18 }],
    strategy: 'Eighteen feet downhill through a cathedral of pines, so the wind does nothing and the number is the number. Plays 168.',
  },
  {
    number: 4, name: 'Millstream', par: 5, yards: 535, bearing: 20, index: 13,
    dogleg: 22, doglegAt: 0.44, fairwayWidth: 16,
    elevation: { landing: -6, green: -14 }, greenSize: 14, pin: { x: -4, y: 5 },
    greenSlope: { x: 1.4, y: -1.8 }, trees: 0.66,
    bunkers: [
      { along: 268, lateral: 20, size: 6, kind: 'fairway' },
      { along: 440, lateral: -18, size: 6, kind: 'fairway' },
      { along: 528, lateral: 16, size: 6, kind: 'greenside' },
    ],
    water: [{ along: 0, lateral: 0, size: 0, strip: { from: 468, to: 512, side: -1, offset: 22, width: 30 } }],
    strategy: 'The stream crosses in front of the green at 480. Go for it and you are carrying 250 over water to a small target, or lay back to 110 and wedge it.',
  },
  {
    number: 5, name: 'Hollow', par: 4, yards: 396, bearing: 130, index: 16,
    dogleg: -14, doglegAt: 0.6, fairwayWidth: 15,
    elevation: { landing: -16, green: -6 }, greenSize: 13, pin: { x: 3, y: -3 },
    greenSlope: { x: -1.4, y: 1.8 }, trees: 0.7,
    bunkers: [
      { along: 250, lateral: -17, size: 6, kind: 'fairway' },
      { along: 388, lateral: 15, size: 6, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Drops into a hollow then plays back up. The shortest par 4 on the front, and a birdie chance if the tee shot finds the flat.',
  },
  {
    number: 6, name: 'Long Timber', par: 4, yards: 452, bearing: 295, index: 2,
    dogleg: 20, doglegAt: 0.5, fairwayWidth: 13,
    elevation: { landing: 10, green: 22 }, greenSize: 12, pin: { x: -4, y: 4 },
    greenSlope: { x: 1.8, y: -2.2 }, trees: 0.82,
    bunkers: [
      { along: 274, lateral: 19, size: 6, kind: 'fairway', deep: true },
      { along: 298, lateral: -18, size: 5, kind: 'fairway' },
      { along: 444, lateral: 14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'The narrowest corridor on the course, 452 yards, uphill. A par is a genuinely good score and nobody is making four from the trees.',
  },
  {
    number: 7, name: 'Lookout', par: 3, yards: 205, bearing: 200, index: 7,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 12,
    elevation: { landing: 0, green: 16 }, greenSize: 13, pin: { x: 0, y: -5 },
    greenSlope: { x: -1.2, y: -2.4 }, trees: 0.55,
    bunkers: [
      { along: 188, lateral: -15, size: 6, kind: 'greenside', deep: true },
      { along: 206, lateral: 15, size: 6, kind: 'greenside' },
      { along: 220, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: '205 uphill to a green sloping hard back to front. Anything above the hole is a three-putt waiting to happen.',
  },
  {
    number: 8, name: 'Fox Bend', par: 4, yards: 432, bearing: 45, index: 8,
    dogleg: -30, doglegAt: 0.48, fairwayWidth: 14,
    elevation: { landing: 6, green: -8 }, greenSize: 13, pin: { x: 4, y: 4 },
    greenSlope: { x: -1.6, y: 1.2 }, trees: 0.75,
    bunkers: [
      { along: 252, lateral: -17, size: 6, kind: 'fairway' },
      { along: 420, lateral: -15, size: 6, kind: 'greenside' },
      { along: 436, lateral: 14, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'A sharp left turn at 250. Take an iron off the tee and you have 180 in; take driver and you are either perfect or chipping out.',
  },
  {
    number: 9, name: 'Cathedral', par: 5, yards: 548, bearing: 160, index: 11,
    dogleg: 26, doglegAt: 0.42, fairwayWidth: 16,
    elevation: { landing: 14, green: 26 }, greenSize: 14, pin: { x: 5, y: 5 },
    greenSlope: { x: -1.4, y: -2.0 }, trees: 0.68,
    bunkers: [
      { along: 280, lateral: 21, size: 6, kind: 'fairway' },
      { along: 456, lateral: -18, size: 6, kind: 'fairway' },
      { along: 478, lateral: 16, size: 5, kind: 'fairway' },
      { along: 542, lateral: -15, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Uphill all the way to the clubhouse and effectively a three-shot hole. The bunkers at 460 pinch the layup to 24 yards.',
  },
  {
    number: 10, name: 'Ridge Line', par: 4, yards: 462, bearing: 280, index: 3,
    dogleg: 16, doglegAt: 0.55, fairwayWidth: 14,
    elevation: { landing: -14, green: -26 }, greenSize: 13, pin: { x: -4, y: -4 },
    greenSlope: { x: 2.0, y: 1.6 }, trees: 0.8,
    bunkers: [
      { along: 288, lateral: 19, size: 6, kind: 'fairway' },
      { along: 452, lateral: 15, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Downhill and tight, so the tee shot runs out toward the trees on the right. The green falls away at the front-left.',
  },
  {
    number: 11, name: 'Mill Pond', par: 3, yards: 165, bearing: 350, index: 17,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 11,
    elevation: { landing: 0, green: -10 }, greenSize: 12, pin: { x: -3, y: 3 },
    greenSlope: { x: 1.8, y: -1.2 }, trees: 0.5,
    bunkers: [{ along: 158, lateral: 14, size: 5, kind: 'greenside' }],
    water: [{ along: 132, lateral: -18, size: 24, stretch: 1.5 }],
    strategy: 'A short iron over the corner of the pond to a green that slopes toward it. Bail out right and the chip is downhill toward the water.',
  },
  {
    number: 12, name: "Keeper's Cottage", par: 4, yards: 384, bearing: 110, index: 14,
    dogleg: -20, doglegAt: 0.6, fairwayWidth: 13,
    elevation: { landing: 4, green: 12 }, greenSize: 11, pin: { x: 3, y: -3 },
    greenSlope: { x: -2.0, y: -1.4 }, trees: 0.85,
    bunkers: [
      { along: 236, lateral: -16, size: 5, kind: 'fairway', deep: true },
      { along: 374, lateral: 13, size: 5, kind: 'greenside', deep: true },
      { along: 388, lateral: -13, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Short, but with the smallest green on the course between two deep bunkers. An iron off the tee and a wedge to the middle is worth two pars.',
  },
  {
    number: 13, name: 'Azalea', par: 5, yards: 512, bearing: 225, index: 18,
    dogleg: -32, doglegAt: 0.46, fairwayWidth: 16,
    elevation: { landing: -10, green: -4 }, greenSize: 14, pin: { x: 4, y: 4 },
    greenSlope: { x: -1.6, y: 1.8 }, trees: 0.62,
    bunkers: [
      { along: 270, lateral: -20, size: 6, kind: 'fairway' },
      { along: 502, lateral: 15, size: 6, kind: 'greenside' },
    ],
    water: [{ along: 0, lateral: 0, size: 0, strip: { from: 446, to: 512, side: -1, offset: 23, width: 28 } }],
    strategy: 'The one real birdie hole: 512 downhill, turning left. The creek guards the left of the green, which is where the best angle is.',
  },
  {
    number: 14, name: 'Sawmill', par: 4, yards: 441, bearing: 30, index: 6,
    dogleg: 24, doglegAt: 0.52, fairwayWidth: 14,
    elevation: { landing: 8, green: -6 }, greenSize: 12, pin: { x: -4, y: 5 },
    greenSlope: { x: 1.4, y: -1.6 }, trees: 0.76,
    bunkers: [
      { along: 268, lateral: 19, size: 6, kind: 'fairway' },
      { along: 292, lateral: -18, size: 5, kind: 'fairway' },
      { along: 432, lateral: -14, size: 6, kind: 'greenside' },
    ],
    water: [],
    strategy: 'A dogleg right where the trees on the inside are exactly tall enough to matter. Fairway is worth more than forty yards here.',
  },
  {
    number: 15, name: 'Quarry Wood', par: 4, yards: 425, bearing: 300, index: 9,
    dogleg: -18, doglegAt: 0.58, fairwayWidth: 15,
    elevation: { landing: -6, green: 10 }, greenSize: 13, pin: { x: 4, y: -4 },
    greenSlope: { x: -1.8, y: -1.8 }, trees: 0.7,
    bunkers: [
      { along: 258, lateral: -18, size: 6, kind: 'fairway' },
      { along: 414, lateral: 14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Bends gently left to a green set above you. The right-hand greenside bunker is six feet below the surface — that is the miss to avoid.',
  },
  {
    number: 16, name: 'Stone Bridge', par: 3, yards: 192, bearing: 185, index: 12,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 12,
    elevation: { landing: 0, green: -14 }, greenSize: 13, pin: { x: -4, y: -3 },
    greenSlope: { x: 2.0, y: 1.6 }, trees: 0.58,
    bunkers: [
      { along: 180, lateral: 15, size: 6, kind: 'greenside' },
      { along: 196, lateral: -14, size: 5, kind: 'greenside', deep: true },
    ],
    water: [{ along: 142, lateral: 0, size: 12, stretch: 2.2, label: 'the creek' }],
    strategy: 'Downhill over the creek, and the green runs away from you. Take one less club and land it on the front third.',
  },
  {
    number: 17, name: 'Long Walk', par: 4, yards: 455, bearing: 60, index: 5,
    dogleg: 20, doglegAt: 0.5, fairwayWidth: 13,
    elevation: { landing: 12, green: 24 }, greenSize: 12, pin: { x: 3, y: 5 },
    greenSlope: { x: -1.6, y: -2.2 }, trees: 0.8,
    bunkers: [
      { along: 278, lateral: 19, size: 6, kind: 'fairway', deep: true },
      { along: 302, lateral: -18, size: 5, kind: 'fairway' },
      { along: 448, lateral: -14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Uphill, narrow and 455 yards, with the pin usually at the back. This is where a two-shot lead disappears.',
  },
  {
    number: 18, name: 'Grandstand', par: 5, yards: 538, bearing: 150, index: 1,
    dogleg: 28, doglegAt: 0.44, fairwayWidth: 14,
    elevation: { landing: -8, green: 14 }, greenSize: 14, pin: { x: -5, y: 4 },
    greenSlope: { x: 1.8, y: -2.0 }, trees: 0.72,
    bunkers: [
      { along: 272, lateral: 20, size: 6, kind: 'fairway', deep: true },
      { along: 452, lateral: -17, size: 6, kind: 'fairway', deep: true },
      { along: 476, lateral: 16, size: 5, kind: 'fairway' },
      { along: 530, lateral: 15, size: 6, kind: 'greenside', deep: true },
    ],
    water: [{ along: 0, lateral: 0, size: 0, strip: { from: 486, to: 540, side: -1, offset: 24, width: 32 } }],
    strategy: 'Reachable, uphill to a green with water left and sand right, off a tee shot through a 28-yard gap. Eagle wins, double loses.',
  },
];

export const WOODLAND_NATIONAL: Course = {
  id: 'woodland',
  name: 'Woodland National',
  location: 'Hollisbrook',
  style: 'parkland',
  par: holes.reduce((sum, h) => sum + h.par, 0),
  yards: holes.reduce((sum, h) => sum + h.yards, 0),
  blurb: 'Tree-lined, narrow and relentlessly positional. The shortest course on tour and the hardest to keep a card clean on.',
  identity: [
    'Corridors 26–32 yards wide between 80-foot pines',
    'A recovery shot from the trees advances the ball 78% at best',
    'Rough at 1.35× severity — the heaviest on tour',
    'Greens averaging 5,300 square feet, running at 12.5',
    'Eleven genuine doglegs; driver is the wrong club on five of them',
    'Sheltered, so rain matters far more than wind',
  ],
  difficulty: 79,
  fit: {
    distance: 0.20, accuracy: 1.00, rough: 1.00, wind: 0.20, greens: 0.90,
    water: 0.35, elevation: 0.55, strategy: 1.00, heat: 0.10, rain: 0.85,
  },
  holes,
};
