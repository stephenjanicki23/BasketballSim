# The coach page

Under **Teams**, a fourth tab beside Player, Injuries and Expected Free Agents.
It shows a coach's record, his style and how the seasons have gone under him —
and it reads **none of his ratings**.

---

## 1. A record, not a rating sheet

A coach carries seven hidden ratings — offense, defense, tactics, development,
leadership, talent evaluation, player management. `coach.py` uses them to decide
how he *influences* a game. This page uses **none of them**. It reports what
actually happened across the seasons he coached, which is a more honest thing to
put in front of a reader than the simulation's private verdict on him.

> A rating is what the engine thinks of a man. A record is his career.

`tests/test_coaching.py` reads the module's own source and asserts the words
`.ratings`, `.offense`, `.tactics` and the rest never appear as attribute
access. The surest way to keep a rating off the page is that the code cannot
name one.

---

## 2. Everything is derived, nothing is stored

His championships are counted from the archives every time they are asked for,
his style is measured from how his teams played, his trajectory is the slope of
his own results — the same discipline the standings, the record book and the
scouting cards follow.

### Why a club's whole history is his

The page credits every season the club has recorded to its current coach. That
is honest **because a coach does not move.** He is assigned once, in
`placeholder.py`, and nothing in the simulation ever reassigns him — coach
negotiations re-sign the same man to the same club, and no code hires across
teams. So every archived season the club played, it played under him.

This is an assumption, and `TestTheAttributionAssumption` is its tripwire: it
rolls a season and checks no coach changed clubs. If coaches ever start moving,
that test fails and points here, and this module then needs a per-season
coach→club map before the credit can be trusted.

---

## 3. The record comes from the archives

`league.history` keeps each finished season's final table, its champion, and its
two conference winners. From that:

| shown | derived from |
|---|---|
| W–L each season | the archived team line |
| conference finish | rank within its own fifteen |
| made the playoffs | top eight in the conference — the same `playoffs.SEEDS` the bracket uses |
| how far it went | the champion and conference-winner fields |

Only **four finishes** are distinguishable from what is stored: *Champions*
(won it), *Finals* (lost the last series, or won a conference and so played in
it), *Playoffs* (made the bracket), *Missed*. The rounds in between are not
archived — `SeasonArchive` keeps the champion and the finalists, not the
semi-final board — and inventing "lost in the second round" from data that does
not exist is exactly the fiction the rest of the project refuses.

The season in progress is read from the live standings, so the page is current
the day you open it, and reads *In progress* until the Finals are decided.

---

## 4. The style comes from the box score

Five axes, each a rate a box score produces and a coach shapes:

| axis | what it measures |
|---|---|
| pace | possessions per game |
| perimeter | three-point attempts as a share of shots |
| ball movement | assists per made field goal |
| defence | points allowed per 100 possessions (negated, so higher is better) |
| offensive glass | offensive rebounds per game |

None of these is a tendency and none is a rating — they are what the team *did*
on the floor, the only fingerprint a coach leaves that a reader can check
against the results.

Each season the club's rate on an axis is scored against **that season's
league**, because pace and shot profile drift league-wide from year to year and
a coach should be measured against the game as it was played around him. The
scores are then averaged over his tenure, so one fluke season does not define
him. Measured across a full league the axes are centred on zero with real
spread — a z-score, not an absolute level that would read as a rating in
disguise.

The bars grow out from a centre line: neither pole is "better", they are two
ways to play. Fast or deliberate, perimeter or inside, share it or iso, stingy
or leaky, crash the glass or get back.

---

## 5. Season by season

The heart of the page, and what the brief asked for: **how the years have gone
under him.** Newest first, each season with its record, its conference finish
and its result, from *Champions* down to *Missed*. It is the one view that shows
a coach improving a club, holding it steady, or letting it slip — which the
one-line trajectory summarises but the table lets you see.

---

## 6. Where it lives

| | |
|---|---|
| `bballsim/coaching.py` | the record, the style, the write-up |
| `bballsim/api/payload.py` | rides on `team_squad` as `coaching` |
| Teams → Coach | the page |
| `tests/test_coaching.py` | 12 tests |

### Two bugs fixed on the way

* A strongly negative axis picked the *positive* phrase, because the magnitude
  check came before the sign — a leaky defence read "stingy". The pole is the
  sign now; magnitude only decides whether a trait is worth naming.
* Win % showed a dash on every row. `games` is a Python property that never
  reaches the JSON, so `row.games` was undefined in the browser; the count is
  taken from wins plus losses instead.
