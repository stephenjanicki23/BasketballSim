# Golf Universe

A top-down playable golf game wrapped around a 156-player simulated professional
tour. You aim by clicking on the course, pick a club, read the dispersion, and
live with the consequences — and the other 155 golfers play the same tournament
through exactly the same engine.

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
/src/data           156 golfers, 3 courses, 54 hole specs, 20 tournaments
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

strike           = smash ceiling for the club − |half-normal| (see below)
sample           = expected × f(strike) + z·σ, where z is normal with a fat
                   tail whose weight is set by the golfer's Consistency
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

## Strike quality, and why a bag of drives is lopsided

Distance does not scatter symmetrically around a number. You cannot beat the
middle of the clubface, so every strike is the best available **smash factor**
minus something, and what comes out is left-skewed: most drives cluster near the
player's full number, the misses are all short, and a few are very short. A bag
of real drives reads 292, 288, 294, 286, 264 — never a tidy bell curve.

```
smash          = ceiling(club family) − |z| · σ(strike skill, lie, shot type)
carry          = expected carry × (smash / ceiling) ^ 1.25
sideways push  = lost smash × gear effect × carry / 100
```

The same miss that costs distance also turns the ball, because an off-centre
strike twists the head about its centre of gravity and the ball leaves with
sidespin — so a toe hit is bad twice, and the engine names it: *Flushed*,
*Middled*, *Off the toe*, *Heavy — caught it fat*, *Thin*, *Blocked*.

Where it lands, for a tour-average driver swing:

| Strike | Share | Carry + roll | Offline | Fairway |
|---|---|---|---|---|
| Flushed | 24% | 294 yd | 18 yd | 69% |
| Middled | 32% | 291 yd | 18 yd | 68% |
| Slightly off centre | 28% | 286 yd | 19 yd | 67% |
| Off the toe | 12% | 281 yd | 22 yd | 62% |
| Nowhere near the middle | 4% | 273 yd | 27 yd | 53% |
| Heavy, thin or blocked | ~1% | 198–268 yd | 29–60 yd | 11–57% |

Strike skill is Consistency, the club's own accuracy rating, ball speed and
approach consistency, so a wild bomber's drives have a standard deviation of 15
yards and a metronome's 11, and both are skewed the same way. Rates of a real
mishit — bad enough that the commentator would say so — run from 7% of drives
for the best strikers to 18% for the worst, and up from there out of rough,
sand, straw and trees, where the lie's own mishit chance multiplies in.

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

Twenty events across the three venues, four of them majors, 156-player fields
(78 for the invitationals), four rounds, a cut to the low 65 and ties, prize
money, points, a world ranking that decays, form, statistics, a news wire and an
off-season.

Rounds are simulated **hole by hole across the whole field in lockstep**. It
costs nothing and buys the thing that makes tournament golf tournament golf: when
a player stands on the 16th tee on Sunday, the leaderboard beside them is real,
so "two clear with three to play" is a fact the engine can turn into pressure.

You can play your golfer's rounds shot by shot and let the field simulate around
you, or simulate everything and watch.

At the end of a season everybody develops: young players move toward their
potential as fast as their own temperament allows (and plenty stall), the
thirty-somethings lose a yard at a time while their course management keeps
improving, the finished ones retire, and graduates come up to keep the field
full. Fifty of the 156 are authored by hand — written personalities, archetypes
and signature ratings — and the rest are generated onto the same attribute
system, weighted towards the middle of the tour, because even the last card on
the money list belongs to somebody who shoots 72 for a living.

## The three courses

| | Coastal Championship | Desert Classic | Woodland National |
|---|---|---|---|
| Style | Links | Desert | Parkland |
| Card | Par 71, 7,167 yd | Par 72, 7,471 yd | Par 72, 7,175 yd |
| Fairways | 25–46 yd | 29–56 yd | 23–38 yd |
| Roll-out | 1.42× | 1.50× | 0.92× |
| Greens | 11.5 stimp, firm | 11.0 stimp | 12.5 stimp, small |
| Weather | 15–25 mph, rain, cold | 95–105°F | Sheltered, wet |
| Outside the corridor | Deep marram rough | Playable hardpan waste | Pine straw, then trees |
| Rewards | Wind play, flighting it | Distance, heat endurance | Accuracy, management |

Holes are authored as *specs* — par, yardage, how it bends, how wide it is where,
where the bunkers sit relative to the landing zone, how the green tilts — and
realised as geometry in yards. The grass gradient (fairway → first cut → light →
heavy → deep) is not five nested polygons; it falls out of the distance from the
centreline compared with the fairway's width at that point, which is cheaper and
gives an organic edge for free. Green complexes get their own apron, so missing a
green leaves you in greenside rough rather than instantly in the deep stuff.

### What makes a hole a hole

Five things are authored per hole, and each of them is a decision you have to
play around rather than scenery:

- **Bends.** Each one turns the line of play by so many yards over a stretch of
  the hole, sharply or gently, and they compose: one makes a dogleg, two the same
  way make a hole that keeps turning, two opposite make an S. A real dogleg moves
  the corridor sixty to a hundred yards, which is a 30–45° turn — enough that the
  tee shot cannot see the green and driver is a question rather than a default.
- **Width, along the hole.** The fairway is not one number from tee to green. A
  hole either pinches where the drive lands and opens up afterwards, or runs wide
  off the tee and narrows where the second shot has to land. Which one it is, is
  the hole's whole character.
- **Groves.** Stands of timber, gorse or cactus, placed where they change the
  shot. The tree line proper starts about twenty-five yards off the fairway,
  outside the rough bands, because a fifteen-yard miss belongs in rough; the ones
  that sit tight are deliberate corner stands, blocking the shortcut on a dogleg
  for a hundred yards and no further.
- **Specimens.** Single trees in play — the oak short of a green that decides
  which side of the fairway you want, the pine on the inside of the turn.
- **Landforms.** Ridges you drive over blind, hollows the ball gathers into,
  plateaus that leave a hanging lie, dunes and mesas off to one side. They sit on
  top of the tee-to-green slope and change what the shot plays like.

Two geometry notes that stop the shapes going wrong: a band offset toward the
inside of a bend is held back before it folds through itself (a folded water
polygon decides penalties wrongly, not just badly), and waste and coastline taper
away at their ends rather than stopping at a straight cut.

### Drawing it in three dimensions, on a flat canvas

The renderer draws what that produces: mowing lines that follow the corridor,
conifers as dark rosettes, hardwoods as bunched canopies, gorse as low cushions
in flower, saguaro as pale columns with arms. What stops it reading as flat
vector art is that everything agrees about one sun, low in the north-west **of
the course** — so when the camera turns to put the hole up the screen, the
shadows turn with it.

- **Hillshade, from the detail rather than the slope.** The height field is
  sampled to a grid, smoothed once (the lie grid underneath is piecewise flat,
  and differentiating that gives facets), then split: the broad fall of the hole
  is lit gently, the local shapes on top of it — dunes, hollows, plateaus — are
  lit hard. Lighting the raw field shades half the hole black because it climbs
  twenty feet from tee to green. A curvature term darkens hollows and lifts the
  crowns of ridges, a grain of value noise gives the ground texture (shading
  only — the ball still rolls on the field the engine authored), and the whole
  thing is mean-corrected so it models the ground instead of dimming the course.
  It goes down in `soft-light`, so the grass keeps its own colour.
- **Everything that stands up throws a shadow.** Trees, the built-up pad a green
  sits on, the lip a bunker is cut into, and the ball in flight — whose shadow
  runs away from it as the shot climbs and comes back to meet it on landing,
  which is most of what tells you how high the ball is.
- **Every cut of grass is a step, not a colour change.** Each band throws a
  thread of shade across the shorter grass inside it, on the side the sun is on.
- **Trees are sprites.** A few hundred of them on a wooded hole, painted once per
  kind into a small canvas and stamped from there — which is what makes the soft
  shadow under each one affordable. The whole thing holds 60 fps.
- **Every hole starts on a mown pad.** The teeing ground is real geometry, not a
  decal: a rounded pad square to the line the hole opens on, cut *across* the
  play line rather than up it — which is how a tee is mown and what tells you at
  a glance that it is a tee — standing a little proud of the ground around it,
  with the markers at its front edge in the colour of the set being played. It is
  ground the engine knows about too, so a ball that trickles back onto it sits on
  cut grass. Before this, a par 3 whose corridor does not start for seventy yards
  opened with the ball apparently teed up in the hay.

## On a phone

The play screen is a HUD over the course rather than a page of panels, because a
phone has one screen and a golf shot needs one decision. Four things sit at the
corners — who is playing and where they stand, the hole and the wind, the club
and the lie — and the swing button sits in the middle of the bottom edge, where a
thumb is. **Nothing is ever a scroll away from being hit**: the play screen is
sized to `100dvh` minus the chrome, measured rather than assumed (the nav wraps,
the banner comes and goes), so the course fills exactly what is left and the page
does not scroll at any size from 360 × 640 up.

- **The club chip opens the bag** — the whole set with its yardages, tap to pick.
- **Card** and **Numbers** slide the two panels in as drawers, so the scorecard,
  the conditions, the dispersion and the odds are one tap away rather than gone.
- **Caddie** puts the aim, the club and the shot type back where the caddie would
  have them: one tap to a sensible shot, then adjust.
- **On the green** the two strategies take the whole bar with their make
  percentages on them. There is still no line to drag and no meter to time.

The same HUD is drawn on a desktop, where the panels stay open beside it. Two
layout bugs came out of building it, both worth naming: the canvas used to sit in
the flow and size itself from its container *while the container sized itself
from the canvas*, which is a loop that quietly inflates until the page scrolls —
it is absolutely positioned now; and the grid was `align-items: start`, so a
column asking for `height: 100%` was asking a row that was sizing itself from
that column.

## Sound

Synthesised, not sampled. The game ships as one page with no assets beside it, so
every sound in `src/audio/sfx.ts` is built out of oscillators and filtered noise
at the moment it plays: a driver is a hard crack with a low body under it, an iron
is that crack pitched up and cut shorter, a wedge has the divot in it a moment
later, a putt is a soft click. Landings are what the ball landed in — a splash
that sweeps its filter down, sand, a swish through rough, a woody knock off a
trunk — and a holed putt rattles the cup. A birdie gets applause and an eagle gets
the gallery; a par gets nothing, because applause on all eighteen wears out inside
a round.

Two things that matter more than the sounds themselves: it is a **reaction to the
session state** rather than a second set of callbacks threaded through the
engine — `useShotSounds` watches the shot list and the status, so the simulation
stays silent and pure — and **nothing there can throw**. No Web Audio, an autoplay
policy that will not start a context, no output device: all of them end up quiet
instead of broken. The speaker in the top bar toggles it, and the choice is
remembered.

## The fourth course: Revere Concord

Three of the venues are invented. The fourth is real — the Concord course at The
Revere Golf Club in Henderson, Nevada — and it is traced hole by hole from the
overhead course tour: tee marker to pin, off the satellite imagery, with the
bunkering, the water and the desert where the map puts them. Compass bearings are
measured off the same images, so the wind hits each hole from the direction it
really would.

Three things about it are stated rather than traced, and the course file says so
at the top:

- **The holes are authored at the yardages printed on the overheads** — a
  shorter tee set — because that is what the traced geometry was measured
  against. The card played is the club's own **Black card: par 72, 6,946 yards,
  rating 73.5, slope 140**, stroke indexes included, and each hole is stretched to
  its Black number by moving the tee back: distances from the tee move with it,
  distances from the green stay put. The stretch is per hole, because the shorter
  set is not a uniform fraction of the Black one — it runs from 8% shorter on the
  1st to 37% on the 12th, whose par 3 goes from 177 yards to 242.
- **The 1st is the one hole without a yardage.** Its overhead arrived as a crop
  with no banner on it, so 370 yards is an estimate; the shape, the bend and the
  bearing are traced like every other hole, and par is fixed by the card.
- **Elevation is inferred** from tee pads standing above washes, retaining walls
  and the fall of the desert between holes. No topographic survey was to hand.

From the Black tees the field averages +0.1 in a 13 mph wind and −2.5 dead calm
at 97°F, which is about right for a tour field turned loose on a desert course at
altitude.

What is not inferred is the **altitude**: the Anthem bench sits at about 2,600
feet, and thin air is worth about two per cent of carry per thousand feet, so the
course plays roughly five per cent shorter than its card. That is now modelled for
every venue — sea-level links at 30 feet, Woodland at 620, the Desert Classic at
1,000 — and it is on the course screen beside the wind.

The engine needed two things it did not have. A course can now override how far
its scrub runs before the ball is out of bounds, because a hole cut through
housing has boundaries much closer in than open desert. And a hole can now have
**no corridor at all** over a stretch: the carry on a desert par 3 is desert, not
a ribbon of rough with a fairway missing from the middle of it.

## The fifth course: The Ranch

The second real one — The Ranch Golf Club in Southwick, Massachusetts, a dairy
farm on the shoulder of Sodom Mountain that Damian Pascuzzo turned into golf in
2001 and left as steep as he found it. It is built from the club's own
hole-by-hole overheads, and the file is explicit about which parts of it are
measurements and which are not:

- **The card is the club's.** Par, yardage and stroke index for all eighteen
  holes are the **Gold card: par 72, 7,129 yards, rating 74.8, slope 142**, and
  the two intermediate distances on each overhead — tee to the fairway marker,
  marker to the green — come off the images. Out 3,478, in 3,651, hole for
  hole.
- **The splits place every corner.** Both printed legs are measured along the
  line of play, so they add up to the card and say nothing about how far a hole
  moves sideways. What they fix exactly is *where* it turns: the marker on the
  6th is 63% of the way down it, on the 11th it is halfway. `test/ranch.ts`
  holds every corner in the file to its own printed fraction, checks the legs
  against the card, and fails any hole that bends harder than a card measured
  along it could allow. That check is the new, reusable part — any course whose
  source prints intermediate distances gets it for free.
- **On the holes not yet traced, which way each hole turns is authored**, because
  that lives in the image rather than in the numbers. Drop a trace into `TRACES` in the
  course file and the photograph replaces it, at the card's own scale, with
  nothing else to change — the 17th and the 18th are the worked examples.
- **Twelve holes are traced, not derived** — the whole front nine, the 10th, and
  the 17th and 18th, as their overheads arrive. They are read straight off the photograph: the lake that runs
  the entire left side of the 1st from two hundred yards out to past the green,
  the wooded gully on the inside of the 2nd's elbow, the pond that is a hundred
  and fifty of the 17th's hundred and eighty-two yards, the green outlines, the
  stream down the right of the 18th. Each traced play line runs *through* the
  marker the overhead prints, which turns the printed legs into a measurement of
  the trace: the 2nd comes back out at 221 + 176 against a printed 216 + 175
  scaled to its card, the 1st at 311 + 203. Traced by eye rather than digitised,
  so they are good to a few yards rather than to the yard; press **D** in a round
  to lay the photograph back over the geometry.
- **The derived holes are honest about it.** Tracing showed what a derived hole
  costs, twice. The real 1st turns *right* round a lake that takes up half the
  property; the derived one turned left round a pond beside the green. The real
  2nd is an elbow whose corner stands 116 yards *left* of the tee-to-green line,
  with a wooded gully on the inside that cannot be cut; the derived one bent 74
  yards right. Same length, same par, corner in the same place — different golf
  holes. The hole card in the game now says, on a real course, whether the hole in
  front of you was traced or built from the card.
- **Elevation is inferred**, as it was at the Concord: plan-view overheads carry
  no contours. The property runs from about 250 feet to better than 600, so the
  7th climbs 38 feet, and the 10th and the 15th fall 40.

It plays like what it is — 7,129 yards of hillside corridor through hardwood.
The field averages **+0.9 a round**, which puts it third of the five venues,
between Woodland National at +2.4 and the Desert Classic at −0.3; it hits 50% of
fairways and 66% of greens there, against 73% of greens at the Concord. The
three holes the field finds hardest are the 18th, the 4th and the 12th — and the
club's own stroke indexes make those 10, **1** and 16, so the hardest two-shotter
on the property is the hardest one here too, without anybody tuning it to be.

## Is the game easy?

It is a fair question to ask of a golf game, and it is answerable rather than
arguable. `test/playerPath.ts` plays the same golfer over the same course in the
same conditions three ways: the tournament AI as it actually plays, the AI with
the full candidate set, and **a player who accepts the caddie's club, aim and
putt every single time**. If the played game were easier than the simulated one,
the third column would be lower. It is not — it is 0.6 to 4.4 strokes *higher*
at every venue:

| Luca Brennan, 30 rounds | Tournament AI | Caddie-following player |
|---|---|---|
| Concord, calm | 68.9 | 70.2 |
| Desert Classic, real weather | 70.7 | 72.7 |
| Woodland, real weather | 73.0 | 74.0 |
| Coastal, real weather | 74.7 | 79.2 |

So there is no thumb on the scale for the human. What makes a round feel easy is
which course and which day: the same player averages −3 at Concord in still air
and +8 at the Coastal Championship in a 30 mph wind. Two things follow from that,
and both are now in the game:

- **Practice rounds get real weather.** They used to be played in dead calm,
  which is the fastest way to conclude the game is soft.
- **A finished practice round is scored against the field.** Twenty-four golfers
  spread across the ranking play the same holes, the same pins and the same
  weather through the same engine, and the panel says what they averaged, what
  the best of them shot, and where the round would have finished. Seven under at
  Concord in still air is a good round — and fourth of twenty-five.

## Does it look like a golf hole?

`test/holeAudit.ts` runs over every hole of every venue and fails on the things
that read to a player as the course being *broken* rather than hard, none of
which the scorecard or the trace checks would notice:

- **sand or water drawn across a putting surface.** A greenside bunker is placed
  by a distance along the hole and an offset across it, and a blob grown from
  that pair can bleed onto the green. Nine holes across four courses were doing
  it — The Ranch's 12th had sand over a third of its green. Generated bunkers now
  slide out until they clear the edge, measured off the blob's own outline rather
  than its nominal radius, since a squashed blob runs much further across its
  axis than along it. A *traced* bunker is never moved: if the photograph puts
  the sand there, that is where the sand is.
- **a tree standing in the line of play.** Where a hole has no mown ground at all
  — the carry on a par 3 — the fairway half-width is zero, and the procedural
  scatter was planting specimen trees three yards off that: an oak in the middle
  of the flight path. They now measure from the corridor, not the fairway.
- **a green that is not a green.** Outline a green *complex* off a photograph —
  apron, collar and all — instead of its putting surface and the hole becomes a
  dartboard. The 9th at The Ranch came back 47 × 55 yards that way and gave up
  greens in regulation at 94%; a traced green is now held to 46 yards across its
  longer axis, a grown one to 60.
- **a tee inside a hazard**, and how narrow the narrowest driving corridor on
  each course is.

It runs as part of `npm test`.

## Calibration

Every number below is asserted by `npm test`, and the reports behind them are in
`test/` (`npm run calibrate`).

| | This game | Tour |
|---|---|---|
| Driving distance (driver only, as the tour measures it) | 260–310 yd, field 290 | 270–325, field 299 |
| Driving accuracy | field 54–61%, best 68% | field 61%, best 73% |
| Greens in regulation | field 60–73% (52% on a wet, windy links) | ~65% |
| Scrambling | 44–50% | 58% |
| Putts per round | field 30.4–31.5 | 29 |
| Drive distance, one player, standard deviation | 11–15 yd, left-skewed | ~13 yd, left-skewed |
| Mishit drives | 7–18% by striker | ~10% |
| Make % at 3 / 5 / 8 / 15 / 30 ft (average putter) | 93 / 75 / 46 / 18 / 4 | 97 / 77 / 50 / 23 / 7 |
| Make % at 8 ft, elite / poor | 53 / 41 | 57 / 42 |
| Three-putts per round | 0.37–0.58 | 0.54 |
| Three-putt from 45 ft, lag / attack | 9% / 18% | 12% (mixed) |
| Penalty strokes per round | 0.2–0.4 | ~0.25 |
| Field scoring average (calm) | −0.4 to +1.0 | ~+1 |
| Field scoring average (links, 19 mph, rain) | +4.0 | +4 to +6 |
| Winning score | −12.6 average | ~−14 |
| Different winners in 40 events | 11, best player 20% | 15–20 a season, best player 10–30% |

The number that took the longest to get right was **win concentration**. At fifty
players the best golfer won 40% of events, because the best of the other 49 is
not far out. A full 156-player field fixed most of it without touching a single
coefficient — the same scoring distribution now produces 11 winners in 40 events
with the world number one on 20%, which is where the very best real players sit.
What is still tighter than the tour is the *spread* across the field: a
fifteen-point ability gap is worth about five strokes a round here against three
in reality, so the top ten or twelve names win more of the ordinary weeks than
they should. It is a sensitivity problem in every subsystem at once rather than
one dial, and it is the next thing worth doing.

Within-player variance is right, and that matters more: a golfer's own scoring
standard deviation is 3.0 strokes round to round, against about 2.9 on tour.

Four structural findings came out of getting there, and all of them are
load-bearing:

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

**…but it has to stop biting somewhere.** Left uncapped, that same curve turned
the weakest player in the field into an amateur: 2.6 three-putts a round, 34.6
putts, four strokes a round given away on the greens alone. Tour golf contains no
bad putters — the worst stroke on the money list still three-putts under once a
round — so the penalty below the reference rating now saturates towards a
ceiling instead of compounding. It cost nothing at the top of the field and took
the bottom of it from 79.3 to 76.2.

**A single `level` per golfer made every skill correlated.** The best player was
simultaneously the longest, the straightest, the best iron player and the best
putter, so he won eleven events out of twenty. Real players are lopsided:
everybody out here is elite at something and ordinary at something else. The
authored level is now compressed into the band a tour field actually occupies and
the variation *between one golfer's own skills* is widened to compensate — which
is also what makes the field feel like 156 people rather than one player at
different volumes.

**Loosening dispersion and tightening it are not opposites.** Adding the smash
model while also widening every club's lateral sigma double-counted the same
miss: strike quality already pushes the ball sideways through the gear effect, so
the field lost two strokes a round and the leaderboards stopped looking like
golf. Lateral sigma went back to where it was, the symmetric longitudinal error
was cut to make room for the new skewed one, and the mishit rates — the part the
model was actually missing — stayed raised.

## Testing

- `npm test` — 34 regression tests: the shape of the field, every hole building
  with a pin on its green, dispersion behaving, lies costing what they should,
  make percentages in the tour band, a full round, a full season, the payout
  matching the purse, the save round-tripping, and determinism from a seed.
- `npm run smoke` — builds the app, drives it in headless Chromium through every
  screen, plays shots, simulates a season, rolls the year over and reloads,
  failing on any console error.
- `npm run calibrate` — the reports: club distances and dispersion by player,
  scoring by course and by par, scrambling by lie and distance, a full season
  with standings, statistical leaders and the news wire.
- `node tools/tsrun.mjs test/venueCheck.ts` — a full tournament at every venue:
  156 players, four rounds, a cut, the weather each course generates. What wins,
  what makes the cut, which holes do the damage.
- the harnesses behind the tables above: `test/smashCheck.ts` (strike quality and
  the shape of a bag of drives), `test/puttCheck.ts` (make curves, lag against
  attack, who takes it on), `test/spread.ts` (round-to-round variance against
  player-to-player difference), `test/strokes.ts` (where a weak player's strokes
  actually go), `test/concentration.ts` (winners over several seasons).

## Controls

Off the green: click the course to aim, space plays the shot, arrow keys nudge
the aim (hold shift for ten yards). On the green: pick a strategy — there is
nothing to aim. Space advances to the next hole. Scroll to zoom, drag to pan, and
"Whole hole" to see the hole end to end.
