"""What a player has actually won.

Championships, awards, statistical titles, league records and career
milestones -- every one of them **derived**, none of them stored. A trophy in
this module is a fact recomputed from the archives each time it is asked for,
which is the same discipline the standings, the MVP race and the record book
follow. An honours list written down at the moment it was earned would drift
from the seasons behind it the first time a formula changed.

**The archives are what make this possible at all.** `offseason.SeasonArchive`
keeps each finished season's player totals, team totals, final table and
champion. That is enough to answer, years later:

    was he on the roster that won it        his team_id in that season's totals
    who was MVP in 2027-28                  run the actual ten-voter panel on
                                            that season's actual totals
    who led the league in scoring           per-game leader, with a games floor
    what has he done in total               sum his archived seasons

**MVP is re-voted, not remembered.** `mvp.rows_from` was split out of the live
race so history can be scored by the same ten writers reading the same columns.
A separate "historical MVP" formula would have been a second opinion wearing
the same name, and it would have disagreed with the live tab the first time a
voter was edited.

**All-Star selections are the one honour here that is read rather than
recomputed**, and the exception proves the rule. Everything else on this page
is answerable from the archives forever: who won the title is who won the
title. A vote is not like that -- it closes at tip-off, and the standing it
closed on stops existing the moment the season moves past it. Re-deriving the
2027-28 side from 2031-32 would name a different twelve, so `allstar.py` writes
the roster down and this module reads it back. See its docstring for the
argument in full.

**What is deliberately absent.** There is no Defensive Player of the Year, no
Rookie of the Year and no Finals MVP, because none of those mechanisms exist in
the simulation -- and an award handed out by a formula nobody can see is not an
award, it is a label. All-League selections *are* derived, because they are
exactly "the panel's top five", which the panel really does produce.

Postseason honours stop at the team. `SeasonStats` does not separate playoff
games from regular-season ones, so "averaged 30 in the Finals" is not a
question this league can answer -- see `docs/TRADES.md`, which records the same
gap for trade valuation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import mvp, records

# How many places on a ballot count as an All-League selection. Five, because
# that is what a ballot has -- this is the panel's own top five, not a new
# award invented on top of it.
ALL_LEAGUE_PLACES = 5

# A statistical title needs a real season behind it, on the same argument as
# the record book's rate qualifier: leading the league in scoring across four
# games is not leading the league in scoring.
TITLE_MINIMUM_SHARE = 0.55

# Career marks worth a badge. Chosen to be *reachable but not routine* in a
# league that plays 82 games: a 20-point scorer needs six seasons to reach
# 10,000, which is roughly what it should mean.
MILESTONES: tuple[tuple[str, str, int, str], ...] = (
    ("points_5k", "5,000 Points", 5_000, "points"),
    ("points_10k", "10,000 Points", 10_000, "points"),
    ("points_20k", "20,000 Points", 20_000, "points"),
    ("rebounds_3k", "3,000 Rebounds", 3_000, "rebounds"),
    ("rebounds_7k", "7,000 Rebounds", 7_000, "rebounds"),
    ("assists_2k", "2,000 Assists", 2_000, "assists"),
    ("assists_5k", "5,000 Assists", 5_000, "assists"),
    ("threes_1k", "1,000 Threes", 1_000, "tpm"),
    ("games_500", "500 Games", 500, "games"),
    ("games_1000", "1,000 Games", 1_000, "games"),
)

# The statistical titles worth showing, and what each reads.
TITLES: tuple[tuple[str, str, str], ...] = (
    ("scoring_title", "Scoring Title", "points"),
    ("rebounding_title", "Rebounding Title", "rebounds"),
    ("assists_title", "Assists Title", "assists"),
)


@dataclass
class Accolade:
    """One honour, and every season it was won.

    `count` is len(seasons) for anything repeatable and 1 for a milestone,
    which is a threshold crossed once rather than a thing won.
    """

    id: str
    label: str
    icon: str
    seasons: list[str] = field(default_factory=list)
    detail: str = ""
    # "major" earns a place on the shelf at full size; "minor" is a chip.
    tier: str = "major"

    @property
    def count(self) -> int:
        return max(1, len(self.seasons))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "icon": self.icon,
            "seasons": list(self.seasons),
            "count": self.count,
            "detail": self.detail,
            "tier": self.tier,
        }


# --------------------------------------------------------------------------
# Reading a season, live or archived
# --------------------------------------------------------------------------

@dataclass
class Season:
    """One season reduced to what an honours list needs."""

    label: str
    stats: object                 # SeasonStats
    standings: list              # list of standings rows, as dicts
    champion: str | None = None
    runner_up: str | None = None
    complete: bool = True


def _standings_rows(league) -> list[dict]:
    return league.standings_table()


def seasons_of(league) -> list[Season]:
    """Every season the league can still read, oldest first.

    The live season is included only when it is *finished*. A title cannot be
    awarded in January, and showing a provisional one would mean an honours
    list that takes things away again -- the worst possible behaviour for a
    trophy cabinet.
    """
    from .league import offseason, playoffs

    out = [
        Season(label=archive.season, stats=archive.stats,
               standings=archive.standings, champion=archive.champion,
               runner_up=archive.runner_up)
        for archive in (getattr(league, "history", []) or [])
    ]
    if offseason.is_finished(league):
        finals = playoffs.series_in(league, playoffs.KEYSTONE_FINALS)
        out.append(Season(
            label=league.season, stats=league.stats,
            standings=_standings_rows(league),
            champion=playoffs.champion(league),
            runner_up=finals[0].loser if finals else None,
        ))
    return out


def _games_in(season: Season) -> int:
    """Games per club that season, read off the team totals."""
    played = [line.games for line in season.stats.teams.values() if line.games]
    return max(played) if played else 82


# --------------------------------------------------------------------------
# The honours themselves
# --------------------------------------------------------------------------

def _champions(season: Season) -> tuple[set[str], set[str]]:
    """(title winners, runners-up) as player ids for one season.

    A player counts as a champion if his club that season was the club that
    won it. That is exactly what the archive can support: it stores which club
    each player's totals belong to, so a man traded in February is credited to
    the club he finished with -- which is also who gave him a ring.
    """
    won, lost = set(), set()
    for line in season.stats.players.values():
        if not line.games:
            continue
        if season.champion and line.team_id == season.champion:
            won.add(line.player_id)
        elif season.runner_up and line.team_id == season.runner_up:
            lost.add(line.player_id)
    return won, lost


def _vote(season: Season) -> list:
    """The ten-writer panel, run over one season. Returns tallied contenders."""
    minimum = max(1, int(_games_in(season) * mvp.MIN_GAMES_SHARE))
    rows = mvp.rows_from(season.stats, season.standings, minimum)
    if len(rows) < mvp.BALLOT_PLACES:
        return []
    return mvp.tally([mvp.cast(voter, rows) for voter in mvp.PANEL])


def _titles(season: Season) -> dict[str, str]:
    """Which player led the league in each counting stat, per game."""
    minimum = max(1, int(_games_in(season) * TITLE_MINIMUM_SHARE))
    eligible = [line for line in season.stats.players.values()
                if line.games >= minimum]
    out: dict[str, str] = {}
    for key, _label, stat in TITLES:
        if not eligible:
            continue
        leader = max(eligible,
                     key=lambda l: (getattr(l, stat) / l.games, l.player_id))
        out[key] = leader.player_id
    return out


def career_totals(league, player_id: str) -> dict:
    """Every season this player has played, added up.

    Includes the season in progress, because a milestone is a running total and
    a page that ignored tonight's game would be wrong by the thing the reader
    just watched.
    """
    totals = {"games": 0, "points": 0, "rebounds": 0, "assists": 0,
              "steals": 0, "blocks": 0, "tpm": 0, "seasons": 0}
    sources = [archive.stats for archive in (getattr(league, "history", []) or [])]
    if getattr(league, "stats", None) is not None:
        sources.append(league.stats)
    for stats in sources:
        line = stats.players.get(player_id)
        if line is None or not line.games:
            continue
        totals["seasons"] += 1
        for key in ("games", "points", "assists", "steals", "blocks", "tpm"):
            totals[key] += getattr(line, key)
        totals["rebounds"] += line.rebounds
    return totals


# --------------------------------------------------------------------------
# Memoised, because a squad page asks for twelve of these at once
# --------------------------------------------------------------------------

def _league_honours(league) -> dict[str, dict]:
    """Every player's honours, worked out in one pass over the archives.

    Per-player would re-vote every season for every man on a roster -- twelve
    players times however many seasons, each running a ten-voter panel. One
    pass, cached against the shape of the league's history.
    """
    signature = (len(getattr(league, "history", []) or []),
                 getattr(league, "season", ""),
                 sum(line.games for line in league.stats.players.values())
                 if getattr(league, "stats", None) else 0,
                 # An All-Star Game being played adds honours without adding a
                 # game to anyone's totals, so it has to be in the signature or
                 # the shelf would not change until the next tip-off.
                 sum(1 for g in (getattr(league, "allstar", None) or {}).values()
                     if g.played))
    cached = getattr(league, "_accolades_cache", None)
    if cached is not None and cached[0] == signature:
        return cached[1]

    out: dict[str, dict] = {}

    def bucket(pid: str) -> dict:
        return out.setdefault(pid, {"rings": [], "finals": [], "mvp": [],
                                    "all_league": [], "titles": {},
                                    "all_star": [], "all_star_start": [],
                                    "all_star_mvp": []})

    for season in seasons_of(league):
        won, lost = _champions(season)
        for pid in won:
            bucket(pid)["rings"].append(season.label)
        for pid in lost:
            bucket(pid)["finals"].append(season.label)

        board = _vote(season)
        for place, contender in enumerate(board[:ALL_LEAGUE_PLACES]):
            entry = bucket(contender.player_id)
            if place == 0:
                entry["mvp"].append(season.label)
            entry["all_league"].append(season.label)

        for key, pid in _titles(season).items():
            bucket(pid)["titles"].setdefault(key, []).append(season.label)

    # All-Star sides, read from what was stored rather than re-voted. Only a
    # game that has been played has a roster: until tip-off there is a vote and
    # nobody is an All-Star yet, which is what makes the run-up a race.
    for game in sorted((getattr(league, "allstar", None) or {}).values(),
                       key=lambda g: g.season):
        if not game.played:
            continue
        for rows in game.rosters.values():
            for row in rows:
                entry = bucket(row["playerId"])
                entry["all_star"].append(game.season)
                if row.get("starter"):
                    entry["all_star_start"].append(game.season)
        if game.mvp_id:
            bucket(game.mvp_id)["all_star_mvp"].append(game.season)

    for pid, labels in _record_holders(league).items():
        bucket(pid)["records"] = labels

    league._accolades_cache = (signature, out)
    return out


def _record_holders(league) -> dict[str, list[str]]:
    """Who holds each league record outright, in one pass.

    Read from `records.py` rather than recomputed, so a badge and the record
    book cannot disagree about who holds what. Built for the whole league at
    once and cached with the rest: asking per player meant rebuilding every
    season record thirty times over on a squad page, which was most of a
    fourteen-second call.
    """
    held: dict[str, list[str]] = {}
    book = records.book(league)
    for half in ("game", "season"):
        for section in book[half]["players"]:
            marks = section["marks"]
            if not marks:
                continue
            kind = "single game" if half == "game" else "season"
            held.setdefault(marks[0]["holderId"], []).append(
                f"{section['label']} ({kind})")
    return held


def for_player(league, player) -> list[dict]:
    """This player's honours, best first.

    Ordered by what a reader looks for: rings, then MVPs, then selections,
    then titles, then records, then milestones. Not by count -- three scoring
    titles do not outrank a championship.
    """
    honours = _league_honours(league).get(player.id, {})
    out: list[Accolade] = []

    rings = honours.get("rings") or []
    if rings:
        out.append(Accolade("championship", "Champion", "trophy", list(rings),
                            detail=", ".join(rings)))
    finals = [s for s in (honours.get("finals") or [])]
    if finals:
        out.append(Accolade("finals", "Finals Appearance", "banner", finals,
                            detail=", ".join(finals), tier="minor"))
    won_mvp = honours.get("mvp") or []
    if won_mvp:
        out.append(Accolade("mvp", "Most Valuable Player", "crown", won_mvp,
                            detail=", ".join(won_mvp)))
    selections = [s for s in (honours.get("all_league") or []) if s not in won_mvp]
    if selections:
        out.append(Accolade("all_league", "All-League Team", "star", selections,
                            detail=", ".join(selections)))

    all_star = honours.get("all_star") or []
    if all_star:
        starts = honours.get("all_star_start") or []
        detail = ", ".join(all_star)
        if starts:
            detail += f" -- started {len(starts)}"
        out.append(Accolade("all_star", "All-Star", "allstar", all_star,
                            detail=detail))
    game_mvp = honours.get("all_star_mvp") or []
    if game_mvp:
        out.append(Accolade("all_star_mvp", "All-Star Game MVP", "allstar_mvp",
                            game_mvp, detail=", ".join(game_mvp)))

    for key, label, _stat in TITLES:
        seasons = (honours.get("titles") or {}).get(key) or []
        if seasons:
            out.append(Accolade(key, label, key, seasons,
                                detail=", ".join(seasons)))

    held = honours.get("records") or []
    if held:
        out.append(Accolade("record", "League Record", "plaque",
                            detail="; ".join(held)))

    totals = career_totals(league, player.id)
    for key, label, threshold, stat in MILESTONES:
        if totals.get(stat, 0) >= threshold:
            out.append(Accolade(key, label, "milestone",
                                detail=f"{totals[stat]:,} career {stat}",
                                tier="minor"))

    return [a.to_dict() for a in out]
