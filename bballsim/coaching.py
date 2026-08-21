"""What a coach has done, read off the seasons rather than his ratings.

A coach has seven hidden ratings -- offense, defense, tactics, development and
the rest -- and this page reads **none of them**. That is the whole design.
`coach.py` decides how a coach *influences* a game; this module reports what
actually *happened* across the seasons he has sat on the bench for, which is a
different and more honest thing to put in front of a reader. A rating is the
simulation's private opinion of a man. A record is his career.

**Everything here is derived, nothing is stored.** A coach's championships are
counted from the archives every time they are asked for, his style is measured
from how his teams actually played, and his trajectory is the slope of his own
results. The same discipline the standings, the record book and the scouting
cards all follow.

**It is honest to attribute a club's whole recorded history to its coach**
because in this league a coach does not move. He is assigned once and stays, so
every archived season the club has played, it played under him. If coaches ever
start changing teams, this attribution has to gain a per-season coach->club
map, and `tests/test_coaching.py` says so where it would break.

**Two halves, built the way the rest of the project builds them.**

  * *The record* comes from `league.history` -- each archived season's final
    table, its champion and its two conference winners. A club's finish in its
    own conference decides whether it made the postseason (top eight), and the
    champion and finalist fields decide how far it went. The season in progress
    is read from the live standings, so the page is current the day you open
    it.
  * *The style* comes from `SeasonStats.teams` -- how fast the club played, how
    much it shot from range, how it moved the ball, how it defended. These are
    box-score totals, not tendencies and not ratings: what the team did on the
    floor, which is the only fingerprint a coach leaves that a reader can check.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .conferences import conference_for
from .league import playoffs

# Top eight in each conference play on. Read from the same constant the bracket
# uses, so "made the playoffs" here and "is in the playoffs" there can never
# drift apart.
PLAYOFF_SEEDS = playoffs.SEEDS

# How many seasons of results it takes before a trajectory means anything. Two
# points make a line through noise; three is the shortest run that can bend.
TRAJECTORY_MINIMUM = 3

# The style axes, each a rate a box score can produce and a coach can shape.
# Defense is stored as points allowed and inverted at read time, so that a
# higher number is a better defence on every axis and the prose never has to
# remember which way one of them points.
STYLE_AXES = ("pace", "perimeter", "ball_movement", "defense", "offensive_glass")


@dataclass
class SeasonRow:
    """One season under this coach, as results rather than ratings."""

    season: str
    wins: int
    losses: int
    conference_rank: int
    made_playoffs: bool
    finish: str            # "Champions" | "Finals" | "Playoffs" | "Missed"
    complete: bool

    @property
    def games(self) -> int:
        return self.wins + self.losses

    @property
    def win_pct(self) -> float:
        return self.wins / self.games if self.games else 0.0

    def to_dict(self) -> dict:
        return {
            "season": self.season,
            "wins": self.wins,
            "losses": self.losses,
            "winPct": round(self.win_pct, 3),
            "conferenceRank": self.conference_rank,
            "madePlayoffs": self.made_playoffs,
            "finish": self.finish,
            "complete": self.complete,
        }


def _finish(team_id: str, standings: list[dict], champion, runner_up,
            conference_champions: dict) -> tuple[int, bool, str]:
    """Where a club finished, from what the archive actually stored.

    Only four outcomes are distinguishable from stored data: won it, lost the
    Finals, made the bracket, or missed. The rounds in between are not archived
    -- `SeasonArchive` keeps the champion and the two conference winners, not
    the semi-final board -- and inventing "lost in the second round" from data
    that does not exist would be exactly the kind of fiction the rest of this
    project refuses.
    """
    row = next((r for r in standings if r.get("team_id") == team_id), None)
    rank = row.get("conference_rank", 99) if row else 99
    made = bool(row.get("in_playoff_places")) if row else False
    finalists = set(conference_champions.values())
    if champion == team_id:
        return rank, True, "Champions"
    if runner_up == team_id or team_id in finalists:
        return rank, True, "Finals"
    if made:
        return rank, True, "Playoffs"
    return rank, False, "Missed"


def seasons_under(league, team_id: str) -> list[SeasonRow]:
    """Every season this club has recorded, oldest first.

    The archives, then the season in progress -- which carries a result only
    once the Finals are decided, and reads "in progress" until then.
    """
    rows: list[SeasonRow] = []
    for archive in getattr(league, "history", []) or []:
        rank, made, finish = _finish(
            team_id, archive.standings or [], archive.champion,
            archive.runner_up, archive.conference_champions or {})
        line = archive.stats.teams.get(team_id)
        wins = line.wins if line else 0
        losses = line.losses if line else 0
        rows.append(SeasonRow(archive.season, wins, losses, rank, made,
                              finish, complete=True))

    live = league.stats.teams.get(team_id)
    if live is not None:
        table = league.standings_table()
        current = next((r for r in table if r.get("team_id") == team_id), None)
        rank = current.get("conference_rank", 99) if current else 99
        made = bool(current.get("in_playoff_places")) if current else False
        rows.append(SeasonRow(league.season, live.wins, live.losses, rank,
                              made, "In progress", complete=False))
    return rows


# --------------------------------------------------------------------------
# Style, from how the teams actually played
# --------------------------------------------------------------------------

def _rates(line) -> dict[str, float] | None:
    """One season's play as five rates, or None if nothing was played.

    Every one of these is a box-score ratio -- what the team did per possession
    or per shot -- never a rating and never a tendency. Defense is points
    allowed per 100 possessions and is negated, so a larger number is a better
    defence, the same direction as every other axis.
    """
    games = getattr(line, "games", 0) or 0
    possessions = getattr(line, "possessions", 0) or 0
    fga = getattr(line, "fga", 0) or 0
    fgm = getattr(line, "fgm", 0) or 0
    if games <= 0 or possessions <= 0 or fga <= 0:
        return None
    opp_poss = getattr(line, "opp_possessions", 0) or possessions
    return {
        "pace": possessions / games,
        "perimeter": (getattr(line, "tpa", 0) or 0) / fga,
        "ball_movement": (getattr(line, "assists", 0) or 0) / max(1, fgm),
        "defense": -(getattr(line, "points_against", 0) or 0)
                   / max(1.0, opp_poss) * 100.0,
        "offensive_glass": (getattr(line, "offensive_rebounds", 0) or 0) / games,
    }


def _league_rates(stats) -> list[dict[str, float]]:
    return [r for r in (_rates(line) for line in stats.teams.values())
            if r is not None]


def _z(value: float, population: list[float]) -> float:
    """Standard score, clamped to a readable range.

    Clamped because one team playing at a wild pace should read as "very fast",
    not run the axis off the end of the bar. Beyond about two and a half
    standard deviations the exact number stops meaning anything a reader cares
    about.
    """
    if len(population) < 2:
        return 0.0
    mean = sum(population) / len(population)
    var = sum((x - mean) ** 2 for x in population) / len(population)
    sd = var ** 0.5
    if sd <= 0:
        return 0.0
    return max(-2.5, min(2.5, (value - mean) / sd))


def style_of(league, team_id: str) -> dict[str, float]:
    """The coach's fingerprint, averaged over the seasons he has coached.

    Each season the club's rate on an axis is scored against *that season's*
    league -- pace inflates and deflates league-wide as the rules settle, and a
    coach should be measured against the game as it was played around him, not
    against a different year's. The scores are then averaged across his tenure,
    so one fluke season does not define him and a long body of work speaks
    loudest.
    """
    per_season: dict[str, list[float]] = {axis: [] for axis in STYLE_AXES}

    def fold(team_line, stats) -> None:
        mine = _rates(team_line)
        if mine is None:
            return
        field = _league_rates(stats)
        for axis in STYLE_AXES:
            column = [row[axis] for row in field]
            per_season[axis].append(_z(mine[axis], column))

    for archive in getattr(league, "history", []) or []:
        line = archive.stats.teams.get(team_id)
        if line is not None:
            fold(line, archive.stats)
    live = league.stats.teams.get(team_id)
    if live is not None:
        fold(live, league.stats)

    return {axis: round(sum(scores) / len(scores), 3) if scores else 0.0
            for axis, scores in per_season.items()}


# --------------------------------------------------------------------------
# The write-up
# --------------------------------------------------------------------------

# How far from the league average an axis has to sit before it is a trait worth
# naming, in standard-score terms. Half a deviation is a lean -- enough to be a
# real leaning rather than noise, and the point past which the summary is
# willing to characterise it.
LEAN = 0.5

STYLE_PHRASES = {
    "pace": ("plays at a deliberate, walk-it-up pace",
             "pushes the pace and plays fast"),
    "perimeter": ("keeps the offence inside the arc",
                  "builds the offence around the three"),
    "ball_movement": ("runs an offence of one-on-one and isolation",
                      "moves the ball and shares it"),
    "defense": ("gives up a lot at the other end",
                "coaches a stingy, low-scoring defence"),
    "offensive_glass": ("gets back on defence rather than crash the glass",
                        "sends bodies to the offensive glass"),
}


def _trajectory(rows: list[SeasonRow]) -> str:
    """Which way the results are pointing, from the win percentages alone.

    Only completed seasons count -- a good start to an unfinished year is not a
    trend -- and only when there are enough of them to draw a line through.
    """
    done = [row for row in rows if row.complete]
    if len(done) < TRAJECTORY_MINIMUM:
        return "new"
    recent = done[-TRAJECTORY_MINIMUM:]
    first = sum(r.win_pct for r in recent[:1]) / 1
    last = recent[-1].win_pct
    swing = last - first
    if swing >= 0.12:
        return "rising"
    if swing <= -0.12:
        return "falling"
    return "steady"


@dataclass
class Career:
    """A coach's body of work, all of it derived."""

    seasons: list[SeasonRow] = field(default_factory=list)
    style: dict[str, float] = field(default_factory=dict)

    @property
    def counted(self) -> list[SeasonRow]:
        """Seasons with games in them -- the ones a record is made of."""
        return [row for row in self.seasons if row.games > 0]

    @property
    def wins(self) -> int:
        return sum(row.wins for row in self.counted)

    @property
    def losses(self) -> int:
        return sum(row.losses for row in self.counted)

    @property
    def win_pct(self) -> float:
        total = self.wins + self.losses
        return self.wins / total if total else 0.0

    @property
    def playoff_appearances(self) -> int:
        return sum(1 for row in self.counted if row.made_playoffs)

    @property
    def finals(self) -> int:
        return sum(1 for row in self.counted if row.finish in ("Finals", "Champions"))

    @property
    def championships(self) -> int:
        return sum(1 for row in self.counted if row.finish == "Champions")

    @property
    def best(self) -> SeasonRow | None:
        done = [row for row in self.counted if row.complete]
        return max(done, key=lambda r: r.win_pct, default=None)

    def to_dict(self) -> dict:
        return {
            "seasons": [row.to_dict() for row in self.seasons],
            "style": dict(self.style),
            "record": {
                "seasons": len(self.counted),
                "wins": self.wins,
                "losses": self.losses,
                "winPct": round(self.win_pct, 3),
                "playoffAppearances": self.playoff_appearances,
                "finals": self.finals,
                "championships": self.championships,
                "bestSeason": self.best.season if self.best else None,
            },
            "trajectory": _trajectory(self.seasons),
            "summary": self.summary(),
            "honours": self.honours(),
        }

    def honours(self) -> list[dict]:
        """The badges a shelf shows, biggest first, each with its count."""
        out: list[dict] = []
        if self.championships:
            out.append({"id": "championship", "label": "Keystone Champion",
                        "count": self.championships})
        finals_only = self.finals - self.championships
        if finals_only:
            out.append({"id": "finals", "label": "Conference Champion",
                        "count": finals_only})
        if self.playoff_appearances:
            out.append({"id": "playoffs", "label": "Playoff Appearance",
                        "count": self.playoff_appearances})
        return out

    def summary(self) -> str:
        """A paragraph on how he coaches and what it has won, from the record
        and the style -- never a rating."""
        if not self.counted:
            return "Has not yet coached a season at this club."

        traits = sorted(
            ((abs(self.style.get(axis, 0.0)), axis) for axis in STYLE_AXES),
            reverse=True)
        # The pole is the *sign* of the deviation, full stop -- a strongly
        # negative defence is leaky, not "very stingy". Magnitude decides only
        # whether the trait is worth naming at all, not which way it points.
        bits: list[str] = []
        for magnitude, axis in traits:
            if magnitude < LEAN:
                continue
            high = self.style[axis] > 0
            bits.append(STYLE_PHRASES[axis][1 if high else 0])
            if len(bits) == 2:
                break
        if not bits:
            bits.append("coaches a balanced side without one loud tendency")

        style_line = f"A coach who {bits[0]}"
        if len(bits) > 1:
            style_line += f" and {bits[1]}"
        style_line += "."

        seasons = len(self.counted)
        record = (f" In {_count(seasons, 'season')} here he "
                  f"has gone {self.wins}–{self.losses}")
        tail = []
        if self.playoff_appearances:
            tail.append(f"reached the playoffs {_times(self.playoff_appearances)}")
        if self.championships:
            tail.append(f"won the Keystone {_times(self.championships)}")
        elif self.finals:
            tail.append(f"reached the Finals {_times(self.finals)}")
        record += (", " + " and ".join(tail)) if tail else ""
        record += "."

        trend = {
            "rising": " The club has climbed over his recent seasons.",
            "falling": " The club has slipped over his recent seasons.",
            "steady": " The club has held its level over his recent seasons.",
            "new": "",
        }[_trajectory(self.seasons)]
        return style_line + record + trend


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}" + ("" if n == 1 else "s")


def _times(n: int) -> str:
    """"once", "twice", then "N times" -- how a person says it out loud."""
    return {1: "once", 2: "twice"}.get(n, f"{n} times")


def career(league, team_id: str) -> Career:
    return Career(seasons=seasons_under(league, team_id),
                  style=style_of(league, team_id))
