# The awards watch

Under **Stats**, in place of the old MVP Race tab: a watch list for the
season's individual honours — MVP, All-League, and the scoring, rebounding and
playmaking titles. For each one it names the players in contention, and it
stops there.

No vote. No share. No ranking. No marker for who is ahead.

---

## 1. Why it shows no standing

The MVP tab it replaced showed a board with vote shares and a highlighted
leader. That answers the question the season exists to answer. This page
refuses to: who wins is a thing to be **found out** when the season ends and
`accolades.py` reads it off the archives — the same way nobody is an All-Star
until tip-off, and a draft prospect's ceiling stays hidden until he plays.

So the watch is deliberately incomplete. It tells you who is in the
conversation for each award. It will not tell you who is winning it.

---

## 2. Selecting a shortlist is not ranking it

To know who is even a contender, you have to consult the machinery that ranks
them — there is no other way to know a fringe rotation player is not an MVP
candidate. So:

* the **voted awards** (MVP, All-League) take their field from `mvp.tally`, the
  real ten-writer panel's count;
* the **statistical titles** take theirs from the season leaders in that stat.

And then, before anything leaves the module, **the names are sorted
alphabetically.** The reader sees the field; the order it was chosen in never
reaches them. `tests/test_awards.py` sorts the names itself and demands the
payload already matches — if the selection order ever survived, that would be a
ranking in disguise.

Each contender is serialised as nothing more than a name, a club, a position
and one neutral line — the same `points / rebounds / assists` line for **every**
award, so a card reads as "here is the player", not "here is why he leads". The
test asserts a contender dict has exactly those five keys and that the JSON
carries no `vote`, `share`, `rank`, `first`, `leader` or `ballot`.

---

## 3. Two kinds of award

**List awards** name a shortlist, alphabetical, no ranking:

| award | field | decided at season's end by |
|---|---|---|
| Most Valuable Player | the season's best players | the ten-writer vote |
| Scoring Title | the top scorers | most points per game |
| Sixth Man of the Year | the best reserves | the panel |
| Coach of the Year | the winning clubs' coaches | the panel |

**Team awards** name a **first team and a second team, one player at each
position** — the shape those honours actually take. The first/second split is
the award's own structure; no number ranks the two.

| award | value is | positions |
|---|---|---|
| All-League Team | win shares and VORP | PG · SG · SF · PF · C, ×2 |
| All-Defensive Team | defensive win shares, box plus-minus, steals, blocks | PG · SG · SF · PF · C, ×2 |
| All-Rookie Team | win shares and VORP, among first-years | PG · SG · SF · PF · C, ×2 |

A position with only one qualifier fills the first team and leaves the second
open rather than inventing a name — which is why a thin rookie class can show a
four-man second team.

### What is deliberately gone

The **rebounding and playmaking titles** were removed. An award decided on total
rebounds is a leaderboard by another name, and the data supports something
better in their place: an **All-Defensive team**, built from defensive win
shares, defensive box plus-minus and the stops a box score records — steals and
blocks, and pointedly *not* total rebounds.

### How the tricky ones are derived, honestly

* A **rookie** is a player whose draft class is the newest on any roster
  (`bio.draft.year`), the same test `news._draft_year` uses, so the rookie wire
  and the All-Rookie team never disagree about who is one.
* A **sixth man** is the best player who is *not* among his club's top five by
  minutes. The engine never records who started, so minutes are the honest
  stand-in: a club's five biggest-minute men are its starters, and the best of
  the rest is its sixth man.
* A **coach's** case is his club's record this season, straight off the
  standings.

## 4. `mvp.py` did not go anywhere

Removing the tab did not remove the module. `mvp.py` still runs the panel — it
is what `accolades.py` reads to decide who *actually won* MVP at season's end,
and what this watch reads to decide who is *in contention* now. The tab was a
view of it; the view changed, the machinery did not.

---

## 5. Where it lives

| | |
|---|---|
| `bballsim/awards.py` | the watch: fields, selection, alphabetical order |
| `bballsim/api/payload.py` | rides in the bootstrap as `awards` (was `mvp`) |
| `GET /api/awards` | the same shape on its own (was `/api/mvp`) |
| Stats → Awards Watch | the screen |
| `tests/test_awards.py` | 15 tests |

### One bug, caught on screen

The statistical-title leaders were read from the per-game player table while the
voted awards came from season totals — and the shared contender builder divides
by games either way. So a scoring leader's 21.8 points a game rendered as 0.9.
Both kinds read the same totals table now, and a test checks the *magnitude* of
the lines, not just their shape — the double-divide changed the numbers without
changing which names appeared, so only a magnitude check would have caught it.
