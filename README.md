# Basketball Manager — Simulation Shell

A skeleton for a Football-Manager-style basketball game. The point of this
commit is the **plumbing**, not the content: possessions are simulated one at a
time from player ratings, tactics and chemistry; games tip off on a schedule;
and you can open any game in a tracker and watch the play-by-play unfold.

There are no real teams or players — `bballsim/placeholder.py` invents a
30-team league of 360 anonymous players so the shell boots. Delete it when you
load real data.

## Running it

No dependencies. Python 3.11+.

```bash
python3 run.py serve          # web app on http://127.0.0.1:8000
python3 run.py sim            # one exhibition game, play-by-play to stdout
python3 run.py season         # sim the whole schedule, print standings
python3 -m unittest discover -s tests    # 107 tests
```

In the browser: the left column is the schedule, click any game to open the
tracker. Use **+15 min** / **Skip to next tip-off** to push the league clock
forward, and **Tracker speed** to control how fast the play-by-play reveals
(1× is real time, 20× plays a game out in about two and a half minutes).

## Ratings

Every player carries **81 visible attributes** and **14 hidden ones**, on a
**1–20 scale** — Football Manager style, not 0–100:

| | | | |
|---|---|---|---|
| **20** Generational | **14–15** High-end starter | **10–11** Rotation player | **4–5** G League |
| **18–19** Elite NBA | **12–13** Average starter | **8–9** Bench player | **1–3** Amateur |
| **16–17** All-Star | | **6–7** Fringe NBA | |

Twenty steps rather than a hundred because a point has to *mean* something.
14 → 15 is a real upgrade; players come out spiky instead of clustered in the
80s; and a scouting report reads as strengths and weaknesses rather than noise.
`tier_label()` maps any value to the table above, and `to_display()` will render
on 0–100 if an audience expects it — storage is always 1–20.

Values are stored as floats and clamped, not rounded. The UI rounds; the
fractional headroom is what a development system needs to move a player from 14
to 15 across a season rather than in one jump. Chemistry stays on its own
0–100 axis, because it measures a relationship rather than an ability.

Visible attributes live in `Ratings`, grouped
for display into Shooting, Playmaking, Finishing, Defense, Rebounding,
Athleticism, Basketball IQ, Intangibles, Mental, and Guard/Wing/Big skills.
Hidden attributes live in `HiddenAttributes` — injury proneness, consistency,
big-game performance, development rate, and the personality set. Potential
Ability is *not* among them: it sits on the 0–200 CA scale described below,
because CA is the budget these attributes are generated from rather than another
attribute.

Three things are worth knowing about how the list was resolved:

- **Two attributes appear under two headings.** `decision_making` shows under
  Playmaking and Basketball IQ; `defensive_rebounding` under Defense and
  Rebounding. Each is one stored value — group membership is presentation.
- **Four names appeared in both the visible and hidden lists** — consistency,
  adaptability, professionalism and loyalty. All four are hidden, matching FM,
  where they're exactly the attributes you have to scout for.
- **Personality is derived, not stored.** A raw "Personality: 63" carries no
  meaning, so `personality_label()` computes an FM-style label (Model
  Professional, Volatile, Born Leader…) from the hidden personality attributes.

Position-specific skills are stored for *every* player, not just that position.
A centre with real Isolation is a matchup problem, and the engine would rather
know about it than treat the attribute as absent.

## Star ratings and player identity

A player's headline number is a **0.5–5 star rating**, not a raw overall. The
ten CA tiers map exactly onto the ten half-star steps, so the star rating *is*
the tier table rendered — 5 stars is generational, 4 an All-Star, 3 an average
starter, 1 a G-League player. `potential_stars` shows the same thing for PA, and
can never sit below a player's current stars.

Every player also carries a biography, in `bballsim/biography.py`: age, height,
weight, position, nationality, the college or club he came from, and his draft
class. Two consistency rules are enforced there rather than left to callers:

- **Draft class follows age.** The draft year is
  `season − (age − the age he entered the league)`, and the entry age depends on
  his route in: a four-year college senior arrives at 22, a one-and-done at 19,
  an international at 19–22. A 30-year-old is therefore never in last year's
  class, and a test asserts every player's age-at-draft lands between 18 and 23.
- **Draft position follows potential, not current ability.** Teams draft the
  player they think they are getting, which is what makes a bust possible: a
  first-round pick whose CA never caught up with the PA he was taken on.

Each team's roster is five starters — one per position — plus a seven-man
bench, and the CA ladder is dealt to a **shuffled** set of positions. So a
franchise player is as likely to be a centre as a point guard, while the
starting five still covers PG through C. (The ladder used to be zipped against
a fixed position order, which quietly made the best player on every team a PG.)
About a fifth of teams get a genuine superstar on top of that, which is what
puts anyone in the Elite and Generational tiers.

Nationality is weighted to look like an NBA roster — around 70% American with a
long tail of basketball nations — and background follows from it: Americans come
mostly through college with a small prep/G-League route, internationals split
between a home club and a US college.

## Lineups

Five players is not five *any* players. `bballsim/lineup.py` defines the shape
of a modern NBA five and both `Team.starters()` and the substitution logic
respect it:

| | |
|---|---|
| At most 2 at any one position | never three point guards, never five centres |
| 1–3 guards | somebody has to bring it up |
| 1–3 bigs | somebody has to protect the rim |
| At most 2 centres, 3+ distinct positions | |

Everything the league actually plays stays legal — two-big lineups, small-ball
with a single big, three-guard looks. What it rules out is the shape that only
appears when a sim picks purely on ability. Across a generated league the
starting fives come out 2-1-2, 1-2-2, 2-0-3, 1-1-3, 2-2-1, 3-1-1 and 3-0-2.

`starters()` brute-forces the strongest legal five rather than taking the top
five of the depth chart — greedy selection can paint itself into an illegal
corner by taking the best player first. It searches the top ten and widens to
the whole roster if no legal five exists up there, which is what happens when a
team's ten best players are all bigs.

Substitutions are checked the same way, against the *running* lineup rather
than the one the possession started with — three individually legal swaps could
otherwise combine into four guards. When no legal replacement exists the
substitution is simply declined: a tired centre stays on rather than being
swapped for a fourth guard.

## Stats

`bballsim/league/stats.py` accumulates season totals as each game finalises,
and derives per-game rates on read. Both tables are exposed by the API
(`/api/stats/players`, `/api/stats/teams`) and rendered in the demo's Stats tab:
pick a stat tab to sort by it, or click any column header; click again to
reverse. Percentages are true rates (makes over attempts), not averages of
per-game percentages.

## Current and Potential Ability

Underneath the visible attributes sit two hidden numbers on a **0–200 scale**:

| | |
|---|---|
| **CA** | what the player is now |
| **PA** | the ceiling he could realistically reach |

**CA is a budget, not a label.** It is defined as a position-weighted sum of
the visible attributes, so a player cannot be handed a high CA and poor
attributes — they are the same fact at two resolutions. Generation runs the
relationship backwards: pick a CA, an archetype and an age, then *solve* for the
attribute set that spends exactly that budget. The solver bisects on a level
offset until `current_ability()` returns the target, which is why the stored CA
and the recomputed CA agree to within 0.005 across every generated player.

That is what makes **two players with the same CA play differently**. At CA 150
a Defensive Anchor and a Stretch Big are equally good; the archetype decides
*where* the budget goes, so one has rim protection 18 and three-point 6 and the
other has it the other way round. Twelve archetypes ship, gated by position —
Floor General, Scoring Guard, Three-and-D, Slasher, Shot Creator, Point Forward,
Stretch Big, Rim Runner, Defensive Anchor, Post Scorer, Playmaking Big.

**Age redistributes the same budget.** A 20-year-old and a 34-year-old at
identical CA are not identical players: the young man carries his ability in
speed and quickness, the veteran in decision making and defensive IQ.

**Age also sets the size of the gap.** Headroom is
`years_to_ceiling × per_year + residue`, so it shrinks monotonically as age
rises — a 19-year-old averages ~35 points of room, a 27-year-old ~2.5, and past
that essentially none. Across a generated league the correlation between age and
CA/PA gap runs below −0.6, which is the point: two players with the same CA are
not the same asset if one is 20 and the other is 31.

### The hard rule

> **CA can never exceed PA.**

Enforced in `Ability.__post_init__` and `Ability.set_current()` rather than by
callers, so no path can break it — not construction, not a JSON round-trip, not
development. Four tests attack it from each of those directions, including
hammering a player with maximum development for 22 straight seasons.

Intangibles and Mental are deliberately **outside** the CA budget. Leadership
and temperament are character, not ability; excluding them stops an archetype
from buying CA with attributes that do not make a player better at basketball.

### Development and scouting

`develop()` advances one season. Growth is driven by headroom, an age curve, and
the hidden attributes that decide whether a player actually improves
(development rate, professionalism, work rate). Past 30 the age multiplier goes
negative and CA falls back regardless of PA — an ageing player's ceiling stops
mattering.

`scout()` returns a deliberately imprecise view: a CA range, a PA range and a
verdict ("Elite prospect", "Past his peak"). PA is always the wider bracket, and
wider still for a teenager — you can watch what a player is now, but his ceiling
is a guess.

### Composites: the layer between attributes and basketball

The engine never reads a raw attribute. `bballsim/composites.py` blends the 81
into the ~25 numbers a possession actually turns on:

```python
def shooting_rim(player):
    return blend(player.ratings, {
        "layups": 1.0, "close_shot": 0.9, "dunking": 0.6,
        "finishing_through_contact": 0.7, "euro_step": 0.4,
        "vertical_leap": 0.3, "balance": 0.3, "strength": 0.2,
    })
```

This matters for balance. With 81 attributes, no single one should swing a
game, and composites guarantee that: boosting four rim attributes moves the
composite ~80% of the way, not 100%. It also means tuning happens in exactly
two files — the baselines in `possession.py` and the blends here — instead of
scattered across the engine.

## How a game gets simulated

`GameSimulator.simulate()` runs the whole game in one pass and returns an
ordered list of `GameEvent`s, each stamped with the game clock and with
`game_seconds` since tip-off. One possession, in order:

1. **Clock** — possession length from pace tactics, scheme, and defensive
   pressure, with late-game urgency overriding everything (trailing teams rush,
   leading teams milk it).
2. **Turnover check** — the offense's `ball_security` against the defense's
   `steal_threat`, adjusted for pressure tactics, chemistry and fatigue. Steals
   are attributed to a specific defender.
3. **Non-shooting foul** — charged to a defender, and if the team is in the
   bonus it becomes two free throws.
4. **Shot selection** — a shooter is picked by usage tendency, `shot_creation`
   and current condition, then a zone (rim / paint / mid-range / corner three /
   above the break) from his tendencies, the offensive scheme, and how the
   defense is protecting the rim. A player's `shot_quality` composite then
   pulls his mix toward the zones he is actually good at — poor judgement
   leaves him taking shots he cannot make.
5. **Resolution** — make probability is the league baseline for that zone plus
   the shooter's zone composite against a blend of his primary defender, the
   team defense behind him, and the quality of the contest, plus chemistry,
   spacing, fatigue and clutch. Blocks, shooting fouls and and-ones branch out
   of here.
6. **Assist** — credited on makes, more often on threes, in motion offences,
   and with better chemistry.
7. **Rebound** — offensive rebound chance from the two lineups' glass
   composites (which fold in boxing out, positioning and timing) and crash
   tactics; an offensive board triggers a short-clock second-chance possession.

Two hidden attributes reach into the simulation directly. **Consistency** sets
how far a player's ratings drift on any given night — rolled once per game in
`set_form()`, so a metronome performs near his rating and an erratic one is a
coin flip. **Big-game performance** blends with the visible clutch composite
inside the last two minutes of a one-possession game, and is inert before
that.

Substitutions are checked after every possession (`engine/rotation.py`),
driven by a condition score that drains with floor time and recovers on the
bench, weighted by depth-chart rank so stars grind out ~36 minutes and the
rotation runs about nine deep.

Every game is seeded by its game id, so a game always replays identically.

### Calibration

Simulated across a placeholder league, per team-game:

Across the 30-team league, per team-game:

| | sim | NBA (recent) |
|---|---|---|
| Points | 109.7 | 114 |
| Possessions | 101.5 (84–119) | 99 (96–104) |
| FG% / 3P% / FT% | .435 / .354 / .761 | .472 / .366 / .783 |
| AST / TOV / REB | 26.1 / 14.5 / 54.3 | 26.5 / 13.5 / 53 |
| STL / BLK / PF | 9.5 / 5.1 / 17.9 | 7.5 / 5.0 / 19 |

Per-game averages by position land close too — rebounds run PG 3.4, SG 4.0,
SF 4.9, PF 7.8, C 8.8 against a real 3.5 / 3.8 / 5.0 / 6.8 / 9.0, and blocks
are near-exact. The stats page is what surfaced the one that was off: assists
were spread too evenly, so the assister weighting is now steep on playmaking
and the leaders are point guards at 9+ rather than a five-way split.
| OREB% | .264 | .235 |
| Score SD / mean margin | 14.6 / 15.8 | ~13 / ~11.5 |

The scale change from 0–99 to 1–20 moved almost none of these, because the
engine works in normalized units — `(rating − average) / average` — rather than
raw points. Only two constants were expressed in rating points and had to move
with the scale: the nightly form swing, and the placeholder generator.

Close enough to feel like basketball. Every constant that produces those
numbers is at the top of `bballsim/engine/possession.py`.

Pace is deliberately bounded. Scheme, slider and personnel all push tempo the
same way and used to compound without limit — a seven-seconds team with the
pace slider at 70 ran 129 possessions a game and put up 174 points. A single
clamp in `_possession_length` keeps the league's fastest team about 15% quicker
than its slowest, and the placeholder now draws each team's pace slider around
its scheme's own tempo instead of independently, so no coach doubles down.

One known gap: **games are more spread out than real ones** — mean margin 15.8
against a real 11.5, so blowouts show up more often than they should. That is
what you get when every possession is an independent coin flip. Real games
correlate: pace is shared, leads change how both teams play, garbage time pulls
scores together. The hook for fixing it is `_apply_endgame_urgency` in
`possession.py`, which is currently the only place score margin feeds back into
behaviour.

## Watching a game live

The trick is that a game is simulated the instant its tip-off time passes, but
the play-by-play is *revealed* progressively against the wall clock:

```
League.tick()  -> tipoff passed?  simulate in full, mark LIVE, anchor the
                  tracker clock to tip-off
League.feed()  -> return only events whose game_seconds <= elapsed × speed
```

So "watching live" and "watching a replay" are the same code path, the sim
stays deterministic, and opening a game an hour after tip-off correctly shows
it already finished. The frontend just polls `/api/games/<id>/feed?since=<n>`
with a cursor and appends whatever comes back.

## Layout

```
bballsim/
  ability.py       CA/PA on 0-200, star ratings, archetypes, the CA solver,
                   development, scouting -- and the CA <= PA invariant
  lineup.py        what a legal modern five looks like, and how to pick one
  biography.py     age, height, weight, nationality, college/club, draft class
  ratings.py       81 visible + 14 hidden attributes, the 1-20 scale, tiers,
                   display labels, derived personality
  composites.py    attributes -> the ~25 numbers a possession reads
  tendencies       (in ratings.py) what a player wants to do vs. how good he is
  tactics.py       manager instructions: schemes and sliders, and their effects
  chemistry.py     team / pair / character / lineup-fit -> execution modifier
  models.py        Player, Team, Lineup, depth charts
  engine/
    possession.py  the core: one possession, start to finish
    game.py        periods, overtime, jump ball, box score assembly
    rotation.py    fatigue and substitutions
    events.py      play-by-play event types
    boxscore.py    stat accumulation
    rng.py         seeded, reproducible randomness
    state.py       rules config + mutable game state
  league/
    calendar.py    fixtures, tip-off times, game status
    stats.py       season totals -> per-game rates, for players and teams
    league.py      standings, the sim clock, tick(), the tracker feed
  api/server.py    stdlib HTTP: JSON API + static files
  placeholder.py   THROWAWAY teams and players — delete when real data lands
web/               the tracker UI (vanilla JS, no build step)
```

## API

| | |
|---|---|
| `GET /api/league` | league summary and current sim time |
| `GET /api/teams`, `/api/teams/<id>` | teams, roster with ratings |
| `GET /api/schedule?date=&team=` | fixtures |
| `GET /api/standings` | standings table |
| `GET /api/stats/players?min_games=n` | season per-game player stats |
| `GET /api/stats/teams` | season per-game team stats |
| `GET /api/games/<id>` | fixture + box score when final |
| `GET /api/games/<id>/feed?since=<n>` | play-by-play revealed so far |
| `POST /api/clock/advance` | `{"minutes": n}` or `{"days": n}` |
| `POST /api/clock/speed` | `{"speed": n}` game seconds per real second |
| `POST /api/clock/skip-to-next` | jump to the next tip-off |

## What is deliberately not here

Players and teams (yours to define), persistence — everything lives in memory
and a restart re-sims from scratch, injuries beyond the `Player.injured` flag,
player development, contracts, trades, the draft, playoffs, real scheduling
(back-to-backs, travel), and in-game manager input (timeouts, tactical changes
mid-game). The seams for those are all in place.
