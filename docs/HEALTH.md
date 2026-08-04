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

## 5. Wear and tear

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

## 6. Injuries

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

## 7. Stored, not derived

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

## 8. What a season actually produces

Measured on the last night of a full 1,230-game regular season — during the
season, not after it, because fatigue read after two months of playoff gaps is
a reading of a rested league.

| Workload | Fatigue at tip-off | Band |
|---|---|---|
| 28+ mpg | 40.5 | Slightly Tired |
| 22–28 mpg | 38.3 | Slightly Tired |
| 15–22 mpg | 26.6 | Fresh |
| under 15 mpg | 16.9 | Fresh |

Those are **trough** figures: fatigue oscillates, spiking after a game and
decaying before the next — and the amplitude is one game's load, so a starter's
peak is Noticeable to Heavy Fatigue, near 58, before it comes back down. Inside a
game `condition` keeps falling — so a starter tips off around −1 to his
athletic attributes and is −2 to −3 by the fourth quarter. That trajectory is
the point. It is also, almost exactly, the brief's own worked example.

Wear after one season: mean 8, max 16 — single digits for a career quantity.
Injuries: rare, as asked; ten players are carrying one when the champion is
decided.

**What it cost the box score.** The league's heaviest workload went from 39.2
minutes a night to 34.8 and the leading scorer from 28.8 points to 25.0; team
scoring is unchanged at 108.6 against a baseline of 108.8, and the rebounding
calibration puts 13 players over ten a game where it used to put 15. Roughly
half of the minutes haircut is fatigue and half is the rest lever sitting
players outright. An eighth off the best player in the league is the system
working: fatigue is supposed to cost production, and a coach who rests his star
is supposed to lose something for it.

### Three bugs worth remembering

All three behaved correctly in every part and were only visible in a full-season
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

## 9. What this does not do

- **No training load.** Practices, minutes restrictions and load management as
  an explicit manager instruction are not modelled; the only lever is who plays
  and for how long.
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
  so the rotation pulls him sooner and his minutes redistribute. Getting to
  Critical would take overriding the rotation, and there is no manager control
  to do that — which is the largest gap between this and what the brief calls
  "strategic rest decisions". The system responds to minutes; it does not yet
  let you choose them.
