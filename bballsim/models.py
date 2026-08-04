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
from .coach import Coach
from .lineup import DEFAULT_RULES, LineupRules, choose_lineup, describe
from .health import Health
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

    # What a career has accumulated: seasons served, permanent injury damage,
    # the peak he reached, and the CA he was at when the profile was built.
    # A `progression.CareerProfile`, held untyped so `models` does not have to
    # import `progression` (which imports this module).
    #
    # It has to be *stored* rather than rebuilt each offseason. Everything in it
    # that is drawn from the player's id -- prime age, arc, realisation -- would
    # rebuild identically, but `baseline_ca` would not: rebuilding it resets the
    # baseline to whatever the player is worth today, and `effective_ceiling`
    # then hands him a fresh share of the remaining gap every single year. A
    # player of poor character is supposed to stall short of his ceiling, and
    # with a resetting baseline nobody ever does.
    career: object | None = None

    # Fatigue, wear and injuries. Season-level and career-level -- the
    # counterpart to `condition` below, which is only ever about tonight.
    health: Health = field(default_factory=Health)

    # Live, per-game state. Reset by the engine at tip-off.
    #
    # `condition` starts at 100 only for a player who is carrying nothing;
    # `health.starting_condition` lowers it for one who is not, which is the
    # single place season fatigue enters a game.
    condition: float = 100.0   # 0-100 fatigue-adjusted freshness
    # Set from `health.injury`. It gates `available_players`, and therefore the
    # rotation and the starting five, so a man with a major injury cannot be
    # picked. Kept as a plain flag because that is what selection reads.
    injured: bool = False
    # Sat out tonight -- by the coach protecting him, or by the manager saying
    # so. Per-game like `condition` and not saved: it is a team sheet, not a
    # fact about the player.
    resting: bool = False

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
    coach: Coach | None = None

    # Ordered player ids. Index 0-4 is the starting five; the rest is the bench
    # rotation order. Empty means "let the engine pick by overall".
    depth_chart: list[str] = field(default_factory=list)

    # Player ids the manager has told the club to sit. Survives a save, unlike
    # `Player.resting`, because it is an instruction rather than a team sheet:
    # it holds until it is taken back.
    rested: list[str] = field(default_factory=list)

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
        return [p for p in self.players if not p.injured and not p.resting]

    def rotation(self) -> list[Player]:
        """Players in depth-chart order, injured players dropped."""
        available = self.available_players()
        if not self.depth_chart:
            return sorted(available, key=lambda p: p.overall, reverse=True)
        order = {pid: i for i, pid in enumerate(self.depth_chart)}
        return sorted(available, key=lambda p: (order.get(p.id, 999), -p.overall))

    def starters(self, rules: LineupRules = DEFAULT_RULES) -> list[Player]:
        """The strongest legal starting five.

        Not simply the top five of the depth chart: a team whose five best
        players are all bigs would otherwise start five bigs. Depth-chart
        position is the strength signal, so the manager's ordering is
        respected wherever it produces a legal shape.
        """
        rotation = self.rotation()
        by_id = {p.id: p for p in rotation}
        candidates = [
            (p.id, p.position.value, float(len(rotation) - index))
            for index, p in enumerate(rotation)
        ]
        chosen = choose_lineup(candidates, rules)
        order = {pid: i for i, pid in enumerate(p.id for p in rotation)}
        return sorted((by_id[pid] for pid in chosen), key=lambda p: order.get(p.id, 99))

    def lineup_shape(self) -> str:
        """Guards-wings-bigs, e.g. '2-1-2'."""
        return describe([p.position.value for p in self.starters()])

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
            "coach": self.coach.to_dict() if self.coach else None,
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
