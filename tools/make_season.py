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

from bballsim.league import League
from bballsim.league.calendar import PACIFIC, GameStatus, build_daily_schedule
from bballsim.roster import load_teams
from bballsim.save import (
    SEASON_PATH,
    apply_season,
    read_season,
    season_exists,
    write_season,
)

# 82 games each, three a day at 8am, 1pm and 7pm Pacific. 82 does not divide
# by three, so the tail is two days of two games rather than a day with one.
GAMES_PER_TEAM = 82


def default_start() -> date:
    """Tomorrow, Pacific. The league runs on real days, so a season that began
    yesterday would have games to play the moment it was created."""
    return datetime.now(PACIFIC).date() + timedelta(days=1)


def build(league: League, start: date) -> None:
    league.set_schedule(build_daily_schedule(
        team_ids=list(league.teams),
        start_date=start,
        games_per_team=GAMES_PER_TEAM,
        season=league.season,
    ))
    # Sim time *is* real time: no offset. Games tip off when their real
    # 8am/1pm/7pm Pacific slot arrives, and nothing has been played yet.
    league.clock.offset = timedelta()


def describe(league: League) -> None:
    finals = [g for g in league.schedule if g.status == GameStatus.FINAL]
    print(f"{league.name} — {league.season}")
    print(f"  teams        {len(league.teams)}")
    print(f"  fixtures     {len(league.schedule)}")
    print(f"  played       {len(finals)}")
    print(f"  sim date     {league.clock.now().astimezone(PACIFIC):%Y-%m-%d %H:%M %Z}")
    if league.schedule:
        first = league.schedule[0].tipoff_at.astimezone(PACIFIC)
        last = league.schedule[-1].tipoff_at.astimezone(PACIFIC)
        print(f"  opening      {first:%a %Y-%m-%d %-I:%M %p %Z}")
        print(f"  closing      {last:%a %Y-%m-%d %-I:%M %p %Z}")
        days = sorted({g.tipoff_at.astimezone(PACIFIC).date() for g in league.schedule})
        print(f"  playing days {len(days)}")
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
    parser.add_argument("--start", type=date.fromisoformat, default=None,
                        help="opening day, YYYY-MM-DD (default: tomorrow, Pacific)")
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

    build(league, args.start or default_start())
    if args.play:
        league.clock.advance(timedelta(days=365 * 2))
        league.tick()

    write_season(args.path, league)
    print(f"wrote {args.path}")
    describe(league)


if __name__ == "__main__":
    main()
