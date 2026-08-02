"""The schedule: fixtures, tip-off times, and game status."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from enum import Enum
from zoneinfo import ZoneInfo

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

# The league plays on real days, at real times: three slates a day, 8am, 1pm
# and 7pm Pacific.
#
# Stored as local Pacific times rather than fixed UTC offsets on purpose.
# Pacific is UTC-7 half the year and UTC-8 the other half, so a hard-coded
# offset would silently move every tip-off by an hour when the clocks change.
# `zoneinfo` is standard library, so this costs no dependency.
PACIFIC = ZoneInfo("America/Los_Angeles")
DAILY_TIPOFFS: tuple[time, ...] = (
    time(hour=8, minute=0),
    time(hour=13, minute=0),
    time(hour=19, minute=0),
)


def slot_label(when: time) -> str:
    hour = when.hour % 12 or 12
    suffix = "AM" if when.hour < 12 else "PM"
    return f"{hour}:{when.minute:02d} {suffix} PT"


def _circle_rounds(team_ids: list[str]) -> list[list[tuple[str, str]]]:
    """Split the league into rounds where every team plays exactly once.

    The circle method: one team is pinned and the rest rotate around it. With
    30 teams that gives 29 rounds, and every team appears in every round --
    which is what makes "every team plays three games a day" schedulable at
    all. Each round becomes one slate.
    """
    ids: list[str | None] = list(team_ids)
    if len(ids) % 2 == 1:
        ids.append(None)  # a bye, so an odd league still pairs up

    half = len(ids) // 2
    fixed, rotating = ids[0], ids[1:]
    rounds: list[list[tuple[str, str]]] = []

    for _ in range(len(ids) - 1):
        order = [fixed] + rotating
        pairs = []
        for i in range(half):
            a, b = order[i], order[len(order) - 1 - i]
            if a is not None and b is not None:
                pairs.append((a, b))
        rounds.append(pairs)
        rotating = [rotating[-1]] + rotating[:-1]
    return rounds


def _pack_days(rounds: int, slots: int) -> list[int]:
    """How many slates each day carries.

    As many full days as possible, and the remainder spread over *two-game*
    days rather than left as a one-game day: 82 rounds is 26 days of three
    plus 2 days of two, not 27 days of three plus a day with a single game.
    """
    if rounds <= 0:
        return []
    if slots < 2:
        return [slots] * rounds

    full, remainder = divmod(rounds, slots)
    if remainder == 0:
        return [slots] * full
    if remainder == 1:
        # Borrow a slate from the last full day so the tail is 2 + 2 rather
        # than a lone game.
        return [slots] * (full - 1) + [slots - 1, slots - 1] if full else [1]
    return [slots] * full + [remainder]


def build_daily_schedule(
    team_ids: list[str],
    start_date: date,
    games_per_team: int = 82,
    tipoffs: tuple[time, ...] = DAILY_TIPOFFS,
    tz: ZoneInfo = PACIFIC,
    season: str = "",
) -> list[ScheduledGame]:
    """An 82-game season played on real days at real times.

    Every team plays once per slate, so a three-slate day is three games for
    everybody -- 45 games a day across 30 teams. 82 games works out at 26 days
    of three plus 2 days of two: 28 days, 1,230 games.

    Home and away are assigned by whichever side has hosted less, which keeps
    every team at 41 and 41 without hand-tuning the fixture list. Teams meet
    two or three times each: 82 slates is a little under three passes through
    the 29-round cycle.
    """
    if len(team_ids) < 2:
        return []

    rounds = _circle_rounds(list(team_ids))
    if not rounds:
        return []

    # Pair everything up first, then settle home and away across the whole
    # season, then build the fixtures -- a fixture's id is derived from who is
    # hosting, so the sides have to be final before any id is minted.
    day_sizes = _pack_days(games_per_team, len(tipoffs))
    slots: list[tuple[int, int, str, str]] = []  # day, slot, team a, team b
    slate = 0
    for day_index, slates_today in enumerate(day_sizes):
        for slot_index in range(slates_today):
            for a, b in rounds[slate % len(rounds)]:
                slots.append((day_index, slot_index, a, b))
            slate += 1

    sides = _assign_home_and_away(slots, team_ids, games_per_team)

    games: list[ScheduledGame] = []
    for (day_index, slot_index, _a, _b), (home, away) in zip(slots, sides):
        day = start_date + timedelta(days=day_index)
        when = tipoffs[slot_index]
        # A local wall-clock time in Pacific, converted to the UTC the rest of
        # the system runs on. Handles the clocks changing mid-season.
        tipoff_at = datetime.combine(day, when, tzinfo=tz).astimezone(timezone.utc)
        label = f"Day {day_index + 1} · {slot_label(when)}"
        games.append(
            ScheduledGame(
                id=game_id(season, label, home, away),
                home_team_id=home,
                away_team_id=away,
                tipoff_at=tipoff_at,
                season=season,
                round_label=label,
            )
        )
    return games


def _assign_home_and_away(
    slots: list[tuple[int, int, str, str]],
    team_ids: list[str],
    games_per_team: int,
) -> list[tuple[str, str]]:
    """Decide who hosts each fixture, so everybody hosts the same number.

    Greedily handing home to whoever has hosted less gets close but not exact
    -- it leaves teams a game either side of 41, because the choice is local
    and the constraint is seasonal. So the greedy pass is followed by a repair
    pass that flips a fixture between an over-hosting home side and an
    under-hosting away side, which is always available while any imbalance
    exists and cannot loop, since each flip strictly reduces the total error.
    """
    hosted: dict[str, int] = {team_id: 0 for team_id in team_ids}
    sides: list[tuple[str, str]] = []
    for _day, _slot, a, b in slots:
        if (hosted[a], a) <= (hosted[b], b):
            home, away = a, b
        else:
            home, away = b, a
        hosted[home] += 1
        sides.append((home, away))

    target = games_per_team // 2
    if games_per_team % 2:
        return sides  # an odd schedule cannot split evenly; leave it be

    while True:
        over = [t for t, n in hosted.items() if n > target]
        under = {t for t, n in hosted.items() if n < target}
        if not over or not under:
            return sides

        path = _rehost_path(sides, over[0], under)
        if path is None:
            # Nothing left that can be rebalanced without breaking something
            # else. The schedule is still playable; a test asserts the split is
            # exact, so this would be caught rather than shipped quietly.
            return sides

        # Flip every fixture along the path. The teams in the middle give up a
        # home game and gain one, so only the two ends actually move.
        for index in path:
            home, away = sides[index]
            sides[index] = (away, home)
        hosted[over[0]] -= 1
        hosted[sides[path[-1]][0]] += 1


def _rehost_path(
    sides: list[tuple[str, str]], start: str, targets: set[str]
) -> list[int] | None:
    """Fixtures to flip to move one home game from `start` to any of `targets`.

    A direct fixture between the two is not always on the calendar -- with 30
    teams and 82 games it usually is not -- so this walks: flipping A's home
    game against B moves the surplus to B, and the search repeats from there
    until it reaches a team that is hosting too few.
    """
    hosts: dict[str, list[int]] = {}
    for index, (home, _away) in enumerate(sides):
        hosts.setdefault(home, []).append(index)

    queue = [start]
    came_from: dict[str, tuple[str, int]] = {}
    seen = {start}

    while queue:
        team = queue.pop(0)
        for index in hosts.get(team, ()):
            away = sides[index][1]
            if away in seen:
                continue
            came_from[away] = (team, index)
            if away in targets:
                # Walk back to the start, collecting the fixtures to flip.
                path = []
                node = away
                while node != start:
                    previous, fixture = came_from[node]
                    path.append(fixture)
                    node = previous
                path.reverse()
                return path
            seen.add(away)
            queue.append(away)
    return None


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
