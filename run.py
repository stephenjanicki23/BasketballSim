#!/usr/bin/env python3
"""Entry point for the Basketball Manager shell.

    python3 run.py serve          start the web app (default)
    python3 run.py sim            simulate one game and print the play-by-play
    python3 run.py season         simulate the whole schedule, print standings

Teams, players and coaches are loaded from `data/league.json` -- the same
league every run, on every machine. `bballsim/placeholder.py` only generated
it once, via `tools/make_league.py`, and is not consulted here.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from bballsim.engine.game import GameSimulator
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams


def build_league(team_count: int = 30) -> League:
    saved = load_teams(team_count)
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)

    now = datetime.now(timezone.utc)
    # Start a few days back so some games are already in the books, and give
    # each round its own day.
    games = build_round_robin(
        team_ids=list(league.teams),
        start_date=(now - timedelta(days=3)).date(),
        times_played=2,
        days_between_rounds=1,
        season=league.season,
    )
    league.set_schedule(games)

    # Put the next unplayed game just over the horizon so you can actually
    # watch one tip off after starting the server.
    upcoming = [g for g in league.schedule if g.tipoff_at > now]
    if upcoming:
        soon = now + timedelta(seconds=20)
        for game in [g for g in upcoming if g.tipoff_at == upcoming[0].tipoff_at]:
            game.tipoff_at = soon

    league.tick()
    return league


def command_serve(args: argparse.Namespace) -> None:
    from bballsim.api import serve

    league = build_league(args.teams)
    league.tracker_speed = args.speed
    serve(league, host=args.host, port=args.port)


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
    league.clock.advance(timedelta(days=365))
    league.tick()
    for game in league.schedule:
        if game.status != GameStatus.FINAL:
            continue

    print(f"{'Team':<26}{'W':>4}{'L':>4}{'PCT':>7}{'PF':>7}{'PA':>7}{'DIFF':>7}")
    for row in league.standings_table():
        print(f"{row['team_name']:<26}{row['wins']:>4}{row['losses']:>4}"
              f"{row['win_pct']:>7.3f}{row['points_for']:>7}{row['points_against']:>7}"
              f"{row['point_differential']:>+7}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Basketball Manager shell")
    sub = parser.add_subparsers(dest="command")

    serve_parser = sub.add_parser("serve", help="run the web app")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8000)
    serve_parser.add_argument("--teams", type=int, default=30)
    serve_parser.add_argument("--speed", type=float, default=20.0,
                              help="game seconds revealed per real second")
    serve_parser.set_defaults(func=command_serve)

    sim_parser = sub.add_parser("sim", help="simulate a single exhibition game")
    sim_parser.add_argument("--seed", default="exhibition")
    sim_parser.set_defaults(func=command_sim)

    season_parser = sub.add_parser("season", help="simulate the full schedule")
    season_parser.add_argument("--teams", type=int, default=30)
    season_parser.set_defaults(func=command_season)

    args = parser.parse_args()
    if not getattr(args, "func", None):
        args = parser.parse_args(["serve"])
    args.func(args)


if __name__ == "__main__":
    main()
