"""Season statistics: per-player and per-team totals, and the per-game rates
derived from them.

Totals are what the league accumulates; per-game averages and percentages are
computed on read. Storing the rates would mean recomputing them on every game
and rounding the same number twice.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..engine.boxscore import PlayerLine, TeamBox
from ..engine.game import GameResult

# Stats the UI can sort and rank by. `key` is the field on the line object,
# `label` is the column header, `per_game` says whether it divides by games.
STAT_COLUMNS: tuple[tuple[str, str, bool], ...] = (
    ("minutes", "MIN", True),
    ("points", "PTS", True),
    ("rebounds", "REB", True),
    ("offensive_rebounds", "OREB", True),
    ("defensive_rebounds", "DREB", True),
    ("assists", "AST", True),
    ("steals", "STL", True),
    ("blocks", "BLK", True),
    ("turnovers", "TOV", True),
    ("fouls", "PF", True),
    ("fgm", "FGM", True),
    ("fga", "FGA", True),
    ("fg_pct", "FG%", False),
    ("tpm", "3PM", True),
    ("tpa", "3PA", True),
    ("tp_pct", "3P%", False),
    ("ftm", "FTM", True),
    ("fta", "FTA", True),
    ("ft_pct", "FT%", False),
)


def _rate(made: int, attempted: int) -> float:
    return made / attempted if attempted else 0.0


@dataclass
class PlayerSeasonLine:
    """One player's season. Totals in, rates out."""

    player_id: str
    name: str = ""
    team_id: str = ""
    position: str = ""
    games: int = 0
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

    COUNTING = (
        "points", "fgm", "fga", "tpm", "tpa", "ftm", "fta",
        "offensive_rebounds", "defensive_rebounds", "assists", "steals",
        "blocks", "turnovers", "fouls", "plus_minus",
    )

    def add(self, line: PlayerLine) -> None:
        if line.seconds <= 0:
            return  # did not play; a DNP is not a game played
        self.games += 1
        self.seconds += line.seconds
        for key in self.COUNTING:
            setattr(self, key, getattr(self, key) + getattr(line, key))

    # -- derived ---------------------------------------------------------
    @property
    def rebounds(self) -> int:
        return self.offensive_rebounds + self.defensive_rebounds

    @property
    def minutes(self) -> float:
        return self.seconds / 60.0

    @property
    def fg_pct(self) -> float:
        return _rate(self.fgm, self.fga)

    @property
    def tp_pct(self) -> float:
        return _rate(self.tpm, self.tpa)

    @property
    def ft_pct(self) -> float:
        return _rate(self.ftm, self.fta)

    def per_game(self, key: str) -> float:
        if not self.games:
            return 0.0
        return getattr(self, key) / self.games

    def to_dict(self) -> dict:
        data = {
            "player_id": self.player_id,
            "name": self.name,
            "team_id": self.team_id,
            "position": self.position,
            "games": self.games,
        }
        for key, _label, per_game in STAT_COLUMNS:
            value = self.per_game(key) if per_game else getattr(self, key)
            data[key] = round(value, 3)
        # Totals too, so the UI can offer a totals view without a second pass.
        data["totals"] = {
            key: getattr(self, key)
            for key in (*self.COUNTING, "rebounds")
        }
        return data


@dataclass
class TeamSeasonLine:
    """One team's season: record, scoring, and the same box categories."""

    team_id: str
    name: str = ""
    abbreviation: str = ""
    games: int = 0
    wins: int = 0
    losses: int = 0
    points: int = 0
    points_against: int = 0
    possessions: int = 0
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

    # What the opposition did against them. Half the advanced table cannot be
    # computed without it: a rebound percentage is a share of the boards that
    # were *available*, and the other side's misses are what made them
    # available. Same for block rate (opponent two-point attempts) and steal
    # rate (opponent possessions).
    opp_possessions: int = 0
    opp_fga: int = 0
    opp_tpa: int = 0
    opp_fta: int = 0
    opp_offensive_rebounds: int = 0
    opp_defensive_rebounds: int = 0
    opp_turnovers: int = 0

    def add(self, box: TeamBox, points_against: int, won: bool,
            opponent: TeamBox | None = None) -> None:
        self.games += 1
        self.wins += 1 if won else 0
        self.losses += 0 if won else 1
        self.points += box.points
        self.points_against += points_against
        self.possessions += box.possessions
        for key, source in (
            ("fgm", "fgm"), ("fga", "fga"), ("tpm", "tpm"), ("tpa", "tpa"),
            ("ftm", "ftm"), ("fta", "fta"),
            ("offensive_rebounds", "offensive_rebounds"),
            ("defensive_rebounds", "defensive_rebounds"),
            ("assists", "assists"), ("steals", "steals"), ("blocks", "blocks"),
            ("turnovers", "turnovers"), ("fouls", "fouls"),
        ):
            setattr(self, key, getattr(self, key) + box.total(source))
        if opponent is not None:
            self.opp_possessions += opponent.possessions
            self.opp_fga += opponent.total("fga")
            self.opp_tpa += opponent.total("tpa")
            self.opp_fta += opponent.total("fta")
            self.opp_offensive_rebounds += opponent.total("offensive_rebounds")
            self.opp_defensive_rebounds += opponent.total("defensive_rebounds")
            self.opp_turnovers += opponent.total("turnovers")

    @property
    def opp_rebounds(self) -> int:
        return self.opp_offensive_rebounds + self.opp_defensive_rebounds

    @property
    def rebounds(self) -> int:
        return self.offensive_rebounds + self.defensive_rebounds

    @property
    def minutes(self) -> float:
        return self.games * 240.0  # five players, forty-eight minutes

    @property
    def fg_pct(self) -> float:
        return _rate(self.fgm, self.fga)

    @property
    def tp_pct(self) -> float:
        return _rate(self.tpm, self.tpa)

    @property
    def ft_pct(self) -> float:
        return _rate(self.ftm, self.fta)

    @property
    def win_pct(self) -> float:
        return self.wins / self.games if self.games else 0.0

    def per_game(self, key: str) -> float:
        if not self.games:
            return 0.0
        return getattr(self, key) / self.games

    def to_dict(self) -> dict:
        data = {
            "team_id": self.team_id,
            "name": self.name,
            "abbreviation": self.abbreviation,
            "games": self.games,
            "wins": self.wins,
            "losses": self.losses,
            "win_pct": round(self.win_pct, 3),
            "points_against": round(self.per_game("points_against"), 3),
            "point_differential": round(
                self.per_game("points") - self.per_game("points_against"), 3
            ),
            "possessions": round(self.per_game("possessions"), 3),
        }
        for key, _label, per_game in STAT_COLUMNS:
            if key == "minutes":
                continue
            value = self.per_game(key) if per_game else getattr(self, key)
            data[key] = round(value, 3)
        return data


@dataclass
class SeasonStats:
    """Every player and team line for a season."""

    players: dict[str, PlayerSeasonLine] = field(default_factory=dict)
    teams: dict[str, TeamSeasonLine] = field(default_factory=dict)

    def player(self, player_id: str) -> PlayerSeasonLine:
        if player_id not in self.players:
            self.players[player_id] = PlayerSeasonLine(player_id=player_id)
        return self.players[player_id]

    def team(self, team_id: str) -> TeamSeasonLine:
        if team_id not in self.teams:
            self.teams[team_id] = TeamSeasonLine(team_id=team_id)
        return self.teams[team_id]

    def add_game(
        self, result: GameResult, roster: dict[str, tuple[str, str]] | None = None
    ) -> None:
        """Fold one finished game into the season.

        `roster` maps player id -> (team id, position); a box score does not
        carry either, and both are wanted for filtering and display.
        """
        roster = roster or {}
        sides = (
            (result.home_box, result.home_team_id, result.home_score,
             result.away_score, result.away_box),
            (result.away_box, result.away_team_id, result.away_score,
             result.home_score, result.home_box),
        )
        for box, team_id, scored, conceded, opponent in sides:
            team_line = self.team(team_id)
            team_line.name = box.name
            team_line.abbreviation = team_line.abbreviation or box.team_id.upper()
            team_line.add(box, conceded, won=scored > conceded, opponent=opponent)

            for line in box.players.values():
                season = self.player(line.player_id)
                season.name = line.name or season.name
                season.team_id, season.position = roster.get(
                    line.player_id, (team_id, season.position)
                )
                season.add(line)

    def player_table(self, minimum_games: int = 1) -> list[dict]:
        return [
            line.to_dict() for line in self.players.values()
            if line.games >= minimum_games
        ]

    def team_table(self) -> list[dict]:
        return [line.to_dict() for line in self.teams.values()]
