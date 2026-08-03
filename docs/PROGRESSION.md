# Player Progression

How a career unfolds, one offseason at a time. Implemented in
`bballsim/progression.py`; tested in `tests/test_progression.py`; runnable with
`python3 tools/careers.py --attributes`.

---

## 1. Philosophy

The thing that already existed, `ability.develop()`, moved CA and nothing else.
That is enough to make a number go up and not enough to make a career. A
33-year-old whose CA has fallen ten points should not be a slightly worse copy
of his 24-year-old self — he should be **slower and smarter**. Everything below
follows from wanting that one sentence to be true.

**The central decision: attributes move, and CA follows.**

`ability.current_ability()` already defines CA as the position-weighted sum of
the visible attributes — "the same fact viewed at different resolutions". So
this engine never writes CA. It computes a delta for each of 81 attributes,
applies them, and *recomputes* CA from the result. Three things fall out, all
of which the obvious alternative (move CA, then redistribute) gets wrong:

- **The hard rule stays enforceable where it means something.** If the new
  attribute set would price above PA, the positive deltas are scaled back until
  it fits. A player out of ceiling stops improving *in his attributes*, not
  just in a hidden number.
- **A veteran's CA holding flat becomes a real event.** He lost a point of
  speed and gained a point of decision-making, and the two happened to price
  the same.
- **Position matters for free.** A centre and a point guard losing the same
  vertical leap lose different amounts of CA, because the CA weights already
  say so.

**No age is hardcoded.** Every threshold is expressed in years either side of
two per-player numbers — an athletic peak and a prime age — both generated from
what the player's game is actually built on.

### What one rating point is worth

The curves are sized against measured CA sensitivity. Raising every attribute
in a group by one rating point moves CA by:

| group | CA per rating point |
|---|---|
| technical | 3.70 |
| experiential | 3.60 |
| athletic_skill | 2.15 |
| athletic | 0.90 |
| strength | 0.20 |
| **character** | **0.00** |

Two consequences shaped everything. Athleticism is worth under one CA point a
year even when it is collapsing, so **decline modelled in the legs alone cannot
move a career** — an ageing player has to lose his touch and his read as well,
later and more slowly, or he retires at 40 with the CA he had at 28. And
character is free: leadership and composure cost no ceiling, which is why a
veteran keeps gaining them while everything priced into CA falls.

---

## 2. Development formulas

Attributes are sorted into six **development groups** by what makes them move
(not the display groups, which are organised for a squad screen): `athletic`,
`strength`, `athletic_skill`, `technical`, `experiential`, `character`.

For group *g* at age *a*, with `d = a − prime_age`:

```
if d < growth_end[g]:
    approach = (growth_end[g] − d) / span            # 0..1, 1 = start of career
    rate     = GROWTH[g] × (0.40 + 0.60 × approach)
    rate    ×= arc multiplier for that group
    delta    = rate × coach_growth × minutes_factor × realisation × taper
```

| group | GROWTH (pts/yr) | growth ends |
|---|---|---|
| technical | 1.15 | prime + 3 |
| experiential | 1.20 | prime + 5 |
| athletic_skill | 0.92 | prime − 1 |
| athletic | 0.60 | athletic peak |
| strength | 0.42 | prime |
| character | 0.26 | never |

`experiential` also carries an **experience bonus** decaying on seasons played
(τ = 5.5), not age: a rookie learns more in his second season than a veteran
does in his twelfth, whatever their birthdays say.

**The ceiling taper.** Growth scales by
`clamp((effective_ceiling − CA) / 28, 0, 1)`, so a career approaches its ceiling
asymptotically. Without it a player climbs at full tilt and stops dead against a
wall, which looks exactly as wrong on a career graph as it sounds — in testing
it produced a five-season dead-flat plateau from age 23.

---

## 3. Regression formulas

```
beyond = d − decline_start[g]
rate   = DECLINE[g] × (1 + DECLINE_ACCEL[g] × beyond)     # accelerates
rate  ×= (2 − arc.longevity)
rate  ×= arc.athletic_decay × (1 + 0.35 × injury_load)    # legs only
delta  = −rate × coach_decline × share_of_what_is_left
```

| group | starts | rate at start | accel/yr |
|---|---|---|---|
| athletic | athletic peak | 0.30 | 0.18 |
| athletic_skill | prime − 1 | 0.40 | 0.14 |
| technical | prime + 3 | 0.32 | 0.20 |
| experiential | prime + 5 | 0.45 | 0.25 |
| strength | prime + 2 | 0.10 | 0.06 |
| character | never | — | — |

**Losses are proportional to what is left**
(`share = clamp(level / 10.5, 0.30, 1.60)`). A flat subtraction walks a
40-year-old's speed down to 1 out of 20 — that is not a slow veteran, it is a
man who cannot run. Taking a share instead flattens the curve as it falls, and
an elite athlete loses more in absolute terms because he has more to lose.

Acceleration is *relative to each group's own start*, which is the mechanism
behind "the further past prime, the faster decline becomes" — and because the
groups start at different times, the legs are already going while the read of
the game is still improving.

---

## 4. Prime age generation

```
prime = 28.6
      − 3.4 × leg_reliance          # what his game is built on
      + position_shift              # PG −0.5, SG +0.2, SF +0.2, PF −0.1, C −0.4
      + arc.prime_shift
      + gauss(0, 0.85)
      clamped to [25.0, 33.5]

athletic_peak = prime − 4.4 + gauss(0, 0.6)
```

`leg_reliance` is read off the attributes — the gap between his athletic
attributes and his learned ones — rather than assigned. An explosive guard
whose ability sits in his legs peaks early because the thing he is built on is
the thing age takes first; a shooter with a high basketball IQ peaks late and
lasts. Bigs sit slightly early: more of a centre's CA is strength and rim
protection, both physical.

Athletic peak and prime are **different ages**. Athleticism tops out around
24–25; the prime is later, where rising skill still outruns falling legs.

---

## 5. Injury effects

Nine kinds, weighted. Each carries games missed, permanent attribute loss, an
`injury_load` increment, and sometimes a permanent PA cost.

| injury | weight | out | permanent | PA cost |
|---|---|---|---|---|
| Ankle sprain | 30 | 3–12 | — | — |
| Hamstring strain | 18 | 5–18 | speed, acceleration −0.15 | — |
| Knee soreness | 14 | 4–15 | — | — |
| Broken hand | 9 | 12–30 | — | — |
| Back injury | 8 | 10–35 | agility, stamina −0.3 | 1.5 |
| Stress fracture | 6 | 20–45 | speed, vertical −0.4 | 2.5 |
| Shoulder tear | 5 | 25–55 | strength −0.5 | 2.0 |
| **Torn ACL** | 3.2 | 55–82 | speed −1.5, accel −1.8, vertical −1.6, agility −1.2, quickness −1.3 | 9.0 |
| **Ruptured Achilles** | 1.8 | 60–90 | speed −1.9, accel −2.1, vertical −2.2, quickness −1.6 | 12.0 |

```
risk = 0.16 × (1 + 0.9×proneness − 0.5×durability) × (0.55 + 0.65×minutes/2400)
     + 0.018 × years_past_prime
risk × arc.injury_risk × (1 + 0.6 × injury_load)
```

Three permanent consequences: attributes lost outright, a **PA cut that never
comes back** (ceilings only ever fall), and a raised `injury_load` that makes
every subsequent year of athletic decline worse. Time missed also scales down
that season's growth. A fragile player does not just get hurt more often — the
severity weighting means he gets hurt *worse*.

Runs at ~22% of player-seasons, ~1.2% career-altering.

---

## 6. Coaching effects

```
growth  multiplier = 0.80 + 0.40 × (development / 100)     # 0.80 … 1.20
decline multiplier = 1.18 − 0.32 × (development / 100)     # 1.18 … 0.86
```

An elite developer is worth about a fifth more growth a season — which
compounds into years of a prospect's timeline — and holds off about a quarter of
the decline. A poor one costs about as much both ways. Coaching also gates the
`breakthrough` career event.

---

## 7. Personality effects

```
realisation = 0.60 + 0.38 × mean(professionalism, development_rate, ambition,
                                 work_rate, coachability, competitive_drive)
effective_ceiling = baseline_CA + realisation × (PA − baseline_CA)
```

Character closes **a share of the gap**, not a share of PA. Scaling PA outright
is the obvious formulation and it is wrong, because it reaches backwards: an
established 28-year-old at CA 158 with PA 161 and ordinary professionalism gets
handed a ceiling of 146 — below ability he demonstrably already has. His growth
taper then pins at zero and he stops responding to coaching or minutes at all.
That surfaced in testing as *a poor coach producing better players than an elite
one*, because neither was producing any development to compare.

Your spec case, reproduced: two 18-year-olds at CA 95 with PA 185 finish at
**181** (professionalism 19) and **158** (professionalism 6).

---

## 8. Experience effects

Experience is tracked as `seasons_played`, separately from age, and feeds the
`experiential` bonus decaying at τ = 5.5 seasons. Character growth also ramps
on time served (`0.4 + 0.6 × min(1, seasons/8)`).

The result is the property that makes veterans worth playing: judgement,
shot selection, help defence and positioning keep climbing for years after the
legs turn over — measured across careers, athleticism falls by several rating
points more than judgement does.

---

## 9. Attribute growth rules

- Every delta is per-attribute, with ±45% noise, so a group never moves as a
  block.
- Growth is gated by `coach × minutes × realisation × taper`; decline by
  `coach × share_of_what_is_left`.
- Character is exempt from the taper — it costs no CA, so a player with no
  ability headroom still matures.
- Everything is clamped to the 1–20 scale, and CA is repriced from the result.

**Minutes** are an inverted U for young players — `0.45 + 0.55 × (min/2100)`
below the ideal load, falling away above it — and stop developing a veteran
entirely, instead buying `wear` that accelerates athletic decline.

---

## 10. Career archetypes

Eight, and a **separate axis** from `ability.Archetype` (which is how a player
*plays*). This is how he *lasts*: a Rim Runner can be an Ironman or an
Injury-Prone Star, and those say different things. Each is a set of multipliers
rather than a special case in the code, and each is **drawn** from the player's
own attributes by `pick_arc`, not assigned.

| arc | prime | growth | athletic decay | skill | injury risk | longevity |
|---|---|---|---|---|---|---|
| Explosive Athlete | −1.8 | 1.15 | 1.35 | 0.85 | 1.0 | 0.80 |
| Skill Veteran | +1.6 | 0.90 | 0.75 | 1.25 | 1.0 | 1.30 |
| Ironman | +0.8 | 1.00 | 0.85 | 1.05 | 0.45 | 1.25 |
| Late Bloomer | +2.4 | 0.70 | 0.90 | 1.30 | 1.0 | 1.15 |
| Injury-Prone Star | −1.2 | 1.10 | 1.20 | 1.00 | 2.30 | 0.75 |
| High IQ Veteran | +2.0 | 0.85 | 0.80 | 1.10 | 0.80 | 1.40 |
| Raw Prospect | +1.0 | 1.30 | 1.00 | 0.80 | 1.0 | 0.95 |
| Workhorse | +0.6 | 0.95 | 0.90 | 1.15 | 0.75 | 1.20 |

**Career events** are what stop a profile being a curve with noise on it:
breakout season (×1.9 growth), coaching breakthrough (weakest group jumps),
confidence knocked (growth ×0.35), early athletic decline, late bloom (×1.6).

---

## 11. Three careers, 18 to retirement

Generated by `python3 tools/careers.py`. Same age, near-identical ceiling,
"can't-miss" on all three. They differ only in character and in what their game
is built on — the arc label is drawn by the engine, not cast.

**Dante Rowe** (SG, CA 95 → PA 185) — professionalism **6**.
Prime 31.7, athletic peak 27.6, closes 75% of his gap.

```
 18  101.6  +6.6   704   Ankle sprain (4g)      25  150.4  +5.9  2865
 21  122.7  +7.9  1532   Knee soreness (4g)     29  157.5  +0.3  Back injury; ceiling −2
 23  138.6  +7.9  2420                          30  157.5  −0.0  Stress fracture; ceiling −2
                                                33  152.5  −2.0  confidence knocked
                                                37  137.8  −6.5
                                                39  122.6  −7.8  RETIRES
peaked at CA 158 aged 29 — 85% of a 185 ceiling, 22 seasons
```

**Marcus Vela** (SG, CA 95 → PA 185) — professionalism **19**.
Prime 28.3, athletic peak 23.0, closes 97% of his gap.

```
 18  103.5  +8.5   704                          28  168.0  +0.7  2900
 21  130.7 +10.1  1679                          31  166.1  −1.2
 22  141.2 +10.5  1937  breakthrough: athletic   33  158.2  −4.1  Ankle sprain
 24  154.8  +6.2  2900                          35  144.3  −7.0  RETIRES
peaked at CA 168 aged 28 — 91% of a 185 ceiling, 18 seasons
athletic 9.8 → 6.0   technical 10.0 → 16.2   judgement 9.6 → 18.5   character 12.5 → 18.6
```

**Elias Turnbull** (C, CA 88 → PA 178) — raw, coachable, relentless.
Prime 30.6, athletic peak 27.0, closes 94% of his gap.

```
 18   93.5  +5.5   581  Shoulder tear (31g); ceiling −2
 20  112.5 +10.1   835  breakthrough: strength
 23  151.4 +16.4  2560  breakout season
 28  162.2  +0.3  2900  Shoulder tear (47g); ceiling −2
 34  155.6  −2.5  2805  RETIRES
peaked at CA 162 aged 29 — 91% of a 178 ceiling, 17 seasons
athletic 8.9 → 8.8   technical 8.9 → 15.7   judgement 9.5 → 20.0   character 11.3 → 17.4
```

Three players, one brief, three different careers: a 22-season slow burn that
never collects its ceiling, an 18-season star who does, and a raw big whose
breakout at 23 is worth 16 CA in a single year.

---

## League-wide outcomes

Measured over every player in the shipped league run to retirement
(≈3,300 player-seasons):

| | sim | real |
|---|---|---|
| retirement age | 34.7 mean / 35 median | ~34–35 |
| peak age | 27.5 mean | ~27 |
| peak CA as share of PA | 0.95 | reaching PA is not guaranteed |
| injuries per season | 22.5% | — |
| career-altering injuries | 1.2% of seasons | — |

CA as a share of each player's own peak, by years from his prime — the shape of
a career, aggregated:

| years from prime | −2 | 0 | +2 | +4 | +6 | +8 |
|---|---|---|---|---|---|---|
| sim | 1.00 | 0.98 | 0.96 | 0.92 | 0.83 | 0.74 |
| target | 0.95 | 1.00 | 0.97 | 0.91 | 0.82 | 0.70 |

**Known gap.** The pre-prime side of that curve reads flatter than the target
(0.98 at prime−6 against 0.74). That is a property of the shipped roster rather
than of these curves: `data/league.json` gives a 19-year-old a CA/PA ratio of
0.735 and only 38 points of headroom, so there is not 26% of a career's growth
available to measure. Run from genuine 18-year-old prospects — the three above —
growth behaves as designed, +6 to +11 CA a year through the early twenties.
Closing it properly means regenerating the roster with more prospect headroom,
which would break the frozen-roster guarantee, so it is documented rather than
forced.
