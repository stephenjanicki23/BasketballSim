# The player page

A face, a trophy shelf, and the numbers underneath.

---

## 1. Portraits: drawn, not photographed

There is no image model in this project and a published page cannot fetch
anything, so a photograph was never on the table. These are **illustrations
assembled from parts** — a skin tone, a cut, a beard, a kit — exactly the way a
club crest is assembled from a glyph and two colours.

The split follows `logos.py`: **the choices live in Python, the path data lives
in `ui/app.js`** next to the thing that draws it. `portraits.features()` returns
eleven fields; `portraitSVG()` turns them into a face.

Built to read at **34px**, which is where it is usually seen — a roster row.
That rules out detail: big shapes, strong value contrast, no fine linework. The
96px version on a profile is the same drawing with more room.

### Appearance is seeded from the player id, not from his name or his country

This is the load-bearing decision in the module and it is deliberate.

Code that reads a nationality and picks a skin tone is a stereotype generator:
it encodes a claim about what people from a place look like. It is also *worse
at the job*. A real squad is not sorted by passport, so correlating the two
produces a league **less** varied than the one it is imitating, not more.
Seeding on the id gives every league the full palette and lets a Lithuanian
centre look like anyone.

Three tests hold it there, including one that renames a player and asserts his
face does not change — if it does, the surname is feeding the drawing.

**Age is the one exception**, because it is a fact about a body rather than a
claim about a group: grey arrives through the thirties, salt-and-pepper first
and then grey, and a clean shave is far more likely at nineteen than at
thirty-four.

### The kit is the club's

A portrait wears the crest colours of the team he currently plays for, so a
squad reads as a squad and a traded player visibly changes shirt.

That nearly shipped broken. `logo_for` returns `primary`/`secondary`; the first
version asked for `"disc"`/`"mark"` — the words the crest *documentation* uses —
and got the fallback grey for all thirty clubs. Every portrait in the league
wore the same shirt and nothing looked broken enough to notice by eye.
`test_the_kit_comes_from_the_club` caught it.

### Three drawing bugs worth remembering

- **Beards drawn over the mouth** made every bearded player expressionless. The
  beard now goes down *first* and the mouth is stroked on top of it.
- **Braids drawn down the middle** put a row of teeth across the forehead — the
  crown ends around y40 and the face starts immediately below. They hang at the
  sides now.
- **A goatee with a darkened mouth line** erased the mouth entirely. Only beards
  that actually cover the mouth change its colour; `COVERS_MOUTH` is that list.

---

## 2. Accolades: won, not assigned

Every honour is **derived from the archives**, recomputed on read. A trophy
cabinet written down at the moment it was earned would drift from the seasons
behind it the first time a formula changed — the same argument the standings,
the MVP race and the record book already make.

| Honour | Where it comes from |
|---|---|
| Champion | his club that season *was* the club that won it |
| Finals appearance | his club was the runner-up |
| Most Valuable Player | the real ten-writer panel, re-run on that season's totals |
| All-League Team | top five of the same ballot |
| Scoring / Rebounding / Assists Title | per-game leader, with a games floor |
| League Record | read straight out of `records.py` |
| Career milestones | archived seasons plus the live one, added up |

### MVP is re-voted, not remembered

`mvp.rows_from` was split out of the live race so a 2027-28 season can be
scored by the same ten writers reading the same columns. A separate "historical
MVP" formula would have been a second opinion wearing the same name, and it
would have disagreed with the live tab the first time a voter was edited.

### The shelf is usually empty, and that is the point

Championships go to one roster a year. In a league with two summers behind it
fewer than half the players have anything at all, and a test pins that: a badge
everybody has is decoration, not an honour.

### What is deliberately not awarded

No All-Star selections, no Defensive Player of the Year, no Rookie of the Year,
no Finals MVP. **None of those mechanisms exist in the simulation**, and an
award handed out by a formula nobody can see is a label rather than an award.
All-League *is* derived, because it is precisely "the panel's top five", which
the panel really does produce.

Postseason honours stop at the club. `SeasonStats` does not separate playoff
games from regular-season ones, so "averaged 30 in the Finals" is not a
question this league can answer — the same gap `docs/TRADES.md` records for
trade valuation.

### One pass, not one per player

`_league_honours` works the whole league out at once and caches it against the
shape of the history. Asking per player re-voted every archived season for
every man on a roster and rebuilt the entire record book thirty times over: a
squad page cost **14.6 seconds**. It now costs 0.09.

---

## 3. Where the numbers live

`portraits.SKIN`, `HAIR`, `STYLES`, `BEARDS`, `HEADBAND_CHANCE`, `GREY_STARTS`;
`accolades.MILESTONES`, `TITLES`, `ALL_LEAGUE_PLACES`, `TITLE_MINIMUM_SHARE`.

Icons are single filled paths on a 24-unit grid in `ui/app.js`
(`ACCOLADE_ICONS`), bold for the same reason the crests are: they are 13px on
a badge.

24 tests in `tests/test_profile.py`.
