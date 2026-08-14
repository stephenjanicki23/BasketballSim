# The record book

Two halves that look identical on the page and are built in opposite ways.

---

## 1. One of these can be derived and one cannot

**Season records are derived.** Every finished season is archived with its
player and team *totals* (`offseason.SeasonArchive`), and the season in progress
is in `league.stats`. "Most points in a season" is therefore a question the
league can always answer by looking, so nothing stores an answer to it — same
discipline as the standings, the MVP race and the trade block.

**Single-game records have to be kept.** They are the one thing in this project
that genuinely cannot be recomputed. A box score lives on its `ScheduledGame`,
`offseason.reschedule` replaces the whole calendar every summer, and the archive
holds totals only. The night somebody scored 61 is *gone* the moment the season
rolls — not expensive to rebuild, impossible.

That is the same argument `save.HISTORY_PATH` makes for archiving season totals
at all, and the same one `health` makes for storing fatigue. The rule this
project actually follows has never been "never store". It is **never store what
can be derived**, and a game record cannot be.

`data/records.json` is the second file in the repository written for that
reason, and the header comment on `RECORDS_PATH` says which reason.

---

## 2. Idempotent rather than careful

Every mark carries the game id it came from, and offering the same game twice
**replaces rather than duplicates**.

This is not tidiness. A season restored from disk folds its saved results back
through `League._record`, and a book that counted a 61-point night again on
every boot would be worse than no book at all. Because `_offer` is keyed on
(game, holder) and the lists are max-sorted, re-observing is a no-op — which
means the hook can live wherever it is convenient and cannot be got wrong.

It also makes `backfill` safe: an existing save that predates the book, or one
whose `records.json` went missing, gets every finished game on its current
calendar offered at load. That cannot recover seasons whose calendars have
already been replaced — which is the whole reason the file exists — but it
means nobody opens the page to a blank slate.

---

## 3. The postseason counts

`League._record` excludes playoff games from the standings, and for a good
reason: seeding is read off the table, so folding postseason results back into
it makes the bracket move under its own feet.

None of that applies to a record book. A book that ignored the Finals would be
a strange book, so `observe` is called from `_finalize` — which sees every game
— and each mark records the round it came from so the screen can show it.

---

## 4. What is recorded

| Single game | Season |
|---|---|
| Points, rebounds, assists, steals, blocks | Points, rebounds, assists, steals, blocks, threes (totals) |
| Threes, field goals, free throws, minutes | Points, rebounds, assists **per game** |
| Team: points, margin, threes, assists, rebounds | Team: wins, points per game, point differential |

Ten deep in each list. Three reads as a leaderboard and fifty is a data dump.

**Rate records need a games qualifier**, `RATE_MINIMUM_SHARE` — 55% of the
season. Without it "most points per game" is won every year by somebody who
played once and scored 30. Totals need no such guard; they are self-limiting.

**Ties break on the older game**, so a record set first stays first and a later
equal performance does not push it down the page.

---

## 5. What it immediately found

A record book's job is to surface the tails, and the first thing this one did
was show that **the game engine's tails are much too fat**. Measured over 765
games of the committed season:

```
                     this league      real-world reference
mean margin              17.0                 ~11
median margin            14                   ~10
95th-pct margin          42                   ~25
games decided by 40+     48 of 765 (6.3%)     ~0.5%
highest team score       164                  ~150 (in overtime)
lowest team score        60                   ~80
```

The margin distribution is roughly ten times too heavy in the blowout tail, and
the scoring range is about twice as wide as it should be. That is a calibration
problem in the simulation, not in this module — the record book is reporting it
accurately. It is written down here because a record book full of 69-point
blowouts will read as broken, and the thing that is broken is upstream.

Nothing has been changed about it. Retuning the engine's variance would move
every number in the project, including the health and rebounding calibrations
that were solved against the current spread.

---

## 6. Where it lives

| | |
|---|---|
| `bballsim/records.py` | the book, and the categories |
| `save.RECORDS_PATH` | `data/records.json`, and why it is written |
| `League._finalize` | the one hook |
| `run.py` | read before the season, backfilled after it, written on save |
| `api/payload.records_view` | ids to club names, so a stored mark never carries a stale one |
| Stats → **Record Book** | the screen, with a Single Game / Season toggle |

Constants worth knowing: `records.DEPTH`, `records.RATE_MINIMUM_SHARE`.

The category keys (`"player:points"`, `"team:margin"`) are the contract with
both the front end and the stored file. Renaming one silently empties a list.
