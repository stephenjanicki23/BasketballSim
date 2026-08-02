"""PLACEHOLDER DATA -- DELETE ME.

None of this is meant to survive. It exists only so the shell boots with
something on the floor: anonymous teams, anonymous players, plausible rating
spreads. Replace it with real team/player loading and remove this module.

Nothing else in the codebase imports it except `run.py` and the tests.
"""

from __future__ import annotations

import random

from .models import Player, Position, Team
from .ratings import Ratings, Tendencies
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
]

# Deliberately long: the league needs a unique surname per player so the
# play-by-play never reads "D. Reyes blocks D. Reyes's shot".
_SURNAMES = [
    "Alder", "Brook", "Calloway", "Dunmore", "Ellery", "Fenwick", "Gale",
    "Hollis", "Ingram", "Jarvis", "Kessler", "Larkin", "Mercer", "Nash",
    "Oakes", "Prescott", "Quill", "Reyes", "Sparrow", "Thorne", "Underhill",
    "Vance", "Whitlock", "Yarrow", "Ashcroft", "Bellamy", "Cardew", "Dashiell",
    "Everly", "Fairbank", "Gossard", "Halloway", "Isley", "Jessup", "Kingsley",
    "Lathrop", "Marchetti", "Norwood", "Ostrander", "Pemberton", "Quintero",
    "Ravenel", "Sedgwick", "Tillman", "Ulmer", "Verlander", "Wexford",
    "Yates", "Ziegler", "Ainsworth", "Bramwell", "Colvin", "Denholm",
    "Eastwick", "Falkner", "Granger", "Hawthorne", "Ives", "Joplin",
    "Kirkwood", "Lindqvist", "Merriweather", "Nordstrom", "Osgood",
    "Pennington", "Quarles", "Rockwell", "Sandoval", "Trueblood", "Ulrich",
    "Vandermeer", "Wolcott", "Yeardley", "Zabala", "Amberly", "Blackwood",
    "Castellan", "Doverly", "Ellsworth", "Fitzhugh", "Galbraith", "Hartsock",
    "Inglewood", "Jansen", "Keswick", "Loudermilk", "Mainwaring", "Netherton",
    "Oxley", "Pathmore", "Quilliam", "Rutherford", "Stillwell", "Tanaka",
    "Uxbridge", "Vasquez", "Wentworth", "Yorke", "Zamora", "Abernathy",
    "Braddock", "Chaudhry", "Delacroix", "Emberly", "Fontaine", "Greaves",
    "Hallowell", "Ibarra", "Jelani", "Kowalczyk", "Lundqvist", "Moreau",
]

_FIRST_NAMES = [
    "Andre", "Bryce", "Cam", "Dante", "Elias", "Finn", "Gus", "Hector",
    "Isaiah", "Jonah", "Kai", "Luca", "Miles", "Noel", "Omar", "Pierce",
    "Quinn", "Rashad", "Silas", "Tobias",
]

# Rough positional archetypes: (attribute, mean shift) applied over a base draw.
_POSITION_PROFILE: dict[Position, dict[str, float]] = {
    Position.PG: {"playmaking": 18, "ball_handling": 18, "three_point": 8, "speed": 12,
                  "perimeter_defense": 5, "interior_defense": -18, "def_rebounding": -14,
                  "off_rebounding": -16, "block": -18, "post_game": -18, "strength": -10},
    Position.SG: {"three_point": 14, "mid_range": 10, "ball_handling": 8, "speed": 8,
                  "perimeter_defense": 6, "interior_defense": -12, "def_rebounding": -8,
                  "off_rebounding": -10, "block": -12, "post_game": -12},
    Position.SF: {"three_point": 6, "finishing": 6, "off_ball": 8, "perimeter_defense": 6,
                  "def_rebounding": 2, "post_game": -2},
    Position.PF: {"finishing": 10, "post_game": 10, "def_rebounding": 12, "off_rebounding": 10,
                  "interior_defense": 10, "block": 8, "strength": 12, "three_point": -6,
                  "ball_handling": -12, "playmaking": -8, "speed": -6},
    Position.C: {"finishing": 14, "post_game": 16, "def_rebounding": 18, "off_rebounding": 16,
                 "interior_defense": 18, "block": 18, "strength": 18, "three_point": -18,
                 "ball_handling": -20, "playmaking": -12, "speed": -12, "free_throw": -10},
}

_POSITION_HEIGHT: dict[Position, int] = {
    Position.PG: 74, Position.SG: 77, Position.SF: 79, Position.PF: 81, Position.C: 83,
}

_ROSTER_SHAPE = [
    Position.PG, Position.SG, Position.SF, Position.PF, Position.C,
    Position.PG, Position.SG, Position.SF, Position.PF, Position.C,
    Position.SG, Position.SF,
]


def _make_player(
    rng: random.Random,
    team_abbr: str,
    index: int,
    position: Position,
    tier: float,
    first_name: str,
    last_name: str,
) -> Player:
    """tier is 0..1 -- how good this player is relative to his team's roster."""
    base = 42 + tier * 36  # bench guys sit near 42, best player near 78

    def draw(attribute: str) -> float:
        shift = _POSITION_PROFILE[position].get(attribute, 0.0)
        return max(20.0, min(95.0, rng.gauss(base + shift, 7.0)))

    ratings = Ratings(**{name: draw(name) for name in Ratings.attribute_names()})

    tendencies = Tendencies(
        usage=max(15.0, min(95.0, rng.gauss(35 + tier * 40, 8))),
        three_point_rate=max(5.0, min(95.0, ratings.three_point + rng.gauss(0, 12))),
        rim_rate=max(5.0, min(95.0, ratings.finishing + rng.gauss(0, 12))),
        pass_first=max(5.0, min(95.0, ratings.playmaking + rng.gauss(0, 12))),
        crash_glass=max(5.0, min(95.0, ratings.off_rebounding + rng.gauss(0, 12))),
    )

    return Player(
        id=f"{team_abbr}-{index:02d}",
        first_name=first_name,
        last_name=last_name,
        position=position,
        age=rng.randint(20, 35),
        height_inches=_POSITION_HEIGHT[position] + rng.randint(-2, 2),
        weight_lbs=180 + (_POSITION_HEIGHT[position] - 74) * 9 + rng.randint(-12, 12),
        jersey=index,
        ratings=ratings,
        tendencies=tendencies,
    )


def make_team(
    rng: random.Random,
    city: str,
    name: str,
    abbreviation: str,
    surnames: list[str] | None = None,
) -> Team:
    # Surnames come from a league-wide pool when one is supplied, so no two
    # players anywhere share a name.
    surnames = surnames or rng.sample(_SURNAMES, len(_ROSTER_SHAPE))
    first_names = rng.sample(_FIRST_NAMES, len(_ROSTER_SHAPE))

    players: list[Player] = []
    for index, position in enumerate(_ROSTER_SHAPE):
        # Starters (first five slots) get the top tiers.
        tier = max(0.0, 1.0 - index * 0.075 + rng.gauss(0, 0.08))
        players.append(_make_player(
            rng, abbreviation, index + 1, position, min(1.0, tier),
            first_names[index], surnames[index],
        ))

    team = Team(
        id=abbreviation.lower(),
        name=name,
        abbreviation=abbreviation,
        city=city,
        conference="East" if rng.random() < 0.5 else "West",
        players=players,
        tactics=Tactics(
            offensive_scheme=rng.choice(list(OffensiveScheme)),
            defensive_scheme=rng.choice(list(DefensiveScheme)),
            pace=rng.uniform(30, 70),
            three_point_emphasis=rng.uniform(25, 75),
            ball_movement=rng.uniform(30, 70),
            offensive_rebounding=rng.uniform(25, 75),
            defensive_pressure=rng.uniform(30, 70),
            help_intensity=rng.uniform(30, 70),
        ),
        team_chemistry=rng.uniform(40, 70),
    )
    team.depth_chart = [p.id for p in team.players]
    return team


def make_teams(count: int = 8, seed: int = 7) -> list[Team]:
    rng = random.Random(seed)
    count = min(count, len(_TEAM_NAMES))
    needed = count * len(_ROSTER_SHAPE)
    if needed > len(_SURNAMES):
        raise ValueError(f"need {needed} unique surnames, pool has {len(_SURNAMES)}")
    pool = rng.sample(_SURNAMES, needed)
    size = len(_ROSTER_SHAPE)
    return [
        make_team(rng, *_TEAM_NAMES[i], surnames=pool[i * size:(i + 1) * size])
        for i in range(count)
    ]
