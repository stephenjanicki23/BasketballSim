"""The All-Star Game: a vote, two conference sides, and one exhibition.

Three things, and they are deliberately separable.

**The vote is derived and it moves.** Until the game is played there is no
roster, only a running count, recomputed from the season as it stands every
time the page is opened. A player who scores thirty on Tuesday is higher on
Wednesday morning. That is what makes it a race rather than an announcement.

**There are no fans in this simulation, so this does not pretend there are.**
A real All-Star ballot is fans, players and media, and inventing a fan vote
would mean inventing a fanbase, attendance and sentiment -- none of which
exist here (`docs/TRADES.md` records the same absence for marketability). What
this counts is **performance**, weighted and stated: production, efficiency,
availability and the club's record. The screen says so rather than dressing a
formula up as a public.

**The rosters are stored, because they cannot be re-derived.** Voting closes at
tip-off, and the standing at that moment is a mid-season one. Six weeks later
the totals have moved and the same code would name a different side, so the
selection would silently change every time it was displayed. Once the game is
played the roster is fixed and saved -- the same argument `records.py` makes
for single-game marks, and the same one `save.HISTORY_PATH` makes for season
archives.

**The game is an exhibition and is kept off the schedule entirely.** It does
not touch standings, season stats, the record book, chemistry or health. That
is not a policy applied in six places -- it is a consequence of the game never
being a `ScheduledGame`, so none of the machinery that folds results into the
league can reach it. A sixty-point All-Star quarter must not become a league
record, and a scoring title must not be decided by an exhibition.

The one thing the exhibition *can* leak is `player.condition`, which the engine
mutates as a game runs. `play` saves and restores it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone

from .conferences import CONFERENCES, conference_for
from .league.advanced import advanced_table
from .lineup import GUARDS, POSITIONS

# The shape of a side: five starters, seven reserves, twelve in all.
#
# **The ballot is positional.** The five who start are the leading vote-getter
# at each of the five positions, the next five are the runner-up at each, and
# the last two go to the best of everyone left regardless of where he plays.
# So a side reads as a lineup card and a bench behind it, with two spots the
# vote fills on merit alone.
#
# This replaced a shape that was nearly right and wrong in the way that
# matters. A ballot decided purely on votes sends a side that cannot play at
# all: this engine gives power forwards the most minutes and the most of
# everything else (23.2 mpg and 11.0 points against a point guard's 19.7 and
# 8.7), so the raw vote named an Ironridge twelve of eight bigs and four
# shooting guards with no point guard anywhere on it. A floor of one per
# position fixed that, and the five who started were then the strongest *legal*
# five among the twelve -- which is a rule about what a lineup may be, not
# about what a ballot is for. One per position says the thing directly: the
# best centre in a conference starts at centre.
STARTERS = 5              # one at each position
POSITIONAL_RESERVES = 5   # the runner-up at each
WILDCARDS = 2             # best of the rest, wherever they play
RESERVES = POSITIONAL_RESERVES + WILDCARDS
ROSTER_SIZE = STARTERS + RESERVES

# Tip-off, and the day it lands on. Wednesday because that is when it was
# asked for; the hour matches the league's own evening slate.
GAME_WEEKDAY = 2          # Monday is 0
GAME_HOUR = 20

# A player needs to have been there for it. The same argument the MVP panel and
# the record book both make: a man with four brilliant games has not had half a
# season, and an All-Star vote decided on four games is not a vote.
MIN_GAMES_SHARE = 0.30

# What the vote actually weighs, and how much. Stated as a table because these
# are the entire mechanism -- a reader who disagrees with the result should be
# able to see exactly which of these produced it.
WEIGHTS: dict[str, float] = {
    "scoring": 0.34,       # points per game, the thing a ballot rewards most
    "all_round": 0.22,     # rebounds, assists, steals, blocks
    "efficiency": 0.16,    # true shooting -- volume without it is not value
    "impact": 0.16,        # win shares and box plus/minus
    "team": 0.08,          # his club's record
    "availability": 0.04,  # games played
}

# Vote counts are cosmetic and this is what the *leader* is scaled to, with
# everyone else in proportion to him. Scaling to the conference total instead
# was the obvious thing and it was wrong: around 180 players qualify, they all
# score something, and dividing by the sum gave the leading vote-getter 1.5% of
# the ballot and 88,000 votes out of six million. Nothing about that reads like
# leading a vote. Against the leader the same numbers spread 100 down to 7,
# which is what the underlying scores actually do.
HEADLINE_VOTES = 6_000_000


@dataclass
class Vote:
    """One player's standing in the vote, with the parts that produced it."""

    player_id: str
    name: str
    team_id: str
    conference: str
    position: str
    games: int
    score: float                      # 0-1, the weighted case for him
    votes: int
    parts: dict[str, float] = field(default_factory=dict)
    line: str = ""                    # "27.4 pts, 8.1 reb, 5.0 ast"

    @property
    def frontcourt(self) -> bool:
        return self.position not in GUARDS

    def to_dict(self) -> dict:
        return {
            "playerId": self.player_id,
            "name": self.name,
            "teamId": self.team_id,
            "conference": self.conference,
            "position": self.position,
            "games": self.games,
            "score": round(self.score, 4),
            "votes": self.votes,
            "parts": {k: round(v, 3) for k, v in self.parts.items()},
            "line": self.line,
            "frontcourt": self.frontcourt,
        }


@dataclass
class Selection:
    """One conference's twelve, split into who starts and who does not."""

    conference: str
    starters: list[Vote] = field(default_factory=list)
    reserves: list[Vote] = field(default_factory=list)

    @property
    def wildcards(self) -> list["Vote"]:
        """The last two, who are here on the vote alone.

        Marked rather than left to be counted off the end of the bench: which
        two they are is a fact about how the side was picked, and a reader
        should not have to know `POSITIONAL_RESERVES` to see it.
        """
        return self.reserves[POSITIONAL_RESERVES:]

    @property
    def roster(self) -> list[Vote]:
        return self.starters + self.reserves

    def to_dict(self) -> dict:
        return {
            "conference": self.conference,
            "starters": [v.to_dict() for v in self.starters],
            "reserves": [v.to_dict() for v in self.reserves],
        }


@dataclass
class AllStarGame:
    """One season's All-Star Game: when, who, and what happened.

    Saved rather than derived. See the module docstring: the roster is a
    mid-season reading that stops being reproducible the moment the season
    moves on.
    """

    season: str = ""
    tipoff_at: datetime | None = None
    played: bool = False
    # Filled at tip-off, from the vote as it stood.
    rosters: dict[str, list[dict]] = field(default_factory=dict)
    home_score: int = 0
    away_score: int = 0
    home_conference: str = ""
    away_conference: str = ""
    mvp_id: str = ""
    mvp_name: str = ""
    mvp_line: str = ""
    box: dict = field(default_factory=dict)

    def selected(self) -> set[str]:
        return {row["playerId"] for rows in self.rosters.values() for row in rows}

    def to_dict(self) -> dict:
        return {
            "season": self.season,
            "tipoffAt": self.tipoff_at.isoformat() if self.tipoff_at else None,
            "played": self.played,
            "rosters": {k: list(v) for k, v in self.rosters.items()},
            "homeConference": self.home_conference,
            "awayConference": self.away_conference,
            "homeScore": self.home_score,
            "awayScore": self.away_score,
            "mvpId": self.mvp_id,
            "mvpName": self.mvp_name,
            "mvpLine": self.mvp_line,
        }


# --------------------------------------------------------------------------
# When
# --------------------------------------------------------------------------

def next_wednesday(moment: datetime) -> datetime:
    """The next Wednesday evening strictly after `moment`.

    Strictly after, so a game created on a Wednesday afternoon is next week's
    rather than one that tips off in four hours and nobody gets to vote in.
    """
    ahead = (GAME_WEEKDAY - moment.weekday()) % 7
    if ahead == 0:
        ahead = 7
    day = (moment + timedelta(days=ahead)).date()
    return datetime.combine(day, time(GAME_HOUR), tzinfo=timezone.utc)


def state(league) -> AllStarGame:
    """The league's All-Star record, created on first ask.

    The date is set once, when the record is created, and then left alone. A
    date recomputed on every read would slide a week forward every Wednesday
    and the game would never arrive.
    """
    played = getattr(league, "allstar", None)
    if played is None:
        played = league.allstar = {}
    existing = played.get(league.season)
    if existing is not None:
        return existing
    made = AllStarGame(season=league.season,
                       tipoff_at=next_wednesday(league.clock.now()))
    played[league.season] = made
    return made


# --------------------------------------------------------------------------
# The vote
# --------------------------------------------------------------------------

def _per_game(line, key: str) -> float:
    return getattr(line, key, 0.0) / line.games if line.games else 0.0


def _true_shooting(line) -> float:
    attempts = 2.0 * (line.fga + 0.44 * line.fta)
    return line.points / attempts if attempts > 0 else 0.0


def _normalise(rows: list[tuple], key) -> dict:
    """Scale a column to 0-1 across the candidates, so the weights mean
    something. Raw points and raw win shares are not on the same scale and
    adding them would let whichever is larger decide the vote."""
    values = [key(r) for r in rows]
    low, high = min(values, default=0.0), max(values, default=0.0)
    span = high - low
    return {id(r): (0.5 if span <= 0 else (key(r) - low) / span) for r in rows}


def tally(league) -> dict[str, list[Vote]]:
    """Every eligible player's standing in his conference's vote, best first.

    Recomputed from the season as it stands. Two calls a game apart give
    different answers, which is the entire point of a race.
    """
    minimum = _minimum_games(league)
    advanced = {row["player_id"]: row for row in advanced_table(league.stats)}
    standings = {row["team_id"]: row for row in league.standings_table()}

    pool: dict[str, list] = {name: [] for name in CONFERENCES}
    for line in league.stats.players.values():
        if line.games < minimum or not line.team_id:
            continue
        conference = conference_for(_abbr(league, line.team_id))
        if conference not in pool:
            continue
        pool[conference].append(line)

    out: dict[str, list[Vote]] = {}
    for conference, lines in pool.items():
        if not lines:
            out[conference] = []
            continue
        scoring = _normalise(lines, lambda l: _per_game(l, "points"))
        all_round = _normalise(lines, lambda l: (
            _per_game(l, "rebounds") * 1.0 + _per_game(l, "assists") * 1.3
            + _per_game(l, "steals") * 2.2 + _per_game(l, "blocks") * 2.2))
        efficiency = _normalise(lines, _true_shooting)
        impact = _normalise(lines, lambda l: (
            float((advanced.get(l.player_id) or {}).get("ws", 0.0) or 0.0) * 1.0
            + float((advanced.get(l.player_id) or {}).get("bpm", 0.0) or 0.0) * 0.35))
        team = _normalise(lines, lambda l: float(
            (standings.get(l.team_id) or {}).get("win_pct", 0.5) or 0.5))
        availability = _normalise(lines, lambda l: float(l.games))

        votes = []
        for line in lines:
            parts = {
                "scoring": scoring[id(line)],
                "all_round": all_round[id(line)],
                "efficiency": efficiency[id(line)],
                "impact": impact[id(line)],
                "team": team[id(line)],
                "availability": availability[id(line)],
            }
            score = sum(parts[k] * WEIGHTS[k] for k in WEIGHTS)
            votes.append(Vote(
                player_id=line.player_id, name=line.name, team_id=line.team_id,
                conference=conference, position=line.position or "",
                games=line.games, score=score, votes=0, parts=parts,
                line=(f"{_per_game(line, 'points'):.1f} pts, "
                      f"{_per_game(line, 'rebounds'):.1f} reb, "
                      f"{_per_game(line, 'assists'):.1f} ast"),
            ))

        # A headline vote count, scaled off the leader rather than the pool.
        leader = max((v.score for v in votes), default=0.0) or 1.0
        for vote in votes:
            vote.votes = int(round(vote.score / leader * HEADLINE_VOTES))
        votes.sort(key=lambda v: (-v.score, v.player_id))
        out[conference] = votes
    return out


def _abbr(league, team_id: str) -> str:
    team = league.teams.get(team_id)
    return team.abbreviation if team else ""


def _minimum_games(league) -> int:
    from .league import playoffs
    from .league.calendar import GameStatus

    regular = [g for g in league.schedule if not playoffs.is_playoff(g)]
    done = sum(1 for g in regular if g.status == GameStatus.FINAL)
    per_club = max(1, round(2 * done / max(1, len(league.teams))))
    return max(1, int(per_club * MIN_GAMES_SHARE))


def select(league) -> dict[str, Selection]:
    """The twelve each conference would send if voting closed now.

    Three passes over the same board, in order of what a spot is worth:

      1. The leading vote-getter at each position starts.
      2. The runner-up at each position makes the bench.
      3. The two best left, wherever they play, take the last two spots.

    A side built this way is a legal lineup by construction -- five distinct
    positions, one apiece -- so nothing here has to consult `lineup.py` to find
    out whether the five it just named could take the floor together.

    A conference thin at a position simply does not fill that slot from it, and
    the wildcards take up the slack. Twelve players who can play beats eleven
    and a rule.
    """
    out: dict[str, Selection] = {}
    for conference, votes in tally(league).items():
        picked = Selection(conference=conference)
        taken: set[str] = set()

        def best_at(position: str) -> Vote | None:
            return next((v for v in votes
                         if v.position == position and v.player_id not in taken),
                        None)

        starters: list[Vote] = []
        bench: list[Vote] = []
        for tier in (starters, bench):
            for position in POSITIONS:
                choice = best_at(position)
                if choice is not None:
                    taken.add(choice.player_id)
                    tier.append(choice)

        # The last two, on the vote alone. Also where a conference that could
        # not field a runner-up at some position makes the number back up.
        wild: list[Vote] = []
        for vote in votes:
            if len(starters) + len(bench) + len(wild) >= ROSTER_SIZE:
                break
            if vote.player_id not in taken:
                taken.add(vote.player_id)
                wild.append(vote)

        # Announced in lineup order rather than vote order: a starting five is
        # read one through five, not first through fifth. The wildcards stay in
        # vote order behind the positional bench, because that is the only
        # thing that put them there.
        order = {position: index for index, position in enumerate(POSITIONS)}
        by_position = lambda v: order.get(v.position, len(POSITIONS))
        picked.starters = sorted(starters, key=by_position)
        picked.reserves = sorted(bench, key=by_position) + wild
        out[conference] = picked
    return out


# --------------------------------------------------------------------------
# The game
# --------------------------------------------------------------------------

# All-Star basketball is fast, generous and barely defended, and a 96-91
# exhibition would read as a mistake. These are the sliders that produce it.
# They are the only place in the project where tactics are set to describe an
# occasion rather than a game plan.
EXHIBITION = dict(
    pace=88.0, three_point_emphasis=78.0, ball_movement=80.0,
    offensive_rebounding=22.0, tempo_after_rebound=88.0,
    defensive_pressure=26.0, help_intensity=24.0,
    foul_discipline=82.0, close_out_hard=22.0,
    minutes_stagger=90.0,          # everybody gets a run; nobody plays 40
)

# What decides the game's MVP, on top of the points. Deliberately the same
# shape as a box-score game score rather than the season panel's machinery --
# one night is not a case, it is a performance.
MVP_REBOUND = 0.9
MVP_ASSIST = 1.2
MVP_STOP = 1.6          # steals and blocks
MVP_TURNOVER = -1.0


def _side(league, selection: Selection, coach) -> "Team":
    """One conference's twelve as a team the engine will accept.

    Holds the *real* `Player` objects, not copies, so the exhibition is played
    by the men who were voted in rather than by clones of their ratings. That
    is also why `play` has to put their condition back afterwards.
    """
    from .models import Team
    from .tactics import Tactics

    squad = []
    for vote in selection.roster:
        team = league.teams.get(vote.team_id)
        player = team.player(vote.player_id) if team else None
        if player is not None:
            squad.append(player)

    starters = {v.player_id for v in selection.starters}
    # Starters first, then the bench in vote order -- the depth chart is how
    # the engine learns who was voted in as a starter.
    order = [p for p in squad if p.id in starters] + [
        p for p in squad if p.id not in starters]
    return Team(
        id=f"as-{selection.conference.lower()}",
        name=selection.conference,
        abbreviation=selection.conference[:3].upper(),
        city="",
        conference=selection.conference,
        players=squad,
        tactics=Tactics(**EXHIBITION),
        coach=coach,
        depth_chart=[p.id for p in order],
        # No chemistry: twelve men who met on Tuesday. `team_chemistry` is left
        # at its neutral default rather than computed, because computing it
        # would mean writing pair chemistry onto players who do not play
        # together and then having to unwrite it.
    )


def _bench_boss(league, conference: str):
    """The coach of the conference's best club, which is how the real one is
    decided and costs nothing to honour."""
    best, record = None, -1.0
    for row in league.standings_table():
        team = league.teams.get(row["team_id"])
        if team is None or conference_for(team.abbreviation) != conference:
            continue
        pct = float(row.get("win_pct", 0.0) or 0.0)
        if pct > record:
            best, record = team, pct
    return best.coach if best else None


def _game_score(line) -> float:
    return (line.points
            + MVP_REBOUND * (line.offensive_rebounds + line.defensive_rebounds)
            + MVP_ASSIST * line.assists
            + MVP_STOP * (line.steals + line.blocks)
            + MVP_TURNOVER * line.turnovers)


def play(league) -> AllStarGame:
    """Play the exhibition and store it. Idempotent: a game already played is
    returned untouched, because the roster and the result are the only things
    here that cannot be derived again."""
    from .engine.game import GameSimulator
    from .engine.rng import seed_from_string

    game = state(league)
    if game.played:
        return game

    sides = select(league)
    if any(len(side.roster) < ROSTER_SIZE for side in sides.values()):
        # Callers reach `play` directly in tests and tools; `run` guards this
        # already. Refusing here rather than fielding a side of nobody keeps
        # the invariant in one place that cannot be bypassed.
        raise ValueError("not enough eligible players to fill both sides")

    order = list(CONFERENCES)
    # Which conference is nominally at home alternates by season. The floor is
    # neutral but `possession.HOME_SHOOTING_EDGE` does not know that, and a
    # half-percent edge handed to the same conference every year is a thumb on
    # the scale that nobody put there on purpose.
    if seed_from_string(f"allstar-home-{league.season}") % 2:
        order.reverse()
    away_name, home_name = order

    home = _side(league, sides[home_name], _bench_boss(league, home_name))
    away = _side(league, sides[away_name], _bench_boss(league, away_name))

    # The one thing an exhibition can leak. The engine sets condition at
    # tip-off and drains it all night; without this, twelve men on each side
    # walk into their next league game carrying an All-Star Game they played
    # in a different universe.
    carried = {p.id: p.condition for p in home.players + away.players}
    try:
        simulator = GameSimulator(
            game_id=f"allstar-{league.season}", home=home, away=away,
            rules=league.rules, seed=f"allstar-{league.season}",
            rotation_depth=ROSTER_SIZE,
        )
        result = simulator.simulate()
    finally:
        for player in home.players + away.players:
            player.condition = carried.get(player.id, player.condition)

    game.rosters = {name: _roster_rows(sides[name]) for name in CONFERENCES}
    game.home_conference, game.away_conference = home_name, away_name
    game.home_score, game.away_score = result.home_score, result.away_score
    # Club ids for the box score, taken from the vote rather than from the
    # exhibition side -- an All-Star team's own id is `as-ironridge`, which is
    # not a club anyone can open.
    clubs = {row["playerId"]: row["teamId"]
             for rows in game.rosters.values() for row in rows}
    game.box = {
        home_name: _lines(result.home_box, home, clubs),
        away_name: _lines(result.away_box, away, clubs),
    }

    winner = home if result.home_score >= result.away_score else away
    won = result.home_box if winner is home else result.away_box
    best = max(won.players.values(), key=_game_score, default=None)
    if best is not None:
        game.mvp_id, game.mvp_name = best.player_id, best.name
        game.mvp_line = (f"{best.points} pts, "
                         f"{best.offensive_rebounds + best.defensive_rebounds} reb, "
                         f"{best.assists} ast")
    game.played = True
    return game


def _roster_rows(selection: Selection) -> list[dict]:
    """The twelve as stored, starters flagged.

    The flag is written here rather than left to be recomputed later because it
    is part of the same closed vote: who started is a fact about that night,
    not a thing to work out again from a roster years afterwards.
    """
    starting = {v.player_id for v in selection.starters}
    wild = {v.player_id for v in selection.wildcards}
    rows = []
    for vote in selection.roster:
        row = vote.to_dict()
        row["starter"] = vote.player_id in starting
        row["wildcard"] = vote.player_id in wild
        rows.append(row)
    return rows


def _lines(box, side, clubs: dict[str, str]) -> list[dict]:
    """The box score, deepest contributions first."""
    positions = {p.id: p.position.value for p in side.players}
    rows = []
    for line in box.players.values():
        rebounds = line.offensive_rebounds + line.defensive_rebounds
        rows.append({
            "playerId": line.player_id, "name": line.name,
            "teamId": clubs.get(line.player_id, ""),
            "position": positions.get(line.player_id, ""),
            "minutes": round(line.seconds / 60.0),
            "points": line.points, "rebounds": rebounds, "assists": line.assists,
            "steals": line.steals, "blocks": line.blocks,
            "fgm": line.fgm, "fga": line.fga, "tpm": line.tpm, "tpa": line.tpa,
        })
    rows.sort(key=lambda r: (-r["points"], -r["rebounds"], r["name"]))
    return rows


def run(league) -> AllStarGame | None:
    """The tick hook. Declines unless the league has reached tip-off *and* has
    a season to vote on.

    Same shape as `playoffs.advance` and `trade_market.run`: called on every
    tick, costs one comparison, and does something only when it is owed.

    The second condition is not defensive padding. `offseason.reschedule`
    clears `league.stats` when it installs a new calendar, so the first days of
    every season after this one have an empty ballot -- and a date set to "next
    Wednesday" can easily land inside them. Playing then would field two sides
    of nobody and, far worse, would mark that season's game *played*, freezing
    a broken result forever. So it waits a week and asks again, which is also
    what a league would do.
    """
    game = state(league)
    if game.played or game.tipoff_at is None:
        return None
    now = league.clock.now()
    if now < game.tipoff_at:
        return None

    sides = select(league)
    if any(len(side.roster) < ROSTER_SIZE for side in sides.values()):
        # Push it a week at a time until the season has caught up. Looping
        # rather than adding one week handles a clock jumped months forward.
        while game.tipoff_at <= now:
            game.tipoff_at = next_wednesday(game.tipoff_at)
        return None
    return play(league)
