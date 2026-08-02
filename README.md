# Basketball Manager — Simulation Shell

A skeleton for a Football-Manager-style basketball game. The point of this
commit is the **plumbing**, not the content: possessions are simulated one at a
time from player ratings, tactics and chemistry; games tip off on a schedule;
and you can open any game in a tracker and watch the play-by-play unfold.

There are no real teams or players — `bballsim/placeholder.py` invents anonymous
ones so the shell boots. Delete it when you load real data.

## Running it

No dependencies. Python 3.11+.

```bash
python3 run.py serve          # web app on http://127.0.0.1:8000
python3 run.py sim            # one exhibition game, play-by-play to stdout
python3 run.py season         # sim the whole schedule, print standings
python3 -m unittest discover -s tests    # 39 tests
```

In the browser: the left column is the schedule, click any game to open the
tracker. Use **+15 min** / **Skip to next tip-off** to push the league clock
forward, and **Tracker speed** to control how fast the play-by-play reveals
(1× is real time, 20× plays a game out in about two and a half minutes).

## Ratings

Every player carries **81 visible attributes** and **15 hidden ones**, on a 1–99
scale where 50 is league average. Visible attributes live in `Ratings`, grouped
for display into Shooting, Playmaking, Finishing, Defense, Rebounding,
Athleticism, Basketball IQ, Intangibles, Mental, and Guard/Wing/Big skills.
Hidden attributes live in `HiddenAttributes` — potential, injury proneness,
consistency, big-game performance, development rate, and the personality set.

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

| | sim | NBA (recent) |
|---|---|---|
| Points | 108.5 | 114 |
| Possessions | 100.8 | 99 |
| FG% / 3P% / FT% | .429 / .351 / .792 | .472 / .366 / .783 |
| AST / TOV / REB | 23.6 / 14.7 / 53.2 | 26.5 / 13.5 / 53 |
| STL / BLK / PF | 9.1 / 5.1 / 18.6 | 7.5 / 5.0 / 19 |
| OREB% | .242 | .235 |
| Score SD / mean margin | 14.4 / 16.1 | ~13 / ~11.5 |

Close enough to feel like basketball. Every constant that produces those
numbers is at the top of `bballsim/engine/possession.py`.

One known gap: **games are more spread out than real ones** — mean margin 16.1
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
  ratings.py       81 visible + 15 hidden attributes, the 1-99 scale, groups,
                   display labels, derived personality, positional overall
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
