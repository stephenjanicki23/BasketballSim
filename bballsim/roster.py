"""Where the league comes from.

One function, used by everything that needs teams -- the server, the demo
exporter, the CLI -- so there is exactly one answer to "which players am I
looking at?" and it is the same answer everywhere.

The answer is `data/league.json`. Generation is a one-off that already
happened; see `tools/make_league.py`. If the file is missing the league is
generated on the spot so a stripped checkout still runs, but it says so
loudly, because a generated league is a *different* league and anything you
did with the last one no longer refers to anybody.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .conferences import stamp
from .save import LEAGUE_PATH, SavedLeague, league_exists, read_league

FALLBACK_NAME = "Placeholder Basketball League"
FALLBACK_SEASON = "2026-27"


def load_teams(count: int | None = None, path: Path = LEAGUE_PATH) -> SavedLeague:
    """The league, from disk. `count` trims it; None takes every team.

    Each call re-reads the file, so callers get their own objects and one
    simulation cannot leave fatigue or chemistry behind for the next.
    """
    if not league_exists(path):
        return _generate(count, path)

    saved = read_league(path)
    if count is not None and count > len(saved.teams):
        raise ValueError(
            f"asked for {count} teams, {path} holds {len(saved.teams)}. "
            f"Run tools/make_league.py --force --teams {count} to build a bigger league "
            f"(it replaces every player and coach)."
        )
    if count is not None:
        saved.teams = saved.teams[:count]
    stamp(saved.teams)
    return saved


def _generate(count: int | None, path: Path) -> SavedLeague:
    from .placeholder import make_teams

    print(
        f"no league at {path} — generating a temporary one.\n"
        f"Run `python3 tools/make_league.py` to save it, or these players "
        f"change the next time the generator does.",
        file=sys.stderr,
    )
    return SavedLeague(
        name=FALLBACK_NAME, season=FALLBACK_SEASON, teams=make_teams(count or 30)
    )
