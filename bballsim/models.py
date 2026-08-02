"""Core domain objects: players, teams, rosters, lineups.

No real players or teams are defined anywhere in this package -- these are the
containers those will be loaded into later.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .ability import (
    Ability,
    Archetype,
    ca_tier,
    ca_to_scale,
    current_ability,
    star_tier,
    stars,
)
from .biography import Biography
from .ratings import HiddenAttributes, Ratings, Tendencies, personality_label
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
    hidden: HiddenAttributes = field(default_factory=HiddenAttributes)

    # Hidden CA/PA on the 0-200 scale. CA is the budget the attributes above
    # were generated from; the invariant CA <= PA is enforced by Ability.
    ability: Ability = field(default_factory=Ability)
    archetype: Archetype | None = None
    bio: Biography = field(default_factory=Biography)

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
    def current_ability(self) -> float:
        """CA recomputed from the attributes, 0-200.

        Generation solves for attributes that hit a target CA, so this agrees
        with `ability.current`. It recomputes rather than reads so that hand-
        edited attributes cannot silently disagree with the stored number.
        """
        return current_ability(self.ratings, self.position.value)

    @property
    def overall(self) -> float:
        """The 1-20 face of Current Ability, for display and depth charts."""
        return round(ca_to_scale(self.current_ability), 1)

    @property
    def tier(self) -> str:
        return ca_tier(self.current_ability)

    @property
    def stars(self) -> float:
        """Current ability as 0.5-5.0 stars, in half-star steps.

        This is the headline number a manager sees instead of a raw rating --
        the ten CA tiers map exactly onto the ten half-star steps.
        """
        return stars(self.current_ability)

    @property
    def potential_stars(self) -> float:
        """What he could become. Never below his current stars, since PA >= CA."""
        return stars(self.ability.potential)

    @property
    def height(self) -> str:
        return f"{self.height_inches // 12}'{self.height_inches % 12}\""

    @property
    def personality(self) -> str:
        """Derived FM-style label rather than a stored number."""
        return personality_label(self.ratings, self.hidden)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "short_name": self.short_name,
            "position": self.position.value,
            "age": self.age,
            "jersey": self.jersey,
            "overall": self.overall,
            "stars": self.stars,
            "star_tier": star_tier(self.stars),
            "height_inches": self.height_inches,
            "height": self.height,
            "weight_lbs": self.weight_lbs,
            "bio": self.bio.to_dict(),
            "condition": round(self.condition, 1),
            "injured": self.injured,
            "personality": self.personality,
            "tier": self.tier,
            "archetype": self.archetype.label if self.archetype else None,
            "ratings": self.ratings.to_dict(),
            "tendencies": self.tendencies.to_dict(),
        }

    def scouted_dict(self) -> dict:
        """Everything above plus the hidden attributes -- for tooling and tests,
        never for the roster UI."""
        data = self.to_dict()
        data["hidden"] = self.hidden.to_dict()
        data["ability"] = self.ability.to_dict()
        data["ability"]["recomputed_current"] = round(self.current_ability, 1)
        data["potential_stars"] = self.potential_stars
        return data


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
