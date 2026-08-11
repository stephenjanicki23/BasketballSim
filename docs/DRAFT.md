# The draft board, and five people arguing about it

Mock drafts twice a week, and an offseason menu you can read in January.

---

## 1. The problem with mocking a draft that does not exist yet

Before this, there was no draft class. There was a function that would invent
one in July.

`offseason.draft` built its intake **at the moment of the draft** and sized it
to the retirements it was replacing: four clubs lose a centre, the class is
four centres. That is a perfectly good way to keep squads legal — a squad has
to stay playable for `Team.starters()` — and a completely impossible one to
write about in February. There were no names, no board, and no way for a
January mock draft to be anything but decoration.

So the class is now **forward-declared**. `draft_class.board(year)` draws sixty
players from the draft year alone, months before anybody picks, and hands the
same sixty to everybody who asks. `offseason.draft` then takes names *off that
board* instead of conjuring its own.

The test that matters:

```
mock published before the summer      30 picks
players who actually arrived          17
named in the mock                     17 / 17
```

A mock draft is a prediction or it is nothing.

---

## 2. Two names for one draft

`draft_picks` numbered picks off the season's opening year, so it called the
draft after 2026-27 the **2026** draft. `offseason.draft` generated its class
under `next_label(season)`, so it called the same draft **2027**.

That cost nothing for as long as no object was keyed on the year — a pick label
is a string and a class strength is a number nobody could check. `board(year)`
is keyed on it, and the mismatch meant the sixty players the writers mocked
were *not* the sixty who would arrive. The feature would have been a
convincing, well-formatted lie.

A draft is named for the year it is held: the 2026-27 season ends in the 2027
draft. `draft_picks.DRAFT_YEAR_OFFSET` is that decision, written down once, and
both callers now ask the same function.

---

## 3. What the board is

Sixty players, two rounds, best first.

**Seeded off the same string as the class strength.** `class_strength(year)`
has priced picks since the trade engine was built — "we are saving our picks
for 2031" is already a real position a front office can hold. Drawing the board
from an unrelated seed would have produced a league where the 2031 class is
famously loaded and the sixty men in it are ordinary. The strength now *shifts
the ladder*, so a loaded class is loaded in the only way that can matter: the
players in it are better.

```
Ordinary 2027    top CA 107.0    tail 66.3
Strong   2028    top CA 116.7    tail 67.2
```

**Positions are drawn from the class, not from the league's holes.** Real
intakes are whatever came through, and some years are thin at centre — the 2029
class has five. That thinness is exactly what makes a need-based mock disagree
with a best-available one, which is the entire reason there are five writers.
`POSITION_FLOOR` stops it becoming absurd.

**Drafting for need has a cost, and now you can see it.** A club replacing a
centre takes the best *centre* left, not the best player left. Board ranks 8, 9
and 11 went undrafted in the season measured above while rank 12 went; that gap
is the interesting number in any draft and it only exists because the board
existed first.

**A class can run out at a position.** Sixty names is not sixty of each. A club
with a hole nobody left can fill signs an undrafted man generated on the spot,
reported as an undrafted signing rather than dressed up as a pick.

---

## 4. The five writers

No consensus board exists anywhere in `mock_draft.py`, for the same reason
`mvp.py` has no MVP formula: it would be one formula wearing a press pass.

| Writer | Reads | Defers to the board |
|---|---|---|
| Curtis Mbeki, *The Draft Room* | board rank | 1.00 |
| Delphine Achebe, *Hardwood Weekly* | board rank, positional depth | 0.55 |
| Rafael Okonjo, *Ceiling Report* | potential, headroom, age | 0.45 |
| Marguerite Vance, *The Rotation* | current ability, professionalism, consistency | 0.45 |
| Tobias Lindqvist, *Possession Value* | spacing, playmaking, perimeter defence | 0.40 |

They disagree by construction. Okonjo takes a 19-year-old forty points short of
his ceiling; Vance will not touch him. On the committed league the panel put
one player as high as first and as low as nineteenth.

### The deference weight had to be invented

The first version had none: each writer read only their own lens. That produced
a writer taking the **thirty-second-ranked prospect third overall**, which is
not a dissenting mock draft, it is a different sport. Real writers argue with
the board from inside it.

Both sides are converted to a rank *among the players still available* before
blending, because the lenses are in wildly different units — `_upside` returns
about 250 and `_analytics` about 60, and adding a board position to either
directly would have meant one of them decided everything. Ranks are the only
currency the five share.

How far each strays is per-writer, because it is part of their character:

```
                    drafts a thin position   biggest reach
best available            16 / 30                 0
team need                 22 / 30                 5
upside                    14 / 30                13
pro-ready                 13 / 30                23
analytics                 16 / 30                22
```

The need writer drafting for need 22 times against the board writer's 16 is the
evidence the philosophy is doing something.

### Wednesdays and Sundays at midnight

An edition is the most recent Wednesday-or-Sunday midnight at or before the
league clock — **derived, not stored**, like the standings. Two calls a minute
apart return the same edition, which is what stops the boards drifting under a
reader between publication days. A writer publishes, then lives with it while
the games are played.

---

## 5. The offseason menu is no longer hidden

The tab used to appear only when the Finals concluded. That was the right gate
for the **machinery** — opening a summer ticks every contract down and has to
happen exactly once — and the wrong gate for the **information**. Who is out of
contract in July, who is near the end, what every club owes and who the draft
writers like are all knowable in January, and are exactly what a manager wants
in January.

So the tab is always there, and mid-season it is a **preview**: read-only,
labelled as projection, and incapable of changing anything. The one dangerous
call on the page is `offseason/open`, and it still refuses to run until a
champion exists.

| Screen | In preview |
|---|---|
| Mock Drafts | the current edition — the landing screen |
| Expected Free Agents | contracts with one year left, with today's asking prices |
| Retirements | a retirement *watch*, with risk rather than names marked "retiring" |
| Payroll | unchanged; it was always derived |
| News, Negotiations, Coaches, Free Agency, Training Camp | "After the Finals", with a sentence saying why |

**`projected_expiring` is a separate function from `collect_expiring`**, not a
parameter on it. The summer's version reads `contract.expired`, which is only
true after `tick_contracts` — so during a season it correctly returns nobody,
and a preview built on it would be an empty page. A deal with one year left is
a deal that expires this summer, and that is knowable now.

**The retirement watch reads `progression.retirement_risk`**, which was
extracted from `_should_retire` so the screen and the decision are one function
rather than two that agree until somebody edits one. Certain outcomes come back
as 1.0 and the screen says "Certain" rather than "100%", because past the
ability line for his age there is no coin to toss.

---

## 6. What a mock cannot know, said on the page

A mock draft is thirty picks because that is what a mock draft is. **The draft
this league actually runs is as long as the number of players who retire** —
seventeen in the season measured above — and who retires is decided in the
summer against a season that has not finished being played.

`unfilled_note` says so, on the screen, every edition:

> Mocks run the full first round, 30 picks in reverse standings order. The
> draft itself only fills the places retirement opens, so it is usually shorter
> — and a club with no vacancy does not pick at all.

The order is also a guess in a way the board is not: it is read off a table
with games left in it. Every writer's closing paragraph carries that caveat,
generated from the numbers rather than written alongside them.

**Still no lottery.** The order is reverse standings because that is what
`offseason.draft` does; see `docs/TRADES.md` for why the mechanism is left
absent rather than approximated.

---

## 7. Where the numbers live

`draft_class.BOARD_SIZE`, `POSITION_WEIGHTS`, `POSITION_FLOOR`,
`STRENGTH_AT_TOP`; `mock_draft.PUBLISH_WEEKDAYS`, `MOCK_PICKS`, `REACH_LIMIT`,
and each writer's `board_weight`; `draft_picks.DRAFT_YEAR_OFFSET`.
