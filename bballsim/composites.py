"""Composites: attributes -> the numbers a possession actually uses.

With 81 visible attributes, the possession engine cannot reference raw
ratings without becoming unreadable and impossible to balance. Instead every
engine decision reads a *composite* defined here -- a named, weighted blend
that answers one basketball question ("how well does this man finish at the
rim?", "how hard is he to strip?").

This is the layer to tune when the sim feels wrong. If threes fall too often,
the fix is either the baseline in `possession.py` or the blend in
`shooting_three()` -- not a change scattered across the engine.

Every function returns a 1-99 value on the same scale as the attributes, so
`normalize()` and `advantage()` work on the results unchanged.
"""

from __future__ import annotations

from .health import effective
from .models import Lineup, Player

# --------------------------------------------------------------------------
# Helper
# --------------------------------------------------------------------------

def blend(player: Player, weights: dict[str, float]) -> float:
    """Weighted mean of named attributes, as the player can use them now.

    Takes the *player* rather than his `Ratings` because tiredness is a
    property of the man on the floor, not of the rating sheet. Every composite
    goes through here, so this one line is where fatigue reaches the engine --
    which is the same reason the module note above says this is the layer to
    tune. `health.effective` returns the stored attribute for anything fatigue
    does not touch, so the untouched two-thirds of the sheet cost nothing.
    """
    total = sum(weights.values())
    return sum(effective(player, key) * weight for key, weight in weights.items()) / total


# --------------------------------------------------------------------------
# Shooting, by zone. These are the shooter's side of a shot attempt.
# --------------------------------------------------------------------------

def shooting_rim(player: Player) -> float:
    """Finishing at the rim: layups, dunks, and absorbing contact."""
    return blend(player, {
        "layups": 1.0,
        "close_shot": 0.9,
        "dunking": 0.6,
        "finishing_through_contact": 0.7,
        "euro_step": 0.4,
        "vertical_leap": 0.3,
        "balance": 0.3,
        "strength": 0.2,
    })


def shooting_paint(player: Player) -> float:
    """Floaters, hooks and post work inside the arc but off the rim."""
    return blend(player, {
        "floater": 1.0,
        "post_moves": 0.7,
        "post_footwork": 0.6,
        "post_hook": 0.6,
        "close_shot": 0.5,
        "balance": 0.3,
        "offensive_versatility": 0.3,
    })


def shooting_mid(player: Player) -> float:
    return blend(player, {
        "mid_range": 1.0,
        "pull_up_shooting": 0.5,
        "fadeaway": 0.4,
        "balance": 0.3,
        "off_ball_shooting": 0.2,
    })


def shooting_corner_three(player: Player) -> float:
    """Corner threes are overwhelmingly catch-and-shoot."""
    return blend(player, {
        "three_point": 1.0,
        "catch_and_shoot": 0.6,
        "off_ball_shooting": 0.4,
        "balance": 0.2,
    })


def shooting_above_break_three(player: Player) -> float:
    """Above the break mixes catch-and-shoot with pull-ups off the dribble."""
    return blend(player, {
        "three_point": 1.0,
        "pull_up_shooting": 0.4,
        "catch_and_shoot": 0.3,
        "off_ball_shooting": 0.2,
        "balance": 0.2,
    })


def free_throw(player: Player) -> float:
    return blend(player, {
        "free_throws": 1.0,
        "focus": 0.25,
        "composure": 0.15,
    })


# --------------------------------------------------------------------------
# Shot creation and selection
# --------------------------------------------------------------------------

def shot_creation(player: Player) -> float:
    """How well a player generates his own look."""
    return blend(player, {
        "isolation": 0.8,
        "pick_and_roll_creation": 0.7,
        "dribbling": 0.7,
        "creativity": 0.6,
        "quickness": 0.5,
        "acceleration": 0.4,
        "offensive_versatility": 0.5,
    })


def shot_quality(player: Player) -> float:
    """Does he take good shots? Feeds shot selection, not make probability."""
    return blend(player, {
        "shot_selection": 1.0,
        "decision_making": 0.6,
        "offensive_awareness": 0.5,
        "spatial_awareness": 0.3,
    })


def off_ball_gravity(player: Player) -> float:
    """Movement without the ball -- creates looks for everyone else."""
    return blend(player, {
        "off_ball_movement": 1.0,
        "cutting": 0.7,
        "off_ball_shooting": 0.6,
        "spatial_awareness": 0.5,
        "screen_setting": 0.3,
    })


def spacing(player: Player) -> float:
    """How much the defence has to respect him out to the arc."""
    return blend(player, {
        "three_point": 1.0,
        "catch_and_shoot": 0.5,
        "off_ball_shooting": 0.4,
    })


# --------------------------------------------------------------------------
# Playmaking and ball security
# --------------------------------------------------------------------------

def playmaking(player: Player) -> float:
    """Creating shots for others."""
    return blend(player, {
        "passing": 1.0,
        "court_vision": 0.9,
        "assist_iq": 0.8,
        "creativity": 0.5,
        "decision_making": 0.6,
        "pick_and_roll_handler": 0.4,
        "passing_from_post": 0.2,
    })


def ball_security(player: Player) -> float:
    """How hard he is to take the ball from."""
    return blend(player, {
        "ball_handling": 1.0,
        "dribbling": 0.7,
        "decision_making": 0.8,
        "composure": 0.4,
        "strength": 0.3,
        "balance": 0.3,
        "focus": 0.3,
    })


# --------------------------------------------------------------------------
# Defence. Split by where the shot comes from, plus event-generating skills.
# --------------------------------------------------------------------------

def interior_defense(player: Player) -> float:
    return blend(player, {
        "interior_defense": 1.0,
        "rim_protection": 0.9,
        "post_defense": 0.6,
        "blocks": 0.5,
        "strength": 0.4,
        "vertical_leap": 0.3,
        "defensive_iq": 0.4,
    })


def perimeter_defense(player: Player) -> float:
    return blend(player, {
        "perimeter_defense": 1.0,
        "shot_contest": 0.7,
        "wing_defense": 0.5,
        "agility": 0.5,
        "quickness": 0.4,
        "defensive_iq": 0.4,
        "switchability": 0.3,
    })


def pick_and_roll_defense(player: Player) -> float:
    return blend(player, {
        "pick_and_roll_defense": 1.0,
        "switchability": 0.6,
        "defensive_iq": 0.5,
        "agility": 0.4,
        "help_defense": 0.4,
    })


def help_defense(player: Player) -> float:
    return blend(player, {
        "help_defense": 1.0,
        "defensive_awareness": 0.7,
        "defensive_iq": 0.6,
        "anticipation": 0.5,
        "speed": 0.3,
    })


def steal_threat(player: Player) -> float:
    return blend(player, {
        "steals": 1.0,
        "anticipation": 0.7,
        "defensive_iq": 0.5,
        "quickness": 0.5,
        "agility": 0.3,
    })


def block_threat(player: Player) -> float:
    return blend(player, {
        "blocks": 1.0,
        "rim_protection": 0.8,
        "vertical_leap": 0.5,
        "anticipation": 0.3,
        "interior_defense": 0.3,
    })


def contest_quality(player: Player) -> float:
    """How much a closeout actually bothers a jump shooter."""
    return blend(player, {
        "shot_contest": 1.0,
        "perimeter_defense": 0.5,
        "vertical_leap": 0.3,
        "defensive_iq": 0.3,
    })


# --------------------------------------------------------------------------
# Rebounding
# --------------------------------------------------------------------------

def offensive_rebounding(player: Player) -> float:
    return blend(player, {
        "offensive_rebounding": 1.0,
        "rebound_positioning": 0.6,
        "rebound_timing": 0.6,
        "boxing_out": 0.3,
        "vertical_leap": 0.4,
        "strength": 0.3,
        "work_rate": 0.3,
    })


def defensive_rebounding(player: Player) -> float:
    return blend(player, {
        "defensive_rebounding": 1.0,
        "boxing_out": 0.7,
        "rebound_positioning": 0.6,
        "rebound_timing": 0.5,
        "strength": 0.4,
        "vertical_leap": 0.3,
    })


# --------------------------------------------------------------------------
# Fouling, discipline, endurance
# --------------------------------------------------------------------------

def foul_avoidance(player: Player) -> float:
    """High = disciplined defender who contests without fouling."""
    return blend(player, {
        "discipline": 1.0,
        "defensive_iq": 0.6,
        "emotional_control": 0.4,
        "balance": 0.3,
    })


def foul_drawing(player: Player) -> float:
    return blend(player, {
        "finishing_through_contact": 0.8,
        "aggression": 0.7,
        "euro_step": 0.4,
        "strength": 0.4,
        "offensive_awareness": 0.3,
    })


def endurance(player: Player) -> float:
    return blend(player, {
        "stamina": 1.0,
        "durability": 0.4,
        "work_rate": 0.3,
    })


def transition_threat(player: Player) -> float:
    return blend(player, {
        "transition_play": 1.0,
        "transition_finishing": 0.7,
        "speed": 0.6,
        "acceleration": 0.5,
        "pace_control": 0.3,
    })


# --------------------------------------------------------------------------
# Mental state -- applied late in close games.
# --------------------------------------------------------------------------

def clutch(player: Player) -> float:
    return blend(player, {
        "clutch_performance": 1.0,
        "pressure_handling": 0.8,
        "composure": 0.6,
        "mental_toughness": 0.5,
        "confidence": 0.4,
        "winning_mentality": 0.3,
    })


# --------------------------------------------------------------------------
# Lineup-level composites
# --------------------------------------------------------------------------

def lineup_mean(lineup: Lineup, composite) -> float:
    return sum(composite(player) for player in lineup) / 5.0


def lineup_best(lineup: Lineup, composite) -> float:
    return max(composite(player) for player in lineup)


# Zone -> shooting composite, so the engine can look one up by shot type.
SHOOTING_BY_ZONE = {
    "rim": shooting_rim,
    "paint": shooting_paint,
    "mid_range": shooting_mid,
    "corner_three": shooting_corner_three,
    "above_break_three": shooting_above_break_three,
}
