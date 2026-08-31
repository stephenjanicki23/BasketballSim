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

from bballsim import contracts, draft_picks, records
from bballsim.engine.game import GameSimulator
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams
from bballsim.save import (
    HISTORY_PATH,
    LEAGUE_PATH,
    OFFSEASON_PATH,
    ALLSTAR_PATH,
    RECORDS_PATH,
    SEASON_PATH,
    TRADES_PATH,
    apply_season,
    read_history,
    apply_pick_ownership,
    read_market,
    read_offseason,
    read_allstar,
    read_records,
    read_season,
    season_exists,
    seed_data_dir,
    write_history,
    write_league,
    write_market,
    write_offseason,
    write_allstar,
    write_records,
    write_season,
)

# A hosted app is told which port to listen on and must bind every interface;
# at a terminal, localhost is the safer default. Both come from the
# environment so the same command works in either place.
DEFAULT_PORT = int(os.environ.get("PORT") or 8000)
DEFAULT_HOST = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")


def _reschedule_if_calendar_has_rotted(league: League) -> None:
    """Rebuild a season that has fully slipped into the past before it is
    played.

    A committed `season.json` carries absolute dates, and real time keeps
    moving. A season generated to open tomorrow is fine on the day it ships and
    a live bug three weeks later: once every one of its games is in the past,
    the first `tick` plays the entire year -- and the offseason after it -- in a
    single boot, which is how a fully-simulated league ended up on the live
    site. So if nothing has been played yet and the last fixture is already
    behind us, the calendar has rotted: throw it away and lay a fresh one down
    starting tomorrow. A league that has actually played games is never touched
    -- that is a real season in progress, not a stale seed.
    """
    from bballsim.league.calendar import GameStatus, build_daily_schedule

    if any(g.status == GameStatus.FINAL for g in league.schedule):
        return
    if not league.schedule:
        return
    now = league.clock.now()
    if max(g.tipoff_at for g in league.schedule) >= now:
        return  # still opens in the future, or is mid-slate today -- leave it

    games_per_team = round(2 * len(league.schedule) / max(1, len(league.teams)))
    league.clock.offset = timedelta()
    league.set_schedule(build_daily_schedule(
        team_ids=list(league.teams),
        start_date=now.date() + timedelta(days=1),
        games_per_team=max(1, games_per_team),
        season=league.season,
    ))
    print(f"season calendar had fully elapsed -- laid a fresh one opening "
          f"{now.date() + timedelta(days=1)}")


def build_league(team_count: int = 30) -> League:
    """The league and its season, from disk."""
    # On a mounted disk the first boot finds an empty directory; seed it from
    # the copies baked into the image. A season already there is left alone
    # unless it was played on a calendar this build no longer has.
    for path in seed_data_dir():
        print(f"installed {path.name} -> {path}")

    saved = load_teams(team_count)
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)

    # Seasons already finished. Read before the current one, because a save
    # written after an offseason is a league several years along and its
    # `season.json` is the calendar it built for itself.
    league.history = read_history()

    # The single-game record book. Read before the season below, so that marks
    # from calendars that no longer exist are in place before this year's games
    # are offered to it -- those are the ones that cannot be recovered any
    # other way.
    league.records = read_records()

    if season_exists():
        # Fixtures, results played so far, and the sim date you left on.
        apply_season(league, read_season())
        _reschedule_if_calendar_has_rotted(league)
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

    # Contracts, for a league that predates them. Idempotent: a player who
    # already has one keeps it, so this fills in an old save exactly once and
    # is a no-op on every boot after that.
    contracts.generate_for_league(list(league.teams.values()), season=league.season)
    contracts.generate_coaches_for_league(list(league.teams.values()), season=league.season)

    # A summer left half-finished. Absent for most of the year, which is the
    # correct representation of "not in one".
    league.offseason = read_offseason()

    # Draft picks, and who owns them after any trades. `ensure` creates the
    # league's own inventory; the file only carries picks that have moved.
    draft_picks.ensure(league)
    market_blob = None
    if TRADES_PATH.is_file():
        import json as _json

        market_blob = _json.loads(TRADES_PATH.read_text())
        apply_pick_ownership(league, market_blob.get("pick_ownership"))
    league.trade_market = read_market(TRADES_PATH, league)

    # Every finished game on the current calendar, offered to the book. Needed
    # because a restored season is folded back through `League._record` rather
    # than `_finalize`, so nothing on reload reaches the record book on its own
    # -- and because a save that predates the book would otherwise show an
    # empty page for a season it has already played. Idempotent, so this is a
    # no-op once the marks are in.
    records.backfill(league)

    # Every All-Star Game the league has played. Loaded *before* the tick: the
    # tick is what plays this season's, and a league that reached tip-off with
    # an empty history would play it again and overwrite the twelve who were
    # actually voted in.
    league.allstar = read_allstar()

    league.tick()
    return league


def save_season(league: League) -> None:
    """Write everything the league has changed since the last checkpoint.

    Four files now, not one. The offseason ages every player and replaces the
    ones who retire, so the roster is no longer a fixed thing that only
    `tools/make_league.py` writes -- saving the season without saving the league
    would reload 2031-32 fixtures against the players of 2026.
    """
    write_season(SEASON_PATH, league)
    write_league(LEAGUE_PATH, list(league.teams.values()),
                 name=league.name, season=league.season)
    if league.history:
        write_history(HISTORY_PATH, league.history)
    # The single-game record book. Written every time, because unlike the
    # archive it accumulates during a season rather than at the end of one --
    # and unlike everything else here it cannot be rebuilt from what is saved.
    book = getattr(league, "records", None)
    if book is not None and book.games:
        write_records(RECORDS_PATH, book)
    # The All-Star Games, past and present. Written every time for the same
    # reason the record book is: a vote's verdict cannot be recomputed once the
    # season it was taken in has moved on.
    write_allstar(ALLSTAR_PATH, getattr(league, "allstar", None) or {})
    # Writes the summer, or removes the file when there is not one -- a stale
    # offseason.json would reopen the menu mid-season with a year-old list.
    write_offseason(OFFSEASON_PATH, getattr(league, "offseason", None))
    # The trade market, and which picks have changed hands.
    _write_trades(league)
    played = sum(1 for g in league.schedule if g.status == GameStatus.FINAL)
    print(f"saved {played} played of {len(league.schedule)} fixtures "
          f"to {SEASON_PATH} (sim date {league.clock.now().date()}"
          f"{f', {len(league.history)} seasons archived' if league.history else ''})")


def _write_trades(league: League) -> None:
    """Write the market plus pick ownership into one file.

    Ownership rides alongside the market rather than in `league.json` because
    a pick moving *is* a trade -- keeping the two together means a restored
    league can never have a completed trade in its log whose picks did not
    move.
    """
    import json

    from bballsim.save import dump_market, dump_pick_ownership

    payload = dump_market(getattr(league, "trade_market", None)) or {}
    ownership = dump_pick_ownership(league)
    if not payload and not ownership:
        if TRADES_PATH.is_file():
            TRADES_PATH.unlink()
        return
    payload["pick_ownership"] = ownership
    TRADES_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRADES_PATH.write_text(json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n")


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
