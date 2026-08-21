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
from .lineup import GUARDS, POSITIONS, choose_lineup

# The classic shape: five starters, seven reserves, twelve a side.
STARTERS = 5
RESERVES = 7
ROSTER_SIZE = STARTERS + RESERVES

# A ballot decided purely on votes sends a side that cannot play. This engine
# gives power forwards the most minutes and the most of everything else (23.2
# mpg and 11.0 points against a point guard's 19.7 and 8.7), so the raw vote
# named an Ironridge twelve of eight bigs and four shooting guards -- with no
# point guard anywhere on it. `lineup.LineupRules` caps a five at two per
# position and wants three distinct ones, so that roster could not have fielded
# a legal lineup at all.
#
# Hence a floor and a ceiling, and only those two. The floor is what makes the
# side playable; the ceiling stops one position eating the bench. Between them
# the vote decides, which is the point.
MIN_PER_POSITION = 1
MAX_PER_POSITION = 4

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

# Vote counts are cosmetic, and this is the number they are scaled to. A share
# is the real quantity -- see `_ballot` -- but "22.4% of the conference vote"
# reads as an audit and "1,340,000 votes" reads as a ballot, which is what this
# screen is imitating.
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
    share: float                      # 0-1 of his conference's vote
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
            "share": round(self.share, 4),
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
                games=line.games, share=score, votes=0, parts=parts,
                line=(f"{_per_game(line, 'points'):.1f} pts, "
                      f"{_per_game(line, 'rebounds'):.1f} reb, "
                      f"{_per_game(line, 'assists'):.1f} ast"),
            ))

        # Shares, normalised across the conference so they add to one, then a
        # headline vote count for the look of the thing.
        total = sum(v.share for v in votes) or 1.0
        for vote in votes:
            vote.share = vote.share / total
            vote.votes = int(round(vote.share * HEADLINE_VOTES))
        votes.sort(key=lambda v: (-v.share, v.player_id))
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

    Two passes. The roster is the vote, bounded by `MIN_PER_POSITION` and
    `MAX_PER_POSITION` so the side can field a lineup. The five who start are
    then the strongest *legal* five among those twelve, decided by
    `lineup.choose_lineup` -- the same function `Team.starters` uses.

    Deferring to it rather than hard-coding "two guards and three frontcourt"
    matters: the raw vote's announced Tidewater five was three power forwards,
    which is a shape the league does not allow anyone to play. A ballot that
    names a starting five the sim would refuse to field is naming something
    other than a starting five.
    """
    out: dict[str, Selection] = {}
    for conference, votes in tally(league).items():
        roster = _twelve(votes)
        picked = Selection(conference=conference)
        first = set(choose_lineup(
            [(v.player_id, v.position, v.share) for v in roster]))
        picked.starters = [v for v in roster if v.player_id in first]
        picked.reserves = [v for v in roster if v.player_id not in first]
        out[conference] = picked
    return out


def _twelve(votes: list[Vote]) -> list[Vote]:
    """The roster, best first, with every position represented and none of them
    running away with the bench."""
    if not votes:
        return []

    taken: list[Vote] = []
    seen: set[str] = set()
    counts: dict[str, int] = {}

    def add(vote: Vote) -> None:
        taken.append(vote)
        seen.add(vote.player_id)
        counts[vote.position] = counts.get(vote.position, 0) + 1

    # The floor first: the leading vote-getter at each position. The best
    # centre in a conference is an All-Star even in a year the forwards are
    # better, which is exactly what a positional ballot is for.
    for position in POSITIONS:
        for _ in range(MIN_PER_POSITION):
            best = next((v for v in votes
                         if v.position == position and v.player_id not in seen), None)
            if best is not None:
                add(best)

    # Then the best of the rest, up to the ceiling.
    for vote in votes:
        if len(taken) >= ROSTER_SIZE:
            break
        if vote.player_id in seen:
            continue
        if counts.get(vote.position, 0) >= MAX_PER_POSITION:
            continue
        add(vote)

    # A conference too thin to fill twelve under the ceiling fills the rest
    # without it. Twelve players who can play beats eleven and a rule.
    for vote in votes:
        if len(taken) >= ROSTER_SIZE:
            break
        if vote.player_id not in seen:
            add(vote)

    taken.sort(key=lambda v: (-v.share, v.player_id))
    return taken


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

    game.rosters = {name: [v.to_dict() for v in sides[name].roster]
                    for name in CONFERENCES}
    game.home_conference, game.away_conference = home_name, away_name
    game.home_score, game.away_score = result.home_score, result.away_score
    game.box = {
        home_name: _lines(result.home_box, home),
        away_name: _lines(result.away_box, away),
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


def _lines(box, side) -> list[dict]:
    """The box score, deepest contributions first."""
    positions = {p.id: p.position.value for p in side.players}
    rows = []
    for line in box.players.values():
        rebounds = line.offensive_rebounds + line.defensive_rebounds
        rows.append({
            "playerId": line.player_id, "name": line.name,
            "position": positions.get(line.player_id, ""),
            "minutes": round(line.seconds / 60.0),
            "points": line.points, "rebounds": rebounds, "assists": line.assists,
            "steals": line.steals, "blocks": line.blocks,
            "fgm": line.fgm, "fga": line.fga, "tpm": line.tpm, "tpa": line.tpa,
        })
    rows.sort(key=lambda r: (-r["points"], -r["rebounds"], r["name"]))
    return rows


def run(league) -> AllStarGame | None:
    """The tick hook. Declines unless the league has reached tip-off.

    Same shape as `playoffs.advance` and `trade_market.run`: called on every
    tick, costs one comparison, and does something only when it is owed.
    """
    game = state(league)
    if game.played or game.tipoff_at is None:
        return None
    if league.clock.now() < game.tipoff_at:
        return None
    return play(league)
