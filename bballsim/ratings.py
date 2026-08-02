"""Player attributes and the rating scale.

Two dataclasses hold everything a player is:

    Ratings           81 visible attributes -- what a scout can see
    HiddenAttributes  15 hidden attributes -- personality, ceiling, fragility

Scale is 1-99 throughout:
    20 = unplayable   50 = league average   75 = All-Star   90+ = MVP tier

The engine never reads a raw attribute directly. `bballsim/composites.py`
rolls these into the ~25 numbers a possession actually needs, which is the
one place to tune how attributes translate into basketball.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

LEAGUE_AVERAGE = 50.0
SCALE_MIN = 1.0
SCALE_MAX = 99.0


def clamp(value: float, low: float = SCALE_MIN, high: float = SCALE_MAX) -> float:
    return max(low, min(high, value))


def normalize(rating: float) -> float:
    """Map a 1-99 rating onto roughly -1.0 .. +1.0, centred on league average.

    The engine works in these normalized units so probability modifiers read
    as "how much does a full scale of talent move this outcome".
    """
    return (rating - LEAGUE_AVERAGE) / LEAGUE_AVERAGE


def advantage(offense: float, defense: float) -> float:
    """Normalized edge an offensive attribute holds over a defensive one."""
    return normalize(offense) - normalize(defense)


@dataclass
class Ratings:
    """Visible attributes, on the 1-99 scale.

    Flat rather than nested: the engine references these constantly and
    grouping is handled by ATTRIBUTE_GROUPS below, which is display metadata.
    """

    # --- Shooting ----------------------------------------------------------
    close_shot: float = LEAGUE_AVERAGE
    layups: float = LEAGUE_AVERAGE
    dunking: float = LEAGUE_AVERAGE
    mid_range: float = LEAGUE_AVERAGE
    three_point: float = LEAGUE_AVERAGE
    free_throws: float = LEAGUE_AVERAGE
    shot_selection: float = LEAGUE_AVERAGE
    off_ball_shooting: float = LEAGUE_AVERAGE

    # --- Playmaking --------------------------------------------------------
    passing: float = LEAGUE_AVERAGE
    ball_handling: float = LEAGUE_AVERAGE
    dribbling: float = LEAGUE_AVERAGE
    court_vision: float = LEAGUE_AVERAGE
    pick_and_roll_handler: float = LEAGUE_AVERAGE
    decision_making: float = LEAGUE_AVERAGE      # also shown under Basketball IQ
    creativity: float = LEAGUE_AVERAGE
    assist_iq: float = LEAGUE_AVERAGE

    # --- Finishing ---------------------------------------------------------
    finishing_through_contact: float = LEAGUE_AVERAGE
    floater: float = LEAGUE_AVERAGE
    post_moves: float = LEAGUE_AVERAGE
    post_footwork: float = LEAGUE_AVERAGE
    post_hook: float = LEAGUE_AVERAGE
    fadeaway: float = LEAGUE_AVERAGE
    euro_step: float = LEAGUE_AVERAGE
    offensive_versatility: float = LEAGUE_AVERAGE

    # --- Defense -----------------------------------------------------------
    perimeter_defense: float = LEAGUE_AVERAGE
    interior_defense: float = LEAGUE_AVERAGE
    help_defense: float = LEAGUE_AVERAGE
    pick_and_roll_defense: float = LEAGUE_AVERAGE
    defensive_iq: float = LEAGUE_AVERAGE
    shot_contest: float = LEAGUE_AVERAGE
    steals: float = LEAGUE_AVERAGE
    blocks: float = LEAGUE_AVERAGE
    switchability: float = LEAGUE_AVERAGE

    # --- Rebounding --------------------------------------------------------
    offensive_rebounding: float = LEAGUE_AVERAGE
    defensive_rebounding: float = LEAGUE_AVERAGE  # also shown under Defense
    boxing_out: float = LEAGUE_AVERAGE
    rebound_positioning: float = LEAGUE_AVERAGE
    rebound_timing: float = LEAGUE_AVERAGE

    # --- Athleticism -------------------------------------------------------
    speed: float = LEAGUE_AVERAGE
    acceleration: float = LEAGUE_AVERAGE
    agility: float = LEAGUE_AVERAGE
    vertical_leap: float = LEAGUE_AVERAGE
    strength: float = LEAGUE_AVERAGE
    stamina: float = LEAGUE_AVERAGE
    balance: float = LEAGUE_AVERAGE
    quickness: float = LEAGUE_AVERAGE
    durability: float = LEAGUE_AVERAGE

    # --- Basketball IQ -----------------------------------------------------
    offensive_awareness: float = LEAGUE_AVERAGE
    defensive_awareness: float = LEAGUE_AVERAGE
    spatial_awareness: float = LEAGUE_AVERAGE
    anticipation: float = LEAGUE_AVERAGE
    clutch_performance: float = LEAGUE_AVERAGE

    # --- Intangibles -------------------------------------------------------
    leadership: float = LEAGUE_AVERAGE
    work_rate: float = LEAGUE_AVERAGE
    teamwork: float = LEAGUE_AVERAGE
    coachability: float = LEAGUE_AVERAGE
    confidence: float = LEAGUE_AVERAGE
    composure: float = LEAGUE_AVERAGE
    competitive_drive: float = LEAGUE_AVERAGE

    # --- Mental ------------------------------------------------------------
    focus: float = LEAGUE_AVERAGE
    discipline: float = LEAGUE_AVERAGE
    aggression: float = LEAGUE_AVERAGE
    mental_toughness: float = LEAGUE_AVERAGE
    pressure_handling: float = LEAGUE_AVERAGE
    emotional_control: float = LEAGUE_AVERAGE
    winning_mentality: float = LEAGUE_AVERAGE

    # --- Guard skills ------------------------------------------------------
    pick_and_roll_creation: float = LEAGUE_AVERAGE
    isolation: float = LEAGUE_AVERAGE
    pull_up_shooting: float = LEAGUE_AVERAGE
    transition_play: float = LEAGUE_AVERAGE
    pace_control: float = LEAGUE_AVERAGE

    # --- Wing skills -------------------------------------------------------
    catch_and_shoot: float = LEAGUE_AVERAGE
    cutting: float = LEAGUE_AVERAGE
    off_ball_movement: float = LEAGUE_AVERAGE
    wing_defense: float = LEAGUE_AVERAGE
    transition_finishing: float = LEAGUE_AVERAGE

    # --- Big skills --------------------------------------------------------
    screen_setting: float = LEAGUE_AVERAGE
    roll_man: float = LEAGUE_AVERAGE
    post_defense: float = LEAGUE_AVERAGE
    rim_protection: float = LEAGUE_AVERAGE
    passing_from_post: float = LEAGUE_AVERAGE

    def __post_init__(self) -> None:
        for f in fields(self):
            setattr(self, f.name, clamp(float(getattr(self, f.name))))

    @classmethod
    def attribute_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]

    def to_dict(self) -> dict[str, float]:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> "Ratings":
        known = set(cls.attribute_names())
        return cls(**{k: v for k, v in data.items() if k in known})

    def mean(self, *names: str) -> float:
        """Average of the named attributes -- the building block of composites."""
        return sum(getattr(self, n) for n in names) / len(names)


@dataclass
class Tendencies:
    """How often a player *wants* to do something, separate from how good he is.

    Kept apart from Ratings on purpose: a low-usage elite shooter and a
    high-volume chucker can share a three_point rating and behave nothing
    alike. Values are 1-99 and the engine turns them into selection weights.
    """

    usage: float = LEAGUE_AVERAGE           # share of possessions he wants
    three_point_rate: float = LEAGUE_AVERAGE
    rim_rate: float = LEAGUE_AVERAGE
    post_up_rate: float = LEAGUE_AVERAGE
    pass_first: float = LEAGUE_AVERAGE
    crash_glass: float = LEAGUE_AVERAGE

    def __post_init__(self) -> None:
        for f in fields(self):
            setattr(self, f.name, clamp(float(getattr(self, f.name))))

    @classmethod
    def attribute_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]

    def to_dict(self) -> dict[str, float]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


@dataclass
class HiddenAttributes:
    """Attributes a manager cannot see without scouting.

    Nothing here shows up in the roster UI. The engine reads a few of them
    (consistency, big_game_performance, injury_proneness); the rest are the
    hooks development, contracts and locker-room systems will need.
    """

    potential_ability: float = LEAGUE_AVERAGE   # ceiling, not current ability
    injury_proneness: float = LEAGUE_AVERAGE
    consistency: float = LEAGUE_AVERAGE         # night-to-night variance
    big_game_performance: float = LEAGUE_AVERAGE
    development_rate: float = LEAGUE_AVERAGE
    learning_ability: float = LEAGUE_AVERAGE
    loyalty: float = LEAGUE_AVERAGE
    ambition: float = LEAGUE_AVERAGE
    professionalism: float = LEAGUE_AVERAGE
    temperament: float = LEAGUE_AVERAGE
    adaptability: float = LEAGUE_AVERAGE
    leadership_influence: float = LEAGUE_AVERAGE
    media_handling: float = LEAGUE_AVERAGE
    locker_room_presence: float = LEAGUE_AVERAGE

    def __post_init__(self) -> None:
        for f in fields(self):
            setattr(self, f.name, clamp(float(getattr(self, f.name))))

    @classmethod
    def attribute_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]

    def to_dict(self) -> dict[str, float]:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> "HiddenAttributes":
        known = set(cls.attribute_names())
        return cls(**{k: v for k, v in data.items() if k in known})


# --------------------------------------------------------------------------
# Display metadata. An attribute may appear in more than one group -- it is
# still one stored value. `decision_making` sits in Playmaking and Basketball
# IQ; `defensive_rebounding` sits in Defense and Rebounding.
# --------------------------------------------------------------------------

ATTRIBUTE_GROUPS: dict[str, tuple[str, ...]] = {
    "Shooting": (
        "close_shot", "layups", "dunking", "mid_range", "three_point",
        "free_throws", "shot_selection", "off_ball_shooting",
    ),
    "Playmaking": (
        "passing", "ball_handling", "dribbling", "court_vision",
        "pick_and_roll_handler", "decision_making", "creativity", "assist_iq",
    ),
    "Finishing": (
        "finishing_through_contact", "floater", "post_moves", "post_footwork",
        "post_hook", "fadeaway", "euro_step", "offensive_versatility",
    ),
    "Defense": (
        "perimeter_defense", "interior_defense", "help_defense",
        "pick_and_roll_defense", "defensive_iq", "shot_contest", "steals",
        "blocks", "defensive_rebounding", "switchability",
    ),
    "Rebounding": (
        "offensive_rebounding", "defensive_rebounding", "boxing_out",
        "rebound_positioning", "rebound_timing",
    ),
    "Athleticism": (
        "speed", "acceleration", "agility", "vertical_leap", "strength",
        "stamina", "balance", "quickness", "durability",
    ),
    "Basketball IQ": (
        "offensive_awareness", "defensive_awareness", "spatial_awareness",
        "decision_making", "anticipation", "clutch_performance",
    ),
    "Intangibles": (
        "leadership", "work_rate", "teamwork", "coachability", "confidence",
        "composure", "competitive_drive",
    ),
    "Mental": (
        "focus", "discipline", "aggression", "mental_toughness",
        "pressure_handling", "emotional_control", "winning_mentality",
    ),
    "Guard skills": (
        "pick_and_roll_creation", "isolation", "pull_up_shooting",
        "transition_play", "pace_control",
    ),
    "Wing skills": (
        "catch_and_shoot", "cutting", "off_ball_movement", "wing_defense",
        "transition_finishing",
    ),
    "Big skills": (
        "screen_setting", "roll_man", "post_defense", "rim_protection",
        "passing_from_post",
    ),
}

# Position-specific groups are shown for every player, not just that position:
# a centre with real Isolation is a matchup problem, and the engine wants to
# know about it rather than treat the attribute as absent.
POSITION_GROUPS = ("Guard skills", "Wing skills", "Big skills")

HIDDEN_GROUP = tuple(HiddenAttributes.attribute_names())

# Short labels for stat-sheet style tables.
ATTRIBUTE_LABELS: dict[str, str] = {
    "close_shot": "CLS", "layups": "LAY", "dunking": "DNK", "mid_range": "MID",
    "three_point": "3PT", "free_throws": "FT", "shot_selection": "SEL",
    "off_ball_shooting": "OBS",
    "passing": "PAS", "ball_handling": "HDL", "dribbling": "DRB",
    "court_vision": "VIS", "pick_and_roll_handler": "PNR",
    "decision_making": "DEC", "creativity": "CRE", "assist_iq": "AIQ",
    "finishing_through_contact": "CON", "floater": "FLT", "post_moves": "PST",
    "post_footwork": "FTW", "post_hook": "HOK", "fadeaway": "FDE",
    "euro_step": "EUR", "offensive_versatility": "VER",
    "perimeter_defense": "PER", "interior_defense": "INT", "help_defense": "HLP",
    "pick_and_roll_defense": "PND", "defensive_iq": "DIQ", "shot_contest": "CNT",
    "steals": "STL", "blocks": "BLK", "switchability": "SWI",
    "offensive_rebounding": "ORB", "defensive_rebounding": "DRB+",
    "boxing_out": "BOX", "rebound_positioning": "POS", "rebound_timing": "TIM",
    "speed": "SPD", "acceleration": "ACC", "agility": "AGI",
    "vertical_leap": "VRT", "strength": "STR", "stamina": "STA",
    "balance": "BAL", "quickness": "QCK", "durability": "DUR",
    "offensive_awareness": "OAW", "defensive_awareness": "DAW",
    "spatial_awareness": "SPA", "anticipation": "ANT", "clutch_performance": "CLU",
    "leadership": "LED", "work_rate": "WOR", "teamwork": "TEA",
    "coachability": "COA", "confidence": "CNF", "composure": "CMP",
    "competitive_drive": "DRV",
    "focus": "FOC", "discipline": "DSC", "aggression": "AGG",
    "mental_toughness": "TGH", "pressure_handling": "PRS",
    "emotional_control": "EMO", "winning_mentality": "WIN",
    "pick_and_roll_creation": "PRC", "isolation": "ISO", "pull_up_shooting": "PUL",
    "transition_play": "TRN", "pace_control": "PAC",
    "catch_and_shoot": "CAS", "cutting": "CUT", "off_ball_movement": "OBM",
    "wing_defense": "WNG", "transition_finishing": "TRF",
    "screen_setting": "SCR", "roll_man": "ROL", "post_defense": "PSD",
    "rim_protection": "RIM", "passing_from_post": "PFP",
}


# .title() mangles acronyms and hyphenated basketball terms, so the awkward
# ones are spelled out.
DISPLAY_OVERRIDES: dict[str, str] = {
    "assist_iq": "Assist IQ",
    "defensive_iq": "Defensive IQ",
    "basketball_iq": "Basketball IQ",
    "off_ball_shooting": "Off-Ball Shooting",
    "off_ball_movement": "Off-Ball Movement",
    "pull_up_shooting": "Pull-Up Shooting",
    "catch_and_shoot": "Catch-and-Shoot",
    "pick_and_roll_handler": "Pick-and-Roll Handler",
    "pick_and_roll_defense": "Pick-and-Roll Defense",
    "pick_and_roll_creation": "Pick-and-Roll Creation",
    "three_point": "Three-Point",
    "mid_range": "Mid-Range",
    "euro_step": "Euro Step",
    "potential_ability": "Potential Ability (PA)",
    "rebound_timing": "Timing",
    "rebound_positioning": "Rebound Positioning",
    "passing_from_post": "Passing from the Post",
}


def display_name(key: str) -> str:
    return DISPLAY_OVERRIDES.get(key, key.replace("_", " ").title())


# --------------------------------------------------------------------------
# Personality. In FM this is a derived label, not a slider -- it reads off the
# hidden personality attributes. A raw "personality: 63" carries no meaning,
# so it is computed here instead of stored.
# --------------------------------------------------------------------------

def personality_label(ratings: Ratings, hidden: HiddenAttributes) -> str:
    professionalism = hidden.professionalism
    ambition = hidden.ambition
    temperament = hidden.temperament
    determination = ratings.competitive_drive
    loyalty = hidden.loyalty

    # Temperament gates first: a volatile player is volatile no matter how
    # driven he is, which is exactly why the label is worth knowing.
    if temperament <= 30 and ambition >= 70:
        return "Volatile"
    if temperament <= 35:
        return "Temperamental"
    if professionalism <= 30:
        return "Casual"
    if professionalism >= 80 and determination >= 80 and temperament >= 70:
        return "Model Professional"
    if ratings.leadership >= 75 and hidden.locker_room_presence >= 70:
        return "Born Leader"
    if professionalism >= 70 and determination >= 70:
        return "Professional"
    if determination >= 80 and ambition >= 75:
        return "Driven"
    if ambition >= 80 and loyalty <= 35:
        return "Ambitious"
    if loyalty >= 80 and professionalism >= 60:
        return "Loyal"
    if determination >= 65:
        return "Determined"
    if temperament >= 70 and professionalism >= 55:
        return "Level Headed"
    return "Balanced"


# --------------------------------------------------------------------------
# Overall. Display and depth-chart sorting only -- never used inside a
# possession, which reads composites instead.
# --------------------------------------------------------------------------

_OVERALL_CORE: dict[str, float] = {
    "close_shot": 0.7, "layups": 0.7, "mid_range": 0.5, "three_point": 1.1,
    "finishing_through_contact": 0.5, "offensive_versatility": 0.5,
    "passing": 0.7, "ball_handling": 0.6, "court_vision": 0.6,
    "decision_making": 0.7,
    "perimeter_defense": 0.9, "interior_defense": 0.8, "defensive_iq": 0.7,
    "shot_contest": 0.5, "defensive_rebounding": 0.6,
    "speed": 0.4, "strength": 0.4, "quickness": 0.4, "vertical_leap": 0.3,
    "offensive_awareness": 0.5, "defensive_awareness": 0.5,
}

# Position tilts the weighting: a centre is not judged on ball handling the
# way a point guard is.
_OVERALL_BY_POSITION: dict[str, dict[str, float]] = {
    "PG": {"passing": 1.3, "ball_handling": 1.2, "court_vision": 1.2,
           "pick_and_roll_handler": 0.9, "decision_making": 1.0,
           "interior_defense": 0.2, "defensive_rebounding": 0.2, "strength": 0.2},
    "SG": {"three_point": 1.4, "pull_up_shooting": 0.7, "catch_and_shoot": 0.6,
           "interior_defense": 0.3, "defensive_rebounding": 0.3},
    "SF": {"offensive_versatility": 0.8, "wing_defense": 0.7, "cutting": 0.4},
    "PF": {"defensive_rebounding": 1.0, "offensive_rebounding": 0.5,
           "interior_defense": 1.0, "strength": 0.7, "ball_handling": 0.3,
           "post_moves": 0.5},
    "C": {"rim_protection": 1.1, "defensive_rebounding": 1.2, "blocks": 0.8,
          "interior_defense": 1.2, "strength": 0.9, "post_moves": 0.6,
          "screen_setting": 0.4, "ball_handling": 0.1, "three_point": 0.4},
}


def overall(ratings: Ratings, position: str = "SF") -> float:
    weights = dict(_OVERALL_CORE)
    weights.update(_OVERALL_BY_POSITION.get(position, {}))
    total = sum(weights.values())
    score = sum(getattr(ratings, key) * weight for key, weight in weights.items())
    return round(score / total, 1)
