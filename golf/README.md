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

### Putting

Deliberately not a precision minigame. You see the slope arrows, the break, the
pace, the make percentage and the three-putt risk, plus a marker on the line the
read says to start the ball on. Click it and only execution is left; aim
somewhere else and that is a choice you have made.

Make probabilities are computed analytically rather than by sampling, because the
hole is a fifth of a foot wide and any quadrature cheap enough to run inside a
season simulation misses it entirely.

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
| Scrambling | 50% | 58% |
| Putts per round | field 30.6–32.5 | 29 |
| Make % at 3 / 10 / 20 / 30 ft | 98 / 45 / 16 / 8 | 97 / 45 / 18 / 8 |
| Penalty strokes per round | 0.1–0.3 | ~0.25 |
| Field scoring average (calm) | +0.3 to +1.9 | ~+1 |
| Field scoring average (links, 19 mph, rain) | +5.9 | +4 to +6 |
| Winning score | −13.9 average | ~−14 |
| Different winners in 60 events | 13, best player 23% | 15–20, best player 10–25% |

Two structural findings came out of getting there, and both are load-bearing:

**Chips were losing their run-out.** A chip is planned as 40% carry and 60% roll,
but the engine was recomputing roll from the approach-shot green model on
landing — so every chip finished twelve yards short. Scrambling was 13%. Giving
green complexes their own apron, so that missing a green leaves you in greenside
rough rather than in deep grass, took it the rest of the way to 50%.

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

Click the course to aim. Space plays the shot and advances to the next hole.
Arrow keys nudge the aim (hold shift for ten yards). Scroll to zoom, drag to pan,
and "Whole hole" to see the hole end to end.
