#!/usr/bin/env python3
"""Entry point for the Basketball Manager shell.

    python3 run.py serve          start the web app (default)
    python3 run.py sim            simulate one game and print the play-by-play
    python3 run.py season         simulate the whole schedule, print standings

Nothing here is generated. Teams, players and coaches come from
`data/league.json`; the fixture list and every result played so far come from
`data/season.json`. Both were built once, by `tools/make_league.py` and
`tools/make_season.py`, and `bballsim/placeholder.py` is not consulted.
"""

from __future__ import annotations

import argparse
import os
from datetime import timedelta

from bballsim.engine.game import GameSimulator
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams
from bballsim.save import (
    SEASON_PATH,
    apply_season,
    read_season,
    season_exists,
    seed_data_dir,
    write_season,
)

# A hosted app is told which port to listen on and must bind every interface;
# at a terminal, localhost is the safer default. Both come from the
# environment so the same command works in either place.
DEFAULT_PORT = int(os.environ.get("PORT") or 8000)
DEFAULT_HOST = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")


def build_league(team_count: int = 30) -> League:
    """The league and its season, from disk."""
    # On a mounted disk the first boot finds an empty directory; seed it from
    # the copies baked into the image, without ever overwriting a live save.
    for path in seed_data_dir():
        print(f"seeded {path}")

    saved = load_teams(team_count)
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)

    if season_exists():
        # Fixtures, results played so far, and the sim date you left on.
        apply_season(league, read_season())
    else:
        print(f"no season at {SEASON_PATH} — building a temporary fixture list.\n"
              f"Run `python3 tools/make_season.py` to save one.")
        league.set_schedule(build_round_robin(
            team_ids=list(league.teams),
            start_date=league.clock.now().date(),
            times_played=2,
            days_between_rounds=1,
            season=league.season,
        ))

    league.tick()
    return league


def save_season(league: League) -> None:
    write_season(SEASON_PATH, league)
    played = sum(1 for g in league.schedule if g.status == GameStatus.FINAL)
    print(f"saved {played} played of {len(league.schedule)} fixtures "
          f"to {SEASON_PATH} (sim date {league.clock.now().date()})")


def command_serve(args: argparse.Namespace) -> None:
    from bballsim.api import serve

    league = build_league(args.teams)
    if args.speed is not None:
        league.tracker_speed = args.speed
    # Games played while the server is up are worth keeping, however it comes
    # down -- so the save runs periodically as well as at shutdown.
    serve(
        league,
        host=args.host,
        port=args.port,
        save=None if args.no_save else save_season,
    )


def command_sim(args: argparse.Namespace) -> None:
    teams = load_teams(2).teams
    result = GameSimulator("exhibition", home=teams[0], away=teams[1], seed=args.seed).simulate()

    for event in result.events:
        print(f"[{event.period}] {event.clock:>5}  "
              f"{event.away_score:>3}-{event.home_score:<3}  {event.description}")

    print()
    for box in (result.away_box, result.home_box):
        print(f"{box.name} — {box.points}")
        print(f"{'Player':<22}{'MIN':>6}{'PTS':>5}{'REB':>5}{'AST':>5}{'FG':>8}{'3P':>8}")
        for line in sorted(box.players.values(), key=lambda l: -l.seconds):
            if line.seconds <= 0:
                continue
            print(f"{line.name:<22}{line.minutes:>6}{line.points:>5}{line.rebounds:>5}"
                  f"{line.assists:>5}{f'{line.fgm}-{line.fga}':>8}{f'{line.tpm}-{line.tpa}':>8}")
        print()


def command_season(args: argparse.Namespace) -> None:
    league = build_league(args.teams)
    league.clock.advance(timedelta(days=365 * 2))
    league.tick()

    print(f"{'Team':<26}{'W':>4}{'L':>4}{'PCT':>7}{'PF':>7}{'PA':>7}{'DIFF':>7}")
    for row in league.standings_table():
        print(f"{row['team_name']:<26}{row['wins']:>4}{row['losses']:>4}"
              f"{row['win_pct']:>7.3f}{row['points_for']:>7}{row['points_against']:>7}"
              f"{row['point_differential']:>+7}")

    if args.save:
        print()
        save_season(league)


def main() -> None:
    parser = argparse.ArgumentParser(description="Basketball Manager shell")
    sub = parser.add_subparsers(dest="command")

    serve_parser = sub.add_parser("serve", help="run the web app")
    serve_parser.add_argument("--host", default=DEFAULT_HOST)
    serve_parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    serve_parser.add_argument("--teams", type=int, default=30)
    serve_parser.add_argument("--speed", type=float, default=None,
                              help="game seconds revealed per real second "
                                   "(default: whatever the save holds)")
    serve_parser.add_argument("--no-save", action="store_true",
                              help="do not write results back to data/season.json")
    serve_parser.set_defaults(func=command_serve)

    sim_parser = sub.add_parser("sim", help="simulate a single exhibition game")
    sim_parser.add_argument("--seed", default="exhibition")
    sim_parser.set_defaults(func=command_sim)

    season_parser = sub.add_parser("season", help="simulate the full schedule")
    season_parser.add_argument("--teams", type=int, default=30)
    season_parser.add_argument("--save", action="store_true",
                               help="write the played season to data/season.json")
    season_parser.set_defaults(func=command_season)

    args = parser.parse_args()
    if not getattr(args, "func", None):
        args = parser.parse_args(["serve"])
    args.func(args)


if __name__ == "__main__":
    main()
