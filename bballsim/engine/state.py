"""Game rules configuration and mutable in-game state."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import Lineup, Team
from .boxscore import TeamBox
from .events import GameEvent


@dataclass
class GameRules:
    periods: int = 4
    period_seconds: float = 12 * 60
    overtime_seconds: float = 5 * 60
    shot_clock: float = 24.0
    shot_clock_offensive_rebound: float = 14.0
    team_fouls_for_bonus: int = 5
    personal_fouls_to_foul_out: int = 6
    timeouts_per_team: int = 7


@dataclass
class TeamState:
    """Everything that changes for one team over the course of a game."""

    team: Team
    box: TeamBox
    on_court: Lineup
    fouls_this_period: int = 0
    timeouts_remaining: int = 7
    # Seconds each pair of players has shared the floor, for chemistry drift.
    pair_seconds: dict[frozenset[str], float] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.team.id

    @property
    def score(self) -> int:
        return self.box.points

    @property
    def in_bonus(self) -> bool:
        return self.fouls_this_period >= GameRules.team_fouls_for_bonus


@dataclass
class GameState:
    """Mutable state threaded through every possession."""

    rules: GameRules
    home: TeamState
    away: TeamState

    period: int = 1
    clock: float = 0.0            # seconds remaining in the current period
    game_seconds: float = 0.0     # seconds elapsed since tip-off
    possession_count: int = 0
    sequence: int = 0
    events: list[GameEvent] = field(default_factory=list)
    finished: bool = False

    def opponent(self, team_state: TeamState) -> TeamState:
        return self.away if team_state is self.home else self.home

    def team_by_id(self, team_id: str) -> TeamState:
        return self.home if self.home.id == team_id else self.away

    @property
    def is_overtime(self) -> bool:
        return self.period > self.rules.periods

    @property
    def margin(self) -> int:
        return self.home.score - self.away.score

    def period_label(self) -> str:
        if self.period <= self.rules.periods:
            return f"Q{self.period}"
        return f"OT{self.period - self.rules.periods}"
