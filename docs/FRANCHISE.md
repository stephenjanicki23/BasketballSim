# Contracts, negotiation and the offseason

What a player is owed, what he will accept, and what happens to a league
between the last game of one season and the first of the next.

Before this, the summer was a *transition*: `offseason.roll` archived the
season, aged everybody, retired whoever was finished, drafted replacements and
built a new calendar — all in one call, with nobody watching. That is still
exactly what it does. What is new is everything that has to happen in front of
it, and the fact that a manager is now inside the summer rather than on the
other side of it.

---

## 1. The shape

Five services, each with one job, none of which knows anything about a screen.

| Module | Question it answers |
|---|---|
| `bballsim/contracts.py` | What is he owed, and what is he worth? |
| `bballsim/negotiation.py` | What will he accept? |
| `bballsim/payroll.py` | What is the club committed to? |
| `bballsim/league/franchise.py` | What order does the summer happen in? |
| `bballsim/news.py` (offseason half) | What is worth reporting? |

The UI calls none of them directly. `api/payload.py` assembles one shape per
screen and `api/server.py` exposes five endpoints; the same JSON feeds the live
app and the published demo, which is the rule the whole `ui/` split is built
on.

---

## 2. Contracts

### The money is real dollars, stored as integers

Not millions, not a 0–100 wage abstraction. Payroll is a sum over fifteen
contracts across thirty clubs and it has to add up exactly — a screen that says
a club is $1,240,000 over the tax cannot be built on a float. Rounding happens
once, when a contract is created.

The cap is anchored to a modern NBA one so the numbers read as real:

```
salary cap        $154,647,000
luxury tax        $187,895,000
first apron       $195,945,000
second apron      $207,824,000
minimum salary      $1,272,870
maximum          25% / 30% / 35% of the cap, by years of service
```

**The cap is declared and not enforced.** Nothing rejects a signing that breaks
it. That is deliberate and it is stated on every screen that shows a cap
number: the constants exist so payroll, trade value and negotiation are already
denominated against the right scale, and so that adding enforcement later
changes what is *allowed* without moving what anything is *worth*.

### What sets a salary

A contract is not paid for ability alone. It is paid for what a club expects to
get, which is ability plus how much of a career is left to get it over.

```
value = curve(CA) × age × potential × position
```

The curve is anchored on `ability.CA_TIERS` — the same table the rest of the
project uses to say what a CA number means — so "All-Star" and "paid like an
All-Star" stay the same statement:

| Tier | CA | Share of cap |
|---|---|---|
| Generational | 180 | 34.5% |
| Elite NBA | 162 | 28.5% |
| All-Star | 145 | 20.5% |
| High-end starter | 128 | 12.2% |
| Average starter | 112 | 7.2% |
| Rotation player | 95 | 3.6% |
| Bench player | 78 | 1.3% |
| Fringe NBA | 60 | 0.4% |

Age moves a player along it (peak earning is the late twenties), unrealised
potential is worth money only to someone young enough to spend it, and position
carries a small scarcity multiplier — lead guards and centres run slightly hot.

**Calibrated, not chosen.** The first pass put 24 of 30 clubs into the luxury
tax and — worse — paid the All-Star tier *more* on average than the Elite tier
above it. That inversion was the curve running so hot above CA 145 that the
maximum bound on everybody, and once every star is on a max the only thing
separating their salaries is service years. A second bug sat at the other end:
the curve's floor was above the minimum salary, so a league of 360 produced
exactly one minimum contract where a real roster's last few names are all on
one. Both are pinned by tests.

Where it lands now:

```
mean team payroll   $173.6M   (1.12x cap)
over the tax          2 / 30
under the cap         2 / 30
minimum contracts    12 / 360
```

### How long a deal runs

```
superstar     CA 162+          4-5 years
young star    CA 140+, age ≤26 4-5
starter       CA 128+          3-4
role player   CA 95+           2-4
fringe                         1-2
veteran       age ≥34          1-2   (checked first)
```

Age is asked **before** the ability ladder, or a 35-year-old All-Star gets five
guaranteed years. The first version had it the other way round with an age
*ceiling* on the veteran row, which meant every young low-CA player fell
through the ability bands and matched the veteran row on age — a 25-year-old
twelfth man was labelled a veteran, and the fringe row below was unreachable.

### Staggering

A new save has no signing history, so years remaining is drawn *inside* the
deal's length: some men are in year one of four, some in the last year of two.
Without it the entire league would reach free agency in the same summer.

Roughly half the league expires in the first summer and it settles lower after
that (186 then 140 on a real two-season run). That is high, and it follows
directly from the brief's own length bands — minimum players get one year, and
there are a lot of minimum players.

### Declared and inert

`Contract` carries `team_option`, `player_option`, `no_trade` and `guaranteed`.
Nothing exercises any of them. They are storage with a shape so that adding the
rules later is not a migration, and they are documented as inert where they are
declared rather than left to look implemented.

---

## 3. Negotiation

This is the first system here where a player *disagrees* with the manager.
Everything else is done to him — he is picked, rested, played, developed. That
only means anything if the answer is not a function of money alone.

### Four hidden traits, 0–100

```
Loyalty              will he take less to stay where he is
Money desire         how hard he pushes on salary
Winning desire       how much a contender is worth to him
Playing time desire  how much being a starter is worth to him
```

**Loyalty is read through, not invented.** `hidden.loyalty` already exists on
the 1–20 attribute scale and is the same trait, so it is rescaled rather than
duplicated — two loyalties that could disagree would be worse than having none.
The other three are generated once from the player's id, leaning on `ambition`,
`professionalism` and `temperament` so a driven player reads as driven in both
systems. Money and winning are drawn from the same base and pushed apart, which
is what separates the mercenary from the ring chaser.

**They are never shipped to the client.** A manager who can read the four
numbers is solving, not negotiating. What the screen shows is a single derived
*interest in returning* — the same information blurred to the precision a front
office would actually have. A player at 40 might be unloved, underpaid or
buried, and finding out which is what the negotiation is for.

### What he asks for

```
ask = market value
      × money desire          (±22%)
      − contender discount    (up to 12%, scaled by winning desire)
      − loyalty discount      (up to 10%, incumbent club only)
      + small-role surcharge  (up to 18%, scaled by playing-time desire)
```

Loyalty is worth nothing to a rival, which is what makes holding on to your own
players cheaper than signing someone else's — and is the mechanical reason the
window before free agency exists.

Years are a separate question and not the same one as how long a club wants to
give him. A young player with real headroom bets on himself and asks short so
he can be paid properly sooner; a veteran wants the years while somebody is
still offering them.

### The answer

One ratio: what he was offered against what he asked for, with the years folded
in as a discount on the money. Keeping it to a single number is what makes the
outcome explainable on screen and stops a screenful of special cases
disagreeing with each other.

```
ratio ≥ 0.955 (moved by loyalty and contender)   accept
ratio < 0.74                                     reject
between                                          counter, meeting in the middle
```

Where the middle is depends on how hard he pushes — a money-motivated player
barely moves.

**One hard no.** A player with playing-time desire ≥ 68 who would be buried
(role ≤ 0.30) will not sign at any price, and that is checked *before* the
money so a maximum offer cannot buy him. A negotiation that can always be won
with money is not a negotiation.

### The AI is the same code

Twenty-nine clubs are not being played by anybody and half the league reaches
free agency every summer, so the AI has to do this on its own — and it has to
reach the answer a sensible manager would, or the league drifts away from the
rules the player is playing under. `auto_resolve` opens 10% under the ask and
concedes toward it over three rounds, stopping when the price passes 1.18×
market value. That ceiling is what stops AI clubs re-signing everybody and
leaving free agency an empty room: about 87% re-sign, and the rest reach the
market.

Coaches use the identical protocol against different inputs — standing instead
of CA, no squad role. There is no coach equivalent of playing-time desire, so
it is fixed at average and does nothing, which is stated rather than hidden.

---

## 4. Payroll

**Derived, never stored.** The same discipline as the standings, the bracket
and the advanced table, and the case where it matters most obviously: a stored
total is wrong the instant a contract is signed, expires or is traded, and the
bug it produces is a number that disagrees with the list of contracts directly
underneath it. There is no `Team.payroll` field anywhere.

Coaching salary is counted separately, because it does not count against a
basketball cap in any real league and folding the two together would make every
future cap calculation quietly wrong.

**An expired contract pays nothing.** A player whose deal ran out and who was
not re-signed stays on the roster (see below), and his old salary is still
sitting in the object. Counting it charged clubs for men they were no longer
paying — caught by a full-season run, fixed, and pinned by a test.

---

## 5. The offseason, in order

```
1. contracts tick down      every player and coach, one year served
2. expected free agents     whoever hit zero, gathered per club
3. player negotiations      his own club gets first refusal
4. coach negotiations       the same, for the bench
5. free agent pool          whoever is still unsigned, league-wide
6. retirements              processed, and taken out of the pool
7. news                     written from what the six steps did
8. roll                     archive, age, develop, draft, reschedule
```

**The order is the design.** Contracts tick before the expected list is built,
or the list is a season stale. Negotiations run before the pool is filled, or a
club never gets its first refusal. Retirements are processed after negotiations
and before news, so a man cannot retire out of a contract he just signed and
the newsroom can report both.

`Phase` is a state, not a script. A manager may sit in negotiations as long as
he likes making offers by hand; when he advances, whatever he has not settled
is auto-resolved by the same service his own offers went through.

### The gate

The OFFSEASON menu does not exist until the Finals have concluded — which is
exactly `playoffs.champion` being decided, the same test the honours screen
uses. The menu appears when a trophy is lifted, not on a date.

Opening the summer is what ticks the contracts, so it happens on the first
visit to the tab rather than at boot: a manager who never opens the menu should
not have his league aged behind his back. `begin` refuses a second call for the
same season, so a double-click cannot age everybody twice.

### A second summer is a new summer

A summer belongs to the season that just finished. The first version checked
only "is the phase still SEASON", so the second offseason found every entry
already marked `re-signed`, skipped all of them, and renewed nobody — while its
report cheerfully claimed 199 contracts were expiring, because it was reading
the previous year's list. Only a two-season run showed it.

### Retirement

The decision belongs to `progression`, which is where a career is modelled;
duplicating it would give the project two answers to "is he finished".
`franchise` does the contractual half — a retired player is not a free agent.

Age against ability is still the spine. What the four new terms add is the rest
of what actually ends a career, each a *nudge on the probability* rather than a
verdict:

```
career wear      ×1.55 at a worn-out body
championships    ×1.10 per ring, capped at three
minutes played   ×1.45 for a man out of the rotation
decline          ×1.40 at far below his own peak
```

Championships are charged to the **club**, not the individual, and that is a
real limitation rather than an oversight: nothing records which players were on
a roster in a past season, so "his rings" cannot be asked. When squad history
exists this becomes a per-player count and nothing else changes.

**Career length is not `seasons_played`.** That counts summers this save has
simulated, which is zero on a fresh league for a 36-year-old who is supposed to
have fourteen years behind him. Using it made every first-summer retirement
read as a one-season career, and the newsroom's "was this worth writing about"
floor filtered out the lot. The draft class is the real answer and is stored on
every player.

**Peak ability has the same shape of problem, and only a partial fix.**
`peak_ca` is a running maximum and it can only run from the moment a career
profile exists — so on a fresh league a veteran in visible decline records
today's ability as the best he ever was. `progression.implied_peak`
reconstructs what it can when a profile is built for a career already under
way, walking the ability back toward his prime and capping the estimate at his
potential. That cap is doing real work: in this league a 35-year-old's PA sits
only a point or two above his CA, which means the model genuinely says he never
was much better. So the reconstruction is small and honest rather than
invented, and the newsroom will not claim a decline below a quarter of a tier.
After a few simulated seasons `peak_ca` is a real measurement and none of this
applies.

---

## 6. What is not implemented

Three menu items are declared with no logic behind them. The UI renders them as
explicit "planned" panels that say what they will do — an empty table reads as
a bug, and a populated one would be a lie. Which ones are real is read off the
API's `implemented` map, so a screen cannot claim to work while the server
knows it does not.

**Free agency.** The pool is built correctly every summer, saved, and shown.
What does not exist is the bidding: no club can sign another club's free agent.
Unsigned players stay on the rosters they are on — selection reads the depth
chart, not the contract — and count nothing against payroll. A player vanishing
from a squad would break a league with no mechanism to replace him.

**Draft.** The intake already runs, inside `roll`, worst club picking first.
What is planned is the part a manager takes part in: a lottery, a board, and
tradeable picks.

**Training camp.** Development already happens over the summer, driven by real
minutes and the coach's development rating. Camp would be the lever that lets
you influence it.

Also absent and worth naming: no trades, no salary-cap enforcement, no luxury
tax bill, no restricted free agency, no rookie scale table, no two-way
contracts, no buyouts or waivers, no Bird rights, no mid-level exception, no
agents, and no in-season extensions. The storage shapes for options, no-trade
clauses and guarantees exist; the rules do not.

---

## 7. Where the numbers live

Every constant that shapes an outcome is a named module-level value with the
reasoning next to it, not a literal inside a function:

- `contracts.VALUE_CURVE`, `AGE_CURVE`, `LENGTH_BANDS`, `SALARY_NOISE`
- `negotiation.MONEY_SWING`, `WINNING_DISCOUNT`, `LOYALTY_DISCOUNT`,
  `ROLE_SURCHARGE`, `ACCEPT_RATIO`, `REJECT_RATIO`, `AI_CEILING`
- `progression.RETIREMENT_WEAR_SWING` and the three beside it

Tests: `tests/test_contracts.py` (44) and `tests/test_franchise.py` (65).
Several of them exist because a calibration or a full-season run failed them,
and each of those carries a docstring saying which bug it is holding down.
