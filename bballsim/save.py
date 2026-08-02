"""Saving and loading a league, so the teams you have are the teams you keep.

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
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .ability import Ability, Archetype
from .biography import Biography, DraftInfo
from .coach import Coach, CoachRatings
from .models import Player, Position, Team
from .ratings import HiddenAttributes, Ratings, Tendencies
from .tactics import Tactics

# Bumped when the shape of the file changes. Loading a file from a newer
# version than this code understands is an error rather than a guess.
SAVE_VERSION = 1

# Where the league lives by default. Committed to the repository, so a fresh
# clone gets the same 30 teams as everybody else.
LEAGUE_PATH = Path(__file__).resolve().parents[1] / "data" / "league.json"

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
