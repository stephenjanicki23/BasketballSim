"""Player attributes and the rating scale.

Two dataclasses hold everything a player is:

    Ratings           81 visible attributes -- what a scout can see
    HiddenAttributes  15 hidden attributes -- personality, ceiling, fragility

Scale is 1-20 throughout, Football Manager style:

    20      generational        12-13   average starter     6-7   fringe NBA
    18-19   elite NBA           10-11   rotation player     4-5   G League
    16-17   All-Star             8-9    bench player        1-3   amateur
    14-15   high-end starter

Twenty steps rather than a hundred because one point has to *mean* something:
14 -> 15 is a real upgrade, players end up spiky rather than clustered in the
80s, and a scout's report reads as strengths and weaknesses instead of noise.

Values are stored as floats and clamped, not rounded. The UI rounds for
display; the fractional headroom is what a development system will need to
move a player from 14 to 15 over a season rather than in one jump.

The engine never reads a raw attribute directly. `bballsim/composites.py`
rolls these into the ~25 numbers a possession actually needs, which is the
one place to tune how attributes translate into basketball.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

# 10 is the league-average *player*; an average starter sits at 12-13.
LEAGUE_AVERAGE = 10.0
SCALE_MIN = 1.0        # the tier table bottoms out at 1; 0 would mean "absent"
SCALE_MAX = 20.0


def clamp(value: float, low: float = SCALE_MIN, high: float = SCALE_MAX) -> float:
    return max(low, min(high, value))


def normalize(rating: float) -> float:
    """Map a 1-20 rating onto roughly -0.9 .. +1.0, centred on league average.

    The engine works in these normalized units so probability modifiers read
    as "how much does a full scale of talent move this outcome".
    """
    return (rating - LEAGUE_AVERAGE) / LEAGUE_AVERAGE


def advantage(offense: float, defense: float) -> float:
    """Normalized edge an offensive attribute holds over a defensive one."""
    return normalize(offense) - normalize(defense)


def fraction(value: float) -> float:
    """A rating as 0.0-1.0 of the scale.

    Used where the engine wants a share rather than an edge -- how much of the
    offence a player wants, how hard he crashes the glass. Going through this
    helper rather than dividing by a literal is what let the scale change from
    0-99 to 1-20 without touching a probability.
    """
    return value / SCALE_MAX


@dataclass
class Ratings:
    """Visible attributes, on the 1-20 scale.

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
    alike. Values are 1-20 and the engine turns them into selection weights.
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

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> "Tendencies":
        known = set(cls.attribute_names())
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class HiddenAttributes:
    """Attributes a manager cannot see without scouting.

    Nothing here shows up in the roster UI. The engine reads a few of them
    (consistency, big_game_performance, injury_proneness); the rest are the
    hooks development, contracts and locker-room systems will need.
    """

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
    "rebound_timing": "Timing",
    "rebound_positioning": "Rebound Positioning",
    "passing_from_post": "Passing from the Post",
}


# --------------------------------------------------------------------------
# What a number means. Used for tooltips, scout reports and the roster UI --
# a 1-20 scale is only an improvement if the tiers are legible.
# --------------------------------------------------------------------------

RATING_TIERS: tuple[tuple[float, str], ...] = (
    (20.0, "Generational"),
    (18.0, "Elite NBA"),
    (16.0, "All-Star"),
    (14.0, "High-end starter"),
    (12.0, "Average starter"),
    (10.0, "Rotation player"),
    (8.0, "Bench player"),
    (6.0, "Fringe NBA"),
    (4.0, "G League"),
    (1.0, "Amateur"),
)


def tier_label(rating: float) -> str:
    for floor, label in RATING_TIERS:
        if rating >= floor:
            return label
    return RATING_TIERS[-1][1]


def to_display(rating: float, scale: int = 20) -> int:
    """Render a rating on the 1-20 scale, or on 0-100 for audiences that
    expect it. Storage is always 1-20; this is presentation only."""
    if scale == 100:
        return round(rating / SCALE_MAX * 100)
    return round(rating)


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

    # Thresholds are on the 1-20 scale: 16 = "elite for this trait",
    # 14 = strong, 11 = above average, 7 = a genuine flaw.
    # Temperament gates first: a volatile player is volatile no matter how
    # driven he is, which is exactly why the label is worth knowing.
    if temperament <= 6 and ambition >= 14:
        return "Volatile"
    if temperament <= 7:
        return "Temperamental"
    if professionalism <= 6:
        return "Casual"
    if professionalism >= 16 and determination >= 16 and temperament >= 14:
        return "Model Professional"
    if ratings.leadership >= 15 and hidden.locker_room_presence >= 14:
        return "Born Leader"
    if professionalism >= 14 and determination >= 14:
        return "Professional"
    if determination >= 16 and ambition >= 15:
        return "Driven"
    if ambition >= 16 and loyalty <= 7:
        return "Ambitious"
    if loyalty >= 16 and professionalism >= 12:
        return "Loyal"
    if determination >= 13:
        return "Determined"
    if temperament >= 14 and professionalism >= 11:
        return "Level Headed"
    return "Balanced"


# Overall lives in `ability.py` now: it is the 1-20 face of Current Ability,
# which is itself a position-weighted sum of the attributes above. Keeping one
# definition means a player's headline number and his attributes can never
# disagree. See `ability.current_ability()` and `ability.ca_to_scale()`.
