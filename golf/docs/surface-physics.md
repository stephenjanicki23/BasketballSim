# Surface, contact and ball-flight physics

How the game decides what happens to a golf ball, from the grass it is sitting
in to where it comes to rest.

The short version: **there are no per-lie penalties anywhere in the engine.**
A lie type is a name. What a lie *does* is worked out from the physical
properties of the material the ball is on, the state it is sitting in, the club,
the shot being played and how well it was struck — and the same arithmetic runs
for every surface, so adding a new one means adding a row to a table.

## The pipeline

```
SurfaceMaterial          surfaces.ts      what the stuff is made of
      ↓
LieState                 lieState.ts      how this ball is sitting in it
      ↓
ContactResult            impact.ts        what the face does to the ball
      ↓
LaunchConditions         impact.ts        ball speed, launch angle, spin, spin axis
      ↓
FlightProfile            ballFlight.ts    integrated trajectory
      ↓
LandingResult            landing.ts       bounce chain, then roll
      ↓
final position           shotEngine.ts
```

Each stage only knows about the one before it. `ballFlight.ts` has never heard
of rough; it is handed a ball speed, a launch angle and a spin rate.

## 1. `SurfaceMaterial` — the data

`src/simulation/surfaces.ts` holds one entry per material. The numbers are
deliberately physical so they can be argued with: grass height in inches, sand
depth in inches, firmness and moisture from 0 to 1, rolling friction as a
coefficient.

A golf ball is 1.68 inches across, so grass at 0.84 inches reaches its equator —
the height at which a clubface stops being able to get to the back of the ball.
That number turns up throughout the contact model.

Three things are worth knowing about the table:

- **Sand is three materials, not three places.** `firmSand`, `softSand` and
  `deepSand`. Which one a bunker offers depends on whether it is a fairway or
  greenside bunker, how deep it is built, and how much rain has been through it
  — so the same bunker is a nip-it lie after Saturday's storm and a fluff-fest
  on a dry Thursday.
- **Rolling friction and impact shear are separate.** A green is slick to roll
  on and grabby to land on, because a landing ball is gouging turf rather than
  sliding over it. Collapsing the two makes approach shots never stop.
- **Carry, spin and roll are not stored.** They are derived. Storing them would
  be the arbitrary-percentage system this one exists to replace. The only
  outcome a material owns directly is `launchBias`, because sand really does
  push a ball up on a cushion and hardpan really does send it out low.

## 2. `LieState` — how the ball is sitting

A lie type says "light rough". It does not say whether the ball is perched on
top with the whole back of it showing or nestled at the bottom, and that
difference is worth more than the difference between light rough and fairway.

`lieStateFor(lie, ball, { weather })` produces a continuous **lie quality** from
0 to 1, a **ball depth**, and the **grass above the ball**, plus the material
with the week's weather already applied to its moisture and firmness.

The quality is drawn deterministically from the ball's own position, so walking
up to the same ball twice finds the same lie, and the dispersion overlay the
player is shown before the swing is computed from the lie the swing gets.

## 3. `ContactResult` — grass interference

The number everything else hangs off is **cover**: how much material stands
between the leading edge and the back of the ball, measured in ball diameters.

```
cover = ballDepth
      + grassAbove / ballDiameter                     (grass)
      + sandDepth / ballDiameter × (0.35 + 0.8·depth) (sand)
```

Cover is run through a saturating curve and then modulated:

```
interference = (1 − e^(−0.8·cover·attackRelief·grassRelief))
             × density × stiffness × clubSensitivity × blade-level noise
```

- **`attackRelief`** — a descending blow gets under the ball before the grass
  reaches the face. A driver sweeping along the top of the turf brings every
  blade with it; a wedge arriving at −5.6° brings hardly any.
- **`grassRelief`** — the shot type's technique. A punch is shallow, a pitch is
  steep, a flop deliberately slides under.
- **`clubSensitivity`** — the club family's own exposure, from 1.00 for a driver
  to 0.40 for a wedge. Two things level it out. **Sand**, because the club is
  swinging *through* the sand whatever its loft; and **burial**, because a steep
  club can get over the top of a stand of rough but not under a ball sitting
  below it. A plugged lie is a plugged lie for everybody.
- **Lie quality** feeds in through `ballDepth`, so a ball sat down in the same
  rough has more cover.

Attack relief applies to the grass part of the cover only. Hitting *down* into a
bunker puts more sand between the club and the ball, not less — that is the
shot.

This one number is why a wedge from light rough still spins and a 4 iron from
heavy rough does not, without either case being written down anywhere.

## 4. Flyers

A flyer is not bad luck. It is grass trapped between the face and the ball that
stops the grooves gripping, and it needs a specific set of conditions:

```
flyerChance = surface.flyerTendency
            × bell(interference, 0.34, 0.26)     some grass, not a jungle
            × bell(moisture,     0.52, 0.30)     damp enough to slide, not soaked
            × bell(dynamicLoft,  38°,  26°)      a mid-iron-to-wedge event
            × (1 + 0.55 if the ball is sitting up)
            × (0.5 + 0.8 · lieQuality)
```

Nothing here is a coin toss. The coin toss comes afterwards, weighted by this
number. A flyer then cuts spin to a third, adds 1.9° of launch and about 3% of
ball speed — so it carries further, lands shallower and runs a long way.

## 5. Spin

```
backspin = clubSpin × shotType.spin
         × surface.spinCeiling
         × (1 − 0.95·interference·(1 − resilience))
         × (1 − 0.34·excessMoisture)
         × (1 − 0.42·(1 − contactQuality))
         × swingScale^0.30
         × golfer spin skill
         × (0.40 if flyer)

resilience = club.spinResilience × (1 − 0.9·interference)
```

`spinCeiling` is 1 for every grass surface — grass takes spin off through
interference, and a second multiplier would charge for it twice. Sand is
different in kind: on a splash shot the face never touches the ball at all, so
there is a hard ceiling no loft or technique gets past.

`resilience` is what stops a wedge being immune. Grooves only work on a ball the
face can reach, so a wedge keeps almost all of its spin advantage through light
rough and almost none of it out of a buried lie.

Sidespin comes from the **spin axis**, not from a sideways nudge: a draw is a
tilted axis, so a shot whose backspin the rough has killed cannot be worked
whatever the golfer intended. `curveFromSpin` turns the axis into yards.

## 6. Flight

`ballFlight.ts` integrates the trajectory with drag and lift, both functions of
the spin ratio `S = ωr/v`:

```
Cd = 0.244 + 0.250·S
Cl = 0.3425·(1 − e^(−8.0·S))
```

Midpoint (RK2), 0.035 s steps, with spin decaying on a 24-second time constant.
The constants were fitted to published tour launch-monitor averages; carry lands
within 2 yards and apex within 2 yards for every club from a 3 wood to a
pitching wedge. **The driver is a known outlier** — the model carries it about
255 where the tour average is 275 — and `ballFlight.ts` explains why the residual
never reaches the game.

### Why results are normalised

The distance ladder — how far *this* golfer hits *this* club — is a separate,
already-calibrated system built from their ratings, and it stays that way. What
the flight model supplies is the **response**: the engine integrates twice, once
at the club's neutral launch and once at the actual one, and uses the ratio.

So a neutral strike from a clean fairway lie returns exactly the golfer's own
yardage, and every departure from it has a physical cause. The same trick runs
in `landing.ts` for roll.

## 7. Landing

The ball arrives with a speed, an angle and whatever spin is left, and the
ground decides the rest. Each bounce is an oblique impact with friction:

- **Slip** at the contact patch is `vt + ωr`. Backspin makes the bottom of the
  ball run forward faster than the ball itself, so friction spends itself
  killing it — which is the entire mechanism behind a shot checking.
- Either the friction available over the normal impulse runs out first (the ball
  skids on) or it is enough to bring the patch to rest (the ball leaves rolling).
- **Plow**: a steep arrival into a soft surface digs a hole the ball then has to
  climb out of. This is what separates a wedge stopping on its pitch mark from a
  driver running on.

Four bounces, then a roll against rolling friction and the fall of the land. A
ball arriving with real spin onto a soft, smooth surface pulls back toward its
mark; on anything grabbier than a green the spin is gone in the first impact.

Two details that only show up when you measure:

- **The run crosses surfaces.** A ball does not do its running on the patch it
  landed on: a chip pitches on the collar and is on the green a yard later. The
  engine runs the model once to find out how far the ball is going, looks at
  what it crosses on the way, and runs it again over the mixture.
- **A green is maintained.** Its rolling friction and its impact shear are
  different numbers, and its firmness lives inside a narrow band whatever the
  week has done — a putting surface is watered enough to take a pitch mark and
  rolled enough to be quick. Mapping the scorecard's 25–100 firmness straight
  onto the model's 0–1 scale has a seven iron running twenty-two yards across a
  baked green, which does not happen.

## 8. What this changed, and what it did not

The distance ladder, the dispersion calibration and the tour's scoring were all
tuned before any of this existed, so the work was measured against them at every
step. Across twenty courses and a full field:

| | before | after |
|---|---|---|
| Field scoring average | 72.73 | 73.33 |
| Driving distance | 291 yd | 286 yd |
| Fairways in regulation | 55% | 57% |
| Greens in regulation | 65% | 61% |
| Scrambling | 44% | 45% |
| Putts per round | 31.2 | 31.0 |

The greens-in-regulation figure is the one real change, and it is the point of
the exercise: approaches from the rough now lose spin, catch flyers and release,
so they miss more greens, and a buried lie is buried for a wedge too. The field
pays about half a stroke a round for it. Everything the old model priced as a
flat per-lie penalty — and therefore priced the same for a driver and a sand
wedge — is now priced by what the club actually meets.

Everything else is within noise of where it was, and getting there turned up
four genuine bugs — altitude cancelling out of the normalisation, a chip
carrying full-swing spin into the bounce, fairway mishits effectively zeroed,
and a lie-skill term tightening dispersion on lies that had no penalty to buy
back. Each is documented at the place it was fixed.

Cost: a season simulation runs about 45% slower, which is the price of
integrating a trajectory and a bounce chain for every shot instead of
multiplying by a constant.

## 9. Tuning

Every constant lives in `PHYSICS` in `surfaces.ts` and `AERO` in
`ballFlight.ts`. Nothing in the engine hardcodes a threshold. Adding a surface
means adding a `SurfaceMaterial`; adding a shot type means adding a row to
`SHOT_TYPES` with its `attack`, `grassRelief` and `loftDelta`.

## 10. Seeing it and testing it

- **In the game**: press `P` on the play screen for the physics panel — surface,
  club, impact, flight, landing, and every modifier that was applied with its
  size. It renders `physicsReport()`, which is the same function the tests read,
  so the panel cannot drift from the engine.
- **In CI**: `node tools/tsrun.mjs test/physics.ts` — 32 checks, all written as
  relationships ("rough takes more spin off a long iron than a wedge") rather
  than as exact numbers, so retuning the constants does not break them.
