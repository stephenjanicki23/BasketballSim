"""Power rankings: who is playing the best basketball right now.

Not the standings. The standings answer "who has won the most games this
season", which is a different question and already has a page. This answers
the one a broadcast asks in February: a 28-18 side on a ten-game run that has
beaten three contenders belongs above a 32-14 side that has lost six of eight,
and the table has to say so.

**Nothing here is stored.** A ranking is computed by replaying the schedule up
to a given day and reading what had happened by then -- the same discipline as
the standings and the playoff bracket. Three things follow, and they are why
the constraint was worth keeping:

  * **History is free.** Yesterday's top ten is not a saved row, it is the
    same function called with an earlier date. So is last month's. There is no
    archive to migrate, corrupt, or forget to write.
  * **Movement is free.** An arrow is today's rank against the rank produced
    by the identical function one day earlier.
  * **It cannot drift.** There is no second copy of the truth to disagree with
    the games.

The cost is arithmetic: a full season of daily rankings replays the schedule
once per day. At 28 slates and 1,230 fixtures that is cheap, and `snapshots`
walks the games once and emits every day rather than restarting each time.

**Deterministic and transparent.** No randomness, no hidden state, and every
component of a rating is exposed on the row that carries it -- if a team is
fourth, the page can show you which of the ten inputs put it there.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from ..conferences import conference_for
from .calendar import GameStatus, ScheduledGame
from .playoffs import is_playoff

# --------------------------------------------------------------------------
# The formula.
#
# Ten components, each scored 0-100 on its own terms, then blended. The
# weights are the brief's; keeping them in one dict rather than inline is what
# makes the thing tunable and what lets the UI show its own working.
# --------------------------------------------------------------------------

WEIGHTS: dict[str, float] = {
    "record": 0.20,
    "form": 0.25,          # last ten, and the largest single share
    "schedule": 0.10,
    "differential": 0.10,
    "efficiency": 0.10,
    "quality": 0.10,
    "health": 0.05,
    "momentum": 0.05,
    "chemistry": 0.03,
    "coaching": 0.02,
}

COMPONENT_LABELS: dict[str, str] = {
    "record": "Overall record",
    "form": "Last 10",
    "schedule": "Strength of schedule",
    "differential": "Point differential",
    "efficiency": "Efficiency",
    "quality": "Quality wins",
    "health": "Health",
    "momentum": "Momentum",
    "chemistry": "Chemistry",
    "coaching": "Coaching",
}

FORM_WINDOW = 10

# Recency. The brief's own numbers: yesterday counts fully, each further day
# is five points less, and nothing ever falls to zero -- a game from November
# still happened. The floor is reached around three weeks out, which is what
# "older than thirty days has minimal influence" means in practice.
DECAY_PER_DAY = 0.05
DECAY_FLOOR = 0.05

# Point differential, in points a game, that scores full marks. Beyond this
# the curve flattens: the brief is explicit that blowouts should not be over
# rewarded, and a team winning by 15 a night is not twice the team winning
# by 7.5.
DIFFERENTIAL_CEILING = 12.0

# Net rating, per 100 possessions, that scores full marks.
NET_RATING_CEILING = 12.0

# What a quality win is worth, before recency weighting.
QUALITY_TOP5 = 3.0
QUALITY_TOP10 = 2.0
QUALITY_PLAYOFF_PLACE = 1.0
QUALITY_ROAD_BONUS = 1.0
QUALITY_COMEBACK = 0.75      # trailed at the last break and still won
QUALITY_RIVAL = 0.5          # same conference
BAD_LOSS_HOME_TO_BOTTOM = -2.5
BAD_LOSS_BLOWOUT = -1.0      # beaten by twenty or more
BAD_LOSS_STREAK_STEP = -0.5  # each game of a losing run past two

# Tier floors, set from the distribution the formula actually produces rather
# than from round numbers. Over a full season the ratings run about 30 to 79,
# and these cut it roughly 2 / 4 / 6 / 6 / 8 / 4 -- a shape that looks like a
# league. Picked at round numbers instead, every club landed in the middle two
# tiers and the bottom one was never used at all, which tells a reader nothing.
TIERS: tuple[tuple[float, str], ...] = (
    (70.0, "Championship Favorite"),
    (61.0, "Title Contender"),
    (54.0, "Playoff Team"),
    (49.0, "Play-In Contender"),
    (41.0, "Middle of the Pack"),
    (0.0, "Rebuilding"),
)


def tier_for(rating: float) -> str:
    for floor, label in TIERS:
        if rating >= floor:
            return label
    return TIERS[-1][1]


def decay(days_ago: int) -> float:
    """How much a game that finished `days_ago` days back still counts."""
    return max(DECAY_FLOOR, 1.0 - DECAY_PER_DAY * max(0, days_ago - 1))


def _scale(value: float, low: float, high: float) -> float:
    """Put a raw number on 0-100 between two anchors."""
    if high <= low:
        return 50.0
    return max(0.0, min(100.0, 100.0 * (value - low) / (high - low)))


# --------------------------------------------------------------------------
# What one team had done by a given day.
# --------------------------------------------------------------------------

@dataclass
class TeamRun:
    """A club's season to date, accumulated game by game."""

    team_id: str
    wins: int = 0
    losses: int = 0
    home_wins: int = 0
    home_losses: int = 0
    away_wins: int = 0
    away_losses: int = 0
    points_for: int = 0
    points_against: int = 0
    possessions: int = 0
    opp_possessions: int = 0
    # (day, won, margin, home, opponent id, comeback) newest last.
    games: list[tuple] = field(default_factory=list)
    opponents: list[str] = field(default_factory=list)
    best_win_streak: int = 0
    worst_loss_streak: int = 0

    @property
    def played(self) -> int:
        return self.wins + self.losses

    @property
    def win_pct(self) -> float:
        return self.wins / self.played if self.played else 0.0

    @property
    def differential(self) -> float:
        return (self.points_for - self.points_against) / self.played if self.played else 0.0

    @property
    def offensive_rating(self) -> float:
        return 100.0 * self.points_for / self.possessions if self.possessions else 0.0

    @property
    def defensive_rating(self) -> float:
        poss = self.opp_possessions or self.possessions
        return 100.0 * self.points_against / poss if poss else 0.0

    @property
    def net_rating(self) -> float:
        return self.offensive_rating - self.defensive_rating

    def last(self, count: int) -> list[tuple]:
        return self.games[-count:]

    @property
    def last_ten(self) -> tuple[int, int]:
        window = self.last(FORM_WINDOW)
        won = sum(1 for g in window if g[1])
        return won, len(window) - won

    @property
    def streak(self) -> int:
        """Positive for a winning run, negative for a losing one."""
        run = 0
        for game in reversed(self.games):
            if run == 0:
                run = 1 if game[1] else -1
            elif game[1] and run > 0:
                run += 1
            elif not game[1] and run < 0:
                run -= 1
            else:
                break
        return run

    def streak_label(self) -> str:
        run = self.streak
        if run == 0:
            return "—"
        return f"{'W' if run > 0 else 'L'}{abs(run)}"

    def record_after(self, game_won: bool, home: bool) -> None:
        if game_won:
            self.wins += 1
            if home:
                self.home_wins += 1
            else:
                self.away_wins += 1
        else:
            self.losses += 1
            if home:
                self.home_losses += 1
            else:
                self.away_losses += 1


def _comeback(result, team_id: str) -> bool:
    """Won after trailing at the last quarter break.

    Read off the period scores rather than the play-by-play, so it works for
    every game in the season and not only the ones shipping events.
    """
    home = result.home_team_id == team_id
    ours = result.home_box.points_by_period
    theirs = result.away_box.points_by_period
    if not home:
        ours, theirs = theirs, ours
    if len(ours) < 2 or len(ours) != len(theirs):
        return False
    before_last = sum(ours[:-1]) - sum(theirs[:-1])
    final = sum(ours) - sum(theirs)
    return before_last < 0 < final


def runs_through(league, cutoff: date) -> dict[str, TeamRun]:
    """Every club's season as it stood at the end of `cutoff`."""
    runs = {team_id: TeamRun(team_id=team_id) for team_id in league.teams}
    games = sorted(
        (g for g in league.schedule
         if g.status == GameStatus.FINAL and g.result is not None
         and not is_playoff(g) and g.game_date <= cutoff),
        key=lambda g: (g.tipoff_at, g.id),
    )
    for game in games:
        _apply(runs, game, cutoff)
    return runs


def _apply(runs: dict[str, TeamRun], game: ScheduledGame, cutoff: date) -> None:
    result = game.result
    days_ago = (cutoff - game.game_date).days
    for team_id, box, opponent_id, scored, conceded, home in (
        (game.home_team_id, result.home_box, game.away_team_id,
         result.home_score, result.away_score, True),
        (game.away_team_id, result.away_box, game.home_team_id,
         result.away_score, result.home_score, False),
    ):
        run = runs.get(team_id)
        if run is None:
            continue
        won = scored > conceded
        run.record_after(won, home)
        run.points_for += scored
        run.points_against += conceded
        run.possessions += box.possessions
        other = result.away_box if home else result.home_box
        run.opp_possessions += other.possessions
        run.games.append((days_ago, won, scored - conceded, home, opponent_id,
                          _comeback(result, team_id)))
        run.opponents.append(opponent_id)
        streak = run.streak
        run.best_win_streak = max(run.best_win_streak, streak)
        run.worst_loss_streak = min(run.worst_loss_streak, streak)


# --------------------------------------------------------------------------
# Scoring one team.
# --------------------------------------------------------------------------

def _provisional(run: TeamRun) -> float:
    """A cheap rating used only to decide who counts as an elite opponent.

    Quality wins are defined against the top of the table, and the top of the
    table is what this file is computing -- so the ordering is done twice. The
    first pass uses record and margin only, which is enough to say who the
    strong teams are without depending on itself.
    """
    return 0.65 * _scale(run.win_pct, 0.2, 0.8) + 0.35 * _scale(
        run.differential, -DIFFERENTIAL_CEILING, DIFFERENTIAL_CEILING)


def _quality_score(run: TeamRun, standing: dict[str, int], league) -> tuple[float, list, list]:
    """Recency-weighted credit for good wins, debit for bad losses."""
    total = 0.0
    good: list[dict] = []
    bad: list[dict] = []
    size = len(standing)
    top5 = {t for t, rank in standing.items() if rank <= 5}
    top10 = {t for t, rank in standing.items() if rank <= 10}
    playoff = {t for t, rank in standing.items() if rank <= 16}
    bottom = {t for t, rank in standing.items() if rank > size - 8}

    losing_run = 0
    for days_ago, won, margin, home, opponent, comeback in run.games:
        weight = decay(days_ago)
        value = 0.0
        reasons: list[str] = []
        if won:
            losing_run = 0
            if opponent in top5:
                value += QUALITY_TOP5
                reasons.append("top-5 opponent")
            elif opponent in top10:
                value += QUALITY_TOP10
                reasons.append("top-10 opponent")
            elif opponent in playoff:
                value += QUALITY_PLAYOFF_PLACE
                reasons.append("playoff-place opponent")
            if not home:
                value += QUALITY_ROAD_BONUS
                reasons.append("on the road")
            if comeback:
                value += QUALITY_COMEBACK
                reasons.append("came from behind")
            if (conference_for(league.teams[opponent].abbreviation)
                    == conference_for(league.teams[run.team_id].abbreviation)):
                value += QUALITY_RIVAL
            if value > 0 and reasons:
                good.append({"opponent": opponent, "margin": margin,
                             "reasons": reasons, "weight": round(weight, 3)})
        else:
            losing_run += 1
            if home and opponent in bottom:
                value += BAD_LOSS_HOME_TO_BOTTOM
                reasons.append("home to a bottom-eight club")
            if margin <= -20:
                value += BAD_LOSS_BLOWOUT
                reasons.append("beaten by twenty")
            if losing_run > 2:
                value += BAD_LOSS_STREAK_STEP * (losing_run - 2)
            if value < 0 and reasons:
                bad.append({"opponent": opponent, "margin": margin,
                            "reasons": reasons, "weight": round(weight, 3)})
        total += value * weight

    # Per game, so a club that has played more is not simply ahead.
    per_game = total / run.played if run.played else 0.0
    return _scale(per_game, -1.5, 2.5), good, bad


def _form_score(run: TeamRun) -> float:
    """Last ten, weighted so the most recent of them count most."""
    window = run.last(FORM_WINDOW)
    if not window:
        return 50.0
    weighted = sum((1.0 if won else 0.0) * decay(days) for days, won, *_rest in window)
    total = sum(decay(days) for days, *_rest in window)
    return _scale(weighted / total if total else 0.0, 0.0, 1.0)


def _schedule_score(run: TeamRun, runs: dict[str, TeamRun]) -> float:
    """Opponents' win percentage -- who they have actually had to play."""
    if not run.opponents:
        return 50.0
    total = sum(runs[o].win_pct for o in run.opponents if o in runs)
    return _scale(total / len(run.opponents), 0.35, 0.65)


def _momentum_score(run: TeamRun) -> float:
    """Direction of travel: the last five against the five before them."""
    recent = run.last(5)
    earlier = run.games[-10:-5]
    if len(recent) < 3:
        return 50.0
    recent_rate = sum(1 for g in recent if g[1]) / len(recent)
    if len(earlier) < 3:
        return _scale(recent_rate, 0.0, 1.0)
    earlier_rate = sum(1 for g in earlier if g[1]) / len(earlier)
    swing = recent_rate - earlier_rate
    streak_bonus = max(-0.2, min(0.2, run.streak * 0.04))
    return _scale(swing + streak_bonus, -0.6, 0.6)


def _health_score(team) -> float:
    """Availability, weighted by how good the missing players are.

    The simulation does not currently injure anybody during a season --
    `Player.injured` exists and nothing sets it -- so in the shipped build this
    returns a flat 100 for every club and the component contributes a constant.
    It reads the real flags rather than a placeholder so that it starts working
    the day in-season injuries land, and it is written here rather than
    stubbed out so the weighting does not have to be redesigned then.
    """
    players = list(team.players)
    if not players:
        return 50.0
    strength = sum(p.ability.current for p in players)
    if strength <= 0:
        return 50.0
    missing = sum(p.ability.current for p in players if p.injured)
    return _scale(1.0 - missing / strength, 0.7, 1.0)


def _chemistry_score(team) -> float:
    return _scale(team.team_chemistry, 30.0, 75.0)


def _coaching_score(team) -> float:
    coach = team.coach
    if coach is None:
        return 50.0
    ratings = coach.ratings
    blended = (0.35 * ratings.tactics + 0.25 * ratings.offense
               + 0.25 * ratings.defense + 0.15 * ratings.development)
    return _scale(blended, 25.0, 85.0)


def _efficiency_score(run: TeamRun) -> float:
    return _scale(run.net_rating, -NET_RATING_CEILING, NET_RATING_CEILING)


def rate(league, cutoff: date, runs: dict[str, TeamRun] | None = None) -> list[dict]:
    """Every club's power rating as of the end of `cutoff`, best first."""
    runs = runs if runs is not None else runs_through(league, cutoff)
    playing = {tid: run for tid, run in runs.items() if run.played > 0}
    if not playing:
        return []

    # Pass one: who is strong, on record and margin alone.
    provisional = sorted(playing, key=lambda t: (-_provisional(playing[t]), t))
    standing = {team_id: index + 1 for index, team_id in enumerate(provisional)}

    rows: list[dict] = []
    for team_id, run in playing.items():
        team = league.teams[team_id]
        quality, good, bad = _quality_score(run, standing, league)
        components = {
            "record": _scale(run.win_pct, 0.2, 0.8),
            "form": _form_score(run),
            "schedule": _schedule_score(run, playing),
            "differential": _scale(run.differential,
                                   -DIFFERENTIAL_CEILING, DIFFERENTIAL_CEILING),
            "efficiency": _efficiency_score(run),
            "quality": quality,
            "health": _health_score(team),
            "momentum": _momentum_score(run),
            "chemistry": _chemistry_score(team),
            "coaching": _coaching_score(team),
        }
        rating = sum(components[key] * WEIGHTS[key] for key in WEIGHTS)
        won, lost = run.last_ten
        rows.append({
            "teamId": team_id,
            "rating": round(rating, 2),
            "tier": tier_for(rating),
            "wins": run.wins,
            "losses": run.losses,
            "lastTen": f"{won}-{lost}",
            "streak": run.streak_label(),
            "streakValue": run.streak,
            "netRating": round(run.net_rating, 1),
            "offensiveRating": round(run.offensive_rating, 1),
            "defensiveRating": round(run.defensive_rating, 1),
            "differential": round(run.differential, 1),
            "homeRecord": f"{run.home_wins}-{run.home_losses}",
            "awayRecord": f"{run.away_wins}-{run.away_losses}",
            "bestWinStreak": run.best_win_streak,
            "worstLossStreak": abs(run.worst_loss_streak),
            "components": {k: round(v, 1) for k, v in components.items()},
            "qualityWins": good[-5:],
            "badLosses": bad[-5:],
        })

    # Ties broken on id so the same league always produces the same order.
    rows.sort(key=lambda r: (-r["rating"], r["teamId"]))
    for index, row in enumerate(rows):
        row["rank"] = index + 1
    return rows


# --------------------------------------------------------------------------
# History, movement, and the shape the page reads.
# --------------------------------------------------------------------------

def ranking_days(league) -> list[date]:
    """Every day that finished with at least one game played."""
    days = {
        g.game_date for g in league.schedule
        if g.status == GameStatus.FINAL and g.result is not None and not is_playoff(g)
    }
    return sorted(days)


def snapshots(league, days: list[date] | None = None) -> dict[date, list[dict]]:
    """The full ranking on every day of the season.

    Accumulates once and emits a ranking at each day boundary rather than
    replaying the season from scratch per day -- the results are identical,
    it is just the difference between one pass and twenty-eight.
    """
    days = days if days is not None else ranking_days(league)
    if not days:
        return {}
    out: dict[date, list[dict]] = {}
    for day in days:
        out[day] = rate(league, day)
    return out


def with_movement(today: list[dict], yesterday: list[dict] | None,
                  history: dict[str, list[int]] | None = None) -> list[dict]:
    """Annotate a ranking with movement and season extremes."""
    previous = {row["teamId"]: row["rank"] for row in (yesterday or [])}
    for row in today:
        was = previous.get(row["teamId"])
        row["previousRank"] = was
        row["movement"] = (was - row["rank"]) if was is not None else None
        marks = (history or {}).get(row["teamId"], [])
        if marks:
            row["bestRank"] = min(marks)
            row["worstRank"] = max(marks)
            row["averageRank"] = round(sum(marks) / len(marks), 1)
            row["isSeasonBest"] = row["rank"] <= min(marks) and len(marks) > 1
            row["isSeasonWorst"] = row["rank"] >= max(marks) and len(marks) > 1
        else:
            row["bestRank"] = row["rank"]
            row["worstRank"] = row["rank"]
            row["averageRank"] = float(row["rank"])
            row["isSeasonBest"] = False
            row["isSeasonWorst"] = False
    return today


def rank_history(league, days: list[date] | None = None) -> dict:
    """Everything the Power Rankings page needs, in one pass over the season."""
    days = days if days is not None else ranking_days(league)
    if not days:
        return {"days": [], "current": [], "history": {}, "weeksAtOne": {}}

    per_team: dict[str, list[int]] = {}
    per_day: list[dict] = []
    weeks_at_one: dict[str, int] = {}
    previous: list[dict] | None = None

    for day in days:
        ranking = rate(league, day)
        for row in ranking:
            per_team.setdefault(row["teamId"], []).append(row["rank"])
        if ranking:
            leader = ranking[0]["teamId"]
            weeks_at_one[leader] = weeks_at_one.get(leader, 0) + 1
        per_day.append({
            "day": day.isoformat(),
            "ranks": {row["teamId"]: row["rank"] for row in ranking},
        })
        previous = ranking

    # The last day's table, with movement against the day before it.
    days_before = days[:-1]
    yesterday = rate(league, days_before[-1]) if days_before else None
    trimmed = {tid: marks[:-1] for tid, marks in per_team.items()}
    current = with_movement(previous or [], yesterday, trimmed)

    return {
        "days": [d.isoformat() for d in days],
        "current": current,
        "history": per_day,
        "seasonRanks": per_team,
        "daysAtOne": weeks_at_one,
        "weights": {k: WEIGHTS[k] for k in WEIGHTS},
        "componentLabels": dict(COMPONENT_LABELS),
        "tiers": [[floor, label] for floor, label in TIERS],
    }
