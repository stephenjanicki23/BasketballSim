# The All-Star Game

A vote, two conference sides, and one exhibition. Three separable things, and
the separation is the point of the design.

---

## 1. The vote is derived. The roster is not.

Until tip-off there is **no roster** — only a running count, recomputed from
the season as it stands every time the page is opened. A player who scores
thirty on Tuesday is higher on Wednesday morning. That is what makes it a race
rather than an announcement, and it is the same discipline the standings, the
MVP race and the trade block follow.

At tip-off the roster is **written down**, and that is not a lapse. Voting
closes on one moment's reading of a mid-season table. Six weeks later the
totals have moved and the identical code would name a different twelve — so
re-deriving it would silently rewrite who was ever an All-Star, every time the
page was opened. The rule this project follows has never been "never store". It
is **never store what can be derived**, and a closed vote cannot be reopened.

`data/allstar.json` is the third file in the repository written for that
reason, after `data/records.json` and `data/history.json`. It is keyed by
season and never pruned, because the accolade is a career one: a league that
kept only the current year could say a player is an All-Star but never that he
is a six-time one.

---

## 2. There are no fans, so there is no fan vote

A real All-Star ballot is fans, players and media. Inventing a fan vote here
would mean inventing a fanbase, attendance and sentiment, none of which exist
in this simulation — `docs/TRADES.md` records the same absence for
marketability, and `docs/PROFILE.md` for postseason splits.

So what this counts is **performance**, weighted and stated on the page:

| Weight | What it reads |
|--------|---------------|
| 34% | Scoring — points per game, the thing a ballot rewards most |
| 22% | All-round — rebounds, assists, steals, blocks |
| 16% | Efficiency — true shooting; volume without it is not value |
| 16% | Impact — win shares and box plus/minus |
| 8% | Team — his club's record |
| 4% | Availability — games played |

Each column is scaled 0–1 across the conference's candidates before the weights
are applied, because raw points and raw win shares are not on the same scale
and adding them lets whichever is larger decide the vote.

A player needs to have been there for it: `MIN_GAMES_SHARE` is 30% of the games
his club has played, on the same argument the MVP panel and the record book's
rate qualifier both make.

The screen prints the table above rather than hiding the arithmetic behind the
word "votes". An award handed out by a formula nobody can see is not an award.

### The count is scaled off the leader, not the pool

The obvious thing was to normalise every candidate's score into a share of the
conference's vote. It was wrong, and only visibly wrong once it was on a
screen. Around 180 players qualify per conference and every one of them scores
something, so dividing by the sum gave the **leading vote-getter 1.5% of the
ballot and 88,000 votes out of six million**, with the whole field inside two
points of each other. Nothing about that reads like leading a vote.

The underlying scores are not flat at all — they run 0.99 down to 0.07. So the
board shows a rating out of 100 and scales the headline count against the
leader, who gets the six million.

---

## 3. The side has to be able to play

The vote on its own named an Ironridge twelve of **eight bigs and four shooting
guards, with no point guard on it**, and a Tidewater starting five of **three
power forwards**. Both are shapes `lineup.LineupRules` forbids anyone to field:
two per position, three distinct positions, at least one guard and one big.

This is not a flaw in the ballot. It is the ballot reporting an engine fact —
power forwards in this sim take the most minutes and lead everything else
(23.2 mpg and 11.0 points against a point guard's 19.7 and 8.7). The ballot is
right that they are the best players. It is just not, on its own, a team sheet.

Two numbers fix it, and only two:

* `MIN_PER_POSITION = 1` — the leading vote-getter at each of the five
  positions. The best centre in a conference is an All-Star even in a year the
  forwards are better, which is what a positional ballot is *for*.
* `MAX_PER_POSITION = 4` — so one position cannot eat the bench.

Between them, the vote decides.

The **starting five is then `lineup.choose_lineup` over those twelve** — the
same function `Team.starters` uses, with the vote as the strength signal.
Deferring to it rather than hard-coding "two guards and three frontcourt"
matters: a ballot that names a starting five the sim would refuse to field is
naming something other than a starting five.

---

## 4. The exhibition cannot touch the season

The game is **never a `ScheduledGame` and is never in `league.schedule`.**

That single fact is the entire mechanism. Standings, season totals, the record
book, chemistry and health are all folded in by `League._finalize`, which only
ever runs over the calendar — so none of them can reach a game that is not on
it. A sixty-point All-Star quarter must not become a league record and a
scoring title must not be settled by an exhibition, and neither is a rule
written down in six places. `tests/test_allstar.py` snapshots all six and
compares across a play.

Three things it *would* have leaked without help:

**Condition.** The twelve are the real `Player` objects, not copies — that is
the point, they are the men who were voted in. The engine sets condition at
tip-off and drains it all night, so without a save and restore, twenty-four men
walk into their next league game tired from a game that never happened.

**Three DNPs a side.** `rotation.ROTATION_DEPTH` is 9 and an All-Star roster is
12, so the league would have voted three men in and sat them. Depth is now a
field on `RotationManager`; every league game still leaves it at 9.

**Home advantage.** `possession.HOME_SHOOTING_EDGE` does not know the floor is
neutral. Which conference is nominally at home alternates by season, so a
half-percent edge is not handed to the same one every year.

The tactics are set to describe an occasion rather than a game plan — fast,
generous and barely defended — which is the only place in the project that
happens. A 96–91 All-Star Game would read as a bug.

---

## 5. What it is worth

Two badges on a player's page, both read from what was stored rather than
recomputed:

* **All-Star** — every season he was selected, with how many of them he
  started. Nobody carries it until tip-off: until then it is a projection, and
  the page says so.
* **All-Star Game MVP** — the best game score on the winning side.

`accolades.py` is otherwise entirely derived, and its docstring explains why
these two are the exception.

---

## 6. Where it lives

| | |
|---|---|
| `bballsim/allstar.py` | the vote, the selection, the exhibition |
| `bballsim/api/payload.py` | `allstar_view` — one shape for both stages |
| `GET /api/allstar` | not in the bootstrap: it changes on every request |
| `data/allstar.json` | the stored history, keyed by season |
| Stats → All-Star | the screen |
| `tests/test_allstar.py` | 30 tests |

### A note on the fixtures

This file's tests first shared one cached league, and the test that checks
condition is restored played the exhibition on it. Two later tests then failed
— a projected starter already carrying the badge, and a "voting is open" view
that came back played — and both looked like bugs in the code rather than in
the fixture. A cache handed to a test that mutates it is not a fixture; it is a
hidden dependency on test order. `played()` is now open-voting only, `fresh()`
is for tests that mutate, and `TestTheFixturesStaySeparate` guards the line.
