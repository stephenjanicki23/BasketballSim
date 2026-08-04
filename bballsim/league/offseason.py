"""The offseason: what happens between the last game and the first one.

A league that reaches the Keystone Finals and then sits there forever is not a
league, it is a season. This module is what turns one into the other. It runs
once, when the championship has been decided and the calendar has gone past the
summer, and it does five things in this order:

  1. **Archives** the season that just ended -- its totals, its final table,
     and who won it.
  2. **Ages** every player, through `progression.develop_season`, on the
     minutes he actually played and under the coach he actually has.
  3. **Retires** whoever the progression engine says is finished.
  4. **Replaces** them from an intake, worst club picking first.
  5. **Reschedules**: a new season label, a fresh calendar the same length as
     the one just played, and the standings and season stats cleared.

Order matters in one place particularly. The archive is taken **before** anyone
develops, because a season line belongs to the player who produced it at the age
he was, and `develop_season` is about to make him a year older and a different
player.

**What is stored and what is not.** The archive holds season *totals* -- the
same counting numbers `league.stats` accumulates -- and nothing derived. A past
season's advanced table is computed on read by the same `advanced_table` the
current one goes through. See `save.HISTORY_PATH` for why totals are stored at
all when the discipline everywhere else is to derive.

**What this is not.** There are no trades, no free agency, no contracts and no
scouting of the intake beyond what the squad page already shows. A club keeps
the players it has, loses the ones who retire, and drafts to fill the holes.
That is a smaller offseason than a manager game eventually wants, and calling it
a draft-and-develop loop rather than an offseason system is the honest name for
it.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone

from .. import health
from ..models import Player
from ..progression import build_profile, develop_season
from ..prospects import intake
from ..engine.rng import seed_from_string
from . import playoffs
from .calendar import PACIFIC, GameStatus, build_daily_schedule
from .stats import SeasonStats

# Days from the last playoff game to the next opening night. The real gap is
# about four months, and the length is doing work beyond realism: it is what
# keeps a test or a demo that jumps a clock forward a few months from rolling
# through an offseason it did not ask for.
OFFSEASON_DAYS = 120

# Fallback only. The next season is built to the same length as the one that
# just finished -- a league does not change its format over the summer, and
# hard-coding 82 meant a six-game test season rolled into a full one.
GAMES_PER_TEAM = 82


@dataclass
class SeasonArchive:
    """A season that is over.

    Totals only. Everything a screen shows about a past season -- per-game
    averages, percentages, the whole advanced table -- is derived from these on
    read, by the same code the live season goes through.
    """

    season: str
    stats: SeasonStats
    standings: list[dict] = field(default_factory=list)
    champion: str | None = None
    runner_up: str | None = None
    conference_champions: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "season": self.season,
            "champion": self.champion,
            "runnerUp": self.runner_up,
            "conferenceChampions": dict(self.conference_champions),
        }


@dataclass
class OffseasonReport:
    """What the summer did. Returned so a caller can say so, and tested on."""

    season_ended: str
    season_starting: str
    champion: str | None = None
    retired: list[dict] = field(default_factory=list)
    arrived: list[dict] = field(default_factory=list)
    developed: int = 0
    improved: int = 0
    declined: int = 0

    def to_dict(self) -> dict:
        return {
            "seasonEnded": self.season_ended,
            "seasonStarting": self.season_starting,
            "champion": self.champion,
            "retired": list(self.retired),
            "arrived": list(self.arrived),
            "developed": self.developed,
            "improved": self.improved,
            "declined": self.declined,
        }


# --------------------------------------------------------------------------
# When
# --------------------------------------------------------------------------

def next_label(season: str) -> str:
    """"2026-27" -> "2027-28"."""
    try:
        start = int(season.split("-")[0])
    except (ValueError, IndexError):
        return season
    return f"{start + 1}-{(start + 2) % 100:02d}"


def start_year(season: str) -> int:
    try:
        return int(season.split("-")[0])
    except (ValueError, IndexError):
        return 2026


def is_finished(league) -> bool:
    """Whether the season is over -- the championship decided, nothing live."""
    if playoffs.champion(league) is None:
        return False
    return all(game.status == GameStatus.FINAL for game in league.schedule)


def opens_at(league):
    """The day the next season tips off: the summer after the last game."""
    if not league.schedule:
        return None
    last = max(game.tipoff_at for game in league.schedule)
    return (last + timedelta(days=OFFSEASON_DAYS)).astimezone(PACIFIC).date()


def is_due(league) -> bool:
    """Whether the clock has reached the next opening night."""
    if not is_finished(league):
        return False
    opening = opens_at(league)
    return opening is not None and league.clock.now().astimezone(PACIFIC).date() >= opening


def play_out(league) -> None:
    """Run the current season to its champion and stop there.

    Deliberately not one big clock jump. Now that `tick` rolls the offseason,
    advancing "a couple of years" lands the league somewhere arbitrary -- 400
    days looks like one season and is two. Stepping to the end of whatever is on
    the calendar, repeatedly, stops on the championship: the postseason adds its
    fixtures as they are earned, so each pass finds a little more to play.
    """
    while not is_finished(league):
        last = max(game.tipoff_at for game in league.schedule)
        league.clock.jump_to(last + timedelta(days=1))
        league.tick()


def roll_summer(league) -> None:
    """Move the clock to opening night, which rolls the offseason on the tick."""
    opening = opens_at(league)
    if opening is None:
        return
    league.clock.jump_to(datetime.combine(opening, time(12), tzinfo=timezone.utc))
    league.tick()


# --------------------------------------------------------------------------
# The five steps
# --------------------------------------------------------------------------

def archive(league) -> SeasonArchive:
    """Freeze the finished season. Taken before anybody ages a year."""
    finals = playoffs.series_in(league, playoffs.KEYSTONE_FINALS)
    return SeasonArchive(
        season=league.season,
        stats=league.stats,
        standings=league.standings_table(),
        champion=playoffs.champion(league),
        runner_up=finals[0].loser if finals else None,
        conference_champions={
            series.conference: series.winner
            for series in playoffs.series_in(league, playoffs.CONFERENCE_FINALS)
            if series.complete and series.conference
        },
    )


def develop(league, seed: str) -> tuple[OffseasonReport, dict[str, list[Player]]]:
    """Age every player a year. Returns the report and who retired, by club.

    Minutes are the ones he actually played, not an assumption: a man who sat on
    the bench all season does not develop like a starter, and `develop_season`
    reads minutes directly. Coaching is his club's actual development rating for
    the same reason.
    """
    report = OffseasonReport(
        season_ended=league.season, season_starting=next_label(league.season),
        champion=playoffs.champion(league),
    )
    retirements: dict[str, list[Player]] = {}

    for team in league.teams.values():
        coaching = team.coach.ratings.development if team.coach else 50.0
        for player in list(team.players):
            line = league.stats.players.get(player.id)
            minutes = line.minutes if line else 0.0

            if player.career is None:
                player.career = build_profile(player)
            profile = player.career

            before = player.ability.current
            result = develop_season(
                player, profile, minutes=minutes, coach_development=coaching,
                seed=f"{seed}-{player.id}-{profile.seasons_played}",
            )
            report.developed += 1
            if result.ca_change > 0.5:
                report.improved += 1
            elif result.ca_change < -0.5:
                report.declined += 1

            if profile.retired:
                retirements.setdefault(team.id, []).append(player)
                report.retired.append({
                    "playerId": player.id,
                    "name": player.name,
                    "teamId": team.id,
                    "age": player.age,
                    "ca": round(before, 1),
                    "peakCa": round(profile.peak_ca, 1),
                    "seasons": profile.seasons_played,
                })
    return report, retirements


def draft(league, retirements: dict[str, list[Player]], report: OffseasonReport,
          seed: str) -> None:
    """Fill every hole a retirement left, worst club picking first.

    The order is the whole point of a draft: the intake is built as a ladder,
    best prospect first, and it is handed out in reverse order of the table that
    just finished. A club that lost sixty games gets the first name on the
    board.

    Positions are drawn from the vacancies themselves -- a club that lost two
    centres drafts two centres -- because a squad has to stay legal for
    `Team.starters()`, which picks the strongest *legal* five.
    """
    vacancies = sum(len(v) for v in retirements.values())
    if not vacancies:
        return

    # Reverse standings: the worst record picks first.
    order = [row["team_id"] for row in reversed(league.standings_table())
             if retirements.get(row["team_id"])]

    # Snake through the clubs with holes until every hole has a pick against it.
    left = {team_id: list(players) for team_id, players in retirements.items()}
    picks: list[tuple[str, Player]] = []
    while any(left.values()):
        for team_id in order:
            if left.get(team_id):
                picks.append((team_id, left[team_id].pop(0)))

    rng = random.Random(seed_from_string(f"{seed}-intake"))
    season = next_label(league.season)
    taken_names = {p.name for team in league.teams.values() for p in team.players}
    class_ = intake(
        rng,
        size=len(picks),
        season_start_year=start_year(season),
        positions=[departing.position for _team_id, departing in picks],
        taken_names=taken_names,
        id_prefix=f"D{start_year(season)}",
    )

    for (team_id, departing), arrival in zip(picks, class_):
        team = league.teams[team_id]
        # He takes the shirt that came free, so numbers stay unique per club.
        arrival.jersey = departing.jersey
        # And his career profile now, rather than lazily at his first summer.
        # `develop` would build one when it first ages him, which leaves a
        # freshly drafted player as the only man in the league without a prime
        # age or an arc -- and anything that reads a profile has to special-case
        # him for a year.
        arrival.career = build_profile(arrival)
        team.players = [p for p in team.players if p.id != departing.id]
        team.players.append(arrival)
        report.arrived.append({
            "playerId": arrival.id,
            "name": arrival.name,
            "teamId": team_id,
            "position": arrival.position.value,
            "age": arrival.age,
            "ca": round(arrival.ability.current, 1),
            "potential": round(arrival.ability.potential, 1),
            "replaces": departing.name,
        })


def games_per_team(league) -> int:
    """The length of the season that just finished, in games per club.

    Read off the fixtures rather than assumed, so the league keeps the format it
    has been playing. Every regular-season game involves two clubs, hence the
    two.
    """
    regular = [g for g in league.schedule if not playoffs.is_playoff(g)]
    if not regular or not league.teams:
        return GAMES_PER_TEAM
    return max(2, round(2 * len(regular) / len(league.teams)))


def reschedule(league) -> None:
    """A new season label, a fresh calendar, and everything derived cleared."""
    length = games_per_team(league)
    league.season = next_label(league.season)
    opening = opens_at(league)
    games = build_daily_schedule(
        team_ids=list(league.teams),
        start_date=opening,
        games_per_team=length,
        season=league.season,
    )
    # `restore_schedule` installs the fixtures and rebuilds the derived tables
    # from them -- which, for a schedule where nothing has been played, means
    # clearing the standings and the season totals. Going through it rather than
    # resetting them here is what keeps one definition of "derived from the
    # fixtures" instead of two that can disagree.
    league.restore_schedule(games)
    # The progression chart memoises a replay of the season keyed on games
    # played. A new season with none played would hit that cache and draw the
    # old season's line under the new season's label.
    league._advanced_series_cache = None


def roll(league, *, seed: str | None = None) -> OffseasonReport | None:
    """Run the whole offseason. Returns None if the season is not over.

    Idempotent in the sense that matters: it refuses unless the championship has
    been decided, and the first thing it does afterwards is replace the schedule
    with one that has not been played, so a second call finds an unfinished
    season and declines.
    """
    if not is_finished(league):
        return None

    seed = seed or f"offseason-{league.season}"
    league.history.append(archive(league))
    # Four months off: fatigue and knocks clear, wear mostly does not.
    health.reset_season(league.teams.values())
    report, retirements = develop(league, seed)
    draft(league, retirements, report, seed)
    reschedule(league)
    return report
