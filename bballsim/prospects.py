"""Where next season's players come from.

Careers end. `progression.develop_season` retires a player when his ability
collapses or his age runs out, and a club that loses one still has to field
twelve. This module makes the replacements.

It is deliberately **not** `placeholder.py`. That module is scaffolding marked
for deletion -- it ran once to build `data/league.json` and nothing in a running
league should depend on it. What this shares with it is the parts that were
never scaffolding: `ability.generate_ratings` to solve an attribute set to a CA
target, `ability.make_ability` for the CA/PA gap, `biography.make_biography`
for where a man came from, and the name pools in `names.py`. Those all moved out
of the throwaway when the intake needed them.

**A prospect is young and unfinished, which is the whole point.** He arrives at
19 to 22 with a current ability that would not start for a good side, and a
potential that might. `make_ability` already ties headroom to age -- an
18-year-old can be fifty points short of his ceiling, a 30-year-old is at it --
so drawing prospects young is what puts genuine unknowns into a league. The
scouting layer will read him at 65% accuracy like everyone else, so what a
manager sees is a guess, and some of those guesses are wrong. That is a draft.

**Ids are stamped with the season they arrived.** Not `NCI-13` -- `NCI-2028-01`.
A retired player's season lines stay in the archive under his id forever, and a
newcomer inheriting a recycled id would inherit a career he never had. The
by-season chart reads those archives by player id, so this is a correctness
requirement rather than tidiness.
"""

from __future__ import annotations

import random

from .ability import (
    POSITION_ARCHETYPES,
    POSITION_PROFILE,
    generate_ratings,
    make_ability,
)
from .biography import DraftInfo, draw_height, draw_weight, make_biography
from .models import Player, Position
from .names import FIRST_NAMES, SURNAMES
from .ratings import HiddenAttributes, Tendencies, clamp

# How old an incoming player is. The band is the point: a 19-year-old carries
# far more headroom than a 22-year-old of the same current ability, so an intake
# contains both lottery tickets and finished-ish role players.
AGE_RANGE = (19, 22)

# Current ability at the top and the bottom of an intake. A first pick is a
# rotation player now and possibly an All-Star later; the last man in is a
# twelfth man who may never be more than that.
TOP_CA = 104.0
TAIL_CA = 66.0

# Extra ceiling handed to the top of the class, tapering to nothing at the tail.
# Without it the best prospect's ceiling is drawn from the same distribution as
# the last one's and a draft has no shape -- the whole reason a bad club wants
# the first pick is that the first pick is *supposed* to be worth more.
TOP_CEILING_BONUS = 42.0

# Character is drawn on its own axis, exactly as it is for everyone else in the
# league: being a good pro has nothing to do with being a good player. A tuple,
# not a set, because these are drawn in order from a seeded RNG.
CHARACTER_ATTRIBUTES: tuple[str, ...] = (
    "leadership", "work_rate", "teamwork", "coachability", "confidence",
    "composure", "competitive_drive", "focus", "discipline", "aggression",
    "mental_toughness", "pressure_handling", "emotional_control",
    "winning_mentality",
)


def ladder(size: int) -> list[float]:
    """CA targets from the first pick to the last, evenly spaced."""
    if size <= 0:
        return []
    if size == 1:
        return [TOP_CA]
    step = (TOP_CA - TAIL_CA) / (size - 1)
    return [TOP_CA - step * i for i in range(size)]


def make_prospect(
    rng: random.Random,
    player_id: str,
    jersey: int,
    position: Position,
    target_ca: float,
    season_start_year: int,
    *,
    first_name: str,
    last_name: str,
    rank: float = 0.5,
    draft_size: int = 30,
    pick: int | None = None,
) -> Player:
    """One incoming player.

    `rank` is where he sits in his class, 0.0 for the first pick and 1.0 for the
    last. It buys ceiling, not current ability: the top of a class is not much
    better *today* than the middle of it, which is exactly why drafting is hard.
    """
    age = rng.randint(*AGE_RANGE)
    archetype = rng.choice(POSITION_ARCHETYPES[position.value])

    # Headroom from age, as everyone else gets it, plus the class bonus on top.
    ability = make_ability(rng, target_ca, age)
    ability.potential += TOP_CEILING_BONUS * max(0.0, 1.0 - rank) * rng.uniform(0.5, 1.0)

    ratings = generate_ratings(
        rng,
        ca=ability.current,
        position=position.value,
        archetype=archetype,
        age=age,
        position_profile=POSITION_PROFILE[position.value],
    )

    character_base = rng.gauss(10.5, 2.2)
    for name in CHARACTER_ATTRIBUTES:
        setattr(ratings, name, clamp(rng.gauss(character_base, 1.8)))

    def gauss(mu: float, sigma: float) -> float:
        return clamp(rng.gauss(mu, sigma))

    hidden = HiddenAttributes(
        injury_proneness=gauss(9.0, 3.2),
        consistency=gauss(9.5 + (target_ca / 200.0) * 4.0, 2.8),
        big_game_performance=gauss(9.5 + (target_ca / 200.0) * 3.5, 3.0),
        # The two that decide whether he ever reaches the ceiling above. Drawn
        # wide on purpose -- a bust is a real outcome, not a bug.
        development_rate=gauss(11.0, 3.4),
        learning_ability=gauss(11.0, 3.4),
        loyalty=gauss(10.0, 3.6),
        ambition=gauss(11.0, 3.4),
        professionalism=gauss(character_base, 2.8),
        temperament=gauss(character_base, 3.0),
        adaptability=gauss(10.5, 2.8),
        leadership_influence=gauss(ratings.leadership, 2.2),
        media_handling=gauss(10.0, 3.4),
        locker_room_presence=gauss(character_base, 2.6),
    )

    tendencies = Tendencies(
        usage=gauss(5.0 + (target_ca / 200.0) * 12.0, 1.6),
        three_point_rate=gauss(ratings.three_point, 2.4),
        rim_rate=gauss((ratings.layups + ratings.close_shot) / 2, 2.4),
        post_up_rate=gauss(ratings.post_moves, 2.4),
        pass_first=gauss(ratings.passing, 2.4),
        crash_glass=gauss(ratings.offensive_rebounding, 2.4),
    )

    height_inches = draw_height(rng, position.value)

    # The draft record says what actually happened in this intake, rather than
    # what `make_biography` would guess. Left to guess, it derives the class
    # year from age and the slot from potential, so the man taken first read
    # "2027 · Rd 2, Pick 20" -- a plausible sentence about a different player.
    bio = make_biography(rng, age, season_start_year, ability.potential,
                         draft_size=max(2, draft_size))
    if pick is not None:
        bio.draft = DraftInfo(
            year=season_start_year,
            round=1 if pick <= max(1, draft_size // 2) else 2,
            pick=pick,
        )

    return Player(
        id=player_id,
        first_name=first_name,
        last_name=last_name,
        position=position,
        age=age,
        height_inches=height_inches,
        weight_lbs=draw_weight(rng, height_inches, ratings.strength),
        jersey=jersey,
        ratings=ratings,
        tendencies=tendencies,
        hidden=hidden,
        ability=ability,
        archetype=archetype,
        bio=bio,
    )


def intake(
    rng: random.Random,
    size: int,
    season_start_year: int,
    positions: list[Position],
    taken_names: set[str],
    id_prefix: str,
) -> list[Player]:
    """A whole class, best first.

    `positions` is what the league actually needs -- one entry per vacancy, in
    draft order -- so an intake replacing four centres is four centres. A draft
    that ignored the holes it is filling would leave clubs with illegal squads.

    `taken_names` keeps a newcomer from sharing a name with a player already in
    the league; it is updated as names are used.
    """
    targets = ladder(size)
    players: list[Player] = []
    for index, (target, position) in enumerate(zip(targets, positions)):
        first, last = _fresh_name(rng, taken_names)
        players.append(make_prospect(
            rng,
            player_id=f"{id_prefix}-{index + 1:02d}",
            jersey=0,   # the club assigns it, from the shirt that came free
            position=position,
            target_ca=target,
            season_start_year=season_start_year,
            first_name=first,
            last_name=last,
            rank=index / max(1, size - 1),
            draft_size=size,
            pick=index + 1,
        ))
    return players


def _fresh_name(rng: random.Random, taken: set[str]) -> tuple[str, str]:
    """A name nobody in the league is using.

    The pools are finite and a league runs for decades, so once every pairing in
    play is taken the surname gets a numeral -- "Alder II". Better a name that
    admits what happened than two men who cannot be told apart on a box score.
    """
    for _ in range(40):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(SURNAMES)
        if f"{first} {last}" not in taken:
            taken.add(f"{first} {last}")
            return first, last

    first = rng.choice(FIRST_NAMES)
    last = rng.choice(SURNAMES)
    for numeral in ("II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"):
        candidate = f"{last} {numeral}"
        if f"{first} {candidate}" not in taken:
            taken.add(f"{first} {candidate}")
            return first, candidate
    taken.add(f"{first} {last}")
    return first, last
