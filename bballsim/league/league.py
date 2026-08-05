"""The league: teams, schedule, standings, and the clock that drives sim days.

`League.tick()` is the heartbeat. Call it as often as you like (the API calls
it on every request); it starts any game whose tip-off has passed and finalises
any game whose play-by-play has fully played out.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from ..chemistry import drift_after_game
from .. import health
from ..engine.game import GameRules, GameSimulator
from ..conferences import conference_for
from ..models import Team
from . import offseason, playoffs
from .. import trade_market
from .calendar import PACIFIC, GameStatus, ScheduledGame
from .stats import SeasonStats

# Game seconds revealed per real-time second. The league runs on real days at
# real times, so a game reveals at real speed too: it tips off at 8am Pacific
# and the fourth quarter happens when the fourth quarter happens. Raising this
# would mean a game scheduled for 8:00 was over by 8:03, which is not what
# "three slates a day" describes.
DEFAULT_TRACKER_SPEED = 1.0

# How many times `tick` will re-check after the postseason or the offseason
# adds fixtures. A playoff run is four rounds and an offseason is one more
# pass, so a single season needs a handful; the headroom is for a clock
# jumped years forward, which rolls a whole season on every few passes.
MAX_TICK_PASSES = 256

# Padding after the final buzzer before a game flips to FINAL.
POSTGAME_TAIL_SECONDS = 15.0


@dataclass
class StandingsRow:
    team_id: str
    wins: int = 0
    losses: int = 0
    points_for: int = 0
    points_against: int = 0

    @property
    def games_played(self) -> int:
        return self.wins + self.losses

    @property
    def win_pct(self) -> float:
        return self.wins / self.games_played if self.games_played else 0.0

    @property
    def point_differential(self) -> int:
        return self.points_for - self.points_against

    def to_dict(self) -> dict:
        return {
            "team_id": self.team_id,
            "wins": self.wins,
            "losses": self.losses,
            "games_played": self.games_played,
            "win_pct": round(self.win_pct, 3),
            "points_for": self.points_for,
            "points_against": self.points_against,
            "point_differential": self.point_differential,
        }


class LeagueClock:
    """Wall clock with an adjustable offset, so you can jump days ahead."""

    def __init__(self, offset: timedelta | None = None) -> None:
        self.offset = offset or timedelta()

    def now(self) -> datetime:
        return datetime.now(timezone.utc) + self.offset

    def advance(self, delta: timedelta) -> None:
        self.offset += delta

    def jump_to(self, moment: datetime) -> None:
        self.offset = moment - datetime.now(timezone.utc)


@dataclass
class League:
    name: str = "Unnamed League"
    season: str = ""
    teams: dict[str, Team] = field(default_factory=dict)
    schedule: list[ScheduledGame] = field(default_factory=list)
    standings: dict[str, StandingsRow] = field(default_factory=dict)
    rules: GameRules = field(default_factory=GameRules)
    clock: LeagueClock = field(default_factory=LeagueClock)
    tracker_speed: float = DEFAULT_TRACKER_SPEED
    # Season totals, folded in as each game finalises.
    stats: SeasonStats = field(default_factory=SeasonStats)
    # Seasons that are over, oldest first. Appended by the offseason; the only
    # thing in this class that survives a new schedule being installed.
    history: list = field(default_factory=list)
    # The summer in progress: expiring contracts, negotiations, the free agent
    # pool. A `franchise.Offseason`, held untyped because `franchise` reads the
    # league to build it. `None` until the Finals conclude and the OFFSEASON
    # menu opens -- `franchise.state()` creates it on first ask.
    offseason: object | None = None

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------
    def add_team(self, team: Team) -> None:
        self.teams[team.id] = team
        self.standings.setdefault(team.id, StandingsRow(team_id=team.id))

    def set_schedule(self, games: list[ScheduledGame]) -> None:
        self.schedule = sorted(games, key=lambda g: g.tipoff_at)

    def game(self, game_id: str) -> ScheduledGame | None:
        return next((g for g in self.schedule if g.id == game_id), None)

    def games_on(self, day: date) -> list[ScheduledGame]:
        return [g for g in self.schedule if g.game_date == day]

    def live_games(self) -> list[ScheduledGame]:
        return [g for g in self.schedule if g.status == GameStatus.LIVE]

    def next_game_after(self, moment: datetime) -> ScheduledGame | None:
        upcoming = [g for g in self.schedule if g.tipoff_at > moment]
        return upcoming[0] if upcoming else None

    # ------------------------------------------------------------------
    # The heartbeat
    # ------------------------------------------------------------------
    def tick(self) -> list[ScheduledGame]:
        """Advance the league to the current clock time.

        Returns the games whose status changed on this tick.

        Loops because the postseason schedules itself as it is earned: a
        best-of-seven does not know it needs a game six until game five is
        played, so finishing a game can create the next one, which may already
        be due. One pass would leave a bracket a game behind on every tick and
        a clock jumped forward a month stuck in the first round.
        """
        changed: list[ScheduledGame] = []
        for _ in range(MAX_TICK_PASSES):
            now = self.clock.now()
            moved = False

            for game in self.schedule:
                if game.status == GameStatus.SCHEDULED and game.tipoff_at <= now:
                    self._start(game)
                    changed.append(game)
                    moved = True

                if game.status == GameStatus.LIVE and self._is_over(game, now):
                    self._finalize(game, now)
                    changed.append(game)
                    moved = True

            if playoffs.advance(self):
                moved = True

            # Front offices doing their own business. Guarded inside: the
            # market only opens on a league-day cadence, so the ordinary tick
            # pays one datetime comparison rather than a trade search.
            trade_market.run(self)

            # The season is over and the summer has passed: age everybody,
            # replace whoever retired, and put a new calendar up. Same shape as
            # `playoffs.advance` above -- called every tick, declines unless the
            # league has actually earned it -- and it loops for the same reason,
            # because a clock jumped a long way forward can be owed more than
            # one of them.
            if offseason.is_due(self):
                if offseason.roll(self) is not None:
                    moved = True

            if not moved:
                break

        return changed

    def _start(self, game: ScheduledGame) -> None:
        home = self.teams[game.home_team_id]
        away = self.teams[game.away_team_id]

        # Team sheets, before anybody takes the floor. Who sits is the coach's
        # judgement -- or the manager's instruction, which outranks it -- and
        # nobody is rested out of a postseason game.
        postseason = playoffs.is_playoff(game)
        for team in (home, away):
            health.apply_rest(team, health.plan_rest(team, playoff=postseason))
        try:
            simulator = GameSimulator(
                game_id=game.id, home=home, away=away, rules=self.rules, seed=game.id
            )
            game.result = simulator.simulate()
        finally:
            # A team sheet lasts one night. Leaving it set would carry tonight's
            # rest into every future selection, including the squad page.
            for team in (home, away):
                health.clear_rest(team)
        game.status = GameStatus.LIVE
        # Anchor the tracker clock to tip-off, not to "now" -- a game that
        # started an hour ago should already be over when you open the app.
        game.started_at = game.tipoff_at

    def _is_over(self, game: ScheduledGame, now: datetime) -> bool:
        if game.result is None:
            return True
        revealed = game.revealed_seconds(now, self.tracker_speed)
        return revealed >= game.result.duration_game_seconds + POSTGAME_TAIL_SECONDS

    def _finalize(self, game: ScheduledGame, now: datetime) -> None:
        game.status = GameStatus.FINAL
        result = game.result
        # When the final buzzer *would* have sounded, not when we noticed.
        if result is not None and game.started_at is not None:
            game.finished_at = game.started_at + timedelta(
                seconds=(result.duration_game_seconds + POSTGAME_TAIL_SECONDS) / self.tracker_speed
            )
        else:
            game.finished_at = now
        if result is None:
            return

        self._record(game)

        # What the game did to the players. Deliberately *not* in `_record`,
        # for the same reason chemistry is not: a season restored from disk
        # folds its saved results back into the standings, and re-applying a
        # night's fatigue and re-rolling its injuries would age a squad by a
        # whole season every time the app booted.
        health.after_game(self, game)

        # Chemistry grows from shared floor time. Deliberately *not* part of
        # `_record`: a restored season folds its saved results back into the
        # standings, and that must not drift chemistry a second time -- the
        # chemistry those games produced is already saved on the teams.
        for team_id, box_owner in ((game.home_team_id, "home"), (game.away_team_id, "away")):
            team = self.teams.get(team_id)
            if team is None:
                continue
            pair_minutes = getattr(result, f"{box_owner}_pair_minutes", None)
            if pair_minutes:
                drift_after_game(team, pair_minutes)

    def _record(self, game: ScheduledGame) -> None:
        """Fold one finished game into the standings and the season stats.

        Standings and stats are never saved -- they are derived here, from
        results, both when a game finalises live and when a season is loaded
        from disk. Deriving them twice from the same place is what stops a
        restored table from disagreeing with the games behind it.

        Playoff games are excluded, and not only for tidiness. Seeding is read
        off the standings, so folding postseason results back into them makes
        the bracket move under its own feet: a club that has won two rounds
        climbs the table, its seed changes, and the semi-final it already
        played is relabelled. Left in, an 82-game season also produced records
        like 56-53.
        """
        if playoffs.is_playoff(game):
            return
        result = game.result
        if result is None:
            return

        # The stats layer only sees box scores, so hand it the roster detail
        # it cannot infer -- which team a player belongs to, and his position.
        self.stats.add_game(result, roster=self._roster_lookup(game))

        home_row = self.standings.setdefault(game.home_team_id, StandingsRow(game.home_team_id))
        away_row = self.standings.setdefault(game.away_team_id, StandingsRow(game.away_team_id))
        home_row.points_for += result.home_score
        home_row.points_against += result.away_score
        away_row.points_for += result.away_score
        away_row.points_against += result.home_score
        if result.home_score > result.away_score:
            home_row.wins += 1
            away_row.losses += 1
        else:
            away_row.wins += 1
            home_row.losses += 1

    def restore_schedule(self, games: list[ScheduledGame]) -> None:
        """Install a schedule loaded from disk, rebuilding the derived tables.

        Any game already FINAL is folded straight into the standings and season
        stats. LIVE games come back as SCHEDULED: nothing depends on a game in
        progress, and the next tick re-tips it -- to the same game, since the
        seed is the fixture id.
        """
        for game in games:
            if game.status == GameStatus.LIVE:
                game.status = GameStatus.SCHEDULED
                game.result = None
                game.started_at = None

        self.set_schedule(games)
        self.standings = {tid: StandingsRow(team_id=tid) for tid in self.teams}
        self.stats = SeasonStats()
        for game in self.schedule:
            if game.status == GameStatus.FINAL:
                self._record(game)

    def _roster_lookup(self, game: ScheduledGame) -> dict[str, tuple[str, str]]:
        lookup: dict[str, tuple[str, str]] = {}
        for team_id in (game.home_team_id, game.away_team_id):
            team = self.teams.get(team_id)
            if team is None:
                continue
            for player in team.players:
                lookup[player.id] = (team_id, player.position.value)
        return lookup

    # ------------------------------------------------------------------
    # Tracker feed
    # ------------------------------------------------------------------
    def feed(self, game: ScheduledGame, since_sequence: int = 0) -> dict:
        """Play-by-play revealed so far, for the game tracker."""
        now = self.clock.now()
        if game.result is None:
            return {
                "game": game.to_dict(),
                "events": [],
                "play_by_play_available": False,
                "revealed_seconds": 0.0,
                "complete": False,
            }

        if game.status == GameStatus.FINAL:
            revealed = float("inf")
        else:
            revealed = game.revealed_seconds(now, self.tracker_speed)

        if not game.result.events:
            # A game restored from a save. The box score and the final score
            # are stored; the play-by-play is not -- a season of it is ~90MB.
            # Report the result honestly rather than an empty 0-0 feed.
            return {
                "game": game.to_dict(),
                "events": [],
                "play_by_play_available": False,
                "revealed_seconds": None,
                "home_score": game.result.home_score,
                "away_score": game.result.away_score,
                "period": game.result.periods_played,
                "clock": "0:00",
                "complete": game.status == GameStatus.FINAL,
                "last_sequence": since_sequence,
            }

        events = [
            e.to_dict()
            for e in game.result.events
            if e.sequence > since_sequence and e.game_seconds <= revealed
        ]
        shown = [e for e in game.result.events if e.game_seconds <= revealed]
        last = shown[-1] if shown else None

        return {
            "game": game.to_dict(),
            "events": events,
            "play_by_play_available": True,
            "revealed_seconds": None if revealed == float("inf") else round(revealed, 1),
            "home_score": last.home_score if last else 0,
            "away_score": last.away_score if last else 0,
            "period": last.period if last else 1,
            "clock": last.clock if last else "12:00",
            "complete": game.status == GameStatus.FINAL,
            "last_sequence": last.sequence if last else since_sequence,
        }

    # ------------------------------------------------------------------
    def standings_table(self) -> list[dict]:
        rows = sorted(
            self.standings.values(),
            key=lambda r: (-r.win_pct, -r.point_differential, r.team_id),
        )
        out = []
        # Seeds are per conference, so the rank a club carries in this table is
        # its rank among its own fifteen -- which is the number that decides
        # whether it is playing in the postseason at all.
        seen: dict[str, int] = {}
        for row in rows:
            data = row.to_dict()
            team = self.teams.get(row.team_id)
            data["team_name"] = team.full_name if team else row.team_id
            data["abbreviation"] = team.abbreviation if team else ""
            conference = conference_for(team.abbreviation) if team else ""
            data["conference"] = conference
            seen[conference] = seen.get(conference, 0) + 1
            data["conference_rank"] = seen[conference]
            data["in_playoff_places"] = seen[conference] <= playoffs.SEEDS
            out.append(data)
        return out

    def to_dict(self) -> dict:
        now = self.clock.now()
        next_game = self.next_game_after(now)
        return {
            "name": self.name,
            "season": self.season,
            "now": now.isoformat(),
            "tracker_speed": self.tracker_speed,
            "team_count": len(self.teams),
            "games_scheduled": len(self.schedule),
            "games_final": sum(1 for g in self.schedule if g.status == GameStatus.FINAL),
            "games_live": sum(1 for g in self.schedule if g.status == GameStatus.LIVE),
            "next_tipoff": next_game.tipoff_at.isoformat() if next_game else None,
        }
