"""Box score accumulation."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PlayerLine:
    player_id: str
    name: str = ""
    seconds: float = 0.0
    points: int = 0
    fgm: int = 0
    fga: int = 0
    tpm: int = 0
    tpa: int = 0
    ftm: int = 0
    fta: int = 0
    offensive_rebounds: int = 0
    defensive_rebounds: int = 0
    assists: int = 0
    steals: int = 0
    blocks: int = 0
    turnovers: int = 0
    fouls: int = 0
    plus_minus: int = 0

    @property
    def rebounds(self) -> int:
        return self.offensive_rebounds + self.defensive_rebounds

    @property
    def minutes(self) -> str:
        total = int(round(self.seconds))
        return f"{total // 60}:{total % 60:02d}"

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "minutes": self.minutes,
            "seconds": round(self.seconds, 1),
            "points": self.points,
            "fgm": self.fgm,
            "fga": self.fga,
            "tpm": self.tpm,
            "tpa": self.tpa,
            "ftm": self.ftm,
            "fta": self.fta,
            "oreb": self.offensive_rebounds,
            "dreb": self.defensive_rebounds,
            "reb": self.rebounds,
            "ast": self.assists,
            "stl": self.steals,
            "blk": self.blocks,
            "tov": self.turnovers,
            "pf": self.fouls,
            "plus_minus": self.plus_minus,
        }


@dataclass
class TeamBox:
    team_id: str
    name: str = ""
    players: dict[str, PlayerLine] = field(default_factory=dict)
    points_by_period: list[int] = field(default_factory=list)
    possessions: int = 0
    team_fouls_by_period: dict[int, int] = field(default_factory=dict)
    timeouts_remaining: int = 7

    def line(self, player_id: str, name: str = "") -> PlayerLine:
        if player_id not in self.players:
            self.players[player_id] = PlayerLine(player_id=player_id, name=name)
        elif name and not self.players[player_id].name:
            self.players[player_id].name = name
        return self.players[player_id]

    def total(self, attribute: str) -> int:
        return sum(getattr(line, attribute) for line in self.players.values())

    @property
    def points(self) -> int:
        return self.total("points")

    def to_dict(self) -> dict:
        lines = sorted(self.players.values(), key=lambda l: -l.seconds)
        return {
            "team_id": self.team_id,
            "name": self.name,
            "points": self.points,
            "points_by_period": self.points_by_period,
            "possessions": self.possessions,
            "timeouts_remaining": self.timeouts_remaining,
            "totals": {
                "fgm": self.total("fgm"),
                "fga": self.total("fga"),
                "tpm": self.total("tpm"),
                "tpa": self.total("tpa"),
                "ftm": self.total("ftm"),
                "fta": self.total("fta"),
                "oreb": self.total("offensive_rebounds"),
                "dreb": self.total("defensive_rebounds"),
                "reb": self.total("offensive_rebounds") + self.total("defensive_rebounds"),
                "ast": self.total("assists"),
                "stl": self.total("steals"),
                "blk": self.total("blocks"),
                "tov": self.total("turnovers"),
                "pf": self.total("fouls"),
            },
            "players": [line.to_dict() for line in lines],
        }
