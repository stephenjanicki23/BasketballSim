#!/usr/bin/env python3
"""Generate the league once and write it to disk.

After this runs, `data/league.json` is the league. The generator in
`bballsim/placeholder.py` is no longer consulted by anything that plays games,
so tuning it -- or rewriting it entirely -- cannot change a single player who
already exists.

    python3 tools/make_league.py             # refuses to clobber an existing file
    python3 tools/make_league.py --force     # regenerate from scratch
    python3 tools/make_league.py --show      # describe the league on disk

Regenerating replaces all 360 players and all 30 coaches with different people.
That is why --force exists and why it is not the default.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.coach import COACHING_SKILLS
from bballsim.placeholder import make_teams
from bballsim.save import (
    LEAGUE_PATH,
    fingerprint,
    league_exists,
    read_league,
    write_league,
)

LEAGUE_NAME = "Placeholder Basketball League"
SEASON = "2026-27"


def describe(teams, name: str, season: str) -> None:
    players = [p for t in teams for p in t.players]
    best = max(players, key=lambda p: p.current_ability)
    coaches = [t.coach for t in teams if t.coach]
    top_coach = max(
        coaches,
        key=lambda c: sum(getattr(c.ratings, k) for k in COACHING_SKILLS),
    ) if coaches else None

    print(f"{name} — {season}")
    print(f"  teams        {len(teams)}")
    print(f"  players      {len(players)}")
    print(f"  coaches      {len(coaches)}")
    print(f"  fingerprint  {fingerprint(teams)}")
    print(f"  best player  {best.name} ({best.position.value}, {best.age}) "
          f"— {best.stars} stars, {best.tier}")
    if top_coach:
        print(f"  best coach   {top_coach.name} — {top_coach.tier} · {top_coach.specialism}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--path", type=Path, default=LEAGUE_PATH)
    parser.add_argument("--teams", type=int, default=30)
    parser.add_argument("--force", action="store_true",
                        help="overwrite an existing league with brand new people")
    parser.add_argument("--show", action="store_true",
                        help="describe the league already on disk and exit")
    args = parser.parse_args()

    if args.show:
        if not league_exists(args.path):
            print(f"no league at {args.path}", file=sys.stderr)
            raise SystemExit(1)
        saved = read_league(args.path)
        describe(saved.teams, saved.name, saved.season)
        return

    if league_exists(args.path) and not args.force:
        saved = read_league(args.path)
        print(f"{args.path} already exists — leaving it alone.", file=sys.stderr)
        print("Pass --force to replace every player and coach in it.", file=sys.stderr)
        print(file=sys.stderr)
        describe(saved.teams, saved.name, saved.season)
        raise SystemExit(1)

    teams = make_teams(args.teams)
    write_league(args.path, teams, name=LEAGUE_NAME, season=SEASON)
    print(f"wrote {args.path}")
    describe(teams, LEAGUE_NAME, SEASON)


if __name__ == "__main__":
    main()
