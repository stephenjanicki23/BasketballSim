"""Saving and loading, so the league you have is the league you keep.

Two files, both under `data/`:

    league.json   who is in the league -- teams, players, coaches
    season.json   what has happened -- the fixture list, and results

The rest of this module note is about the first; the second is documented at
the section that builds it, further down.


A generated league is reproducible but not *stable*. `make_teams(30)` returns
the same 360 players every run only for as long as the generator is untouched:
change an archetype weight, reorder an attribute, adjust a CA target, and every
player in the league is a different person. That is fine while the generator is
being built and useless once you want to manage a club.

So the league gets written to a file, and the file becomes the truth. From then
on nothing in `placeholder.py` can move a single rating.

**This is not `to_dict()`.** The `to_dict` methods elsewhere are display views
for the API and the demo page: they round, they add derived fields (`stars`,
`tier`, `label`), they flatten a name into one string, and none of them can be
read back. A save has the opposite job -- carry every stored value exactly and
nothing derived -- so it is written here, separately and on purpose. Anything
computed (stars, tiers, personality, composites, current_ability) is left out
and recomputed on load, which means a saved league cannot drift out of step
with its own derived numbers.

Floats are rounded once on the way out (see `PRECISION`); after that, reading
the file and writing it back is byte-identical, and `tests/test_save.py` proves
the round-trip attribute by attribute rather than by spot check.

    python3 tools/make_league.py            # generate and write data/league.json
    python3 tools/make_league.py --show     # what is in the file now
    python3 tools/make_season.py            # build the fixture list
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from .ability import Ability, Archetype
from .biography import Biography, DraftInfo
from .coach import Coach, CoachRatings
from .engine.boxscore import PlayerLine, TeamBox
from .engine.game import GameResult
from .league.calendar import GameStatus, ScheduledGame
from .models import Player, Position, Team
from .ratings import HiddenAttributes, Ratings, Tendencies
from .tactics import Tactics

# Bumped when the shape of the file changes. Loading a file from a newer
# version than this code understands is an error rather than a guess.
SAVE_VERSION = 1

# The copies committed to the repository, so a fresh clone gets the same 30
# teams as everybody else. In a deployment these are the *seed*: read-only,
# baked into the image, and copied once into the writable data directory.
BUNDLED_DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def data_dir() -> Path:
    """Where saves are read and written.

    `BBALLSIM_DATA_DIR` points this at a mounted disk in a deployment, where
    the repository checkout is replaced on every deploy and anything written
    beside it would be lost. Locally it is just `data/`.
    """
    override = os.environ.get("BBALLSIM_DATA_DIR")
    return Path(override) if override else BUNDLED_DATA_DIR


# Resolved once at import: the environment is set before the process starts.
LEAGUE_PATH = data_dir() / "league.json"

# The season alongside it: the fixture list, and the results of whatever has
# been played. Standings and season stats are absent on purpose -- they are
# derived from these results on load.
SEASON_PATH = data_dir() / "season.json"


def seed_data_dir(target: Path | None = None) -> list[Path]:
    """Copy the bundled league and season into the data directory, once.

    A mounted disk starts empty, so first boot has nothing to load. Existing
    files are never overwritten -- a deploy must not wipe the season somebody
    has been playing. Returns the files actually copied.
    """
    target = Path(target) if target else data_dir()
    if target.resolve() == BUNDLED_DATA_DIR.resolve():
        return []

    target.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ("league.json", "season.json"):
        source = BUNDLED_DATA_DIR / name
        destination = target / name
        if source.is_file() and not destination.exists():
            shutil.copyfile(source, destination)
            copied.append(destination)
    return copied

# Decimal places kept for every stored float. A ten-thousandth of a point on a
# 1-20 attribute is far below anything the engine can act on, and writing the
# full binary expansion of every rating adds half a megabyte of noise to the
# file and to its diffs. Rounding happens once, on the way out; from then on
# the file is the league, and reading and re-writing it is byte-identical.
PRECISION = 4


def _round(value):
    """Round every float in a nested structure. Ints and bools pass through."""
    if isinstance(value, float):
        return round(value, PRECISION)
    if isinstance(value, dict):
        return {k: _round(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_round(v) for v in value]
    return value


# --------------------------------------------------------------------------
# Players
# --------------------------------------------------------------------------

def dump_player(player: Player) -> dict:
    return {
        "id": player.id,
        "first_name": player.first_name,
        "last_name": player.last_name,
        "position": player.position.value,
        "secondary_position": (
            player.secondary_position.value if player.secondary_position else None
        ),
        "age": player.age,
        "height_inches": player.height_inches,
        "weight_lbs": player.weight_lbs,
        "jersey": player.jersey,
        "archetype": player.archetype.value if player.archetype else None,
        # Full precision, not Ability.to_dict() -- that view rounds to one
        # decimal and adds a tier label, and a rounded CA reloads as a slightly
        # different player.
        "ability": {"current": player.ability.current, "potential": player.ability.potential},
        "ratings": player.ratings.to_dict(),
        "tendencies": player.tendencies.to_dict(),
        "hidden": player.hidden.to_dict(),
        "bio": dump_biography(player.bio),
        # Roster state worth keeping. `condition` is not saved: it is per-game
        # fatigue and the engine sets every player to 100 at tip-off.
        "injured": player.injured,
    }


def load_player(data: dict) -> Player:
    secondary = data.get("secondary_position")
    archetype = data.get("archetype")
    return Player(
        id=data["id"],
        first_name=data.get("first_name", ""),
        last_name=data.get("last_name", ""),
        position=Position(data.get("position", "SF")),
        secondary_position=Position(secondary) if secondary else None,
        age=data.get("age", 25),
        height_inches=data.get("height_inches", 78),
        weight_lbs=data.get("weight_lbs", 215),
        jersey=data.get("jersey", 0),
        archetype=Archetype(archetype) if archetype else None,
        ability=Ability.from_dict(data.get("ability", {})),
        ratings=Ratings.from_dict(data.get("ratings", {})),
        tendencies=Tendencies.from_dict(data.get("tendencies", {})),
        hidden=HiddenAttributes.from_dict(data.get("hidden", {})),
        bio=load_biography(data.get("bio") or {}),
        injured=data.get("injured", False),
    )


def dump_biography(bio: Biography) -> dict:
    return {
        "nationality": bio.nationality,
        "background": bio.background,
        "background_type": bio.background_type,
        # Only the three stored fields; `undrafted` and `label` are derived.
        "draft": (
            {"year": bio.draft.year, "round": bio.draft.round, "pick": bio.draft.pick}
            if bio.draft else None
        ),
    }


def load_biography(data: dict) -> Biography:
    return Biography(
        nationality=data.get("nationality", "United States"),
        background=data.get("background", ""),
        background_type=data.get("background_type", "College"),
        draft=DraftInfo.from_dict(data["draft"]) if data.get("draft") else None,
    )


# --------------------------------------------------------------------------
# Coaches
# --------------------------------------------------------------------------

def dump_coach(coach: Coach) -> dict:
    return {
        "id": coach.id,
        "first_name": coach.first_name,
        "last_name": coach.last_name,
        "age": coach.age,
        "nationality": coach.nationality,
        "seasons_coached": coach.seasons_coached,
        # Coach.to_dict() rounds and carries tier/specialism; those are derived.
        "ratings": {
            key: getattr(coach.ratings, key) for key in CoachRatings.attribute_names()
        },
    }


def load_coach(data: dict) -> Coach:
    return Coach(
        id=data["id"],
        first_name=data.get("first_name", ""),
        last_name=data.get("last_name", ""),
        age=data.get("age", 50),
        nationality=data.get("nationality", "United States"),
        seasons_coached=data.get("seasons_coached", 0),
        ratings=CoachRatings.from_dict(data.get("ratings", {})),
    )


# --------------------------------------------------------------------------
# Teams
# --------------------------------------------------------------------------

def dump_team(team: Team) -> dict:
    return {
        "id": team.id,
        "name": team.name,
        "abbreviation": team.abbreviation,
        "city": team.city,
        "conference": team.conference,
        "division": team.division,
        "tactics": team.tactics.to_dict(),
        "coach": dump_coach(team.coach) if team.coach else None,
        "depth_chart": list(team.depth_chart),
        "team_chemistry": team.team_chemistry,
        # JSON has no set keys, so each pair becomes a triple. The ids are
        # sorted so the same league always serialises byte-identically.
        "pair_chemistry": sorted(
            [sorted(pair)[0], sorted(pair)[1], value]
            for pair, value in team.pair_chemistry.items()
        ),
        "players": [dump_player(p) for p in team.players],
    }


def load_team(data: dict) -> Team:
    return Team(
        id=data["id"],
        name=data["name"],
        abbreviation=data["abbreviation"],
        city=data.get("city", ""),
        conference=data.get("conference", ""),
        division=data.get("division", ""),
        tactics=Tactics.from_dict(data.get("tactics", {})),
        coach=load_coach(data["coach"]) if data.get("coach") else None,
        depth_chart=list(data.get("depth_chart", [])),
        team_chemistry=data.get("team_chemistry", 50.0),
        pair_chemistry={
            frozenset((a, b)): value for a, b, value in data.get("pair_chemistry", [])
        },
        players=[load_player(p) for p in data.get("players", [])],
    )


# --------------------------------------------------------------------------
# The league as a whole
# --------------------------------------------------------------------------

@dataclass
class SavedLeague:
    """A league as it came off disk: the name, the season, and the teams."""

    name: str
    season: str
    teams: list[Team]

    @property
    def players(self) -> list[Player]:
        return [p for team in self.teams for p in team.players]


def dump_league(teams: list[Team], *, name: str, season: str) -> dict:
    return {
        "version": SAVE_VERSION,
        "name": name,
        "season": season,
        "teams": [dump_team(t) for t in teams],
    }


def load_league(data: dict) -> SavedLeague:
    version = data.get("version", 0)
    if version > SAVE_VERSION:
        raise ValueError(
            f"league file is version {version}, this build understands {SAVE_VERSION}"
        )
    return SavedLeague(
        name=data.get("name", "Basketball League"),
        season=data.get("season", "2026-27"),
        teams=[load_team(t) for t in data.get("teams", [])],
    )


def write_league(path: Path, teams: list[Team], *, name: str, season: str) -> Path:
    """Write the league to `path`. Stable ordering, so re-saving an unchanged
    league produces an identical file and a diff means something really moved."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _round(dump_league(teams, name=name, season=season))
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n")
    return path


def read_league(path: Path = LEAGUE_PATH) -> SavedLeague:
    return load_league(json.loads(Path(path).read_text()))


def league_exists(path: Path = LEAGUE_PATH) -> bool:
    return Path(path).is_file()


def fingerprint(teams: list[Team]) -> str:
    """A short digest of everything stored about a league.

    Two leagues with the same fingerprint are the same league down to the last
    decimal place. `tests/test_save.py` pins the committed file's fingerprint,
    so a change to the generator that would have silently replaced all 360
    players fails a test instead.
    """
    blob = json.dumps(
        _round([dump_team(t) for t in teams]), sort_keys=True, separators=(",", ":")
    )
    return hashlib.blake2b(blob.encode("utf-8"), digest_size=8).hexdigest()


# --------------------------------------------------------------------------
# The season: fixtures and results.
#
# What is stored here is deliberately narrow.
#
#   Stored      the fixture list, and for each finished game its final score,
#               line score and full box score.
#   Derived     standings and season stats. Both are folded out of the results
#               on load by `League.restore_schedule`, so a restored table can
#               never disagree with the games behind it.
#   Dropped     the play-by-play. A 435-game season is ~330,000 events and
#               about 90MB of JSON, which is not a thing to write on every
#               save. A game restored from disk keeps its box score and its
#               result; it does not keep its commentary.
#   Dropped     pair minutes. They exist only to drift chemistry when a game
#               finalises, which has already happened -- and the chemistry it
#               produced is saved with the roster.
# --------------------------------------------------------------------------

# Box score fields worth storing. `rebounds` and `minutes` are derived from
# these and are left out, the same as everywhere else in this file.
_PLAYER_LINE_FIELDS = (
    "seconds", "points", "fgm", "fga", "tpm", "tpa", "ftm", "fta",
    "offensive_rebounds", "defensive_rebounds", "assists", "steals",
    "blocks", "turnovers", "fouls", "plus_minus",
)


def dump_player_line(line: PlayerLine) -> dict:
    data = {"player_id": line.player_id, "name": line.name}
    data.update({key: getattr(line, key) for key in _PLAYER_LINE_FIELDS})
    return data


def load_player_line(data: dict) -> PlayerLine:
    return PlayerLine(
        player_id=data["player_id"],
        name=data.get("name", ""),
        **{key: data.get(key, 0) for key in _PLAYER_LINE_FIELDS},
    )


def dump_box(box: TeamBox) -> dict:
    return {
        "team_id": box.team_id,
        "name": box.name,
        "possessions": box.possessions,
        "points_by_period": list(box.points_by_period),
        # JSON object keys are strings; periods are ints.
        "team_fouls_by_period": {str(k): v for k, v in box.team_fouls_by_period.items()},
        "timeouts_remaining": box.timeouts_remaining,
        "players": [dump_player_line(l) for l in box.players.values()],
    }


def load_box(data: dict) -> TeamBox:
    box = TeamBox(
        team_id=data["team_id"],
        name=data.get("name", ""),
        possessions=data.get("possessions", 0),
        points_by_period=list(data.get("points_by_period", [])),
        team_fouls_by_period={
            int(k): v for k, v in (data.get("team_fouls_by_period") or {}).items()
        },
        timeouts_remaining=data.get("timeouts_remaining", 7),
    )
    box.players = {
        line["player_id"]: load_player_line(line) for line in data.get("players", [])
    }
    return box


def dump_result(result: GameResult) -> dict:
    return {
        "seed": result.seed,
        "home_score": result.home_score,
        "away_score": result.away_score,
        "periods_played": result.periods_played,
        "duration_game_seconds": result.duration_game_seconds,
        "home_box": dump_box(result.home_box),
        "away_box": dump_box(result.away_box),
    }


def load_result(data: dict, game: dict) -> GameResult:
    return GameResult(
        game_id=game["id"],
        seed=data.get("seed", 0),
        home_team_id=game["home_team_id"],
        away_team_id=game["away_team_id"],
        home_score=data["home_score"],
        away_score=data["away_score"],
        periods_played=data.get("periods_played", 4),
        # Not stored; see the note at the top of this section.
        events=[],
        home_box=load_box(data["home_box"]),
        away_box=load_box(data["away_box"]),
        duration_game_seconds=data.get("duration_game_seconds", 0.0),
    )


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment else None


def _moment(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text) if text else None


def dump_game(game: ScheduledGame) -> dict:
    data = {
        "id": game.id,
        "home_team_id": game.home_team_id,
        "away_team_id": game.away_team_id,
        "tipoff_at": game.tipoff_at.isoformat(),
        "status": game.status.value,
        "season": game.season,
        "round_label": game.round_label,
        "started_at": _iso(game.started_at),
        "finished_at": _iso(game.finished_at),
    }
    if game.result is not None and game.status == GameStatus.FINAL:
        data["result"] = dump_result(game.result)
    return data


def load_game(data: dict) -> ScheduledGame:
    game = ScheduledGame(
        id=data["id"],
        home_team_id=data["home_team_id"],
        away_team_id=data["away_team_id"],
        tipoff_at=datetime.fromisoformat(data["tipoff_at"]),
        status=GameStatus(data.get("status", "scheduled")),
        season=data.get("season", ""),
        round_label=data.get("round_label", ""),
        started_at=_moment(data.get("started_at")),
        finished_at=_moment(data.get("finished_at")),
    )
    if data.get("result"):
        game.result = load_result(data["result"], data)
    return game


@dataclass
class SavedSeason:
    """A season as it came off disk."""

    name: str
    season: str
    games: list[ScheduledGame]
    clock_offset_seconds: float = 0.0
    tracker_speed: float = 20.0

    @property
    def played(self) -> int:
        return sum(1 for g in self.games if g.status == GameStatus.FINAL)


def dump_season(
    games: list[ScheduledGame],
    *,
    name: str,
    season: str,
    clock_offset_seconds: float = 0.0,
    tracker_speed: float = 20.0,
) -> dict:
    return {
        "version": SAVE_VERSION,
        "name": name,
        "season": season,
        # The sim clock's offset from real time, so reopening the app puts you
        # back on the date you left rather than at whatever today is.
        "clock_offset_seconds": clock_offset_seconds,
        "tracker_speed": tracker_speed,
        "games": [dump_game(g) for g in games],
    }


def load_season(data: dict) -> SavedSeason:
    version = data.get("version", 0)
    if version > SAVE_VERSION:
        raise ValueError(
            f"season file is version {version}, this build understands {SAVE_VERSION}"
        )
    return SavedSeason(
        name=data.get("name", "Basketball League"),
        season=data.get("season", "2026-27"),
        games=[load_game(g) for g in data.get("games", [])],
        clock_offset_seconds=data.get("clock_offset_seconds", 0.0),
        tracker_speed=data.get("tracker_speed", 20.0),
    )


def write_season(path: Path, league, *, indent: int | None = 1) -> Path:
    """Write a league's schedule and results to `path`.

    Takes the League rather than a game list so the clock offset and tracker
    speed travel with it -- reopening the app should put you back on the date
    you left.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _round(dump_season(
        league.schedule,
        name=league.name,
        season=league.season,
        clock_offset_seconds=league.clock.offset.total_seconds(),
        tracker_speed=league.tracker_speed,
    ))
    path.write_text(json.dumps(payload, indent=indent, sort_keys=True) + "\n")
    return path


def read_season(path: Path = SEASON_PATH) -> SavedSeason:
    return load_season(json.loads(Path(path).read_text()))


def season_exists(path: Path = SEASON_PATH) -> bool:
    return Path(path).is_file()


def apply_season(league, saved: SavedSeason) -> None:
    """Put a loaded season onto a league: fixtures, clock, and derived tables."""
    league.name = saved.name
    league.season = saved.season
    league.tracker_speed = saved.tracker_speed
    league.clock.offset = timedelta(seconds=saved.clock_offset_seconds)
    league.restore_schedule(saved.games)
