"""The schedule: fixtures, tip-off times, and game status."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from enum import Enum

from ..engine.game import GameResult


class GameStatus(str, Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    FINAL = "final"
    POSTPONED = "postponed"


@dataclass
class ScheduledGame:
    """One fixture on the calendar.

    A game is simulated in full the moment its tip-off time passes, but the
    play-by-play is *revealed* progressively against the wall clock. That is
    what makes the tracker feel live while keeping the sim deterministic.
    """

    id: str
    home_team_id: str
    away_team_id: str
    tipoff_at: datetime          # UTC
    status: GameStatus = GameStatus.SCHEDULED
    season: str = ""
    round_label: str = ""

    result: GameResult | None = None
    started_at: datetime | None = None   # real time the tracker clock started
    finished_at: datetime | None = None

    @property
    def game_date(self) -> date:
        return self.tipoff_at.date()

    def revealed_seconds(self, now: datetime, speed: float) -> float:
        """How many *game* seconds the tracker should have revealed by `now`."""
        if self.started_at is None:
            return 0.0
        elapsed = (now - self.started_at).total_seconds()
        return max(0.0, elapsed * speed)

    def to_dict(self, include_result: bool = False) -> dict:
        data = {
            "id": self.id,
            "home_team_id": self.home_team_id,
            "away_team_id": self.away_team_id,
            "tipoff_at": self.tipoff_at.isoformat(),
            "status": self.status.value,
            "season": self.season,
            "round_label": self.round_label,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }
        if self.result is not None:
            data["home_score"] = self.result.home_score
            data["away_score"] = self.result.away_score
            data["periods_played"] = self.result.periods_played
            if include_result:
                data["result"] = self.result.to_dict()
        return data


DEFAULT_TIPOFF = time(hour=23, minute=0)  # 7:00pm ET expressed in UTC


def game_id(season: str, round_label: str, home_team_id: str, away_team_id: str) -> str:
    """A stable id for a fixture.

    Deliberately derived rather than random. The game id *is* the simulation
    seed, so a `uuid4()` here meant the same fixture played out differently on
    every restart -- the schedule looked identical and every game inside it was
    a different game. Deriving it from who is playing, when, keeps a saved
    season pointing at the same games it was saved with.
    """
    key = f"{season}|{round_label}|{away_team_id}@{home_team_id}"
    return hashlib.blake2b(key.encode("utf-8"), digest_size=6).hexdigest()


def build_round_robin(
    team_ids: list[str],
    start_date: date,
    times_played: int = 2,
    tipoff: time = DEFAULT_TIPOFF,
    days_between_rounds: int = 2,
    season: str = "",
) -> list[ScheduledGame]:
    """Simple circle-method round robin.

    Placeholder scheduling so the shell has games on the calendar. Swap this
    for a real schedule generator (back-to-backs, travel, TV windows) later.
    """
    if len(team_ids) < 2:
        return []

    ids = list(team_ids)
    if len(ids) % 2 == 1:
        ids.append("__bye__")

    games: list[ScheduledGame] = []
    half = len(ids) // 2
    rotating = ids[1:]
    day = start_date

    for cycle in range(times_played):
        for round_index in range(len(ids) - 1):
            order = [ids[0]] + rotating
            for i in range(half):
                home, away = order[i], order[len(order) - 1 - i]
                if "__bye__" in (home, away):
                    continue
                # Alternate home/away between cycles so nobody hosts every meeting.
                if cycle % 2 == 1:
                    home, away = away, home
                label = f"Round {cycle * (len(ids) - 1) + round_index + 1}"
                games.append(
                    ScheduledGame(
                        id=game_id(season, label, home, away),
                        home_team_id=home,
                        away_team_id=away,
                        tipoff_at=datetime.combine(day, tipoff, tzinfo=timezone.utc),
                        season=season,
                        round_label=label,
                    )
                )
            rotating = [rotating[-1]] + rotating[:-1]
            day += timedelta(days=days_between_rounds)
    return games
