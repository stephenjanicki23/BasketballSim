"""PLACEHOLDER DATA -- DELETE ME.

None of this is meant to survive. It exists only so the shell boots with
something on the floor: anonymous teams, anonymous players, plausible rating
spreads across all 96 attributes. Replace it with real team/player loading and
remove this module.

Nothing else in the codebase imports it except `run.py`, `tools/` and tests.
"""

from __future__ import annotations

import random

from .ability import (
    Archetype,
    POSITION_ARCHETYPES,
    POSITION_PROFILE,
    ca_tier,
    generate_ratings,
    make_ability,
)
from .biography import draw_age, draw_height, draw_weight, make_biography
from .coach import make_coaches
from .models import Player, Position, Team
from .names import FIRST_NAMES, SURNAMES
from .ratings import HiddenAttributes, Ratings, Tendencies, clamp
from .tactics import DefensiveScheme, OffensiveScheme, Tactics

_TEAM_NAMES = [
    ("North City", "Ironworks", "NCI"),
    ("Eastport", "Mariners", "EPM"),
    ("Southridge", "Miners", "SRM"),
    ("Westfield", "Rovers", "WFR"),
    ("Lakeside", "Current", "LSC"),
    ("Highland", "Stags", "HLS"),
    ("Riverbend", "Foundry", "RBF"),
    ("Grandview", "Skyline", "GVS"),
    ("Ironvale", "Forge", "IVF"),
    ("Cape Harbor", "Gulls", "CHG"),
    ("Summit Ridge", "Peaks", "SRP"),
    ("Cedar Falls", "Timber", "CFT"),
    ("Port Union", "Anchors", "PUA"),
    ("Silverlake", "Comets", "SLC"),
    ("Fort Bellamy", "Sentinels", "FBS"),
    ("Autumn Valley", "Foxes", "AVF"),
    ("Kingsbridge", "Royals", "KBR"),
    ("Marble Heights", "Monarchs", "MHM"),
    ("Copperfield", "Coyotes", "CFC"),
    ("Thornwood", "Hawks", "THW"),
    ("Gale Point", "Storm", "GPS"),
    ("Redstone", "Rangers", "RSR"),
    ("Brightwater", "Tides", "BWT"),
    ("Alder Creek", "Bruins", "ACB"),
    ("Stonegate", "Guardians", "STG"),
    ("Windmere", "Cyclones", "WMC"),
    ("Oakhaven", "Owls", "OKO"),
    ("Crescent Bay", "Surge", "CBS"),
    ("Falconridge", "Falcons", "FRF"),
    ("New Meridian", "Pioneers", "NMP"),
]

# Deliberately long: the league needs a unique surname per player so the
# play-by-play never reads "D. Reyes blocks D. Reyes's shot". 30 teams of 12
# is 360 players, so the pool has to clear that with room to spare.



# A 12-man roster's positional make-up. Every team carries at least two of
# each position, then fills the last two places with whatever the front office
# fancied -- so squads are not identical and the starting five is not forced
# into one shape. `Team.starters()` picks the strongest *legal* five from
# whatever this produces, which is what stops a big-heavy roster from putting
# five bigs on the floor.
_ROSTER_CORE = (
    Position.PG, Position.PG, Position.SG, Position.SG, Position.SF,
    Position.SF, Position.PF, Position.PF, Position.C, Position.C,
)
_ROSTER_FLEX_WEIGHTS = (
    (Position.PG, 1.0), (Position.SG, 1.6), (Position.SF, 1.8),
    (Position.PF, 1.4), (Position.C, 0.8),
)
_ROSTER_SIZE = 12

# Target Current Ability by depth. The ladder is fixed; which *position* draws
# the top rung is shuffled per team, so a franchise player is as likely to be a
# centre as a point guard. Previously the ladder was zipped against a fixed
# position order, which made the best player on every single team a PG.
_STARTER_CA = (158.0, 146.0, 137.0, 129.0, 122.0)
_BENCH_CA = (114.0, 106.0, 99.0, 92.0, 85.0, 78.0, 72.0)

# A minority of teams have a genuine superstar rather than merely a best
# player. Without this the top rung tops out around All-Star and the Elite and
# Generational tiers never appear in a 30-team league.
SUPERSTAR_CHANCE = 0.22
SUPERSTAR_BUMP = (8.0, 30.0)

# Character attributes are drawn on their own axis: being a good pro has
# nothing to do with being a good player.
#
# A tuple, not a set: these are drawn in order from a seeded RNG, and Python
# salts string hashing per process, so iterating a set here would hand each
# attribute a different draw in every run and the same seed would generate a
# different league tomorrow.
_CHARACTER_ATTRIBUTES: tuple[str, ...] = (
    "leadership", "work_rate", "teamwork", "coachability", "confidence",
    "composure", "competitive_drive", "focus", "discipline", "aggression",
    "mental_toughness", "pressure_handling", "emotional_control",
    "winning_mentality",
)

_ROSTER_SHAPE = [
    Position.PG, Position.SG, Position.SF, Position.PF, Position.C,
    Position.PG, Position.SG, Position.SF, Position.PF, Position.C,
    Position.SG, Position.SF,
]


# Roster slot -> target Current Ability. A league's best players sit around
# 155-165 (All-Star), starters 120-140, the twelfth man near 75.
_SLOT_CA = (162, 148, 138, 132, 126, 118, 110, 103, 96, 89, 82, 75)


def _make_player(
    rng: random.Random,
    team_abbr: str,
    index: int,
    position: Position,
    target_ca: float,
    first_name: str,
    last_name: str,
    season_start_year: int = 2026,
    draft_size: int = 16,
) -> Player:
    """Build a player from a CA target rather than from raw attribute draws.

    Order matters: age and archetype are chosen first, then PA, then the
    attribute set is *solved* so that `current_ability()` returns the target.
    Character attributes are drawn separately -- being a good pro has nothing
    to do with being a good player, and they are excluded from CA entirely.
    """
    # Age first, because everything else keys off it: PA headroom shrinks with
    # age, and the draft class is derived from how long he has been in the league.
    age = draw_age(rng, target_ca)
    archetype = rng.choice(POSITION_ARCHETYPES[position.value])
    ability = make_ability(rng, target_ca, age)

    ratings = generate_ratings(
        rng,
        ca=ability.current,
        position=position.value,
        archetype=archetype,
        age=age,
        position_profile=POSITION_PROFILE[position.value],
    )

    # Character and mental, on their own axis and outside the CA budget.
    character_base = rng.gauss(10.5, 2.2)
    for name in _CHARACTER_ATTRIBUTES:
        setattr(ratings, name, clamp(rng.gauss(character_base, 1.8)))

    def gauss(mu: float, sigma: float) -> float:
        return clamp(rng.gauss(mu, sigma))

    hidden = HiddenAttributes(
        injury_proneness=gauss(9.0, 3.2),
        consistency=gauss(9.5 + (target_ca / 200.0) * 4.0, 2.8),
        big_game_performance=gauss(9.5 + (target_ca / 200.0) * 3.5, 3.0),
        development_rate=gauss(10.5, 3.0),
        learning_ability=gauss(10.5, 3.0),
        loyalty=gauss(10.0, 3.6),
        ambition=gauss(11.0, 3.4),
        professionalism=gauss(character_base, 2.8),
        temperament=gauss(character_base, 3.0),
        adaptability=gauss(10.5, 2.8),
        leadership_influence=gauss(ratings.leadership, 2.2),
        media_handling=gauss(10.0, 3.4),
        locker_room_presence=gauss(character_base, 2.6),
    )

    # Tendencies follow the attributes the archetype produced, so a Rim Runner
    # who cannot shoot does not spend his night launching threes.
    tendencies = Tendencies(
        usage=gauss(5.0 + (target_ca / 200.0) * 12.0, 1.6),
        three_point_rate=gauss(ratings.three_point, 2.4),
        rim_rate=gauss((ratings.layups + ratings.close_shot) / 2, 2.4),
        post_up_rate=gauss(ratings.post_moves, 2.4),
        pass_first=gauss(ratings.passing, 2.4),
        crash_glass=gauss(ratings.offensive_rebounding, 2.4),
    )

    height_inches = draw_height(rng, position.value)
    bio = make_biography(
        rng, age, season_start_year, ability.potential, draft_size=draft_size
    )

    return Player(
        id=f"{team_abbr}-{index:02d}",
        first_name=first_name,
        last_name=last_name,
        position=position,
        age=age,
        height_inches=height_inches,
        weight_lbs=draw_weight(rng, height_inches, ratings.strength),
        jersey=index,
        ratings=ratings,
        tendencies=tendencies,
        hidden=hidden,
        ability=ability,
        archetype=archetype,
        bio=bio,
    )


# Where each scheme naturally sits on the pace slider. Drawing the slider
# around the scheme's own tempo stops a team from doubling down -- picking
# seven-seconds *and* maxing pace, which is not a plan any coach runs.
_SCHEME_PACE_CENTRE: dict[OffensiveScheme, float] = {
    OffensiveScheme.SEVEN_SECONDS: 62.0,
    OffensiveScheme.PACE_AND_SPACE: 56.0,
    OffensiveScheme.MOTION: 50.0,
    OffensiveScheme.INSIDE_OUT: 44.0,
    OffensiveScheme.ISOLATION: 42.0,
}

_SCHEME_THREE_CENTRE: dict[OffensiveScheme, float] = {
    OffensiveScheme.PACE_AND_SPACE: 66.0,
    OffensiveScheme.SEVEN_SECONDS: 58.0,
    OffensiveScheme.MOTION: 50.0,
    OffensiveScheme.ISOLATION: 44.0,
    OffensiveScheme.INSIDE_OUT: 38.0,
}


def _make_tactics(rng: random.Random) -> Tactics:
    offense = rng.choice(list(OffensiveScheme))
    defense = rng.choice(list(DefensiveScheme))
    return Tactics(
        offensive_scheme=offense,
        defensive_scheme=defense,
        pace=rng.gauss(_SCHEME_PACE_CENTRE[offense], 7.0),
        three_point_emphasis=rng.gauss(_SCHEME_THREE_CENTRE[offense], 9.0),
        ball_movement=rng.gauss(50, 9),
        offensive_rebounding=rng.gauss(50, 10),
        defensive_pressure=rng.gauss(50, 9),
        help_intensity=rng.gauss(50, 9),
        close_out_hard=rng.gauss(50, 9),
        foul_discipline=rng.gauss(50, 8),
    )


def make_team(
    rng: random.Random,
    city: str,
    name: str,
    abbreviation: str,
    surnames: list[str] | None = None,
    season_start_year: int = 2026,
    draft_size: int = 16,
) -> Team:
    # Surnames come from a league-wide pool when one is supplied, so no two
    # players anywhere share a name.
    surnames = surnames or rng.sample(SURNAMES, _ROSTER_SIZE)
    first_names = rng.sample(FIRST_NAMES, _ROSTER_SIZE)

    # Deal the CA ladder to a shuffled set of positions. Each team therefore
    # has its best player at a random position, while the starting five still
    # covers PG through C.
    flex_positions, flex_weights = zip(*_ROSTER_FLEX_WEIGHTS)
    roster_positions = list(_ROSTER_CORE) + rng.choices(
        flex_positions, weights=flex_weights, k=_ROSTER_SIZE - len(_ROSTER_CORE)
    )
    # Shuffling the positions against a fixed ability ladder is what gives each
    # team a franchise player at a random position.
    rng.shuffle(roster_positions)

    ladder = list(_STARTER_CA) + list(_BENCH_CA)
    if rng.random() < SUPERSTAR_CHANCE:
        ladder[0] += rng.uniform(*SUPERSTAR_BUMP)

    slots = list(zip(roster_positions, ladder))

    players: list[Player] = []
    for index, (position, base_ca) in enumerate(slots):
        # Narrower than the gaps between rungs, so the depth chart still tracks
        # ability while leaving room for a surprise.
        target_ca = max(30.0, min(195.0, base_ca + rng.gauss(0, 4.0)))
        players.append(_make_player(
            rng, abbreviation, index + 1, position, target_ca,
            first_names[index], surnames[index],
            season_start_year=season_start_year, draft_size=draft_size,
        ))

    team = Team(
        id=abbreviation.lower(),
        name=name,
        abbreviation=abbreviation,
        city=city,
        conference="East" if rng.random() < 0.5 else "West",
        players=players,
        tactics=_make_tactics(rng),
        team_chemistry=rng.uniform(40, 70),  # 0-100, not a player rating
    )
    # Depth chart is pure ability order -- the manager's ranking of his squad.
    # `Team.starters()` then picks the strongest *legal* five out of it, so the
    # shape constraint lives in one place rather than being baked in here.
    team.depth_chart = [
        p.id for p in sorted(players, key=lambda p: -p.ability.current)
    ]
    return team


def make_teams(count: int = 8, seed: int = 7, season_start_year: int = 2026) -> list[Team]:
    rng = random.Random(seed)
    count = min(count, len(_TEAM_NAMES))
    # Two rounds for a league this size, so pick numbers stay coherent.
    draft_size = count * 2
    needed = count * _ROSTER_SIZE
    if needed > len(SURNAMES):
        raise ValueError(f"need {needed} unique surnames, pool has {len(SURNAMES)}")
    pool = rng.sample(SURNAMES, needed)
    size = _ROSTER_SIZE
    coaches = make_coaches(rng, count)
    teams = [
        make_team(
            rng, *_TEAM_NAMES[i], surnames=pool[i * size:(i + 1) * size],
            season_start_year=season_start_year, draft_size=draft_size,
        )
        for i in range(count)
    ]
    for team, coach in zip(teams, coaches):
        team.coach = coach
    return teams
