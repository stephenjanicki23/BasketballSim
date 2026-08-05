"""What a player is worth to a *particular* club.

The distinction in that sentence is the whole module. `contracts.market_value`
already answers "what would an open market pay him", and that is a fact about
the player. This answers "what would Redstone give up for him", which is a fact
about the player *and* the club, and the two are routinely far apart:

    a 33-year-old on a maximum        priceless to a favourite, worthless to a tanking club
    a 21-year-old with a huge ceiling  the reverse
    an expiring contract               nearly valueless on the floor, valuable as cap relief

So there are two numbers here. `base_value` is what he is worth to nobody in
particular -- ability, age, contract, durability, position -- and is the number
a screen shows. `value_to` takes that and reweights it through a club's
timeline, identity and window, and is the number the trade engine actually
adds up.

**Units.** Everything is in the same scale as `draft_picks.slot_value`, so a
player and a pick can be summed on one side of a deal without a conversion
constant sitting between them. A first overall pick is 1000; a league-average
starter is a few hundred.

**What the brief asked for that is not here.** Marketability, popularity and
fan-favourite status are named in the brief and are not modelled anywhere in
this project, so rather than invent three numbers, `marketability` reads the
two hidden attributes that genuinely exist (`media_handling`,
`locker_room_presence`) and is documented as the thin proxy it is. Playoff
performance and championship experience are similarly absent per-player -- the
league records neither -- and are not faked. See `docs/TRADES.md`.
"""

from __future__ import annotations

from . import contracts as K
from .ratings import SCALE_MAX

# The scale everything here is denominated in, shared with draft picks so the
# two can be added. A generational player tops out around 2,600 -- more than
# two first overall picks, which is roughly the real exchange rate.
ABILITY_CURVE: tuple[tuple[float, float], ...] = (
    (190.0, 2600.0),
    (175.0, 1850.0),
    (162.0, 1300.0),
    (150.0, 900.0),
    (140.0, 640.0),
    (128.0, 420.0),
    (115.0, 250.0),
    (100.0, 130.0),
    (85.0, 60.0),
    (70.0, 22.0),
    (0.0, 5.0),
)


def interpolate(curve: tuple[tuple[float, float], ...], value: float) -> float:
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


# --------------------------------------------------------------------------
# Position scarcity
#
# The brief asks for this explicitly and it is real: an elite two-way wing and
# a backup centre are not interchangeable assets even at equal ability. The
# multiplier applies *at the top* and fades toward the bottom, because scarcity
# is a property of good players -- there is no shortage of replacement-level
# anybody.
# --------------------------------------------------------------------------

POSITION_SCARCITY = {
    "PG": 1.10,   # a franchise lead guard is the rarest thing in the sport
    "SG": 1.00,
    "SF": 1.08,   # two-way wings
    "PF": 1.02,
    "C": 0.96,    # the most replaceable starting spot in a modern league
}

# Above this ability, scarcity applies in full; below it, it fades to nothing.
SCARCITY_FLOOR = 100.0
SCARCITY_FULL = 150.0


def scarcity_multiplier(player) -> float:
    base = POSITION_SCARCITY.get(player.position.value, 1.0)
    ca = player.ability.current
    if ca <= SCARCITY_FLOOR:
        return 1.0
    reach = min(1.0, (ca - SCARCITY_FLOOR) / (SCARCITY_FULL - SCARCITY_FLOOR))
    return 1.0 + (base - 1.0) * reach


# --------------------------------------------------------------------------
# Age and the shape of what is left
# --------------------------------------------------------------------------

AGE_CURVE: tuple[tuple[float, float], ...] = (
    (37.0, 0.22),
    (35.0, 0.38),
    (33.0, 0.62),
    (31.0, 0.82),
    (29.0, 0.96),
    (27.0, 1.06),
    (25.0, 1.14),
    (23.0, 1.18),
    (21.0, 1.16),
    (0.0, 1.08),
)


def age_multiplier(age: int) -> float:
    return interpolate(AGE_CURVE, float(age))


# How much unrealised ceiling is worth, before a club's own view of it.
POTENTIAL_SWING = 0.55
POTENTIAL_AGE_LIMIT = 28.0


def potential_multiplier(player) -> float:
    headroom = max(0.0, player.ability.potential - player.ability.current)
    if headroom <= 0 or player.age >= POTENTIAL_AGE_LIMIT:
        return 1.0
    youth = min(1.0, (POTENTIAL_AGE_LIMIT - player.age) / 8.0)
    return 1.0 + (headroom / 55.0) * POTENTIAL_SWING * youth


# --------------------------------------------------------------------------
# The contract
#
# A contract is an asset or a liability and nothing in between. A star on a
# below-market deal is worth more than the same star on a maximum, because the
# club acquiring him also acquires the surplus.
# --------------------------------------------------------------------------

CONTRACT_SWING = 0.30


def contract_multiplier(player) -> float:
    """How much the deal itself adds or subtracts.

    Measured against what he is worth on an open market, so an overpay is a
    penalty and a bargain is a bonus. Bounded, because even a terrible contract
    on a very good player does not make him worthless.
    """
    contract = getattr(player, "contract", None)
    if contract is None or getattr(contract, "expired", False):
        return 1.0
    market = K.market_value(player)
    if market <= 0:
        return 1.0
    surplus = (market - contract.salary) / market
    return max(0.62, min(1.34, 1.0 + surplus * CONTRACT_SWING))


# --------------------------------------------------------------------------
# The body
# --------------------------------------------------------------------------

def durability_multiplier(player) -> float:
    """What the injury record does to his price.

    Reads the health model that already exists: career wear, games missed and
    whether he is hurt right now. A player on the shelf is worth materially
    less than the same player available, which is exactly how a deadline works.
    """
    health = getattr(player, "health", None)
    if health is None:
        return 1.0
    factor = 1.0
    factor -= min(0.22, (getattr(health, "wear", 0.0) or 0.0) / 100.0 * 0.28)
    missed = getattr(health, "games_missed", 0) or 0
    factor -= min(0.14, missed * 0.006)
    if getattr(health, "injury", None) is not None:
        factor -= 0.16
    # Injury proneness is hidden and known only to a club that has scouted him,
    # but it is a real property of the player and it belongs in his value.
    proneness = getattr(getattr(player, "hidden", None), "injury_proneness", None)
    if proneness is not None:
        factor -= (proneness - 10.0) / SCALE_MAX * 0.16
    return max(0.5, factor)


def character_multiplier(player) -> float:
    """Professionalism and temperament, which change what a club is buying."""
    hidden = getattr(player, "hidden", None)
    if hidden is None:
        return 1.0
    professionalism = getattr(hidden, "professionalism", 10.0)
    temperament = getattr(hidden, "temperament", 10.0)
    swing = ((professionalism - 10.0) * 0.6 + (temperament - 10.0) * 0.4)
    return max(0.86, min(1.12, 1.0 + swing / SCALE_MAX * 0.24))


def marketability(player) -> float:
    """0-100. **A thin proxy, and labelled as one.**

    The brief asks for marketability, popularity and fan-favourite status.
    None of the three is modelled in this project -- there is no attendance, no
    merchandise, no fan sentiment anywhere. Rather than invent them, this reads
    the two hidden attributes that do exist and are adjacent, and the trade
    engine gives it the 5% the brief allocates and no more.
    """
    hidden = getattr(player, "hidden", None)
    if hidden is None:
        return 50.0
    media = getattr(hidden, "media_handling", 10.0)
    presence = getattr(hidden, "locker_room_presence", 10.0)
    ability = min(1.0, player.ability.current / 170.0)
    base = (media * 0.5 + presence * 0.5) / SCALE_MAX * 100.0
    # Stardom is most of real marketability, so ability carries most of it.
    return max(0.0, min(100.0, base * 0.35 + ability * 65.0))


# --------------------------------------------------------------------------
# The base number
# --------------------------------------------------------------------------

def base_value(player) -> float:
    """What this player is worth to nobody in particular.

    The number a screen shows and the starting point for every club's own
    valuation.
    """
    value = interpolate(ABILITY_CURVE, player.ability.current)
    value *= age_multiplier(player.age)
    value *= potential_multiplier(player)
    value *= scarcity_multiplier(player)
    value *= contract_multiplier(player)
    value *= durability_multiplier(player)
    value *= character_multiplier(player)
    return max(1.0, value)


def production_multiplier(league, player) -> float:
    """What he has actually done this season, against what he should have.

    This is the part that makes trade value *move during a season*, which the
    brief asks for twice. Ability changes once a year; production changes every
    night, and a player having a career year is worth more in February than he
    was in October.
    """
    line = league.stats.players.get(player.id) if hasattr(league, "stats") else None
    if line is None or line.games < 3:
        return 1.0

    from .league.advanced import advanced_table

    cache = getattr(league, "_trade_advanced_cache", None)
    played = sum(1 for _ in league.stats.players)
    if not cache or cache[0] != played:
        cache = (played, {row["player_id"]: row for row in advanced_table(league.stats)})
        league._trade_advanced_cache = cache
    row = cache[1].get(player.id)
    if row is None:
        return 1.0

    # PER is centred on 15 by construction, which makes it the cleanest
    # available "is he playing above or below himself" signal.
    per = float(row.get("per", 15.0) or 15.0)
    expected = 10.0 + player.ability.current / 200.0 * 16.0
    if expected <= 0:
        return 1.0
    ratio = per / expected
    # Bounded hard. A hot fortnight should nudge a price, not double it.
    return max(0.82, min(1.22, 1.0 + (ratio - 1.0) * 0.35))


def value_of(league, player) -> float:
    """Base value with this season's production folded in."""
    return base_value(player) * production_multiplier(league, player)


# --------------------------------------------------------------------------
# What he is worth to a particular club
# --------------------------------------------------------------------------

# How far a club's timeline can move a player's price. Large, because this is
# the entire premise: a rebuilding club and a favourite should put genuinely
# different numbers on the same veteran.
TIMELINE_SWING = 0.55


def _age_appetite(situation, player) -> float:
    """How much this club wants a player of this age, -1 to +1.

    A contender wants prime and proven; a rebuild wants young and unfinished.
    """
    from .front_office import Timeline

    phase = situation.timeline
    age = player.age
    if phase in (Timeline.FAVOURITE, Timeline.CONTENDER):
        if age <= 22:
            return -0.55        # cannot help now
        if age <= 32:
            return 0.35
        return 0.10             # still useful; a short deal is fine
    if phase in (Timeline.PLAYOFF, Timeline.PLAY_IN, Timeline.MIDDLE):
        return 0.15 if 23 <= age <= 30 else -0.10
    # Rebuilding, in some form.
    if age <= 23:
        return 0.60
    if age <= 26:
        return 0.20
    if age <= 30:
        return -0.35
    return -0.75


def value_to(league, situation, player) -> float:
    """What this player is worth **to this club**.

    The number the trade engine adds up, and the reason two clubs answer the
    same offer differently.
    """
    from .front_office import Timeline

    value = value_of(league, player)
    ident = situation.identity

    # 1. Timeline. The dominant term.
    value *= 1.0 + _age_appetite(situation, player) * TIMELINE_SWING

    # 2. Ceiling versus certainty. A rebuild pays for what he might become; a
    #    contender pays only for what he already is.
    headroom = max(0.0, player.ability.potential - player.ability.current)
    if situation.timeline.selling:
        value *= 1.0 + min(0.30, headroom / 60.0 * 0.30)
    elif situation.timeline is Timeline.FAVOURITE:
        value *= 1.0 - min(0.12, headroom / 60.0 * 0.12)

    # 3. Identity. A club that believes in its own development staff pays for
    #    potential; one that does not, does not.
    value *= 1.0 + (ident.development_focus - 50.0) / 50.0 * (headroom / 60.0) * 0.18
    value *= 1.0 + (ident.veteran_preference - 50.0) / 50.0 * (
        0.12 if player.age >= 30 else -0.06)
    value *= 1.0 + (ident.risk_tolerance - 50.0) / 50.0 * (
        0.10 if durability_multiplier(player) < 0.9 else 0.0)

    # 4. Analytics. A club that trusts the numbers pays for production and
    #    discounts reputation; one that does not, reverses it.
    if ident.analytics_focus != 50.0:
        edge = production_multiplier(league, player) - 1.0
        value *= 1.0 + (ident.analytics_focus - 50.0) / 50.0 * edge * 0.8

    # 5. An expiring contract is cap relief, which a club under financial
    #    pressure wants and a club with room does not care about.
    contract = getattr(player, "contract", None)
    if contract is not None and getattr(contract, "expiring", False):
        if situation.tax_room < 0:
            value *= 1.14
        elif situation.timeline.selling:
            value *= 1.06

    # 6. Window. Above 80 the brief says a club stops caring about the future,
    #    and this is where that starts to bite -- smoothly from 60 rather than
    #    at a cliff, so a club at 79 is not a different animal from one at 81.
    if situation.window >= 60 and player.age >= 27:
        push = (situation.window - 60.0) / 40.0
        value *= 1.0 + push * 0.22

    return max(1.0, value)


def untouchable(league, situation, player) -> bool:
    """Whether this club will refuse essentially any offer.

    The brief asks for franchise cornerstones to be near-impossible to acquire,
    and this is the near. It is not an absolute veto -- `trades` still lets an
    overwhelming offer through -- it raises the bar enormously.
    """
    from .front_office import Timeline

    ca = player.ability.current
    ident = situation.identity

    # A generational player is untouchable to anybody who is not tanking.
    if ca >= 178.0 and situation.timeline is not Timeline.TANKING:
        return True
    # A young star with a real ceiling, to a club that is not selling.
    if (ca >= 150.0 and player.age <= 25
            and player.ability.potential - ca >= 12.0
            and not situation.timeline.selling):
        return True
    # The best player on a contender.
    if situation.timeline in (Timeline.FAVOURITE, Timeline.CONTENDER):
        best = max(situation_players(league, situation),
                   key=lambda p: p.ability.current, default=None)
        if best is not None and best.id == player.id and ca >= 145.0:
            return True
    # A very loyal front office protects its own cornerstone regardless.
    if ident.loyalty >= 78.0 and ca >= 155.0:
        return True
    return False


def situation_players(league, situation) -> list:
    team = league.teams.get(situation.team_id)
    return list(getattr(team, "players", [])) if team else []


def summary(league, player, situation=None) -> dict:
    """One player's trade value, as a screen wants it."""
    data = {
        "playerId": player.id,
        "name": player.name,
        "position": player.position.value,
        "age": player.age,
        "overall": player.overall,
        "baseValue": round(base_value(player), 1),
        "value": round(value_of(league, player), 1),
        "marketability": round(marketability(player), 1),
        "parts": {
            "ability": round(interpolate(ABILITY_CURVE, player.ability.current), 1),
            "age": round(age_multiplier(player.age), 3),
            "potential": round(potential_multiplier(player), 3),
            "scarcity": round(scarcity_multiplier(player), 3),
            "contract": round(contract_multiplier(player), 3),
            "durability": round(durability_multiplier(player), 3),
            "character": round(character_multiplier(player), 3),
            "production": round(production_multiplier(league, player), 3),
        },
    }
    if situation is not None:
        data["valueToTeam"] = round(value_to(league, situation, player), 1)
        data["untouchable"] = untouchable(league, situation, player)
    return data
