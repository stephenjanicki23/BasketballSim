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
    ca_tier,
    generate_ratings,
    make_ability,
)
from .biography import draw_age, draw_height, draw_weight, make_biography
from .coach import make_coaches
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
    "Nakamura", "Okonkwo", "Petrov", "Quinlan", "Rasmussen", "Solberg",
    "Takahashi", "Ustinov", "Villalobos", "Wagstaff", "Xiong", "Yamamoto",
    "Zielinski", "Ackerman", "Barrington", "Caldwell", "Draper", "Eberhardt",
    "Fairweather", "Gundersen", "Hollingsworth", "Iverson", "Jacoby",
    "Kaminski", "Langford", "Mattheson", "Novak", "Ortega", "Pankhurst",
    "Quesada", "Radcliffe", "Sorensen", "Thibodeaux", "Ugarte", "Voss",
    "Whittaker", "Yeoman", "Zaragoza", "Ashford", "Bexley", "Carrington",
    "Duquette", "Emerson", "Fitzgibbon", "Garrity", "Hendricks", "Ilyushin",
    "Jorgensen", "Kilpatrick", "Lockhart", "Montrose", "Nightingale",
    "Ordonez", "Paxton", "Quimby", "Ridgeway", "Stanhope", "Tremaine",
    "Upshaw", "Valdez", "Wilkerson", "Yancey", "Zeller", "Attwater",
    "Bergstrom", "Chandler", "Devereaux", "Eastgate", "Fairholm", "Gladwell",
    "Harrowgate", "Innsbruck", "Jankovic", "Kettering", "Lascelles",
    "Mortimer", "Nunnally", "Oldfield", "Pemberly", "Quillon", "Ravensworth",
    "Sinclair", "Thackeray", "Umbridge", "Vanderberg", "Whitmore", "Yelverton",
    "Zabriskie", "Alcott", "Bannerman", "Crowther", "Dunstable", "Eldridge",
    "Fothergill", "Goodwin", "Hargreaves", "Iremonger", "Jephson",
    "Kenworthy", "Lyttleton", "Marchbanks", "Nettlefold", "Ollerenshaw",
    "Prendergast", "Quennell", "Rowntree", "Standish", "Tattersall",
    "Underwood", "Vickery", "Wolstenholme", "Yardley", "Zouche", "Applegarth",
    "Birtwistle", "Cholmondeley", "Dalrymple", "Etheridge", "Farthingale",
    "Grimsditch", "Huddleston", "Ingoldsby", "Jerningham", "Kirkbride",
    "Loveridge", "Mallinson", "Ninnis", "Ogilvie", "Postlethwaite",
    "Quatermain", "Rushworth", "Snodgrass", "Thorneycroft", "Ubaldini",
    "Vansittart", "Wickersham", "Yoxall", "Zetterberg", "Aldington",
    "Blenkinsop", "Carmichael", "Dinsdale", "Ellerbeck", "Featherstone",
    "Gainsborough", "Hollingbourne", "Ickringill", "Jellicoe", "Kempthorne",
    "Lightfoot", "Micklethwaite", "Naismith", "Oglethorpe", "Pilkington",
    "Quantrill", "Ravenscroft", "Shackleton", "Trelawney", "Uttridge",
    "Verinder", "Winterbourne", "Yelland", "Zimmerman", "Arbuthnot",
    "Beauchamp", "Cadwallader", "Duckworth", "Endicott", "Fanshawe",
    "Garforth", "Hawksmoor", "Iddesleigh", "Joliffe", "Kirkpatrick",
    "Lansbury", "Meredith", "Nuttall", "Ottoline", "Popplewell", "Quilter",
    "Rickenbacker", "Somerville", "Templeton", "Urquhart", "Vivian",
    "Wolfenden", "Yeatman", "Zangwill", "Aberdeen", "Broadbent", "Culpepper",
    "Danvers", "Edgerton", "Fitzroy", "Glanville", "Havelock", "Isherwood",
    "Jardine", "Kilbride", "Lamplugh", "Mowbray", "Norrington", "Osbourne",
    "Prideaux", "Quiller", "Rasmusson", "Selwyn", "Thistlewood", "Ulverston",
    "Ventris", "Wadsworth", "Yelverley", "Zealand", "Ancaster", "Bickerstaff",
    "Cranleigh", "Devonport", "Ecclestone", "Fitzalan", "Godolphin",
    "Hazelwood", "Irvington", "Jessamine", "Kenilworth", "Lindisfarne",
    "Mandeville", "Northbrook", "Orpington", "Pendlebury", "Quorndon",
    "Rothesay", "Stapleton", "Tewkesbury", "Ullswater", "Vandeleur",
    "Wrottesley", "Yarborough", "Zennor", "Ashbourne", "Beddingfield",
    "Chelmsford", "Dunwoody", "Elphinstone", "Fairbrother", "Grosvenor",
    "Hartlepool", "Ilchester", "Jerviswood", "Knatchbull", "Lauderdale",
    "Marlborough", "Newcombe", "Oxenford", "Pontefract", "Quendon",
    "Ravenglass", "Strathmore", "Tunstall", "Uppingham", "Vereker",
    "Willoughby", "Yattendon", "Zouch",
]

_FIRST_NAMES = [
    "Andre", "Bryce", "Cam", "Dante", "Elias", "Finn", "Gus", "Hector",
    "Isaiah", "Jonah", "Kai", "Luca", "Miles", "Noel", "Omar", "Pierce",
    "Quinn", "Rashad", "Silas", "Tobias", "Amari", "Brandon", "Caleb",
    "Damian", "Ezra", "Felix", "Gabriel", "Harun", "Ivan", "Jalen",
    "Kofi", "Lorenzo", "Malik", "Nikola", "Oscar", "Patrice", "Rafael",
    "Sebastian", "Tariq", "Vince", "Wesley", "Xavier", "Yusuf", "Zane",
    "Adrian", "Bilal", "Cole", "Diego", "Emmett", "Franco", "Grayson",
    "Hugo", "Idris", "Jasper", "Kenji", "Leonel", "Marcus", "Nathanael",
    "Oren", "Pavel", "Reuben", "Santiago", "Theo", "Ulrich", "Viktor",
    "Warren", "Yannick", "Zeke",
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
        position_profile=_POSITION_PROFILE[position],
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
    surnames = surnames or rng.sample(_SURNAMES, _ROSTER_SIZE)
    first_names = rng.sample(_FIRST_NAMES, _ROSTER_SIZE)

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
    if needed > len(_SURNAMES):
        raise ValueError(f"need {needed} unique surnames, pool has {len(_SURNAMES)}")
    pool = rng.sample(_SURNAMES, needed)
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
