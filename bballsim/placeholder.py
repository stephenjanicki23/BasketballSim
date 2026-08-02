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
        "close_shot": -0.8, "layups": 1.2, "dunking": -4.4, "three_point": 1.6,
        "free_throws": 1.6, "off_ball_shooting": -0.4,
        "finishing_through_contact": -2.0, "floater": 2.4, "euro_step": 2.0,
        "post_moves": -4.4, "post_footwork": -4.4, "post_hook": -4.8, "fadeaway": -0.8,
        "passing": 3.6, "ball_handling": 4.0, "dribbling": 4.0, "court_vision": 3.6,
        "pick_and_roll_handler": 3.6, "decision_making": 2.0, "creativity": 2.4,
        "assist_iq": 3.2,
        "perimeter_defense": 1.2, "interior_defense": -4.0, "help_defense": -1.2,
        "blocks": -4.4, "steals": 1.6, "switchability": -1.2, "post_defense": -4.4,
        "rim_protection": -5.2, "shot_contest": -0.8,
        "offensive_rebounding": -3.6, "defensive_rebounding": -3.2,
        "boxing_out": -2.8, "rebound_positioning": -2.0, "rebound_timing": -1.6,
        "speed": 2.4, "acceleration": 2.8, "agility": 2.8, "quickness": 3.2,
        "strength": -2.8, "balance": 1.2,
        "pick_and_roll_creation": 3.6, "isolation": 1.6, "pull_up_shooting": 2.0,
        "transition_play": 2.8, "pace_control": 3.6,
        "catch_and_shoot": 0.4, "cutting": -1.2, "off_ball_movement": -0.8,
        "wing_defense": -1.2, "transition_finishing": 0.8,
        "screen_setting": -3.6, "roll_man": -4.4, "passing_from_post": -2.4,
        "offensive_awareness": 1.6, "spatial_awareness": 1.6,
    },
    Position.SG: {
        "three_point": 2.8, "mid_range": 2.4, "free_throws": 1.2,
        "off_ball_shooting": 2.4, "shot_selection": 0.4,
        "layups": 0.8, "euro_step": 1.2, "fadeaway": 0.8,
        "post_moves": -3.2, "post_hook": -3.6, "post_footwork": -3.2,
        "ball_handling": 1.6, "dribbling": 1.6, "passing": 0.4, "court_vision": 0.4,
        "perimeter_defense": 1.2, "interior_defense": -2.8, "blocks": -3.2,
        "steals": 0.8, "rim_protection": -4.0, "post_defense": -3.2,
        "offensive_rebounding": -2.4, "defensive_rebounding": -2.0, "boxing_out": -1.6,
        "speed": 1.6, "acceleration": 1.6, "agility": 1.6, "quickness": 1.6, "strength": -1.2,
        "pull_up_shooting": 2.4, "catch_and_shoot": 2.8, "isolation": 1.2,
        "off_ball_movement": 2.0, "transition_play": 1.2,
        "screen_setting": -2.4, "roll_man": -3.2, "passing_from_post": -1.6,
    },
    Position.SF: {
        "three_point": 1.2, "mid_range": 0.8, "layups": 1.2,
        "finishing_through_contact": 1.2, "offensive_versatility": 2.0,
        "off_ball_shooting": 1.2,
        "perimeter_defense": 1.2, "wing_defense": 2.4, "switchability": 1.6,
        "defensive_rebounding": 0.4, "help_defense": 0.8,
        "cutting": 2.0, "off_ball_movement": 1.6, "transition_finishing": 1.6,
        "catch_and_shoot": 1.2,
        "post_moves": -0.8, "post_hook": -1.2, "rim_protection": -1.6,
        "screen_setting": -0.8, "roll_man": -1.2,
    },
    Position.PF: {
        "close_shot": 1.6, "layups": 1.2, "dunking": 2.4,
        "finishing_through_contact": 2.4, "post_moves": 2.0, "post_footwork": 2.0,
        "post_hook": 1.6, "three_point": -1.2, "off_ball_shooting": -0.8,
        "ball_handling": -2.8, "dribbling": -2.8, "passing": -1.2,
        "court_vision": -1.2, "pick_and_roll_handler": -2.8, "assist_iq": -1.2,
        "interior_defense": 2.4, "help_defense": 1.6, "blocks": 2.0,
        "post_defense": 2.4, "rim_protection": 1.6, "perimeter_defense": -0.8,
        "offensive_rebounding": 2.4, "defensive_rebounding": 2.8,
        "boxing_out": 2.8, "rebound_positioning": 2.4, "rebound_timing": 2.0,
        "strength": 2.8, "vertical_leap": 1.6, "speed": -1.2, "quickness": -1.6,
        "agility": -1.2,
        "screen_setting": 2.4, "roll_man": 2.4, "passing_from_post": 1.2,
        "isolation": -1.6, "pull_up_shooting": -1.6, "pick_and_roll_creation": -2.8,
        "pace_control": -2.0, "cutting": 0.8,
    },
    Position.C: {
        "close_shot": 2.8, "layups": 1.6, "dunking": 4.0,
        "finishing_through_contact": 3.2, "post_moves": 3.2, "post_footwork": 3.2,
        "post_hook": 3.6, "floater": -0.8,
        "three_point": -4.0, "mid_range": -2.4, "free_throws": -2.4,
        "off_ball_shooting": -2.8, "fadeaway": -1.2,
        "ball_handling": -4.4, "dribbling": -4.4, "passing": -1.6,
        "court_vision": -2.0, "pick_and_roll_handler": -4.4, "assist_iq": -1.6,
        "creativity": -1.6,
        "interior_defense": 4.0, "rim_protection": 4.0, "post_defense": 4.0,
        "blocks": 4.0, "help_defense": 2.0, "perimeter_defense": -2.8,
        "switchability": -2.4, "steals": -1.6,
        "offensive_rebounding": 3.6, "defensive_rebounding": 4.0,
        "boxing_out": 3.6, "rebound_positioning": 3.2, "rebound_timing": 2.8,
        "strength": 4.0, "vertical_leap": 1.6, "speed": -2.8, "quickness": -3.2,
        "agility": -2.8, "acceleration": -2.4,
        "screen_setting": 4.0, "roll_man": 4.0, "passing_from_post": 2.4,
        "isolation": -3.2, "pull_up_shooting": -3.6, "pick_and_roll_creation": -4.4,
        "transition_play": -2.4, "pace_control": -2.8, "cutting": -0.8,
        "wing_defense": -2.8,
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
    """tier is 0..1 -- how good this player is relative to his team's roster.

    On the 1-20 scale the tiers are the point: a roster's best player lands
    around 15-17 (high-end starter to All-Star), his rotation sits at 10-12,
    and the twelfth man is an 8 who can do one thing. Players are given a
    handful of spikes and holes rather than a flat profile, because a scale
    this short is only useful if it produces obvious strengths and weaknesses.
    """
    skill_base = 7.5 + tier * 7.0      # twelfth man ~7.5, best player ~14.5
    character_base = rng.gauss(10.5, 2.0)  # independent of on-court ability
    profile = _POSITION_PROFILE[position]

    # Specialisation: a few attributes he is known for, a few he cannot do.
    skills = [n for n in Ratings.attribute_names() if n not in _CHARACTER_ATTRIBUTES]
    spikes = set(rng.sample(skills, rng.randint(3, 6)))
    holes = set(rng.sample([n for n in skills if n not in spikes], rng.randint(3, 6)))

    def draw(attribute: str) -> float:
        if attribute in _CHARACTER_ATTRIBUTES:
            return clamp(rng.gauss(character_base, 1.6))
        base = skill_base + profile.get(attribute, 0.0)
        if attribute in spikes:
            base += rng.uniform(1.8, 3.6)
        elif attribute in holes:
            base -= rng.uniform(1.8, 3.6)
        return clamp(rng.gauss(base, 1.3))

    ratings = Ratings(**{name: draw(name) for name in Ratings.attribute_names()})

    age = rng.randint(20, 35)
    # Young players have room to grow; a 33-year-old is what he is.
    growth_left = max(0.0, (28 - age) / 8.0)

    def gauss(mu: float, sigma: float) -> float:
        return clamp(rng.gauss(mu, sigma))

    hidden = HiddenAttributes(
        potential_ability=clamp(skill_base + growth_left * rng.uniform(0.8, 5.5)),
        injury_proneness=gauss(9.0, 3.2),
        consistency=gauss(10.5 + tier * 2.0, 2.8),
        big_game_performance=gauss(10.0 + tier * 1.6, 3.0),
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

    tendencies = Tendencies(
        usage=gauss(7.0 + tier * 8.0, 1.6),
        three_point_rate=gauss(ratings.three_point, 2.4),
        rim_rate=gauss((ratings.layups + ratings.close_shot) / 2, 2.4),
        post_up_rate=gauss(ratings.post_moves, 2.4),
        pass_first=gauss(ratings.passing, 2.4),
        crash_glass=gauss(ratings.offensive_rebounding, 2.4),
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
        team_chemistry=rng.uniform(40, 70),  # 0-100, not a player rating
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
