# Basketball Manager — Simulation Shell

A skeleton for a Football-Manager-style basketball game. The point of this
commit is the **plumbing**, not the content: possessions are simulated one at a
time from player ratings, tactics and chemistry; games tip off on a schedule;
and you can open any game in a tracker and watch the play-by-play unfold.

There are no real teams or players. `bballsim/placeholder.py` invented a
30-team league of 360 anonymous players and 30 coaches **once**; that league and
its fixture list now live in `data/` and are what everything plays with. Delete
them when you load real data.

## Running it

No dependencies. Python 3.11+.

```bash
python3 run.py serve          # web app on http://127.0.0.1:8000
python3 run.py sim            # one exhibition game, play-by-play to stdout
python3 run.py season         # sim the whole schedule, print standings
python3 -m unittest discover -s tests    # 401 tests
```

In the browser: six tabs — **Home** (the news wire), **Games** (today's slate
and the live tracker), **Stats**, **Standings** (by conference, plus power rankings), **Playoffs**
(the bracket) and **Teams** (squads, player profiles, head coaches).

**There are no clock controls.** The league runs on real time: a game tips off
at its real 8am, 1pm or 7pm Pacific slot and reveals its play-by-play at real
speed, so the fourth quarter happens when the fourth quarter happens. Nothing
is skippable, so the page refreshes itself once a minute to notice games
starting and finishing, and a live game polls its own play-by-play every three
seconds.

**Tracker speed is configuration, not season data.** A save records results,
not how fast somebody was watching them, so `apply_season` does not restore it.
That distinction is not academic: `save.py` kept defaulting the speed to the
old fast-forward 20x long after the league default became real time, and every
boot restored it off the disk — a live game revealed its 2,880 seconds in two
and a half minutes instead of forty-eight, and redeploying never fixed it
because the speed was coming from the save. `run.py --speed` and the clock API
still override it for a session.

Two things follow from real time, both of which needed handling:

- **Opening a live game joins it now**, not at tip-off. A playhead started from
  zero would sit however far into the game you arrived behind the live edge and
  never catch up.
- **Playback speed depends on what you are watching.** Live is real time. A
  *finished* game is a replay with nothing to stay in sync with, so it opens at
  30× — watching a completed game at real time means 48 minutes of nothing. The
  transport overrides either.

### One interface, two places to run it

`ui/` is the whole front end, and it runs unchanged in two places: the live app
serves it and backs it with the API, and `demo/build.py` inlines it into a
single published page with a season baked in. The only difference is where data
comes from — `ui/source-live.js` fetches, `ui/source-static.js` reads the
embedded payload — and both implement the same three calls. `bballsim/api/
payload.py` builds the shapes for both, so the demo and the app cannot drift
apart and a fix to one always reaches the other.

Weight is split by how the app is used. The bootstrap is **one day's**
fixtures, the standings and the stats (248 KB, ~35 KB gzipped); a squad — 12
players with 81 attributes each — is fetched per team, and a game's
play-by-play per game. Sending everything at once is about four megabytes of
data most visits never open.

### The schedule is today

The Games tab is **today's slate**, full width: a date heading, then one row
per fixture — the two clubs stacked with their records, a hairline, and the
tip-off time on the right, in the shape a sports schedule normally takes.
A row reads `FINAL`, `LIVE` or its tip-off time depending on where the game is,
and underneath sits the preview: who leads each side in points, assists and
rebounds per game. Opening a fixture swaps the tracker in over the list;
**All games** swaps back. One at a time — a day is 45 fixtures and a tracker is
a whole screen, so side by side neither fits.

Tip-off times are rendered in **Pacific**, not the viewer's zone: the slates are
*defined* as 8/1/7 Pacific, and showing "3:00 PM, 8:00 PM, 2:00 AM" to someone
on UTC describes the same moments and communicates nothing.

Two cases the preview has to handle:

- **Nothing played yet.** On opening day there are no averages, and three
  zeroes would be a lie. A team without games falls back to its best-rated
  player, labelled *Top rated* with a star rating — the payload marks it
  `basis: "rated"` so the front end never mistakes one for the other.
- **A finished season.** The published demo's clock sits past the end of its
  schedule, so "today" has no games. `focus_day` falls back to the last day
  that was played rather than showing an empty rail — which is also why the
  demo ships play-by-play for exactly the fixtures on the day it displays.

One thing the split had to get right: the engine simulates a game in full at
tip-off, so a live game's final score exists from the first second. Reporting
it would put the result in the schedule rail while the tracker was still in the
first quarter, so `game_summary` reports the score *as of the tracker clock*
for a live game. Three tests hold that line.

### Crests

Every club wears a **mark drawn from its nickname** — an I-beam for the
Ironworks, an anchor for the Anchors, antlers for the Stags, a paw for the
Coyotes. Thirty distinct glyphs, each on a two-colour disc.

They are geometric rather than illustrative on purpose: a crest is 34 pixels
across in a schedule row, where a detailed animal turns to mud and a bold
silhouette still reads. That is why real league marks simplify too.

The split is deliberate. `bballsim/logos.py` says which club wears which glyph
and in what colours; the SVG path data lives in `ui/app.js` next to the thing
that renders it. `tests/test_logos.py` reads both, so a club pointing at a
glyph that was renamed would fail a test rather than render a blank disc — and
it checks every mark clears **3:1 contrast** against its own disc, which is the
WCAG floor for a non-text graphic and the difference between a crest you can
identify at a glance and a smudge. That test was checked against a deliberately
bad pairing to make sure it bites.

Nothing here is saved with the roster: a crest is presentation, keyed by
abbreviation, and the save format stores no derived values.

## Hosting it

`DEPLOY.md` walks through putting this on Render with a custom domain. The
short version: `render.yaml` in the root is a blueprint Render reads directly,
and two properties of the app shape it — the league lives **in memory**, so it
runs as exactly one instance and must never autoscale; and it **writes as you
play**, so it needs a mounted disk (`BBALLSIM_DATA_DIR` points at it, and first
boot seeds it from the committed `data/`).

Being hosted put three things on the server that a laptop did not need:

- **A lock around the league.** The server is threaded and the `League` is
  shared mutable state; two requests ticking at once could finalise the same
  game twice and count it twice in the standings. `tests/test_server.py` hammers
  the clock from six threads and checks the books balance — and it does fail
  without the lock, which is the only reason it is worth having.
- **Autosave, and `SIGTERM`.** Saving only on Ctrl-C is fine at a terminal.
  A host stops a container by signalling it, so the app now handles `SIGTERM`
  (save, then exit) and checkpoints every two minutes while running — but only
  when games have actually been played, so an idle server writes nothing.
- **`/api/health`.** Answers without touching the league, so a health check
  still succeeds while a slow request holds the lock.

Note that `http.server` has no request timeouts or rate limiting, and there is
no authentication — anyone with the URL can advance the clock. Both are called
out in `DEPLOY.md`.

## The league is saved, not generated

Nothing is generated at boot. Two committed files hold it all:

| | |
|---|---|
| `data/league.json` | who is in the league — 30 teams, 360 players, 30 coaches |
| `data/season.json` | what has happened — the 1,230-fixture schedule, and results |

This is a stronger guarantee than seeding. A seeded generator is
*reproducible* — the same code gives the same league — but not *stable*: change
an archetype weight, adjust a CA target, add an attribute, and all 360 players
become different people. Fine while the generator is being built, useless the
moment you want to manage a club. So generation happened once and the file
became the truth:

```bash
python3 tools/make_league.py            # generate and write it (refuses to clobber)
python3 tools/make_league.py --show     # what is in the file now
python3 tools/make_league.py --force    # replace every player and coach
```

### The season calendar

**82 games each, three a day, on real days.** Tip-offs are 8am, 1pm and 7pm
**Pacific**; every team plays once per slate, so a three-slate day is three
games for everybody — 45 games a day across 30 teams.

82 does not divide by three, so the tail is **two days of two games** rather
than a day with a single game: 26 days of three plus 2 days of two = 28 days
and 1,230 games. `_pack_days` owns that rule and a test walks every round count
from 2 to 200 asserting no day is ever left with one game.

Two details the calendar has to get right, both tested:

- **Home and away split exactly 41/41.** Handing home to whoever has hosted
  less gets close but lands teams on 40–42, because the choice is local and the
  constraint is seasonal. A repair pass fixes it, and it needs to *walk*: when
  one team was on 42 and another on 40, no fixture existed between them, so the
  surplus is moved along a path of fixtures instead.
- **Daylight saving.** Tip-offs are stored as Pacific wall-clock times and
  converted to UTC, not as a fixed offset — Pacific is UTC-7 half the year and
  UTC-8 the other half, and a hard-coded offset would move every game by an
  hour on 1 November. `zoneinfo` is standard library, so this costs no
  dependency.

The sim clock runs at **real time with no offset**: a game tips off when its
actual 8am/1pm/7pm Pacific slot arrives.

### The fixture list is saved too

The same argument as the roster applies here, and one detail made it sharper:
**a fixture's id is its simulation seed.** The schedule used to be rebuilt from
`uuid4()` on every boot, so the fixtures looked identical and every game inside
them was a different game. Ids are now derived from who is playing and when, so
a saved season points at the games it was saved with.

```bash
python3 tools/make_season.py            # build the fixture list (refuses to clobber)
python3 tools/make_season.py --show     # fixtures, results, sim date
python3 tools/make_season.py --force    # rebuild, discarding every result
python3 tools/make_season.py --start 2026-09-01   # pick opening day
```

Opening day defaults to **tomorrow** in Pacific, so a freshly built season has
nothing played. Because the clock is real time, a season built a week before
you deploy will play its first week's games on the first boot — that is what a
real-time calendar means. `--force --start <date>` re-anchors it.

`run.py serve` loads it and writes results back as they are played and on the
way out. Play some games, quit, restart, and the table is where you left it.
Pass `--no-save` to leave the file alone.

**A deploy replaces a season built on a superseded calendar.** Not overwriting
a live save is the right default, and it was wrong the first time the calendar
changed: the disk kept an 870-game season while the app had been rebuilt around
1,230 fixtures, so the deployed page went on showing games and standings that no
longer corresponded to anything. Results are keyed by fixture id, so a save from
a different calendar is not a season in progress — it is a season of a different
competition. Each season file now carries a `schedule` fingerprint of its
fixture ids; when it differs from the committed one the save is replaced, and
when it matches it is left alone. `BBALLSIM_RESET_SEASON=1` forces a wipe by
hand. The roster is never replaced either way — development and chemistry live
there and have no calendar.

What the season file stores is deliberately narrow:

- **Stored** — the fixture list, and for each finished game its final score,
  line score and full box score.
- **Derived** — the standings and season stats. `League.restore_schedule` folds
  them back out of the results on load, through the same `_record` the live
  path uses, so a restored table can't disagree with the games behind it.
  Chemistry drift is deliberately *not* in `_record`: it already happened, and
  its result is saved with the roster.
- **Dropped** — the play-by-play. A season is ~330,000 events and about 90 MB of
  JSON, which is not something to write on every save. A game restored from
  disk keeps its box score and its result but not its commentary, and the
  tracker feed reports `play_by_play_available: false` rather than an empty
  0–0 feed.
- **Dropped** — pair minutes, which exist only to drift chemistry when a game
  finalises.

A game that was mid-flight when you quit comes back as scheduled rather than
half-played: nothing depends on a game in progress, and the next tick re-tips
it — to the same game, since the seed is the fixture id.

`bballsim/save.py` owns the format, and deliberately does **not** reuse the
`to_dict()` methods elsewhere in the package — those are display views for the
API and the demo page, which round values, add derived fields and cannot be
read back. A save carries every *stored* value and nothing computed: stars,
tiers, personality labels and `current_ability` are all left out and recomputed
on load, so a saved league can never drift out of step with its own derived
numbers. Floats are rounded once on the way out (four decimal places, far below
anything the engine acts on), after which reading the file and writing it back
is byte-identical — a diff on `league.json` always means something really moved.

`bballsim/roster.py` is the one place anything asks for teams, so the server,
the demo exporter and the CLI cannot disagree about who is in the league — the
demo page is built from the same two files, so its fixtures and its 360 players
are the app's. If either file is missing, a temporary one is generated and said
so loudly on stderr, because that is a *different* league.

`tests/test_save.py` pins this down. The round-trip test walks the dataclass
fields rather than naming attributes by hand, so adding an attribute to
`Ratings` without teaching `save.py` about it fails a test instead of quietly
resetting that attribute to its default for all 360 players. And the committed
league's fingerprint is asserted against a constant — if someone regenerates
it, the test says so.

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

### Reading 81 attributes

Eighty-one numbers is a reference table, not a summary, so the squad page
leads with **a star rating per group** — Shooting ★★★★, Playmaking ★★★½ — and
each group expands to the attributes behind it. Sections are collapsed by
default, remember what you opened as you click down the roster, and are built
on `<details>`/`<summary>`, so keyboard, screen readers and find-in-page work
without any help from us.

The group value is a plain **average of the attributes listed underneath**, put
through the same tier-to-stars mapping as everything else — `stars_from_rating`
against `RATING_TIERS`, which has the same ten tiers with the same labels as the
CA table, so four stars means All-Star either way. Deliberately *not* the
engine's composite weighting: a composite answers "how well does he finish at
the rim", which is a different question from "what is his Shooting section
worth", and a heading whose number disagreed with the rows under it would be
worse than no heading. A test asserts the two agree.

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

## Coaches

Every team has a head coach — thirty of them, one each, in
`bballsim/coach.py`. Seven ratings on a **0–100 scale**, each with a job in the
simulation:

| Rating | What it does |
|---|---|
| **Offense** | what his team shoots, and how much the ball moves (assist rate) |
| **Defense** | what the opposition shoots, and the defensive glass |
| **Tactics** | turnovers, and how fully a scheme's effect table actually lands |
| **Player Development** | how fast CA climbs toward PA (`ability.develop`) |
| **Leadership** | how quickly a locker room gels (chemistry drift) |
| **Scouting Eye** | how accurate the club's read on potential is (`ability.scout`) |
| **Overall Reputation** | standing, not skill — see below |

A Spoelstra-shaped coach reads Reputation 99, Offense 95, Defense 99,
Development 92, Tactics 99, Leadership 98, Scouting Eye 88 — "All-time great",
specialism *Defensive specialist*.

**Reputation is not ability.** It is what the league thinks of a coach, which
correlates with how good he is but lags it: a coach can be overrated on the
back of one good roster, or underrated after a rebuild. It is *drawn from* the
six visible skills with noise rather than computed from them — weighted toward
the things outsiders can see (offense, defense, tactics) and lagging the ones
they cannot (development, scouting). So the best-regarded half of the league is
genuinely better than the rest, but somebody in it is always misjudged, and
hiring on reputation alone is a mistake you can make.

Generation gives each coach a *leaning* rather than a flat quality level —
offensive, defensive, tactician, developer, motivator, evaluator or balanced —
which spends ability in one area at the cost of another. Quality itself skews
low, so elite head coaches are scarce.

Coaches are worth about what the research says they are. Across a controlled
paired test — identical rosters, identical seeds, only the coach differs — the
best and worst head coaches in a generated league are **about five points a
game** apart. Big enough to weigh when hiring; not enough to carry a bad
roster. Every rating is read somewhere, and `tests/test_coach.py` asserts each
channel separately: offense lifts assists and scoring, defense lowers what the
opposition scores, tactics cuts turnovers, and the three off-court ratings are
tested where they do their work rather than in a box score. A team with no
coach at all simulates identically to one with an average coach — `None` is
neutral, not a penalty.

## Stats

`bballsim/league/stats.py` accumulates season totals as each game finalises,
and derives per-game rates on read. Both tables are exposed by the API
(`/api/stats/players`, `/api/stats/teams`) and rendered in the demo's Stats tab:
pick a stat tab to sort by it, or click any column header; click again to
reverse. Percentages are true rates (makes over attempts), not averages of
per-game percentages.

### Advanced stats

A third scope on the Stats page, alongside Players and Teams: PER, ORB%, DRB%,
TRB%, AST%, STL%, BLK%, TOV%, USG%, ORtg, DRtg, OWS, DWS, WS, WS/48, BPM,
OBPM, DBPM and VORP. All derived on read in `bballsim/league/advanced.py` —
nothing new is stored, saved or simulated.

They are **not equally solid**, and the module says which is which:

- **Rate stats** are Basketball-Reference's definitions implemented exactly.
  A rebound percentage is a share of the boards that were *available*, which
  is why the season line now tracks opponent totals: the other side's misses
  are what made them available.
- **Ratings and win shares** are Dean Oliver's, as published.
- **BPM and VORP** are a transparent member of that family rather than a claim
  to reproduce Basketball-Reference's regression, whose fitted coefficients
  this project has no way to verify — and inventing plausible ones is the sort
  of thing the rest of this codebase refuses to do. Production per 100
  possessions against league average, weighted by usage, then **adjusted so a
  team's minute-weighted BPM equals its actual point differential per 100**.
  That last step is what makes BPM mean anything, and it is done properly.

Two anchors do the real work. Individual ORtg and DRtg are estimates built on
a chain of assumptions; what a *team* scored per 100 possessions is not. Each
squad is scaled so its minute-weighted ratings equal its real ones, which keeps
every player's standing against his team-mates while making the column mean
something league-wide — without it the league averaged an offensive rating of
122, which no league does.

`tests/test_advanced.py` checks the identities (WS = OWS + DWS, a squad's
minute-weighted usage comes to 100, PER averages exactly 15) and then the
ranges, because the failure mode for a long formula is not a crash — it is a
number that looks like a statistic and is off by a factor of five. Three were:
defensive win shares peaked at **23.7** against a real record near 5, win
shares at **42** against 20, and VORP at **2.1** against about 10. The first
two were the wrong minutes denominator; the third was that VORP and DWS
genuinely use *different* ones — a starter is 16% of his team's floor time but
63% of one position's.

Over a full season the table now peaks at PER 33.8, WS 20.3, WS/48 .33,
BPM 11.8 and VORP 10.5, against real bests of about 32, 20, .34, 13 and 10.
The one column still short of life is DRtg, which spans 107–118 where a real
league runs 95–120: it is anchored hard to team defence, so individual
defenders separate less than they should.

## The newsroom

The Home tab is a news wire: a triple-double, a streak, a milestone, the
night's headline game. A season is 1,230 fixtures, so none of it can be written
by hand, which raises the only question worth asking about generated sports
writing — **where did that number come from?**

Every figure in every sentence is read off a box score, a standings row or a
season line. Nothing is estimated, rounded up for effect, or filled in because
the sentence wanted a number. That is enforced rather than promised: prose is
assembled through a `Copy` object that records each number as it formats it,
and `tests/test_news.py` pulls every numeral back out of the finished article
and fails on any figure that was never recorded. A story cannot carry a
statistic the data did not supply.

The same rule decides what is *missing*. A manager game's feed wants injury
reports, trades, firings and a playoff race, and this league has none of those
— nothing in the simulation injures a player, moves one between clubs, or plays
a postseason. Those categories are absent rather than invented. Ten that are
real:

| | anchor | reads |
|---|---|---|
| Triple Double | 90 | box scores |
| Season High | 85 | every prior game by that player |
| Hot Streak | 80 | results in order |
| Milestone | 75 | season totals crossing a round number, on the night they cross |
| MVP Race | 72 | scoring leaders against the standings |
| Big Individual Game | 70 | box scores |
| Rookie Watch | 65 | draft class, which the biography layer already tracks |
| Game Recap | 60 | the scoreboard, quarter by quarter |
| Coaching | 55 | the best record, and who is on that bench |
| League News | 45 | the whole slate in aggregate |

It is called Season High, not career high, because one season is all the data
there is; a career high would be a claim about games that do not exist.

**Ranking alone makes a log, not a front page.** Individual performances score
highest by construction, and a 45-game slate produces enough of them to fill
twelve slots six times over — the first version of this page was six
triple-doubles and nothing else. Three filters fix it: one angle per player
(the detectors overlap deliberately, so the best framing wins and the other two
are dropped), one story per game, and a ceiling per category. Four slots are
then held back for the stories that say where the *season* is rather than what
happened last night — the recap, the scoring race, the table and the slate —
which otherwise never reach the page at all.

Two bugs worth recording, because they are the two failure modes of this kind
of writing. A recap once read *"the winners took the glass 51-56"* on a night
the winners were out-rebounded: every number in it was real and the sentence
was still false, which no figures audit can see — there is now a test that
parses the claim back out and checks it against the count. And coach ratings
are stored as floats, so one story reported a coach *"rates 47.2168 for
offence"*. Both have tests.

Stories are deterministic, like everything else here: the same league state
writes the same feed, and which of several phrasings a story uses is drawn from
its own id, so an article does not rewrite itself between refreshes and two
similar games do not read alike.

### The squad page

The Teams tab is a **stats page**, not a ratings page: pick a club and a player
on the left, and read a per-game line on the right — headline averages, a
season split, and the whole roster as one table of GP/MIN/FG%/3P%/FT%/REB/AST/
BLK/STL/PF/TOV/PTS.

Tactics, the head coach's ratings and the 81-attribute grid are **not on this
screen**. All three are still in the payload and still read by the engine on
every possession; they are just not what a squad page is for. The question it
answers is who is on the roster and what they are doing, and that question has
a stats table for an answer.

## Power rankings

A second view under Standings, answering a different question. The standings
say who has won the most games since October; this says **who is playing the
best basketball right now**. A 46-36 club on a six-game run outranks a 50-32
club that has stopped winning, which is the entire point of having both.

Ten weighted components, the brief's own: overall record 20%, last ten 25%,
strength of schedule 10%, point differential 10%, efficiency 10%, quality wins
10%, health 5%, momentum 5%, chemistry 3%, coaching 2%. Every one is scored
0–100 on its own terms and the row carries all ten, so the page can show which
of them put a club where it is rather than just asserting a number.

**Nothing is stored.** A ranking is produced by replaying the schedule to a
given day — the same discipline as the standings and the bracket. History is
then the same function called with an earlier date, movement is today's rank
against yesterday's, and there is no archive to migrate or drift out of step
with the games.

Games are weighted by recency exactly as specified: yesterday counts fully,
each further day five points less, and nothing ever falls to zero because a
game in November still happened. Quality wins are credited against the top of
the table (recomputed in a first pass on record and margin alone, so the
definition does not depend on itself), with extra for winning on the road and
for coming from behind; bad losses are debited for losing at home to the
bottom eight, for being beaten by twenty, and for each game of a losing run.

Two things worth being straight about:

- **Health is inert in the shipped build.** `Player.injured` exists and nothing
  during a season ever sets it, so the component returns a flat 100 for every
  club and contributes a constant. It reads the real flags rather than a
  placeholder, so it starts working the day in-season injuries land — but right
  now it is a 5% weight doing nothing, and pretending otherwise would be
  inventing a number.
- **Tier floors are set from the distribution the formula produces**, not from
  round numbers. At round numbers every club landed in the middle two tiers and
  the bottom one was never used at all. Cut where the ratings actually fall, a
  full season splits about 2 / 3 / 6 / 8 / 8 / 3.

`tests/test_power.py` holds the claim directly: it searches a simulated season
for a club ranked above one with a better record and fails if it cannot find
one, which is the difference between this table and the one next to it.

## Conferences and the postseason

Thirty clubs, fifteen a side. The split follows the nicknames, which fall along
a clean line: forges, foundries, mines, ridges, timber and the animals that
live in it on one side; harbours, tides, gales, anchors and everything that
navigates by them on the other.

| | |
|---|---|
| **Ironridge** | inland, industrial, mountain, forest |
| **Tidewater** | coastal, maritime, weather, sky |

They meet in the **Keystone Finals** — the keystone being the stone at the top
of an arch that carries both halves and without which neither stands. The
winner lifts the **Keystone Trophy**.

Membership is *derived, not saved*: keyed by abbreviation in
`bballsim/conferences.py`, exactly the way crests are, so the frozen roster
never changes and a save written before conferences existed still loads. The
shipped `data/league.json` had a `conference` field already and it was a coin
flip — 17/13, with the Eastport Mariners in the West.

Eight from each conference, seeded on record: 1v8, 2v7, 3v6, 4v5, best of
seven, home court 2-2-1-1-1 to the higher seed, four rounds to a champion.

**The bracket is derived too.** `bballsim/league/playoffs.py` stores nothing —
every series is rebuilt from the fixtures on the schedule, the way standings
are rebuilt from results. A postseason therefore survives a save and reload
with **no change to the save format at all** (playoff games are `ScheduledGame`s
and `dump_game` already knew how to write one), and there is no second source
of truth to drift out of step.

Fixtures are created as they are earned. A best-of-seven does not know it needs
a game six until game five is played, and round two has no opponents until
round one ends, so `advance` runs on every tick and adds only what is now
knowable. Nothing is scheduled and then cancelled — the fixture list never
contains a game that will not be played.

Two things the postseason forced out into the open:

- **Playoff results were landing in the regular-season standings.** Seeding is
  read off those standings, so the bracket moved under its own feet: a club
  that won two rounds climbed the table, its seed changed, and a semi-final it
  had already played got relabelled. An 82-game season was producing records
  like 56-53. Standings and season stats are now the regular season only.
- **The engine had no home-court advantage at all.** That is a hole anywhere
  and a fatal one in a bracket: 2-2-1-1-1 hands the higher seed the extra home
  game as its entire reward for a better record, and if home is worth nothing
  then a 1 seed is a coin flip against an 8. Home sides now win **56.5%** at
  **+2.8** points a game, measured paired — same matchup played both ways —
  against the real +2.5 and 58%.

**Known gap, measured rather than guessed.** Over four simulated postseasons
(60 series) the higher seed wins **53%**, against roughly 72% in the real
league, and **33%** of series go seven against about 20%. That is not the
bracket — it traces to the single-game variance already documented in
Calibration (mean margin 15.6 against a real 11.5). Closing it means a broad
recalibration of scoring variance that would move every other number on this
page, so it is recorded here rather than papered over.

## Player progression

`bballsim/progression.py` runs a career one offseason at a time; the full
design is in **[docs/PROGRESSION.md](docs/PROGRESSION.md)**, and
`python3 tools/careers.py --attributes` prints three careers from 18 to
retirement.

The decision everything else follows from: **attributes move, and CA follows.**
The engine never writes CA — it computes a delta for each of 81 attributes,
applies them, and reprices CA from the result. So the hard rule is enforced
against the attribute set rather than a number kept beside it, a veteran's flat
CA becomes a real event (a point of speed lost, a point of decision-making
gained, priced the same), and a centre and a guard losing the same vertical leap
lose different amounts of CA for free.

No age is hardcoded. Every threshold sits in years either side of two
per-player numbers — an athletic peak and a prime age — both generated from
what the player's game is built on, so an explosive guard peaks early and a
high-IQ shooter peaks late and lasts. Eight career arcs, nine injuries with
permanent effects, and a personality term that decides how much of a ceiling
gets collected: two 18-year-olds at CA 95 with PA 185 finish at 181 and 158.

Two bugs worth recording, both found by tests rather than by eye. Athletic
decline was a flat subtraction, which walked a 40-year-old's speed to 1 out of
20 — losses are now a share of what is left, so the curve flattens as it falls.
And the personality ceiling was `PA × realisation`, which reaches backwards: an
established player at CA 158 was handed a ceiling of 146, his growth pinned at
zero, and *a poor coach started producing better players than an elite one*
because neither was producing any development to compare. Character now closes
a share of the remaining gap instead.

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
   About one carom in seven is a **team rebound** and goes on nobody's line —
   the ball out of bounds off a defender's fingertips, the deadball after the
   first of two free throws, the tip nobody controls at the buzzer. It still
   decides who gets the ball; it just does not decide who gets the credit, and
   an offensive one is a sideline inbound rather than a tip-in.

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

Every game is seeded by its game id, so a game always replays identically —
including in a fresh process. That last part is not free: Python salts string
hashing per run, so `hash("game-3")` differs every time the program starts, and
so does iteration order over any set of strings. Both had leaked into the sim —
`SimRandom` seeded off `hash()`, and the placeholder drew character attributes
while iterating a `frozenset` — which meant the same seed produced a different
game tomorrow. `rng.seed_from_string` now uses a digest, the attribute list is
an ordered tuple, and `tests/test_engine.py` shells out with three different
`PYTHONHASHSEED` values to prove a seed survives a restart.

### Calibration

Across the full 30-team season (1,230 games), per team-game:

| | sim | NBA (recent) |
|---|---|---|
| Points | 107.9 | 114 |
| Possessions | 98.1 (92–107) | 99 (96–104) |
| FG% / 3P% / FT% | .441 / .363 / .772 | .472 / .366 / .783 |
| AST / TOV / REB | 25.8 / 15.2 / 44.0 | 26.5 / 13.5 / 43.5 |
| STL / BLK / PF | 9.6 / 4.9 / 19.3 | 7.5 / 5.0 / 19 |
| OREB% | .268 | .235 |
| Score SD / mean margin | 14.5 / 15.6 | ~13 / ~11.5 |

Rebounds are the one line that moved for a reason other than tuning. The sim
had been at 51 a side, and the number it was being checked against — 53 — was
the wrong one: 53 is roughly how many loose balls a game produces, but only
about 43.5 of them go on a player's line. The rest are team rebounds. Crediting
every carom to somebody inflated individual totals by around an eighth, which
does not sound like much until you count the consequence: **33 players were
averaging ten rebounds a game**, against fourteen or so in a real season. Team
rebounds brought that to 18. OREB% did not move at all — the same share of
loose balls still goes to the offence, they just do not all land on a name.
Scoring gave up half a point, which is the honest cost of an offensive team
rebound being a sideline inbound instead of a tip-in from under the rim.

Positions separate the way they should. Among rotation players (24+ minutes a
game), rebounds run PG 3.3, SG 5.4, SF 5.6, PF 8.8, C 8.6 and blocks PG 0.24
through C 1.14. The guard/big split is right; what is still missing is any gap
between the two bigs, where a real league has centres a couple of rebounds
clear of power forwards. That one is not the engine's to fix — on the shipped
roster a power forward's rebounding attributes are already a shade better than
a centre's, and the engine reads attributes, not floor position.

The stats page is what surfaced the assist bug: assists were spread too evenly,
so the assister weighting is now steep on playmaking and the leaders are lead
guards at 7–8 rather than a five-way split.

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

One known gap: **games are more spread out than real ones** — mean margin 15.7
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
  coach.py         head coaches: seven ratings, and where each one is read
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
    rng.py         seeded randomness, reproducible across processes
    state.py       rules config + mutable game state
  league/
    calendar.py    fixtures, tip-off times, game status
    stats.py       season totals -> per-game rates, for players and teams
    league.py      standings, the sim clock, tick(), the tracker feed
  api/server.py    stdlib HTTP: JSON API + static files
  api/payload.py   the shapes the front end reads, shared by API and demo
  save.py          the file formats: stored values only, nothing derived
  roster.py        the one place anything asks for teams
  placeholder.py   THROWAWAY generator — ran once to build data/league.json
ui/                the whole front end (vanilla JS, no build step)
  index.html       markup; styles.css; app.js
  source-live.js   data from the API        (the running app)
  source-static.js data from a baked payload (the published demo)
data/league.json   who is in the league: 30 teams, 360 players, 30 coaches
data/season.json   what has happened: 870 fixtures, and results
tools/make_league.py, tools/make_season.py   built them (one-off)
render.yaml        hosting blueprint — see DEPLOY.md
```

## API

| | |
|---|---|
| `GET /api/health` | liveness, for a platform health check |
| `GET /api/league` | league summary and current sim time |
| `GET /api/teams`, `/api/teams/<id>` | teams, roster with ratings |
| `GET /api/schedule?date=&team=` | fixtures |
| `GET /api/standings` | standings table |
| `GET /api/bootstrap` | everything a first paint needs, news feed included |
| `GET /api/stats/players?min_games=n` | season per-game player stats |
| `GET /api/stats/teams` | season per-game team stats |
| `GET /api/games/<id>` | fixture + box score when final |
| `GET /api/games/<id>/feed?since=<n>` | play-by-play revealed so far |
| `POST /api/clock/advance` | `{"minutes": n}` or `{"days": n}` |
| `POST /api/clock/speed` | `{"speed": n}` game seconds per real second |
| `POST /api/clock/skip-to-next` | jump to the next tip-off |

## What is deliberately not here

Real players and teams (yours to define), injuries beyond the `Player.injured`
flag, contracts, trades, the draft, playoffs, real scheduling (back-to-backs,
travel), and in-game manager input (timeouts, tactical changes mid-game). The
seams for those are all in place.

Persistence covers the roster, the schedule and results; standings and season
stats rebuild from those. The one thing it does not keep is **play-by-play** —
a finished game restored from disk has its box score but not its commentary,
for the size reason described above. Storing it would mean a separate per-game
file rather than one season file.
