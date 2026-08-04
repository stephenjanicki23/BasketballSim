#!/usr/bin/env python3
"""Export a simulated mini-season as a single compressed payload.

The hosted demo page is static -- it cannot run the Python engine -- so this
script simulates a real schedule and dumps every event, box score and rating
into one gzipped blob the page decompresses in the browser. Nothing is
fabricated on the client: the play-by-play you watch there is exactly what the
engine produced here.

    python3 tools/export_demo.py > demo/data.b64
"""

from __future__ import annotations

import base64
import gzip
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.api.payload import (
    EVENT_CODES,
    bootstrap,
    game_detail,
    game_preview,
    team_squad,
)
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams
from bballsim.save import apply_season, read_season, season_exists


# The page shows one day, so that day is what carries play-by-play -- every
# fixture on the schedule opens into a full tracker. A whole season of events
# is ~90MB; a day is 30 games.


def build_season(team_count: int = 30) -> League:
    """The saved league and the saved fixture list, played out in full.

    Both come off disk rather than being generated here, so the demo shows the
    same 360 players and the same fixtures as the app. A fixture id is its
    simulation seed, so the games below are the games the app would play.
    """
    saved = load_teams(team_count)
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)

    if season_exists():
        apply_season(league, read_season())
    else:
        league.set_schedule(build_round_robin(
            team_ids=list(league.teams),
            start_date=datetime.now(timezone.utc).date(),
            times_played=2,
            days_between_rounds=1,
            season=league.season,
        ))

    # Run the whole schedule out.
    league.clock.advance(timedelta(days=365 * 2))
    league.tick()
    return league


def export_game(game, league) -> dict:
    """One fixture, with its preview and its full play-by-play.

    `revealed_only=False`: every game in the export has already finished, so
    there is no ending left to spoil.
    """
    data = game_detail(game, league, revealed_only=False)
    data["preview"] = game_preview(game, league)["preview"]
    return data


def main() -> None:
    league = build_season()
    finals = [g for g in league.schedule if g.status == GameStatus.FINAL]

    # The same shapes the live API serves, from the same module -- so the
    # published page and the app cannot drift apart.
    payload = bootstrap(league, minimum_games=5)
    payload["live"] = False
    payload["league"]["trackerSpeed"] = league.tracker_speed
    payload["teams"] = [team_squad(t, league) for t in league.teams.values()]
    # `bootstrap` already picked the day; give every fixture on it the full
    # play-by-play, since a published page cannot fetch one later.
    day_ids = {g["id"] for g in payload["day"]["games"]}
    payload["day"]["games"] = [
        export_game(g, league) for g in finals if g.id in day_ids
    ]
    detailed_ids = day_ids

    raw = json.dumps(payload, separators=(",", ":")).encode()
    packed = base64.b64encode(gzip.compress(raw, 9)).decode()

    print(packed, end="")
    print(
        f"teams={len(league.teams)}  players={sum(len(t.players) for t in league.teams.values())}  "
        f"games={len(finals)} ({len(detailed_ids)} with play-by-play)  "
        f"raw={len(raw) // 1024}KB  packed={len(packed) // 1024}KB",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
