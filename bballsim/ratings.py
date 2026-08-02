"""Attribute definitions and the rating scale.

Everything in the sim reads player skill through this module, so changing the
scale or adding an attribute only has to happen here.

Scale is 0-99 like most basketball games:
    25 = unplayable   50 = league average   75 = All-Star   90+ = MVP tier
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields

LEAGUE_AVERAGE = 50.0
SCALE_MIN = 0.0
SCALE_MAX = 99.0


def clamp(value: float, low: float = SCALE_MIN, high: float = SCALE_MAX) -> float:
    return max(low, min(high, value))


def normalize(rating: float) -> float:
    """Map a 0-99 rating onto roughly -1.0 .. +1.0, centred on league average.

    The engine works in these normalized units so that probability modifiers
    stay readable: +1.0 means "a full scale above average".
    """
    return (rating - LEAGUE_AVERAGE) / LEAGUE_AVERAGE


def advantage(offense: float, defense: float) -> float:
    """Normalized edge the offensive attribute holds over the defensive one."""
    return normalize(offense) - normalize(defense)


@dataclass
class Ratings:
    """A player's attributes. All values are on the 0-99 scale.

    Deliberately flat rather than nested -- the engine references these by name
    constantly and a flat struct keeps possession code readable.
    """

    # --- Scoring -----------------------------------------------------------
    finishing: float = LEAGUE_AVERAGE       # at the rim
    mid_range: float = LEAGUE_AVERAGE
    three_point: float = LEAGUE_AVERAGE
    free_throw: float = LEAGUE_AVERAGE
    post_game: float = LEAGUE_AVERAGE
    drawing_fouls: float = LEAGUE_AVERAGE

    # --- Creation ----------------------------------------------------------
    playmaking: float = LEAGUE_AVERAGE      # passing reads / assist creation
    ball_handling: float = LEAGUE_AVERAGE
    off_ball: float = LEAGUE_AVERAGE        # movement, spacing, cutting

    # --- Defense -----------------------------------------------------------
    perimeter_defense: float = LEAGUE_AVERAGE
    interior_defense: float = LEAGUE_AVERAGE
    steal: float = LEAGUE_AVERAGE
    block: float = LEAGUE_AVERAGE
    def_rebounding: float = LEAGUE_AVERAGE
    off_rebounding: float = LEAGUE_AVERAGE

    # --- Physical / mental -------------------------------------------------
    speed: float = LEAGUE_AVERAGE
    strength: float = LEAGUE_AVERAGE
    stamina: float = LEAGUE_AVERAGE
    basketball_iq: float = LEAGUE_AVERAGE
    discipline: float = LEAGUE_AVERAGE      # inverse of foul-proneness

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


@dataclass
class Tendencies:
    """How often a player *wants* to do something, independent of how good he is.

    Kept separate from Ratings on purpose: a low-usage elite shooter and a
    high-usage chucker can share a three_point rating but behave very
    differently. Values are 0-99 and get turned into weights by the engine.
    """

    usage: float = LEAGUE_AVERAGE           # share of possessions he wants
    three_point_rate: float = LEAGUE_AVERAGE
    rim_rate: float = LEAGUE_AVERAGE
    pass_first: float = LEAGUE_AVERAGE
    crash_glass: float = LEAGUE_AVERAGE

    def __post_init__(self) -> None:
        for f in fields(self):
            setattr(self, f.name, clamp(float(getattr(self, f.name))))

    def to_dict(self) -> dict[str, float]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


# Positional weights used when we need one number for "how good is this player".
# Only used for depth-chart sorting and UI display -- never inside possession math.
OVERALL_WEIGHTS: dict[str, float] = {
    "finishing": 1.0,
    "mid_range": 0.7,
    "three_point": 1.0,
    "playmaking": 1.0,
    "ball_handling": 0.7,
    "perimeter_defense": 0.9,
    "interior_defense": 0.9,
    "def_rebounding": 0.6,
    "steal": 0.4,
    "block": 0.4,
    "speed": 0.5,
    "strength": 0.4,
    "basketball_iq": 0.7,
}


def overall(ratings: Ratings) -> float:
    total = sum(OVERALL_WEIGHTS.values())
    score = sum(getattr(ratings, k) * w for k, w in OVERALL_WEIGHTS.items())
    return round(score / total, 1)
