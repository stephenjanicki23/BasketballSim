"""A player's season as it happened, rather than as a total.

Two views, and both are derived from the one place everything else in this
package is derived from -- the fixture list. Nothing here is stored, nothing
is saved, and nothing new is simulated.

`game_log` reads the box scores hanging off finished games. Every FINAL fixture
carries one, including a season restored from disk (the play-by-play is dropped
on save, the box score is not), so a recent-games table works everywhere the
app does.

`advanced_series` replays the regular season a checkpoint at a time and runs the
advanced table at each one. It is deliberately **cumulative** -- each point is
the player's season *to that date*, not that night's game. A single game's win
shares are noise, and a running figure converges on exactly the number the
Advanced tab shows for the season, which is both the invariant the tests hold
and the reason the last point on the chart can be trusted.

`season_series` is the year axis: one point per season a player has played, the
finished ones out of `league.history` and the current one as it stands. It
exists because `offseason.py` now rolls the league forward, so there are real
years to plot. A past season's point is derived here and now from the totals the
archive stored -- change an advanced formula and every season on a career chart
moves with it, which is what keeps a career comparable to itself.

A player with one season gets one point, and a chart cannot draw a line through
one point. The front end says so and offers the other axis; neither end invents
the years either side.
"""

from __future__ import annotations

from . import offseason, playoffs
from .advanced import ADVANCED_COLUMNS, advanced_table
from .calendar import PACIFIC, GameStatus
from .stats import SeasonStats

# How many games a "recent games" table goes back. Long enough to read a run of
# form off, short enough that a squad payload does not carry a whole season of
# box lines for twelve players.
RECENT_GAMES = 15

# Readings taken across the season for the progression chart. Sixteen points
# draws a legible line for an 82-game season without shipping 82 of everything.
MAX_CHECKPOINTS = 16

# The box-score fields a game-log row carries, beyond the ones that need
# renaming or formatting.
#
# `plus_minus` is deliberately absent. `PlayerLine` has the field and the engine
# never fills it in -- it is zero for every player in every game ever simulated
# here. A per-game table is exactly the place someone would read a +/- column
# and believe it, so the column does not exist. Give the engine on/off tracking
# and this is a one-line change.
LOG_FIELDS = (
    "points", "assists", "steals", "blocks", "turnovers", "fouls",
    "fgm", "fga", "tpm", "tpa", "ftm", "fta",
    "offensive_rebounds", "defensive_rebounds",
)


def _played(league) -> list:
    """Finished fixtures, in the order they were played."""
    return [
        game for game in league.schedule
        if game.status == GameStatus.FINAL and game.result is not None
    ]


def _roster_lookup(league) -> dict[str, tuple[str, str]]:
    """player id -> (team id, position), for the whole league, built once.

    `SeasonStats.add_game` wants this per game; a box score carries neither
    field. Building it once and handing the same map to every game is the same
    answer for a tenth of the work.
    """
    return {
        player.id: (team.id, player.position.value)
        for team in league.teams.values()
        for player in team.players
    }


# --------------------------------------------------------------------------
# Recent games
# --------------------------------------------------------------------------

def game_log(league, team_id: str, limit: int = RECENT_GAMES) -> dict[str, list[dict]]:
    """Each of a club's players and his last few box scores, newest first.

    Only the club's own last `limit` fixtures are read: a player cannot appear
    in more games than his team played, so there is nothing further back worth
    scanning.

    Playoff games are included and labelled. A postseason box score is part of
    what a player did recently, whatever the standings do with it.
    """
    games = [
        game for game in _played(league)
        if team_id in (game.home_team_id, game.away_team_id)
    ][-limit:]

    log: dict[str, list[dict]] = {}
    for game in reversed(games):
        result = game.result
        home = game.home_team_id == team_id
        box = result.home_box if home else result.away_box
        scored = result.home_score if home else result.away_score
        conceded = result.away_score if home else result.home_score
        other = league.teams.get(game.away_team_id if home else game.home_team_id)
        day = game.tipoff_at.astimezone(PACIFIC).date()

        for line in box.players.values():
            if line.seconds <= 0:
                continue    # a DNP is not a game played
            row = {
                "gameId": game.id,
                "date": day.isoformat(),
                "label": day.strftime("%-d %b"),
                "home": home,
                "opponent": other.abbreviation if other else "",
                "result": "W" if scored > conceded else "L",
                "score": f"{scored}-{conceded}",
                "round": game.round_label if playoffs.is_playoff(game) else "",
                "minutes": line.minutes,
                "seconds": round(line.seconds, 1),
                "rebounds": line.rebounds,
            }
            for key in LOG_FIELDS:
                row[key] = getattr(line, key)
            log.setdefault(line.player_id, []).append(row)
    return log


# --------------------------------------------------------------------------
# Advanced stats across the season
# --------------------------------------------------------------------------

def checkpoints(count: int, most: int = MAX_CHECKPOINTS) -> list[int]:
    """Game numbers at which to take a reading, evenly spaced.

    The last game is always one of them. The final point on the chart has to be
    the season the Advanced tab shows, or the two screens disagree about the
    same player.
    """
    if count <= 0:
        return []
    if count <= most:
        return list(range(1, count + 1))
    step = count / most
    marks = sorted({min(count, max(1, round(step * (i + 1)))) for i in range(most)})
    if marks[-1] != count:
        marks.append(count)
    return marks


def advanced_series(league) -> dict[str, dict]:
    """Every player's advanced line at each checkpoint through the season.

    Regular season only, and for the same reason the standings are: `_record`
    keeps postseason results out of the season totals, so folding them in here
    would make the last point on the chart disagree with the table it is meant
    to end at.

    Memoised on the league by how many games have been played, because a squad
    request is not the place to replay a season from October -- and because the
    answer cannot change until another game finishes.
    """
    games = [game for game in _played(league) if not playoffs.is_playoff(game)]
    cached = getattr(league, "_advanced_series_cache", None)
    if cached is not None and cached[0] == len(games):
        return cached[1]

    keys = [key for key, _label in ADVANCED_COLUMNS]
    marks = set(checkpoints(len(games)))
    roster = _roster_lookup(league)
    stats = SeasonStats()
    series: dict[str, dict] = {}

    for number, game in enumerate(games, start=1):
        stats.add_game(game.result, roster=roster)
        if number not in marks:
            continue
        day = game.tipoff_at.astimezone(PACIFIC).date()
        for row in advanced_table(stats):
            point = {
                "games": row["games"],
                "minutes": row["minutes"],
                "date": day.isoformat(),
            }
            for key in keys:
                point[key] = round(row[key], 2)
            entry = series.setdefault(
                row["player_id"], {"season": league.season, "points": []})
            entry["points"].append(point)

    league._advanced_series_cache = (len(games), series)
    return series


def team_advanced_series(league, team_id: str) -> dict[str, dict]:
    """`advanced_series`, narrowed to one club's current roster."""
    team = league.teams.get(team_id)
    if team is None:
        return {}
    everyone = advanced_series(league)
    return {
        player.id: everyone[player.id]
        for player in team.players
        if player.id in everyone
    }


# --------------------------------------------------------------------------
# Advanced stats season by season -- the career view
# --------------------------------------------------------------------------

def season_series(league) -> dict[str, list[dict]]:
    """Every player's advanced line for each season he has played.

    One point per season: the completed ones out of `league.history`, then the
    current one as it stands. This is the year axis, and it exists because the
    league now plays more than one year -- before the offseason loop it would
    have been a single point, and drawing a career across seasons that were
    never simulated is the thing this codebase does not do.

    A past season is *derived on read*, exactly like the live one. The archive
    stores the season totals those games produced and nothing else; the advanced
    table for 2027-28 is computed here, now, by the same `advanced_table` the
    current season goes through. Change a formula and every season on the chart
    changes with it, which is the property that keeps a career comparable to
    itself.
    """
    cached = getattr(league, "_season_series_cache", None)
    signature = (len(league.history), len(_played(league)), league.season)
    if cached is not None and cached[0] == signature:
        return cached[1]

    keys = [key for key, _label in ADVANCED_COLUMNS]
    series: dict[str, list[dict]] = {}

    def fold(season: str, stats, complete: bool) -> None:
        for row in advanced_table(stats):
            point = {
                "season": season,
                "complete": complete,
                "games": row["games"],
                "minutes": row["minutes"],
            }
            for key in keys:
                point[key] = round(row[key], 2)
            series.setdefault(row["player_id"], []).append(point)

    for past in league.history:
        fold(past.season, past.stats, True)
    # The season being played is complete once somebody has won it, archived or
    # not -- the archive happens in the summer, months after the last game. A
    # page that called a decided championship "in progress" until the offseason
    # rolled would be wrong for exactly as long as the wait.
    fold(league.season, league.stats, offseason.is_finished(league))

    league._season_series_cache = (signature, series)
    return series


def team_season_series(league, team_id: str) -> dict[str, list[dict]]:
    """`season_series`, narrowed to one club's current roster.

    A player who has only ever played this season gets one point, and the chart
    declines to draw a line through a single point rather than inventing the
    years either side of it.
    """
    team = league.teams.get(team_id)
    if team is None:
        return {}
    everyone = season_series(league)
    return {
        player.id: everyone[player.id]
        for player in team.players
        if everyone.get(player.id)
    }


def seasons(league) -> list[dict]:
    """Every season the league has played, oldest first, with who won it.

    The last row is the season being played, and it carries a champion as soon
    as the Keystone Finals is decided rather than waiting for the summer to
    archive it -- the roll of honour should name a winner the day he wins.
    """
    rows = [past.to_dict() | {"complete": True} for past in league.history]
    current = offseason.archive(league) if offseason.is_finished(league) else None
    rows.append({
        "season": league.season,
        "champion": current.champion if current else None,
        "runnerUp": current.runner_up if current else None,
        "conferenceChampions": current.conference_champions if current else {},
        "complete": current is not None,
    })
    return rows
