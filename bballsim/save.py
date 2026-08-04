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
from .league.league import DEFAULT_TRACKER_SPEED
from .league.stats import PlayerSeasonLine, SeasonStats, TeamSeasonLine
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

# Seasons that are over. This one *does* store totals, and the distinction is
# worth being precise about rather than waving at.
#
# Everywhere else, a derived number is absent because the thing it derives from
# is present: standings are rebuilt from results because the results are in
# `season.json`. A finished season is different. Its fixtures are retired when
# the next one is scheduled -- keeping twenty years of box scores would be
# hundreds of megabytes read on every boot -- so the totals those games produced
# are the last surviving record of them. Storing a record of what happened is
# not caching a derivation; it is the same category as storing that a player is
# 26 years old.
#
# What is stored is *totals only*. Advanced stats for a 2027-28 season are still
# computed on read by the same `advanced_table` the current season goes through,
# from these totals. Nothing derived is written here.
HISTORY_PATH = data_dir() / "history.json"


def schedule_fingerprint(games) -> str:
    """A digest of *which fixtures exist*, ignoring anything played.

    Results are stored against fixture ids, so a saved season is only meaningful
    against the calendar it was played on. When the calendar is rebuilt -- a
    different game count, different days, different ids -- the old save is not
    "a season in progress", it is a season of a different competition, and
    keeping it would leave standings referring to games that no longer exist.
    """
    ids = sorted(g.id if hasattr(g, "id") else g["id"] for g in games)
    return hashlib.blake2b("|".join(ids).encode("utf-8"), digest_size=8).hexdigest()


def _season_schedule_id(path: Path) -> str | None:
    """The fingerprint recorded in a season file, or None if unreadable."""
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return None
    stamped = data.get("schedule")
    if stamped:
        return stamped
    # Written before the stamp existed: derive it from the fixtures themselves.
    return schedule_fingerprint(data.get("games", []))


def seed_data_dir(target: Path | None = None) -> list[Path]:
    """Put the bundled league and season on the data directory.

    A mounted disk starts empty, so first boot has nothing to load. After that
    the disk is the truth and a deploy must not wipe a season somebody is
    playing -- with two exceptions, both of which mean the save is no longer
    about the same competition:

      * the committed calendar has changed, so results on disk point at
        fixtures that no longer exist; or
      * `BBALLSIM_RESET_SEASON` is set, which is the manual override.

    Returns the files actually written.
    """
    target = Path(target) if target else data_dir()
    if target.resolve() == BUNDLED_DATA_DIR.resolve():
        return []

    target.mkdir(parents=True, exist_ok=True)
    written = []
    for name in ("league.json", "season.json"):
        source = BUNDLED_DATA_DIR / name
        destination = target / name
        if not source.is_file():
            continue
        if not destination.exists() or _should_replace_season(name, source, destination):
            shutil.copyfile(source, destination)
            written.append(destination)
    return written


def _should_replace_season(name: str, source: Path, destination: Path) -> bool:
    """Whether an existing file on the data directory is now stale."""
    if name != "season.json":
        return False  # the roster is never overwritten; it has no calendar
    if os.environ.get("BBALLSIM_RESET_SEASON", "").strip().lower() in {"1", "true", "yes"}:
        return True
    # A league that has rolled an offseason is playing a calendar it built for
    # itself, which will never match the bundled one -- so the fingerprint test
    # below would replace it on every single deploy. That would put the league
    # back on 2026-27 while `league.json` still held players four years older
    # and `history.json` still held the seasons they played. The presence of a
    # history file is the signal that this save has moved on from the seed.
    if (destination.parent / HISTORY_PATH.name).is_file():
        return False
    return _season_schedule_id(source) != _season_schedule_id(destination)

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
    data = {
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
    # What his career has accumulated. The key is **omitted** rather than
    # written as null when there is none, and that is not cosmetic: `fingerprint`
    # hashes this dict, and a league that has never played a summer must
    # fingerprint the same as it did before career profiles existed. Writing
    # `"career": null` against all 360 players changed the committed league's
    # digest and failed the test whose entire job is to notice somebody
    # regenerating the roster -- for a schema change that moved no player at all.
    if player.career is not None:
        data["career"] = dump_career(player.career)
    # Fatigue, wear and any injury he is carrying. Omitted when he is carrying
    # nothing, so a fresh league fingerprints exactly as it did before health
    # existed -- see the note on `career` above.
    health = dump_health(player.health)
    if health:
        data["health"] = health
    return data


def dump_health(health) -> dict | None:
    """A player's body, in full precision.

    Stored rather than derived, unlike the standings and the season totals.
    Tiredness is a fact about a man at a moment, not a summary of the fixture
    list -- and deriving it would mean replaying every recovery day of a season
    on every boot to answer whether he is fit tonight.
    """
    if health is None:
        return None
    if not (health.fatigue or health.wear or health.knock or health.injury
            or health.games_missed or health.days_rested):
        return None
    data = {
        "fatigue": health.fatigue,
        "wear": health.wear,
        "knock": health.knock,
        "days_rested": health.days_rested,
        "games_missed": health.games_missed,
    }
    if health.injury is not None:
        data["injury"] = {
            "name": health.injury.name,
            "games_remaining": health.injury.games_remaining,
            "games_total": health.injury.games_total,
            "permanent": dict(health.injury.permanent),
            "potential_cost": health.injury.potential_cost,
        }
    return data


def load_health(data: dict | None):
    from .health import Health, MajorInjury

    if not data:
        return Health()
    injury = data.get("injury")
    return Health(
        fatigue=data.get("fatigue", 0.0),
        wear=data.get("wear", 0.0),
        knock=data.get("knock", 0.0),
        days_rested=data.get("days_rested", 0),
        games_missed=data.get("games_missed", 0),
        injury=None if not injury else MajorInjury(
            name=injury["name"],
            games_remaining=injury["games_remaining"],
            games_total=injury.get("games_total", injury["games_remaining"]),
            permanent=injury.get("permanent") or {},
            potential_cost=injury.get("potential_cost", 0.0),
        ),
    )


def dump_career(career) -> dict | None:
    """A `progression.CareerProfile`, in full precision.

    Deliberately not `CareerProfile.to_dict()` -- that is a display view, it
    rounds, it renames to camelCase and it drops `baseline_ca` entirely. A
    baseline that reloaded as a rounded number would move every player's
    effective ceiling on every restart, and a baseline that did not reload at
    all would reset it to today's ability, which is the whole reason the
    profile is stored rather than rebuilt.
    """
    if career is None:
        return None
    return {
        "prime_age": career.prime_age,
        "athletic_peak": career.athletic_peak,
        "arc": career.arc.value,
        "realisation": career.realisation,
        "baseline_ca": career.baseline_ca,
        "injury_load": career.injury_load,
        "seasons_played": career.seasons_played,
        "peak_ca": career.peak_ca,
        "retired": career.retired,
    }


def load_career(data: dict | None):
    if not data:
        return None
    from .progression import CareerArc, CareerProfile

    return CareerProfile(
        prime_age=data["prime_age"],
        athletic_peak=data["athletic_peak"],
        arc=CareerArc(data["arc"]),
        realisation=data["realisation"],
        baseline_ca=data.get("baseline_ca", 0.0),
        injury_load=data.get("injury_load", 0.0),
        seasons_played=data.get("seasons_played", 0),
        peak_ca=data.get("peak_ca", 0.0),
        retired=data.get("retired", False),
    )


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
        career=load_career(data.get("career")),
        health=load_health(data.get("health")),
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
    tracker_speed: float = DEFAULT_TRACKER_SPEED

    @property
    def played(self) -> int:
        return sum(1 for g in self.games if g.status == GameStatus.FINAL)


def dump_season(
    games: list[ScheduledGame],
    *,
    name: str,
    season: str,
    clock_offset_seconds: float = 0.0,
    tracker_speed: float = DEFAULT_TRACKER_SPEED,
) -> dict:
    return {
        "version": SAVE_VERSION,
        "name": name,
        "season": season,
        # Which calendar these results were played on. A deployment compares
        # this against the committed one and replaces a save built on a
        # superseded schedule -- see `seed_data_dir`.
        "schedule": schedule_fingerprint(games),
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
        tracker_speed=data.get("tracker_speed", DEFAULT_TRACKER_SPEED),
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
    """Put a loaded season onto a league: fixtures, clock, and derived tables.

    Tracker speed is deliberately *not* restored. It is configuration, not
    something that happened -- the season records results, not how fast
    somebody was watching them. Restoring it means a file written under the
    old fast-forward design silently overrides real time on every boot, which
    is exactly what it did: a live game revealing its 2,880 seconds at the
    saved 20x finished in two and a half minutes instead of forty-eight, and
    redeploying did not fix it because the speed was coming off the disk.

    The league keeps its own default. `run.py --speed` and the clock API still
    override it for a session.
    """
    league.name = saved.name
    league.season = saved.season
    league.clock.offset = timedelta(seconds=saved.clock_offset_seconds)
    league.restore_schedule(saved.games)


# --------------------------------------------------------------------------
# Completed seasons
#
# Player and team season *totals*, plus who won. See `HISTORY_PATH` above for
# why this file stores totals when nothing else here stores anything derived.
# --------------------------------------------------------------------------

def dump_player_season(line: PlayerSeasonLine) -> dict:
    """One player's totals. Counting stats and seconds -- never a per-game rate.

    `to_dict()` is the display view: it divides by games, rounds to three places
    and adds percentages. Reloading that would give a season whose totals cannot
    be recovered, and every advanced stat is built on totals.
    """
    data = {
        "player_id": line.player_id,
        "name": line.name,
        "team_id": line.team_id,
        "position": line.position,
        "games": line.games,
        "seconds": line.seconds,
    }
    for key in PlayerSeasonLine.COUNTING:
        data[key] = getattr(line, key)
    return data


def load_player_season(data: dict) -> PlayerSeasonLine:
    line = PlayerSeasonLine(
        player_id=data["player_id"],
        name=data.get("name", ""),
        team_id=data.get("team_id", ""),
        position=data.get("position", ""),
        games=data.get("games", 0),
        seconds=data.get("seconds", 0.0),
    )
    for key in PlayerSeasonLine.COUNTING:
        setattr(line, key, data.get(key, 0))
    return line


TEAM_SEASON_FIELDS = (
    "games", "wins", "losses", "points", "points_against", "possessions",
    "fgm", "fga", "tpm", "tpa", "ftm", "fta",
    "offensive_rebounds", "defensive_rebounds", "assists", "steals", "blocks",
    "turnovers", "fouls",
    "opp_possessions", "opp_fga", "opp_tpa", "opp_fta",
    "opp_offensive_rebounds", "opp_defensive_rebounds", "opp_turnovers",
)


def dump_team_season(line: TeamSeasonLine) -> dict:
    data = {
        "team_id": line.team_id,
        "name": line.name,
        "abbreviation": line.abbreviation,
    }
    for key in TEAM_SEASON_FIELDS:
        data[key] = getattr(line, key)
    return data


def load_team_season(data: dict) -> TeamSeasonLine:
    line = TeamSeasonLine(
        team_id=data["team_id"],
        name=data.get("name", ""),
        abbreviation=data.get("abbreviation", ""),
    )
    for key in TEAM_SEASON_FIELDS:
        setattr(line, key, data.get(key, 0))
    return line


def dump_stats(stats: SeasonStats) -> dict:
    return {
        "players": [dump_player_season(l) for l in stats.players.values()],
        "teams": [dump_team_season(l) for l in stats.teams.values()],
    }


def load_stats(data: dict) -> SeasonStats:
    stats = SeasonStats()
    for row in data.get("players", []):
        line = load_player_season(row)
        stats.players[line.player_id] = line
    for row in data.get("teams", []):
        line = load_team_season(row)
        stats.teams[line.team_id] = line
    return stats


def dump_archive(archive) -> dict:
    """One finished season: its totals, its final table, and who won it."""
    return {
        "season": archive.season,
        "stats": dump_stats(archive.stats),
        "standings": archive.standings,
        "champion": archive.champion,
        "runner_up": archive.runner_up,
        "conference_champions": dict(archive.conference_champions),
    }


def load_archive(data: dict):
    from .league.offseason import SeasonArchive

    return SeasonArchive(
        season=data["season"],
        stats=load_stats(data.get("stats") or {}),
        standings=data.get("standings") or [],
        champion=data.get("champion"),
        runner_up=data.get("runner_up"),
        conference_champions=data.get("conference_champions") or {},
    )


def dump_history(archives: list) -> dict:
    return {
        "version": SAVE_VERSION,
        "seasons": [dump_archive(a) for a in archives],
    }


def load_history(data: dict) -> list:
    version = data.get("version", 0)
    if version > SAVE_VERSION:
        raise ValueError(
            f"history file is version {version}, this build understands {SAVE_VERSION}"
        )
    return [load_archive(row) for row in data.get("seasons", [])]


def write_history(path: Path, archives: list, *, indent: int | None = 1) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _round(dump_history(archives))
    path.write_text(json.dumps(payload, indent=indent, sort_keys=True) + "\n")
    return path


def read_history(path: Path = HISTORY_PATH) -> list:
    if not Path(path).is_file():
        return []
    return load_history(json.loads(Path(path).read_text()))


def history_exists(path: Path = HISTORY_PATH) -> bool:
    return Path(path).is_file()
