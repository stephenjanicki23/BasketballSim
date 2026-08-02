"""Team tactical instructions.

These are the knobs a manager sets. The engine reads them at every decision
point in a possession, so adding a new instruction means adding a field here
and consuming it in `bballsim/engine/possession.py`.

Sliders are 0-100 with 50 as neutral; enums are named schemes.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from enum import Enum

NEUTRAL = 50.0


class OffensiveScheme(str, Enum):
    MOTION = "motion"                 # egalitarian, movement, higher assist rate
    PACE_AND_SPACE = "pace_and_space"  # more threes, faster, thinner offensive glass
    INSIDE_OUT = "inside_out"          # post touches feeding kickouts
    ISOLATION = "isolation"            # star-heavy, fewer assists, more late clock
    SEVEN_SECONDS = "seven_seconds"    # extreme pace, early shots


class DefensiveScheme(str, Enum):
    MAN = "man"
    SWITCH_EVERYTHING = "switch"
    DROP_COVERAGE = "drop"
    HEDGE = "hedge"
    ZONE_23 = "zone_2_3"


class Aggression(str, Enum):
    PASSIVE = "passive"
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"


def slider(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def slider_mod(value: float) -> float:
    """Turn a 0-100 slider into a -1.0 .. +1.0 modifier."""
    return (slider(value) - NEUTRAL) / NEUTRAL


@dataclass
class Tactics:
    """One team's game plan."""

    offensive_scheme: OffensiveScheme = OffensiveScheme.MOTION
    defensive_scheme: DefensiveScheme = DefensiveScheme.MAN

    # --- Offensive sliders -------------------------------------------------
    pace: float = NEUTRAL                 # possessions per 48
    three_point_emphasis: float = NEUTRAL  # shot mix pulled toward the arc
    ball_movement: float = NEUTRAL         # extra passes -> assists, fewer isos
    offensive_rebounding: float = NEUTRAL  # crash vs. get back
    tempo_after_rebound: float = NEUTRAL   # push in transition

    # --- Defensive sliders -------------------------------------------------
    defensive_pressure: float = NEUTRAL    # forces turnovers, concedes drives
    help_intensity: float = NEUTRAL        # protects rim, opens corners
    foul_discipline: float = NEUTRAL       # high = fewer fouls, softer contests
    close_out_hard: float = NEUTRAL        # contest threes, concede the drive

    # --- Game management ---------------------------------------------------
    aggression: Aggression = Aggression.BALANCED
    minutes_stagger: float = NEUTRAL       # how aggressively stars are rested

    def __post_init__(self) -> None:
        for f in fields(self):
            value = getattr(self, f.name)
            if f.type == "float" or isinstance(value, (int, float)):
                setattr(self, f.name, slider(value))

    def to_dict(self) -> dict:
        out = {}
        for f in fields(self):
            value = getattr(self, f.name)
            out[f.name] = value.value if isinstance(value, Enum) else value
        return out

    @classmethod
    def from_dict(cls, data: dict) -> "Tactics":
        known = {f.name for f in fields(cls)}
        kwargs: dict = {}
        for key, value in data.items():
            if key not in known:
                continue
            if key == "offensive_scheme":
                kwargs[key] = OffensiveScheme(value)
            elif key == "defensive_scheme":
                kwargs[key] = DefensiveScheme(value)
            elif key == "aggression":
                kwargs[key] = Aggression(value)
            else:
                kwargs[key] = value
        return cls(**kwargs)


# --------------------------------------------------------------------------
# Scheme effects. Each entry is a set of multiplicative / additive nudges the
# possession engine applies. Tuning the game's feel mostly happens right here.
# --------------------------------------------------------------------------

OFFENSIVE_SCHEME_EFFECTS: dict[OffensiveScheme, dict[str, float]] = {
    #                           pace   3PA    rim    assist  turnover  oreb
    OffensiveScheme.MOTION:            {"pace": 0.00, "three_rate": 0.00, "rim_rate": 0.00, "assist_rate": 0.12, "turnover_rate": 0.02, "oreb_rate": 0.00},
    OffensiveScheme.PACE_AND_SPACE:    {"pace": 0.08, "three_rate": 0.18, "rim_rate": 0.02, "assist_rate": 0.06, "turnover_rate": 0.00, "oreb_rate": -0.15},
    OffensiveScheme.INSIDE_OUT:        {"pace": -0.05, "three_rate": 0.04, "rim_rate": 0.14, "assist_rate": 0.04, "turnover_rate": 0.03, "oreb_rate": 0.12},
    OffensiveScheme.ISOLATION:         {"pace": -0.08, "three_rate": -0.04, "rim_rate": 0.06, "assist_rate": -0.20, "turnover_rate": -0.03, "oreb_rate": -0.05},
    OffensiveScheme.SEVEN_SECONDS:     {"pace": 0.18, "three_rate": 0.10, "rim_rate": 0.08, "assist_rate": 0.08, "turnover_rate": 0.06, "oreb_rate": -0.10},
}

DEFENSIVE_SCHEME_EFFECTS: dict[DefensiveScheme, dict[str, float]] = {
    #                            opp 3P%  opp rim%  steals  blocks  fouls  dreb
    DefensiveScheme.MAN:              {"three_pct": 0.00, "rim_pct": 0.00, "steal_rate": 0.00, "block_rate": 0.00, "foul_rate": 0.00, "dreb_rate": 0.00},
    DefensiveScheme.SWITCH_EVERYTHING: {"three_pct": -0.04, "rim_pct": 0.03, "steal_rate": 0.02, "block_rate": -0.05, "foul_rate": -0.02, "dreb_rate": -0.04},
    DefensiveScheme.DROP_COVERAGE:     {"three_pct": 0.05, "rim_pct": -0.06, "steal_rate": -0.04, "block_rate": 0.10, "foul_rate": -0.03, "dreb_rate": 0.04},
    DefensiveScheme.HEDGE:             {"three_pct": -0.03, "rim_pct": 0.02, "steal_rate": 0.06, "block_rate": 0.00, "foul_rate": 0.05, "dreb_rate": -0.02},
    DefensiveScheme.ZONE_23:           {"three_pct": 0.06, "rim_pct": -0.08, "steal_rate": 0.03, "block_rate": 0.04, "foul_rate": -0.06, "dreb_rate": -0.06},
}


def offensive_effect(tactics: Tactics, key: str) -> float:
    return OFFENSIVE_SCHEME_EFFECTS[tactics.offensive_scheme].get(key, 0.0)


def defensive_effect(tactics: Tactics, key: str) -> float:
    return DEFENSIVE_SCHEME_EFFECTS[tactics.defensive_scheme].get(key, 0.0)
