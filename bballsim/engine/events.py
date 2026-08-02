"""Play-by-play events.

Every meaningful thing that happens in a possession becomes one of these. The
game tracker UI renders the exact same objects the engine emits, so if you can
see it in the feed, the engine actually simulated it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class EventType(str, Enum):
    GAME_START = "game_start"
    PERIOD_START = "period_start"
    PERIOD_END = "period_end"
    JUMP_BALL = "jump_ball"

    SHOT_MADE = "shot_made"
    SHOT_MISSED = "shot_missed"
    BLOCK = "block"
    ASSIST = "assist"
    REBOUND = "rebound"
    TURNOVER = "turnover"
    STEAL = "steal"
    FOUL = "foul"
    FREE_THROW_MADE = "free_throw_made"
    FREE_THROW_MISSED = "free_throw_missed"

    SUBSTITUTION = "substitution"
    TIMEOUT = "timeout"

    GAME_END = "game_end"


class ShotZone(str, Enum):
    RIM = "rim"
    PAINT = "paint"
    MID_RANGE = "mid_range"
    CORNER_THREE = "corner_three"
    ABOVE_BREAK_THREE = "above_break_three"

    @property
    def points(self) -> int:
        return 3 if self in (ShotZone.CORNER_THREE, ShotZone.ABOVE_BREAK_THREE) else 2

    @property
    def is_three(self) -> bool:
        return self.points == 3

    @property
    def label(self) -> str:
        return {
            ShotZone.RIM: "at the rim",
            ShotZone.PAINT: "in the paint",
            ShotZone.MID_RANGE: "from mid-range",
            ShotZone.CORNER_THREE: "from the corner",
            ShotZone.ABOVE_BREAK_THREE: "from the top of the key",
        }[self]


@dataclass
class GameEvent:
    """One line of the play-by-play."""

    sequence: int
    period: int
    clock: str                  # "10:42" -- game clock remaining in the period
    game_seconds: float         # seconds elapsed since tip-off, for tracker pacing
    type: EventType
    description: str

    team_id: str | None = None
    player_id: str | None = None
    secondary_player_id: str | None = None

    home_score: int = 0
    away_score: int = 0

    # Type-specific payload: shot zone, points, rebound kind, foul kind, ...
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "sequence": self.sequence,
            "period": self.period,
            "clock": self.clock,
            "game_seconds": round(self.game_seconds, 1),
            "type": self.type.value,
            "description": self.description,
            "team_id": self.team_id,
            "player_id": self.player_id,
            "secondary_player_id": self.secondary_player_id,
            "home_score": self.home_score,
            "away_score": self.away_score,
            "detail": self.detail,
        }


def format_clock(seconds_remaining: float) -> str:
    seconds_remaining = max(0.0, seconds_remaining)
    minutes = int(seconds_remaining // 60)
    seconds = seconds_remaining - minutes * 60
    if minutes == 0 and seconds < 60:
        return f"{seconds:04.1f}"
    return f"{minutes}:{int(seconds):02d}"
