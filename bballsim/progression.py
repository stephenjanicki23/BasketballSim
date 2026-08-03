"""How a career unfolds: one offseason at a time, for twenty-five years.

The existing `ability.develop()` moves CA and nothing else. That is enough to
make a number go up, and not enough to make a career: a 33-year-old whose CA
has fallen ten points should not be a slightly worse version of his
24-year-old self, he should be slower and smarter. This module replaces that
with attribute-level progression.

**The central decision: attributes move, and CA follows.**

`ability.current_ability()` defines CA as the position-weighted sum of the
visible attributes -- "the same fact viewed at different resolutions". So this
engine never writes CA directly. It computes a delta for each of 81
attributes, applies them, and *recomputes* CA from the result. Three things
fall out of that, all of which the alternative (move CA, then redistribute)
gets wrong:

  * The hard rule stays enforceable where it means something. If the new
    attribute set would price above PA, the positive deltas are scaled back
    until it fits -- so a player near his ceiling stops improving in a way you
    can see in his attributes, not just in a hidden number.
  * A veteran's CA holding flat is a real event rather than a null one: he
    lost a point of speed and gained a point of decision-making, and the two
    happened to price the same.
  * Position matters for free. A centre losing vertical leap and a point guard
    losing it lose different amounts of CA, because the CA weights already say
    so.

**Ages are not hardcoded.** Every age threshold in here is expressed relative
to two per-player numbers: an athletic peak and a prime age, both generated
from what the player's game is actually built on. An explosive guard whose CA
sits in his legs peaks early; a shooter with a high basketball IQ peaks late
and lasts. The league-wide averages land near the familiar shape -- rapid
improvement to the early twenties, an athletic peak around 24, decline from
the late twenties, steeper past 32 -- but no player is told those numbers.

Everything here is deterministic given a seed. Career profiles are derived
from the player's id, so the frozen roster in `data/league.json` gets stable
prime ages and aging archetypes without the roster file changing at all --
the same trick `logos.py` uses for crests.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from enum import Enum

from .ability import Ability, current_ability
from .engine.rng import seed_from_string
from .ratings import LEAGUE_AVERAGE, SCALE_MAX, SCALE_MIN, Ratings, clamp

# --------------------------------------------------------------------------
# What develops, and how.
#
# The 81 attributes are sorted into development groups: not the display groups
# in `ratings.ATTRIBUTE_GROUPS`, which are organised for a squad screen, but by
# *what makes them move*. Legs decline, judgement accrues, and shooting sits
# between the two.
# --------------------------------------------------------------------------

# Pure athleticism. Peaks earliest, declines first and hardest, and is what an
# ACL takes away.
ATHLETIC: tuple[str, ...] = (
    "speed", "acceleration", "agility", "vertical_leap", "quickness",
    "stamina", "balance",
)

# Strength is athletic but runs on a different clock: it is built in a weight
# room through the twenties and holds far longer than explosiveness.
STRENGTH: tuple[str, ...] = ("strength", "durability")

# Skills that lean on the legs to execute. They decline, but later and more
# gently than the athleticism underneath them.
ATHLETIC_SKILLS: tuple[str, ...] = (
    "dunking", "finishing_through_contact", "euro_step", "transition_finishing",
    "transition_play", "cutting", "roll_man", "blocks", "steals",
    "offensive_rebounding", "perimeter_defense", "switchability",
    "pick_and_roll_defense", "wing_defense", "isolation",
)

# Learned technique. Grows with repetition, then holds almost indefinitely --
# a jump shot does not get old the way a first step does.
TECHNICAL: tuple[str, ...] = (
    "close_shot", "layups", "mid_range", "three_point", "free_throws",
    "off_ball_shooting", "catch_and_shoot", "pull_up_shooting", "fadeaway",
    "floater", "post_moves", "post_footwork", "post_hook", "screen_setting",
    "passing", "ball_handling", "dribbling", "pick_and_roll_handler",
    "pick_and_roll_creation", "boxing_out", "rebound_timing",
    "passing_from_post", "off_ball_movement",
)

# Judgement. This is the group that keeps rising while the legs go, and it is
# what makes a veteran worth playing.
EXPERIENTIAL: tuple[str, ...] = (
    "decision_making", "shot_selection", "court_vision", "assist_iq",
    "creativity", "offensive_awareness", "defensive_awareness",
    "spatial_awareness", "anticipation", "defensive_iq", "help_defense",
    "interior_defense", "post_defense", "rim_protection", "shot_contest",
    "rebound_positioning", "defensive_rebounding", "pace_control",
    "offensive_versatility", "clutch_performance",
)

# Character. Moves slowly, mostly upward, and is never the reason a career
# ends -- but it decides how much of the rest a player actually gets.
CHARACTER: tuple[str, ...] = (
    "leadership", "composure", "focus", "discipline", "mental_toughness",
    "pressure_handling", "emotional_control", "winning_mentality", "teamwork",
    "work_rate", "coachability", "confidence", "competitive_drive",
    "aggression",
)

DEVELOPMENT_GROUPS: dict[str, tuple[str, ...]] = {
    "athletic": ATHLETIC,
    "strength": STRENGTH,
    "athletic_skill": ATHLETIC_SKILLS,
    "technical": TECHNICAL,
    "experiential": EXPERIENTIAL,
    "character": CHARACTER,
}

# The attributes an explosive player's ability is *made of*. Used to work out
# how much of his game he is standing to lose, which is what sets his prime.
LEG_DEPENDENT = ATHLETIC + ATHLETIC_SKILLS


def group_of(attribute: str) -> str | None:
    for name, members in DEVELOPMENT_GROUPS.items():
        if attribute in members:
            return name
    return None


# --------------------------------------------------------------------------
# Career archetypes: eight ways to age.
#
# These are a separate axis from `ability.Archetype`, which describes how a
# player *plays* (Floor General, Rim Runner). This is how he *lasts*. A Rim
# Runner can be an Ironman or an Injury-Prone Star; the two say different
# things.
#
# Every field is a multiplier on the corresponding term in the yearly step, so
# an archetype is a shape rather than a special case in the code.
# --------------------------------------------------------------------------

class CareerArc(str, Enum):
    EXPLOSIVE_ATHLETE = "explosive_athlete"
    SKILL_VETERAN = "skill_veteran"
    IRONMAN = "ironman"
    LATE_BLOOMER = "late_bloomer"
    INJURY_PRONE_STAR = "injury_prone_star"
    HIGH_IQ_VETERAN = "high_iq_veteran"
    RAW_PROSPECT = "raw_prospect"
    WORKHORSE = "workhorse"

    @property
    def label(self) -> str:
        return self.value.replace("_", " ").title()


@dataclass(frozen=True)
class ArcProfile:
    """How one career archetype bends the curves.

    `prime_shift` moves the prime age in years; everything else multiplies.
    """

    prime_shift: float = 0.0
    growth: float = 1.0            # how fast he improves before his peak
    athletic_decay: float = 1.0    # how fast the legs go afterwards
    skill_growth: float = 1.0      # technique accrual
    experience_growth: float = 1.0  # judgement accrual
    injury_risk: float = 1.0
    injury_severity: float = 1.0
    longevity: float = 1.0         # resistance to the late accelerated decline
    breakout_chance: float = 1.0


ARCS: dict[CareerArc, ArcProfile] = {
    # Lives above the rim. Arrives good, peaks early, falls off a cliff --
    # because the thing his game is built on is the thing age takes first.
    CareerArc.EXPLOSIVE_ATHLETE: ArcProfile(
        prime_shift=-1.8, growth=1.15, athletic_decay=1.35, skill_growth=0.85,
        experience_growth=0.9, longevity=0.8,
    ),
    # Never had the legs to lose. Ages like a jump shot.
    CareerArc.SKILL_VETERAN: ArcProfile(
        prime_shift=+1.6, growth=0.9, athletic_decay=0.75, skill_growth=1.25,
        experience_growth=1.1, longevity=1.3,
    ),
    # Plays every night. The wear is real but the availability compounds.
    CareerArc.IRONMAN: ArcProfile(
        prime_shift=+0.8, growth=1.0, athletic_decay=0.85, skill_growth=1.05,
        experience_growth=1.15, injury_risk=0.45, injury_severity=0.7,
        longevity=1.25,
    ),
    # Slow start, and the ceiling is real for longer than anyone expects.
    CareerArc.LATE_BLOOMER: ArcProfile(
        prime_shift=+2.4, growth=0.7, athletic_decay=0.9, skill_growth=1.3,
        experience_growth=1.25, longevity=1.15, breakout_chance=2.2,
    ),
    # The talent is not in question. The availability is.
    CareerArc.INJURY_PRONE_STAR: ArcProfile(
        prime_shift=-1.2, growth=1.1, athletic_decay=1.2, skill_growth=1.0,
        experience_growth=0.95, injury_risk=2.3, injury_severity=1.4,
        longevity=0.75,
    ),
    # Was never fast. Reads the game two passes ahead and plays until forty.
    CareerArc.HIGH_IQ_VETERAN: ArcProfile(
        prime_shift=+2.0, growth=0.85, athletic_decay=0.8, skill_growth=1.1,
        experience_growth=1.45, injury_risk=0.8, longevity=1.4,
    ),
    # All tools, no idea. Everything depends on whether the light comes on.
    CareerArc.RAW_PROSPECT: ArcProfile(
        prime_shift=+1.0, growth=1.3, athletic_decay=1.0, skill_growth=0.8,
        experience_growth=0.75, longevity=0.95, breakout_chance=2.6,
    ),
    # No single elite trait; turns up, improves, and is still useful at 34.
    CareerArc.WORKHORSE: ArcProfile(
        prime_shift=+0.6, growth=0.95, athletic_decay=0.9, skill_growth=1.15,
        experience_growth=1.2, injury_risk=0.75, longevity=1.2,
    ),
}


# --------------------------------------------------------------------------
# Constants. Everything the curves are made of, in one place.
# --------------------------------------------------------------------------

PRIME_BASE = 28.6            # league mean prime age before any adjustment
PRIME_MIN, PRIME_MAX = 25.0, 33.5
ATHLETIC_PEAK_LEAD = 4.4     # how many years before his prime the legs top out

# The curves, one row per development group.
#
# Sized against what CA actually costs. Raising every attribute in a group by
# one rating point moves CA by, at a typical position:
#
#     athletic  0.90    athletic_skill  2.15    technical    3.70
#     strength  0.20    experiential    3.60    character    0.00
#
# Two things follow, and both of them shaped this table. Athleticism is only
# ninety-hundredths of a CA point a year even when it is collapsing, so a
# decline modelled in the legs alone cannot move a career -- an ageing player
# has to lose his touch and his read as well, later and more slowly, or he
# retires at 40 with the CA he had at 28. And character is free: leadership
# and composure cost no ceiling, which is why a veteran can keep gaining them
# while everything priced into CA is falling.
#
# `grow`      rating points a year at full tilt, before every modifier
# `grow_ends` when growth stops, in years either side of the prime age
# `falls`     when decline starts, same units
# `fall`      rating points a year at the moment decline starts
# `accel`     how much faster it gets per additional year
GROWTH: dict[str, float] = {
    "athletic": 0.60, "strength": 0.42, "athletic_skill": 0.92,
    "technical": 1.15, "experiential": 1.20, "character": 0.26,
}
GROWTH_ENDS: dict[str, float] = {
    # Athleticism is the exception: it stops at the athletic peak, which is
    # its own number, so this is unused for it.
    "athletic": 0.0, "strength": 0.0, "athletic_skill": -1.0,
    "technical": 3.0, "experiential": 5.0, "character": 99.0,
}
DECLINE_STARTS: dict[str, float] = {
    "athletic": 0.0, "strength": 2.0, "athletic_skill": -1.0,
    "technical": 3.0, "experiential": 5.0, "character": 99.0,
}
DECLINE: dict[str, float] = {
    "athletic": 0.30, "strength": 0.10, "athletic_skill": 0.40,
    "technical": 0.32, "experiential": 0.45, "character": 0.0,
}
DECLINE_ACCEL: dict[str, float] = {
    "athletic": 0.18, "strength": 0.06, "athletic_skill": 0.14,
    "technical": 0.20, "experiential": 0.25, "character": 0.0,
}

EXPERIENCE_TAU = 5.5         # seasons; judgement accrues fast then plateaus
EXPERIENCE_PLATEAU = 0.22    # floor, so a veteran keeps learning a little

# Personality sets how much of PA a player actually reaches. The spec case:
# PA 185 with professionalism 19 finishes north of 180; the same PA with
# professionalism 6 stalls around 155.
REALISATION_FLOOR = 0.60
REALISATION_RANGE = 0.38

# Minutes. Young players need real minutes to develop and can be broken by too
# many; veterans are worn down by them.
IDEAL_MINUTES_YOUNG = 2100.0
MINUTES_OVERLOAD = 2900.0
WEAR_PER_1000_MINUTES = 0.055

# How much CA short of his effective ceiling a player has to be to improve at
# full speed. Inside this the curve tapers, so a career approaches its ceiling
# asymptotically instead of climbing at full tilt and stopping dead against a
# wall -- which is what a hard clamp produces, and it looks exactly as wrong on
# a career graph as it sounds.
CEILING_TAPER = 18.0

RETIREMENT_AGE_FLOOR = 32    # below this, only a collapsed CA ends a career
RETIREMENT_CA = 78.0
HARD_RETIREMENT_AGE = 41


# --------------------------------------------------------------------------
# The career profile: what is true about a player for his whole career.
# --------------------------------------------------------------------------

@dataclass
class CareerProfile:
    """Hidden, permanent, and generated once.

    Derived from the player's id, so the shipped roster acquires prime ages
    and career arcs without `data/league.json` changing.
    """

    prime_age: float
    athletic_peak: float
    arc: CareerArc
    realisation: float           # share of the PA gap his character will close
    baseline_ca: float = 0.0     # CA when the profile was built
    injury_load: float = 0.0     # accumulated permanent damage, 0.0 upward
    seasons_played: int = 0
    peak_ca: float = 0.0
    retired: bool = False

    @property
    def profile(self) -> ArcProfile:
        return ARCS[self.arc]

    def to_dict(self) -> dict:
        return {
            "primeAge": round(self.prime_age, 1),
            "athleticPeak": round(self.athletic_peak, 1),
            "arc": self.arc.value,
            "arcLabel": self.arc.label,
            "realisation": round(self.realisation, 3),
            "injuryLoad": round(self.injury_load, 2),
            "seasonsPlayed": self.seasons_played,
            "peakCa": round(self.peak_ca, 1),
            "retired": self.retired,
        }


def leg_reliance(ratings: Ratings) -> float:
    """How much of this player's game is standing on his legs, roughly -1..+1.

    The difference between his athletic attributes and his learned ones, in
    units of the rating scale. A dunker who cannot shoot scores high; a
    slow-footed shooter scores low. This is what decides when he peaks, and it
    is read off the attributes rather than assigned, so it stays true if the
    roster changes.
    """
    legs = sum(getattr(ratings, key) for key in LEG_DEPENDENT) / len(LEG_DEPENDENT)
    learned = sum(
        getattr(ratings, key) for key in (TECHNICAL + EXPERIENTIAL)
    ) / len(TECHNICAL + EXPERIENTIAL)
    return (legs - learned) / LEAGUE_AVERAGE


def pick_arc(rng: random.Random, ratings: Ratings, hidden, age: int) -> CareerArc:
    """Choose a career arc from what the player already is.

    Weighted rather than assigned: a fragile, explosive player is *likely* to
    be an Injury-Prone Star and might be an Ironman, which is the difference
    between a simulation and a lookup table.
    """
    reliance = leg_reliance(ratings)
    fragility = (LEAGUE_AVERAGE - hidden.injury_proneness) / LEAGUE_AVERAGE
    durability = (ratings.durability - LEAGUE_AVERAGE) / LEAGUE_AVERAGE
    iq = sum(getattr(ratings, k) for k in EXPERIENTIAL) / len(EXPERIENTIAL)
    smart = (iq - LEAGUE_AVERAGE) / LEAGUE_AVERAGE
    work = (hidden.development_rate - LEAGUE_AVERAGE) / LEAGUE_AVERAGE

    weights = {
        CareerArc.EXPLOSIVE_ATHLETE: 1.0 + 3.2 * max(0.0, reliance),
        CareerArc.SKILL_VETERAN: 1.0 + 3.0 * max(0.0, -reliance),
        CareerArc.IRONMAN: 1.0 + 2.6 * max(0.0, durability) + 1.4 * max(0.0, -fragility),
        CareerArc.LATE_BLOOMER: 1.0 + 2.0 * max(0.0, work) + (0.8 if age <= 21 else 0.0),
        CareerArc.INJURY_PRONE_STAR: 0.7 + 3.4 * max(0.0, fragility),
        CareerArc.HIGH_IQ_VETERAN: 0.8 + 3.4 * max(0.0, smart),
        CareerArc.RAW_PROSPECT: (1.6 if age <= 21 else 0.15) + 1.8 * max(0.0, reliance),
        CareerArc.WORKHORSE: 1.4,
    }
    arcs = list(weights)  # an ordered list, never a set: see engine/rng.py
    return rng.choices(arcs, weights=[weights[a] for a in arcs], k=1)[0]


def generate_prime_age(rng: random.Random, ratings: Ratings, position: str,
                       arc: CareerArc) -> float:
    """A prime age that follows from the player's game, not from a dice roll.

    Explosive guards peak early because explosiveness goes first. Shooters and
    high-IQ players peak late because nothing they rely on is in a hurry.
    Bigs sit slightly early: more of a centre's CA is strength and rim
    protection, both of which are physical.
    """
    reliance = leg_reliance(ratings)
    position_shift = {"PG": -0.5, "SG": +0.2, "SF": +0.2, "PF": -0.1, "C": -0.4}
    prime = (
        PRIME_BASE
        - 3.4 * reliance
        + position_shift.get(position, 0.0)
        + ARCS[arc].prime_shift
        + rng.gauss(0.0, 0.85)
    )
    return max(PRIME_MIN, min(PRIME_MAX, prime))


def effective_ceiling(ability: Ability, profile: CareerProfile) -> float:
    """The CA this player will actually top out at.

    PA is what the talent is worth. This is what his character will let him
    collect of it -- the spec case being two players with PA 185 who finish
    twenty-five points apart because one of them works.

    Character closes a *share of the gap* rather than scaling PA outright.
    Scaling PA is the obvious formulation and it is wrong, because it reaches
    backwards: an established 28-year-old at CA 158 with PA 161 and ordinary
    professionalism gets handed a ceiling of 146, below ability he already
    demonstrably has. His growth taper then pins at zero and he stops
    responding to coaching or minutes at all -- which is how this surfaced, as
    a poor coach producing marginally *better* players than an elite one,
    because neither was producing any development to compare.

    Closing the gap has neither problem. A prospect at CA 95 with PA 185
    finishes near 181 if he works and around 158 if he does not; a veteran who
    has already banked his ability keeps it whatever his character says.
    """
    gap = max(0.0, ability.potential - profile.baseline_ca)
    return max(ability.current, profile.baseline_ca + profile.realisation * gap)


def realisation_factor(hidden, ratings: Ratings) -> float:
    """The share of PA this player's character will let him reach.

    Two players with PA 185 do not finish in the same place. The one with
    professionalism 19 gets to the high 170s or 180s; the one with
    professionalism 6 stalls in the mid 150s, and no amount of coaching or
    minutes changes that -- it is a ceiling on the ceiling.
    """
    traits = (
        hidden.professionalism, hidden.development_rate, hidden.ambition,
        ratings.work_rate, ratings.coachability, ratings.competitive_drive,
    )
    mean = sum(traits) / len(traits)
    share = (mean - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)
    return REALISATION_FLOOR + REALISATION_RANGE * share


def build_profile(player, seed: str | None = None) -> CareerProfile:
    """Everything permanent about how this player will age."""
    rng = random.Random(seed_from_string(seed or f"career-{player.id}"))
    arc = pick_arc(rng, player.ratings, player.hidden, player.age)
    prime = generate_prime_age(rng, player.ratings, player.position.value, arc)
    peak = prime - ATHLETIC_PEAK_LEAD + rng.gauss(0.0, 0.6)
    return CareerProfile(
        prime_age=prime,
        athletic_peak=max(20.0, min(prime - 1.0, peak)),
        arc=arc,
        realisation=realisation_factor(player.hidden, player.ratings),
        baseline_ca=player.ability.current,
        peak_ca=player.ability.current,
    )


# --------------------------------------------------------------------------
# The curves.
# --------------------------------------------------------------------------

def group_curve(group: str, age: float, profile: CareerProfile) -> float:
    """Rating points one development group gains (+) or loses (-) this season.

    Every threshold is expressed in years either side of *this player's* prime
    age -- the only hardcoded age in the module is the 18 that anchors the
    growth ramp. Two players born the same year with different primes are on
    different curves at the same age, which is the whole point.

    Decline accelerates with distance past its own start, which is the
    mechanism behind "the older they become beyond prime, the faster decline
    becomes". It is applied per group, so the legs are already going while the
    read of the game is still improving.
    """
    arc = profile.profile
    d = age - profile.prime_age

    # Athleticism turns over at the athletic peak rather than at the prime:
    # the legs go first, and the prime is where the *balance* tips.
    growth_end = (profile.athletic_peak - profile.prime_age
                  if group == "athletic" else GROWTH_ENDS[group])
    fall_start = (profile.athletic_peak - profile.prime_age
                  if group == "athletic" else DECLINE_STARTS[group])

    if d < growth_end:
        # Fastest at the start of a career, tapering as the ceiling nears.
        span = max(1.0, growth_end - (18.0 - profile.prime_age))
        approach = min(1.0, max(0.0, (growth_end - d) / span))
        rate = GROWTH[group] * (0.40 + 0.60 * approach)
        if group in ("athletic", "strength", "athletic_skill"):
            rate *= arc.growth
        elif group == "technical":
            rate *= arc.skill_growth
        elif group == "experiential":
            rate *= arc.experience_growth
        return rate

    if d < fall_start or DECLINE[group] == 0.0:
        return 0.0

    beyond = d - fall_start
    rate = DECLINE[group] * (1.0 + DECLINE_ACCEL[group] * beyond)
    # Longevity resists the acceleration rather than the decline itself: a
    # skill veteran does not stop ageing, he ages at a flatter slope.
    rate *= 2.0 - arc.longevity
    if group in ("athletic", "athletic_skill"):
        # Damage already taken makes every subsequent year worse.
        rate *= arc.athletic_decay * (1.0 + 0.35 * profile.injury_load)
    return -rate


def experience_bonus(profile: CareerProfile) -> float:
    """Extra judgement in the first seasons, on top of the age curve.

    Experience is not age. A rookie learns more in his second season than a
    veteran does in his twelfth, whatever their birthdays say, and this is the
    term that says so.
    """
    decay = math.exp(-profile.seasons_played / EXPERIENCE_TAU)
    return (GROWTH["experiential"] * 0.45
            * (EXPERIENCE_PLATEAU + (1.0 - EXPERIENCE_PLATEAU) * decay)
            * profile.profile.experience_growth)


def minutes_factor(age: float, minutes: float, profile: CareerProfile) -> float:
    """What playing time does to development.

    Young players need minutes and can be given too many: the curve is an
    inverted U, peaking at a real starter's load. Veterans do not develop from
    minutes at all, they are worn down by them, which is handled separately in
    `wear`.
    """
    if age >= profile.prime_age:
        return 1.0
    if minutes <= IDEAL_MINUTES_YOUNG:
        # Bench-warming is the single biggest brake on a prospect.
        return 0.45 + 0.55 * (minutes / IDEAL_MINUTES_YOUNG)
    overload = (minutes - IDEAL_MINUTES_YOUNG) / max(1.0, MINUTES_OVERLOAD - IDEAL_MINUTES_YOUNG)
    return 1.0 - 0.18 * min(1.5, overload)


def wear(age: float, minutes: float, profile: CareerProfile) -> float:
    """Extra athletic decline bought with heavy minutes past the prime."""
    if age < profile.prime_age:
        return 0.0
    return WEAR_PER_1000_MINUTES * (minutes / 1000.0) * (2.0 - profile.profile.longevity)


def coaching_growth(development_rating: float) -> float:
    """A head coach's development rating as a growth multiplier.

    `coach.development` is 0-100. An elite developer is worth about a fifth
    more growth a season, which compounds into years of a prospect's timeline;
    a poor one costs about as much.
    """
    return 0.80 + 0.40 * (development_rating / 100.0)


def coaching_decline(development_rating: float) -> float:
    """...and how much of the decline he holds off. Below 1.0 is a saving."""
    return 1.18 - 0.32 * (development_rating / 100.0)


# --------------------------------------------------------------------------
# Injuries.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class InjuryKind:
    name: str
    weight: float
    games_out: tuple[int, int]
    permanent: dict[str, float]   # attribute -> rating points lost for good
    load: float                   # added to injury_load, worsening future years
    pa_cost: float = 0.0          # ceiling taken away permanently


INJURIES: tuple[InjuryKind, ...] = (
    InjuryKind("Ankle sprain", 30.0, (3, 12), {}, 0.02),
    InjuryKind("Hamstring strain", 18.0, (5, 18), {"speed": 0.15, "acceleration": 0.15}, 0.06),
    InjuryKind("Knee soreness", 14.0, (4, 15), {}, 0.05),
    InjuryKind("Broken hand", 9.0, (12, 30), {}, 0.03),
    InjuryKind("Back injury", 8.0, (10, 35), {"agility": 0.3, "stamina": 0.3}, 0.14, 1.5),
    InjuryKind("Stress fracture", 6.0, (20, 45), {"speed": 0.4, "vertical_leap": 0.4}, 0.18, 2.5),
    InjuryKind("Shoulder tear", 5.0, (25, 55), {"strength": 0.5}, 0.12, 2.0),
    # The two that end careers, or change them permanently.
    InjuryKind(
        "Torn ACL", 3.2, (55, 82),
        {"speed": 1.5, "acceleration": 1.8, "vertical_leap": 1.6, "agility": 1.2,
         "quickness": 1.3},
        0.55, 9.0,
    ),
    InjuryKind(
        "Ruptured Achilles", 1.8, (60, 90),
        {"speed": 1.9, "acceleration": 2.1, "vertical_leap": 2.2, "quickness": 1.6,
         "balance": 0.8},
        0.70, 12.0,
    ),
)


def injury_chance(age: float, minutes: float, hidden, ratings: Ratings,
                  profile: CareerProfile) -> float:
    """Probability of a significant injury this season.

    Rises with minutes, with age past the prime, with a low durability rating,
    and -- the part that makes injury histories feel like histories -- with
    everything the player has already been through.
    """
    base = 0.16
    proneness = (LEAGUE_AVERAGE - hidden.injury_proneness) / LEAGUE_AVERAGE
    tough = (ratings.durability - LEAGUE_AVERAGE) / LEAGUE_AVERAGE
    load = minutes / 2400.0
    old = max(0.0, age - profile.prime_age) * 0.018
    risk = base * (1.0 + 0.9 * proneness - 0.5 * tough) * (0.55 + 0.65 * load) + old
    risk *= profile.profile.injury_risk
    risk *= 1.0 + 0.6 * profile.injury_load
    return max(0.01, min(0.85, risk))


def draw_injury(rng: random.Random, profile: CareerProfile) -> InjuryKind:
    kinds = list(INJURIES)
    weights = [k.weight for k in kinds]
    # A fragile player does not just get hurt more often, he gets hurt worse.
    severity = profile.profile.injury_severity
    if severity != 1.0:
        weights = [w * (severity if k.games_out[1] >= 40 else 1.0)
                   for k, w in zip(kinds, weights)]
    return rng.choices(kinds, weights=weights, k=1)[0]


# --------------------------------------------------------------------------
# Career events: the reason no two careers are the same.
# --------------------------------------------------------------------------

@dataclass
class SeasonReport:
    """What happened to a player over one offseason."""

    age: int
    ca_before: float
    ca_after: float
    potential: float
    minutes: float
    injury: str | None = None
    games_missed: int = 0
    events: list[str] = field(default_factory=list)
    changes: dict[str, float] = field(default_factory=dict)
    retired: bool = False

    @property
    def ca_change(self) -> float:
        return self.ca_after - self.ca_before

    def to_dict(self) -> dict:
        return {
            "age": self.age,
            "ca": round(self.ca_after, 1),
            "caChange": round(self.ca_change, 1),
            "potential": round(self.potential, 1),
            "minutes": round(self.minutes),
            "injury": self.injury,
            "gamesMissed": self.games_missed,
            "events": list(self.events),
            "retired": self.retired,
        }


def _apply(ratings: Ratings, deltas: dict[str, float]) -> None:
    for key, delta in deltas.items():
        setattr(ratings, key, clamp(getattr(ratings, key) + delta))


def develop_season(
    player,
    profile: CareerProfile,
    *,
    minutes: float = 1800.0,
    coach_development: float = 50.0,
    seed: str | None = None,
) -> SeasonReport:
    """Advance one player by one offseason.

    The order matters. Deltas are computed per attribute, then injuries and
    career events adjust them, then everything is applied at once and CA is
    recomputed from the result -- so CA is always exactly what the attributes
    say it is, and the ceiling is enforced against the attribute set rather
    than against a number kept alongside it.
    """
    rng = random.Random(seed_from_string(
        seed or f"season-{player.id}-{profile.seasons_played}-{player.age}"))
    age = float(player.age)
    ratings = player.ratings
    hidden = player.hidden
    ability = player.ability
    report = SeasonReport(
        age=player.age, ca_before=ability.current, ca_after=ability.current,
        potential=ability.potential, minutes=minutes,
    )

    # -- 1. the curves, one group at a time -------------------------------
    coach_g = coaching_growth(coach_development)
    coach_d = coaching_decline(coach_development)
    mins = minutes_factor(age, minutes, profile)
    application = profile.realisation  # character gates growth, not decline
    tear = wear(age, minutes, profile)

    deltas: dict[str, float] = {}

    def add(keys, value: float, spread: float = 0.45) -> None:
        for key in keys:
            deltas[key] = deltas.get(key, 0.0) + value * rng.uniform(1 - spread, 1 + spread)

    # How much of his effective ceiling is left. Character sets the ceiling;
    # this decides how fast he closes on it.
    ceiling = effective_ceiling(ability, profile)
    taper = max(0.0, min(1.0, (ceiling - ability.current) / CEILING_TAPER))

    for group, members in DEVELOPMENT_GROUPS.items():
        rate = group_curve(group, age, profile)
        if group == "experiential" and rate >= 0:
            rate += experience_bonus(profile)
        if rate > 0:
            # Growth is gated by coaching, minutes and character, and slows as
            # the ceiling nears. Character is exempt: it costs no CA, so a
            # player who has run out of ability headroom still matures.
            gate = coach_g * mins * application
            add(members, rate * gate * (1.0 if group == "character" else taper))
        elif rate < 0:
            # Decline is softened by a good coach and worsened by heavy legs,
            # and -- the part that matters over a twenty-five year career --
            # it is proportional to what the player still has. A flat subtraction
            # walks a 40-year-old's speed down to 1 out of 20, which is not a
            # slow veteran, it is a man who cannot run. Losing a share of what
            # is left instead means the curve flattens as it falls, and an
            # elite athlete loses more in absolute terms than an average one
            # because he has more to lose.
            penalty = tear if group in ("athletic", "athletic_skill") else 0.0
            for key in members:
                level = getattr(ratings, key)
                share = max(0.30, min(1.60, level / LEAGUE_AVERAGE))
                deltas[key] = deltas.get(key, 0.0) + (
                    (rate - penalty) * coach_d * share * rng.uniform(0.55, 1.45))
    # Character creeps upward with time served whatever else is happening --
    # it costs no CA, so nothing competes with it.
    add(CHARACTER, GROWTH["character"]
        * (0.4 + 0.6 * min(1.0, profile.seasons_played / 8.0)) * coach_g, spread=0.7)

    # -- 2. injuries -------------------------------------------------------
    games_missed = 0
    if rng.random() < injury_chance(age, minutes, hidden, ratings, profile):
        kind = draw_injury(rng, profile)
        games_missed = rng.randint(*kind.games_out)
        report.injury = kind.name
        report.games_missed = games_missed
        for key, loss in kind.permanent.items():
            deltas[key] = deltas.get(key, 0.0) - loss
        profile.injury_load += kind.load
        if kind.pa_cost:
            # A ceiling can be taken away. It never comes back.
            ability.potential = max(0.0, ability.potential - kind.pa_cost)
            report.events.append(f"ceiling cut by {kind.pa_cost:.0f} after {kind.name.lower()}")
        # Time off is development time lost.
        lost = min(0.85, games_missed / 82.0)
        for key in deltas:
            if deltas[key] > 0:
                deltas[key] *= 1.0 - lost

    # -- 3. career events --------------------------------------------------
    _career_events(rng, player, profile, deltas, report, age, minutes)

    # -- 4. apply, then price the result ----------------------------------
    _apply(ratings, deltas)
    priced = current_ability(ratings, player.position.value)

    # The hard rule, enforced where it is visible. A player who has run out of
    # ceiling stops improving in his attributes, not just in a hidden number.
    if priced > ceiling and priced > report.ca_before:
        positives = {k: v for k, v in deltas.items() if v > 0}
        if positives:
            span = priced - report.ca_before
            allowed = max(0.0, ceiling - report.ca_before)
            scale = allowed / span if span > 0 else 0.0
            _apply(ratings, {k: -v * (1.0 - scale) for k, v in positives.items()})
            priced = current_ability(ratings, player.position.value)

    ability.potential = max(ability.potential, 0.0)
    ability.set_current(min(priced, ability.potential))
    report.ca_after = ability.current
    report.potential = ability.potential
    report.changes = {k: round(v, 3) for k, v in deltas.items() if abs(v) >= 0.01}

    profile.seasons_played += 1
    profile.peak_ca = max(profile.peak_ca, ability.current)
    player.age += 1

    # -- 5. retirement -----------------------------------------------------
    if _should_retire(rng, player, profile):
        profile.retired = True
        report.retired = True
    return report


def _career_events(rng, player, profile: CareerProfile, deltas: dict[str, float],
                   report: SeasonReport, age: float, minutes: float) -> None:
    """The unexpected. Small probabilities, large consequences.

    Without these, a career is a curve with noise on it and every player of a
    given profile has the same one. These are what produce the outlier seasons
    a manager actually remembers.
    """
    arc = profile.profile
    young = age < profile.prime_age - 2

    # Breakout: a prospect puts it together a year early.
    if young and rng.random() < 0.055 * arc.breakout_chance * profile.realisation:
        report.events.append("breakout season")
        for key in deltas:
            if deltas[key] > 0:
                deltas[key] *= 1.9

    # Coaching breakthrough: the weakest group jumps.
    if rng.random() < 0.04 and profile.realisation > 0.88:
        weakest = min(
            DEVELOPMENT_GROUPS,
            key=lambda g: sum(getattr(player.ratings, k) for k in DEVELOPMENT_GROUPS[g])
            / len(DEVELOPMENT_GROUPS[g]),
        )
        report.events.append(f"breakthrough in {weakest.replace('_', ' ')}")
        for key in DEVELOPMENT_GROUPS[weakest]:
            deltas[key] = deltas.get(key, 0.0) + rng.uniform(0.4, 1.1)

    # Lost confidence: a bad year that is not an injury.
    if rng.random() < 0.035 + 0.05 * max(0.0, (LEAGUE_AVERAGE - player.ratings.confidence)
                                         / LEAGUE_AVERAGE):
        report.events.append("confidence knocked")
        deltas["confidence"] = deltas.get("confidence", 0.0) - rng.uniform(0.5, 1.5)
        for key in deltas:
            if deltas[key] > 0:
                deltas[key] *= 0.35

    # Early decline: the legs go before anyone expected.
    if age > profile.athletic_peak and rng.random() < 0.03 * (2.0 - arc.longevity):
        report.events.append("early athletic decline")
        for key in ATHLETIC:
            deltas[key] = deltas.get(key, 0.0) - rng.uniform(0.3, 0.9)
        profile.injury_load += 0.1

    # Late bloom: a ceiling that was written off turns out to be real.
    if (age > profile.prime_age - 4 and player.ability.headroom > 12
            and rng.random() < 0.03 * arc.breakout_chance):
        report.events.append("late bloom")
        for key in deltas:
            if deltas[key] > 0:
                deltas[key] *= 1.6


def _should_retire(rng, player, profile: CareerProfile) -> bool:
    if player.age >= HARD_RETIREMENT_AGE:
        return True
    if player.age < RETIREMENT_AGE_FLOOR:
        # Only a collapse ends a career early.
        return player.ability.current < 45.0 and player.age > 27
    # Past the floor, the decision is ability against age.
    threshold = RETIREMENT_CA + 4.5 * (player.age - RETIREMENT_AGE_FLOOR)
    if player.ability.current < threshold:
        return True
    # Even a useful veteran walks away eventually -- but a player still well
    # clear of the line does not retire at 35 on a coin flip. The chance falls
    # off with how much ability he has left above the threshold.
    margin = (player.ability.current - threshold) / 60.0
    return rng.random() < 0.10 * max(0, player.age - 34) * max(0.10, 1.0 - margin)


# --------------------------------------------------------------------------
# A whole career, for testing and for the design document.
# --------------------------------------------------------------------------

def simulate_career(
    player,
    *,
    minutes_plan=None,
    coach_development: float = 50.0,
    seed: str | None = None,
    max_age: int = HARD_RETIREMENT_AGE,
) -> tuple[CareerProfile, list[SeasonReport]]:
    """Run a player from his current age to retirement.

    `minutes_plan(age, player, profile) -> float` decides playing time; the
    default is a plausible club: a prospect earns minutes as he improves, a
    star plays heavy ones, and a declining veteran loses them.
    """
    profile = build_profile(player, seed=seed)
    plan = minutes_plan or default_minutes
    history: list[SeasonReport] = []
    while not profile.retired and player.age <= max_age:
        minutes = plan(player.age, player, profile)
        history.append(develop_season(
            player, profile, minutes=minutes,
            coach_development=coach_development,
            seed=f"{seed}-{player.age}" if seed else None,
        ))
    return profile, history


def default_minutes(age: int, player, profile: CareerProfile) -> float:
    """Playing time as a club would actually hand it out: on ability, with
    rookies held back and veterans eased down."""
    ca = player.ability.current
    base = max(0.0, min(2900.0, (ca - 55.0) * 32.0))
    if age <= 20:
        base *= 0.55
    elif age <= 22:
        base *= 0.8
    if age > profile.prime_age + 3:
        base *= max(0.45, 1.0 - 0.08 * (age - profile.prime_age - 3))
    return max(0.0, base)
