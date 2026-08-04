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

One honest limit, stated here because the front end says it too: this league
has played **one** season. So the x-axis of a progression chart is games, not
years. The shape below carries a `season` label and the chart draws one line per
season, so the day a second season exists the same code plots two -- but until
a season actually gets played, there is no second line, and inventing one is
not on the table.
"""

from __future__ import annotations

from . import playoffs
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
