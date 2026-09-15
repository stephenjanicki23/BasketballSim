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
 * 3. **The 1st to the 10th, and the 17th and 18th, are traced, not derived.**
 *    Their overheads arrived as images, so those twelve are read straight off the
 *    photograph — the line of play, the lake that runs the whole left side of the
 *    1st, the wooded gully on the inside of the 2nd's elbow, the chute the 3rd is
 *    played out of, the timber down both sides of the 4th, the pond that is all
 *    of the 17th, the green outlines, the stream down the right of the 18th — and
 *    the card sets the scale, as it does everywhere. Tracing removes invention as
 *    well as adding fact: the 4th had a brook crossing it at 320 yards and the
 *    5th was a forced carry over wetland, and the photographs show neither. They were traced by eye rather than
 *    digitised, so call them accurate to a few yards, not to the yard. The hole
 *    card in the game says which holes these are, because a derived hole is the
 *    right length and the right shape of corner but not the right hole: the 2nd
 *    turns 116 yards *left* to its marker, and the derived version turned right.
 * 4. **Elevation is inferred.** Plan-view overheads carry no contours, so the
 *    fall of each hole comes from the site — a property that runs from roughly
 *    250 feet at the entrance to better than 600 at the top of the hill, with
 *    the 3rd, 7th and 18th climbing it and the 10th and 15th coming back down.
 *    The altitude itself, worth about a percent of carry, is not a guess about
 *    this course but about where in the world it is.
 *
 * To finish any of the other six the same way, trace its overhead and drop
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
    strategy: 'Hard left off the tee to a marker at 216, then 175 back to the right. The inside of the elbow is a wooded gully rather than a corner you can cut, so the only question is how much of the 216 you want to take on before the fairway runs out.',
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
    strategy: 'Out of a chute of hardwood, bending right to the marker at 289 and back left up the hill to the green. Thirty-four feet of climb is a club and a half of it, and the wood down the left runs the whole way: nobody minds a four here.',
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
    water: [],
    strategy: 'Four hundred and twenty-eight through a corridor of timber, out to the right and back left. There is no bail-out on either side and a clump of trees pinches the fairway from the right at 165: the drive is the hole.',
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
    greenSlope: { x: -1.6, y: 1.6 }, trees: 0.12,
    bunkers: [
      { along: 176, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 192, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    strategy: 'A hundred and ninety-three straight downhill through a gap in the timber. The whole right side of the green is a clover of sand and the trees are hard against it on the left: the miss is short, and everyone knows it.',
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
    strategy: 'Two hundred and twenty to the corner and a hundred and twenty-seven from it. The inside of the turn is sand rather than timber, so the corner can be taken on — but the bunker at the front of it is deep and the second shot from there is blind.',
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
    strategy: 'Two hundred and two hundred, straight, and thirty-eight feet of climb. The tee shot is played up a neck of fairway barely twenty yards wide before it opens out at the marker — and two clubs more than the number is still the right answer into the green.',
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
    strategy: 'Two hundred and four downhill, and three bunkers across the front of the green mean there is no running it on. Long is trees, short is sand: the only miss is left, and the pin is usually behind the middle one.',
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
    strategy: 'Out to the left to a marker at 295, then 233 back to the right and uphill to a green below the clubhouse. A stand of hardwood sits between the two legs, so going at it in two means going over them — and the ground short and right of the green is fescue, which is no bail-out at all.',
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
    strategy: 'Four hundred and forty-three with forty feet of drop in it, out to the right and back left. Native grass down both sides and a green that falls away from you: everything wants to be pin high or short.',
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
    strategy: 'A hundred and eighty-nine downhill through a gap in the trees to a narrow green set at an angle, with three bunkers down its left and a wood across the back. Miss it right; there is nothing there but grass.',
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
  12: {
    tee: [754, 2357],
    // 186 printed, 189 on the card, one leg, dead straight. The whole hole is
    // the tee shot and it is all downhill.
    playLine: [[754, 2357], [754, 1109]],
    pin: [754, 1109],
    // Narrow and deep — sixteen by twenty-five — set at an angle with the wood
    // right behind it. The back half sits in the shade of that wood on the
    // photograph, which is what makes this green hard to read off the image.
    green: [
      [748, 1040], [775, 1030], [800, 1042], [818, 1065], [825, 1095], [822, 1125],
      [810, 1155], [790, 1180], [765, 1192], [742, 1185], [727, 1160], [720, 1125], [721, 1090], [731, 1060],
    ],
    // All three bunkers are left. The card said sand at every point of the
    // compass except the front; the photograph says the right side is open and
    // the left is where you cannot go.
    bunkers: [
      {
        shape: [[585, 1088], [605, 1083], [620, 1095], [628, 1120], [618, 1140], [623, 1160], [613, 1178], [595, 1180], [585, 1160], [580, 1130], [581, 1105]],
        kind: 'greenside', deep: true,
      },
      {
        shape: [[658, 1220], [666, 1208], [682, 1208], [694, 1220], [690, 1240], [678, 1256], [678, 1272], [668, 1290], [658, 1300], [650, 1286], [652, 1262], [654, 1238]],
        kind: 'greenside', deep: true,
      },
      {
        shape: [[578, 1233], [595, 1230], [610, 1243], [614, 1263], [605, 1280], [590, 1289], [579, 1280], [574, 1260], [574, 1243]],
        kind: 'greenside',
      },
    ],
    trees: [
      // The stand across the back of the green. Its canopy reaches over the back
      // left corner on the photograph; it is traced to stop at the putting
      // surface, because a tree drawn on a green is a tree nobody believes.
      { shape: [[668, 940], [740, 925], [820, 935], [862, 965], [845, 1010], [790, 1025], [730, 1022], [682, 1005], [662, 975]], density: 0.6, canopy: [5, 11] },
      {
        shape: [
          [648, 1060], [640, 1180], [636, 1320], [618, 1460], [606, 1600], [618, 1740],
          [634, 1880], [628, 2020], [640, 2160], [652, 2300], [658, 2410],
          [548, 2410], [548, 2300], [548, 2160], [548, 2020], [548, 1880], [548, 1740],
          [548, 1600], [548, 1460], [552, 1320], [556, 1180], [560, 1060],
        ],
        density: 0.48, canopy: [4, 9],
      },
      {
        shape: [
          [886, 1760], [892, 1900], [898, 2040], [896, 2180], [886, 2320], [878, 2410],
          [958, 2410], [958, 2320], [958, 2180], [958, 2040], [958, 1900], [958, 1760],
        ],
        density: 0.48, canopy: [4, 9],
      },
    ],
    paths: [{
      line: [[885, 1800], [880, 1870], [878, 1935], [862, 2010], [845, 2100], [822, 2200], [790, 2235], [730, 2248], [678, 2262], [648, 2300]],
      width: 3,
    }],
    // Not a carry: there is mown ground the whole way, with the forward tees
    // sitting in it. What defends the hole is the width, which never gets past
    // fifteen yards either side until the green's own apron opens out.
    widths: [
      { at: 0.05, half: 11 }, { at: 0.20, half: 13 }, { at: 0.35, half: 12 },
      { at: 0.50, half: 11 }, { at: 0.65, half: 15 }, { at: 0.78, half: 20 },
      { at: 0.90, half: 15 }, { at: 1, half: 14 },
    ],
  },
  11: {
    tee: [753, 2356],
    // 195 and 195, and the overlay draws it dead straight: the marker sits on
    // the line at exactly half way. The corridor bends around it in the
    // photograph — left through the driving zone, right into the approach — but
    // the measured line is the measured line, so the width carries that instead.
    playLine: [[753, 2356], [753, 1732], [753, 1110]],
    pin: [754, 1110],
    green: [
      [732, 1060], [755, 1054], [777, 1060], [791, 1080], [795, 1097], [796, 1120],
      [791, 1140], [777, 1152], [757, 1157], [737, 1152], [722, 1135], [717, 1112], [718, 1087], [725, 1069],
    ],
    // Every bunker on this hole is on one side or the other and none of them is
    // round: two against the right of the green, one sixty yards short of it on
    // the same side, and the long S of sand down the left of the driving zone,
    // which is one bunker on the ground and two shapes here.
    bunkers: [
      {
        shape: [[814, 1094], [824, 1096], [836, 1104], [838, 1112], [830, 1122], [824, 1130], [816, 1134], [808, 1130], [806, 1120], [808, 1108]],
        kind: 'greenside', deep: true,
      },
      {
        shape: [[823, 1160], [835, 1155], [848, 1163], [850, 1178], [843, 1190], [833, 1200], [823, 1198], [818, 1185], [820, 1170]],
        kind: 'greenside',
      },
      {
        shape: [[798, 1258], [812, 1256], [824, 1268], [834, 1286], [846, 1296], [862, 1308], [862, 1330], [850, 1330], [838, 1314], [824, 1298], [812, 1292], [800, 1284], [794, 1270]],
        kind: 'fairway',
      },
      {
        shape: [[717, 1469], [728, 1471], [737, 1485], [746, 1497], [743, 1510], [732, 1525], [723, 1538], [715, 1548], [708, 1555], [700, 1548], [705, 1533], [713, 1515], [715, 1497], [712, 1482]],
        kind: 'fairway', deep: true,
      },
      {
        shape: [[700, 1567], [713, 1572], [725, 1569], [737, 1572], [738, 1580], [732, 1587], [723, 1590], [728, 1600], [723, 1608], [712, 1607], [705, 1613], [700, 1627], [695, 1632], [690, 1623], [687, 1608], [680, 1597], [683, 1588], [692, 1577]],
        kind: 'fairway', deep: true,
      },
    ],
    // A wooded corridor, not a links hole: no native grass on this one, timber
    // both sides. The inner edges were measured off the photograph the same way
    // as the fairway — out from the line until the grass stops being grass.
    trees: [
      { shape: [[645, 1020], [700, 995], [780, 985], [860, 1000], [885, 1035], [800, 1045], [700, 1050], [650, 1045]], density: 0.55, canopy: [5, 10] },
      {
        shape: [
          [676, 1020], [674, 1100], [678, 1180], [670, 1260], [690, 1340], [670, 1420], [658, 1500],
          [645, 1580], [613, 1660], [592, 1740], [592, 1820], [592, 1900], [588, 1980], [620, 2060],
          [660, 2140], [665, 2220], [650, 2300], [640, 2380],
          [524, 2380], [524, 2300], [524, 2220], [524, 2140], [524, 2060], [524, 1980], [524, 1900],
          [524, 1820], [524, 1740], [532, 1660], [546, 1580], [558, 1500], [570, 1420], [590, 1340],
          [570, 1260], [578, 1180], [574, 1100], [576, 1020],
        ],
        density: 0.5, canopy: [4, 9],
      },
      {
        shape: [
          [880, 1040], [895, 1120], [905, 1200], [915, 1280], [920, 1360], [912, 1440],
          [958, 1440], [958, 1360], [958, 1280], [958, 1200], [958, 1120], [958, 1040],
        ],
        density: 0.5, canopy: [4, 9],
      },
    ],
    paths: [{
      line: [
        [915, 1440], [880, 1500], [858, 1570], [845, 1650], [840, 1730], [838, 1810], [828, 1880],
        [812, 1950], [790, 2020], [772, 2080], [760, 2150], [745, 2230], [735, 2290],
      ],
      width: 3,
    }],
    // Narrow off the tee, wide through the driving zone where the sand is, then
    // squeezed again by the bunkers short of the green.
    widths: [
      { at: 0.05, half: 10 }, { at: 0.15, half: 12 }, { at: 0.25, half: 16 },
      { at: 0.34, half: 28 }, { at: 0.44, half: 30 }, { at: 0.55, half: 22 },
      { at: 0.65, half: 17 }, { at: 0.75, half: 23 }, { at: 0.85, half: 20 }, { at: 1, half: 17 },
    ],
  },
  10: {
    tee: [591, 2347],
    // 229 out to a marker fifty-six yards RIGHT of the line, 207 back left and
    // downhill. The derived version bent left.
    playLine: [[591, 2347], [755, 1698], [585, 1108]],
    pin: [585, 1108],
    // Re-measured. The first pass outlined the whole shelf; this is the smooth
    // part, thirty by thirty-five, centred on the overlay's marker.
    green: [
      [545, 1090], [556, 1070], [576, 1059], [600, 1058], [620, 1068], [630, 1088],
      [633, 1112], [628, 1136], [612, 1153], [590, 1159], [568, 1153], [553, 1136], [546, 1112],
    ],
    // One bunker on this hole, and it is the kidney left of the green. The
    // fairway bunker the first pass put at the 229 marker is not there: what is
    // there, on the photograph, is a pair of sprinkler heads.
    bunkers: [
      {
        shape: [
          [515, 1118], [530, 1120], [540, 1133], [539, 1148], [529, 1155], [534, 1170],
          [530, 1186], [518, 1194], [505, 1188], [498, 1170], [495, 1153], [500, 1134], [508, 1120],
        ],
        kind: 'greenside', deep: true,
      },
    ],
    // Trees only where there are trees: the wood across the back of the green,
    // and the scrubby line down the left shoulder above the mound. Everything
    // else down both sides is native grass, traced below.
    trees: [
      { shape: [[439, 907], [615, 893], [761, 937], [790, 1010], [629, 1024], [483, 1010]], density: 0.5, canopy: [5, 10] },
      { shape: [[452, 1075], [508, 1062], [530, 1180], [534, 1320], [524, 1450], [486, 1480], [458, 1370], [448, 1220]], density: 0.36, canopy: [4, 8] },
    ],
    // Both sides are native grass, and this pass measured it rather than
    // guessed: the mown edge was found row by row off the photograph, out from
    // the line of play until the turf stops being turf. Left is the lumpy mound
    // through the driving zone running unbroken down to the tee; right is the
    // shelf beyond the cart path.
    fescue: [
      [
        [552, 1200], [542, 1250], [528, 1300], [562, 1350], [558, 1400],
        [605, 1450], [615, 1500], [659, 1550], [673, 1600], [693, 1650],
        [716, 1700], [712, 1750], [678, 1800], [643, 1850], [616, 1900],
        [624, 1950], [634, 2000], [636, 2050], [623, 2100], [587, 2150],
        [552, 2200], [539, 2250], [544, 2300], [474, 2300], [466, 2250],
        [461, 2200], [478, 2150], [498, 2100], [529, 2050], [531, 2000],
        [531, 1950], [510, 1900], [552, 1850], [596, 1800], [642, 1750],
        [646, 1700], [608, 1650], [582, 1600], [564, 1550], [535, 1500],
        [531, 1450], [488, 1400], [491, 1350], [457, 1300], [471, 1250],
        [482, 1200],
      ],
      [
        [717, 1200], [728, 1250], [744, 1300], [770, 1350], [792, 1400],
        [822, 1450], [850, 1500], [876, 1550], [890, 1600], [859, 1650],
        [849, 1700], [833, 1750], [844, 1800], [820, 1850], [796, 1900],
        [774, 1950], [762, 2000], [748, 2050], [730, 2100], [697, 2150],
        [667, 2200], [647, 2250], [641, 2300], [738, 2300], [735, 2250],
        [737, 2200], [767, 2150], [800, 2100], [835, 2050], [859, 2000],
        [882, 1950], [896, 1900], [912, 1850], [925, 1800], [906, 1750],
        [919, 1700], [929, 1650], [960, 1600], [946, 1550], [920, 1500],
        [892, 1450], [862, 1400], [840, 1350], [814, 1300], [798, 1250],
        [787, 1200],
      ],
    ],
    paths: [{
      line: [
        [812, 1160], [770, 1235], [782, 1300], [800, 1380], [806, 1460], [798, 1545], [806, 1625],
        [820, 1710], [835, 1790], [852, 1870], [874, 1950], [888, 2030], [872, 2110], [820, 2165],
        [740, 2200], [650, 2230], [570, 2255],
      ],
      width: 3,
    }],
    // Measured the same way as the fescue, row by row: the tee shot is played up
    // a neck barely a dozen yards either side of the line, the hole opens out
    // through the driving zone into fifty-odd yards of mown grass, then pinches
    // again onto the green's shelf.
    widths: [
      { at: 0.05, half: 12 }, { at: 0.15, half: 13 }, { at: 0.28, half: 20 },
      { at: 0.38, half: 25 }, { at: 0.50, half: 28 }, { at: 0.62, half: 28 },
      { at: 0.75, half: 26 }, { at: 0.88, half: 22 }, { at: 1, half: 17 },
    ],
  },
  9: {
    tee: [755, 2345],
    // 295 out to a marker forty-five yards LEFT of the line, 233 back right to a
    // green below the clubhouse. The derived version bent right, twice.
    playLine: [[755, 2345], [648, 1655], [752, 1108]],
    pin: [752, 1108],
    // Re-measured: the first pass traced this green a dozen yards beyond where
    // it sits, which left it floating off the end of its own corridor. The
    // overlay's marker is the middle of the putting surface, and it is.
    green: [
      [730, 1094], [740, 1080], [756, 1074], [772, 1079], [784, 1092],
      [787, 1110], [782, 1128], [768, 1140], [750, 1142], [735, 1133], [728, 1116],
    ],
    bunkers: [
      { shape: [[688, 1578], [726, 1569], [743, 1598], [720, 1627], [688, 1618]], kind: 'fairway' },
    ],
    trees: [
      // The stand of hardwood between the two legs. It ends well short of the
      // green: the ground beside the putting surface on the right is fescue, not
      // timber, and the corridor runs out into it rather than into trees.
      { shape: [[770, 1290], [860, 1270], [880, 1400], [870, 1560], [800, 1640], [745, 1560], [740, 1400]], density: 0.62, canopy: [5, 10] },
      { shape: [[790, 1683], [890, 1698], [915, 1902], [900, 2137], [860, 2312], [800, 2371], [775, 2137], [781, 1888]], density: 0.5, canopy: [5, 10] },
      { shape: [[483, 1171], [570, 1150], [592, 1400], [585, 1700], [565, 1950], [540, 2166], [490, 2280], [462, 2000], [468, 1600], [474, 1330]], density: 0.45, canopy: [5, 9] },
    ],
    // The ground the user corrected me about: what sits right of and short of
    // this green is native grass, not timber. A broad band wrapping the front
    // right of the complex, and the hollow cut into the fairway left of it.
    fescue: [
      [[703, 1155], [747, 1152], [793, 1145], [843, 1137], [893, 1140], [923, 1148], [930, 1177], [923, 1210], [897, 1240], [860, 1250], [827, 1243], [793, 1233], [767, 1217], [740, 1207], [717, 1193], [700, 1172]],
      [[620, 1200], [643, 1185], [670, 1183], [693, 1190], [700, 1207], [690, 1230], [667, 1242], [640, 1240], [620, 1223]],
    ],
    paths: [{ line: [[480, 2078], [520, 1946], [550, 1815], [570, 1683], [580, 1551], [570, 1405], [560, 1288]], width: 3 }],
    // Wide the whole way. What takes the ground away at the green is not a
    // narrowing corridor but the fescue traced below: the mown grass wraps the
    // left and the back of the green, and the native grass eats the right.
    widths: [{ at: 0.08, half: 19 }, { at: 0.35, half: 22 }, { at: 0.55, half: 22 }, { at: 0.80, half: 21 }, { at: 1, half: 20 }],
  },
  8: {
    tee: [755, 2347],
    playLine: [[755, 2347], [755, 1108]],
    pin: [755, 1108],
    green: [
      [765, 992], [810, 1007], [839, 1047], [835, 1101], [807, 1143],
      [758, 1160], [713, 1140], [691, 1096], [693, 1041], [726, 1006],
    ],
    // Three bunkers across the front and left of it: there is no run-up.
    bunkers: [
      { shape: [[594, 1130], [635, 1118], [659, 1147], [641, 1182], [600, 1173]], kind: 'greenside', deep: true },
      { shape: [[699, 1218], [743, 1206], [764, 1238], [740, 1297], [705, 1288], [691, 1253]], kind: 'greenside' },
      { shape: [[784, 1226], [828, 1215], [852, 1247], [828, 1282], [790, 1276]], kind: 'greenside' },
    ],
    trees: [
      { shape: [[837, 1010], [937, 1024], [972, 1317], [978, 1683], [960, 2049], [922, 2283], [849, 2371], [813, 2049], [819, 1610], [828, 1259]], density: 0.5, canopy: [5, 10] },
      { shape: [[521, 1902], [585, 1888], [609, 2049], [597, 2254], [556, 2371], [512, 2283], [503, 2049]], density: 0.5, canopy: [5, 9] },
      { shape: [[615, 966], [732, 948], [819, 972], [813, 1010], [688, 1024], [620, 1007]], density: 0.45, canopy: [4, 9] },
    ],
    // The whole 199 yards is a carry over native grass. There is no fairway to
    // run it up: the mown ground on the left belongs to the corridor's edge,
    // and everything from thirty yards ahead of the tee to the bunkers short of
    // the green is fescue. Traced off the outline the user drew on the photo.
    fescue: [
      [[790, 1300], [750, 1400], [720, 1480], [698, 1580], [695, 1700], [705, 1820], [725, 1940], [742, 2060], [760, 2180], [785, 2270],
       [865, 2262], [875, 2160], [865, 2060], [852, 1960], [850, 1860], [858, 1760], [865, 1640], [862, 1520], [850, 1400], [825, 1320]],
    ],
    paths: [{ line: [[585, 2137], [615, 1990], [659, 1829], [688, 1654], [697, 1463], [688, 1288], [697, 1141]], width: 3 }],
    widths: [{ at: 0.06, half: 10 }, { at: 0.35, half: 14 }, { at: 0.60, half: 16 }, { at: 0.85, half: 15 }, { at: 1, half: 15 }],
  },
  7: {
    tee: [755, 2347],
    // 200 and 200, and dead straight — the one hole where the printed legs and
    // the photograph agree about everything. What they do not agree about is the
    // width: the tee shot is played up a neck barely twenty yards across before
    // the fairway opens out at the marker.
    playLine: [[755, 2347], [755, 1734], [755, 1108]],
    pin: [755, 1108],
    green: [
      [761, 1034], [789, 1046], [804, 1073], [797, 1108], [773, 1130],
      [741, 1128], [722, 1103], [719, 1069], [736, 1044]
    ],
    bunkers: [
      { shape: [[790, 1156], [828, 1144], [849, 1173], [828, 1206], [793, 1197]], kind: 'greenside', deep: true },
      { shape: [[808, 1317], [849, 1305], [869, 1337], [846, 1370], [808, 1361]], kind: 'fairway' },
    ],
    trees: [
      { shape: [[480, 937], [610, 919], [618, 1244], [606, 1610], [590, 1902], [570, 2122], [540, 2341], [480, 2283], [470, 1756], [474, 1244]], density: 0.55, canopy: [5, 10] },
      { shape: [[863, 951], [966, 966], [974, 1171], [968, 1463], [956, 1756], [940, 2049], [900, 2283], [863, 2371], [852, 2049], [858, 1683], [860, 1317]], density: 0.55, canopy: [5, 10] },
      // The scrub that pinches in from the right where the chute ends.
      { shape: [[830, 1859], [895, 1847], [918, 1902], [889, 1961], [836, 1949]], density: 0.6, canopy: [5, 9] },
    ],
    paths: [{ line: [[761, 2312], [729, 2166], [740, 2049], [776, 1932], [802, 1815], [819, 1668], [828, 1463], [834, 1288]], width: 3 }],
    widths: [{ at: 0.06, half: 9 }, { at: 0.22, half: 11 }, { at: 0.45, half: 16 }, { at: 0.62, half: 18 }, { at: 0.85, half: 16 }, { at: 1, half: 15 }],
  },
  6: {
    tee: [755, 2347],
    // 220 to the corner, 127 from it, and the corner stands sixty-three yards
    // left of the line. The one hole the derived version already had turning the
    // right way — it just turned too far.
    playLine: [[755, 2347], [515, 1539], [751, 1108]],
    pin: [751, 1108],
    green: [
      [758, 1020], [797, 1032], [819, 1065], [814, 1109], [783, 1136],
      [743, 1132], [720, 1100], [717, 1057], [734, 1030],
    ],
    bunkers: [
      { shape: [[641, 1033], [676, 1024], [694, 1051], [676, 1080], [644, 1074], [629, 1054]], kind: 'greenside' },
      { shape: [[685, 1092], [717, 1086], [732, 1109], [711, 1130], [685, 1124]], kind: 'greenside', deep: true },
      // The complex on the inside of the corner: this is what the tee shot is
      // actually negotiating, and the derived hole had trees there instead.
      { shape: [[553, 1456], [615, 1442], [656, 1478], [661, 1537], [629, 1578], [583, 1573], [553, 1537], [544, 1493]], kind: 'fairway', deep: true },
      { shape: [[503, 1712], [585, 1698], [620, 1756], [612, 1844], [556, 1888], [509, 1861], [492, 1785]], kind: 'fairway' },
    ],
    trees: [
      { shape: [[790, 1141], [878, 1171], [937, 1317], [958, 1537], [951, 1829], [922, 2122], [863, 2341], [790, 2415], [761, 2122], [772, 1756], [781, 1463]], density: 0.52, canopy: [5, 10] },
      { shape: [[334, 1405], [410, 1376], [468, 1463], [483, 1683], [468, 1902], [439, 2122], [383, 2224], [334, 2107], [322, 1756]], density: 0.48, canopy: [5, 10] },
      { shape: [[688, 937], [790, 919], [849, 966], [834, 1024], [732, 1010], [682, 977]], density: 0.5, canopy: [4, 9] },
    ],
    paths: [{ line: [[761, 2137], [688, 2019], [629, 1902], [585, 1756]], width: 3 }],
    widths: [{ at: 0.08, half: 16 }, { at: 0.40, half: 19 }, { at: 0.58, half: 15 }, { at: 0.70, half: 16 }, { at: 0.88, half: 15 }, { at: 1, half: 15 }],
  },
  5: {
    tee: [755, 2347],
    // Dead straight, and the ground in between is mown rather than the wetland
    // carry the derived version invented for it.
    playLine: [[755, 2347], [755, 1108]],
    pin: [755, 1108],
    green: [
      [762, 979], [809, 996], [840, 1035], [834, 1093], [797, 1134],
      [748, 1141], [711, 1110], [701, 1052], [725, 1006],
    ],
    bunkers: [
      // The clover: the whole right side of the green sits behind it.
      { shape: [[790, 1276], [831, 1253], [846, 1276], [878, 1270], [896, 1302], [872, 1329], [884, 1361], [849, 1375], [819, 1355], [790, 1364], [772, 1332], [784, 1302]], kind: 'greenside', deep: true },
      { shape: [[878, 1042], [916, 1030], [942, 1056], [937, 1112], [913, 1156], [884, 1165], [869, 1130], [872, 1080]], kind: 'greenside' },
      { shape: [[656, 1080], [685, 1071], [699, 1095], [682, 1121], [656, 1115]], kind: 'greenside' },
    ],
    trees: [
      { shape: [[541, 907], [607, 896], [622, 1141], [612, 1463], [597, 1756], [585, 2049], [571, 2283], [530, 2341], [515, 1902], [512, 1317]], density: 0.52, canopy: [5, 10] },
      { shape: [[878, 1434], [951, 1463], [977, 1756], [971, 2078], [942, 2312], [875, 2371], [861, 2049], [866, 1698]], density: 0.5, canopy: [5, 10] },
      { shape: [[600, 1178], [655, 1166], [672, 1220], [650, 1266], [604, 1257], [588, 1216]], density: 0.55, canopy: [5, 9] },
      { shape: [[878, 937], [951, 960], [960, 1024], [907, 1024], [872, 989]], density: 0.5, canopy: [4, 9] },
    ],
    paths: [{ line: [[858, 1522], [837, 1698], [814, 1888], [790, 2049], [767, 2195]], width: 3 }],
    widths: [{ at: 0.06, half: 10 }, { at: 0.35, half: 13 }, { at: 0.60, half: 14 }, { at: 0.85, half: 13 }, { at: 1, half: 14 }],
  },
  4: {
    tee: [626, 2344],
    // A gentle S: 251 out to the marker, forty-odd yards right of the line, then
    // 179 back left to the green. Timber on both sides the whole way.
    playLine: [[626, 2344], [754, 1623], [625, 1108]],
    pin: [625, 1108],
    green: [
      [632, 1024], [661, 1036], [676, 1065], [670, 1100], [644, 1124],
      [612, 1121], [591, 1094], [588, 1057], [606, 1030],
    ],
    bunkers: [
      { shape: [[667, 1109], [705, 1100], [720, 1130], [697, 1156], [667, 1147]], kind: 'greenside' },
      { shape: [[661, 1191], [702, 1185], [717, 1215], [691, 1241], [661, 1232]], kind: 'greenside', deep: true },
    ],
    trees: [
      { shape: [[424, 937], [498, 922], [585, 1024], [615, 1317], [603, 1683], [585, 2049], [541, 2283], [468, 2371], [419, 2049], [410, 1463], [416, 1141]], density: 0.55, canopy: [5, 10] },
      { shape: [[819, 966], [907, 1024], [951, 1317], [958, 1683], [937, 2049], [878, 2283], [813, 2341], [790, 1902], [796, 1463], [802, 1171]], density: 0.55, canopy: [5, 10] },
      // The clump that pinches the fairway from the right at about 165 yards.
      { shape: [[729, 1847], [784, 1838], [805, 1879], [784, 1917], [735, 1908], [720, 1879]], density: 0.62, canopy: [5, 9] },
    ],
    paths: [{ line: [[615, 1580], [688, 1573], [761, 1588], [819, 1566]], width: 3 }],
    widths: [{ at: 0.08, half: 15 }, { at: 0.35, half: 18 }, { at: 0.60, half: 18 }, { at: 0.85, half: 15 }, { at: 1, half: 15 }],
  },
  3: {
    tee: [568, 2198],
    // Out to the right to the marker at 289, then 141 back to the left. The
    // corner stands about sixty yards off the line, so it is a bend rather than
    // the elbow the 2nd is — but it is not the straight hole the card implied.
    playLine: [[568, 2198], [754, 1380], [566, 995]],
    pin: [566, 995],
    green: [
      [574, 919], [603, 931], [620, 958], [615, 998], [591, 1024],
      [559, 1027], [539, 1004], [533, 966], [547, 934],
    ],
    bunkers: [
      { shape: [[626, 969], [656, 960], [670, 983], [653, 1010], [626, 1001]], kind: 'greenside' },
      { shape: [[571, 1089], [603, 1080], [620, 1106], [597, 1136], [571, 1124]], kind: 'greenside', deep: true },
      { shape: [[699, 1060], [732, 1051], [749, 1077], [726, 1100], [699, 1092]], kind: 'fairway' },
      { shape: [[632, 1264], [667, 1256], [685, 1285], [661, 1311], [632, 1302]], kind: 'fairway' },
      { shape: [[641, 1317], [676, 1311], [691, 1337], [667, 1361], [641, 1352]], kind: 'fairway' },
    ],
    trees: [
      // The wood down the left runs the whole length of the hole.
      { shape: [[366, 834], [439, 814], [515, 896], [544, 1112], [521, 1375], [483, 1639], [439, 1902], [383, 2078], [351, 1756], [348, 1317], [354, 1024]], density: 0.5, canopy: [5, 10] },
      // And the tee shot is played out of a chute between two stands.
      { shape: [[512, 1639], [585, 1624], [615, 1756], [600, 1961], [556, 2122], [505, 2092], [495, 1844]], density: 0.58, canopy: [5, 10] },
      { shape: [[688, 1668], [776, 1639], [819, 1756], [802, 1902], [720, 1932], [676, 1815]], density: 0.55, canopy: [5, 10] },
      { shape: [[849, 1024], [937, 1068], [958, 1288], [907, 1463], [843, 1375], [834, 1171]], density: 0.45, canopy: [4, 9] },
    ],
    paths: [{ line: [[761, 945], [819, 1024], [863, 1171], [884, 1317], [872, 1463], [828, 1595], [761, 1727], [688, 1902], [629, 2078]], width: 3 }],
    widths: [{ at: 0.08, half: 15 }, { at: 0.38, half: 19 }, { at: 0.62, half: 18 }, { at: 0.85, half: 15 }, { at: 1, half: 15 }],
  },
  2: {
    tee: [755, 2274],
    // Out to the left to the marker at 216, and 175 back to the right from it.
    // The corner stands 116 yards off the tee-to-green line: this is the hole
    // the printed legs were always describing, and the derived version had it
    // bending the other way.
    playLine: [[755, 2274], [300, 1541], [751, 1024]],
    pin: [751, 1024],
    green: [
      [739, 915], [783, 925], [808, 959], [802, 1002], [773, 1033],
      [732, 1036], [707, 1010], [702, 959], [717, 929],
    ],
    bunkers: [
      { shape: [[626, 1033], [661, 1024], [682, 1051], [661, 1083], [629, 1074]], kind: 'greenside' },
      { shape: [[591, 1115], [629, 1103], [650, 1130], [626, 1159], [594, 1150]], kind: 'greenside', deep: true },
      { shape: [[378, 1188], [421, 1179], [442, 1212], [416, 1244], [380, 1232]], kind: 'fairway' },
      { shape: [[304, 1297], [351, 1288], [369, 1323], [342, 1358], [307, 1346]], kind: 'fairway' },
      { shape: [[392, 2029], [442, 2017], [462, 2049], [436, 2084], [398, 2072]], kind: 'fairway' },
    ],
    trees: [
      // The gully on the inside of the elbow. It is why the hole is a dogleg
      // rather than a diagonal: there is nothing to cut across.
      { shape: [[515, 1463], [644, 1449], [761, 1507], [841, 1639], [834, 1858], [732, 2034], [615, 1946], [527, 1727]], density: 0.6, canopy: [5, 10] },
      { shape: [[790, 1024], [893, 1086], [915, 1288], [820, 1434], [720, 1317], [732, 1156]], density: 0.5, canopy: [4, 9] },
      { shape: [[790, 2151], [907, 2195], [937, 2415], [820, 2488], [746, 2342]], density: 0.5, canopy: [4, 9] },
    ],
    paths: [{ line: [[688, 2342], [585, 2137], [483, 1902], [398, 1683], [369, 1522], [424, 1361], [512, 1215], [600, 1106]], width: 3 }],
    // Pinched through the corner: the fairway runs out where the hole turns, so
    // taking on the 216 has to be precise as well as long.
    widths: [{ at: 0.08, half: 18 }, { at: 0.34, half: 19 }, { at: 0.52, half: 14 }, { at: 0.64, half: 15 }, { at: 0.82, half: 18 }, { at: 1, half: 16 }],
  },
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
    // Where the photograph says which trees there are, that is all the trees
    // there are. The procedural scatter plants along the corridor's own edge,
    // which on a traced hole means timber the picture does not show — and on a
    // narrow one it means timber standing in the shot.
    trees: rebuilt.treeZones?.length ? 0 : spec.trees,
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
