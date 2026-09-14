/**
 * COURSE 4 — Revere Concord (Henderson, Nevada).
 *
 * The one real course in the game. The routing, the shape of every hole, the
 * bunkering and the hazards are traced from the BlueGolf overhead tour of the
 * Concord course at The Revere Golf Club: hole by hole, tee marker to pin, off
 * the satellite imagery. Where the map shows a fairway bending left round a
 * lake, the fairway here bends left round a lake.
 *
 * Three things are honest to state, because they are not traced:
 *
 * 1. **The card is the forward tee set** — the yardages printed on those
 *    overheads (432-yard par 5s, a 285-yard par 4). The Concord plays 7,034
 *    from the championship tees; set `SCALE` to `CHAMPIONSHIP` below and the
 *    whole course — yardages, bends, bunker positions, hazards — scales to it.
 * 2. **The 1st is the one hole without a yardage.** Its overhead arrived as a
 *    crop with no banner on it, so 370 yards is an estimate; the shape, the
 *    bend and the bearing are traced like every other hole, and par is fixed by
 *    the card.
 * 3. **Elevation is inferred**, from tee pads standing above washes, retaining
 *    walls, cart-path switchbacks and the fall of the desert between holes. No
 *    topographic survey was available. The altitude of the property — which is
 *    worth about five per cent of carry — is the Anthem bench at roughly 2,600
 *    feet, and that part is not a guess about this course but about where it is.
 *
 * Hole names are descriptive rather than the club's own.
 */

import type { Course, HoleSpec } from '../../simulation/types';

/** 1 plays the card on the overheads; 1.2193 plays the 7,034-yard championship card. */
const FORWARD = 1;
const CHAMPIONSHIP = 7034 / 5769;
const SCALE: number = FORWARD;
void CHAMPIONSHIP;

const holes: HoleSpec[] = [
  {
    number: 1, name: 'First Light', par: 4, yards: 370, bearing: 258, index: 9,
    dogleg: 0, doglegAt: 0.55, fairwayWidth: 19,
    // The corridor runs some fifty yards left of the tee-to-green line and turns
    // back right at the corner, so from the tee you are playing at the bend
    // rather than at the flag.
    bends: [{ at: 0.30, shift: -46, turn: 0.22 }, { at: 0.72, shift: 46, turn: 0.18 }],
    widths: [{ at: 0.10, half: 21 }, { at: 0.50, half: 19 }, { at: 0.74, half: 16 }, { at: 1, half: 19 }],
    groves: [{ from: 60, to: 340, side: -1, offset: 22, depth: 16, density: 0.3, canopy: [2, 3.6] }],
    landforms: [{ at: 0.18, rise: -9, length: 90 }],
    elevation: { landing: -12, green: -8 }, greenSize: 14, pin: { x: 3, y: 3 },
    greenSlope: { x: -1.4, y: -1.2 }, trees: 0.12,
    bunkers: [
      { along: 210, lateral: 19, size: 6, kind: 'fairway' },
      { along: 356, lateral: -14, size: 6, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 0, to: 118, side: -1, offset: 16, width: 60 }, { from: 0, to: 118, side: 1, offset: 16, width: 60 }],
    strategy: 'Off an elevated tee across the wash, out to the left and back right around the corner. The bunker on the inside of the turn is the whole tee shot; past it the green opens up.',
  },
  {
    number: 2, name: 'Long Wash', par: 5, yards: 432, bearing: 322, index: 13,
    dogleg: -14, doglegAt: 0.5, fairwayWidth: 21,
    bends: [{ at: 0.52, shift: -14, turn: 0.22 }],
    widths: [{ at: 0.10, half: 22 }, { at: 0.45, half: 21 }, { at: 0.72, half: 18 }, { at: 1, half: 20 }],
    groves: [{ from: 120, to: 420, side: 1, offset: 26, depth: 18, density: 0.32, canopy: [2, 3.8] }],
    landforms: [{ at: 0.6, rise: 7, length: 150 }],
    elevation: { landing: 6, green: 10 }, greenSize: 15, pin: { x: -4, y: 4 },
    greenSlope: { x: 1.2, y: -1.6 }, trees: 0.14,
    bunkers: [
      { along: 248, lateral: 20, size: 6, kind: 'fairway' },
      { along: 418, lateral: 14, size: 6, kind: 'greenside' },
      { along: 424, lateral: -13, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 130, to: 420, side: 1, offset: 34, width: 70 }],
    strategy: 'A short par 5 straight up the corridor with the desert the whole way down the right. Everybody has a go; the fairway narrows to 32 yards where the second shot wants to land.',
  },
  {
    number: 3, name: 'Copper Line', par: 4, yards: 404, bearing: 320, index: 1,
    dogleg: -8, doglegAt: 0.6, fairwayWidth: 19,
    bends: [{ at: 0.58, shift: -8, turn: 0.2 }],
    widths: [{ at: 0.10, half: 20 }, { at: 0.50, half: 19 }, { at: 0.72, half: 16 }, { at: 1, half: 19 }],
    groves: [{ from: 100, to: 380, side: 1, offset: 24, depth: 18, density: 0.3, canopy: [2, 3.6] }],
    landforms: [{ at: 0.55, rise: 9, length: 160 }],
    elevation: { landing: 8, green: 14 }, greenSize: 14, pin: { x: 4, y: -3 },
    greenSlope: { x: -1.6, y: -1.8 }, trees: 0.1,
    bunkers: [
      { along: 232, lateral: 18, size: 6, kind: 'fairway' },
      { along: 392, lateral: -14, size: 6, kind: 'greenside', deep: true },
      { along: 398, lateral: 13, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 100, to: 380, side: 1, offset: 32, width: 60 }],
    strategy: 'The longest two-shotter on the card, climbing all the way. The stroke index is right: nobody is disappointed with four.',
  },
  {
    number: 4, name: 'Drop Shot', par: 4, yards: 355, bearing: 297, index: 11,
    dogleg: -26, doglegAt: 0.45, fairwayWidth: 19,
    bends: [{ at: 0.42, shift: -26, turn: 0.15 }],
    widths: [{ at: 0.10, half: 19 }, { at: 0.46, half: 20 }, { at: 0.72, half: 17 }, { at: 1, half: 19 }],
    groves: [{ from: 40, to: 150, side: 1, offset: 18, depth: 16, density: 0.34, canopy: [2, 3.4] }],
    landforms: [{ at: 0.24, rise: -14, length: 120 }],
    elevation: { landing: -20, green: -22 }, greenSize: 14, pin: { x: -3, y: 4 },
    greenSlope: { x: 1.4, y: 1.2 }, trees: 0.12,
    bunkers: [
      { along: 208, lateral: -18, size: 6, kind: 'fairway' },
      { along: 345, lateral: 13, size: 6, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 0, to: 128, side: -1, offset: 14, width: 58 }, { from: 0, to: 128, side: 1, offset: 14, width: 58 }],
    strategy: 'Twenty feet downhill off the tee, bending left at the bottom. The drop is worth most of a club and the green sits below you again.',
  },
  {
    number: 5, name: 'Pond Crossing', par: 3, yards: 139, bearing: 83, index: 17,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 14,
    widths: [{ at: 0, half: 0 }, { at: 0.62, half: 0 }, { at: 0.78, half: 10 }, { at: 1, half: 13 }],
    groves: [{ from: 20, to: 120, side: 1, offset: 12, depth: 14, density: 0.3, canopy: [2, 3.2] }],
    landforms: [{ at: 0.5, rise: -6, length: 80 }],
    elevation: { landing: 0, green: -4 }, greenSize: 13, pin: { x: 3, y: 2 },
    greenSlope: { x: -1.8, y: 1.4 }, trees: 0.16,
    bunkers: [
      { along: 128, lateral: 12, size: 5, kind: 'greenside' },
      { along: 140, lateral: -11, size: 5, kind: 'greenside' },
    ],
    water: [{ along: 98, lateral: -4, size: 24, stretch: 1.4 }],
    waste: [],
    strategy: 'A short iron across the water to a green cut into the bank behind it. Long is dead, short is wet, and the pin is usually on the right.',
  },
  {
    number: 6, name: 'Short Reward', par: 4, yards: 285, bearing: 141, index: 15,
    dogleg: 16, doglegAt: 0.55, fairwayWidth: 19,
    bends: [{ at: 0.55, shift: 16, turn: 0.18 }],
    widths: [{ at: 0.10, half: 20 }, { at: 0.50, half: 19 }, { at: 0.80, half: 16 }, { at: 1, half: 18 }],
    groves: [{ from: 40, to: 270, side: -1, offset: 20, depth: 16, density: 0.32, canopy: [2, 3.6] }],
    landforms: [{ at: 0.45, rise: -11, length: 130 }],
    elevation: { landing: -14, green: -18 }, greenSize: 13, pin: { x: -3, y: -3 },
    greenSlope: { x: 1.6, y: 1.8 }, trees: 0.14,
    bunkers: [
      { along: 236, lateral: 16, size: 6, kind: 'fairway' },
      { along: 278, lateral: -13, size: 6, kind: 'greenside', deep: true },
    ],
    water: [],
    waste: [{ from: 0, to: 110, side: 1, offset: 15, width: 55 }],
    strategy: 'Downhill and drivable. The bunker at 236 catches the drive that leaks right; laying back to 90 leaves a flat wedge, which most of the field takes.',
  },
  {
    number: 7, name: 'Boundary Run', par: 4, yards: 327, bearing: 150, index: 7,
    dogleg: 14, doglegAt: 0.6, fairwayWidth: 18,
    bends: [{ at: 0.60, shift: 14, turn: 0.17 }],
    widths: [{ at: 0.10, half: 19 }, { at: 0.50, half: 18 }, { at: 0.78, half: 16 }, { at: 1, half: 18 }],
    groves: [{ from: 60, to: 300, side: -1, offset: 22, depth: 18, density: 0.3, canopy: [2, 3.6] }],
    landforms: [{ at: 0.5, rise: -9, length: 140 }],
    elevation: { landing: -10, green: -16 }, greenSize: 14, pin: { x: 3, y: 3 },
    greenSlope: { x: -1.4, y: 1.6 }, trees: 0.12,
    bunkers: [
      { along: 214, lateral: 17, size: 6, kind: 'fairway' },
      { along: 318, lateral: -13, size: 6, kind: 'greenside' },
      { along: 322, lateral: 12, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 40, to: 300, side: 1, offset: 26, width: 50 }],
    strategy: 'Downhill with housing tight along the right and desert left. Both greenside bunkers are in play from the tee if you take it on.',
  },
  {
    number: 8, name: 'Over the Arroyo', par: 3, yards: 130, bearing: 177, index: 18,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 14,
    widths: [{ at: 0, half: 0 }, { at: 0.70, half: 0 }, { at: 0.84, half: 10 }, { at: 1, half: 13 }],
    groves: [
      { from: 20, to: 105, side: -1, offset: 14, depth: 18, density: 0.34, canopy: [2, 3.4] },
      { from: 20, to: 105, side: 1, offset: 14, depth: 18, density: 0.34, canopy: [2, 3.4] },
    ],
    landforms: [{ at: 0.45, rise: -12, length: 90 }],
    elevation: { landing: -6, green: -18 }, greenSize: 14, pin: { x: -3, y: -3 },
    greenSlope: { x: 1.8, y: 1.2 }, trees: 0.18,
    bunkers: [
      { along: 118, lateral: -15, size: 8, kind: 'greenside', stretch: 2.2, deep: true },
      { along: 134, lateral: 12, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 6, to: 104, side: -1, offset: 12, width: 70 }, { from: 6, to: 104, side: 1, offset: 12, width: 70 }],
    strategy: 'A wedge from a rock-walled pad, all of it across the wash, to a big green with a long serpentine bunker down the left. The easiest hole on the card and still nobody aims at a left pin.',
  },
  {
    number: 9, name: "Clubhouse Turn", par: 5, yards: 427, bearing: 80, index: 5,
    dogleg: 6, doglegAt: 0.45, fairwayWidth: 20,
    bends: [{ at: 0.34, shift: 30, turn: 0.14 }, { at: 0.72, shift: -24, turn: 0.13 }],
    widths: [{ at: 0.10, half: 21 }, { at: 0.40, half: 20 }, { at: 0.64, half: 17 }, { at: 0.86, half: 19 }, { at: 1, half: 19 }],
    groves: [{ from: 120, to: 400, side: 1, offset: 24, depth: 16, density: 0.3, canopy: [2, 3.6] }],
    landforms: [{ at: 0.62, rise: 10, length: 150 }],
    elevation: { landing: 8, green: 16 }, greenSize: 15, pin: { x: 4, y: -4 },
    greenSlope: { x: -1.6, y: -2.0 }, trees: 0.12,
    bunkers: [
      { along: 238, lateral: 18, size: 6, kind: 'fairway' },
      { along: 398, lateral: -14, size: 6, kind: 'greenside' },
      { along: 414, lateral: 13, size: 5, kind: 'greenside', deep: true },
    ],
    water: [],
    waste: [{ from: 120, to: 380, side: 1, offset: 30, width: 60 }],
    strategy: 'Right off the tee, then back left up the hill to a green beside the clubhouse. Reachable, but the second shot is played off a hanging lie to a green you cannot see the bottom of.',
  },
  {
    number: 10, name: 'Range Side', par: 4, yards: 326, bearing: 172, index: 12,
    dogleg: 8, doglegAt: 0.6, fairwayWidth: 17,
    bends: [{ at: 0.58, shift: 8, turn: 0.2 }],
    widths: [{ at: 0.10, half: 18 }, { at: 0.50, half: 17 }, { at: 0.80, half: 15 }, { at: 1, half: 17 }],
    groves: [{ from: 60, to: 300, side: 1, offset: 24, depth: 18, density: 0.28, canopy: [2, 3.4] }],
    landforms: [{ at: 0.5, rise: -10, length: 140 }],
    elevation: { landing: -10, green: -16 }, greenSize: 13, pin: { x: -3, y: 3 },
    greenSlope: { x: 1.4, y: -1.4 }, trees: 0.1,
    bunkers: [
      { along: 214, lateral: -15, size: 6, kind: 'fairway' },
      { along: 318, lateral: 12, size: 6, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 60, to: 300, side: 1, offset: 28, width: 80 }],
    strategy: 'Narrow and downhill, housing down the left and open ground out to the right. A drive that leaks right is fine; one that leaks left is a wedge sideways.',
  },
  {
    number: 11, name: 'Lakeside', par: 5, yards: 431, bearing: 238, index: 10,
    dogleg: -8, doglegAt: 0.5, fairwayWidth: 20,
    bends: [{ at: 0.45, shift: -18, turn: 0.16 }, { at: 0.80, shift: 10, turn: 0.14 }],
    widths: [{ at: 0.10, half: 21 }, { at: 0.45, half: 20 }, { at: 0.72, half: 17 }, { at: 1, half: 19 }],
    groves: [{ from: 60, to: 240, side: -1, offset: 22, depth: 16, density: 0.3, canopy: [2, 3.6] }],
    landforms: [{ at: 0.55, rise: -9, length: 150 }],
    elevation: { landing: -8, green: -14 }, greenSize: 15, pin: { x: 4, y: 3 },
    greenSlope: { x: -1.8, y: 1.4 }, trees: 0.12,
    bunkers: [
      { along: 246, lateral: -17, size: 6, kind: 'fairway' },
      { along: 418, lateral: -13, size: 6, kind: 'greenside' },
    ],
    water: [{ along: 0, lateral: 0, size: 0, strip: { from: 236, to: 402, side: 1, offset: 26, width: 90 } }],
    waste: [],
    strategy: 'The lake runs the whole length of the second shot on the right. Short par 5, and the closer you want to be the more of it you have to take on.',
  },
  {
    number: 12, name: 'Canyon Carry', par: 3, yards: 177, bearing: 301, index: 14,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 15,
    widths: [{ at: 0, half: 0 }, { at: 0.66, half: 0 }, { at: 0.82, half: 11 }, { at: 1, half: 14 }],
    groves: [
      { from: 20, to: 130, side: -1, offset: 12, depth: 18, density: 0.32, canopy: [2, 3.4] },
      { from: 20, to: 130, side: 1, offset: 12, depth: 18, density: 0.32, canopy: [2, 3.4] },
    ],
    landforms: [{ at: 0.44, rise: -15, length: 110 }],
    elevation: { landing: 2, green: 8 }, greenSize: 13, pin: { x: -3, y: 3 },
    greenSlope: { x: 1.6, y: -1.6 }, trees: 0.18,
    bunkers: [
      { along: 170, lateral: -13, size: 6, kind: 'greenside', deep: true },
      { along: 176, lateral: 12, size: 5, kind: 'greenside' },
    ],
    water: [{ along: 148, lateral: -17, size: 14 }],
    waste: [{ from: 10, to: 132, side: -1, offset: 11, width: 60 }, { from: 10, to: 132, side: 1, offset: 11, width: 60 }],
    strategy: 'A mid-iron across the canyon to a green propped above a pond on the left. There is no bail-out that leaves a simple chip.',
  },
  {
    number: 13, name: 'Between the Walls', par: 4, yards: 343, bearing: 283, index: 8,
    dogleg: -6, doglegAt: 0.6, fairwayWidth: 16,
    bends: [{ at: 0.58, shift: -6, turn: 0.2 }],
    widths: [{ at: 0.10, half: 17 }, { at: 0.50, half: 16 }, { at: 0.80, half: 14 }, { at: 1, half: 16 }],
    groves: [{ from: 50, to: 320, side: -1, offset: 18, depth: 14, density: 0.3, canopy: [2, 3.2] }],
    landforms: [{ at: 0.6, rise: -6, length: 130 }],
    elevation: { landing: -4, green: -6 }, greenSize: 12, pin: { x: 3, y: -3 },
    greenSlope: { x: -1.6, y: 1.8 }, trees: 0.1,
    bunkers: [
      { along: 208, lateral: 14, size: 5, kind: 'fairway' },
      { along: 334, lateral: -12, size: 6, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 40, to: 320, side: 1, offset: 22, width: 45 }],
    strategy: 'The tightest corridor on the property — walls of housing both sides, a 24-yard fairway at the pinch and the smallest green on the card.',
  },
  {
    number: 14, name: 'The Crossing', par: 4, yards: 382, bearing: 304, index: 4,
    dogleg: -10, doglegAt: 0.55, fairwayWidth: 18,
    bends: [{ at: 0.52, shift: -10, turn: 0.18 }],
    widths: [{ at: 0.10, half: 19 }, { at: 0.50, half: 18 }, { at: 0.76, half: 16 }, { at: 1, half: 18 }],
    groves: [{ from: 60, to: 350, side: 1, offset: 22, depth: 16, density: 0.3, canopy: [2, 3.6] }],
    landforms: [{ at: 0.52, rise: -9, length: 70 }, { at: 0.85, rise: 8, length: 110 }],
    elevation: { landing: 6, green: 12 }, greenSize: 14, pin: { x: -4, y: 3 },
    greenSlope: { x: 1.4, y: -1.8 }, trees: 0.12,
    bunkers: [
      { along: 234, lateral: 17, size: 6, kind: 'fairway' },
      { along: 372, lateral: 13, size: 6, kind: 'greenside' },
      { along: 376, lateral: -12, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 60, to: 340, side: 1, offset: 26, width: 55 }],
    strategy: 'A wash crosses at 200 and the ground rises to the green from there. The number is never the number: it plays a full club longer than the card.',
  },
  {
    number: 15, name: 'Wide Open', par: 4, yards: 281, bearing: 70, index: 16,
    dogleg: 12, doglegAt: 0.5, fairwayWidth: 22,
    bends: [{ at: 0.50, shift: 12, turn: 0.2 }],
    widths: [{ at: 0.10, half: 22 }, { at: 0.50, half: 23 }, { at: 0.80, half: 20 }, { at: 1, half: 21 }],
    groves: [{ from: 30, to: 120, side: -1, offset: 16, depth: 16, density: 0.32, canopy: [2, 3.4] }],
    landforms: [{ at: 0.7, rise: 11, length: 130 }],
    elevation: { landing: 10, green: 16 }, greenSize: 16, pin: { x: 4, y: -4 },
    greenSlope: { x: -1.2, y: -2.0 }, trees: 0.12,
    bunkers: [
      { along: 238, lateral: 2, size: 9, kind: 'fairway', stretch: 1.6 },
      { along: 272, lateral: -13, size: 6, kind: 'greenside' },
      { along: 278, lateral: 12, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 0, to: 118, side: -1, offset: 16, width: 60 }, { from: 0, to: 118, side: 1, offset: 16, width: 60 }],
    strategy: 'The widest fairway out here, uphill, with one enormous bunker sitting in the middle of it at 238. Drive it past, lay up short, or take the sand on.',
  },
  {
    number: 16, name: 'Sunken Green', par: 3, yards: 165, bearing: 131, index: 6,
    dogleg: 0, doglegAt: 0.5, fairwayWidth: 14,
    widths: [{ at: 0, half: 0 }, { at: 0.64, half: 0 }, { at: 0.80, half: 10 }, { at: 1, half: 13 }],
    groves: [
      { from: 20, to: 135, side: -1, offset: 12, depth: 16, density: 0.3, canopy: [2, 3.4] },
      { from: 20, to: 135, side: 1, offset: 12, depth: 16, density: 0.3, canopy: [2, 3.4] },
    ],
    landforms: [{ at: 0.8, rise: -10, length: 90 }],
    elevation: { landing: -6, green: -14 }, greenSize: 12, pin: { x: -3, y: -3 },
    greenSlope: { x: 1.8, y: 1.4 }, trees: 0.16,
    bunkers: [
      { along: 154, lateral: -12, size: 6, kind: 'greenside', deep: true },
      { along: 168, lateral: 11, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 10, to: 138, side: -1, offset: 11, width: 55 }, { from: 10, to: 138, side: 1, offset: 11, width: 55 }],
    strategy: 'All carry, downhill into a bowl, with a deep bunker front-left. The small green gathers from the right, which is the only help the hole gives you.',
  },
  {
    number: 17, name: 'Lake Corner', par: 4, yards: 375, bearing: 70, index: 3,
    dogleg: 0, doglegAt: 0.6, fairwayWidth: 16,
    // Ninety yards of desert off the tee, then the fairway bows right and the
    // hole turns back left to a green with the lake long and left of it.
    bends: [{ at: 0.35, shift: 36, turn: 0.22 }, { at: 0.80, shift: -36, turn: 0.18 }],
    widths: [
      { at: 0, half: 0 }, { at: 0.22, half: 0 }, { at: 0.32, half: 16 },
      { at: 0.62, half: 15 }, { at: 0.85, half: 13 }, { at: 1, half: 15 },
    ],
    groves: [{ from: 30, to: 110, side: 1, offset: 14, depth: 16, density: 0.32, canopy: [2, 3.4] }],
    landforms: [{ at: 0.20, rise: -8, length: 100 }, { at: 0.86, rise: 7, length: 110 }],
    elevation: { landing: 4, green: 8 }, greenSize: 14, pin: { x: -3, y: 4 },
    greenSlope: { x: 1.4, y: -1.6 }, trees: 0.12,
    bunkers: [
      { along: 156, lateral: -16, size: 6, kind: 'fairway' },
      { along: 202, lateral: -15, size: 5, kind: 'fairway' },
      { along: 366, lateral: 12, size: 6, kind: 'greenside', deep: true },
    ],
    water: [{ along: 404, lateral: -30, size: 28 }],
    waste: [{ from: 0, to: 95, side: -1, offset: 12, width: 60 }, { from: 0, to: 95, side: 1, offset: 12, width: 60 }],
    strategy: 'From beside the 16th green, ninety yards of desert to a fairway that bends right and then back left, to a green propped on the corner of the lake. Long and left is in the water the 11th plays down.',
  },
  {
    number: 18, name: 'Home Climb', par: 5, yards: 499, bearing: 15, index: 2,
    dogleg: 0, doglegAt: 0.45, fairwayWidth: 18,
    // Housing tight down the left, desert wide open down the right, and the
    // fairway running up the left of the direct line before the green swings
    // back across it.
    bends: [{ at: 0.35, shift: -38, turn: 0.24 }, { at: 0.78, shift: 38, turn: 0.20 }],
    widths: [{ at: 0.08, half: 19 }, { at: 0.45, half: 18 }, { at: 0.72, half: 15 }, { at: 1, half: 17 }],
    groves: [{ from: 100, to: 420, side: 1, offset: 24, depth: 18, density: 0.3, canopy: [2, 3.8] }],
    landforms: [{ at: 0.60, rise: 8, length: 160 }, { at: 0.94, rise: 10, length: 90 }],
    elevation: { landing: 6, green: 20 }, greenSize: 15, pin: { x: -4, y: 4 },
    greenSlope: { x: 1.6, y: -2.2 }, trees: 0.12,
    bunkers: [
      { along: 200, lateral: 17, size: 6, kind: 'fairway' },
      { along: 252, lateral: 16, size: 5, kind: 'fairway' },
      { along: 402, lateral: -16, size: 6, kind: 'fairway' },
      { along: 482, lateral: -13, size: 6, kind: 'greenside', deep: true },
      { along: 492, lateral: 12, size: 5, kind: 'greenside' },
    ],
    water: [],
    waste: [{ from: 120, to: 430, side: 1, offset: 30, width: 70 }],
    strategy: 'Five hundred yards uphill, houses down the left and open desert on the right. The green sits on a bench above the fairway: short of it is a wall, not an apron.',
  },
];

/** Apply the tee-set scale to everything measured in yards. */
function scaled(spec: HoleSpec): HoleSpec {
  if (SCALE === 1) return spec;
  const k = SCALE;
  return {
    ...spec,
    yards: Math.round(spec.yards * k),
    bends: spec.bends?.map((bend) => ({ ...bend, shift: Math.round(bend.shift * k) })),
    bunkers: spec.bunkers.map((b) => ({ ...b, along: Math.round(b.along * k), lateral: Math.round(b.lateral * k * 0.6) })),
    water: spec.water.map((w) => ({
      ...w,
      along: Math.round(w.along * k),
      strip: w.strip && { ...w.strip, from: Math.round(w.strip.from * k), to: Math.round(w.strip.to * k) },
    })),
    waste: spec.waste?.map((w) => ({ ...w, from: Math.round(w.from * k), to: Math.round(w.to * k) })),
    groves: spec.groves?.map((g) => ({ ...g, from: Math.round(g.from * k), to: Math.round(g.to * k) })),
    specimens: spec.specimens?.map((t) => ({ ...t, along: Math.round(t.along * k) })),
    landforms: spec.landforms?.map((l) => ({ ...l, length: Math.round(l.length * k) })),
  };
}

const card = holes.map(scaled);

export const REVERE_CONCORD: Course = {
  id: 'concord',
  name: 'Revere Concord',
  location: 'Henderson, Nevada',
  style: 'desert',
  par: card.reduce((sum, h) => sum + h.par, 0),
  yards: card.reduce((sum, h) => sum + h.yards, 0),
  blurb:
    'The real one. Billy Casper and Greg Nash cut it through the Anthem foothills in 2002: turf corridors between desert washes and housing, tees standing well above their fairways, and half the round played from a hanging lie.',
  identity: [
    'Traced hole by hole from the overhead course tour',
    'Anthem bench at about 2,600 feet — thin air is worth 5% of your carry',
    'Desert wash and hardpan outside the corridor, housing beyond it',
    'Elevated tees: four holes drop more than fifteen feet from the tee',
    'Water on the 5th, the 11th, the 12th, the 17th and short of the 18th green',
    'Played from the forward card at 5,769 yards; the championship tees are 7,034',
  ],
  altitude: 2600,
  surroundWidth: 45,
  difficulty: 68,
  fit: {
    distance: 0.55, accuracy: 0.75, rough: 0.35, wind: 0.35, greens: 0.60,
    water: 0.55, elevation: 0.95, strategy: 0.70, heat: 1.00, rain: 0.05,
  },
  holes: card,
};
