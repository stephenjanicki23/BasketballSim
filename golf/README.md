# Golf Universe

A top-down playable golf game wrapped around a fifty-player simulated professional
tour. You aim by clicking on the course, pick a club, read the dispersion, and
live with the consequences — and the other forty-nine golfers play the same
tournament through exactly the same engine.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm test           # 30 regression tests over the simulation
npm run smoke      # build, then drive the real app in a headless browser
npm run calibrate  # print the calibration reports (distances, make %, a full season)
```

No server, no accounts, no network. The universe lives in `localStorage`.

---

## The idea

Most golf games resolve a shot by asking how accurately you clicked. This one
never does. You choose a target, and the ball goes where the golfer's ratings,
the lie, the club, the wind, the hill, their fatigue and the pressure say it
goes — sampled once from a distribution the game shows you in advance.

That distribution is the game. Before every shot you can see:

- an **elliptical dispersion zone** at 50%, 75% and 90%, longer than it is wide
  for a wedge and far wider than it is long for a driver;
- what the shot **plays like** after the wind and the elevation change;
- the **odds of every outcome** — fairway, green, rough, sand, trees, water, out
  of bounds — integrated over the actual terrain of that hole;
- the **expected strokes to hole out** from wherever it finishes.

So the decision in front of you is the real one: *I could attack this pin, but
2.71 expected strokes with an 11% chance of the water is worse than 2.83 with
none.*

## The two halves, and why they are the same half

```
/src/simulation     the engines — no React, no DOM, deterministic, testable
/src/data           50 golfers, 3 courses, 54 hole specs, 20 tournaments
/src/game           the playable session: pure functions over one state object
/src/components     canvas renderer, shot controls, panels, profile
/src/screens        Home, Play, Tournament, Players, Courses, Statistics, News
```

The simulated field does not roll dice against an overall rating. For every shot
it plays, `holeEngine` generates candidate shots — club, shape, aim point —
integrates each one's dispersion over the terrain with `evaluatePlan`, and takes
the line with the lowest expected strokes, discounted by that golfer's course
management and fogged by their decision making. Then it calls the same
`resolveShot` you do.

That is why the universe produces believable results without any thumb on the
scale: a wind specialist wins at the Coastal Championship because his ellipse
really is narrower in a 25 mph crosswind, and a bomber wins at the Desert
Classic because 310 yards really does leave him a wedge.

Course fit is a **readout of that engine, never an input to it**. A fit of 92
tells you what the engine is about to do; it is still going to shoot 76 in the
wrong week.

## The shot model

`planShot` is deterministic and `resolveShot` takes one sample from it.

```
expected carry   = club carry for this golfer
                 × lie × weather × fatigue × pressure × shot type
                 + wind carry effect − elevation

σ longitudinal   = club base × f(distance-control rating)
                 × lie × shot type × conditions × swing scale
σ lateral        = club base × f(accuracy rating for that club)
                 × lie × shot type × conditions × wind × swing scale

sample           = expected + z·σ, where z is normal with a fat tail whose
                   weight is set by the golfer's Consistency
```

Then bounce, roll (from the surface it landed on, the spin it carried and the
fall of the land), the lie it finishes in, and any penalty.

A few things the model insists on:

- **You cannot swing harder than a full swing.** A lie that costs 15% of your
  distance costs you 15% of your distance; the engine will tell you it cannot
  reach and you take more club.
- **A chip is planned as carry plus run-out**, so landing it in the fringe or the
  rough is what takes the run away.
- **A ball rolling over the hole drops in.** Chip-ins are not a special case,
  they are the roll path passing within 2.1 inches of the cup — which gets the
  rate right for free.
- **Wind is one direction for the round**, resolved against each hole's compass
  bearing. That is why the 4th plays downwind and the 8th plays into it on the
  same afternoon.
- **The golfer aims off for a crosswind themselves**, by an amount their Wind
  rating decides. You are not made to do arithmetic the caddie should do — but a
  poor wind player will still get pushed.

## Putting is a decision, not an aiming exercise

There is no line to draw and no meter to time. When the ball is on the green the
engine reads it and offers a strategy:

```
4th hole — 26.8 ft for par
Medium · Slight break left to right · Moderate uphill
Putt difficulty  ★★★☆☆          Estimated make chance  7%

LAG PUTT        make 6%   3-putt 1%   leave 1.5 ft   inside 3 ft 90%
GO FOR IT       make 7%   3-putt 5%   leave 2.7 ft   inside 3 ft 64%
```

The player presses one button and the ball rolls. A third option — a safe lag
that forgets the hole entirely — appears only on the putts where it is a real
alternative: forty feet and up, severe slopes, glass greens, or a long one with
the tournament on it.

**The strategies are not a make-percentage multiplier.** Going for it holds the
ball about two feet past the hole instead of nine inches, and everything follows
from that: a ball dying at the hole cannot fall in as often, a firm putt takes
much less of the break so a misread costs less, and a ball hit to finish four
feet by does not stop next to the hole when it misses. The numbers on the panel
are the same arithmetic the ball then obeys.

That produces a real trade-off that changes with the situation. From six feet,
attacking wins on expected strokes and everybody does it. From forty-five, lagging
wins by a fifth of a stroke and only somebody who needs a birdie should think
otherwise. And what "needs a birdie" means is the leaderboard: two behind with
three to play, a putt that grades out marginally worse is the right one.

### How the numbers are built

`PUTTING.makeCurve` in `config.ts` is the make probability for a reference tour
putter, and it is the one table to change if putting feels wrong. The engine
inverts it once at load into the start-line error that would produce it; a real
putt then scales that dispersion by the golfer's ratings, the green's speed and
slope, the break they have to read, the pressure they are under and the strategy
they chose — and the make probability falls back out of the dispersion.

Two pieces of that are worth naming because the model does not work without them:

- **The hole is widest at about a foot and a half past.** A ball dying at the
  hole wobbles off at the last roll and any misjudgement leaves it short; a ball
  travelling fast has less of the hole to drop into. Both "never up, never in"
  and "you'll never make it from there" are true, and an optimum between them is
  what makes lagging and attacking genuinely different.
- **Long putts are not missed because tour players cannot aim.** Working
  backwards from the make curve alone gives a forty-footer six feet of sideways
  error, which is not a thing that happens. There is an explicit deflection term
  — the chance that a putt which deserved to drop meets a spike mark, a grain
  change or a foot of break misjudged three feet out. With it, the inverted
  dispersion lands on the physically sensible value at every distance, and the
  leave distances and three-putt rates come right at the same time.

Make probabilities are computed analytically rather than by sampling, because the
hole is a fifth of a foot wide and any quadrature cheap enough to run inside a
season simulation misses it entirely.

### Who putts how

Beyond Putting, Short Putting, Long Putting and Putting Under Pressure, golfers
have **Lag Putting**, **Green Reading** and **Speed Control**, and a putting
personality that biases both those ratings and the strategy they favour: The
Aggressor, The Technician, The Conservative, The Clutch Putter, The Streaky
Putter, The Poor Green Reader. A misread is not symmetric either — a golfer who
under-reads a breaking putt misses on the low side, and green reading is what
pays for it.

The simulated field makes the same choice through the same function. A
conservative player protecting a lead lags from fourteen feet; an aggressor two
behind on Sunday takes on eighteen.

## The universe

Twenty events across the three venues, four of them majors, 50-player fields,
four rounds, a cut to the low 30 and ties, prize money, points, a world ranking
that decays, form, statistics, a news wire and an off-season.

Rounds are simulated **hole by hole across the whole field in lockstep**. It
costs nothing and buys the thing that makes tournament golf tournament golf: when
a player stands on the 16th tee on Sunday, the leaderboard beside them is real,
so "two clear with three to play" is a fact the engine can turn into pressure.

You can play your golfer's rounds shot by shot and let the field simulate around
you, or simulate everything and watch.

At the end of a season everybody develops: young players move toward their
potential as fast as their own temperament allows (and plenty stall), the
thirty-somethings lose a yard at a time while their course management keeps
improving, the finished ones retire, and graduates come up to keep the field at
fifty.

## The three courses

| | Coastal Championship | Desert Classic | Woodland National |
|---|---|---|---|
| Style | Links | Desert | Parkland |
| Card | Par 71, 7,167 yd | Par 72, 7,471 yd | Par 72, 7,175 yd |
| Fairways | 32–42 yd | 40–52 yd | 26–32 yd |
| Roll-out | 1.42× | 1.50× | 0.92× |
| Greens | 11.5 stimp, firm | 11.0 stimp | 12.5 stimp, small |
| Weather | 15–25 mph, rain, cold | 95–105°F | Sheltered, wet |
| Outside the corridor | Deep marram rough | Playable hardpan waste | Pine straw, then trees |
| Rewards | Wind play, flighting it | Distance, heat endurance | Accuracy, management |

Holes are authored as *specs* — par, yardage, where the dogleg turns, where the
bunkers sit relative to the landing zone, how the green tilts — and realised as
geometry in yards. The grass gradient (fairway → first cut → light → heavy →
deep) is not five nested polygons; it falls out of the distance from the
centreline compared with the fairway's width at that point, which is cheaper and
gives an organic edge for free. Green complexes get their own apron, so missing a
green leaves you in greenside rough rather than instantly in the deep stuff.

## Calibration

Every number below is asserted by `npm test`, and the reports behind them are in
`test/` (`npm run calibrate`).

| | This game | Tour |
|---|---|---|
| Driving distance | 260–309 yd, field 289 | 270–325, field 299 |
| Driving accuracy | field 54–62%, best 68% | field 61%, best 73% |
| Greens in regulation | field 60–73% | ~65% |
| Scrambling | 38–49% | 58% |
| Putts per round | field 30.6–31.6 | 29 |
| Make % at 3 / 5 / 8 / 15 / 30 ft (average putter) | 93 / 72 / 44 / 17 / 4 | 97 / 77 / 50 / 23 / 7 |
| Make % at 8 ft, elite / poor | 54 / 37 | 57 / 42 |
| Three-putts per round | 0.30–0.56 | 0.54 |
| Three-putt from 45 ft, lag / attack | 9% / 18% | 12% (mixed) |
| Penalty strokes per round | 0.1–0.3 | ~0.25 |
| Field scoring average (calm) | 0.0 to +0.9 | ~+1 |
| Field scoring average (links, 19 mph, rain) | +5.9 | +4 to +6 |
| Winning score | −13.9 average | ~−14 |
| Different winners in 80 events | 12, best player 40% | 15–20, best player 10–25% |

One number is out of band and worth naming: **win concentration**. The scoring
distribution is right — the best player is about 2.2 strokes a round better than
the field, the whole tour spans 4.3 strokes, and winning scores average −13 — but
the top two golfers still take about 70% of the events. Two things cause it, and
only one is a modelling choice. A fifty-player field is small: with a real
150-player field, the same distribution would produce far more winners, because
the best of the other 149 is much further out than the best of the other 49. And
the putting redesign correctly cut three-putts from about one a round to about
0.4, which is the real tour rate but removes a large source of bad luck for good
players. Raising day-to-day variance to compensate was tried and made it worse:
dispersion costs strokes faster than it saves them, so a wider wobble widens the
gap between the best and the worst rather than closing it.

Two structural findings came out of getting there, and both are load-bearing:

**Chips were losing their run-out.** A chip is planned as 40% carry and 60% roll,
but the engine was recomputing roll from the approach-shot green model on
landing — so every chip finished twelve yards short. Scrambling was 13%. Giving
green complexes their own apron, so that missing a green leaves you in greenside
rough rather than in deep grass, took it the rest of the way to 50%.

**Putting skill has to bite on pace, not just on line.** Tying speed control to
the same gentle rating curve as the start line left a golfer with no touch barely
punished, because beyond twenty feet almost nobody holes anything anyway — and
the engine's own optimal lag strategy then protected bad putters from the
three-putts that should be their weakness. An elite ball-striker with a poor
putter led the scoring average, which is not a thing that happens. Speed control
now spreads roughly twice as hard with rating as the line does, which is where
the brief said long-range skill should show: not in hole-outs, in whether the
next one is two feet or six.

**A single `level` per golfer made every skill correlated.** The best player was
simultaneously the longest, the straightest, the best iron player and the best
putter, so he won eleven events out of twenty. Real players are lopsided:
everybody out here is elite at something and ordinary at something else. The
authored level is now compressed into the band a tour field actually occupies and
the variation *between one golfer's own skills* is widened to compensate — which
is also what makes the fifty feel like fifty people rather than one player at
different volumes.

## Testing

- `npm test` — 30 regression tests: the shape of the field, every hole building
  with a pin on its green, dispersion behaving, lies costing what they should,
  make percentages in the tour band, a full round, a full season, the payout
  matching the purse, the save round-tripping, and determinism from a seed.
- `npm run smoke` — builds the app, drives it in headless Chromium through every
  screen, plays shots, simulates a season, rolls the year over and reloads,
  failing on any console error.
- `npm run calibrate` — the reports: club distances and dispersion by player,
  scoring by course and by par, scrambling by lie and distance, a full season
  with standings, statistical leaders and the news wire.

## Controls

Off the green: click the course to aim, space plays the shot, arrow keys nudge
the aim (hold shift for ten yards). On the green: pick a strategy — there is
nothing to aim. Space advances to the next hole. Scroll to zoom, drag to pan, and
"Whole hole" to see the hole end to end.
