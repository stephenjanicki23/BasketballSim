"""PLACEHOLDER DATA -- DELETE ME.

None of this is meant to survive. It exists only so the shell boots with
something on the floor: anonymous teams, anonymous players, plausible rating
spreads across all 96 attributes. Replace it with real team/player loading and
remove this module.

Nothing else in the codebase imports it except `run.py`, `tools/` and tests.
"""

from __future__ import annotations

import random

from .models import Player, Position, Team
from .ratings import HiddenAttributes, Ratings, Tendencies
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

# --------------------------------------------------------------------------
# Positional archetypes: mean shifts in rating points applied over a player's
# base draw. Anything unlisted sits at the base for that player's tier.
# --------------------------------------------------------------------------

_POSITION_PROFILE: dict[Position, dict[str, float]] = {
    Position.PG: {
        "close_shot": -4, "layups": 6, "dunking": -22, "three_point": 8,
        "free_throws": 8, "off_ball_shooting": -2,
        "finishing_through_contact": -10, "floater": 12, "euro_step": 10,
        "post_moves": -22, "post_footwork": -22, "post_hook": -24, "fadeaway": -4,
        "passing": 18, "ball_handling": 20, "dribbling": 20, "court_vision": 18,
        "pick_and_roll_handler": 18, "decision_making": 10, "creativity": 12,
        "assist_iq": 16,
        "perimeter_defense": 6, "interior_defense": -20, "help_defense": -6,
        "blocks": -22, "steals": 8, "switchability": -6, "post_defense": -22,
        "rim_protection": -26, "shot_contest": -4,
        "offensive_rebounding": -18, "defensive_rebounding": -16,
        "boxing_out": -14, "rebound_positioning": -10, "rebound_timing": -8,
        "speed": 12, "acceleration": 14, "agility": 14, "quickness": 16,
        "strength": -14, "balance": 6,
        "pick_and_roll_creation": 18, "isolation": 8, "pull_up_shooting": 10,
        "transition_play": 14, "pace_control": 18,
        "catch_and_shoot": 2, "cutting": -6, "off_ball_movement": -4,
        "wing_defense": -6, "transition_finishing": 4,
        "screen_setting": -18, "roll_man": -22, "passing_from_post": -12,
        "offensive_awareness": 8, "spatial_awareness": 8,
    },
    Position.SG: {
        "three_point": 14, "mid_range": 12, "free_throws": 6,
        "off_ball_shooting": 12, "shot_selection": 2,
        "layups": 4, "euro_step": 6, "fadeaway": 4,
        "post_moves": -16, "post_hook": -18, "post_footwork": -16,
        "ball_handling": 8, "dribbling": 8, "passing": 2, "court_vision": 2,
        "perimeter_defense": 6, "interior_defense": -14, "blocks": -16,
        "steals": 4, "rim_protection": -20, "post_defense": -16,
        "offensive_rebounding": -12, "defensive_rebounding": -10, "boxing_out": -8,
        "speed": 8, "acceleration": 8, "agility": 8, "quickness": 8, "strength": -6,
        "pull_up_shooting": 12, "catch_and_shoot": 14, "isolation": 6,
        "off_ball_movement": 10, "transition_play": 6,
        "screen_setting": -12, "roll_man": -16, "passing_from_post": -8,
    },
    Position.SF: {
        "three_point": 6, "mid_range": 4, "layups": 6,
        "finishing_through_contact": 6, "offensive_versatility": 10,
        "off_ball_shooting": 6,
        "perimeter_defense": 6, "wing_defense": 12, "switchability": 8,
        "defensive_rebounding": 2, "help_defense": 4,
        "cutting": 10, "off_ball_movement": 8, "transition_finishing": 8,
        "catch_and_shoot": 6,
        "post_moves": -4, "post_hook": -6, "rim_protection": -8,
        "screen_setting": -4, "roll_man": -6,
    },
    Position.PF: {
        "close_shot": 8, "layups": 6, "dunking": 12,
        "finishing_through_contact": 12, "post_moves": 10, "post_footwork": 10,
        "post_hook": 8, "three_point": -6, "off_ball_shooting": -4,
        "ball_handling": -14, "dribbling": -14, "passing": -6,
        "court_vision": -6, "pick_and_roll_handler": -14, "assist_iq": -6,
        "interior_defense": 12, "help_defense": 8, "blocks": 10,
        "post_defense": 12, "rim_protection": 8, "perimeter_defense": -4,
        "offensive_rebounding": 12, "defensive_rebounding": 14,
        "boxing_out": 14, "rebound_positioning": 12, "rebound_timing": 10,
        "strength": 14, "vertical_leap": 8, "speed": -6, "quickness": -8,
        "agility": -6,
        "screen_setting": 12, "roll_man": 12, "passing_from_post": 6,
        "isolation": -8, "pull_up_shooting": -8, "pick_and_roll_creation": -14,
        "pace_control": -10, "cutting": 4,
    },
    Position.C: {
        "close_shot": 14, "layups": 8, "dunking": 20,
        "finishing_through_contact": 16, "post_moves": 16, "post_footwork": 16,
        "post_hook": 18, "floater": -4,
        "three_point": -20, "mid_range": -12, "free_throws": -12,
        "off_ball_shooting": -14, "fadeaway": -6,
        "ball_handling": -22, "dribbling": -22, "passing": -8,
        "court_vision": -10, "pick_and_roll_handler": -22, "assist_iq": -8,
        "creativity": -8,
        "interior_defense": 20, "rim_protection": 20, "post_defense": 20,
        "blocks": 20, "help_defense": 10, "perimeter_defense": -14,
        "switchability": -12, "steals": -8,
        "offensive_rebounding": 18, "defensive_rebounding": 20,
        "boxing_out": 18, "rebound_positioning": 16, "rebound_timing": 14,
        "strength": 20, "vertical_leap": 8, "speed": -14, "quickness": -16,
        "agility": -14, "acceleration": -12,
        "screen_setting": 20, "roll_man": 20, "passing_from_post": 12,
        "isolation": -16, "pull_up_shooting": -18, "pick_and_roll_creation": -22,
        "transition_play": -12, "pace_control": -14, "cutting": -4,
        "wing_defense": -14,
    },
}

# Character attributes are drawn on their own axis: being a good pro has
# nothing to do with being a good player.
_CHARACTER_ATTRIBUTES = frozenset({
    "leadership", "work_rate", "teamwork", "coachability", "confidence",
    "composure", "competitive_drive", "focus", "discipline", "aggression",
    "mental_toughness", "pressure_handling", "emotional_control",
    "winning_mentality",
})

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
    skill_base = 42 + tier * 36        # bench guys sit near 42, best player near 78
    character_base = rng.gauss(52, 9)  # independent of on-court ability
    profile = _POSITION_PROFILE[position]

    def draw(attribute: str) -> float:
        base = character_base if attribute in _CHARACTER_ATTRIBUTES else skill_base
        return max(15.0, min(96.0, rng.gauss(base + profile.get(attribute, 0.0), 7.0)))

    ratings = Ratings(**{name: draw(name) for name in Ratings.attribute_names()})

    age = rng.randint(20, 35)
    # Young players have room to grow; a 33-year-old is what he is.
    growth_left = max(0.0, (28 - age) / 8.0)

    def bounded_gauss(mu: float, sigma: float, low: float = 5.0, high: float = 95.0) -> float:
        return max(low, min(high, rng.gauss(mu, sigma)))

    hidden = HiddenAttributes(
        potential_ability=max(skill_base, min(99.0, skill_base + growth_left * rng.uniform(4, 26))),
        injury_proneness=bounded_gauss(45, 16),
        consistency=bounded_gauss(52 + tier * 10, 14, 10.0),
        big_game_performance=bounded_gauss(50 + tier * 8, 15, 10.0),
        development_rate=bounded_gauss(52, 15, 10.0),
        learning_ability=bounded_gauss(52, 15, 10.0),
        loyalty=bounded_gauss(50, 18),
        ambition=bounded_gauss(55, 17),
        professionalism=bounded_gauss(character_base, 14),
        temperament=bounded_gauss(character_base, 15),
        adaptability=bounded_gauss(52, 14, 10.0),
        leadership_influence=bounded_gauss(ratings.leadership, 11),
        media_handling=bounded_gauss(50, 17),
        locker_room_presence=bounded_gauss(character_base, 13),
    )

    tendencies = Tendencies(
        usage=max(15.0, min(95.0, rng.gauss(35 + tier * 40, 8))),
        three_point_rate=bounded_gauss(ratings.three_point, 12),
        rim_rate=bounded_gauss((ratings.layups + ratings.close_shot) / 2, 12),
        post_up_rate=bounded_gauss(ratings.post_moves, 12),
        pass_first=bounded_gauss(ratings.passing, 12),
        crash_glass=bounded_gauss(ratings.offensive_rebounding, 12),
    )

    return Player(
        id=f"{team_abbr}-{index:02d}",
        first_name=first_name,
        last_name=last_name,
        position=position,
        age=age,
        height_inches=_POSITION_HEIGHT[position] + rng.randint(-2, 2),
        weight_lbs=180 + (_POSITION_HEIGHT[position] - 74) * 9 + rng.randint(-12, 12),
        jersey=index,
        ratings=ratings,
        tendencies=tendencies,
        hidden=hidden,
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
