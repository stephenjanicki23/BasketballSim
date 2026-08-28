"""The awards watch: who is in contention, and nothing about who is winning.

The season's individual honours, shown as a watch. For each one it names the
field and stops there -- no vote count, no share, no leaderboard. Who wins is
found out when the season ends and `accolades.py` reads it off the archives,
the same way nobody is an All-Star until tip-off.

Two kinds of award live here.

  * **List awards** -- Most Valuable Player, the Scoring Title, Sixth Man of the
    Year, Coach of the Year -- name a shortlist of contenders, sorted
    alphabetically so the order they were selected in never reaches the page.
  * **Team awards** -- All-League, All-Defensive, All-Rookie -- are named as a
    First Team and a Second Team, one player at each of the five positions,
    which is the shape those honours actually take. The First/Second split is
    the award's own structure, not a vote tally; no numbers say who is ahead.

**Everything is derived from what happened, never from a rating.**

  * A player's All-League value is his win shares and VORP -- how much he did
    to win games -- the same advanced lines the MVP panel reads.
  * All-Defensive value is defensive win shares and defensive box plus-minus,
    plus the stops a box score records: steals and blocks. This is why the
    rebounding and playmaking titles were dropped -- an award decided on total
    rebounds is a leaderboard, and a defensive team is the more interesting
    thing that data can honestly support.
  * A rookie is a player whose draft class is the one that entered this season
    (`bio.draft.year`), the same test the newsroom's rookie wire uses.
  * A sixth man is the best reserve -- a productive player who is **not** among
    his club's top five by minutes. The engine does not record who started, so
    "started on the bench" is read from minutes, which is the honest proxy: a
    club's five biggest-minute men are its starters, and the best of the rest
    is its sixth man.
  * A coach's case is his club's record this season, from the standings.

Selecting a field is not the same as ranking it. The value scores decide who is
even in contention; the names then come out sorted, and for the list awards the
order is gone entirely.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import mvp
from .lineup import POSITIONS

# How many names a list award carries, and how deep a team award's bench pool is
# allowed to reach when a position is thin.
LIST_CONTENDERS = 6
SIXTH_MAN_CONTENDERS = 6
COACH_CONTENDERS = 6

# A club's five biggest-minute players are treated as its starters; everyone
# else is a reserve. Not stored anywhere -- see the module docstring for why
# minutes are the honest stand-in for a start.
STARTERS_PER_CLUB = 5

# A reserve needs to have actually played to be a sixth-man candidate: a fifth
# of a starter's minutes, so a garbage-time body does not qualify.
SIXTH_MAN_MIN_MPG = 12.0


# --------------------------------------------------------------------------
# One player on a card
# --------------------------------------------------------------------------

@dataclass
class Slot:
    player_id: str
    name: str
    team_id: str
    position: str
    line: str

    def to_dict(self) -> dict:
        return {
            "playerId": self.player_id,
            "name": self.name,
            "teamId": self.team_id,
            "position": self.position,
            "line": self.line,
        }


def _per_game(row: dict, key: str) -> float:
    return (row.get(key, 0) or 0) / max(1, int(row.get("games", 0) or 0))


def _scoring_line(row: dict) -> str:
    return (f"{_per_game(row, 'points'):.1f} pts, "
            f"{_per_game(row, 'rebounds'):.1f} reb, "
            f"{_per_game(row, 'assists'):.1f} ast")


def _defensive_line(row: dict) -> str:
    return (f"{_per_game(row, 'steals'):.1f} stl, "
            f"{_per_game(row, 'blocks'):.1f} blk, "
            f"{_per_game(row, 'rebounds'):.1f} reb")


def _slot(row: dict, line=_scoring_line) -> Slot:
    return Slot(
        player_id=row.get("player_id", ""),
        name=row.get("name", ""),
        team_id=row.get("team_id", ""),
        position=row.get("position", ""),
        line=line(row),
    )


# --------------------------------------------------------------------------
# Value scores -- all read off the advanced line, none off a rating
# --------------------------------------------------------------------------

def _value(row: dict) -> float:
    """All-League value: how much he did to win. Win shares carry it, VORP
    breaks the ties -- the same quantities the MVP panel weighs."""
    return float(row.get("ws", 0) or 0) + 0.5 * float(row.get("vorp", 0) or 0)


def _defense(row: dict) -> float:
    """All-Defensive value: defensive win shares and defensive box plus-minus,
    lifted by the stops a box score actually counts."""
    games = max(1, int(row.get("games", 0) or 0))
    stops = (float(row.get("steals", 0) or 0)
             + float(row.get("blocks", 0) or 0)) / games
    return (2.0 * float(row.get("dws", 0) or 0)
            + float(row.get("dbpm", 0) or 0)
            + stops * 0.6)


def _sixth_man_value(row: dict) -> float:
    """A reserve's case: scoring and efficiency off the bench. PER is the single
    number that rewards a productive scorer without punishing his minutes."""
    return float(row.get("per", 0) or 0) + _per_game(row, "points") * 0.5


# --------------------------------------------------------------------------
# Building a two-team, one-per-position award
# --------------------------------------------------------------------------

def _teams(rows: list[dict], score, line=_scoring_line, teams: int = 2) -> list[dict]:
    """First team, then second, one player at each position.

    Greedy by score within a position: the strongest available at each position
    fills the first team, the next fills the second. A position with only one
    qualifier fills the first team and leaves the second open rather than
    inventing a name for it.
    """
    by_position: dict[str, list[dict]] = {p: [] for p in POSITIONS}
    for row in rows:
        position = row.get("position", "")
        if position in by_position:
            by_position[position].append(row)
    for position in by_position:
        by_position[position].sort(key=score, reverse=True)

    out = []
    labels = ["First Team", "Second Team", "Third Team"]
    for tier in range(teams):
        players = []
        for position in POSITIONS:
            pool = by_position[position]
            if len(pool) > tier:
                players.append(_slot(pool[tier], line).to_dict())
        out.append({"tier": labels[tier], "players": players})
    return out


# --------------------------------------------------------------------------
# Rookies, reserves and coaches
# --------------------------------------------------------------------------

def _rookie_ids(league) -> set[str]:
    """Everyone whose draft class is the one that entered this season.

    The newest draft year on any roster, exactly as `news._draft_year` reads it,
    so the rookie wire and the All-Rookie team agree on who is a rookie.
    """
    years = [p.bio.draft.year
             for team in league.teams.values()
             for p in team.players
             if getattr(p, "bio", None) and p.bio.draft is not None]
    if not years:
        return set()
    newest = max(years)
    return {p.id
            for team in league.teams.values()
            for p in team.players
            if getattr(p, "bio", None) and p.bio.draft is not None
            and p.bio.draft.year == newest}


def _reserves(rows: list[dict]) -> list[dict]:
    """Every qualifying player who is not among his club's top five by minutes.

    Grouped by club, ranked by total minutes; the bottom of each rotation is the
    bench. Minutes are the proxy for a start -- see the module docstring.
    """
    by_club: dict[str, list[dict]] = {}
    for row in rows:
        by_club.setdefault(row.get("team_id", ""), []).append(row)
    reserves = []
    for club_rows in by_club.values():
        club_rows.sort(key=lambda r: r.get("minutes", 0), reverse=True)
        for row in club_rows[STARTERS_PER_CLUB:]:
            games = max(1, int(row.get("games", 0) or 0))
            if (row.get("minutes", 0) / games) / 60.0 >= 0 and \
               _per_game(row, "minutes") >= SIXTH_MAN_MIN_MPG:
                reserves.append(row)
    return reserves


def _coach_field(league) -> list[dict]:
    """The coaches in the Coach-of-the-Year conversation: the clubs winning now.

    Read straight off the standings -- a coach's case is his record. Ranked to
    pick the field, then handed on to be sorted by name like every other list.
    """
    table = league.standings_table()
    table = [row for row in table if (row.get("wins", 0) + row.get("losses", 0)) > 0]
    table.sort(key=lambda r: r.get("win_pct", 0.0), reverse=True)
    field_rows = []
    for row in table[:COACH_CONTENDERS]:
        team = league.teams.get(row.get("team_id"))
        coach = getattr(team, "coach", None) if team else None
        if coach is None:
            continue
        field_rows.append({
            "playerId": coach.id,
            "name": coach.name,
            "teamId": row.get("team_id", ""),
            "position": "",
            "line": f"{row.get('wins', 0)}-{row.get('losses', 0)}",
        })
    return field_rows


# --------------------------------------------------------------------------
# The watch
# --------------------------------------------------------------------------

def _list_award(award_id, name, basis, slots, line_kind="scoring") -> dict:
    return {
        "id": award_id,
        "name": name,
        "basis": basis,
        "format": "list",
        # Alphabetical -- the selection order, which would reveal the standing,
        # does not survive.
        "contenders": sorted((s if isinstance(s, dict) else s.to_dict()
                              for s in slots), key=lambda c: c["name"]),
    }


def _team_award(award_id, name, basis, teams) -> dict:
    return {
        "id": award_id, "name": name, "basis": basis,
        "format": "teams", "teams": teams,
    }


def watch(league) -> dict:
    awards: list[dict] = []
    minimum = mvp.minimum_games(league)
    rows = mvp._candidate_rows(league, minimum)
    open_race = mvp.is_open(league) and bool(rows)

    if open_race:
        pool = sorted(rows, key=_value, reverse=True)

        awards.append(_list_award(
            "mvp", "Most Valuable Player",
            "The ten-writer panel's pick for the league's best season.",
            [_slot(r) for r in pool[:LIST_CONTENDERS]]))

        awards.append(_team_award(
            "all_league", "All-League Team",
            "The best at each position, first team and second.",
            _teams(rows, _value)))

        awards.append(_team_award(
            "all_defense", "All-Defensive Team",
            "The best defender at each position — defensive win shares, "
            "steals and blocks, never total rebounds.",
            _teams(rows, _defense, line=_defensive_line)))

        rookies = _rookie_ids(league)
        rookie_rows = [r for r in rows if r.get("player_id") in rookies]
        if rookie_rows:
            awards.append(_team_award(
                "all_rookie", "All-Rookie Team",
                "The best first-year player at each position.",
                _teams(rookie_rows, _value)))

        reserves = _reserves(rows)
        if reserves:
            best = sorted(reserves, key=_sixth_man_value, reverse=True)[:SIXTH_MAN_CONTENDERS]
            awards.append(_list_award(
                "sixth_man", "Sixth Man of the Year",
                "The best player who comes off the bench — outside his club's "
                "top five by minutes.",
                [_slot(r) for r in best]))

        # The scoring title stays; rebounding and playmaking are gone, replaced
        # by the All-Defensive team.
        scorers = sorted(rows, key=lambda r: _per_game(r, "points"),
                         reverse=True)[:LIST_CONTENDERS]
        awards.append(_list_award(
            "scoring_title", "Scoring Title",
            "Most points per game across the season.",
            [_slot(r) for r in scorers]))

    coaches = _coach_field(league) if open_race else []
    if coaches:
        awards.append(_list_award(
            "coach", "Coach of the Year",
            "The coach whose club has the season's best record.",
            coaches, line_kind="record"))

    return {
        "open": bool(awards),
        "note": (
            "A watch list, not a leaderboard. These are the players and coaches "
            "in contention for each award — no vote, no standing, no favourite. "
            "The team awards name a first and second team by position; the "
            "winners are all announced when the season ends."
        ),
        "minimumGames": minimum,
        "awards": awards,
    }
