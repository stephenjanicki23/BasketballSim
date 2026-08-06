# Fatigue, Wear & Tear, and Injuries

How a player's body changes over a night, a season and a career. Implemented in
`bballsim/health.py`; tested in `tests/test_health.py`.

---

## 1. The one decision everything else follows from

The brief asks for a system where **fatigue matters more than injuries**. That
single sentence sets every number below.

A manager should lose a game in March because he rode his starters through
February — a cost he chose, could see coming, and could have avoided by resting
someone. He should *not* lose his season to a dice roll. So:

- fatigue is **constant, visible and expensive**: every player carries it, it
  shows on the squad page, and it takes real rating points off real attributes;
- major injury is **rare**: a handful across a thirty-team season, and the only
  thing that rules anyone out;
- minor knocks are **common but cheap**: they degrade a player rather than
  remove him, which keeps the decision on the manager's desk instead of the
  physio's.

## 2. Three clocks, kept apart

The trap in a system like this is counting the same tiredness twice. There are
three timescales and each owns exactly one number.

| | Number | Lives | Moves |
|---|---|---|---|
| **Tonight** | `Player.condition` | 100 → 0 across a game | drained per second on the floor, recovered on the bench |
| **This season** | `Health.fatigue` | 0 → 100 across a season | up after every game, down on every rest day |
| **This career** | `Health.wear` | 0 → 100 across years | up slowly with minutes, sheds ~14% each summer |

`condition` already existed and already drove substitutions and shot selection.
It has not been replaced.

**The season joins the game at tip-off, not at every read.** `starting_condition`
is the entire bridge:

```
condition = 100 − fatigue × 0.62 − knock × 0.25
```

A player carrying 70 fatigue starts the night at 57, not 100. Everything
downstream then follows from the one number the engine already reads: the
rotation pulls him sooner, the possession engine asks less of him, and the
attribute penalty below bites harder. Nothing else in the engine needs to know
season fatigue exists — and adding a separate season term to each of those three
places would have charged him for the same tiredness three times.

## 3. Fatigue

### Accrual

```
cost  = minutes × 0.5 × intensity × conditioning × age
      × (1 + knock/100 × 0.45)
      + 5.0   if back-to-back        (2.0 if three-in-four)
      + 3.0   per overtime
      + 1.2   if away
```

The flat charges stay smaller than the minutes term on purpose. A charge big
enough to dominate minutes stops being a penalty for a hard schedule and becomes
a tax on everyone, which squeezes out the gap between a thirty-eight-minute star
and a twelfth man — the one gap the system exists to show. An earlier version
charged 7.0 for a back-to-back on a calendar where *every* game was one, and the
league pinned at Critical Fatigue to a man.

Back-to-back and three-in-four are read off the drawn rest gap below: a one-day
gap is a back-to-back, a two-day gap is a three-in-four.

- **Intensity** comes from what kind of game it was: a playoff night is ×1.22, a
  blowout ×0.85 (the bench plays), a game inside five points ×1.08.
- **Conditioning** is the endurance composite and work rate against league
  average — a well-conditioned player pays about 15% less.
- **Age** costs 3% per year past 27.

A 36-minute night at ordinary intensity costs an average 27-year-old about
**18 points**.

### How much rest a game represents

The fixture list is a **viewing** calendar, not a basketball schedule: 82 games
in 28 days across three slates a day means a club's games sit about five hours
apart on the real clock. No professional plays that, and a recovery model
reading hours off that clock would be pricing a schedule nobody plays.

So the health model draws its own gap, per club, per fixture:

| Days of rest | Share | Per 82-game season |
| --- | --- | --- |
| 1 (back-to-back) | 16% | ~13 |
| 2 | 44% | ~36 |
| 3 | 32% | ~26 |
| 4 | 8% | ~7 |

Two or three days is the ordinary case, a back-to-back is the occasional hard
one at roughly the rate a real season has, and four days is the soft landing
after a heavy week. The draw is seeded from the club and the fixture, so the
schedule a team gets is a fact about the season rather than about when you
opened the page — and it survives a replay. Mean gap: **2.32 days**.

The fixture list still says when a game is *watched*. This says what it cost.

### Recovery

```
fatigue = fatigue × exp(−0.13 × days) − 2.8 × days
days    = hours ÷ 24
```

Exponential decay is the only shape that settles against a repeating schedule:
load pushes fatigue up, decay pulls harder the higher it gets, and a player
equilibrates at the level his minutes deserve instead of drifting to one end of
the scale. It also means a four-month summer cannot drive fatigue hundreds of
points negative and leave the clamp doing the modelling. The rate scales with
stamina, professionalism, the club's development rating and age.

**The flat term is not decoration.** Load across the rotation is much flatter
than minutes are — a 14-minute reserve costs 11.7 a night against a 29-minute
starter's 17.9, because the flat charges and a reserve's poorer conditioning
land on both. A purely proportional model settles every player in proportion to
his load, so a 1.5× spread in load could only ever produce a 1.5× spread in
fatigue, and the brief wants better than 2×. Subtracting a constant from
everybody is what widens it, because it is most of a reserve's night and a third
of a starter's.

Both constants were **solved, not guessed** — and against *measured* load rather
than nominal. Equilibrium is where one game's load equals one gap's recovery, so
a season's real per-game cost per rotation slot, regressed against the mean
2.32-day gap, fixes both:

| Workload | Measured load/game | Settles at | Band |
| --- | --- | --- | --- |
| 28+ mpg | 17.9 | 40.5 | Slightly Tired |
| 22–28 mpg | 16.3 | 38.3 | Slightly Tired |
| 15–22 mpg | 14.1 | 26.6 | Fresh |
| under 15 mpg | 11.7 | 16.9 | Fresh |

Those are the equilibria the constants were solved *to*, with nobody rested. The
league now settles a little under them at the top, because the coach in §5 takes
load off the heaviest workloads before they get there.

### Bands

The brief's ladder, verbatim: Fully Rested (0–15), Fresh (16–30), Slightly Tired
(31–45), Noticeable Fatigue (46–60), Heavy Fatigue (61–75), Exhausted (76–90),
Critical Fatigue (91–100). Condition is the same information in team-sheet
language: Excellent / Good / Fair / Poor / Exhausted.

## 4. What fatigue does to a player

Rating points removed from a fully-affected attribute, interpolated from the
brief's own table:

| Fatigue | 20 | 40 | 60 | 80 | 95 | 100 |
|---|---|---|---|---|---|---|
| Penalty | 0.1 | 1.0 | 2.0 | 3.5 | 5.0 | 6.0 |

Each attribute carries a weight on top, so 80 fatigue costs 4.9 off speed, 4.2
off shot contest and 1.1 off decision-making — the brief's "−3 to −5 depending
on attribute".

**Where it enters the engine.** `composites.blend` is the single choke point:
all 26 composites go through it, and it now takes the *player* rather than his
rating sheet and reads each attribute through `health.effective`. One line. That
is the same reason the composites module says it is the layer to tune.

**What is not touched**, per the brief: everything in Basketball IQ,
Intangibles and Mental, plus `passing` and `court_vision`. A tired player still
reads the floor; his legs are late.

**Shooting is not touched either**, and that is the brief's call rather than an
oversight. The engine already damps a tired player's *usage* — he takes fewer
shots rather than missing more of them — so the three effects stack
deliberately: he does less, he does it worse, and his team does it worse around
him.

### Three attribute names the brief asks for that do not exist here

Rather than invent an attribute, each is mapped to what actually carries the job,
and the mapping is stated so nobody has to guess:

| Brief | Mapped to | Why |
|---|---|---|
| Closeouts | `shot_contest`, `wing_defense` | a closeout is a contest |
| Driving | `euro_step`, `isolation` | what a drive is actually resolved from |
| Reaction Time | `steals`, `blocks` | the obvious candidate, `anticipation`, is in the Basketball IQ group, and the brief says IQ does not fall. A tired man still reads the play; his hands are late |
| Transition Defense | *(covered)* | no attribute of its own — getting back is legs, and legs are already the most heavily penalised things on the list |

## 5. Who sits, and who decides

Fatigue is only half a rest model. The other half is a coach willing to act on
it, and in this league he acts on his own: nobody is asked to set a team sheet,
so `player_management` is the rating that decides whether a tired man plays.

**The trigger is not the fatigue meter.** It is `projected_loss` — how many
current-ability points a player would be *down at tip-off*. A guard whose game
is speed loses more of himself to the same tiredness than a centre whose game is
strength, and CA is already this project's answer to "what is this player
worth". A coach sits a man because the version available tonight is a materially
worse player, not because a number reached 60.

```
threshold = 3.6 − (player_management − 50) × 0.045     floored at 1.2
```

Three guards keep it from becoming a different game:

- **Never in the postseason.** Absolute, not weighted. A coach who rests his
  best player in a playoff game to protect him for the summer is not managing,
  and no rating should be able to produce that.
- **Two men a night at most**, so a hard schedule cannot turn into a forfeit.
- **Only the top eight.** No point sitting the twelfth man; he is not tired and
  nobody notices.

A manager's explicit instruction overrules all of it, including in the
postseason — an instruction is an instruction.

### The lever that never fired

`plan_rest` compares `projected_loss` against `rest_threshold`, and the
threshold had been calibrated against `ability_lost` read at a player's *live*
mid-game condition, where losses run 7 to 23. Projected losses — read at the
condition he would *start* at, which is the number a pre-game decision is
actually taken on — run 0 to about 9. `REST_AT_AVERAGE` was 9.0, so the lowest
threshold any coach in the league could reach was 5.0.

**No coach rested anybody, in any game ever simulated.** Both halves were
individually sensible; they simply were not denominated in the same thing, and
nothing in the code showed it. `TestTheCoachActuallyRestsPeople` now pins the
two scales together from both ends: the hardest coach in the league must have a
threshold a real player can cross, and the softest must not sit half the league
every night.

The slope had to be steepened as well as the level lowered. Generated
`player_management` spans about 39 to 80 rather than the full 0–100, so a
rating only discriminates if the slope is set against *that* range — at 0.026
the best and worst coaches in the league rested four and five men respectively
across a whole season, which is not a rating doing anything.

### Resting concentrates minutes

The level is set by a second constraint as well as fatigue, and it is the one
that stopped the number going lower. Sitting a man does not only make him
fresher, it hands his minutes to whoever plays instead — so a league that rests
freely posts **inflated per-game averages across the board**. At a threshold of
3.0 the league mean rose from 20.3 to 21.6 minutes and the count of players
averaging ten rebounds went from 15 to 25, well past where the rebounding
calibration sat before fatigue existed at all.

3.6 is the compromise, and it is not free: see the honest accounting in §9.

## 6. Wear and tear

```
wear += 0.11 × (minutes/36) × (1 + fatigue/100 × 1.6) × age × frailty
```

Deliberately tiny: this is a career quantity, and a full season of heavy minutes
should be worth single digits, not half the scale.

The term that matters is **fatigue at the final buzzer**. Playing tired is what
actually breaks people, so a game finished in Critical Fatigue does more than
twice the long-term damage of one finished Fresh. That is the mechanism that
makes a manager's rest decisions echo years later rather than just next week.

Wear sheds **14% each summer** and keeps the rest. It never clears, and what is
left raises injury risk for the rest of a career.

## 7. Injuries

Two tiers, and the split is the brief's central demand.

### Minor knocks — common, cheap

~0.65% per player-game at baseline, and fatigue and wear multiply it, so a
season produces several times that. Severity 18–70. A knock **does not** rule
anyone out: it drags the same attributes fatigue does (at 55% of the equivalent
rate), makes every subsequent game more tiring, and heals at 12 points a day.
The manager decides whether to play him through it.

### Major injuries — rare, decisive

~0.055% per player-game at baseline, weighted so the catastrophes are a small
slice of an already small slice:

| | Weight | Games |
|---|---|---|
| Sprained ankle | 30% | 6–14 |
| Hamstring strain | 18% | 8–18 |
| Groin strain | 14% | 7–16 |
| Broken hand | 12% | 14–26 |
| Stress fracture | 10% | 18–34 |
| Meniscus tear | 8% | 24–45 |
| Achilles rupture | 5% | 55–82 |
| ACL tear | 3% | 50–82 |

A major injury sets `Player.injured`, which already gated `available_players`
and therefore the rotation and the starting five — a flag that had no writer
until now. The serious ones carry permanent attribute costs and a potential-
ability cut, handed to `progression` at the offseason, which is where a
career-shaping loss belongs.

Coming back is not the same as being fresh: a returning player's fatigue is
floored at 35, so he is short of match fitness rather than restored.

### Risk

```
risk = base × (1 + fatigue/100 × 2.2) × (1 + wear/100 × 1.1)
            × age × proneness × frailty × (minutes / 30)
```

A player at Critical Fatigue is roughly **three times** more likely to get hurt
than a fresh one. That multiple is the entire incentive to rest him — large
enough to change a decision, not so large that resting becomes mandatory.

Rolls are **seeded from the fixture and the player**, so a season replays to the
same injuries. Everything else in this project is reproducible; an injury list
that changed on reload would be the one thing that was not.

## 8. Stored, not derived

Health is **saved with the player**, and that is a deliberate departure from how
standings, season stats and the playoff bracket work here — all of which are
rebuilt from the fixture list on load.

A player's tiredness is a fact about his body at a moment in time, in the same
category as his age. It is not a summary of the games. Deriving it would also
mean replaying every recovery day of a season on every boot to answer "is he fit
tonight?", and would make the answer depend on how the schedule was walked
rather than on what happened.

The consequence is one rule the code has to keep: health is applied in
`League._finalize`, **not** in `_record`. A season restored from disk folds its
saved results back into the standings, and re-applying a night's fatigue and
re-rolling its injuries there would age a squad by a whole season on every boot.
Chemistry is excluded from `_record` for exactly the same reason.

## 9. What a season actually produces

Measured on the last night of a full 1,230-game regular season — during the
season, not after it, because fatigue read after two months of playoff gaps is
a reading of a rested league.

The bracketed figures are the same league with the rest lever inert, which is
what it did for its whole life until §5 was fixed — so the two columns isolate
what a coach managing his squad is worth on top of fatigue itself.

| Workload | Fatigue at tip-off | With no coach resting | Band |
|---|---|---|---|
| 28+ mpg | 36.2 | 40.5 | Slightly Tired |
| 22–28 mpg | 34.5 | 38.3 | Slightly Tired |
| 15–22 mpg | 27.7 | 26.6 | Fresh |
| under 15 mpg | 18.1 | 16.9 | Fresh |

The top of the league comes down about four points and the bottom goes up about
one, which is exactly the shape a rest lever should have: it moves load off the
men carrying too much and onto the men carrying too little. League mean 28.7,
max 64.5, and every band from Fully Rested to Heavy Fatigue is occupied.

Those are **trough** figures: fatigue oscillates, spiking after a game and
decaying before the next — and the amplitude is one game's load, so a starter's
peak is Noticeable to Heavy Fatigue, near 58, before it comes back down. Inside a
game `condition` keeps falling — so a starter tips off around −1 to his
athletic attributes and is −2 to −3 by the fourth quarter. That trajectory is
the point. It is also, almost exactly, the brief's own worked example.

Wear after one season: mean 7.8, max 13.8 — single digits for a career quantity.
Injuries: rare, as asked; nine players are carrying one when the champion is
decided. On a given night eight clubs of thirty are resting somebody, thirteen
men in all, and a season loses about 980 player-games to it.

**What it cost the box score**, against the pre-fatigue baseline, with the
inert-lever league in brackets:

| | Before fatigue | Now | Lever inert |
|---|---|---|---|
| team scoring | 108.8 | 108.2 | 108.6 |
| heaviest workload | 39.2 | 35.9 | 34.8 |
| leading scorer | 28.8 ppg | 27.0 | 25.0 |
| players at 10+ rpg | 15 | 19 | 15 |

**The honest part is the last row.** Resting does not only reduce load, it
**concentrates** it: the men who play instead absorb the minutes, and per-game
averages inflate. Nineteen players over ten rebounds a night is four more than
the rebounding calibration was set against — visibly a cost of this lever, not a
neutral outcome. It is why the threshold is 3.6 and not lower; at 3.0 that row
read 25. The trade accepted here is a rest system that visibly functions in
exchange for slightly generous counting stats, and the alternative on offer was
a coach rating that did nothing at all.

### Four bugs worth remembering

All four behaved correctly in every part and were only visible in a full-season
measurement against a known baseline.

**Rest paid in a lump.** Recovery ran once per `tick`, for the whole span the
clock had jumped — so playing a season in one tick handed out the season's rest
first and played the games into it afterwards. An 82-game year finished at a
mean fatigue of 0.8 with nobody above Fresh. Recovery is now charged per game
against a drawn gap and is not tied to the wall clock at all, which retires the
whole class of bug.

**The model reading its own output.** Endurance decides how fast a player
tires, and `stamina` is an attribute fatigue takes points off. Once composites
read the adjusted sheet, all three inputs to the fatigue model — the possession
clock, bench recovery, season accrual — began feeding on its output: tired
lowers stamina, lower stamina drains faster, which makes him tireder. Three
amplifiers compounding, which is why forgiving the substitution threshold
barely dented it. `composites.endurance_base` exists for exactly this, and the
rule is written where it is used.

**A floor that ate its own function.** `recovery_rate` ended with
`max(4.0, rate)`, a floor so the worst body in the league still recovers. When
the rest model moved to whole days and `RECOVERY_PER_DAY` came down to suit,
every computed rate fell under the floor — so the floor became the *only* term
and stamina, professionalism, staff quality and age silently stopped mattering
to recovery at all. Nothing failed; the league simply recovered at one flat
rate. Floors and caps are now written as fractions of the constant they guard,
so they cannot outlive it.

**Two scales that never met.** The rest threshold was priced in one measure of
lost ability and compared against another, so the whole coach-management lever
was dead on arrival — see §5. The lesson is narrower than "check your units":
both numbers were called *ability points lost*, and both were. They were read at
different moments, and the moment was not in either name.

## 10. What this does not do

- **No training load.** Practices and phased minutes restrictions are not
  modelled. Load management exists only as the whole-night decision in §5 —
  a man plays or he sits, there is nothing between.
- **No return-to-play ramp.** A major injury ends on a fixed game count with a
  fatigue floor, not a phased minutes restriction.
- **No injury news.** The wire has no story for a player going down, though
  `Health` carries everything one would need.
- **Knocks do not cause absences.** By design — a knock is a performance cost,
  because that is what keeps the decision with the manager. Real teams do sit
  players with minor issues; this model makes you play them or bench them
  yourself.
- **Nobody reaches Critical Fatigue**, and that is the model self-regulating
  rather than a dead band. A tired player starts the night at a lower condition,
  so the rotation pulls him sooner and his minutes redistribute — and now the
  coach sits him outright before it gets that far. The league tops out around 65
  and four players a season reach Heavy Fatigue. Getting to Critical would take
  overriding both the rotation and the coach.
- **Rest is the coach's call, not yours.** `plan_rest` honours an explicit
  `team.rested` instruction over its own judgement, but no screen sets one, so
  in practice `player_management` decides. That is deliberate — the front
  offices manage themselves here — but it does mean the brief's "strategic rest
  decisions" are a rating's decisions rather than a manager's.
