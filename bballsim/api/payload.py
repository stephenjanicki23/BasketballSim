"""The shapes the front end reads.

There is one user interface, and it runs in two places: the hosted static demo,
where a whole season is baked into the page, and the live app, where the same
screens are backed by this API. Both read the *same* shapes, and both get them
from here -- otherwise the demo and the app drift apart and the fix for one
never reaches the other.

Two rules keep this honest:

  * Nothing here is a save format. These are display views: they round, they
    add derived fields (stars, tiers, labels), and they are one-way. Saving
    lives in `bballsim/save.py` and deliberately does the opposite.
  * Weight is split by how it is used. The bootstrap carries what every screen
    needs; a squad of 12 players with 81 attributes each is fetched per team,
    and a game's play-by-play per game. Sending all of it at once is about
    four megabytes, which is a slow first paint for data most visits never
    look at.
"""

from __future__ import annotations

from .. import composites as C
from ..ability import CA_MAX, CA_TIERS, scout, stars_from_rating
from ..chemistry import evaluate as evaluate_chemistry
from ..coach import COACH_MAX, COACH_RATING_LABELS, COACH_TIERS
from ..league.calendar import PACIFIC, GameStatus
from ..league.stats import STAT_COLUMNS
from ..models import Lineup
from ..ratings import (
    ATTRIBUTE_GROUPS,
    ATTRIBUTE_LABELS,
    HiddenAttributes,
    LEAGUE_AVERAGE,
    RATING_TIERS,
    SCALE_MAX,
    SCALE_MIN,
    Ratings,
    display_name,
    tier_label,
)

# The composites the engine actually reads, exported alongside the raw
# attributes so a squad page can show what a rating set adds up to.
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

# Event types as small integers, so 300,000 of them are not 300,000 strings.
# The order is the contract with the front end.
EVENT_CODES = [
    "game_start", "period_start", "period_end", "jump_ball",
    "shot_made", "shot_missed", "block", "assist", "rebound",
    "turnover", "steal", "foul", "free_throw_made", "free_throw_missed",
    "substitution", "timeout", "game_end",
]
CODE_BY_TYPE = {name: index for index, name in enumerate(EVENT_CODES)}

# Flags packed into each event so the page can score it without re-deriving
# engine logic.
FLAG_OFFENSIVE_REBOUND = 1
FLAG_THREE = 2
FLAG_AND_ONE = 4


def metadata() -> dict:
    """Scales, labels and groupings. Constant for a build; sent once."""
    return {
        "eventTypes": EVENT_CODES,
        "attributeGroups": {g: list(keys) for g, keys in ATTRIBUTE_GROUPS.items()},
        "attributeLabels": ATTRIBUTE_LABELS,
        "attributeNames": {k: display_name(k) for k in Ratings.attribute_names()},
        "hiddenNames": {k: display_name(k) for k in HiddenAttributes.attribute_names()},
        "compositeOrder": list(EXPORTED_COMPOSITES),
        "abilityScale": {
            "max": CA_MAX,
            "tiers": [[floor, label] for floor, label in CA_TIERS],
        },
        "coachScale": {
            "max": COACH_MAX,
            "labels": [[key, label] for key, label in COACH_RATING_LABELS],
            "tiers": [[floor, label] for floor, label in COACH_TIERS],
        },
        "scale": {
            "min": SCALE_MIN,
            "max": SCALE_MAX,
            "average": LEAGUE_AVERAGE,
            "tiers": [[floor, label] for floor, label in RATING_TIERS],
        },
        "statColumns": [
            {"key": key, "label": label, "perGame": per_game}
            for key, label, per_game in STAT_COLUMNS
        ],
    }


def team_summary(team) -> dict:
    """A team without its roster: enough for a schedule row or a picker."""
    return {
        "id": team.id,
        "abbr": team.abbreviation,
        "city": team.city,
        "name": team.name,
        "conference": team.conference,
        "coach": team.coach.to_dict() if team.coach else None,
        "chemistry": round(team.team_chemistry, 1),
        "tactics": team.tactics.to_dict(),
    }


def group_summaries(ratings) -> dict[str, dict]:
    """A star rating for each attribute group, so a squad page can be read.

    Eighty-one numbers is a reference table, not a summary; a manager wants to
    know a player shoots at four stars and can open the group if he cares which
    eight attributes say so.

    The value is a plain **average of the attributes in that group** -- the ones
    actually listed underneath -- put through the same tier-to-stars mapping as
    everything else. Deliberately not the engine's composite weighting: a
    composite answers "how well does he finish at the rim", which is a different
    question from "what is his Shooting section worth", and showing a heading
    whose number disagreed with the rows under it would be worse than useless.
    """
    summaries = {}
    for group, keys in ATTRIBUTE_GROUPS.items():
        values = [getattr(ratings, key) for key in keys if hasattr(ratings, key)]
        if not values:
            continue
        average = sum(values) / len(values)
        summaries[group] = {
            "average": round(average, 1),
            "stars": stars_from_rating(average),
            "tier": tier_label(average),
        }
    return summaries


def player_detail(player) -> dict:
    return {
        "id": player.id,
        "name": player.name,
        "short": player.short_name,
        "pos": player.position.value,
        "age": player.age,
        "weight": player.weight_lbs,
        "jersey": player.jersey,
        "ovr": player.overall,
        "stars": player.stars,
        "potentialStars": player.potential_stars,
        "height": player.height,
        "bio": player.bio.to_dict(),
        "personality": player.personality,
        "tier": player.tier,
        "archetype": player.archetype.label if player.archetype else None,
        # Hidden in a real save. Shipped here so the squad page can show what a
        # scouting department would eventually work out.
        "ability": player.ability.to_dict(),
        "scouting": scout(player.ability, player.age, accuracy=0.65).to_dict(),
        "ratings": {k: round(v, 1) for k, v in player.ratings.to_dict().items()},
        "tendencies": {k: round(v, 1) for k, v in player.tendencies.to_dict().items()},
        "hidden": {k: round(v, 1) for k, v in player.hidden.to_dict().items()},
        "composites": {k: round(fn(player), 1) for k, fn in EXPORTED_COMPOSITES.items()},
        # One star rating per attribute group, so the squad page leads with a
        # summary and the 81 numbers sit behind it.
        "groupStars": group_summaries(player.ratings),
    }


def team_squad(team) -> dict:
    """A team with its full roster. The heavy one -- fetched per team."""
    chemistry = evaluate_chemistry(team, Lineup(team.starters()))
    data = team_summary(team)
    data["lineupChemistry"] = chemistry.to_dict()
    data["players"] = [player_detail(p) for p in team.players]
    return data


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


def event_row(event) -> list:
    """One event as a positional row. Field order is the contract with the UI."""
    return [
        event.period,
        event.clock,
        round(event.game_seconds, 1),
        CODE_BY_TYPE[event.type.value],
        event.description,
        event.home_score,
        event.away_score,
        event.team_id or "",
        event.player_id or "",
        event.secondary_player_id or "",
        event.detail.get("points", 0),
        event_flags(event),
    ]


def revealed_score(game, league) -> tuple[int, int]:
    """The score as of the tracker clock, for a game still being played.

    The engine simulates a game in full the moment it tips off, so
    `result.home_score` is the *final* score from the first second. Reporting
    that for a live game puts the result in the schedule rail while the tracker
    is still in the first quarter.
    """
    revealed = game.revealed_seconds(league.clock.now(), league.tracker_speed)
    home = away = 0
    for event in game.result.events:
        if event.game_seconds > revealed:
            break
        home, away = event.home_score, event.away_score
    return home, away


def game_summary(game, league=None) -> dict:
    """A fixture as the schedule rail reads it, played or not.

    `detailed` is always false here, and that is not a placeholder: it means
    "this object carries no play-by-play", which is the only thing the front
    end can act on. Whether the events exist somewhere is a different question,
    answered by asking for the detail.
    """
    result = game.result
    data = {
        "id": game.id,
        "tipoff": game.tipoff_at.isoformat(),
        "round": game.round_label,
        "home": game.home_team_id,
        "away": game.away_team_id,
        "status": game.status.value,
        "detailed": False,
    }
    if result is not None:
        live = game.status == GameStatus.LIVE and league is not None
        home, away = revealed_score(game, league) if live else (
            result.home_score, result.away_score
        )
        data["homeScore"] = home
        data["awayScore"] = away
        data["periods"] = result.periods_played
    return data


LEADER_STATS = (("points", "PTS"), ("assists", "AST"), ("rebounds", "REB"))


def team_leaders(league, team_id: str) -> dict:
    """A team's record and its per-game leaders in points, assists, rebounds.

    Early in a season nobody has a stat line, and a preview of three blanks
    tells a manager nothing. So a team that has not played yet falls back to
    its best-rated player, *labelled as such* -- `basis` is "played" or
    "rated". Dressing a rating up as a scoring average would be worse than
    showing nothing.
    """
    row = league.standings.get(team_id)
    record = {
        "wins": row.wins if row else 0,
        "losses": row.losses if row else 0,
        "games": row.games_played if row else 0,
    }

    lines = [line for line in league.stats.players.values()
             if line.team_id == team_id and line.games > 0]
    if not lines:
        team = league.teams.get(team_id)
        best = max(team.players, key=lambda p: p.current_ability) if team and team.players else None
        return {
            **record,
            "basis": "rated",
            "leaders": [] if best is None else [{
                "stat": "TOP", "label": "Top rated",
                "name": best.short_name, "value": best.stars, "unit": "stars",
            }],
        }

    leaders = []
    for key, label in LEADER_STATS:
        best = max(lines, key=lambda line: line.per_game(key))
        leaders.append({
            "stat": label,
            "label": label,
            "name": best.name,
            "value": round(best.per_game(key), 1),
            "unit": "pg",
        })
    return {**record, "basis": "played", "leaders": leaders}


def game_preview(game, league) -> dict:
    """A fixture with both sides' records and stat leaders attached."""
    data = game_summary(game, league)
    data["preview"] = {
        "home": team_leaders(league, game.home_team_id),
        "away": team_leaders(league, game.away_team_id),
    }
    return data


def focus_day(league):
    """Which day the schedule shows: today, or the last day that has games.

    The live app sits inside its season, so "today" is the sim clock's date.
    A finished season -- the published demo, or a league played out to the end
    -- has no games today, and an empty schedule would be a worse answer than
    the last day that was actually played.
    """
    today = league.clock.now().astimezone(PACIFIC).date()
    days = sorted({g.tipoff_at.astimezone(PACIFIC).date() for g in league.schedule})
    if not days:
        return today
    if today in days:
        return today
    past = [d for d in days if d < today]
    return past[-1] if past else days[0]


def day_schedule(league, day=None) -> dict:
    """One day's fixtures, each with a preview. This is the schedule rail."""
    day = day or focus_day(league)
    games = [
        g for g in league.schedule
        if g.tipoff_at.astimezone(PACIFIC).date() == day
    ]
    return {
        "date": day.isoformat(),
        "label": day.strftime("%A %-d %B %Y"),
        "games": [game_preview(g, league) for g in games],
    }


def game_detail(game, league, revealed_only: bool = True) -> dict:
    """One game with everything the tracker needs.

    `revealed_only` keeps a live game honest: the engine simulates the whole
    thing at tip-off, so the events exist -- but handing them all over would
    let the page show the ending before it has happened.
    """
    data = game_summary(game, league)
    result = game.result
    if result is None:
        return data

    home = league.teams.get(game.home_team_id)
    away = league.teams.get(game.away_team_id)
    data.update({
        "homeStarters": [p.id for p in home.starters()] if home else [],
        "awayStarters": [p.id for p in away.starters()] if away else [],
        "homeLine": result.home_box.points_by_period,
        "awayLine": result.away_box.points_by_period,
        "duration": round(result.duration_game_seconds, 1),
        "homeBox": result.home_box.to_dict(),
        "awayBox": result.away_box.to_dict(),
    })

    events = result.events
    if revealed_only and game.status == GameStatus.LIVE:
        revealed = game.revealed_seconds(league.clock.now(), league.tracker_speed)
        events = [e for e in events if e.game_seconds <= revealed]
    data["events"] = [event_row(e) for e in events]
    data["detailed"] = bool(events)
    data["live"] = game.status == GameStatus.LIVE
    return data


def bootstrap(league, minimum_games: int = 1) -> dict:
    """Everything the app needs to paint every screen except a squad page.

    Rosters are excluded on purpose: 360 players with 81 attributes each is
    about four megabytes, and most visits never open a squad.
    """
    payload = metadata()
    payload.update({
        "league": {
            "name": league.name,
            "season": league.season,
            "now": league.clock.now().isoformat(),
            "trackerSpeed": league.tracker_speed,
        },
        "live": True,
        "teams": [team_summary(t) for t in league.teams.values()],
        # The schedule shows one day. Sending all 1,230 fixtures to render 45
        # of them was most of the bootstrap's weight.
        "day": day_schedule(league),
        "season_totals": {
            "fixtures": len(league.schedule),
            "played": sum(1 for g in league.schedule if g.status == GameStatus.FINAL),
        },
        "standings": league.standings_table(),
        "playerStats": [
            {k: v for k, v in row.items() if k != "totals"}
            for row in league.stats.player_table(minimum_games=minimum_games)
        ],
        "teamStats": league.stats.team_table(),
    })
    return payload
