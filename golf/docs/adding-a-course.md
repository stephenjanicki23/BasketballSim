# Adding a real course

The pipeline that put the Revere Concord in the game, written down so the next
one is data entry rather than engineering. Nothing here is course-specific: the
engine, the shot model, the lies and the AI are the same ones every venue uses.

## What you need

1. **An overhead image per hole** — the club's tour, BlueGolf, Google Earth. Tee
   marker and pin both visible, and the line of play drawn on it if the source
   has one.
2. **The scorecard** — par, yardage and stroke index for every hole, for every
   set of tees. This is the authority; the images set shape, the card sets scale.
3. Anything else the club publishes: hole descriptions, elevation notes, a
   flyover. Useful, not required.

## 1. Trace the images

You trace in the coordinates you have — pixels, y growing down — and
`src/data/courses/trace.ts` converts. Read off the image:

```ts
const hole18: TracedHole = {
  tee: [335, 1620],                       // the tee marker, in pixels
  pin: [655, 390],                        // the pin
  playLine: [[335, 1620], [385, 1050], [520, 610], [655, 390]],
  green: [[640, 330], [690, 350], /* … */],
  bunkers: [{ shape: [/* … */], kind: 'greenside', deep: true }],
  water: [[/* … */]],
  ob: [[/* housing */]],
  trees: [{ shape: [/* the wood's boundary */], density: 0.5 }],
  paths: [{ line: [/* cart path centre */], width: 3 }],
  widths: [{ at: 0.1, half: 19 }, { at: 0.45, half: 18 }, { at: 1, half: 17 }],
};
```

Then hand it the card:

```ts
const spec = traceHole(hole18, {
  number: 18, name: 'Home', par: 5, yards: 548, index: 7,
  bearing: 15,                              // compass, read off the north-up image
  elevation: { landing: 6, green: 20 },     // feet, inferred — see below
  image: '/holes/concord/18.jpg',           // for the overlay
});
```

**The scale is not a judgement call.** The played line — tee, each corner, pin —
*is* the card yardage, so yards per pixel falls out of it, and every other traced
feature inherits it. The transform then rotates the green onto the +y axis (which
is what the wind model and the camera both assume) and puts the tee at the
origin. One number from the card fixes the whole hole.

**Bearing** is measured off the image: 0 is north, 90 is east. It only drives the
wind, but it is the difference between a hole that plays downwind in a southerly
and one that does not.

**Elevation** is the one thing images rarely settle. Infer it from retaining
walls, tee pads standing above washes, cart-path switchbacks and the fall of the
ground between holes — and say in the course file that you inferred it. If there
is no evidence, leave it flat. Inventing terrain is worse than omitting it.

## 2. Write the course file

`src/data/courses/<course>.ts` exports a `Course`. Everything else is data:

```ts
export const SOMEWHERE: Course = {
  id: 'somewhere',
  name: 'Somewhere Golf Club',
  location: 'Town, State',
  style: 'parkland',            // links | desert | parkland — sets grass, firmness, palette
  altitude: 620,                // feet; thin air is ~2% of carry per 1,000 ft
  surroundWidth: 45,            // how far the scrub runs before OB
  tees: [
    { id: 'black', name: 'Black', yards: [...], index: [...], rating: 73.5, slope: 140 },
    { id: 'blue', name: 'Blue', yards: [...] },
  ],
  teeId: 'black',               // the set the holes are authored at
  holes,
  difficulty: 76,
  fit: { /* what the course asks of a golfer, 0..1 each */ },
  blurb: '…',
  identity: ['…'],
};
```

Add it to `src/data/courses/index.ts`. Every other tee set becomes its own
playable course automatically (`somewhere@blue`), by moving the tee: distances
from the tee move with it, distances from the green stay put, nothing lateral
moves. Ids are what the caches, the save file and the schedule key on, so
nothing else needs to change.

## 3. Check it

```bash
node tools/tsrun.mjs test/scorecard.ts        # par, yardage, index, nines, totals, every tee
node tools/tsrun.mjs test/courseCheck.ts      # every hole builds, pins on greens, terrain shares
node tools/tsrun.mjs test/card.ts somewhere   # the card as the game has it
node tools/tsrun.mjs test/venueCheck.ts       # a full tournament: what the course is worth
npm test                                      # the engine's own regression suite
```

Then look at it. Press **D** in a round for the trace check: the source
photograph laid over the hole at the alignment the trace recorded, with the
geometry the engine actually plays drawn on top — fairway, green, bunkers, water,
OB, cart paths, tree canopies, centreline and fifty-yard rings, each toggleable.
Where the photograph and the geometry disagree, the trace is wrong. Sliders nudge
the overlay if the recorded alignment needs a hand.

Put the images in `public/holes/<course>/<n>.jpg` so the overlay can load them.

## 4. What is authored, and what is procedural

Trace what the image supports and let the engine do the rest. A photograph
supports the *boundary* of a wood, not the position of each trunk, so
`treeZones` traces the outline and fills it at a density. It supports the
outline of a green, which is why `greenShape` is a polygon rather than a circle.
It does not support the contour of a green, so slope stays a spec value.

| Traced from the image | Left to the engine |
|---|---|
| Line of play, fairway widths | Grass gradient from the corridor |
| Green outline | Green contour and pin positions by round |
| Every bunker's outline | Sand physics, lip severity |
| Water, waste, OB, cart paths | Penalty rules, relief, roll |
| Wooded boundaries | Individual trees inside them |

## 5. Limits worth knowing

- **Perspective.** The converter assumes the image is top-down. A flyover still
  works for shape, but distances across the frame will be off; prefer satellite.
- **The corridor model.** Fairway and rough come from a centreline and a width
  profile, not a traced polygon, so a fairway with a genuinely odd outline —
  a split fairway, an island of turf — is approximated by widths.
- **Elevation** is spec-driven: a tee-to-landing-to-green profile plus named
  ridges, hollows and mounds. There is no heightmap import.
