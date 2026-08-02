"""Core domain objects: players, teams, rosters, lineups.

No real players or teams are defined anywhere in this package -- these are the
containers those will be loaded into later.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .ratings import Ratings, Tendencies, overall
from .tactics import Tactics


class Position(str, Enum):
    PG = "PG"
    SG = "SG"
    SF = "SF"
    PF = "PF"
    C = "C"

    @property
    def is_guard(self) -> bool:
        return self in (Position.PG, Position.SG)

    @property
    def is_big(self) -> bool:
        return self in (Position.PF, Position.C)


@dataclass
class Player:
    id: str
    first_name: str
    last_name: str
    position: Position = Position.SF
    secondary_position: Position | None = None
    age: int = 25
    height_inches: int = 78
    weight_lbs: int = 215
    jersey: int = 0

    ratings: Ratings = field(default_factory=Ratings)
    tendencies: Tendencies = field(default_factory=Tendencies)

    # Live, per-game state. Reset by the engine at tip-off.
    condition: float = 100.0   # 0-100 fatigue-adjusted freshness
    injured: bool = False

    @property
    def name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def short_name(self) -> str:
        initial = f"{self.first_name[:1]}. " if self.first_name else ""
        return f"{initial}{self.last_name}"

    @property
    def overall(self) -> float:
        return overall(self.ratings)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "short_name": self.short_name,
            "position": self.position.value,
            "age": self.age,
            "jersey": self.jersey,
            "overall": self.overall,
            "condition": round(self.condition, 1),
            "injured": self.injured,
            "ratings": self.ratings.to_dict(),
            "tendencies": self.tendencies.to_dict(),
        }


@dataclass
class Team:
    id: str
    name: str
    abbreviation: str
    city: str = ""
    conference: str = ""
    division: str = ""
    players: list[Player] = field(default_factory=list)
    tactics: Tactics = field(default_factory=Tactics)

    # Ordered player ids. Index 0-4 is the starting five; the rest is the bench
    # rotation order. Empty means "let the engine pick by overall".
    depth_chart: list[str] = field(default_factory=list)

    # Pairwise chemistry, keyed by frozenset of two player ids -> -100..100.
    # Populated by bballsim.chemistry; stored on the team so it persists.
    pair_chemistry: dict[frozenset[str], float] = field(default_factory=dict)
    team_chemistry: float = 50.0

    @property
    def full_name(self) -> str:
        return f"{self.city} {self.name}".strip()

    def player(self, player_id: str) -> Player | None:
        return next((p for p in self.players if p.id == player_id), None)

    def available_players(self) -> list[Player]:
        return [p for p in self.players if not p.injured]

    def rotation(self) -> list[Player]:
        """Players in depth-chart order, injured players dropped."""
        available = self.available_players()
        if not self.depth_chart:
            return sorted(available, key=lambda p: p.overall, reverse=True)
        order = {pid: i for i, pid in enumerate(self.depth_chart)}
        return sorted(available, key=lambda p: (order.get(p.id, 999), -p.overall))

    def starters(self) -> list[Player]:
        return self.rotation()[:5]

    def to_dict(self, include_players: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "abbreviation": self.abbreviation,
            "city": self.city,
            "full_name": self.full_name,
            "conference": self.conference,
            "division": self.division,
            "team_chemistry": self.team_chemistry,
            "tactics": self.tactics.to_dict(),
        }
        if include_players:
            data["players"] = [p.to_dict() for p in self.players]
        return data


@dataclass
class Lineup:
    """Five players on the floor for one team."""

    players: list[Player]

    def __post_init__(self) -> None:
        if len(self.players) != 5:
            raise ValueError(f"a lineup needs exactly 5 players, got {len(self.players)}")

    def __iter__(self):
        return iter(self.players)

    def ids(self) -> list[str]:
        return [p.id for p in self.players]

    def average(self, attribute: str) -> float:
        return sum(getattr(p.ratings, attribute) for p in self.players) / 5.0

    def best(self, attribute: str) -> Player:
        return max(self.players, key=lambda p: getattr(p.ratings, attribute))

    def guards(self) -> list[Player]:
        return [p for p in self.players if p.position.is_guard]

    def bigs(self) -> list[Player]:
        return [p for p in self.players if p.position.is_big]
