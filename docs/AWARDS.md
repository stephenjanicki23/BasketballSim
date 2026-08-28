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

## 3. The awards, and what each is

| award | field is | decided at season's end by |
|---|---|---|
| Most Valuable Player | the panel's top of the ballot | the ten-writer vote |
| All-League Team | the panel's broader pool | the five best at each position |
| Scoring Title | the season's top scorers | most points per game |
| Rebounding Title | the season's top rebounders | most rebounds per game |
| Playmaking Title | the season's top passers | most assists per game |

There is no Defensive Player of the Year and no Rookie of the Year, for the
reason `accolades.py` gives: the simulation has no mechanism to decide them, and
an award with no machinery behind it is a label, not an award.

The watch opens once there is enough season to argue about — `mvp.is_open` for
the voted awards, and the games-played floor for the statistical ones. A fresh
league shows nothing yet, and says so.

---

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
| `tests/test_awards.py` | 11 tests |

### One bug, caught on screen

The statistical-title leaders were read from the per-game player table while the
voted awards came from season totals — and the shared contender builder divides
by games either way. So a scoring leader's 21.8 points a game rendered as 0.9.
Both kinds read the same totals table now, and a test checks the *magnitude* of
the lines, not just their shape — the double-divide changed the numbers without
changing which names appeared, so only a magnitude check would have caught it.
