"""Current Ability, Potential Ability, and the archetypes that spend them.

The Football Manager model. Two hidden numbers on a 0-200 scale define a
player:

    CA   what he is now
    PA   the ceiling he could realistically reach

**CA is a budget, not a label.** It is a position-weighted sum of the visible
attributes, so a player cannot be given a high CA and poor attributes -- the
two are the same fact viewed at different resolutions. Generation runs that
relationship backwards: pick a CA, pick an archetype and an age, and solve for
the attribute set that spends exactly that budget.

That is what makes two players with identical CA play differently. A Floor
General and a Rim Runner at CA 150 are equally *good*; they are good at
completely different things, because their archetypes spend the same budget in
different places.

    CA never exceeds PA. Enforced in `Ability.__post_init__`, so the invariant
    cannot be broken by construction, by development, or by deserialisation.

This module imports only from `ratings` -- `models` imports *it* -- so position
arrives as a plain string.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from enum import Enum

from .ratings import RATING_TIERS, SCALE_MAX, SCALE_MIN, Ratings, clamp

CA_MIN = 0.0
CA_MAX = 200.0

# What a CA number means, for scout reports and prospect evaluation.
CA_TIERS: tuple[tuple[float, str], ...] = (
    (180.0, "Generational"),
    (162.0, "Elite NBA"),
    (145.0, "All-Star"),
    (128.0, "High-end starter"),
    (112.0, "Average starter"),
    (95.0, "Rotation player"),
    (78.0, "Bench player"),
    (60.0, "Fringe NBA"),
    (38.0, "G League"),
    (0.0, "Amateur"),
)


def ca_tier(ca: float) -> str:
    for floor, label in CA_TIERS:
        if ca >= floor:
            return label
    return CA_TIERS[-1][1]


# --------------------------------------------------------------------------
# Star rating. Ten tiers, ten half-star steps -- the star rating *is* the tier
# table, rendered. 0.5 stars is an amateur, 5 stars is generational.
# --------------------------------------------------------------------------

MIN_STARS = 0.5
MAX_STARS = 5.0


def stars(ca: float) -> float:
    """CA as a 0.5-5.0 star rating, in half-star steps."""
    for index, (floor, _label) in enumerate(CA_TIERS):
        if ca >= floor:
            return MAX_STARS - index * 0.5
    return MIN_STARS


def stars_from_rating(rating: float) -> float:
    """A 1-20 rating as 0.5-5.0 stars, in half-star steps.

    The same trick as `stars()`, against the attribute tier table rather than
    the CA one: both have ten tiers with the same labels, so the two star
    scales mean the same thing. Fed a group average, this is what puts a star
    rating on "Shooting" without inventing a second vocabulary for it.
    """
    for index, (floor, _label) in enumerate(RATING_TIERS):
        if rating >= floor:
            return MAX_STARS - index * 0.5
    return MIN_STARS


def star_tier(star_value: float) -> str:
    """The tier label a star rating stands for."""
    index = int(round((MAX_STARS - star_value) / 0.5))
    index = max(0, min(len(CA_TIERS) - 1, index))
    return CA_TIERS[index][1]


def ca_to_scale(ca: float) -> float:
    """CA (0-200) as a 1-20 rating, for display next to attributes."""
    return SCALE_MIN + (ca / CA_MAX) * (SCALE_MAX - SCALE_MIN)


def scale_to_ca(value: float) -> float:
    return (value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * CA_MAX


@dataclass
class Ability:
    """A player's hidden CA/PA pair. Both 0-200.

    The invariant is enforced here rather than by callers, so there is no path
    -- generation, development, JSON round-trip -- that can produce CA > PA.
    """

    current: float = 100.0
    potential: float = 100.0

    def __post_init__(self) -> None:
        self.potential = max(CA_MIN, min(CA_MAX, float(self.potential)))
        self.current = max(CA_MIN, min(CA_MAX, float(self.current)))
        # The hard rule.
        self.current = min(self.current, self.potential)

    @property
    def headroom(self) -> float:
        """How much CA the player could still add."""
        return max(0.0, self.potential - self.current)

    @property
    def realised(self) -> float:
        """Share of his ceiling already reached, 0.0-1.0."""
        return self.current / self.potential if self.potential > 0 else 1.0

    def set_current(self, value: float) -> None:
        """The only way CA should be written. Clamps to [0, PA]."""
        self.current = max(CA_MIN, min(self.potential, float(value)))

    def to_dict(self) -> dict:
        return {
            "current": round(self.current, 1),
            "potential": round(self.potential, 1),
            "headroom": round(self.headroom, 1),
            "tier": ca_tier(self.current),
            "potential_tier": ca_tier(self.potential),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Ability":
        return cls(current=data.get("current", 100.0), potential=data.get("potential", 100.0))


# --------------------------------------------------------------------------
# CA weights: which attributes CA is actually made of.
#
# Intangibles and Mental are deliberately absent. Leadership, teamwork and
# temperament are character, not ability -- they are generated on their own
# axis, and excluding them stops an archetype from buying CA with attributes
# that do not make a player better at basketball.
# --------------------------------------------------------------------------

CA_BASE_WEIGHTS: dict[str, float] = {
    # Shooting
    "close_shot": 0.9, "layups": 0.9, "dunking": 0.4, "mid_range": 0.7,
    "three_point": 1.1, "free_throws": 0.5, "shot_selection": 0.7,
    "off_ball_shooting": 0.6,
    # Playmaking
    "passing": 0.9, "ball_handling": 0.8, "dribbling": 0.7, "court_vision": 0.8,
    "pick_and_roll_handler": 0.6, "decision_making": 0.9, "creativity": 0.5,
    "assist_iq": 0.6,
    # Finishing
    "finishing_through_contact": 0.6, "floater": 0.4, "post_moves": 0.5,
    "post_footwork": 0.4, "post_hook": 0.3, "fadeaway": 0.3, "euro_step": 0.3,
    "offensive_versatility": 0.7,
    # Defense
    "perimeter_defense": 1.0, "interior_defense": 0.9, "help_defense": 0.7,
    "pick_and_roll_defense": 0.7, "defensive_iq": 0.8, "shot_contest": 0.6,
    "steals": 0.5, "blocks": 0.5, "switchability": 0.5,
    # Rebounding
    "offensive_rebounding": 0.4, "defensive_rebounding": 0.7, "boxing_out": 0.4,
    "rebound_positioning": 0.4, "rebound_timing": 0.3,
    # Athleticism
    "speed": 0.5, "acceleration": 0.5, "agility": 0.5, "vertical_leap": 0.4,
    "strength": 0.4, "stamina": 0.5, "balance": 0.3, "quickness": 0.5,
    "durability": 0.3,
    # Basketball IQ
    "offensive_awareness": 0.6, "defensive_awareness": 0.6,
    "spatial_awareness": 0.5, "anticipation": 0.5, "clutch_performance": 0.3,
    # Position skills
    "pick_and_roll_creation": 0.5, "isolation": 0.4, "pull_up_shooting": 0.5,
    "transition_play": 0.4, "pace_control": 0.3,
    "catch_and_shoot": 0.5, "cutting": 0.3, "off_ball_movement": 0.4,
    "wing_defense": 0.4, "transition_finishing": 0.3,
    "screen_setting": 0.3, "roll_man": 0.3, "post_defense": 0.5,
    "rim_protection": 0.6, "passing_from_post": 0.2,
}

# Position tilts the weighting. A centre is not judged on ball handling the
# way a point guard is, so the same attribute set is worth a different CA
# depending on where the player lines up.
CA_POSITION_WEIGHTS: dict[str, dict[str, float]] = {
    "PG": {"passing": 1.5, "ball_handling": 1.5, "court_vision": 1.4,
           "pick_and_roll_handler": 1.2, "decision_making": 1.3, "dribbling": 1.2,
           "pick_and_roll_creation": 1.0, "pace_control": 0.8,
           "interior_defense": 0.3, "defensive_rebounding": 0.3, "strength": 0.2,
           "rim_protection": 0.1, "post_moves": 0.1, "screen_setting": 0.1},
    "SG": {"three_point": 1.5, "pull_up_shooting": 0.9, "catch_and_shoot": 0.9,
           "off_ball_movement": 0.7, "mid_range": 0.9, "perimeter_defense": 1.1,
           "interior_defense": 0.4, "defensive_rebounding": 0.4,
           "rim_protection": 0.2, "post_moves": 0.2, "screen_setting": 0.1},
    "SF": {"offensive_versatility": 1.0, "wing_defense": 0.9, "cutting": 0.5,
           "switchability": 0.8, "three_point": 1.2, "transition_finishing": 0.5},
    "PF": {"defensive_rebounding": 1.1, "offensive_rebounding": 0.7,
           "interior_defense": 1.2, "strength": 0.7, "post_moves": 0.7,
           "screen_setting": 0.5, "roll_man": 0.5, "rim_protection": 0.9,
           "ball_handling": 0.4, "dribbling": 0.3, "pick_and_roll_handler": 0.2},
    "C": {"rim_protection": 1.3, "defensive_rebounding": 1.3, "blocks": 0.9,
          "interior_defense": 1.4, "strength": 0.9, "post_moves": 0.8,
          "post_defense": 1.0, "screen_setting": 0.6, "roll_man": 0.6,
          "boxing_out": 0.7,
          "ball_handling": 0.2, "dribbling": 0.1, "three_point": 0.5,
          "pick_and_roll_handler": 0.1, "pick_and_roll_creation": 0.1},
}


def ca_weights(position: str) -> dict[str, float]:
    weights = dict(CA_BASE_WEIGHTS)
    weights.update(CA_POSITION_WEIGHTS.get(position, {}))
    return weights


def current_ability(ratings: Ratings, position: str = "SF") -> float:
    """The CA a given attribute set is worth at a given position.

    This is the definition CA generation is solved against, so a player's
    stored CA and his attributes always describe the same thing.
    """
    weights = ca_weights(position)
    total = sum(weights.values())
    weighted = sum(getattr(ratings, key) * weight for key, weight in weights.items())
    return scale_to_ca(weighted / total)


# --------------------------------------------------------------------------
# Archetypes: how a player spends his budget.
#
# Values are emphases in rating points, applied to the shape *before* the CA
# solve. Because the solve rescales to hit the target CA, a positive emphasis
# is paid for by everything else coming down -- these redistribute ability,
# they do not add it.
# --------------------------------------------------------------------------

class Archetype(str, Enum):
    FLOOR_GENERAL = "floor_general"
    SCORING_GUARD = "scoring_guard"
    THREE_AND_D_GUARD = "three_and_d_guard"
    SLASHER = "slasher"
    THREE_AND_D_WING = "three_and_d_wing"
    SHOT_CREATOR = "shot_creator"
    POINT_FORWARD = "point_forward"
    STRETCH_BIG = "stretch_big"
    RIM_RUNNER = "rim_runner"
    DEFENSIVE_ANCHOR = "defensive_anchor"
    POST_SCORER = "post_scorer"
    PLAYMAKING_BIG = "playmaking_big"

    @property
    def label(self) -> str:
        return self.value.replace("_", " ").title().replace("And", "and")


ARCHETYPE_EMPHASIS: dict[Archetype, dict[str, float]] = {
    Archetype.FLOOR_GENERAL: {
        "passing": 3.5, "court_vision": 3.5, "assist_iq": 3.0, "decision_making": 2.5,
        "pick_and_roll_handler": 3.0, "pick_and_roll_creation": 2.5, "pace_control": 2.5,
        "ball_handling": 2.5, "dribbling": 2.0, "offensive_awareness": 2.0,
        "isolation": -1.5, "dunking": -2.5, "post_moves": -2.5, "rim_protection": -2.0,
        "offensive_rebounding": -1.5, "strength": -1.5,
    },
    Archetype.SCORING_GUARD: {
        "three_point": 3.0, "pull_up_shooting": 3.5, "mid_range": 3.0, "isolation": 3.0,
        "dribbling": 2.0, "euro_step": 2.0, "fadeaway": 2.0,
        "passing": -2.0, "court_vision": -2.0, "assist_iq": -2.0,
        "defensive_rebounding": -1.5, "help_defense": -1.5, "rim_protection": -2.0,
    },
    Archetype.THREE_AND_D_GUARD: {
        "three_point": 3.0, "catch_and_shoot": 3.5, "off_ball_shooting": 2.5,
        "perimeter_defense": 3.5, "shot_contest": 2.5, "steals": 2.0,
        "defensive_iq": 2.0, "switchability": 2.0,
        "isolation": -2.5, "creativity": -2.0, "post_moves": -2.5,
        "pick_and_roll_creation": -2.0,
    },
    Archetype.SLASHER: {
        "layups": 3.5, "close_shot": 2.5, "finishing_through_contact": 3.5,
        "euro_step": 3.0, "acceleration": 3.0, "quickness": 2.5, "dunking": 2.5,
        "transition_finishing": 2.5, "cutting": 2.0,
        "three_point": -3.0, "catch_and_shoot": -2.5, "pull_up_shooting": -2.0,
        "free_throws": -1.5, "post_hook": -2.0,
    },
    Archetype.THREE_AND_D_WING: {
        "three_point": 3.0, "catch_and_shoot": 3.5, "off_ball_shooting": 2.5,
        "wing_defense": 3.5, "perimeter_defense": 3.0, "switchability": 3.0,
        "shot_contest": 2.5, "help_defense": 2.0,
        "isolation": -2.5, "pick_and_roll_creation": -2.5, "creativity": -2.0,
        "passing": -1.5, "post_moves": -2.0,
    },
    Archetype.SHOT_CREATOR: {
        "isolation": 4.0, "pull_up_shooting": 3.0, "creativity": 3.0,
        "dribbling": 3.0, "offensive_versatility": 3.0, "fadeaway": 2.5,
        "mid_range": 2.0, "three_point": 1.5,
        "off_ball_movement": -2.5, "catch_and_shoot": -1.5, "cutting": -2.0,
        "screen_setting": -2.0, "boxing_out": -1.5,
    },
    Archetype.POINT_FORWARD: {
        "passing": 3.5, "court_vision": 3.0, "assist_iq": 2.5,
        "offensive_versatility": 3.0, "ball_handling": 2.5, "decision_making": 2.0,
        "spatial_awareness": 2.0, "defensive_rebounding": 1.5,
        "catch_and_shoot": -1.5, "off_ball_movement": -1.5, "rim_protection": -1.5,
        "dunking": -1.0, "post_hook": -2.0,
    },
    Archetype.STRETCH_BIG: {
        "three_point": 4.0, "catch_and_shoot": 3.5, "off_ball_shooting": 3.0,
        "mid_range": 2.5, "free_throws": 2.0,
        "post_moves": -2.5, "post_hook": -3.0, "post_footwork": -2.5,
        "offensive_rebounding": -2.5, "rim_protection": -1.5, "strength": -1.5,
        "roll_man": -1.5,
    },
    Archetype.RIM_RUNNER: {
        "dunking": 4.0, "roll_man": 3.5, "screen_setting": 3.0, "vertical_leap": 3.0,
        "layups": 2.5, "offensive_rebounding": 2.5, "speed": 2.0, "cutting": 2.0,
        "three_point": -4.0, "mid_range": -3.0, "catch_and_shoot": -3.0,
        "post_moves": -1.5, "passing": -2.0, "court_vision": -2.0,
    },
    Archetype.DEFENSIVE_ANCHOR: {
        "rim_protection": 4.0, "blocks": 3.5, "interior_defense": 3.5,
        "defensive_iq": 2.5, "help_defense": 3.0, "defensive_rebounding": 3.0,
        "boxing_out": 2.5, "post_defense": 3.0,
        "three_point": -3.5, "isolation": -3.0, "pull_up_shooting": -3.0,
        "creativity": -2.5, "ball_handling": -2.5, "mid_range": -2.5,
    },
    Archetype.POST_SCORER: {
        "post_moves": 4.0, "post_footwork": 3.5, "post_hook": 3.5,
        "finishing_through_contact": 2.5, "strength": 2.5, "fadeaway": 2.0,
        "close_shot": 2.0, "passing_from_post": 1.5,
        "three_point": -3.0, "speed": -2.0, "quickness": -2.0,
        "switchability": -2.5, "transition_play": -2.0, "catch_and_shoot": -2.0,
    },
    Archetype.PLAYMAKING_BIG: {
        "passing": 3.5, "passing_from_post": 3.5, "court_vision": 3.0,
        "assist_iq": 2.5, "decision_making": 2.5, "screen_setting": 2.0,
        "spatial_awareness": 2.0, "offensive_versatility": 2.0,
        "dunking": -2.0, "isolation": -2.5, "pull_up_shooting": -2.5,
        "speed": -1.5, "steals": -1.5,
    },
}

# Which archetypes make sense where. Generation picks from the list for a
# position, so a centre is never a Floor General.
POSITION_ARCHETYPES: dict[str, tuple[Archetype, ...]] = {
    "PG": (Archetype.FLOOR_GENERAL, Archetype.SCORING_GUARD,
           Archetype.THREE_AND_D_GUARD, Archetype.SLASHER),
    "SG": (Archetype.SCORING_GUARD, Archetype.THREE_AND_D_GUARD,
           Archetype.SLASHER, Archetype.SHOT_CREATOR),
    "SF": (Archetype.THREE_AND_D_WING, Archetype.SHOT_CREATOR,
           Archetype.POINT_FORWARD, Archetype.SLASHER),
    "PF": (Archetype.STRETCH_BIG, Archetype.POST_SCORER,
           Archetype.DEFENSIVE_ANCHOR, Archetype.POINT_FORWARD),
    "C": (Archetype.DEFENSIVE_ANCHOR, Archetype.RIM_RUNNER,
          Archetype.POST_SCORER, Archetype.STRETCH_BIG, Archetype.PLAYMAKING_BIG),
}


# --------------------------------------------------------------------------
# Age. The same CA is distributed differently at 20 and at 34: a young player
# carries more of his ability in his legs, a veteran in his head.
# --------------------------------------------------------------------------

PHYSICAL_ATTRIBUTES = (
    "speed", "acceleration", "agility", "vertical_leap", "quickness", "stamina",
)
EXPERIENCE_ATTRIBUTES = (
    "decision_making", "offensive_awareness", "defensive_awareness",
    "spatial_awareness", "defensive_iq", "anticipation", "shot_selection",
    "assist_iq", "post_footwork", "clutch_performance",
)
PHYSICAL_PEAK_AGE = 24.0
EXPERIENCE_PLATEAU_AGE = 31.0


def age_shift(attribute: str, age: int) -> float:
    """Rating-point shift applied to the shape before the CA solve."""
    if attribute in PHYSICAL_ATTRIBUTES:
        # Rises slightly to the peak, falls away steadily after 28.
        return -0.16 * max(0.0, age - PHYSICAL_PEAK_AGE) + 0.10 * min(0.0, age - PHYSICAL_PEAK_AGE)
    if attribute in EXPERIENCE_ATTRIBUTES:
        return 0.20 * (min(age, EXPERIENCE_PLATEAU_AGE) - 21.0)
    if attribute == "strength":
        return 0.10 * (min(age, 29) - 21.0)
    return 0.0


# --------------------------------------------------------------------------
# Generation: solve for the attributes that spend exactly this CA.
# --------------------------------------------------------------------------

def generate_ratings(
    rng: random.Random,
    ca: float,
    position: str,
    archetype: Archetype,
    age: int,
    position_profile: dict[str, float] | None = None,
    spikes: int = 4,
) -> Ratings:
    """Build an attribute set worth exactly `ca` at `position`.

    The shape comes from position, archetype, age and a little noise; the
    *level* comes from a bisection that slides the whole shape up or down until
    `current_ability()` returns the target. Clamping at 1 and 20 makes the
    relationship non-linear, which is why this is solved rather than scaled.
    """
    profile = position_profile or {}
    emphasis = ARCHETYPE_EMPHASIS[archetype]
    names = Ratings.attribute_names()

    # Idiosyncratic spikes and holes on top of the archetype, so two players of
    # the same archetype and CA are still not the same player.
    pool = [n for n in names if n in CA_BASE_WEIGHTS]
    spiked = set(rng.sample(pool, min(spikes, len(pool))))
    holed = set(rng.sample([n for n in pool if n not in spiked], min(spikes, len(pool) - len(spiked))))

    shape: dict[str, float] = {}
    for name in names:
        value = profile.get(name, 0.0) + emphasis.get(name, 0.0) + age_shift(name, age)
        if name in spiked:
            value += rng.uniform(1.5, 3.0)
        elif name in holed:
            value -= rng.uniform(1.5, 3.0)
        shape[name] = value + rng.gauss(0.0, 0.9)

    def build(offset: float) -> Ratings:
        return Ratings(**{name: clamp(shape[name] + offset) for name in names})

    # Bisection: current_ability is monotonic non-decreasing in the offset.
    low, high = -SCALE_MAX, SCALE_MAX * 2
    for _ in range(48):
        middle = (low + high) / 2.0
        if current_ability(build(middle), position) < ca:
            low = middle
        else:
            high = middle
    return build((low + high) / 2.0)


# Age at which a player is assumed to have reached his ceiling. Past it,
# headroom is only the small residue below.
CEILING_AGE = 27
MAX_HEADROOM_PER_YEAR = 6.5
MIN_HEADROOM_PER_YEAR = 1.5
RESIDUAL_HEADROOM = 5.0


def make_ability(rng: random.Random, ca: float, age: int, ceiling: float | None = None) -> Ability:
    """CA plus a plausible PA for a player of this age.

    **The gap between CA and PA is a function of age**, and deliberately so: a
    19-year-old can be a long way short of his ceiling, a 33-year-old is
    essentially at it. Headroom is `years_to_ceiling * per_year + residue`, so
    it shrinks monotonically in expectation as age rises and is never negative
    -- meaning CA <= PA holds before `Ability`'s own clamp has to intervene.

    That relationship is what makes a scout's job interesting. Two players with
    the same CA are not the same asset if one is 20 and the other is 31.
    """
    if ceiling is None:
        growth_years = max(0.0, CEILING_AGE - age)
        per_year = rng.uniform(MIN_HEADROOM_PER_YEAR, MAX_HEADROOM_PER_YEAR)
        ceiling = ca + growth_years * per_year + rng.uniform(0.0, RESIDUAL_HEADROOM)
    return Ability(current=ca, potential=ceiling)


def expected_headroom(age: int) -> float:
    """Mean CA/PA gap for a player of this age -- the curve `make_ability` draws
    from. Exposed so scouting and tests can reason about it directly."""
    growth_years = max(0.0, CEILING_AGE - age)
    mean_per_year = (MIN_HEADROOM_PER_YEAR + MAX_HEADROOM_PER_YEAR) / 2.0
    return growth_years * mean_per_year + RESIDUAL_HEADROOM / 2.0


# --------------------------------------------------------------------------
# Development
# --------------------------------------------------------------------------

def growth_multiplier(age: int) -> float:
    """How readily a player of this age adds CA. Negative past the decline age."""
    if age <= 21:
        return 1.0
    if age <= 24:
        return 0.75
    if age <= 27:
        return 0.45
    if age <= 30:
        return 0.18
    if age <= 33:
        return -0.25
    return -0.60


def develop(
    rng: random.Random,
    ability: Ability,
    age: int,
    development_rate: float,
    professionalism: float,
    work_rate: float,
    minutes_played: float = 1800.0,
    coaching: float = 1.0,
) -> float:
    """Advance one season of CA. Returns the change, positive or negative.

    Growth is driven by headroom (how far short of PA he is), age, the hidden
    attributes that decide whether a player actually improves, and his head
    coach's development rating. Past 30 the multiplier goes negative and CA
    falls back regardless of PA -- an ageing player's ceiling stops mattering,
    though a good coach still slows the decline.
    """
    from .ratings import normalize  # local import keeps the module import-light

    multiplier = growth_multiplier(age)
    application = 1.0 + 0.5 * (
        normalize(development_rate) + normalize(professionalism) + normalize(work_rate)
    ) / 3.0
    playing_time = min(1.2, 0.4 + minutes_played / 2000.0)

    if multiplier > 0:
        # The closer to PA, the harder each point is to add. `coaching` is the
        # head coach's development multiplier -- a good one gets a prospect to
        # his ceiling years sooner.
        room = ability.headroom
        change = room * 0.30 * multiplier * application * playing_time * coaching
        change *= rng.uniform(0.55, 1.45)
    else:
        # Decline is proportional to what he has, softened by professionalism.
        change = ability.current * 0.05 * multiplier * (2.0 - application) / max(0.5, coaching)
        change *= rng.uniform(0.6, 1.4)

    ability.set_current(ability.current + change)
    return change


# --------------------------------------------------------------------------
# Scouting: what a manager is allowed to believe.
# --------------------------------------------------------------------------

@dataclass
class ScoutReport:
    """A deliberately imprecise view of CA and PA.

    `accuracy` is 0.0-1.0 -- how well the club knows this player. It widens or
    narrows the reported range; it never reveals the true numbers.
    """

    current_low: float
    current_high: float
    potential_low: float
    potential_high: float
    accuracy: float
    verdict: str

    def to_dict(self) -> dict:
        return {
            "current_range": [round(self.current_low), round(self.current_high)],
            "potential_range": [round(self.potential_low), round(self.potential_high)],
            "current_tier": ca_tier((self.current_low + self.current_high) / 2),
            "potential_tier": ca_tier((self.potential_low + self.potential_high) / 2),
            "accuracy": round(self.accuracy, 2),
            "verdict": self.verdict,
        }


def scout(ability: Ability, age: int, accuracy: float = 0.6) -> ScoutReport:
    """Estimate a player's CA and PA from the outside.

    CA is easier to judge than PA -- you can watch a player play now, but his
    ceiling is a guess, and a wider one the younger he is.
    """
    accuracy = max(0.05, min(1.0, accuracy))
    ca_error = 22.0 * (1.0 - accuracy)
    youth_uncertainty = 1.0 + max(0.0, (24 - age)) * 0.12
    pa_error = 34.0 * (1.0 - accuracy) * youth_uncertainty

    headroom = ability.headroom
    if headroom >= 45 and age <= 23:
        verdict = "Elite prospect"
    elif headroom >= 28 and age <= 25:
        verdict = "Room to grow"
    elif headroom >= 12:
        verdict = "Still developing"
    elif age >= 31:
        verdict = "Past his peak"
    else:
        verdict = "Finished article"

    return ScoutReport(
        current_low=max(CA_MIN, ability.current - ca_error),
        current_high=min(CA_MAX, ability.current + ca_error),
        potential_low=max(CA_MIN, ability.potential - pa_error),
        potential_high=min(CA_MAX, ability.potential + pa_error),
        accuracy=accuracy,
        verdict=verdict,
    )
