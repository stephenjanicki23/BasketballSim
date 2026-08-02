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

from bballsim import composites as C
from bballsim.chemistry import evaluate as evaluate_chemistry
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.models import Lineup
from bballsim.placeholder import make_teams
from bballsim.ratings import (
    ATTRIBUTE_GROUPS,
    ATTRIBUTE_LABELS,
    HiddenAttributes,
    Ratings,
    display_name,
)

# The composites the engine actually reads. Exported alongside the raw
# attributes so the page can show what a rating set adds up to.
EXPORTED_COMPOSITES = {
    "Rim finishing": C.shooting_rim,
    "Paint scoring": C.shooting_paint,
    "Mid-range": C.shooting_mid,
    "Corner three": C.shooting_corner_three,
    "Above the break": C.shooting_above_break_three,
    "Shot creation": C.shot_creation,
    "Shot selection": C.shot_quality,
    "Playmaking": C.playmaking,
    "Ball security": C.ball_security,
    "Off-ball gravity": C.off_ball_gravity,
    "Interior defense": C.interior_defense,
    "Perimeter defense": C.perimeter_defense,
    "Help defense": C.help_defense,
    "Steal threat": C.steal_threat,
    "Rim protection": C.block_threat,
    "Offensive glass": C.offensive_rebounding,
    "Defensive glass": C.defensive_rebounding,
    "Foul avoidance": C.foul_avoidance,
    "Endurance": C.endurance,
    "Clutch": C.clutch,
}

# Event types, as small integers. Order must match EVENT_TYPES in the page.
EVENT_CODES = [
    "game_start", "period_start", "period_end", "jump_ball",
    "shot_made", "shot_missed", "block", "assist", "rebound",
    "turnover", "steal", "foul", "free_throw_made", "free_throw_missed",
    "substitution", "timeout", "game_end",
]
CODE_BY_TYPE = {name: index for index, name in enumerate(EVENT_CODES)}


def build_season(team_count: int = 8, season_start_days_ago: int = 12) -> League:
    league = League(name="Placeholder Basketball League", season="2026-27")
    for team in make_teams(team_count):
        league.add_team(team)

    start = (datetime.now(timezone.utc) - timedelta(days=season_start_days_ago)).date()
    league.set_schedule(
        build_round_robin(
            team_ids=list(league.teams),
            start_date=start,
            times_played=1,
            days_between_rounds=2,
            season=league.season,
        )
    )
    # Run the whole schedule out.
    league.clock.advance(timedelta(days=365))
    league.tick()
    return league


def export_team(league: League, team) -> dict:
    lineup = Lineup(team.starters())
    chemistry = evaluate_chemistry(team, lineup)
    return {
        "id": team.id,
        "abbr": team.abbreviation,
        "city": team.city,
        "name": team.name,
        "conference": team.conference,
        "chemistry": round(team.team_chemistry, 1),
        "lineupChemistry": chemistry.to_dict(),
        "tactics": team.tactics.to_dict(),
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "short": p.short_name,
                "pos": p.position.value,
                "age": p.age,
                "height": p.height_inches,
                "weight": p.weight_lbs,
                "jersey": p.jersey,
                "ovr": p.overall,
                "personality": p.personality,
                "ratings": {k: round(v) for k, v in p.ratings.to_dict().items()},
                "tendencies": {k: round(v) for k, v in p.tendencies.to_dict().items()},
                # Normally invisible. Shipped so the demo can show what a
                # scouting report would eventually reveal.
                "hidden": {k: round(v) for k, v in p.hidden.to_dict().items()},
                "composites": {k: round(fn(p), 1) for k, fn in EXPORTED_COMPOSITES.items()},
            }
            for p in team.players
        ],
    }


# Flag bits packed into each event so the page can score it without re-deriving
# engine logic: 1 = offensive rebound, 2 = three-point attempt, 4 = and-one
# (the secondary player is the defender, not an assister).
FLAG_OFFENSIVE_REBOUND = 1
FLAG_THREE = 2
FLAG_AND_ONE = 4


def event_flags(event) -> int:
    detail = event.detail
    flags = 0
    if detail.get("offensive"):
        flags |= FLAG_OFFENSIVE_REBOUND
    if str(detail.get("zone", "")).endswith("three"):
        flags |= FLAG_THREE
    if detail.get("and_one"):
        flags |= FLAG_AND_ONE
    return flags


def export_game(game, league) -> dict:
    result = game.result
    return {
        "id": game.id,
        # Who tipped off, so the page can track minutes through substitutions.
        "homeStarters": [p.id for p in league.teams[game.home_team_id].starters()],
        "awayStarters": [p.id for p in league.teams[game.away_team_id].starters()],
        "tipoff": game.tipoff_at.isoformat(),
        "round": game.round_label,
        "home": game.home_team_id,
        "away": game.away_team_id,
        "homeScore": result.home_score,
        "awayScore": result.away_score,
        "periods": result.periods_played,
        "homeLine": result.home_box.points_by_period,
        "awayLine": result.away_box.points_by_period,
        "duration": round(result.duration_game_seconds, 1),
        "homeBox": result.home_box.to_dict(),
        "awayBox": result.away_box.to_dict(),
        # [period, clock, gameSeconds, typeCode, description, homeScore,
        #  awayScore, teamId, playerId, secondaryId, points, flags]
        # so the page can rebuild the box score live from the same events.
        "events": [
            [
                e.period,
                e.clock,
                round(e.game_seconds, 1),
                CODE_BY_TYPE[e.type.value],
                e.description,
                e.home_score,
                e.away_score,
                e.team_id or "",
                e.player_id or "",
                e.secondary_player_id or "",
                e.detail.get("points", 0),
                event_flags(e),
            ]
            for e in result.events
        ],
    }


def main() -> None:
    league = build_season()
    finals = [g for g in league.schedule if g.status == GameStatus.FINAL]

    payload = {
        "league": {
            "name": league.name,
            "season": league.season,
            "trackerSpeed": league.tracker_speed,
        },
        "eventTypes": EVENT_CODES,
        "attributeGroups": {g: list(keys) for g, keys in ATTRIBUTE_GROUPS.items()},
        "attributeLabels": ATTRIBUTE_LABELS,
        "attributeNames": {k: display_name(k) for k in Ratings.attribute_names()},
        "hiddenNames": {k: display_name(k) for k in HiddenAttributes.attribute_names()},
        "compositeOrder": list(EXPORTED_COMPOSITES),
        "teams": [export_team(league, t) for t in league.teams.values()],
        "games": [export_game(g, league) for g in finals],
        "standings": league.standings_table(),
    }

    raw = json.dumps(payload, separators=(",", ":")).encode()
    packed = base64.b64encode(gzip.compress(raw, 9)).decode()

    print(packed, end="")
    print(
        f"games={len(finals)}  raw={len(raw) // 1024}KB  packed={len(packed) // 1024}KB",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
