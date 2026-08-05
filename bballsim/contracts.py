"""Contracts: what a player or a coach is owed, and for how long.

A contract is the first thing in this project that is neither a rating nor a
result. It is an *agreement* -- a fact about the club and the man together --
and that makes it the join every franchise feature hangs off: payroll reads it,
negotiation writes it, free agency is what happens when one runs out, and a
trade is two clubs swapping them. So it lives here, on its own, rather than as
four fields bolted to `Player`.

**The money is real dollars, stored as integers.** Not millions, not a 0-100
"wage" abstraction. Payroll is a sum over fifteen contracts across thirty clubs
and it has to add up exactly; floats do not, and a screen that says a club is
$1,240,000 over the tax cannot be built on a number that drifts. Everything
here rounds to whole dollars at the point of creation, once.

**What sets a salary.** A contract is not paid for ability alone -- it is paid
for what a club expects to get, which is ability *plus* how much of a career is
left to get it over. So the curve below prices current ability, and age and
potential move a player along it: a 22-year-old and a 34-year-old with the same
CA are not the same asset and are not paid the same.

    value = curve(CA) x age x potential x position

Each of those four is a separate function below, and each is calibrated against
one measurable thing: thirty clubs, fifteen men each, should add up to roughly
a league of teams sitting a little over the cap, the way real ones do.

**The cap is declared and not enforced.** `SALARY_CAP`, the tax line and the
maximum tiers are all real numbers here and nothing rejects a signing that
breaks them. That is deliberate: the constants are the anchor a future cap
system needs, and writing them now means payroll screens, trade value and
negotiation are already denominated against the right scale. When enforcement
arrives it changes what is *allowed*, not what anything is worth.

**Designed to be extended, and honest about what is missing.** `Contract`
carries fields for team and player options, guarantees and no-trade clauses.
None of them are exercised anywhere yet -- they are storage with a shape, so
that adding the rules later does not mean a migration. They are documented as
inert where they are declared rather than left to look implemented.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum

from .engine.rng import seed_from_string

# --------------------------------------------------------------------------
# The money. Anchored to a modern NBA cap so the numbers read as real to
# anyone who follows the sport, and so future cap rules have a scale that is
# already right.
# --------------------------------------------------------------------------

SALARY_CAP = 154_647_000
LUXURY_TAX_LINE = 187_895_000
FIRST_APRON = 195_945_000
SECOND_APRON = 207_824_000

# The three maximum tiers, by years of service. Real leagues gate the biggest
# contracts behind seniority, which is why a 21-year-old superstar cannot be
# paid what a 30-year-old one is -- and why his second contract is the famous
# one. `max_salary` applies it.
MAX_SHARE_BY_SERVICE: tuple[tuple[int, float], ...] = (
    (10, 0.35),   # ten years and up
    (7, 0.30),    # seven to nine
    (0, 0.25),    # everyone else
)

# The floor. Nobody in the league is on less than this, and a large share of
# any roster is on exactly it.
MINIMUM_SALARY = 1_272_870

# Teams must spend at least this share of the cap. Declared for the same reason
# as the cap itself: a future finances screen needs the line to draw.
SALARY_FLOOR_SHARE = 0.90


def max_salary(service_years: int) -> int:
    """The most this player may legally be paid, by years of service."""
    for floor, share in MAX_SHARE_BY_SERVICE:
        if service_years >= floor:
            return round(SALARY_CAP * share)
    return round(SALARY_CAP * MAX_SHARE_BY_SERVICE[-1][1])


class ContractType(str, Enum):
    """What kind of deal this is.

    The type is a *classification* of a signed contract, not a separate set of
    rules -- `classify` reads it back off the salary and the player. That way a
    contract cannot claim to be a maximum while paying eight million.
    """

    ROOKIE = "rookie"            # first professional deal, drafted
    STANDARD = "standard"
    MAXIMUM = "maximum"
    MINIMUM = "minimum"
    TWO_WAY = "two_way"          # declared; nothing generates one yet
    COACH = "coach"

    @property
    def label(self) -> str:
        return {
            ContractType.ROOKIE: "Rookie Scale",
            ContractType.STANDARD: "Standard",
            ContractType.MAXIMUM: "Maximum",
            ContractType.MINIMUM: "Minimum",
            ContractType.TWO_WAY: "Two-Way",
            ContractType.COACH: "Coaching",
        }[self]


@dataclass
class Contract:
    """One agreement. Held by a player or a coach; read by everything else.

    `years` is what was signed, `years_remaining` is what is left. Both are
    kept because a screen wants to say "3 of 4 years" and because the original
    length is what a future extension or buyout is priced against -- deriving
    it back from a decremented counter is not possible.
    """

    years: int = 1
    years_remaining: int = 1
    salary: int = MINIMUM_SALARY
    contract_type: ContractType = ContractType.STANDARD

    # The season this was signed in, e.g. "2026-27". Used by news ("signed a
    # four-year deal last summer") and by Bird rights when they arrive.
    signed_season: str = ""

    # -- Declared, inert, and deliberately so ----------------------------
    # Nothing below is exercised by any rule in the codebase today. They exist
    # so that the storage shape does not have to change when the rules do, and
    # they are listed here rather than quietly omitted so nobody reads the
    # model as claiming more than it does.
    team_option: bool = False      # club may extend for a further year
    player_option: bool = False    # player may extend for a further year
    no_trade: bool = False
    guaranteed: bool = True

    @property
    def expiring(self) -> bool:
        """In its final year -- the season after which he can walk."""
        return self.years_remaining <= 1

    @property
    def expired(self) -> bool:
        """Run out. He is not a free agent until the offseason says so."""
        return self.years_remaining <= 0

    @property
    def total_value(self) -> int:
        """What the whole deal is worth, at a flat annual salary."""
        return self.salary * self.years

    @property
    def remaining_value(self) -> int:
        return self.salary * max(0, self.years_remaining)

    @property
    def years_served(self) -> int:
        return max(0, self.years - self.years_remaining)

    def to_dict(self) -> dict:
        return {
            "contractYears": self.years,
            "yearsRemaining": self.years_remaining,
            "salary": self.salary,
            "contractType": self.contract_type.value,
            "contractTypeLabel": self.contract_type.label,
            "signedSeason": self.signed_season,
            "expiring": self.expiring,
            "expired": self.expired,
            "totalValue": self.total_value,
            "remainingValue": self.remaining_value,
            "teamOption": self.team_option,
            "playerOption": self.player_option,
            "noTrade": self.no_trade,
            "guaranteed": self.guaranteed,
        }


# --------------------------------------------------------------------------
# What a player is worth
#
# The curve is anchored on `ability.CA_TIERS`, which is the table the rest of
# the project already uses to say what a CA number means. Pricing against the
# same tiers is what keeps "All-Star" and "paid like an All-Star" the same
# statement -- if the tier boundaries ever move, the money moves with them
# instead of quietly disagreeing.
#
# Shares are of the cap, so every number below reads as a percentage a fan
# would recognise: a maximum is 25-35%, a good starter is around 15%, a
# rotation piece is 5%.
# --------------------------------------------------------------------------

# Calibrated, not chosen: the first pass put 24 of 30 clubs into the luxury tax
# and -- worse -- paid the All-Star tier *more* on average than the Elite tier
# above it. That inversion was the curve running so hot above CA 145 that the
# maximum bound on everybody, and once every star is on a max, the only thing
# separating their salaries is how many years of service they have. The curve
# now clears the max only where it should: a genuine All-Star gets near it, and
# an elite one gets it.
VALUE_CURVE: tuple[tuple[float, float], ...] = (
    (180.0, 0.345),   # Generational
    (162.0, 0.285),   # Elite NBA
    (145.0, 0.205),   # All-Star
    (128.0, 0.122),   # High-end starter
    (112.0, 0.072),   # Average starter
    (95.0, 0.036),    # Rotation player
    (78.0, 0.013),    # Bench player
    # The bottom of the curve has to fall *below* the minimum salary, or the
    # minimum is a constant nobody is ever actually paid. A first pass floored
    # the fringe tier at about $2M and produced exactly one minimum contract in
    # a league of 360 -- where a real roster's last three or four names are all
    # on one.
    (60.0, 0.004),    # Fringe NBA
    (0.0, 0.002),
)


def interpolate(curve: tuple[tuple[float, float], ...], value: float) -> float:
    """Straight-line read of a descending anchor table.

    The same shape as `health.interpolate`. Tables are written high-to-low
    because that is how the tier tables elsewhere read.
    """
    if value >= curve[0][0]:
        return curve[0][1]
    for index in range(len(curve) - 1):
        high_x, high_y = curve[index]
        low_x, low_y = curve[index + 1]
        if value >= low_x:
            span = high_x - low_x
            if span <= 0:
                return low_y
            t = (value - low_x) / span
            return low_y + (high_y - low_y) * t
    return curve[-1][1]


# Age. A contract buys future seasons, so it is priced on how many good ones
# are left rather than on how old he is in the abstract. Peak earning age is
# the late twenties: young enough to have the years, old enough to have proved
# it.
AGE_CURVE: tuple[tuple[float, float], ...] = (
    (36.0, 0.55),
    (34.0, 0.72),
    (32.0, 0.88),
    (30.0, 1.00),
    (27.0, 1.06),
    (25.0, 1.04),
    (23.0, 0.96),
    (21.0, 0.88),
    (0.0, 0.82),
)

# Unrealised potential is worth money, but only to a player young enough to
# still reach it -- which is why this is scaled by the age curve's own logic
# rather than applied flat. A 33-year-old with 30 points of headroom is not
# going to spend them.
POTENTIAL_SWING = 0.22
POTENTIAL_AGE_LIMIT = 27.0

# Position. Not a statement about which position is better -- CA already knows
# that -- but about scarcity of the *type*. Lead guards and rim-protecting
# centres are the two markets that historically run hot.
POSITION_MULTIPLIER: dict[str, float] = {
    "PG": 1.03,
    "SG": 0.99,
    "SF": 1.00,
    "PF": 0.99,
    "C": 1.02,
}


def age_multiplier(age: int) -> float:
    return interpolate(AGE_CURVE, float(age))


def potential_multiplier(player) -> float:
    """What the unrealised part of a young player's ceiling adds.

    Headroom is CA-to-PA on the 0-200 scale. Fifty points of it on a
    twenty-two-year-old is a franchise bet; the same fifty on a thirty-year-old
    is a scout's error, and this returns 1.0 for him.
    """
    headroom = max(0.0, player.ability.potential - player.ability.current)
    if player.age >= POTENTIAL_AGE_LIMIT or headroom <= 0:
        return 1.0
    # Full weight at 21 and below, tapering to nothing at the age limit.
    youth = min(1.0, max(0.0, (POTENTIAL_AGE_LIMIT - player.age) / 6.0))
    return 1.0 + (headroom / 60.0) * POTENTIAL_SWING * youth


def position_multiplier(player) -> float:
    return POSITION_MULTIPLIER.get(player.position.value, 1.0)


def market_value(player) -> int:
    """What this player would command on an open market, in dollars a year.

    The number every other money question is asked against: what he should be
    paid, whether his current deal is good business, what a rival would have to
    offer, and -- when trades arrive -- whether a contract is an asset or a
    problem. It is computed, never stored, so it moves the moment he does.
    """
    share = interpolate(VALUE_CURVE, player.ability.current)
    value = SALARY_CAP * share
    value *= age_multiplier(player.age)
    value *= potential_multiplier(player)
    value *= position_multiplier(player)

    service = service_years(player)
    return int(max(MINIMUM_SALARY, min(float(max_salary(service)), value)))


def service_years(player) -> int:
    """Seasons played as a professional.

    Read off the career profile where there is one, and estimated from age
    otherwise so a league that has never run an offseason still prices its
    veterans as veterans rather than as rookies.
    """
    profile = getattr(player, "career", None)
    seasons = getattr(profile, "seasons_played", None)
    if seasons is not None:
        return int(seasons)
    return max(0, player.age - 22)


# --------------------------------------------------------------------------
# How long a deal runs
#
# The brief's bands, and the reasoning behind each is the same one a real front
# office uses: you sign a man for as long as you expect him to be worth it.
# A 24-year-old All-Star is worth it for five more years. A 35-year-old is
# worth it for one, and both parties know it.
# --------------------------------------------------------------------------

# Age at which a club stops guaranteeing years regardless of how good he is.
VETERAN_AGE = 34

# What counts as young enough for a club to pay for the years rather than the
# player -- the "young star" band the brief asks for.
YOUNG_STAR_AGE = 26

# (label, minimum CA, shortest, longest). Ability only: age is handled above
# this table, because mixing an age ceiling into the ability ladder is what
# made the first version wrong. A `max_age` column on the veteran row meant
# every *young* low-CA player fell through the ability bands and matched the
# veteran row on age -- so a 25-year-old twelfth man was labelled a veteran and
# the fringe row below it was unreachable.
LENGTH_BANDS: tuple[tuple[str, float, int, int], ...] = (
    ("superstar",   162.0, 4, 5),
    ("starter",     128.0, 3, 4),
    ("role player",  95.0, 2, 4),
    ("fringe",        0.0, 1, 2),
)


def length_band(player) -> tuple[str, int, int]:
    """Which band this player falls in, and the shortest/longest deal in it."""
    ca = player.ability.current
    # A veteran is a veteran whatever his ability: age caps the years a club
    # will guarantee, so it is asked first, or a 35-year-old All-Star gets five.
    if player.age >= VETERAN_AGE:
        return ("veteran", 1, 2)
    # A young star is bet on rather than paid for: same length as a superstar
    # at ability a tier below, because the years are the point.
    if ca >= 140.0 and player.age <= YOUNG_STAR_AGE:
        return ("young star", 4, 5)
    for label, min_ca, shortest, longest in LENGTH_BANDS:
        if ca >= min_ca:
            return (label, shortest, longest)
    return ("fringe", 1, 2)


def contract_length(player, rng: random.Random) -> int:
    _label, shortest, longest = length_band(player)
    return rng.randint(shortest, longest)


def classify(player, salary: int, years: int) -> ContractType:
    """Name a deal from what it actually pays.

    Read back off the numbers rather than chosen alongside them, so a contract
    cannot be labelled a maximum while paying the minimum.
    """
    service = service_years(player)
    if salary >= max_salary(service) * 0.97:
        return ContractType.MAXIMUM
    if salary <= MINIMUM_SALARY * 1.02:
        return ContractType.MINIMUM
    # A first deal, still running, for someone young enough that it can only be
    # his rookie contract.
    if service <= 3 and player.age <= 24:
        return ContractType.ROOKIE
    return ContractType.STANDARD


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

# How much a generated salary is allowed to wander from market value. Real
# rosters are full of deals that look wrong -- an overpay from two summers ago,
# a bargain a club talked someone into -- and a league where every contract is
# exactly right has no trades worth making and no decisions worth taking.
#
# Tightened from 0.16, which was drawing 1.2x outliers often enough that the
# league's best-paid player was routinely not one of its best players.
SALARY_NOISE = 0.12


def generate(player, rng: random.Random, *, season: str = "",
             stagger: bool = True) -> Contract:
    """A believable contract for a player who is already on a roster.

    `stagger` is what stops the whole league reaching free agency in the same
    summer. A new save has no signing history to read, so years remaining is
    drawn inside the deal's length: some men are in year one of four, some are
    in the last year of two, and the expiring class is a fraction of the league
    rather than all of it.
    """
    years = contract_length(player, rng)
    value = market_value(player)
    salary = int(max(MINIMUM_SALARY, value * rng.gauss(1.0, SALARY_NOISE)))
    service = service_years(player)
    salary = min(salary, max_salary(service))

    remaining = rng.randint(1, years) if stagger else years
    return Contract(
        years=years,
        years_remaining=remaining,
        salary=salary,
        contract_type=classify(player, salary, years),
        signed_season=season,
    )


def generate_for_league(teams, *, season: str = "", seed: str = "contracts") -> None:
    """Give every player on every club a contract. Idempotent by design.

    A player who already has one keeps it -- so this can be called on load to
    fill in a league saved before contracts existed, without rewriting the
    deals of one that was not.
    """
    for team in teams:
        for player in team.players:
            if getattr(player, "contract", None) is not None:
                continue
            rng = random.Random(seed_from_string(f"{seed}-{player.id}"))
            player.contract = generate(player, rng, season=season)


# --------------------------------------------------------------------------
# Coaches
#
# The same model, priced off reputation and skill instead of CA. A coach is
# hired for what a club believes he is, which is why reputation carries more
# weight here than in anything the engine does with him.
# --------------------------------------------------------------------------

COACH_VALUE_CURVE: tuple[tuple[float, float], ...] = (
    (92.0, 12_000_000.0),   # All-time great
    (84.0, 9_000_000.0),    # Elite
    (75.0, 6_500_000.0),    # Highly regarded
    (64.0, 4_500_000.0),    # Well respected
    (52.0, 3_200_000.0),    # Solid
    (40.0, 2_300_000.0),    # Journeyman
    (28.0, 1_700_000.0),    # Struggling
    (0.0, 1_200_000.0),     # Out of his depth
)

COACH_MINIMUM_SALARY = 1_000_000

# Length by standing. An elite coach signs long because a club is buying
# stability; a coach on thin ice signs one year and has to earn the next.
COACH_LENGTH_BANDS: tuple[tuple[float, int, int], ...] = (
    (84.0, 4, 5),
    (70.0, 3, 5),
    (55.0, 2, 4),
    (40.0, 2, 3),
    (0.0, 1, 2),
)


def coach_standing(coach) -> float:
    """The 0-100 number a coach is paid against.

    Reputation is what gets a man hired, but a club that has watched him work
    is paying for the work: two thirds standing, one third what he can actually
    do. `coach.tier` reads reputation alone, so this is deliberately not that.
    """
    ratings = coach.ratings
    skill = (ratings.offense + ratings.defense + ratings.tactics
             + ratings.development + ratings.leadership) / 5.0
    return 0.62 * ratings.reputation + 0.38 * skill


def coach_market_value(coach) -> int:
    """What a head coach commands, in dollars a year."""
    value = interpolate(COACH_VALUE_CURVE, coach_standing(coach))
    # Experience is worth something on its own -- a club pays for having seen
    # him do it before -- and it flattens out after a decade in the job.
    value *= 1.0 + min(coach.seasons_coached, 12) * 0.012
    return int(max(COACH_MINIMUM_SALARY, value))


def coach_contract_length(coach, rng: random.Random) -> int:
    standing = coach_standing(coach)
    for floor, shortest, longest in COACH_LENGTH_BANDS:
        if standing >= floor:
            return rng.randint(shortest, longest)
    return 1


def generate_coach(coach, rng: random.Random, *, season: str = "",
                   stagger: bool = True) -> Contract:
    years = coach_contract_length(coach, rng)
    salary = int(max(COACH_MINIMUM_SALARY,
                     coach_market_value(coach) * rng.gauss(1.0, SALARY_NOISE)))
    return Contract(
        years=years,
        years_remaining=rng.randint(1, years) if stagger else years,
        salary=salary,
        contract_type=ContractType.COACH,
        signed_season=season,
    )


def generate_coaches_for_league(teams, *, season: str = "",
                                seed: str = "coach-contracts") -> None:
    for team in teams:
        coach = getattr(team, "coach", None)
        if coach is None or getattr(coach, "contract", None) is not None:
            continue
        rng = random.Random(seed_from_string(f"{seed}-{coach.id}"))
        coach.contract = generate_coach(coach, rng, season=season)


# --------------------------------------------------------------------------
# The clock
# --------------------------------------------------------------------------

def tick_down(contract: Contract | None) -> Contract | None:
    """One season served. Returns the contract for chaining; None passes through.

    Stops at zero rather than going negative: an expired contract is expired,
    and a counter running to -3 would make "how long has he been unsigned"
    look like a contract term.
    """
    if contract is None:
        return None
    contract.years_remaining = max(0, contract.years_remaining - 1)
    return contract


def sign(holder, years: int, salary: int, *, season: str = "",
         contract_type: ContractType | None = None) -> Contract:
    """Put a new contract on a player or a coach.

    One function for both, because a signing is the same event whoever it
    happens to -- and because everything that records signings (news, payroll,
    the transaction log) wants one shape rather than two.
    """
    is_coach = hasattr(holder, "ratings") and not hasattr(holder, "ability")
    if contract_type is None:
        contract_type = (ContractType.COACH if is_coach
                         else classify(holder, salary, years))
    contract = Contract(
        years=int(years),
        years_remaining=int(years),
        salary=int(salary),
        contract_type=contract_type,
        signed_season=season,
    )
    holder.contract = contract
    return contract
