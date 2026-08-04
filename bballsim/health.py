"""Fatigue, wear and tear, and injuries.

The brief this implements asks for one thing above all: **fatigue should matter
more than injuries**. A manager should lose games because he rode his starters
into February, not because a dice roll took someone out for the year. So the
numbers here are set to make tiredness constant, visible and expensive, and
serious injury rare.

Three timescales, and keeping them apart is what stops the model
double-counting itself:

  * **Within a game** -- `Player.condition`, which already existed. 100 at the
    jump ball, drained by seconds on the floor in `possession._accrue_minutes`,
    recovered on the bench. It drives substitutions and how often a man is
    asked to make a play.
  * **Across a season** -- `Health.fatigue`, new and persisted. It rises with
    every game played and falls on every rest day, and it is what a manager
    actually manages.
  * **Across a career** -- `Health.wear`, which barely moves and never really
    comes back. It is the reason a 33-year-old with 40,000 career minutes
    breaks down and a 23-year-old does not.

**The two are joined at tip-off, not added together.** A player does not start
a game at 100 when he is carrying a season's fatigue: `starting_condition`
lowers where his in-game meter begins. Everything downstream -- the rotation
pulling him sooner, the possession engine asking less of him, the attribute
penalty below -- then follows from the one number the engine already reads.
Adding a separate season-fatigue term to each of those would have counted the
same tiredness two and three times over.

**What was already here, and is not re-implemented.** The possession engine
already lowers a tired man's usage (`_usage_weight`) and already measures how
gassed a lineup is (`_fatigue`). Neither touches attributes, which is what this
module adds -- so the three effects stack deliberately rather than by accident:
he does less, he does it worse, and his team does it worse around him.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Fatigue: the bands, and what they cost
# --------------------------------------------------------------------------

# The brief's own ladder. `label_for` reads it top down.
FATIGUE_BANDS: tuple[tuple[float, str], ...] = (
    (91.0, "Critical Fatigue"),
    (76.0, "Exhausted"),
    (61.0, "Heavy Fatigue"),
    (46.0, "Noticeable Fatigue"),
    (31.0, "Slightly Tired"),
    (16.0, "Fresh"),
    (0.0, "Fully Rested"),
)

# Condition, which is the same information said the way a team sheet says it.
CONDITION_BANDS: tuple[tuple[float, str], ...] = (
    (80.0, "Exhausted"),
    (62.0, "Poor"),
    (44.0, "Fair"),
    (24.0, "Good"),
    (0.0, "Excellent"),
)

# Rating points knocked off a fully-affected attribute, against fatigue. This
# is the brief's table, interpolated -- 40 costs a point, 60 costs two, 80
# costs three and a half, and the top of the scale is ruinous.
PENALTY_CURVE: tuple[tuple[float, float], ...] = (
    (0.0, 0.0),
    (20.0, 0.1),
    (40.0, 1.0),
    (60.0, 2.0),
    (80.0, 3.5),
    (95.0, 5.0),
    (100.0, 6.0),
)


def interpolate(curve: tuple[tuple[float, float], ...], value: float) -> float:
    """Piecewise-linear read of a table. The table is the specification."""
    if value <= curve[0][0]:
        return curve[0][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if value <= x1:
            return y0 + (y1 - y0) * (value - x0) / (x1 - x0)
    return curve[-1][1]


def label_for(bands: tuple[tuple[float, str], ...], value: float) -> str:
    for floor, name in bands:
        if value >= floor:
            return name
    return bands[-1][1]


# How hard fatigue bites each attribute, as a multiple of the curve above.
#
# The brief names the attributes it wants affected and the ones it does not.
# Three of its names have no attribute behind them in this project's 81, and
# rather than inventing one they are mapped to what actually carries the job:
#
#   "Closeouts"          -> shot_contest, wing_defense
#   "Driving"            -> euro_step, isolation -- the attributes a drive is
#                           actually resolved from
#   "Reaction Time"      -> steals, blocks. The obvious candidate, `anticipation`,
#                           sits in the Basketball IQ group, and the brief is
#                           explicit that IQ does not fall with tiredness. A
#                           tired player still reads the play; his hands and
#                           feet are late. That is steals and blocks.
#   "Transition Defense" -> no attribute of its own. Getting back is legs, and
#                           legs are already the most heavily penalised things
#                           on this list, so it is covered rather than faked.
#
# Deliberately absent: everything in Basketball IQ, Intangibles and Mental, plus
# `passing` and `court_vision`. Shooting is absent too, and that is the brief's
# call rather than an oversight -- the engine already damps a tired man's
# *usage*, so he takes fewer shots rather than missing more of them.
FATIGUE_WEIGHTS: dict[str, float] = {
    # Legs. The first thing to go and the most expensive.
    "speed": 1.4,
    "acceleration": 1.4,
    "quickness": 1.3,
    "agility": 1.3,
    "vertical_leap": 1.3,
    "stamina": 1.2,
    "balance": 0.7,
    "strength": 0.6,
    # Defence, which is effort before it is anything else.
    "perimeter_defense": 1.1,
    "interior_defense": 1.0,
    "help_defense": 1.1,
    "pick_and_roll_defense": 1.0,
    "shot_contest": 1.2,
    "wing_defense": 1.1,
    "switchability": 1.0,
    "post_defense": 0.9,
    "rim_protection": 1.0,
    # "Reaction time": the hands and feet, not the read.
    "steals": 1.0,
    "blocks": 1.0,
    # Transition, both ways.
    "transition_play": 1.2,
    "transition_finishing": 1.2,
    "pace_control": 0.6,
    # Moving without the ball.
    "off_ball_movement": 1.1,
    "cutting": 1.1,
    # Getting to the rim and finishing there.
    "euro_step": 0.9,
    "isolation": 0.8,
    "dunking": 1.2,
    "finishing_through_contact": 1.0,
    # The glass.
    "offensive_rebounding": 1.1,
    "defensive_rebounding": 1.0,
    "boxing_out": 0.9,
    "rebound_positioning": 0.7,
    "rebound_timing": 0.9,
    # Late-game, and the one cognitive concession the brief allows.
    "clutch_performance": 1.0,
    "decision_making": 0.3,
}


def penalty(fatigue: float, attribute: str) -> float:
    """Rating points to subtract from `attribute` at this fatigue."""
    weight = FATIGUE_WEIGHTS.get(attribute)
    if not weight:
        return 0.0
    return interpolate(PENALTY_CURVE, fatigue) * weight


def effective(player, attribute: str) -> float:
    """An attribute as the player can use it right now.

    Reads live in-game fatigue (`100 - condition`), because that is the number
    that already carries both what he brought into the building and what the
    last three quarters have taken out of him.
    """
    base = getattr(player.ratings, attribute)
    weight = FATIGUE_WEIGHTS.get(attribute)
    if not weight:
        return base
    drop = interpolate(PENALTY_CURVE, 100.0 - player.condition) * weight
    knock = player.health.knock if player.health else 0.0
    if knock:
        # Playing hurt. A knock is a fraction of a fatigue penalty on the same
        # attributes -- it is the same kind of drag, from a different cause.
        drop += interpolate(PENALTY_CURVE, knock * KNOCK_AS_FATIGUE) * weight
    return max(1.0, base - drop)


# A minor knock at severity 100 drags like this much fatigue.
KNOCK_AS_FATIGUE = 0.55


# --------------------------------------------------------------------------
# The state a player carries
# --------------------------------------------------------------------------

@dataclass
class MajorInjury:
    """A serious one. Rare, and the only thing that rules a player out."""

    name: str
    games_remaining: int
    games_total: int
    # What it will cost him permanently, applied by the offseason.
    permanent: dict[str, float] = field(default_factory=dict)
    potential_cost: float = 0.0

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "gamesRemaining": self.games_remaining,
            "gamesTotal": self.games_total,
        }


@dataclass
class Health:
    """Everything about a player's body that changes week to week.

    `health` and `condition` are *derived*, not stored -- they are two readings
    of the four numbers below, and storing either would give a save two places
    to disagree about the same player.
    """

    fatigue: float = 0.0     # 0-100, season-level. Higher is worse.
    wear: float = 0.0        # 0-100, career-level. Barely moves, barely heals.
    knock: float = 0.0       # 0-100 minor injury severity. Heals in days.
    injury: MajorInjury | None = None
    # Days since he last played, for recovery and for the back-to-back test.
    days_rested: float = 0.0
    games_missed: int = 0

    # -- derived ---------------------------------------------------------
    @property
    def available(self) -> bool:
        return self.injury is None

    @property
    def score(self) -> float:
        """Overall health, 0-100. One number for a squad list to sort on.

        Weighted so that the thing a manager can do something about -- fatigue
        -- moves it most, and the thing he cannot -- wear -- moves it least.
        """
        if self.injury is not None:
            return 0.0
        return max(0.0, 100.0
                   - self.fatigue * 0.55
                   - self.knock * 0.30
                   - self.wear * 0.15)

    @property
    def fatigue_label(self) -> str:
        return label_for(FATIGUE_BANDS, self.fatigue)

    @property
    def condition_label(self) -> str:
        return "Injured" if self.injury else label_for(CONDITION_BANDS, self.fatigue)

    def to_dict(self) -> dict:
        return {
            "fatigue": round(self.fatigue, 1),
            "fatigueLabel": self.fatigue_label,
            "wear": round(self.wear, 1),
            "knock": round(self.knock, 1),
            "health": round(self.score, 1),
            "condition": self.condition_label,
            "available": self.available,
            "daysRested": round(self.days_rested, 2),
            "gamesMissed": self.games_missed,
            "injury": self.injury.to_dict() if self.injury else None,
        }


# --------------------------------------------------------------------------
# Starting a game
# --------------------------------------------------------------------------

# How much of a season's fatigue a player carries into the opening tip. Not all
# of it: a night's sleep and a shootaround are worth something, and starting a
# man at condition 20 because he is at fatigue 80 would bench him by the first
# timeout. This is the single dial that decides how much season-level fatigue
# is worth in a game.
CARRY = 0.62


def starting_condition(player) -> float:
    """Where a player's in-game meter begins.

    This is the whole bridge between the season model and the possession
    engine. Nothing else in the engine needs to know that season fatigue
    exists.
    """
    health = getattr(player, "health", None)
    if health is None:
        return 100.0
    drag = health.fatigue * CARRY + health.knock * 0.25
    return max(25.0, 100.0 - drag)


# --------------------------------------------------------------------------
# Fatigue accrual: what one game costs
# --------------------------------------------------------------------------

# Fatigue points for a full 36-minute night at ordinary intensity, before any
# of the modifiers below. Set against `RECOVERY_PER_DAY` so that a starter on a
# normal every-other-day schedule drifts up slowly across a season rather than
# pinning at the top of the scale by December.
MINUTES_COST = 18.0 / 36.0

# A game on no real rest. Kept deliberately small, and the reason is this
# calendar: with three slates a day, *almost every game is a back-to-back*, so
# a large flat charge is not a penalty for a hard schedule -- it is a constant
# tax that lands on everybody equally and squeezes the gap between a
# thirty-eight-minute star and a twelve-minute reserve, which is the one gap
# the whole system exists to show. At 7.0 it did exactly that and the league
# pinned at Critical Fatigue to a man.
BACK_TO_BACK = 2.0
THREE_IN_FOUR = 0.9

# Overtime is five more minutes at the highest intensity of the night.
OVERTIME_COST = 2.0

# Every road game carries a flight. Small, but it is on the schedule 41 times.
TRAVEL_COST = 0.7

# Age. A 22-year-old and a 35-year-old do not leave the same game equally
# tired, and this is the curve that says so.
AGE_FREE = 27.0
AGE_COST_PER_YEAR = 0.030

# Conditioning: stamina and work rate against the league average.
CONDITIONING_SWING = 0.35

# Playing through a knock costs more than playing healthy.
KNOCK_FATIGUE_MULTIPLIER = 0.45


def _rating(player, key: str, default: float = 10.0) -> float:
    return getattr(player.ratings, key, default)


def conditioning(player) -> float:
    """A multiplier on fatigue gain: below 1 for the well-conditioned."""
    from . import composites as C
    from .ratings import LEAGUE_AVERAGE

    fitness = (C.endurance(player) * 0.7 + _rating(player, "work_rate") * 0.3)
    edge = (fitness - LEAGUE_AVERAGE) / LEAGUE_AVERAGE
    return max(0.55, 1.0 - edge * CONDITIONING_SWING)


def age_factor(age: int) -> float:
    return 1.0 + max(0, age - AGE_FREE) * AGE_COST_PER_YEAR


def game_fatigue(player, minutes: float, *, intensity: float = 1.0,
                 back_to_back: bool = False, three_in_four: bool = False,
                 overtimes: int = 0, away: bool = False) -> float:
    """Fatigue added by one game. Everything the brief lists, in one place."""
    if minutes <= 0:
        return 0.0
    health = player.health
    cost = minutes * MINUTES_COST * intensity
    cost *= conditioning(player)
    cost *= age_factor(player.age)
    if health and health.knock:
        cost *= 1.0 + (health.knock / 100.0) * KNOCK_FATIGUE_MULTIPLIER
    if back_to_back:
        cost += BACK_TO_BACK
    elif three_in_four:
        cost += THREE_IN_FOUR
    cost += OVERTIME_COST * overtimes
    if away:
        cost += TRAVEL_COST
    return cost


# --------------------------------------------------------------------------
# Recovery: what a day off is worth
# --------------------------------------------------------------------------

# Recovery is measured in **hours between games**, not calendar days, and that
# is forced by the calendar this league actually plays: 82 games in 28 days,
# three slates a day, so a club plays 2.93 times a *day*. A model that handed
# out a night's sleep per date would be pricing a schedule nobody here plays.
#
# What a player gets between two tip-offs is therefore the real gap -- about
# five hours between slates, thirteen overnight -- and the constants below are
# set against that cadence rather than against a real-world one. On a 165-day
# NBA calendar the same player would clear far more between games; the shape of
# the model would not change, only these two numbers.
HOURS_PER_DAY = 24.0

# The flat part: what an average professional sheds in a day regardless of how
# much he is carrying. Small, because on this calendar the proportional term
# below does nearly all the work.
RECOVERY_PER_DAY = 2.4

# The part that matters. Recovery proportional to what is in the tank is
# exponential decay toward fresh, and it is the only shape that gives a stable
# equilibrium against a repeating schedule: load pushes fatigue up, decay pulls
# it down harder the higher it gets, and a player settles at the level his
# minutes deserve instead of drifting to one end of the scale.
RECOVERY_PROPORTIONAL = 1.20

# What a club's medical and conditioning staff are worth. Read off the head
# coach's development rating, which is the closest thing this project has to a
# performance department.
STAFF_SWING = 0.30

# A knock heals on its own schedule, faster than fatigue clears.
KNOCK_HEAL_PER_DAY = 12.0


def recovery_rate(player, staff: float = 50.0) -> float:
    """Fatigue points a player sheds per full day of rest."""
    from .ratings import LEAGUE_AVERAGE

    stamina = _rating(player, "stamina")
    professionalism = getattr(player.hidden, "professionalism", LEAGUE_AVERAGE)
    body = ((stamina + professionalism) / 2.0 - LEAGUE_AVERAGE) / LEAGUE_AVERAGE
    rate = RECOVERY_PER_DAY * (1.0 + body * 0.30)
    rate *= 1.0 + ((staff - 50.0) / 50.0) * STAFF_SWING
    # Older bodies do not bounce back the way younger ones do.
    rate /= age_factor(player.age)
    return max(4.0, rate)


def rest(player, hours: float, staff: float = 50.0) -> None:
    """Advance a player's recovery by `hours` of elapsed time.

    The proportional term is applied as true exponential decay rather than a
    linear subtraction. Over a five-hour gap the difference is small; over a
    four-month summer a linear one would drive fatigue thousands of points
    negative before the clamp caught it, and the clamp is not the model.
    """
    health = player.health
    if health is None or hours <= 0:
        return
    days = hours / HOURS_PER_DAY
    rate = recovery_rate(player, staff)
    health.fatigue = max(0.0, health.fatigue * math.exp(-RECOVERY_PROPORTIONAL * days)
                         - rate * days)
    health.knock = max(0.0, health.knock - KNOCK_HEAL_PER_DAY * days)


# --------------------------------------------------------------------------
# Wear and tear
# --------------------------------------------------------------------------

# Wear from one 36-minute game at ordinary fatigue. Tiny on purpose: this is a
# career-length quantity, and a full 82-game season of heavy minutes should be
# worth single digits rather than half the scale.
WEAR_PER_36 = 0.11

# Playing tired is what actually breaks people. A game finished in Critical
# Fatigue does several times the damage of one finished Fresh.
WEAR_FATIGUE_SWING = 1.6

# Age again: the same night costs a 34-year-old more than a 24-year-old.
WEAR_AGE_FREE = 26.0
WEAR_AGE_PER_YEAR = 0.055

# Wear sheds a little over a summer -- four months off is real -- but never
# clears. What is left is what makes a thirty-something fragile.
WEAR_OFFSEASON_RECOVERY = 0.14


def game_wear(player, minutes: float, fatigue_at_end: float) -> float:
    if minutes <= 0:
        return 0.0
    load = minutes / 36.0
    tired = 1.0 + (fatigue_at_end / 100.0) * WEAR_FATIGUE_SWING
    aged = 1.0 + max(0, player.age - WEAR_AGE_FREE) * WEAR_AGE_PER_YEAR
    durability = _rating(player, "durability")
    frailty = max(0.6, 1.0 + (10.5 - durability) * 0.045)
    return WEAR_PER_36 * load * tired * aged * frailty


# --------------------------------------------------------------------------
# Injuries
#
# Two tiers, and the split is the brief's central demand. A knock is common,
# costs a few days and is felt as a performance drag rather than an absence. A
# major injury is rare and is the only thing that rules anybody out.
# --------------------------------------------------------------------------

# Chance per player-game of picking up a knock, at league-average everything
# and zero fatigue. Fatigue and wear multiply it hard, so the figure a season
# actually produces is several times this.
BASE_KNOCK_CHANCE = 0.0065

# Chance per player-game of a major injury, same baseline. This is the number
# that decides whether the league feels realistic or feels like a hospital: at
# 30 clubs x 12 men x 82 games it has to be very small.
BASE_MAJOR_CHANCE = 0.00055

# How much fatigue and wear multiply the risk. A man at Critical Fatigue is
# meaningfully more likely to get hurt than a fresh one -- that is the whole
# incentive to rest him -- without it becoming a certainty.
FATIGUE_RISK_SWING = 2.2
WEAR_RISK_SWING = 1.1
AGE_RISK_FREE = 28.0
AGE_RISK_PER_YEAR = 0.055

# Minutes matter: you cannot turn an ankle on the bench.
MINUTES_RISK_REFERENCE = 30.0


@dataclass(frozen=True)
class InjuryKind:
    name: str
    games: tuple[int, int]
    permanent: dict[str, float] = field(default_factory=dict)
    potential_cost: float = 0.0


# The rare ones. Weighted so that the season-ending catastrophes are a small
# slice of an already small slice -- most "major" injuries are six weeks, not a
# year. Permanent costs are handed to `progression` at the offseason, which is
# where a career-shaping loss belongs.
MAJOR_INJURIES: tuple[tuple[float, InjuryKind], ...] = (
    (0.30, InjuryKind("Sprained ankle", (6, 14))),
    (0.18, InjuryKind("Hamstring strain", (8, 18), {"speed": 0.5, "acceleration": 0.4})),
    (0.14, InjuryKind("Groin strain", (7, 16), {"agility": 0.4, "quickness": 0.4})),
    (0.12, InjuryKind("Broken hand", (14, 26))),
    (0.10, InjuryKind("Stress fracture", (18, 34), {"speed": 0.8, "vertical_leap": 0.8},
                      potential_cost=3.0)),
    (0.08, InjuryKind("Meniscus tear", (24, 45), {"quickness": 1.2, "agility": 1.0,
                                                  "vertical_leap": 1.0},
                      potential_cost=6.0)),
    (0.05, InjuryKind("Achilles rupture", (55, 82), {"speed": 3.0, "acceleration": 2.8,
                                                     "vertical_leap": 2.6, "quickness": 2.4},
                      potential_cost=18.0)),
    (0.03, InjuryKind("ACL tear", (50, 82), {"quickness": 3.0, "agility": 2.8,
                                             "speed": 2.2, "acceleration": 2.2},
                      potential_cost=16.0)),
)

KNOCK_KINDS: tuple[str, ...] = (
    "Ankle soreness", "Knee soreness", "Back spasms", "Hip tightness",
    "Wrist sprain", "Shoulder strain", "Calf tightness", "Foot soreness",
    "Hamstring tightness", "Illness",
)


def risk_multiplier(player, minutes: float) -> float:
    """How much more likely than baseline this player is to get hurt tonight."""
    health = player.health
    fatigue = health.fatigue if health else 0.0
    wear = health.wear if health else 0.0
    proneness = getattr(player.hidden, "injury_proneness", 10.0)
    durability = _rating(player, "durability")

    factor = 1.0 + (fatigue / 100.0) * FATIGUE_RISK_SWING
    factor *= 1.0 + (wear / 100.0) * WEAR_RISK_SWING
    factor *= 1.0 + max(0, player.age - AGE_RISK_FREE) * AGE_RISK_PER_YEAR
    factor *= 1.0 + (proneness - 10.0) * 0.055
    factor *= max(0.55, 1.0 + (10.5 - durability) * 0.040)
    # Time on the floor is exposure.
    factor *= minutes / MINUTES_RISK_REFERENCE
    return max(0.0, factor)


def roll_injury(player, minutes: float, seed: str) -> tuple[str | None, object]:
    """Decide what, if anything, happened to a player tonight.

    Returns `(kind, detail)`: `("knock", severity)`, `("major", MajorInjury)`,
    or `(None, None)`. Seeded from the game and the player, so a season replays
    to the same injuries -- everything else in this project is reproducible and
    an injury list that changed on reload would be the one thing that was not.
    """
    if minutes <= 0:
        return None, None
    # Imported here rather than at module scope: `bballsim.engine.__init__`
    # pulls in the simulator, which imports `models`, which imports this.
    from .engine.rng import seed_from_string

    rng = random.Random(seed_from_string(seed))
    factor = risk_multiplier(player, minutes)

    if rng.random() < BASE_MAJOR_CHANCE * factor:
        kind = _weighted(rng, MAJOR_INJURIES)
        games = rng.randint(*kind.games)
        return "major", MajorInjury(
            name=kind.name, games_remaining=games, games_total=games,
            permanent=dict(kind.permanent), potential_cost=kind.potential_cost,
        )

    if rng.random() < BASE_KNOCK_CHANCE * factor:
        severity = rng.uniform(18.0, 70.0) * (0.7 + factor * 0.3)
        return "knock", min(100.0, severity)

    return None, None


def _weighted(rng: random.Random, table: tuple[tuple[float, InjuryKind], ...]) -> InjuryKind:
    total = sum(weight for weight, _ in table)
    mark = rng.random() * total
    for weight, kind in table:
        mark -= weight
        if mark <= 0:
            return kind
    return table[-1][1]


# --------------------------------------------------------------------------
# Intensity: not every game is played at the same pitch
# --------------------------------------------------------------------------

def game_intensity(round_label: str, margin: int) -> float:
    """How hard a night was, from what kind of game it was and how close.

    A twenty-point win in November is not a Game 7. Both ends matter: a blowout
    lets a manager empty his bench, and a playoff game is played at a pitch no
    regular-season game reaches.
    """
    base = 1.22 if round_label else 1.0
    if margin >= 25:
        return base * 0.85
    if margin >= 15:
        return base * 0.94
    if margin <= 5:
        return base * 1.08
    return base


# --------------------------------------------------------------------------
# The season loop
#
# Health is **stored**, not derived, and that is a deliberate departure from
# how standings and season stats work here. A player's tiredness is a fact
# about his body at a moment in time, in the same category as his age -- not a
# summary of the fixture list. Deriving it would also mean replaying every
# recovery day of a season on every boot to answer "is he fit tonight?".
# --------------------------------------------------------------------------

def sync(player) -> None:
    """Keep the selection flag in step with the injury that caused it."""
    player.injured = player.health.injury is not None


def advance_to(league, moment) -> None:
    """Rest every player for the time that has passed since this last ran.

    The first call anchors the clock rather than paying anything out: a league
    loaded on a Tuesday must not be handed a night's recovery for a night that
    did not happen.

    **This has to be interleaved with the games, not applied in a lump.** It is
    called immediately before each finished game is folded in, using that
    game's own tip-off. Calling it once per `tick` instead looked equivalent
    and was not: a clock jumped to the end of a season pays out the whole
    season's recovery in one go and *then* plays the season's games into it, so
    fatigue ended a full 82-game year at a mean of 0.8 with nobody above Fresh.
    Rest has to be spent in the order it was earned.
    """
    last = getattr(league, "health_clock", None)
    if last is None:
        league.health_clock = moment
        return
    hours = (moment - last).total_seconds() / 3600.0
    if hours <= 0:
        return
    days = hours / HOURS_PER_DAY
    for team in league.teams.values():
        staff = team.coach.ratings.development if team.coach else 50.0
        for player in team.players:
            rest(player, hours, staff)
            player.health.days_rested += days
    league.health_clock = moment


def after_game(league, game) -> None:
    """Apply one finished game to both squads.

    Everyone who took the floor picks up fatigue, a little wear and a roll of
    the dice. Everyone sitting out with a major injury gets a game closer to
    being back -- which is why this walks the whole squad and not just the box
    score.
    """
    result = game.result
    if result is None:
        return
    # Everything the players earned between the last game and this one, before
    # tonight is charged to them.
    advance_to(league, game.tipoff_at)
    margin = abs(result.home_score - result.away_score)
    overtimes = max(0, result.periods_played - 4)
    intensity = game_intensity(getattr(game, "round_label", "") or "", margin)

    for team_id, box, away in (
        (game.home_team_id, result.home_box, False),
        (game.away_team_id, result.away_box, True),
    ):
        team = league.teams.get(team_id)
        if team is None:
            continue
        for player in team.players:
            health = player.health
            line = box.players.get(player.id)
            minutes = (line.seconds / 60.0) if line else 0.0

            if health.injury is not None:
                health.injury.games_remaining -= 1
                health.games_missed += 1
                if health.injury.games_remaining <= 0:
                    # Back in the squad, but not back to himself: a long lay-off
                    # leaves a man short of match fitness rather than fresh.
                    health.injury = None
                    health.fatigue = max(health.fatigue, 35.0)
                sync(player)
                continue

            if minutes <= 0:
                continue

            # On this calendar a "back-to-back" is the second or third slate
            # of the same day -- under nine hours between tip-offs -- and the
            # softer case is a gap under a full day.
            back_to_back = health.days_rested < 0.38
            three_in_four = health.days_rested < 1.0
            health.fatigue = min(100.0, health.fatigue + game_fatigue(
                player, minutes, intensity=intensity,
                back_to_back=back_to_back, three_in_four=three_in_four,
                overtimes=overtimes, away=away))
            health.wear = min(100.0, health.wear + game_wear(
                player, minutes, health.fatigue))
            health.days_rested = 0.0

            kind, detail = roll_injury(player, minutes, f"{game.id}-{player.id}")
            if kind == "major":
                health.injury = detail
                health.knock = 0.0
                sync(player)
            elif kind == "knock":
                health.knock = min(100.0, max(health.knock, detail))


def reset_season(teams) -> None:
    """What a summer does. Called by the offseason.

    Fatigue and knocks clear completely -- four months is more than enough.
    Wear does not: it sheds a share and keeps the rest, which is the whole
    reason a thirty-something breaks down and a rookie does not.
    """
    for team in teams:
        for player in team.players:
            health = player.health
            health.fatigue = 0.0
            health.knock = 0.0
            health.injury = None
            health.days_rested = 3.0
            health.games_missed = 0
            health.wear = max(0.0, health.wear * (1.0 - WEAR_OFFSEASON_RECOVERY))
            sync(player)
