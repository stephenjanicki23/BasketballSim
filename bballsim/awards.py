"""The awards watch: who is in contention, and nothing about who is winning.

This is the season's individual honours -- Most Valuable Player, the All-League
team, the scoring, rebounding and playmaking titles -- shown as a **watch
list**. For each one it names the players in the conversation, and it stops
there. No vote count, no vote share, no ranking, no "front-runner" marker,
nothing that says who is ahead.

That restraint is the whole point, and it is deliberate. The winner is a thing
to be found out when the season ends and `accolades.py` reads it off the
archives -- the same way nobody is an All-Star until tip-off and a draft
prospect's ceiling stays hidden until he plays. An awards page that printed the
standing would answer the question the season is there to answer.

**Selecting a shortlist is not the same as ranking it.** To decide who is even
in contention, the panel and the leaderboards have to be consulted -- there is
no other way to know a fringe rotation player is not an MVP candidate. So the
contenders are chosen by the real machinery (`mvp.tally` for the voted awards,
the season leaders for the statistical ones) and then **sorted by name** before
they leave this module. The reader sees the field; the order it was picked in
never reaches them.

**Every award is honest about its own basis.** The voted awards -- MVP and
All-League -- are the panel's pool. The statistical titles are the season
leaders in a counting stat, and those a reader can of course infer from a box
score; the watch does not pretend otherwise, it simply declines to rank them.
There is no Defensive Player of the Year and no Rookie of the Year here, for
the reason `accolades.py` gives: the simulation has no mechanism for them, and
an award with no machinery behind it is a label, not an award.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import mvp

# How many names each award carries. Enough to be a field, few enough that the
# list is a shortlist rather than a leaderboard in disguise.
MVP_CONTENDERS = 6
ALL_LEAGUE_CONTENDERS = 10
STAT_CONTENDERS = 5

# The statistical titles, and the per-game stat each is decided on. Mirrors
# `accolades.TITLES`, because these are the same awards seen from the other end
# of the season -- a watch now, a badge when it is won.
STAT_TITLES = (
    ("scoring_title", "Scoring Title", "points",
     "Most points per game across the season."),
    ("rebounding_title", "Rebounding Title", "rebounds",
     "Most rebounds per game across the season."),
    ("playmaking_title", "Playmaking Title", "assists",
     "Most assists per game across the season."),
)


@dataclass
class Contender:
    """One name on a watch list. A line of context, and not one number that
    says he is ahead."""

    player_id: str
    name: str
    team_id: str
    position: str
    points: float
    rebounds: float
    assists: float

    def to_dict(self) -> dict:
        return {
            "playerId": self.player_id,
            "name": self.name,
            "teamId": self.team_id,
            "position": self.position,
            # The same neutral three-stat line for every award, so a card reads
            # as "here is the player", not "here is why he leads". No vote, no
            # share, no rank.
            "line": f"{self.points:.1f} pts, {self.rebounds:.1f} reb, "
                    f"{self.assists:.1f} ast",
        }


@dataclass
class Award:
    id: str
    name: str
    basis: str
    contenders: list[Contender] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "basis": self.basis,
            # Alphabetical. The order they were selected in -- which is the
            # order that would reveal the standing -- does not survive this.
            "contenders": [c.to_dict() for c in
                           sorted(self.contenders, key=lambda c: c.name)],
        }


def _contender(row: dict) -> Contender:
    games = max(1, int(row.get("games", 0) or 0))
    return Contender(
        player_id=row.get("player_id") or row.get("playerId", ""),
        name=row.get("name", ""),
        team_id=row.get("team_id") or row.get("teamId", ""),
        position=row.get("position", ""),
        points=(row.get("points", 0) or 0) / games,
        rebounds=(row.get("rebounds", 0) or 0) / games,
        assists=(row.get("assists", 0) or 0) / games,
    )


def _voted_pool(league) -> list[dict]:
    """The players the panel is actually weighing, most-considered first.

    `mvp.tally` is the real award's count. It is used here only to find out who
    is in the room -- the points it assigns are dropped, and the names come out
    of this module in alphabetical order.
    """
    contenders = mvp.tally(mvp.ballots(league))
    rows = []
    for contender in contenders:
        row = dict(contender.row)
        row.setdefault("player_id", contender.player_id)
        row.setdefault("name", contender.name)
        row.setdefault("team_id", contender.team_id)
        rows.append(row)
    return rows


def _stat_leaders(rows: list[dict], stat: str, count: int) -> list[dict]:
    """The season leaders in one counting stat, per game, over the games floor.

    Reads the same totals-based rows the voted awards use -- `_candidate_rows`
    carries season *totals*, and `_contender` divides by games, so both award
    kinds compute a per-game line the one way. An earlier version read the
    per-game `player_table` and divided a second time, which turned a scoring
    leader's 21.8 into 0.9. Ranked internally to pick the shortlist; the order
    is thrown away when the award is serialised and the names are sorted.
    """
    ranked = sorted(rows, key=lambda r: (r.get(stat, 0) or 0) / max(1, r.get("games", 1)),
                    reverse=True)
    return ranked[:count]


def watch(league) -> dict:
    """Every award, each with its field of contenders and no standing.

    Returns the same shape whether the race is wide open or nearly settled --
    because as far as this page is concerned it is never settled, only watched.
    """
    awards: list[Award] = []
    minimum = mvp.minimum_games(league)
    # Season totals for every qualifying player, the one table both kinds of
    # award are read from.
    qualifying = mvp._candidate_rows(league, minimum)

    if mvp.is_open(league):
        pool = _voted_pool(league)
        awards.append(Award(
            "mvp", "Most Valuable Player",
            "The ten-writer panel's pick for the league's best season.",
            [_contender(row) for row in pool[:MVP_CONTENDERS]]))
        awards.append(Award(
            "all_league", "All-League Team",
            "The five best at their positions, chosen by the same panel.",
            [_contender(row) for row in pool[:ALL_LEAGUE_CONTENDERS]]))

    for award_id, name, stat, basis in STAT_TITLES:
        leaders = _stat_leaders(qualifying, stat, STAT_CONTENDERS)
        if leaders:
            awards.append(Award(award_id, name, basis,
                                [_contender(row) for row in leaders]))

    return {
        "open": bool(awards),
        "note": (
            "A watch list, not a leaderboard. These are the players in "
            "contention for each award — no vote, no standing, no favourite. "
            "The winners are announced when the season ends."
        ),
        "minimumGames": mvp.minimum_games(league),
        "awards": [award.to_dict() for award in awards],
    }
