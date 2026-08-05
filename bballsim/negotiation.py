"""Contract talks: what a man wants, and whether he takes what he is offered.

A negotiation is the first system here where a player *disagrees* with the
manager. Everything else in the simulation is something done to a player -- he
is picked, rested, played, developed. This is the one place he answers back,
and that only means anything if the answer is not a function of money alone.

So every player carries four hidden numbers, 0-100:

    Loyalty              will he take less to stay where he is
    Money desire         how hard he pushes on salary
    Winning desire       how much a contender is worth to him
    Playing time desire  how much being a starter is worth to him

Those four are the whole personality model, and they are *hidden* for the same
reason the character attributes are: a manager who can read them is not
negotiating, he is solving. What the screen shows instead is a single derived
"interest in returning", which is the same information blurred to the precision
a front office would actually have.

**Where the four come from.** Loyalty is not invented here -- `hidden.loyalty`
already exists on the 1-20 attribute scale and is the same trait, so it is read
through and rescaled rather than duplicated. Keeping two loyalties that could
disagree would be worse than having none. The other three are new information
and are generated once, seeded from the player's id, leaning on the character
attributes that already exist (`ambition`, `professionalism`, `temperament`) so
a driven player reads as driven in both systems.

**The shape of a negotiation.** A player has a `Demand` -- years and salary he
is asking for. A club makes an `Offer`. He returns a `Response`: accept, reject,
or counter, with a counter-demand and a sentence saying why. That is the whole
protocol, and it is deliberately the same one for coaches, because a coaching
negotiation is the identical problem with different inputs.

**Nothing here reads the UI and nothing here writes to it.** The service takes
a player, a club and an offer and returns a value. Where that value is rendered
-- a screen, a test, an auto-resolved offseason step -- is not its business.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum

from . import contracts as K
from .engine.rng import seed_from_string
from .ratings import LEAGUE_AVERAGE, SCALE_MAX

# --------------------------------------------------------------------------
# Personality
# --------------------------------------------------------------------------

TRAIT_MIN = 0.0
TRAIT_MAX = 100.0
TRAIT_AVERAGE = 50.0


def clamp_trait(value: float) -> float:
    return max(TRAIT_MIN, min(TRAIT_MAX, float(value)))


def from_attribute(value: float) -> float:
    """A 1-20 hidden attribute as a 0-100 negotiation trait.

    One conversion in one place, so the two scales never get multiplied
    together by accident somewhere downstream.
    """
    return clamp_trait(value / SCALE_MAX * TRAIT_MAX)


@dataclass
class Personality:
    """How a player negotiates. Hidden; `interest` is what a club may see.

    `loyalty` is stored here as a plain number even though it originates in
    `hidden.loyalty`, because a personality that is half read-through and half
    stored is a personality nobody can serialise. `generate` is the single
    place the two are joined.
    """

    loyalty: float = TRAIT_AVERAGE
    money_desire: float = TRAIT_AVERAGE
    winning_desire: float = TRAIT_AVERAGE
    playing_time_desire: float = TRAIT_AVERAGE

    def __post_init__(self) -> None:
        self.loyalty = clamp_trait(self.loyalty)
        self.money_desire = clamp_trait(self.money_desire)
        self.winning_desire = clamp_trait(self.winning_desire)
        self.playing_time_desire = clamp_trait(self.playing_time_desire)

    def to_dict(self) -> dict:
        return {
            "loyalty": round(self.loyalty, 1),
            "moneyDesire": round(self.money_desire, 1),
            "winningDesire": round(self.winning_desire, 1),
            "playingTimeDesire": round(self.playing_time_desire, 1),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Personality":
        return cls(
            loyalty=data.get("loyalty", TRAIT_AVERAGE),
            money_desire=data.get("moneyDesire", TRAIT_AVERAGE),
            winning_desire=data.get("winningDesire", TRAIT_AVERAGE),
            playing_time_desire=data.get("playingTimeDesire", TRAIT_AVERAGE),
        )

    @property
    def label(self) -> str:
        """What this player is, in one phrase, for a scouted profile.

        The strongest trait names him -- the same trick `Coach.specialism`
        uses -- and only if it is actually strong. A player whose four traits
        are all average is not "money motivated", he is unremarkable.
        """
        traits = (
            (self.money_desire, "Money motivated"),
            (self.winning_desire, "Wants to win"),
            (self.playing_time_desire, "Wants minutes"),
            (self.loyalty, "Loyal"),
        )
        value, name = max(traits, key=lambda pair: pair[0])
        return name if value >= 62.0 else "Even-handed"


# How far a generated trait wanders from the character attribute behind it.
# Wide enough that a player is not simply his ambition rating written out four
# times, narrow enough that the two systems agree about who he is.
TRAIT_SPREAD = 14.0


def generate(player) -> Personality:
    """The four traits, drawn once and deterministically from the player.

    Seeded on the id, so a personality survives a regenerated league the same
    way a career profile does, and two runs of the same save negotiate
    identically.
    """
    hidden = player.hidden
    rng = random.Random(seed_from_string(f"negotiation-{player.id}"))

    ambition = from_attribute(getattr(hidden, "ambition", LEAGUE_AVERAGE))
    professionalism = from_attribute(getattr(hidden, "professionalism", LEAGUE_AVERAGE))
    temperament = from_attribute(getattr(hidden, "temperament", LEAGUE_AVERAGE))

    # Money and winning are the two faces of ambition and pull against each
    # other: a driven player wants *something* badly, and which one is what
    # separates the mercenary from the ring chaser. So they are drawn from the
    # same base and pushed apart.
    split = rng.uniform(-16.0, 16.0)
    money = rng.gauss(ambition + split, TRAIT_SPREAD)
    winning = rng.gauss(ambition - split, TRAIT_SPREAD)
    # A professional wants to win more than he wants paying.
    winning += (professionalism - TRAIT_AVERAGE) * 0.22

    # Minutes matter most to a player who backs himself, and a difficult
    # temperament makes a bench role harder to sell.
    playing_time = rng.gauss(
        ambition * 0.6 + (TRAIT_MAX - temperament) * 0.4, TRAIT_SPREAD)

    return Personality(
        loyalty=from_attribute(getattr(hidden, "loyalty", LEAGUE_AVERAGE)),
        money_desire=money,
        winning_desire=winning,
        playing_time_desire=playing_time,
    )


def personality_of(player) -> Personality:
    """The player's personality, generating and caching it on first ask.

    Lazy because a league saved before this system existed has none, and a
    negotiation screen should not be the thing that crashes on an old save.
    """
    existing = getattr(player, "negotiation", None)
    if isinstance(existing, Personality):
        return existing
    made = generate(player)
    player.negotiation = made
    return made


# --------------------------------------------------------------------------
# What the club looks like from where he is standing
#
# Three facts decide a negotiation beyond the money, and all three are about
# the club rather than the player. They are gathered into one object so that
# every function below takes the same argument, and so a test can construct a
# situation without building a league.
# --------------------------------------------------------------------------

@dataclass
class Situation:
    """The club, as the player sees it."""

    team_id: str = ""
    team_name: str = ""
    # 0.0-1.0. How close this club is to winning something, from its record.
    contender: float = 0.5
    # 0.0-1.0. How big a role he would have -- his standing in this squad.
    role: float = 0.5
    # Whether this is the club he is already at. Loyalty only applies here.
    incumbent: bool = True
    # What the club can spend before the tax line, in dollars. Informational:
    # nothing rejects an offer for breaking it, by design.
    cap_room: int = 0


def contender_rating(league, team_id: str) -> float:
    """How good this club is, 0-1, from the table it just finished in.

    Win percentage rather than a power ranking, because a player signing in
    July is reacting to a season that finished in June, not to a projection.
    """
    try:
        table = league.standings_table()
    except Exception:
        return 0.5
    for row in table:
        if row.get("team_id") == team_id:
            wins = row.get("wins", 0)
            losses = row.get("losses", 0)
            played = wins + losses
            if played <= 0:
                return 0.5
            return max(0.0, min(1.0, wins / played))
    return 0.5


def role_rating(team, player) -> float:
    """How big a part he would play here, 0-1.

    His ability against the rest of the squad. The best player on the roster
    scores 1.0 and the twelfth man scores near 0 -- and because it is measured
    against *this* squad, the same player is a starter at one club and a
    reserve at another, which is the whole point of the playing-time trait.
    """
    others = [p for p in getattr(team, "players", []) if p.id != player.id]
    if not others:
        return 1.0
    ranked = sorted(others, key=lambda p: -p.ability.current)
    better = sum(1 for p in ranked if p.ability.current > player.ability.current)
    # Five men start; being sixth-best is a real role, being twelfth is not.
    if better < 5:
        return 1.0 - better * 0.08          # 1.00 down to 0.68
    return max(0.0, 0.68 - (better - 4) * 0.09)


def situation(league, team, player, *, incumbent: bool = True) -> Situation:
    """Read a `Situation` off a real league."""
    from . import payroll

    return Situation(
        team_id=team.id,
        team_name=getattr(team, "full_name", team.id),
        contender=contender_rating(league, team.id),
        role=role_rating(team, player),
        incumbent=incumbent,
        cap_room=payroll.room_below_tax(team),
    )


# --------------------------------------------------------------------------
# What he is asking for
# --------------------------------------------------------------------------

# How far each trait can move the asking price, as a share of market value.
# Money is the big lever by design -- it is the trait that is *about* the
# salary. The other two are discounts a club earns by being somewhere he wants
# to be, and they are smaller because no player takes half pay for a good team.
MONEY_SWING = 0.22
WINNING_DISCOUNT = 0.12
LOYALTY_DISCOUNT = 0.10
# Being buried on a depth chart is a surcharge rather than a discount: he will
# come, but he wants paying for the bench.
ROLE_SURCHARGE = 0.18

# Below this role rating a player with high playing-time desire will not sign
# at any price. A negotiation that can always be won with money is not a
# negotiation, and this is the one hard "no" in the system.
ROLE_WALKOUT = 0.30
WALKOUT_DESIRE = 68.0


@dataclass
class Demand:
    """What he wants. Years, money, and how keen he is to be here."""

    years: int
    salary: int
    interest: float = 50.0        # 0-100, what a club is allowed to see
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "requestedYears": self.years,
            "requestedSalary": self.salary,
            "interest": round(self.interest, 1),
            "interestLabel": interest_label(self.interest),
            "reason": self.reason,
        }


INTEREST_BANDS: tuple[tuple[float, str], ...] = (
    (82.0, "Desperate to stay"),
    (66.0, "Keen to stay"),
    (50.0, "Open to staying"),
    (34.0, "Undecided"),
    (18.0, "Likely to leave"),
    (0.0, "Wants out"),
)


def interest_label(value: float) -> str:
    for floor, label in INTEREST_BANDS:
        if value >= floor:
            return label
    return INTEREST_BANDS[-1][1]


def interest_in_returning(player, where: Situation) -> float:
    """0-100: how much he wants to re-sign here.

    The one negotiation number a club is allowed to see, and it is a blend
    rather than a trait, so reading it does not tell you which trait produced
    it. A player at 40 might be unloved or underpaid or buried, and finding out
    which is what the negotiation is for.
    """
    p = personality_of(player)
    # The anchor is what a player with average traits, at an average club, in
    # an average role thinks -- so it has to sit in the middle band. At 42 it
    # did not: the ordinary case came out "Undecided" and two thirds of an
    # expiring class read as leaving, which makes the column useless for
    # spotting the ones who actually are.
    score = 50.0

    if where.incumbent:
        score += (p.loyalty - TRAIT_AVERAGE) * 0.42

    # A winner is worth more to someone who wants to win.
    score += (where.contender - 0.5) * (p.winning_desire / TRAIT_AVERAGE) * 34.0

    # And a role is worth more to someone who wants minutes.
    score += (where.role - 0.55) * (p.playing_time_desire / TRAIT_AVERAGE) * 32.0

    # A player whose current deal already pays above his worth would rather not
    # test a market that will price him honestly.
    contract = getattr(player, "contract", None)
    if contract is not None and where.incumbent:
        value = K.market_value(player)
        if value > 0:
            overpaid = (contract.salary - value) / value
            score += max(-12.0, min(14.0, overpaid * 22.0))

    return clamp_trait(score)


def asking_salary(player, where: Situation) -> int:
    """What he wants per year, in dollars.

    Market value moved by the four traits and by what the club is. Bounded by
    the same maximum a signing would be, so a demand is always a deal a club
    could legally meet.
    """
    p = personality_of(player)
    value = float(K.market_value(player))

    # Money desire pushes the ask up or down around market.
    factor = 1.0 + ((p.money_desire - TRAIT_AVERAGE) / TRAIT_AVERAGE) * MONEY_SWING

    # A contender earns a discount from a player who wants to win.
    if where.contender > 0.5:
        factor -= ((where.contender - 0.5) * 2.0
                   * (p.winning_desire / TRAIT_MAX) * WINNING_DISCOUNT)
    # A bad club pays a premium to the same player.
    else:
        factor += ((0.5 - where.contender) * 2.0
                   * (p.winning_desire / TRAIT_MAX) * WINNING_DISCOUNT * 0.8)

    # Loyalty is a discount to the incumbent and worth nothing to anyone else,
    # which is what makes holding on to your own players cheaper than signing
    # someone else's.
    if where.incumbent:
        factor -= (p.loyalty / TRAIT_MAX) * LOYALTY_DISCOUNT

    # A small role costs the club money.
    if where.role < 0.55:
        factor += ((0.55 - where.role) / 0.55
                   * (p.playing_time_desire / TRAIT_MAX) * ROLE_SURCHARGE)

    asked = value * max(0.55, factor)
    service = K.service_years(player)
    return int(max(K.MINIMUM_SALARY, min(float(K.max_salary(service)), asked)))


def asking_years(player, where: Situation) -> int:
    """How long a deal he wants.

    Not the same question as how long a club wants to give him. A player near
    the end wants the security of the longest deal he can get; a young one on
    the way up wants a short one so he can be paid properly sooner. That
    tension is the reason years are negotiated at all rather than assumed.
    """
    _label, shortest, longest = K.length_band(player)
    p = personality_of(player)

    # A young player with real headroom bets on himself and asks short.
    headroom = max(0.0, player.ability.potential - player.ability.current)
    if player.age <= 25 and headroom > 25.0 and p.money_desire > 55.0:
        return max(1, shortest)

    # An older player wants the years while someone is still offering them.
    if player.age >= K.VETERAN_AGE:
        return longest

    # Otherwise: someone who likes it here signs long, someone who does not
    # keeps his options open.
    if where.incumbent and p.loyalty >= 60.0:
        return longest
    if p.money_desire >= 70.0:
        return max(shortest, longest - 1)
    return max(shortest, min(longest, (shortest + longest + 1) // 2))


def demand(player, where: Situation) -> Demand:
    """The full ask: years, salary, and how keen he is."""
    interest = interest_in_returning(player, where)
    return Demand(
        years=asking_years(player, where),
        salary=asking_salary(player, where),
        interest=interest,
        reason=demand_reason(player, where),
    )


def demand_reason(player, where: Situation) -> str:
    """One sentence on what is driving this ask.

    Written from whichever trait actually moved the number furthest, so the
    sentence is an explanation rather than flavour text.
    """
    p = personality_of(player)
    weights = [
        (abs(p.money_desire - TRAIT_AVERAGE) * MONEY_SWING,
         "wants to be paid what he is worth"),
        (abs(where.contender - 0.5) * (p.winning_desire / TRAIT_MAX) * 100 * WINNING_DISCOUNT,
         "is weighing up whether this club can win"),
        (abs(where.role - 0.55) * (p.playing_time_desire / TRAIT_MAX) * 100 * ROLE_SURCHARGE,
         "wants to know what his role will be"),
        ((p.loyalty - TRAIT_AVERAGE) * LOYALTY_DISCOUNT if where.incumbent else 0.0,
         "would rather stay than move"),
    ]
    _weight, phrase = max(weights, key=lambda pair: pair[0])
    return f"{player.short_name} {phrase}."


# --------------------------------------------------------------------------
# The answer
# --------------------------------------------------------------------------

class Verdict(str, Enum):
    ACCEPT = "accept"
    COUNTER = "counter"
    REJECT = "reject"


@dataclass
class Offer:
    """What a club puts on the table."""

    years: int
    salary: int

    def to_dict(self) -> dict:
        return {"years": self.years, "salary": self.salary}


@dataclass
class Response:
    """What he says back."""

    verdict: Verdict
    message: str
    counter: Demand | None = None

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict.value,
            "message": self.message,
            "counter": self.counter.to_dict() if self.counter else None,
        }


# The three bands an offer falls into, as a share of what he asked for.
# Deliberately not symmetrical: a player takes slightly less than his ask
# without much fuss, which is what makes a first offer worth making, but the
# floor below which he stops talking is a long way down.
ACCEPT_RATIO = 0.955
REJECT_RATIO = 0.74

# Getting the years wrong is worth this much of the salary gap. A deal two
# years shorter than he wanted is a real objection, not a rounding error.
YEAR_PENALTY = 0.055


def evaluate(player, where: Situation, offer: Offer) -> Response:
    """Accept, counter or reject -- and say why.

    The whole decision is one ratio: what he was offered against what he
    wanted, with the years folded in as a discount on the money. Keeping it to
    one number is what makes the outcome explainable on screen, and what stops
    a screenful of special cases disagreeing with each other.
    """
    ask = demand(player, where)
    p = personality_of(player)

    # The hard no. A player who badly wants minutes will not sign to sit,
    # whatever the number is -- and this is checked before the money so that a
    # maximum offer cannot buy him.
    if (p.playing_time_desire >= WALKOUT_DESIRE and where.role <= ROLE_WALKOUT):
        return Response(
            Verdict.REJECT,
            f"{player.short_name} does not see a role for himself here and "
            f"will not sign at any price.",
        )

    if ask.salary <= 0:
        return Response(Verdict.ACCEPT, f"{player.short_name} signs.")

    ratio = offer.salary / ask.salary
    short_by = max(0, ask.years - offer.years)
    long_by = max(0, offer.years - ask.years)
    # Too few years is an objection. Too many is only an objection to a young
    # player who wanted to bet on himself -- for everyone else it is security.
    ratio -= short_by * YEAR_PENALTY
    if long_by and player.age <= 25:
        ratio -= long_by * YEAR_PENALTY * 0.5

    # Somewhere he wants to be moves the bar he will accept at, rather than the
    # number he asked for -- so a contender does not just pay less, it also
    # takes less convincing.
    bar = ACCEPT_RATIO
    if where.incumbent:
        bar -= (p.loyalty - TRAIT_AVERAGE) / TRAIT_AVERAGE * 0.05
    bar -= (where.contender - 0.5) * (p.winning_desire / TRAIT_MAX) * 0.06

    if ratio >= bar:
        return Response(
            Verdict.ACCEPT,
            f"{player.short_name} accepts {format_money(offer.salary)} a year "
            f"over {offer.years} {_years(offer.years)}.",
        )

    if ratio < REJECT_RATIO:
        return Response(
            Verdict.REJECT,
            f"{player.short_name} turns it down flat -- he is looking for "
            f"{format_money(ask.salary)} a year.",
            counter=ask,
        )

    # A counter meets in the middle, and where the middle is depends on how
    # hard he pushes: a money-motivated player barely moves.
    give = 0.5 - (p.money_desire - TRAIT_AVERAGE) / TRAIT_AVERAGE * 0.22
    give = max(0.15, min(0.7, give))
    middle = int(ask.salary - (ask.salary - offer.salary) * give)
    counter = Demand(
        years=ask.years if short_by or long_by else offer.years,
        salary=max(K.MINIMUM_SALARY, middle),
        interest=ask.interest,
        reason=ask.reason,
    )
    detail = (f" over {counter.years} {_years(counter.years)}"
              if counter.years != offer.years else "")
    return Response(
        Verdict.COUNTER,
        f"{player.short_name} counters at {format_money(counter.salary)} a year"
        f"{detail}.",
        counter=counter,
    )


def _years(count: int) -> str:
    return "year" if count == 1 else "years"


def format_money(amount: int) -> str:
    """$12.4M, or $980,000 below a million.

    One formatter, used by negotiation messages, news copy and the API, so the
    same salary never appears two ways on the same screen.
    """
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.1f}M"
    return f"${amount:,}"


# --------------------------------------------------------------------------
# Coaches
#
# The same protocol against different inputs. A coach has no ability rating, no
# squad role and no loyalty attribute, so his ask is standing plus a much
# simpler read of whether the job is a good one.
# --------------------------------------------------------------------------

COACH_MONEY_SWING = 0.16


def coach_personality(coach) -> Personality:
    """Four traits for a coach, drawn from his id and his ratings.

    Leadership stands in for loyalty and player management for how much he
    cares about the squad he would be handed; there is no coach equivalent of
    playing time, so it is fixed at average and does nothing. That is stated
    rather than hidden, because a trait that silently never matters is worse
    than one that is documented as inert.
    """
    existing = getattr(coach, "negotiation", None)
    if isinstance(existing, Personality):
        return existing
    rng = random.Random(seed_from_string(f"negotiation-coach-{coach.id}"))
    ratings = coach.ratings
    made = Personality(
        loyalty=clamp_trait(rng.gauss(ratings.leadership * 0.6 + 20.0, TRAIT_SPREAD)),
        money_desire=clamp_trait(rng.gauss(ratings.reputation * 0.5 + 25.0, TRAIT_SPREAD)),
        winning_desire=clamp_trait(rng.gauss(ratings.tactics * 0.5 + 25.0, TRAIT_SPREAD)),
        playing_time_desire=TRAIT_AVERAGE,
    )
    coach.negotiation = made
    return made


def coach_demand(coach, where: Situation) -> Demand:
    """What a head coach is asking for."""
    p = coach_personality(coach)
    value = float(K.coach_market_value(coach))
    factor = 1.0 + ((p.money_desire - TRAIT_AVERAGE) / TRAIT_AVERAGE) * COACH_MONEY_SWING
    if where.contender > 0.5:
        factor -= (where.contender - 0.5) * 2.0 * (p.winning_desire / TRAIT_MAX) * 0.10
    if where.incumbent:
        factor -= (p.loyalty / TRAIT_MAX) * 0.08

    rng = random.Random(seed_from_string(f"coach-years-{coach.id}"))
    years = K.coach_contract_length(coach, rng)

    interest = clamp_trait(
        46.0
        + (p.loyalty - TRAIT_AVERAGE) * (0.40 if where.incumbent else 0.0)
        + (where.contender - 0.5) * (p.winning_desire / TRAIT_AVERAGE) * 30.0
    )
    # Computed once. Written twice, it is two expressions that have to agree
    # forever -- and the sentence would quietly start describing a different
    # number the first time either changed.
    asked = int(max(K.COACH_MINIMUM_SALARY, value * max(0.6, factor)))
    return Demand(
        years=years,
        salary=asked,
        interest=interest,
        reason=f"{coach.short_name} is looking for {format_money(asked)} "
               f"a year over {years} {_years(years)}.",
    )


def evaluate_coach(coach, where: Situation, offer: Offer) -> Response:
    """The player protocol, against a coach's ask."""
    ask = coach_demand(coach, where)
    p = coach_personality(coach)

    ratio = offer.salary / max(1, ask.salary)
    ratio -= max(0, ask.years - offer.years) * YEAR_PENALTY

    bar = ACCEPT_RATIO
    if where.incumbent:
        bar -= (p.loyalty - TRAIT_AVERAGE) / TRAIT_AVERAGE * 0.05

    if ratio >= bar:
        return Response(
            Verdict.ACCEPT,
            f"{coach.short_name} accepts {format_money(offer.salary)} a year "
            f"over {offer.years} {_years(offer.years)}.",
        )
    if ratio < REJECT_RATIO:
        return Response(
            Verdict.REJECT,
            f"{coach.short_name} rejects the offer -- he is looking for "
            f"{format_money(ask.salary)} a year.",
            counter=ask,
        )
    give = max(0.2, min(0.7, 0.5 - (p.money_desire - TRAIT_AVERAGE) / TRAIT_AVERAGE * 0.2))
    middle = int(ask.salary - (ask.salary - offer.salary) * give)
    counter = Demand(years=ask.years, salary=max(K.COACH_MINIMUM_SALARY, middle),
                     interest=ask.interest, reason=ask.reason)
    return Response(
        Verdict.COUNTER,
        f"{coach.short_name} counters at {format_money(counter.salary)} a year "
        f"over {counter.years} {_years(counter.years)}.",
        counter=counter,
    )


# --------------------------------------------------------------------------
# Resolving a negotiation without a manager
#
# Twenty-nine clubs are not being played by anybody, and half the league
# reaches free agency every summer. The AI has to be able to do this on its
# own, and it has to reach the same answer a sensible manager would or the
# league drifts away from the one the player is managing.
# --------------------------------------------------------------------------

# How hard an AI club pushes its first offer below the ask. A front office
# opens under the number and expects to be countered.
AI_OPENING = 0.90

# How much over his market value a club will go to keep a man. Beyond this it
# lets him walk, which is what stops AI clubs re-signing everybody forever and
# turning free agency into an empty room.
AI_CEILING = 1.18


def auto_resolve(player, where: Situation, *, rounds: int = 3) -> tuple[bool, Demand | None]:
    """Negotiate on a club's behalf. Returns (signed, agreed terms).

    Three rounds, opening low and conceding toward the ask, stopping if the
    price passes what the club thinks he is worth. Deterministic: the same
    player and situation always reach the same outcome, so an offseason replays
    identically.
    """
    ask = demand(player, where)
    ceiling = int(K.market_value(player) * AI_CEILING)
    offer = Offer(years=ask.years, salary=int(ask.salary * AI_OPENING))

    for _ in range(max(1, rounds)):
        if offer.salary > ceiling:
            return False, None
        response = evaluate(player, where, offer)
        if response.verdict is Verdict.ACCEPT:
            return True, Demand(years=offer.years, salary=offer.salary,
                                interest=ask.interest)
        if response.counter is None:
            return False, None
        # Move to what he countered with, if the club can stomach it.
        offer = Offer(years=response.counter.years, salary=response.counter.salary)

    if offer.salary <= ceiling:
        response = evaluate(player, where, offer)
        if response.verdict is Verdict.ACCEPT:
            return True, Demand(years=offer.years, salary=offer.salary,
                                interest=ask.interest)
    return False, None


def auto_resolve_coach(coach, where: Situation, *, rounds: int = 3) -> tuple[bool, Demand | None]:
    ask = coach_demand(coach, where)
    ceiling = int(K.coach_market_value(coach) * AI_CEILING)
    offer = Offer(years=ask.years, salary=int(ask.salary * AI_OPENING))

    for _ in range(max(1, rounds)):
        if offer.salary > ceiling:
            return False, None
        response = evaluate_coach(coach, where, offer)
        if response.verdict is Verdict.ACCEPT:
            return True, Demand(years=offer.years, salary=offer.salary,
                                interest=ask.interest)
        if response.counter is None:
            return False, None
        offer = Offer(years=response.counter.years, salary=response.counter.salary)
    return False, None
