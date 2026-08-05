# The trade decision engine

Front offices that think about their situation rather than comparing ratings.

The premise is one sentence: *two clubs handed the identical offer should often
answer differently*. Everything below exists to make that true for the right
reasons.

---

## 1. The shape

| Module | Question |
|---|---|
| `bballsim/draft_picks.py` | What is a pick worth, and who owns it? |
| `bballsim/front_office.py` | Who is this club, where is it, what does its owner want? |
| `bballsim/trade_value.py` | What is a player worth — and worth *to us*? |
| `bballsim/trades.py` | Should we do this, and if not, what would we need? |

---

## 2. Draft picks had to be built first

There were none. The draft was a *process* — `offseason.draft` filled
retirement vacancies, worst club first — and no object anywhere represented
"Redstone's 2029 first". You cannot build a trade engine on that: half of every
real trade is picks, a rebuild is the accumulation of them, and a contender's
aggression is measured in how many it will send out.

A pick is **owed by** a club, not held by one. `original_team` never changes —
it decides where the pick lands — and `owner` is who uses it. That distinction
is the point: a rebuilding club wants Redstone's pick *because Redstone is bad*.

Value comes from a steep slot curve (1st = 1000, 14th = 240, 30th = 90 — a
first pick is not twice a fifth), a per-year class strength drawn from the year
itself so every club agrees which drafts are loaded, a discount for distance,
and regression of the projected slot toward mid-draft the further out it is.
Protections bite only when the pick is likely to land inside them; a swap is
priced as the difference between two picks rather than a pick.

**No lottery.** This league does not run one — `offseason.draft` picks in
reverse standings order — so pricing against lottery odds would be valuing a
mechanism that does not exist. `LOTTERY_ODDS` is deliberately not declared.

---

## 3. Identity, timeline, window

**Identity** is twelve hidden traits, generated once from the club id and
permanent. Aggressiveness, patience, risk tolerance, analytics focus, loyalty,
owner spending and six more. Every one is read somewhere — a trait that only
decorated a team page would be worse than none.

**Timeline** is eight phases from Championship Favourite to Tanking, derived
from record blended with roster and reweighted by how much season has been
played: fifteen games of record is noise in October and the truth in March.

**Window** is 0–100 across seven weighted parts:

```
roster strength     38%
star age            16%
star contracts      12%
conference          12%
coach                8%
cap flexibility      8%
draft capital        6%
```

Above 80 the brief says a club should mortgage its future, and `trades` reads
it that way — but *smoothly from 60*, so a club at 79 is not a different animal
from one at 81.

### Two calibration failures worth recording

**Roster strength has to be relative.** An absolute score put all thirty clubs
between 64 and 68 — every roster in a generated league is built to a similar
budget, so the raw number carries almost no information. The league read as
nineteen contenders and eleven playoff teams, with nobody rebuilding and no
window above 70. It is now a rank against the other twenty-nine, and all eight
timelines populate.

**Conference strength took two goes.** Scored against a fixed scale it returned
8–13 for every club: a tenth of the window behaving as a constant. Regressing
toward .500 was worse than it sounds — a conference's top four average well
above .500 *by definition*, so ".500 is weak" is a fixed offset, not a scale.
It is now comparative: one conference measured against the other, so evenly
matched conferences both score 50, which is also the right answer in October.

---

## 4. What a player is worth, and to whom

Two numbers. `base_value` is ability (a steep curve), age, unrealised
potential, positional scarcity, contract surplus, durability from the health
model, and character — the number a screen shows. `value_to` reweights it
through a club's timeline, identity and window, and is what the engine sums.

On the committed league that produces exactly what the brief describes:

```
a 32-year-old star     1.93x more valuable to the favourite than to the tanking club
a 20-year-old prospect 2.63x more valuable to the rebuild
```

Trade value **moves during a season**: `production_multiplier` compares a
player's PER against what his ability predicts, bounded so a hot fortnight
nudges a price rather than doubling it.

**Untouchables** are a surcharge, not a wall — the brief says "unless
overwhelmed". A generational player, a young star with real headroom, the best
player on a contender, or any star at a very loyal front office. About 11 of
360.

---

## 5. The score

Ten weighted parts, each centred on zero so the sign of each says whether the
trade helps that dimension. Keeping them on one scale is what makes the
explanation engine possible: the reason a club said no is whichever part was
most negative.

**The brief's percentages sum to 110, not 100** — 30+15+15+10+10+10+5+5+5+5.
That is a slip in the brief, and leaving it would make the score
uninterpretable: a perfect trade would score 1.1 and the accept threshold would
mean something other than what it says. The proportions are kept exactly and
normalised, so player value is still twice roster fit and roster fit is still
three times chemistry.

Roster fit measures the club's rotation on nine composites that already exist,
ranks each against the league, and asks whether the incoming player helps
*where the club is actually weak* — plus positional depth, so a club with two
good centres does not want a third. Coach fit reads the club's real
`tactics.py` scheme: motion wants passing and spacing, isolation wants shot
creation, switch defence wants versatile defenders. Chemistry charges for the
pair relationships a departing player takes with him, weighted 1.4× for a
winning club.

---

## 6. Negotiation

Nothing instantly accepts. Above +0.04 a club signs; below −0.14 it walks;
between, it counters — and *what it asks for is read off which part was most
negative*. Short on value or picks, it asks for a pick. Short on money, it asks
the other club to take a contract it does not want. Short on fit, it asks for a
different player. So the counter answers the actual objection.

Every decision generates reasoning built *from the parts* rather than written
alongside them, so it cannot drift from the arithmetic.

---

## 7. Finding deals

Evaluating offers is only half a front office. A sweep of 200 random
player-for-player swaps produced **zero** deals both clubs would sign — the
correct answer to a bad question. Real front offices work out what they need,
find the club with it going spare, and build from there.

`find_trades` sorts partners by *distance in timeline* (a contender and a
rebuild are natural partners; two contenders are not), targets players who fit
the club's worst dimensions, offers genuinely expendable pieces — never an
untouchable, never a top-three player — and sweetens with a pick when a
one-for-one is not enough. Only deals both sides would sign are returned.

**It had to be made fast.** The first version took ten seconds for one club:
`needs()` profiled all thirty rotations on every evaluation, and
`FO.situation()` rebuilt the window — thirty rosters, the whole pick inventory,
the standings — twice per candidate offer. Both are memoised on a
roster-and-results fingerprint that invalidates the moment a trade moves
somebody. Now 2.5s per club, 0.2s for the whole league's trade block.

---

## 8. What the brief asked for that is **not** built

None of this is faked, and none of it is quietly missing.

| Asked for | Status |
|---|---|
| Bird rights, mid-level exception, trade exceptions, dead cap | Declared as inert fields on `Contract`. Salary matching is the simple 75% rule and says so. |
| Player trade requests | Absent. Nothing in the simulation lets a player ask for anything. |
| Marketability, popularity, fan favourite | Thin proxy over `media_handling` and `locker_room_presence` plus stardom. No attendance, merchandise or fan sentiment exists. Weighted at the brief's 5% and no more. |
| Playoff performance, championship experience | Absent per player. `SeasonStats` does not separate postseason, and championships are recorded per *club* — see `docs/FRANCHISE.md`. |
| Championship odds, playoff odds | Approximated from the window and the standings. Not simulated. |
| Draft lottery, protections conveying, swap resolution | Protections and swaps are *priced*; nothing resolves them, because there is no lottery and the draft is reverse-standings. |
| Free agency forecast | Partial. The expected-FA pool exists (`franchise.py`); no bidding, so "can we sign a replacement" cannot be answered. |
| Multi-team trades | Two clubs only. |
| Strength of remaining schedule | Not read. `power.py` has a schedule component that could feed it. |

---

## 9. Where the numbers live

Every constant that shapes an outcome is a named module-level value with the
reasoning beside it: `draft_picks.SLOT_CURVE`, `FUTURE_DISCOUNT`,
`FUTURE_REGRESSION`; `front_office.WINDOW_WEIGHTS`, `IDENTITY_PROFILES`;
`trade_value.ABILITY_CURVE`, `POSITION_SCARCITY`, `TIMELINE_SWING`;
`trades.BRIEF_WEIGHTS`, `ACCEPT_SCORE`, `REJECT_SCORE`, `SALARY_MATCH_SHARE`.

68 tests in `tests/test_trades.py`. Four exist because a real run failed them,
and each carries a docstring naming the bug it holds down.
