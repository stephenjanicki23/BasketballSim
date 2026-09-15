/**
 * COURSE 5 — The Ranch (Southwick, Massachusetts).
 *
 * The second real course in the game, and the second one built through the
 * reconstruction pipeline in ./trace.ts. Damian Pascuzzo routed it over a
 * working dairy farm on the shoulder of Sodom Mountain in 2001: corridors cut
 * through mature New England hardwood, stone walls and cart-path switchbacks
 * between holes, and gradients no architect would dare build on flat ground.
 *
 * What is measured and what is not — stated plainly, because the distinction is
 * the whole point of the pipeline:
 *
 * 1. **The card is the club's.** Par, yardage and stroke index for all eighteen
 *    holes are the Gold card as the club publishes it — par 72, 7,129 yards,
 *    rating 74.8, slope 142 — and the intermediate distances recorded in
 *    `SPLITS` below are the ones printed on the hole-by-hole overheads: tee to
 *    the fairway marker, marker to the green. Nothing here is rounded to a nicer
 *    number and nothing is scaled to make a hole look right.
 * 2. **The splits place the corner; they do not measure it.** Both printed
 *    numbers are measured along the line of play, so on most holes they add up
 *    to the card and say nothing about how far the hole moves sideways — the 6th
 *    gives up 33 yards over 347 and the 7th gives up one over 400, and that
 *    difference is the corner being cut in one measurement and not the other
 *    rather than a shape. What they do fix, and fix exactly, is *where* a hole
 *    turns: the marker on the 6th is 63% of the way down it, on the 11th it is
 *    halfway, and test/ranch.ts holds every corner below to its own fraction.
 *    Which way each hole turns and how hard, where the sand sits and how the
 *    greens are shaped are authored from the club's own description of the
 *    property, and are the part a trace replaces — see `TRACES`.
 * 3. **The 1st, the 17th and the 18th are traced, not derived.** Their overheads
 *    arrived as images, so those three are read straight off the photograph —
 *    the line of play, the lake that runs the whole left side of the 1st, the
 *    pond that is all of the 17th, the green outlines, the wood on the inside of
 *    the 18th's turn and the stream down its right — and the card sets the
 *    scale, as it does everywhere. They were traced by eye rather than
 *    digitised, so call them accurate to a few yards, not to the yard. The hole
 *    card in the game says which holes these are, because a derived hole is the
 *    right length and the right shape of corner but not the right hole.
 * 4. **Elevation is inferred.** Plan-view overheads carry no contours, so the
 *    fall of each hole comes from the site — a property that runs from roughly
 *    250 feet at the entrance to better than 600 at the top of the hill, with
 *    the 3rd, 7th and 18th climbing it and the 10th and 15th coming back down.
 *    The altitude itself, worth about a percent of carry, is not a guess about
 *    this course but about where in the world it is.
 *
 * To finish any of the other fifteen the same way, trace its overhead and drop
 * the trace into `TRACES` keyed by hole number: the traced centreline, green,
 * bunkers, water and wooded edges then replace everything derived here, at the
 * card's own scale, with no other change to this file. The 17th and the 18th
 * below are the worked examples, and docs/adding-a-course.md has the procedure.
 */

import type { Course, HoleSpec, TeeSet } from '../../simulation/types';
import { traceHole, type CardEntry, type TracedHole } from './trace';

/**
 * Tee to the fairway marker, marker to the green, as printed on each overhead.
 * The card yardage less the sum of these is the slack the centreline carries.
 */
export const SPLITS: Readonly<Record<number, readonly number[]>> = {
  1: [298, 195], 2: [216, 175], 3: [289, 141], 4: [251, 179], 5: [191],
  6: [220, 127], 7: [200, 200], 8: [199], 9: [295, 233],
  10: [229, 207], 11: [195, 195], 12: [186], 13: [291, 285], 14: [254, 183],
  15: [204, 147], 16: [326, 273], 17: [182], 18: [263, 173],
};

const holes: HoleSpec[] = [
  {
    number: 1, name: 'Dairy Lane', par: 5, yards: 514, bearing: 168, index: 15,
    dogleg: -76, doglegAt: 0.62, fairwayWidth: 18,
    // The marker is 298 of 493 walked: the corridor turns left just past 60%
    // of the way down, which is where it swings away from the pond.
    bends: [{ at: 0.30, shift: -20, turn: 0.22 }, { at: 0.62, shift: -56, turn: 0.16 }],
    widths: [{ at: 0.08, half: 18 }, { at: 0.42, half: 19 }, { at: 0.66, half: 16 }, { at: 0.88, half: 15 }, { at: 1, half: 16 }],
    groves: [
      { from: 70, to: 470, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 7] },
      { from: 40, to: 300, side: -1, offset: 23, depth: 24, density: 0.4, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.4, rise: -13, length: 180 }],
    elevation: { landing: -16, green: -24 }, greenSize: 15, pin: { x: 4, y: 3 },
    greenSlope: { x: -1.6, y: 1.4 }, trees: 0.58,
    bunkers: [
      { along: 268, lateral: 20, size: 6, kind: 'fairway' },
      { along: 432, lateral: -19, size: 6, kind: 'fairway' },
      { along: 506, lateral: 15, size: 6, kind: 'greenside' },
    ],
    water: [{ along: 484, lateral: -27, size: 20, stretch: 1.3, label: 'the farm pond' }],
    strategy: 'Downhill away from the clubhouse with the lake down the entire left — it starts two hundred yards out and does not stop until past the green. The marker at 298 is out to the right for a reason, and the green is perched on the bank, so the third shot is played away from the flag more often than at it.',
  },
  {
    number: 2, name: 'The Elbow', par: 4, yards: 397, bearing: 84, index: 11,
    dogleg: 74, doglegAt: 0.54, fairwayWidth: 16,
    // 216 of 391 walked — the corner is at 55%, and it is a corner rather
    // than a drift.
    bends: [{ at: 0.54, shift: 74, turn: 0.11 }],
    widths: [{ at: 0.08, half: 17 }, { at: 0.45, half: 16 }, { at: 0.72, half: 13 }, { at: 1, half: 16 }],
    groves: [
      { from: 196, to: 266, side: 1, offset: 6, depth: 26, density: 0.68, canopy: [7, 12] },
      { from: 60, to: 380, side: -1, offset: 22, depth: 24, density: 0.42, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.62, rise: 9, length: 150 }],
    elevation: { landing: 6, green: 15 }, greenSize: 13, pin: { x: -3, y: 4 },
    greenSlope: { x: 1.4, y: -1.8 }, trees: 0.64,
    bunkers: [
      { along: 236, lateral: -18, size: 6, kind: 'fairway' },
      { along: 384, lateral: 14, size: 6, kind: 'greenside', deep: true },
      { along: 390, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'A tee shot to a corner you cannot see round — the timber on the inside is eighty feet tall. Take the 3 wood to the marker and there is a mid-iron up the hill; take the driver at the trees and there is a wedge out sideways.',
  },
  {
    number: 3, name: 'Sodom Hill', par: 4, yards: 424, bearing: 12, index: 3,
    dogleg: 12, doglegAt: 0.55, fairwayWidth: 16,
    // 289 + 141 = 430 against 424: the marker distances round up, the hole is
    // straight, and it is all uphill. The hardest four on the card.
    bends: [{ at: 0.5, shift: 12, turn: 0.26 }],
    widths: [{ at: 0.08, half: 17 }, { at: 0.5, half: 16 }, { at: 0.78, half: 14 }, { at: 1, half: 16 }],
    groves: [
      { from: 60, to: 410, side: -1, offset: 20, depth: 28, density: 0.46, canopy: [4, 8] },
      { from: 90, to: 410, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 8] },
    ],
    landforms: [{ at: 0.56, rise: 15, length: 210 }],
    elevation: { landing: 20, green: 34 }, greenSize: 14, pin: { x: 3, y: -4 },
    greenSlope: { x: -1.8, y: -2.2 }, trees: 0.7,
    bunkers: [
      { along: 252, lateral: 19, size: 6, kind: 'fairway' },
      { along: 404, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 414, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Thirty-four feet of climb between two walls of hardwood, which is a club and a half of it. Nobody minds a four here and the field average says so.',
  },
  {
    number: 4, name: 'Stone Wall', par: 4, yards: 428, bearing: 300, index: 1,
    dogleg: -34, doglegAt: 0.56, fairwayWidth: 17,
    bends: [{ at: 0.56, shift: -34, turn: 0.18 }],
    widths: [{ at: 0.08, half: 18 }, { at: 0.48, half: 17 }, { at: 0.76, half: 14 }, { at: 1, half: 16 }],
    groves: [
      { from: 80, to: 400, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 7] },
      { from: 250, to: 420, side: -1, offset: 21, depth: 24, density: 0.42, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.35, rise: -10, length: 160 }, { at: 0.82, rise: 6, length: 110 }],
    elevation: { landing: -12, green: -4 }, greenSize: 14, pin: { x: -4, y: 3 },
    greenSlope: { x: 1.2, y: -1.4 }, trees: 0.62,
    bunkers: [
      { along: 266, lateral: -19, size: 6, kind: 'fairway' },
      { along: 404, lateral: 14, size: 6, kind: 'greenside' },
    ],
    water: [{ along: 318, lateral: -2, size: 22, stretch: 0.42, label: 'the brook' }],
    strategy: 'Downhill off the tee to a brook that crosses at 320 and a green back up the far bank. Long enough that the drive has to find the fairway and short enough that laying up leaves a full club more than you want.',
  },
  {
    number: 5, name: 'Cow Pasture', par: 3, yards: 193, bearing: 226, index: 17,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 13,
    widths: [{ at: 0, half: 0 }, { at: 0.58, half: 0 }, { at: 0.76, half: 11 }, { at: 1, half: 14 }],
    groves: [
      { from: 30, to: 170, side: -1, offset: 15, depth: 24, density: 0.5, canopy: [4, 8] },
      { from: 30, to: 170, side: 1, offset: 16, depth: 24, density: 0.48, canopy: [4, 8] },
    ],
    landforms: [{ at: 0.5, rise: -12, length: 120 }],
    elevation: { landing: -8, green: -18 }, greenSize: 14, pin: { x: 3, y: 3 },
    greenSlope: { x: -1.6, y: 1.6 }, trees: 0.66,
    bunkers: [
      { along: 176, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 192, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'A long iron from a shelf in the trees, all carry over wetland to a green eighteen feet below the tee. The drop is worth a club, the wind up there is worth another, and they do not always point the same way.',
  },
  {
    number: 6, name: 'Hard Left', par: 4, yards: 380, bearing: 152, index: 9,
    dogleg: -86, doglegAt: 0.62, fairwayWidth: 16,
    // 220 of 347 walked: the corner is 63% of the way down, and the 33 yards
    // the legs give up against the card is how much of it the measurement cut.
    bends: [{ at: 0.62, shift: -86, turn: 0.1 }],
    widths: [{ at: 0.08, half: 17 }, { at: 0.5, half: 16 }, { at: 0.74, half: 13 }, { at: 1, half: 15 }],
    groves: [
      { from: 210, to: 276, side: -1, offset: 6, depth: 26, density: 0.7, canopy: [7, 13] },
      { from: 60, to: 360, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.45, rise: -8, length: 150 }],
    elevation: { landing: -10, green: -6 }, greenSize: 13, pin: { x: 4, y: -3 },
    greenSlope: { x: -1.4, y: -1.6 }, trees: 0.68,
    bunkers: [
      { along: 232, lateral: 18, size: 6, kind: 'fairway' },
      { along: 366, lateral: -13, size: 6, kind: 'greenside' },
      { along: 372, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Two hundred and twenty to the corner and a hundred and twenty-seven from it: the hole tells you exactly what to hit and the trees on the inside make sure you do.',
  },
  {
    number: 7, name: 'The Haul', par: 4, yards: 401, bearing: 26, index: 13,
    dogleg: 8, doglegAt: 0.5, fairwayWidth: 16,
    // 200 and 200. Dead straight, dead uphill.
    bends: [{ at: 0.5, shift: 8, turn: 0.28 }],
    widths: [{ at: 0.08, half: 17 }, { at: 0.5, half: 16 }, { at: 0.8, half: 14 }, { at: 1, half: 16 }],
    groves: [
      { from: 60, to: 390, side: -1, offset: 20, depth: 28, density: 0.46, canopy: [4, 8] },
      { from: 60, to: 390, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 8] },
    ],
    landforms: [{ at: 0.6, rise: 17, length: 200 }],
    elevation: { landing: 22, green: 38 }, greenSize: 13, pin: { x: -3, y: -4 },
    greenSlope: { x: 1.6, y: -2.4 }, trees: 0.72,
    bunkers: [
      { along: 244, lateral: -18, size: 6, kind: 'fairway' },
      { along: 384, lateral: 15, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Thirty-eight feet of climb to a green you play blind to the surface of. Two clubs more than the number and a putt from below the hole is the whole ambition.',
  },
  {
    number: 8, name: 'Far Side', par: 3, yards: 204, bearing: 108, index: 7,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 13,
    widths: [{ at: 0, half: 0 }, { at: 0.52, half: 0 }, { at: 0.74, half: 12 }, { at: 1, half: 14 }],
    groves: [
      { from: 30, to: 190, side: 1, offset: 16, depth: 24, density: 0.48, canopy: [4, 8] },
      { from: 60, to: 190, side: -1, offset: 17, depth: 22, density: 0.44, canopy: [4, 8] },
    ],
    landforms: [{ at: 0.5, rise: -14, length: 130 }],
    elevation: { landing: -12, green: -22 }, greenSize: 15, pin: { x: -4, y: 4 },
    greenSlope: { x: 1.4, y: -1.4 }, trees: 0.64,
    bunkers: [
      { along: 186, lateral: 15, size: 7, kind: 'greenside', stretch: 1.8 },
      { along: 206, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Two hundred and four off a pad in the trees, twenty-two feet downhill, to a big green with sand down the whole right side. A three is worth more than the card suggests.',
  },
  {
    number: 9, name: 'Home Field', par: 5, yards: 537, bearing: 350, index: 5,
    dogleg: 50, doglegAt: 0.56, fairwayWidth: 18,
    bends: [{ at: 0.34, shift: 16, turn: 0.2 }, { at: 0.56, shift: 34, turn: 0.2 }],
    widths: [{ at: 0.08, half: 19 }, { at: 0.42, half: 18 }, { at: 0.68, half: 15 }, { at: 0.88, half: 16 }, { at: 1, half: 16 }],
    groves: [
      { from: 80, to: 500, side: -1, offset: 21, depth: 26, density: 0.44, canopy: [4, 8] },
      { from: 140, to: 440, side: 1, offset: 22, depth: 24, density: 0.42, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.58, rise: 14, length: 200 }],
    elevation: { landing: 14, green: 26 }, greenSize: 15, pin: { x: 4, y: -3 },
    greenSlope: { x: -1.8, y: -2.0 }, trees: 0.6,
    bunkers: [
      { along: 280, lateral: 20, size: 6, kind: 'fairway' },
      { along: 452, lateral: -19, size: 6, kind: 'fairway', deep: true },
      { along: 524, lateral: 14, size: 6, kind: 'greenside' },
      { along: 530, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Five hundred and thirty-seven uphill and bending right twice, back toward the barn. Three good ones and it is a birdie hole; two good ones and a hanging lie and it is not.',
  },
  {
    number: 10, name: 'The Drop', par: 4, yards: 443, bearing: 196, index: 12,
    dogleg: -38, doglegAt: 0.52, fairwayWidth: 17,
    bends: [{ at: 0.52, shift: -38, turn: 0.2 }],
    widths: [{ at: 0.08, half: 18 }, { at: 0.5, half: 17 }, { at: 0.78, half: 14 }, { at: 1, half: 16 }],
    groves: [
      { from: 80, to: 420, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 8] },
      { from: 200, to: 430, side: -1, offset: 21, depth: 24, density: 0.42, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.3, rise: -22, length: 170 }],
    elevation: { landing: -30, green: -40 }, greenSize: 14, pin: { x: 3, y: 4 },
    greenSlope: { x: -1.4, y: 1.8 }, trees: 0.62,
    bunkers: [
      { along: 288, lateral: -19, size: 6, kind: 'fairway' },
      { along: 424, lateral: 14, size: 6, kind: 'greenside' },
      { along: 434, lateral: -13, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Four hundred and forty-three on the card and forty feet of it straight down, which is the only reason it is playable. The green falls away from you: everything wants to be pin high or short.',
  },
  {
    number: 11, name: 'Plateau', par: 4, yards: 389, bearing: 118, index: 6,
    dogleg: 26, doglegAt: 0.5, fairwayWidth: 16,
    // 195 and 195 — the marker sits at half way and the hole barely moves.
    bends: [{ at: 0.5, shift: 26, turn: 0.22 }],
    widths: [{ at: 0.08, half: 17 }, { at: 0.5, half: 16 }, { at: 0.8, half: 13 }, { at: 1, half: 15 }],
    groves: [
      { from: 60, to: 370, side: -1, offset: 20, depth: 26, density: 0.46, canopy: [4, 8] },
      { from: 100, to: 370, side: 1, offset: 21, depth: 24, density: 0.44, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.72, rise: 12, length: 130 }],
    elevation: { landing: 6, green: 20 }, greenSize: 13, pin: { x: -3, y: -3 },
    greenSlope: { x: 1.6, y: -1.8 }, trees: 0.66,
    bunkers: [
      { along: 246, lateral: 18, size: 6, kind: 'fairway' },
      { along: 374, lateral: -14, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'The second shot is played up onto a shelf with the ground falling away on three sides of it. Short is a pitch back up; long is somewhere in the trees.',
  },
  {
    number: 12, name: 'Quarry Short', par: 3, yards: 189, bearing: 42, index: 16,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 13,
    widths: [{ at: 0, half: 0 }, { at: 0.56, half: 0 }, { at: 0.78, half: 11 }, { at: 1, half: 14 }],
    groves: [
      { from: 30, to: 170, side: -1, offset: 15, depth: 24, density: 0.5, canopy: [4, 8] },
      { from: 30, to: 170, side: 1, offset: 15, depth: 24, density: 0.5, canopy: [4, 8] },
    ],
    landforms: [{ at: 0.5, rise: -10, length: 110 }],
    elevation: { landing: -6, green: -16 }, greenSize: 13, pin: { x: 3, y: -3 },
    greenSlope: { x: -2.0, y: -1.4 }, trees: 0.7,
    bunkers: [
      { along: 172, lateral: -13, size: 6, kind: 'greenside', deep: true },
      { along: 178, lateral: 13, size: 5, kind: 'greenside' },
      { along: 198, lateral: 0, size: 6, kind: 'greenside', stretch: 0.6 },
    ],
    water: [],
    strategy: 'A hundred and eighty-nine downhill through a gap in the trees to a green with sand at every point of the compass except the front. The tee shot is the hole.',
  },
  {
    number: 13, name: 'The Long Field', par: 5, yards: 610, bearing: 320, index: 2,
    dogleg: 62, doglegAt: 0.52, fairwayWidth: 18,
    // 291 and 285: the marker is halfway down, so the hole turns in the middle
    // and keeps drifting the same way into the green.
    bends: [{ at: 0.52, shift: 40, turn: 0.22 }, { at: 0.80, shift: 22, turn: 0.18 }],
    widths: [{ at: 0.08, half: 19 }, { at: 0.4, half: 18 }, { at: 0.66, half: 16 }, { at: 0.86, half: 15 }, { at: 1, half: 16 }],
    groves: [
      { from: 80, to: 560, side: -1, offset: 21, depth: 28, density: 0.44, canopy: [4, 8] },
      { from: 160, to: 520, side: 1, offset: 22, depth: 26, density: 0.42, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.52, rise: 13, length: 220 }],
    elevation: { landing: 12, green: 28 }, greenSize: 15, pin: { x: -4, y: 4 },
    greenSlope: { x: 1.4, y: -2.0 }, trees: 0.6,
    bunkers: [
      { along: 296, lateral: 20, size: 6, kind: 'fairway' },
      { along: 470, lateral: -20, size: 6, kind: 'fairway' },
      { along: 528, lateral: 19, size: 6, kind: 'fairway', deep: true },
      { along: 598, lateral: -14, size: 6, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Six hundred and ten yards bending right and climbing, with sand at 296, 470 and 528. Three shots for everybody, and the third one is uphill to a green that runs off at the back.',
  },
  {
    number: 14, name: 'Hemlock', par: 4, yards: 445, bearing: 236, index: 4,
    dogleg: -40, doglegAt: 0.56, fairwayWidth: 16,
    bends: [{ at: 0.56, shift: -40, turn: 0.2 }],
    widths: [{ at: 0.08, half: 18 }, { at: 0.5, half: 16 }, { at: 0.78, half: 13 }, { at: 1, half: 16 }],
    groves: [
      { from: 70, to: 430, side: 1, offset: 20, depth: 28, density: 0.48, canopy: [5, 9] },
      { from: 70, to: 430, side: -1, offset: 21, depth: 26, density: 0.46, canopy: [5, 9] },
    ],
    landforms: [{ at: 0.4, rise: -14, length: 180 }],
    elevation: { landing: -18, green: -26 }, greenSize: 14, pin: { x: 4, y: 3 },
    greenSlope: { x: -1.6, y: 1.4 }, trees: 0.74,
    bunkers: [
      { along: 290, lateral: -19, size: 6, kind: 'fairway' },
      { along: 428, lateral: 14, size: 6, kind: 'greenside' },
      { along: 438, lateral: -13, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'The narrowest driving corridor on the back nine, running downhill through hemlock with the ground sloping the same way the hole bends. Anything leaking left is gone.',
  },
  {
    number: 15, name: 'Ski Jump', par: 4, yards: 350, bearing: 160, index: 14,
    dogleg: 28, doglegAt: 0.58, fairwayWidth: 16,
    bends: [{ at: 0.58, shift: 28, turn: 0.18 }],
    widths: [{ at: 0.08, half: 17 }, { at: 0.5, half: 16 }, { at: 0.76, half: 13 }, { at: 1, half: 15 }],
    groves: [
      { from: 50, to: 330, side: -1, offset: 19, depth: 26, density: 0.46, canopy: [4, 8] },
      { from: 90, to: 330, side: 1, offset: 20, depth: 24, density: 0.44, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.32, rise: -26, length: 150 }],
    elevation: { landing: -34, green: -42 }, greenSize: 13, pin: { x: -3, y: 3 },
    greenSlope: { x: 1.8, y: 1.2 }, trees: 0.66,
    bunkers: [
      { along: 244, lateral: 17, size: 6, kind: 'fairway' },
      { along: 336, lateral: -13, size: 6, kind: 'greenside', deep: true },
      { along: 344, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'Three hundred and fifty yards with forty feet of fall in it: reachable, and the reward for taking it on is a pitch from the trees rather than a wedge from the fairway. Most of the field hits 4 iron and a 9.',
  },
  {
    number: 16, name: 'Mill Pond', par: 5, yards: 611, bearing: 66, index: 8,
    dogleg: -50, doglegAt: 0.52, fairwayWidth: 18,
    bends: [{ at: 0.52, shift: -34, turn: 0.22 }, { at: 0.84, shift: -16, turn: 0.16 }],
    widths: [{ at: 0.08, half: 19 }, { at: 0.42, half: 18 }, { at: 0.7, half: 15 }, { at: 0.9, half: 14 }, { at: 1, half: 16 }],
    groves: [
      { from: 90, to: 560, side: 1, offset: 21, depth: 26, density: 0.44, canopy: [4, 8] },
      { from: 90, to: 420, side: -1, offset: 22, depth: 24, density: 0.42, canopy: [4, 7] },
    ],
    landforms: [{ at: 0.5, rise: -9, length: 200 }, { at: 0.9, rise: 7, length: 110 }],
    elevation: { landing: -12, green: -6 }, greenSize: 15, pin: { x: 4, y: -3 },
    greenSlope: { x: -1.6, y: -1.6 }, trees: 0.6,
    bunkers: [
      { along: 330, lateral: 20, size: 6, kind: 'fairway' },
      { along: 512, lateral: -20, size: 6, kind: 'fairway' },
      { along: 600, lateral: 15, size: 6, kind: 'greenside' },
    ],
    water: [{ along: 560, lateral: -30, size: 26, stretch: 1.5, label: 'the mill pond' }],
    strategy: 'The longest hole on the card, drifting left down to the water. The third shot is played along the edge of the pond to a green tipped toward it, and laying back to the right of the fairway bunker is not cowardice.',
  },
  {
    number: 17, name: 'Barnside', par: 3, yards: 182, bearing: 344, index: 18,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 13,
    // Traced: nothing but tee, water and green. The corridor does not start
    // until the far bank, which is what makes it all carry.
    widths: [{ at: 0, half: 0 }, { at: 0.78, half: 0 }, { at: 0.88, half: 7 }, { at: 0.95, half: 12 }, { at: 1, half: 13 }],
    landforms: [{ at: 0.5, rise: -7, length: 110 }],
    elevation: { landing: -6, green: -14 }, greenSize: 13, pin: { x: 3, y: 3 },
    greenSlope: { x: -1.6, y: 1.4 }, trees: 0.12,
    bunkers: [],
    water: [],
    strategy: 'A hundred and eighty-two, and a hundred and fifty of it is water. The pond runs from sixty yards off the tee to the front bank, the green sits on the far side of it with sand short-left, and there is no bail-out: the shot is the hole.',
  },
  {
    number: 18, name: 'Up to the Barn', par: 4, yards: 432, bearing: 8, index: 10,
    // Traced: out of the trees, right to the marker at 263, then back left to a
    // green with the property line and the stream down its right.
    dogleg: 20, doglegAt: 0.60, fairwayWidth: 17,
    bends: [{ at: 0.54, shift: 20, turn: 0.2 }],
    widths: [{ at: 0.08, half: 16 }, { at: 0.42, half: 19 }, { at: 0.62, half: 18 }, { at: 0.86, half: 14 }, { at: 1, half: 16 }],
    landforms: [{ at: 0.62, rise: 16, length: 180 }],
    elevation: { landing: 18, green: 30 }, greenSize: 15, pin: { x: -4, y: -3 },
    greenSlope: { x: 1.4, y: -2.0 }, trees: 0.58,
    bunkers: [
      { along: 278, lateral: 19, size: 6, kind: 'fairway' },
      { along: 416, lateral: -14, size: 6, kind: 'greenside' },
      { along: 424, lateral: 14, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    strategy: 'Out of a chute of hardwood, right to the marker at 263, then back left and uphill to a green with sand on both sides of it and the stream down the right. The drive has to come out of the trees before the hole will give you anything.',
  },
];

/**
 * Traces, keyed by hole number: pixels off the club's own overhead, y growing
 * down, at the image's own size. A hole in here is rebuilt from the photograph —
 * the card, the stroke index, the elevation and the strategy note carry over,
 * everything geometric is replaced, and the scale is fixed by the card yardage
 * on the played line. Holes not in here are built from the printed distances.
 *
 * The 17th and the 18th are traced off the 1440 × 2927 BlueGolf screenshots.
 * They were read by eye rather than digitised, so the shapes are within a few
 * yards rather than to the yard; press D in a round to lay the photograph back
 * over the geometry and see where they disagree.
 */
const TRACES: Partial<Record<number, TracedHole>> = {
  1: {
    tee: [580, 2271],
    // The marker at 298, with 195 left to the green.
    playLine: [[580, 2271], [755, 1504], [577, 1024]],
    pin: [577, 1024],
    green: [
      [588, 941], [612, 951], [623, 977], [620, 1010], [603, 1030],
      [580, 1035], [562, 1021], [555, 992], [562, 961],
    ],
    // The lake. It starts about two hundred yards off the tee and runs the whole
    // rest of the hole down the left, up to and past the green, which is perched
    // on the bank of it — the reason the second shot is played out to the right.
    water: [[
      [505, 907], [439, 937], [414, 1010], [383, 1141], [373, 1288], [380, 1434],
      [402, 1566], [442, 1661], [498, 1709], [553, 1683], [574, 1551], [585, 1434],
      [597, 1317], [585, 1215], [562, 1112], [536, 1024], [518, 958],
    ]],
    bunkers: [
      { shape: [[632, 969], [656, 958], [667, 977], [656, 998], [635, 992]], kind: 'greenside' },
      { shape: [[673, 948], [702, 934], [726, 945], [720, 966], [685, 969]], kind: 'greenside' },
      { shape: [[729, 945], [758, 937], [773, 954], [749, 969], [726, 963]], kind: 'greenside' },
      { shape: [[626, 1036], [650, 1030], [661, 1048], [644, 1062], [626, 1053]], kind: 'greenside', deep: true },
      { shape: [[837, 1144], [863, 1133], [881, 1150], [866, 1168], [840, 1165]], kind: 'fairway' },
    ],
    // The clubhouse and the buildings behind the tee.
    ob: [[[378, 2049], [515, 2037], [536, 2283], [439, 2356], [375, 2283]]],
    trees: [
      { shape: [[900, 1010], [977, 1039], [983, 1493], [948, 1903], [893, 2093], [846, 2049], [896, 1756], [915, 1464], [893, 1229]], density: 0.4, canopy: [4, 8] },
      { shape: [[632, 1578], [685, 1566], [708, 1607], [697, 1654], [653, 1668], [626, 1636]], density: 0.6, canopy: [5, 9] },
      { shape: [[629, 2283], [761, 2298], [790, 2415], [659, 2429]], density: 0.5, canopy: [4, 8] },
    ],
    paths: [{ line: [[615, 2078], [688, 1946], [761, 1800], [822, 1654], [866, 1493], [878, 1346], [852, 1215], [814, 1112], [755, 1010], [682, 937]], width: 3 }],
    widths: [{ at: 0.08, half: 20 }, { at: 0.42, half: 24 }, { at: 0.62, half: 22 }, { at: 0.86, half: 17 }, { at: 1, half: 16 }],
  },
  17: {
    tee: [755, 2530],
    pin: [761, 1092],
    playLine: [[755, 2530], [761, 1092]],
    green: [
      [770, 1011], [829, 1025], [876, 1070], [902, 1132], [897, 1210],
      [855, 1272], [791, 1298], [728, 1284], [695, 1228], [688, 1149], [712, 1070],
    ],
    // The pond: from sixty yards off the tee to the bank the green sits on.
    water: [[
      [615, 2012], [700, 2045], [820, 2030], [930, 1985], [966, 1880], [960, 1700],
      [935, 1540], [900, 1440], [840, 1404], [760, 1412], [690, 1440], [640, 1530],
      [620, 1700], [612, 1880],
    ]],
    bunkers: [
      { shape: [[661, 1240], [688, 1201], [720, 1220], [714, 1267], [676, 1276]], kind: 'greenside' },
      { shape: [[878, 2184], [958, 2168], [983, 2231], [958, 2309], [893, 2293], [866, 2239]], kind: 'fairway' },
    ],
    paths: [{ line: [[571, 2098], [702, 2078], [819, 2075], [966, 2056]], width: 3 }],
    widths: [{ at: 0, half: 0 }, { at: 0.78, half: 0 }, { at: 0.88, half: 7 }, { at: 0.95, half: 12 }, { at: 1, half: 13 }],
  },
  18: {
    tee: [559, 2582],
    // The marker on the overhead: 263 from the tee, 173 to the green.
    playLine: [[559, 2582], [754, 1814], [556, 1299]],
    pin: [560, 1240],
    green: [
      [577, 1238], [602, 1245], [619, 1268], [621, 1304], [607, 1332],
      [581, 1342], [556, 1334], [542, 1309], [540, 1272], [555, 1248],
    ],
    // The stream and the property line down the right of the green.
    water: [[
      [896, 2075], [937, 1934], [958, 1747], [966, 1560], [948, 1404], [922, 1279],
      [896, 1186], [878, 1201], [904, 1295], [925, 1412], [943, 1560], [937, 1747],
      [915, 1934], [875, 2075],
    ]],
    trees: [
      // The stand on the inside of the turn, which is why the hole goes right.
      { shape: [[439, 1685], [505, 1654], [585, 1700], [593, 1856], [527, 1919], [454, 1888], [427, 1794]], density: 0.62, canopy: [5, 9] },
      // The chute off the tee.
      { shape: [[337, 2184], [439, 2153], [483, 2340], [468, 2652], [366, 2746], [329, 2496]], density: 0.5, canopy: [5, 9] },
      { shape: [[819, 2215], [937, 2262], [966, 2496], [878, 2714], [761, 2683], [761, 2418]], density: 0.5, canopy: [5, 9] },
    ],
    paths: [{ line: [[878, 2106], [937, 1872], [966, 1638], [958, 1404], [922, 1232]], width: 3 }],
    widths: [{ at: 0.08, half: 16 }, { at: 0.42, half: 19 }, { at: 0.62, half: 18 }, { at: 0.86, half: 14 }, { at: 1, half: 16 }],
  },
};

/** The hole's card row, for handing to the tracer. */
function cardEntry(spec: HoleSpec): CardEntry {
  return {
    number: spec.number, name: spec.name, par: spec.par, yards: spec.yards,
    index: spec.index, bearing: spec.bearing, elevation: spec.elevation,
    pin: spec.pin, greenSlope: spec.greenSlope, strategy: spec.strategy,
    image: `/holes/ranch/${spec.number}.jpg`,
  };
}

const card: HoleSpec[] = holes.map((spec) => {
  const traced = TRACES[spec.number];
  if (!traced) return spec;
  // Traced geometry wins, but the character of the hole — the grove structure,
  // the landforms, the stroke index — is kept unless the trace supplies its own.
  const rebuilt = traceHole(traced, cardEntry(spec));
  return {
    ...rebuilt,
    groves: rebuilt.treeZones?.length ? undefined : spec.groves,
    landforms: spec.landforms,
    trees: spec.trees,
    greenSize: rebuilt.greenShape ? rebuilt.greenSize : spec.greenSize,
    bunkers: rebuilt.bunkers.length ? rebuilt.bunkers : spec.bunkers,
    water: rebuilt.water.length ? rebuilt.water : spec.water,
    widths: rebuilt.widths ?? spec.widths,
    fairwayWidth: rebuilt.widths ? rebuilt.fairwayWidth : spec.fairwayWidth,
  };
});

/**
 * The Gold card, as the club publishes it. The holes are authored at this card,
 * so any other set of markers is this one with the tee moved: add them here.
 */
const GOLD_YARDS: readonly number[] = holes.map((hole) => hole.yards);

const TEES: TeeSet[] = [
  {
    id: 'gold', name: 'Gold', yards: [...GOLD_YARDS], index: holes.map((hole) => hole.index),
    rating: 74.8, slope: 142,
  },
];

export const THE_RANCH: Course = {
  id: 'ranch',
  name: 'The Ranch',
  location: 'Southwick, Massachusetts',
  real: true,
  style: 'parkland',
  par: card.reduce((sum, hole) => sum + hole.par, 0),
  yards: card.reduce((sum, hole) => sum + hole.yards, 0),
  blurb:
    'A dairy farm on the side of Sodom Mountain, turned into golf in 2001 and left as steep as it was found. Corridors through New England hardwood, stone walls between holes, and four greens that sit more than thirty feet below or above their tees.',
  identity: [
    'The club\'s Gold card: 7,129 yards, rating 74.8, slope 142',
    'Built hole by hole off the club\'s own overheads; the 17th and 18th traced from them',
    'Hillside routing: 40 feet down the 10th and the 15th, 38 up the 7th',
    'Hardwood on both sides of nearly every corridor — no bail-out and no recovery',
    'The 6th turns 220 yards from the tee and leaves 127 in',
    'The 13th and the 16th are 610 and 611 yards, both of them climbing at the end',
    'The 17th is 182 yards and 150 of them are water',
    'Water on the 1st, the 4th, the 16th and the 17th; the rest of the trouble is timber',
  ],
  tees: TEES,
  teeId: 'gold',
  // Southwick sits in the Westfield river valley and the property climbs the
  // hill behind it: call the playing surface 400 feet, worth under a percent
  // of carry.
  altitude: 400,
  // Cut through woods with the property line close behind them.
  surroundWidth: 34,
  difficulty: 76,
  fit: {
    distance: 0.70, accuracy: 0.95, rough: 0.65, wind: 0.25, greens: 0.70,
    water: 0.30, elevation: 1.00, strategy: 0.85, heat: 0.30, rain: 0.50,
  },
  holes: card,
};
