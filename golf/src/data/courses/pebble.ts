/**
 * COURSE 6 — Pebble Beach Golf Links (Pebble Beach, California).
 *
 * The third real course in the game, and the first one begun from a *satellite*
 * photograph rather than a tour overhead. What that changes is resolution: a
 * BlueGolf hole overhead is a blurred strip with the line of play drawn on it,
 * while the Google image behind the same overlay shows every bunker edge, the
 * tree line, the cart path and the houses. The 1st below is traced off the
 * satellite and checked against the overhead's printed legs.
 *
 * What is measured and what is not — stated plainly, because on a course this
 * famous the difference matters more, not less:
 *
 * 1. **The 1st is traced.** Tee, the 242 marker and the pin are read off the
 *    satellite image; the two legs come out at 236 and 142 yards against the
 *    236 and 142 the Blue card asks for, which is the check that says the three
 *    points are where they look. Six bunkers, the corridor width at nineteen
 *    stations and the tree lines either side were measured off the same image
 *    — the sand by flood-filling the bright pixels, the mown edge by walking
 *    out from the line of play until the turf stops.
 * 2. **The card for the 2nd to the 18th is NOT verified.** Par is the club's
 *    (72, 36 out and 36 back) and the yardages are Pebble Beach's published
 *    championship numbers, which are close to but not necessarily the same as
 *    the Blue set the 1st is measured at. The stroke indexes and the rating and
 *    slope are likewise taken from the published card rather than from an image.
 *    Send the Blue scorecard and they become measured; send the overheads and
 *    the holes become traced, one at a time, the way The Ranch was built.
 * 3. **Every hole but the 1st is derived.** Shape, sand, trees and greens on
 *    the other seventeen are authored from the course's own description — the
 *    cliff-top holes on the back nine, the short 7th, the long par 4s at the
 *    turn — and are the part a trace replaces. The hole card in the game says
 *    which is which.
 * 4. **Elevation is inferred.** The property runs along the cliffs of Carmel
 *    Bay at close to sea level, so altitude does nothing to carry here; the
 *    per-hole rises and falls are the site's, read from its reputation rather
 *    than from contours.
 */

import type { Course, HoleSpec, TeeSet } from '../../simulation/types';
import { type CardEntry, type TracedHole, traceHole } from './trace';

/**
 * The printed legs off each hole's overhead: tee to the fairway marker, marker
 * to the green. Only the 1st is in hand.
 */
const SPLITS: Partial<Record<number, number[]>> = {
  1: [242, 145],
};

const holes: HoleSpec[] = [
  {
    number: 1, name: 'Opening Turn', par: 4, yards: 378, bearing: 74, index: 11,
    dogleg: 30, doglegAt: 0.62, fairwayWidth: 15,
    bends: [{ at: 0.62, shift: 30, turn: 0.2 }],
    widths: [{ at: 0.08, half: 9 }, { at: 0.45, half: 17 }, { at: 0.75, half: 14 }, { at: 1, half: 14 }],
    landforms: [{ at: 0.5, rise: 6, length: 140 }],
    elevation: { landing: 4, green: 8 }, greenSize: 12, pin: { x: 2, y: -2 },
    greenSlope: { x: -1.4, y: -1.8 }, trees: 0.55,
    bunkers: [
      { along: 258, lateral: -17, size: 5, kind: 'fairway' },
      { along: 372, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 366, lateral: 15, size: 5, kind: 'greenside' },
    ],
    water: [],
    // From the photograph: this hole runs between the Lodge's cottages and the
    // Del Monte Forest houses, and there is no water anywhere near it. None is
    // drawn.
    scenery: [
      { kind: 'houses', side: 1, from: 40, to: 378, depth: 120 },
      { kind: 'houses', side: -1, from: 0, to: 180, depth: 90 },
      { kind: 'woodland', side: -1, from: 200, to: 378, depth: 80, gap: 10 },
    ],
    strategy: 'A three hundred and seventy-eight yard opener played out of a chute between the cottages, bending right at the sand to a small green ringed by it. Nobody warms up here; the tee shot has to be straight from the first swing of the day.',
  },
  {
    number: 2, name: 'Barranca', par: 5, yards: 502, bearing: 82, index: 15,
    dogleg: 18, doglegAt: 0.55, fairwayWidth: 17,
    landforms: [{ at: 0.6, rise: -8, length: 150 }],
    elevation: { landing: -4, green: -10 }, greenSize: 13, pin: { x: -3, y: 3 },
    greenSlope: { x: 1.2, y: -1.6 }, trees: 0.45,
    bunkers: [
      { along: 300, lateral: 19, size: 6, kind: 'fairway' },
      { along: 470, lateral: -15, size: 6, kind: 'greenside', deep: true },
      { along: 486, lateral: 14, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: -1, from: 40, to: 502, depth: 90 },
      { kind: 'houses', side: 1, from: 200, to: 502, depth: 80, gap: 8 },
    ],
    strategy: 'Reachable, and the reward for taking it on is a green sitting beyond a barranca that swallows anything short. Laying up leaves a wedge; going for it leaves either an eagle putt or a drop.',
  },
  {
    number: 3, name: 'Dogleg Left', par: 4, yards: 390, bearing: 340, index: 9,
    dogleg: -34, doglegAt: 0.55, fairwayWidth: 16,
    bends: [{ at: 0.55, shift: -34, turn: 0.22 }],
    landforms: [{ at: 0.45, rise: 8, length: 130 }],
    elevation: { landing: 5, green: 10 }, greenSize: 12, pin: { x: 3, y: -3 },
    greenSlope: { x: -1.6, y: -1.4 }, trees: 0.5,
    bunkers: [
      { along: 262, lateral: -18, size: 6, kind: 'fairway', deep: true },
      { along: 378, lateral: -13, size: 5, kind: 'greenside' },
      { along: 384, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: -1, from: 0, to: 390, depth: 90 },
      { kind: 'woodland', side: 1, from: 100, to: 390, depth: 80 },
    ],
    strategy: 'The corner is cut over sand and long grass. Take it on and a wedge is left; play out to the right and the approach is blind over the shoulder of the dune.',
  },
  {
    number: 4, name: 'First Sight of the Bay', par: 4, yards: 331, bearing: 356, index: 17,
    dogleg: 12, doglegAt: 0.6, fairwayWidth: 14,
    widths: [{ at: 0.08, half: 14 }, { at: 0.5, half: 13 }, { at: 0.8, half: 11 }, { at: 1, half: 12 }],
    elevation: { landing: 2, green: 4 }, greenSize: 10, pin: { x: 2, y: 2 },
    greenSlope: { x: 1.8, y: -1.2 }, trees: 0.3,
    bunkers: [
      { along: 300, lateral: -12, size: 5, kind: 'greenside', deep: true },
      { along: 322, lateral: 11, size: 4, kind: 'greenside' },
    ],
    water: [],
    // The first hole on the cliff. Beach then ocean, both of them beyond the
    // boundary: the hole's own hazards are still the two bunkers and nothing
    // else.
    scenery: [
      { kind: 'beach', side: 1, from: 120, to: 331, depth: 24 },
      { kind: 'ocean', side: 1, from: 110, to: 331, depth: 180, gap: 24 },
      { kind: 'woodland', side: -1, from: 0, to: 331, depth: 80 },
    ],
    strategy: 'Three hundred and thirty-one yards, the shortest par 4 out here, and the first hole that runs along the cliff. The green is tiny and the ocean is right: a long iron off the tee and a wedge is the whole hole.',
  },
  {
    number: 5, name: 'Above the Cove', par: 3, yards: 195, bearing: 10, index: 7,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 12,
    widths: [{ at: 0, half: 0 }, { at: 0.62, half: 0 }, { at: 0.82, half: 10 }, { at: 1, half: 13 }],
    elevation: { landing: 8, green: 16 }, greenSize: 11, pin: { x: -2, y: -3 },
    greenSlope: { x: -1.8, y: -2.0 }, trees: 0.5,
    bunkers: [
      { along: 178, lateral: -13, size: 5, kind: 'greenside', deep: true },
      { along: 186, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'ocean', side: 1, from: 20, to: 195, depth: 170, gap: 18 },
      { kind: 'woodland', side: -1, from: 0, to: 195, depth: 80 },
    ],
    strategy: 'A hundred and ninety-five uphill to a green cut into the hillside above Stillwater Cove. Wind off the water and a shot that has to be flighted: the miss is long, and long is gone.',
  },
  {
    number: 6, name: 'Up the Headland', par: 5, yards: 523, bearing: 8, index: 13,
    dogleg: 16, doglegAt: 0.5, fairwayWidth: 17,
    landforms: [{ at: 0.65, rise: 30, length: 200 }],
    elevation: { landing: 10, green: 46 }, greenSize: 13, pin: { x: 3, y: -2 },
    greenSlope: { x: -1.2, y: -1.8 }, trees: 0.35,
    bunkers: [
      { along: 330, lateral: 20, size: 6, kind: 'fairway' },
      { along: 500, lateral: -14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    scenery: [
      { kind: 'beach', side: 1, from: 280, to: 523, depth: 20 },
      { kind: 'ocean', side: 1, from: 160, to: 523, depth: 190, gap: 20 },
      { kind: 'meadow', side: -1, from: 0, to: 523, depth: 70 },
    ],
    strategy: 'The second shot climbs fifty feet onto the headland with the bay hard on the right the whole way. Get up and the rest of the hole is simple; come up short and the ball rolls back down the face.',
  },
  {
    number: 7, name: 'Downhill Wedge', par: 3, yards: 106, bearing: 186, index: 18,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 10,
    widths: [{ at: 0, half: 0 }, { at: 0.55, half: 0 }, { at: 0.8, half: 8 }, { at: 1, half: 10 }],
    elevation: { landing: -20, green: -36 }, greenSize: 9, pin: { x: 0, y: -2 },
    greenSlope: { x: -1.4, y: -1.6 }, trees: 0.15,
    bunkers: [
      { along: 96, lateral: -10, size: 4, kind: 'greenside', deep: true },
      { along: 100, lateral: 10, size: 4, kind: 'greenside', deep: true },
      { along: 108, lateral: 0, size: 4, kind: 'greenside' },
    ],
    water: [],
    // A hundred and six yards to a green on a rock, with the Pacific round three
    // sides of it. All of it is scenery; the hole's trouble is its own sand.
    scenery: [
      { kind: 'ocean', side: 0, from: 0, to: 0, depth: 200, gap: 6 },
      { kind: 'ocean', side: 1, from: 0, to: 106, depth: 170, gap: 4 },
      { kind: 'ocean', side: -1, from: 30, to: 106, depth: 150, gap: 20 },
    ],
    strategy: 'A hundred and six yards straight downhill to a green on a rock in the Pacific, with sand on every side of it. A wedge in calm air, a punched 7 iron when it blows.',
  },
  {
    number: 8, name: 'The Cliff Carry', par: 4, yards: 428, bearing: 62, index: 1,
    dogleg: 34, doglegAt: 0.48, fairwayWidth: 15,
    bends: [{ at: 0.48, shift: 34, turn: 0.2 }],
    landforms: [{ at: 0.4, rise: 12, length: 150 }],
    elevation: { landing: 8, green: 4 }, greenSize: 11, pin: { x: -2, y: -3 },
    greenSlope: { x: 1.6, y: -2.0 }, trees: 0.25,
    bunkers: [
      { along: 400, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 408, lateral: 13, size: 5, kind: 'greenside' },
      { along: 420, lateral: 0, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'ocean', side: 1, from: 190, to: 428, depth: 190, gap: 6 },
      { kind: 'meadow', side: -1, from: 0, to: 428, depth: 70 },
    ],
    strategy: 'A blind tee shot to the edge of the cliff, and then the second shot: a long iron across a chasm of ocean to a green propped on the far rim. The most demanding approach on the property.',
  },
  {
    number: 9, name: 'The Long Ninth', par: 4, yards: 505, bearing: 176, index: 3,
    dogleg: -10, doglegAt: 0.5, fairwayWidth: 17,
    landforms: [{ at: 0.5, rise: -14, length: 200 }],
    elevation: { landing: -8, green: -18 }, greenSize: 13, pin: { x: 3, y: 3 },
    greenSlope: { x: 2.2, y: -1.4 }, trees: 0.2,
    bunkers: [
      { along: 430, lateral: -16, size: 6, kind: 'fairway', deep: true },
      { along: 486, lateral: -14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    scenery: [
      { kind: 'beach', side: 1, from: 120, to: 505, depth: 22 },
      { kind: 'ocean', side: 1, from: 60, to: 505, depth: 190, gap: 22 },
      { kind: 'meadow', side: -1, from: 0, to: 505, depth: 70 },
    ],
    strategy: 'Five hundred and five yards as a par 4, running downhill along the cliff with the whole hole tilting toward the ocean on the right. A four here is worth more than a birdie almost anywhere else.',
  },
  {
    number: 10, name: 'The Beach Hole', par: 4, yards: 495, bearing: 176, index: 5,
    dogleg: -8, doglegAt: 0.5, fairwayWidth: 16,
    landforms: [{ at: 0.55, rise: -10, length: 180 }],
    elevation: { landing: -6, green: -16 }, greenSize: 12, pin: { x: 2, y: -2 },
    greenSlope: { x: 2.0, y: -1.6 }, trees: 0.18,
    bunkers: [
      { along: 420, lateral: 17, size: 6, kind: 'fairway' },
      { along: 476, lateral: -13, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    scenery: [
      { kind: 'beach', side: 1, from: 100, to: 495, depth: 26 },
      { kind: 'ocean', side: 1, from: 80, to: 495, depth: 185, gap: 26 },
      { kind: 'houses', side: -1, from: 0, to: 495, depth: 80, gap: 6 },
    ],
    strategy: 'The same test as the 9th and a little shorter, with the beach itself waiting right of the green. The fairway falls away toward the sea from about two hundred and fifty yards out.',
  },
  {
    number: 11, name: 'Inland Again', par: 4, yards: 390, bearing: 30, index: 12,
    dogleg: 14, doglegAt: 0.55, fairwayWidth: 16,
    landforms: [{ at: 0.6, rise: 10, length: 150 }],
    elevation: { landing: 6, green: 14 }, greenSize: 12, pin: { x: -3, y: -2 },
    greenSlope: { x: -1.8, y: -1.2 }, trees: 0.55,
    bunkers: [
      { along: 372, lateral: -13, size: 5, kind: 'greenside' },
      { along: 378, lateral: 13, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: -1, from: 0, to: 390, depth: 90 },
      { kind: 'houses', side: 1, from: 120, to: 390, depth: 80, gap: 8 },
    ],
    strategy: 'Back inland and uphill, and the relief of a hole with no ocean on it. The green sits above the approach and runs away at the back.',
  },
  {
    number: 12, name: 'The Awkward Third', par: 3, yards: 202, bearing: 190, index: 8,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 12,
    widths: [{ at: 0, half: 0 }, { at: 0.6, half: 0 }, { at: 0.82, half: 10 }, { at: 1, half: 12 }],
    elevation: { landing: -4, green: -8 }, greenSize: 10, pin: { x: 2, y: 3 },
    greenSlope: { x: 1.4, y: -1.8 }, trees: 0.5,
    bunkers: [
      { along: 186, lateral: -12, size: 5, kind: 'greenside', deep: true },
      { along: 192, lateral: 12, size: 5, kind: 'greenside', deep: true },
      { along: 206, lateral: 0, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: -1, from: 0, to: 202, depth: 80 },
      { kind: 'woodland', side: 1, from: 0, to: 202, depth: 80 },
    ],
    strategy: 'Two hundred and two yards to a narrow green set diagonally with sand short, left and right. Anything less than the perfect number leaves a bunker shot to a surface that falls away.',
  },
  {
    number: 13, name: 'Into the Wind', par: 4, yards: 445, bearing: 176, index: 6,
    dogleg: -16, doglegAt: 0.55, fairwayWidth: 16,
    landforms: [{ at: 0.5, rise: 6, length: 160 }],
    elevation: { landing: 2, green: 8 }, greenSize: 12, pin: { x: -2, y: 2 },
    greenSlope: { x: -1.6, y: -1.6 }, trees: 0.4,
    bunkers: [
      { along: 290, lateral: -18, size: 6, kind: 'fairway', deep: true },
      { along: 428, lateral: 14, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: 1, from: 0, to: 445, depth: 90 },
      { kind: 'houses', side: -1, from: 150, to: 445, depth: 80, gap: 8 },
    ],
    strategy: 'Four hundred and forty-five into the prevailing wind, with sand down the left at the end of the drive and a green that will not hold a long iron.',
  },
  {
    number: 14, name: 'The Uphill Five', par: 5, yards: 580, bearing: 96, index: 10,
    dogleg: 26, doglegAt: 0.6, fairwayWidth: 17,
    landforms: [{ at: 0.75, rise: 26, length: 200 }],
    elevation: { landing: 8, green: 34 }, greenSize: 11, pin: { x: 3, y: -3 },
    greenSlope: { x: -2.4, y: -2.2 }, trees: 0.5,
    bunkers: [
      { along: 500, lateral: 18, size: 6, kind: 'fairway' },
      { along: 556, lateral: 14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: -1, from: 0, to: 580, depth: 100 },
      { kind: 'houses', side: 1, from: 240, to: 580, depth: 90, gap: 8 },
    ],
    strategy: 'Five hundred and eighty uphill, bending right, to the most severely pitched green on the course. The third shot has to finish below the hole or the putt is unplayable.',
  },
  {
    number: 15, name: 'Short and Tight', par: 4, yards: 397, bearing: 270, index: 14,
    dogleg: -12, doglegAt: 0.55, fairwayWidth: 15,
    elevation: { landing: -2, green: -6 }, greenSize: 12, pin: { x: 2, y: 2 },
    greenSlope: { x: 1.4, y: -1.4 }, trees: 0.6,
    bunkers: [
      { along: 262, lateral: -16, size: 5, kind: 'fairway' },
      { along: 380, lateral: -13, size: 5, kind: 'greenside', deep: true },
      { along: 386, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'houses', side: -1, from: 0, to: 397, depth: 90 },
      { kind: 'woodland', side: 1, from: 0, to: 397, depth: 80 },
    ],
    strategy: 'A tight drive between trees and out of bounds, then a short iron to a green defended on both sides. The tee shot is the hole.',
  },
  {
    number: 16, name: 'The Bend', par: 4, yards: 403, bearing: 320, index: 16,
    dogleg: -24, doglegAt: 0.5, fairwayWidth: 16,
    bends: [{ at: 0.5, shift: -24, turn: 0.22 }],
    elevation: { landing: -4, green: -8 }, greenSize: 12, pin: { x: -3, y: 2 },
    greenSlope: { x: -1.4, y: -1.6 }, trees: 0.55,
    bunkers: [
      { along: 270, lateral: 18, size: 6, kind: 'fairway', deep: true },
      { along: 388, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'woodland', side: -1, from: 0, to: 403, depth: 100 },
      { kind: 'woodland', side: 1, from: 100, to: 403, depth: 70 },
    ],
    strategy: 'The last inland hole, turning left round a stand of cypress with sand at the outside of the corner. Play it as a three-shot par 4 and it is straightforward; try to cut it and it is not.',
  },
  {
    number: 17, name: 'The Hourglass', par: 3, yards: 208, bearing: 340, index: 4,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 12,
    widths: [{ at: 0, half: 0 }, { at: 0.6, half: 0 }, { at: 0.84, half: 10 }, { at: 1, half: 13 }],
    elevation: { landing: -2, green: -4 }, greenSize: 12, pin: { x: -4, y: 3 },
    greenSlope: { x: -2.0, y: -1.8 }, trees: 0.12,
    bunkers: [
      { along: 190, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 196, lateral: 14, size: 5, kind: 'greenside', deep: true },
      { along: 214, lateral: -8, size: 5, kind: 'greenside' },
    ],
    water: [],
    scenery: [
      { kind: 'ocean', side: 0, from: 0, to: 0, depth: 190, gap: 10 },
      { kind: 'ocean', side: -1, from: 50, to: 208, depth: 150, gap: 12 },
      { kind: 'meadow', side: 1, from: 0, to: 208, depth: 70 },
    ],
    strategy: 'Two hundred and eight yards across the wind to a green shaped like an hourglass, pinched in the middle, with the ocean behind it. Two pins, two completely different shots.',
  },
  {
    number: 18, name: 'Along the Bay', par: 5, yards: 543, bearing: 26, index: 2,
    dogleg: 20, doglegAt: 0.55, fairwayWidth: 16,
    bends: [{ at: 0.55, shift: 20, turn: 0.24 }],
    elevation: { landing: 2, green: 4 }, greenSize: 13, pin: { x: 3, y: -2 },
    greenSlope: { x: -1.6, y: -1.4 }, trees: 0.45,
    bunkers: [
      { along: 300, lateral: 18, size: 6, kind: 'fairway' },
      { along: 512, lateral: 14, size: 6, kind: 'greenside', deep: true },
      { along: 524, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [
      { along: 270, lateral: -70, size: 70, strip: { from: 60, to: 520, side: -1, offset: 26, width: 90 } },
    ],
    // Carmel Bay. The playable water down the left is the strip on this hole's
    // own spec; this band is the rest of the ocean beyond it.
    scenery: [
      { kind: 'ocean', side: -1, from: 0, to: 543, depth: 200 },
      { kind: 'houses', side: 1, from: 120, to: 543, depth: 90, gap: 8 },
    ],
    strategy: 'Five hundred and forty-three yards with Carmel Bay down the entire left side and two trees in the middle of the fairway. The safe line is right, and right brings the bunker and a longer third.',
  },
];

/**
 * The 1st, traced off the satellite image behind the hole overhead. Pixels in
 * `public/holes/pebble/1-sat.jpg`, north up and y down at the image's own size.
 * The three points the overlay measures — the tee, the 242 marker and the pin —
 * are read straight off it, and the two legs come out at 236 and 142 against the
 * 236 and 142 the card asks for.
 */
const TRACES: Partial<Record<number, TracedHole>> = {
  1: {
    tee: [110, 1875],
    playLine: [[110, 1875], [792, 1364], [1305, 1353]],
    pin: [1308, 1353],
    // Small, and the first small green of the round: twenty-seven by twenty-two.
    green: [
      [1250, 1330], [1264, 1318], [1284, 1312], [1304, 1311], [1324, 1316], [1338, 1328],
      [1346, 1344], [1348, 1362], [1344, 1376], [1332, 1386], [1312, 1390], [1292, 1388],
      [1270, 1378], [1256, 1362], [1249, 1346],
    ],
    // Six of them, found by flood-filling the bright pixels rather than drawn
    // round by hand: two down the left of the second shot and four around the
    // green, which is what turns a three-hundred-and-seventy-eight-yard hole
    // into one you cannot be careless on.
    bunkers: [
      {
        shape: [[822, 1314], [830, 1300], [842, 1300], [858, 1298], [884, 1302], [886, 1308], [886, 1328], [880, 1330], [866, 1336], [852, 1334], [830, 1330], [820, 1324]],
        kind: 'fairway',
      },
      {
        shape: [[986, 1308], [1000, 1298], [1006, 1294], [1022, 1294], [1036, 1294], [1042, 1308], [1040, 1312], [1026, 1318], [1008, 1324], [1000, 1324], [982, 1326], [978, 1320]],
        kind: 'fairway',
      },
      {
        shape: [[1228, 1298], [1242, 1290], [1252, 1284], [1264, 1284], [1290, 1282], [1296, 1282], [1296, 1300], [1262, 1302], [1256, 1304], [1242, 1318], [1224, 1316], [1220, 1310]],
        kind: 'greenside', deep: true,
      },
      {
        shape: [[1352, 1304], [1350, 1298], [1360, 1298], [1370, 1300], [1376, 1304], [1376, 1312], [1374, 1320], [1366, 1320], [1358, 1316], [1352, 1310]],
        kind: 'greenside',
      },
      {
        shape: [[1244, 1400], [1248, 1390], [1256, 1382], [1268, 1380], [1278, 1382], [1286, 1386], [1280, 1406], [1278, 1416], [1270, 1424], [1260, 1418], [1246, 1410], [1240, 1408]],
        kind: 'greenside', deep: true,
      },
      {
        shape: [[1294, 1406], [1300, 1392], [1310, 1390], [1332, 1390], [1340, 1392], [1344, 1398], [1346, 1414], [1342, 1420], [1332, 1424], [1322, 1420], [1304, 1426], [1296, 1424], [1292, 1416]],
        kind: 'greenside', deep: true,
      },
    ],
    // Where the trees actually are, not where the turf stops. The canopy was
    // measured band by band out from the line of play — dark textured green
    // only, so roofs, roads and car parks do not count as timber — and what it
    // shows is not two continuous walls. The right has a real belt, tight off
    // the tee and dense again through the corner, and then it stops: the second
    // half of the hole is open on that side. The left is open through the middle
    // altogether. Nothing at all stands within ten yards of the line of play.
    trees: [
      // Tight off the tee: the chute.
      {
        shape: [
          [136, 1910], [163, 1889], [191, 1869], [218, 1848], [245, 1828],
          [273, 1807], [300, 1787], [348, 1850], [320, 1871], [293, 1891],
          [266, 1912], [238, 1932], [211, 1953], [184, 1973],
        ],
        density: 0.58, canopy: [5, 11],
      },
      // The belt down the right through the corner — eighty to ninety-five per
      // cent canopy twenty to thirty yards off the line, and the reason the
      // drive has to hold the left half of the fairway.
      {
        shape: [
          [389, 1747], [440, 1709], [491, 1671], [542, 1632], [593, 1594],
          [644, 1556], [695, 1518], [756, 1599], [705, 1637], [654, 1675],
          [603, 1713], [552, 1751], [501, 1790], [450, 1828],
        ],
        density: 0.62, canopy: [5, 12],
      },
      // Thinning out around the houses right of the green.
      {
        shape: [
          [843, 1457], [907, 1455], [970, 1454], [1034, 1453], [1098, 1451],
          [1161, 1450], [1225, 1449], [1227, 1528], [1163, 1529], [1099, 1531],
          [1036, 1532], [972, 1534], [908, 1535], [845, 1536],
        ],
        density: 0.3, canopy: [4, 10],
      },
      // Left of the tee shot, and then nothing on that side for two hundred
      // yards.
      {
        shape: [
          [108, 1804], [141, 1780], [174, 1755], [206, 1731], [239, 1706],
          [272, 1681], [305, 1657], [253, 1587], [220, 1612], [187, 1637],
          [154, 1661], [122, 1686], [89, 1710], [56, 1735],
        ],
        density: 0.34, canopy: [4, 10],
      },
      {
        shape: [
          [867, 1297], [912, 1296], [958, 1295], [1003, 1294], [1049, 1293],
          [1094, 1292], [1140, 1292], [1138, 1205], [1092, 1206], [1047, 1207],
          [1001, 1208], [956, 1209], [910, 1210], [865, 1211],
        ],
        density: 0.22, canopy: [4, 10],
      },
      // Behind the green.
      {
        shape: [
          [1209, 1319], [1240, 1318], [1270, 1318], [1300, 1317], [1316, 1317],
          [1314, 1223], [1298, 1223], [1268, 1224], [1238, 1224], [1207, 1225],
        ],
        density: 0.36, canopy: [4, 10],
      },
    ],
    paths: [{ line: [[1120, 1470], [1200, 1462], [1280, 1452], [1360, 1444], [1430, 1440]], width: 3 }],
    // Tight off the tee — sixteen yards of fairway between the cottages — then
    // it opens through the corner and squeezes again onto the green.
    widths: [
      { at: 0.03, half: 8 }, { at: 0.12, half: 8 }, { at: 0.22, half: 10 },
      { at: 0.33, half: 14 }, { at: 0.45, half: 18 }, { at: 0.56, half: 19 },
      { at: 0.67, half: 17 }, { at: 0.78, half: 13 }, { at: 0.89, half: 14 },
      { at: 1, half: 14 },
    ],
  },
};

function cardEntry(spec: HoleSpec): CardEntry {
  return {
    number: spec.number, name: spec.name, par: spec.par, yards: spec.yards,
    bearing: spec.bearing, index: spec.index, elevation: spec.elevation,
    pin: spec.pin, greenSlope: spec.greenSlope, strategy: spec.strategy,
    image: `/holes/pebble/${spec.number}-sat.jpg`,
  };
}

const card: HoleSpec[] = holes.map((spec) => {
  const traced = TRACES[spec.number];
  if (!traced) return spec;
  const rebuilt = traceHole(traced, cardEntry(spec));
  return {
    ...rebuilt,
    groves: rebuilt.treeZones?.length ? undefined : spec.groves,
    landforms: spec.landforms,
    // The view is authored on the card, never traced: a photograph of a hole
    // does not tell you what is past the edge of it.
    scenery: spec.scenery,
    trees: rebuilt.treeZones?.length ? 0 : spec.trees,
    greenSize: rebuilt.greenShape ? rebuilt.greenSize : spec.greenSize,
    bunkers: rebuilt.bunkers.length ? rebuilt.bunkers : spec.bunkers,
    water: rebuilt.water.length ? rebuilt.water : spec.water,
    widths: rebuilt.widths ?? spec.widths,
    fairwayWidth: rebuilt.widths ? rebuilt.fairwayWidth : spec.fairwayWidth,
  };
});

export { SPLITS as PEBBLE_SPLITS };

const BLUE_YARDS: readonly number[] = holes.map((hole) => hole.yards);

const TEES: TeeSet[] = [
  {
    id: 'blue', name: 'Blue', yards: [...BLUE_YARDS], index: holes.map((hole) => hole.index),
    rating: 75.5, slope: 145,
  },
];

export const PEBBLE_BEACH: Course = {
  id: 'pebble',
  name: 'Pebble Beach Golf Links',
  location: 'Pebble Beach, California',
  real: true,
  style: 'links',
  par: card.reduce((sum, hole) => sum + hole.par, 0),
  yards: card.reduce((sum, hole) => sum + hole.yards, 0),
  blurb:
    'Jack Neville and Douglas Grant laid it along the cliffs of Carmel Bay in 1919 and barely touched the ground. Eight holes run on the edge of the Pacific, the par 4s at the turn are 505 and 495 yards, and the 7th is a hundred and six yards straight down to a rock in the ocean.',
  identity: [
    'The 1st is traced from the satellite; the rest of the card is the club\'s published championship set and not yet verified',
    'Eight holes on the cliff edge — the 4th to the 10th and the 17th and 18th',
    'The 9th and the 10th are par 4s of 505 and 495 yards, both falling toward the sea',
    'The 7th is 106 yards downhill with sand at every point of the compass',
    'The 8th\'s second shot is a long iron across a chasm of ocean',
    'Small greens throughout: several under 3,500 square feet',
    'Wind off the Pacific is the defence on a course that is not long on paper',
  ],
  tees: TEES,
  teeId: 'blue',
  // Sea level. Nothing here carries an extra yard.
  altitude: 20,
  // Cliff on one side, houses and cypress on the other.
  surroundWidth: 36,
  difficulty: 78,
  fit: {
    distance: 0.55, accuracy: 0.95, rough: 0.70, wind: 1.00, greens: 1.00,
    water: 0.55, elevation: 0.55, strategy: 0.90, heat: 0.10, rain: 0.55,
  },
  holes: card,
};
