#!/usr/bin/env python3
"""Build the fixture list once and write it to disk.

Like the roster, the schedule is generated one time and then kept. It matters
more here than it looks: a fixture's id *is* its simulation seed, so a schedule
rebuilt on every boot meant every game was a different game even when the
fixtures looked identical. Ids are now derived from who is playing and when.

    python3 tools/make_season.py             # refuses to clobber an existing file
    python3 tools/make_season.py --force     # rebuild the fixture list
    python3 tools/make_season.py --show      # what is in the file now
    python3 tools/make_season.py --play      # build it and sim the whole thing

Results accumulate into the same file as you play; `run.py serve` saves on the
way out.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams
from bballsim.save import (
    SEASON_PATH,
    apply_season,
    read_season,
    season_exists,
    write_season,
)

# A fixed opening night. Absolute rather than "today minus three days", so the
# fixture list is the same on every machine and in every run -- which is the
# whole point of saving it.
SEASON_START = date(2026, 10, 20)
TIMES_PLAYED = 2
DAYS_BETWEEN_ROUNDS = 1


def build(league: League) -> None:
    league.set_schedule(build_round_robin(
        team_ids=list(league.teams),
        start_date=SEASON_START,
        times_played=TIMES_PLAYED,
        days_between_rounds=DAYS_BETWEEN_ROUNDS,
        season=league.season,
    ))
    # Put the sim clock just after opening night, so a fresh save has a game
    # to watch rather than a schedule that has not started or one already over.
    first = league.schedule[0]
    league.clock.jump_to(first.tipoff_at + timedelta(minutes=1))


def describe(league: League) -> None:
    finals = [g for g in league.schedule if g.status == GameStatus.FINAL]
    print(f"{league.name} — {league.season}")
    print(f"  teams        {len(league.teams)}")
    print(f"  fixtures     {len(league.schedule)}")
    print(f"  played       {len(finals)}")
    print(f"  sim date     {league.clock.now().date()}")
    if league.schedule:
        print(f"  opening      {league.schedule[0].tipoff_at.date()}")
        print(f"  closing      {league.schedule[-1].tipoff_at.date()}")
    if finals:
        print()
        print(f"  {'Team':<26}{'W':>4}{'L':>4}{'PCT':>7}{'DIFF':>7}")
        for row in league.standings_table()[:5]:
            print(f"  {row['team_name']:<26}{row['wins']:>4}{row['losses']:>4}"
                  f"{row['win_pct']:>7.3f}{row['point_differential']:>+7}")


def new_league() -> League:
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    return league


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--path", type=Path, default=SEASON_PATH)
    parser.add_argument("--force", action="store_true",
                        help="rebuild the fixture list, discarding any results")
    parser.add_argument("--show", action="store_true",
                        help="describe the season already on disk and exit")
    parser.add_argument("--play", action="store_true",
                        help="simulate the whole schedule before saving")
    args = parser.parse_args()

    league = new_league()

    if args.show:
        if not season_exists(args.path):
            print(f"no season at {args.path}", file=sys.stderr)
            raise SystemExit(1)
        apply_season(league, read_season(args.path))
        describe(league)
        return

    if season_exists(args.path) and not args.force:
        apply_season(league, read_season(args.path))
        print(f"{args.path} already exists — leaving it alone.", file=sys.stderr)
        print("Pass --force to rebuild the fixtures and discard every result.",
              file=sys.stderr)
        print(file=sys.stderr)
        describe(league)
        raise SystemExit(1)

    build(league)
    if args.play:
        league.clock.advance(timedelta(days=365 * 2))
        league.tick()

    write_season(args.path, league)
    print(f"wrote {args.path}")
    describe(league)


if __name__ == "__main__":
    main()
