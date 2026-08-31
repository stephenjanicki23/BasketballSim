"""The postseason: sixteen clubs, four rounds, best-of-seven.

Eight from each conference, seeded on record. 1v8, 2v7, 3v6, 4v5, and the
winners fold inward until each conference has a champion; those two meet in the
**Keystone Finals**.

**The bracket is derived, never stored.** This module keeps no state of its
own: a series is reconstructed from the playoff fixtures already on the
league's schedule, the same way the standings are rebuilt from results. Two
things follow, and both were worth the constraint. A postseason survives a save
and reload with no change to the save format at all -- playoff games are
`ScheduledGame`s and `dump_game` already knows how to write one. And there is
no second source of truth to drift: if the games say a series is 3-2, it is
3-2.

A series is identified by its round and the pair of clubs in it, so nothing has
to be parsed out of a label. Game order inside a series is tip-off order.

**Fixtures are created as they are earned.** A best-of-seven does not know it
needs a game six until game five is played, and the opponent in round two does
not exist until round one ends. So `advance` is called on every tick and adds
exactly the games that are now knowable: the next game of a live series, or the
first games of a round that has just become possible. Nothing is scheduled and
then cancelled, which means the fixture list never contains a game that will
not be played.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from ..conferences import CONFERENCES, FINALS_NAME, conference_for
from .calendar import DAILY_TIPOFFS, PACIFIC, GameStatus, ScheduledGame, game_id

# Round names, in order. The last one is the championship and is not tied to a
# conference; the three before it are played inside one.
FIRST_ROUND = "First Round"
CONFERENCE_SEMIS = "Conference Semifinals"
CONFERENCE_FINALS = "Conference Finals"
KEYSTONE_FINALS = FINALS_NAME

ROUNDS: tuple[str, ...] = (
    FIRST_ROUND, CONFERENCE_SEMIS, CONFERENCE_FINALS, KEYSTONE_FINALS,
)
PLAYOFF_ROUNDS = frozenset(ROUNDS)

SEEDS = 8
WINS_NEEDED = 4
MAX_GAMES = 7

# 2-2-1-1-1. True means the higher seed is at home. Games are indexed from 0.
HOME_PATTERN: tuple[bool, ...] = (True, True, False, False, True, False, True)

# Postseason pacing. One game every other day, and a few days between rounds
# so a sweep does not run straight into the next series.
DAYS_BETWEEN_GAMES = 2
DAYS_BETWEEN_ROUNDS = 3

# The postseason runs two games a day and no more, in the first slate and the
# last -- an early game and a night game -- rather than the eight-at-once wall
# the regular season allows. The slots are the calendar's own first and last
# tip times, so a playoff day sits inside the same schedule as the season it
# grew out of.
PLAYOFF_SLOTS: tuple[time, ...] = (DAILY_TIPOFFS[0], DAILY_TIPOFFS[-1])
GAMES_PER_DAY = len(PLAYOFF_SLOTS)

# Who meets whom in round two, by seed. The bracket is fixed at seeding time:
# the 1/8 winner takes the 4/5 winner whatever the upsets, which is what makes
# a bracket a bracket rather than a re-seed.
SEMIFINAL_PAIRS: tuple[tuple[int, int], ...] = ((1, 8), (4, 5)), ((2, 7), (3, 6))

# The first round in bracket order -- the high seed of each series, top to
# bottom, so that two series sharing a semifinal sit next to each other. Read
# straight off SEMIFINAL_PAIRS: 1/8 and 4/5 feed one semifinal, 2/7 and 3/6 the
# other, giving 1, 4, 2, 3.
_FIRST_ROUND_ORDER: tuple[int, ...] = tuple(
    matchup[0] for pair in SEMIFINAL_PAIRS for matchup in pair)

# Which semifinal (0 or 1) a seed belongs to, so a rebuilt semifinal series can
# be placed in the right half of the bracket whoever survived the first round.
_SEMI_OF_SEED: dict[int, int] = {
    seed: index
    for index, pair in enumerate(SEMIFINAL_PAIRS)
    for matchup in pair for seed in matchup
}


def is_playoff(game: ScheduledGame) -> bool:
    return game.round_label in PLAYOFF_ROUNDS


@dataclass
class Series:
    """One best-of-seven, as read off the fixtures that exist for it."""

    round_label: str
    conference: str | None          # None for the Keystone Finals
    high_seed: str                  # team id, home-court advantage
    low_seed: str
    high_rank: int = 0
    low_rank: int = 0
    games: list[ScheduledGame] = field(default_factory=list)

    @property
    def teams(self) -> frozenset[str]:
        return frozenset((self.high_seed, self.low_seed))

    def wins(self, team_id: str) -> int:
        return sum(
            1 for g in self.games
            if g.status == GameStatus.FINAL and g.result is not None
            and g.result.winner_id == team_id
        )

    @property
    def high_wins(self) -> int:
        return self.wins(self.high_seed)

    @property
    def low_wins(self) -> int:
        return self.wins(self.low_seed)

    @property
    def winner(self) -> str | None:
        if self.high_wins >= WINS_NEEDED:
            return self.high_seed
        if self.low_wins >= WINS_NEEDED:
            return self.low_seed
        return None

    @property
    def loser(self) -> str | None:
        won = self.winner
        if won is None:
            return None
        return self.low_seed if won == self.high_seed else self.high_seed

    @property
    def complete(self) -> bool:
        return self.winner is not None

    @property
    def played(self) -> int:
        return sum(1 for g in self.games if g.status == GameStatus.FINAL)

    @property
    def decided_but_unplayed(self) -> bool:
        """Every scheduled game is done and the series is still not settled."""
        return not self.complete and all(
            g.status == GameStatus.FINAL for g in self.games
        )

    def to_dict(self) -> dict:
        return {
            "round": self.round_label,
            "conference": self.conference,
            "highSeed": self.high_seed,
            "lowSeed": self.low_seed,
            "highRank": self.high_rank,
            "lowRank": self.low_rank,
            "highWins": self.high_wins,
            "lowWins": self.low_wins,
            "winner": self.winner,
            "complete": self.complete,
            "games": [
                {
                    "id": g.id,
                    "number": index + 1,
                    "homeTeamId": g.home_team_id,
                    "awayTeamId": g.away_team_id,
                    "status": g.status.value,
                    "tipoff": g.tipoff_at.isoformat(),
                    "homeScore": g.result.home_score if g.result else None,
                    "awayScore": g.result.away_score if g.result else None,
                }
                for index, g in enumerate(self.games)
            ],
        }


# --------------------------------------------------------------------------
# Seeding
# --------------------------------------------------------------------------

def seed_conference(league, conference: str) -> list[str]:
    """The eight clubs from one conference, best first.

    Ordered on wins, then point differential, then id. The last term is not a
    tie-break anyone would defend on merit -- it is there so that a genuinely
    level pair produces the same bracket on every machine and every reload,
    which matters more here than being clever.
    """
    rows = []
    for team_id, team in league.teams.items():
        if conference_for(team.abbreviation) != conference:
            continue
        row = league.standings.get(team_id)
        wins = row.wins if row else 0
        diff = row.point_differential if row else 0
        rows.append((-wins, -diff, team_id))
    rows.sort()
    return [team_id for _w, _d, team_id in rows[:SEEDS]]


def regular_season_complete(league) -> bool:
    fixtures = [g for g in league.schedule if not is_playoff(g)]
    return bool(fixtures) and all(g.status == GameStatus.FINAL for g in fixtures)


# --------------------------------------------------------------------------
# Reading the bracket back off the schedule
# --------------------------------------------------------------------------

def _ranks(league) -> dict[str, tuple[str, int]]:
    """team id -> (conference, seed number), for everyone who qualified."""
    out: dict[str, tuple[str, int]] = {}
    for conference in CONFERENCES:
        for index, team_id in enumerate(seed_conference(league, conference)):
            out[team_id] = (conference, index + 1)
    return out


def series_in(league, round_label: str) -> list[Series]:
    """Every series of one round, rebuilt from its fixtures."""
    ranks = _ranks(league)
    grouped: dict[frozenset[str], list[ScheduledGame]] = {}
    for game in league.schedule:
        if game.round_label != round_label:
            continue
        pair = frozenset((game.home_team_id, game.away_team_id))
        grouped.setdefault(pair, []).append(game)

    built: list[Series] = []
    for pair, games in grouped.items():
        games.sort(key=lambda g: g.tipoff_at)
        a, b = sorted(pair)
        rank_a = ranks.get(a, ("", 99))[1]
        rank_b = ranks.get(b, ("", 99))[1]
        high, low = (a, b) if rank_a <= rank_b else (b, a)
        conference = ranks.get(high, (None, 0))[0]
        built.append(Series(
            round_label=round_label,
            conference=None if round_label == KEYSTONE_FINALS else conference,
            high_seed=high, low_seed=low,
            high_rank=min(rank_a, rank_b), low_rank=max(rank_a, rank_b),
            games=games,
        ))
    built.sort(key=lambda s: (s.conference or "", s.high_rank))
    return built


def _bracket_key(series: "Series", label: str) -> tuple:
    """Where a series sits in the drawn bracket, top to bottom.

    `series_in` sorts by seed, which is right for a table and wrong for a
    bracket: it puts 1/8 next to 2/7, two series that never meet, and makes the
    draw look as though they would. This orders by the half of the bracket a
    series lives in instead, so the picture reads down the page the way a
    bracket should.
    """
    conf = CONFERENCES.index(series.conference) if series.conference in CONFERENCES else 9
    if label == FIRST_ROUND:
        rank = series.high_rank
        order = _FIRST_ROUND_ORDER.index(rank) if rank in _FIRST_ROUND_ORDER else 9
        return (conf, order)
    if label == CONFERENCE_SEMIS:
        return (conf, _SEMI_OF_SEED.get(series.high_rank, 9))
    return (conf, 0)


def bracket(league) -> dict:
    """The whole postseason as the front end wants it."""
    rounds = []
    for label in ROUNDS:
        found = series_in(league, label)
        if found:
            found = sorted(found, key=lambda s: _bracket_key(s, label))
            rounds.append({"round": label, "series": [s.to_dict() for s in found]})
    champion = None
    finals = series_in(league, KEYSTONE_FINALS)
    if finals and finals[0].complete:
        champion = finals[0].winner
    return {
        "started": bool(rounds),
        "rounds": rounds,
        "champion": champion,
        "seeds": {
            conference: seed_conference(league, conference)
            for conference in CONFERENCES
        } if regular_season_complete(league) else {},
    }


def champion(league) -> str | None:
    finals = series_in(league, KEYSTONE_FINALS)
    return finals[0].winner if finals else None


# --------------------------------------------------------------------------
# Scheduling: add the games that have just become knowable
# --------------------------------------------------------------------------

def _make_game(league, series_round: str, high: str, low: str, number: int,
               tipoff: datetime) -> ScheduledGame:
    """One fixture of a series, with home court on the 2-2-1-1-1 pattern.

    `tipoff` is a full UTC datetime rather than a bare day, because a playoff
    game now carries a slot -- an early game or a night game -- not just a date.
    `_next_slot` is what chooses it.
    """
    high_home = HOME_PATTERN[number - 1]
    home, away = (high, low) if high_home else (low, high)
    label = series_round
    # The id has to be unique per game *and* stable across reloads, so the
    # series and game number go into the key rather than just the two clubs.
    key = f"{label}#{number}"
    return ScheduledGame(
        id=game_id(league.season, key, home, away),
        home_team_id=home,
        away_team_id=away,
        tipoff_at=tipoff,
        season=league.season,
        round_label=label,
    )


def _next_slot(scheduled, not_before: date) -> datetime:
    """The next open playoff slot on or after `not_before`.

    Two games a day, in the first slate and the last: a day already holding two
    playoff games is full and the search moves on. Counts the games passed in --
    both those already on the schedule and the ones being added in this same
    pass -- so a round's fixtures spread across the days instead of piling onto
    one.
    """
    used: dict[date, set[time]] = {}
    for game in scheduled:
        if is_playoff(game):
            local = game.tipoff_at.astimezone(PACIFIC)
            used.setdefault(local.date(), set()).add(
                local.time().replace(second=0, microsecond=0))
    day = not_before
    while True:
        taken = used.get(day, set())
        for slot in PLAYOFF_SLOTS:
            if slot not in taken:
                local = datetime.combine(day, slot, tzinfo=PACIFIC)
                return local.astimezone(timezone.utc)
        day += timedelta(days=1)


def _last_playoff_day(league) -> date | None:
    days = [g.tipoff_at.date() for g in league.schedule if is_playoff(g)]
    return max(days) if days else None


def _regular_season_end(league) -> date:
    days = [g.tipoff_at.date() for g in league.schedule if not is_playoff(g)]
    return max(days) if days else date.today()


def _next_round(label: str) -> str | None:
    index = ROUNDS.index(label)
    return ROUNDS[index + 1] if index + 1 < len(ROUNDS) else None


def _pairs_for_next_round(league, label: str) -> list[tuple[str, str]]:
    """Who plays whom in the round after `label`, or [] if it is not settled."""
    finished = series_in(league, label)
    if not finished or not all(s.complete for s in finished):
        return []
    nxt = _next_round(label)
    if nxt is None:
        return []

    if nxt == KEYSTONE_FINALS:
        winners = [s.winner for s in finished]
        return [(winners[0], winners[1])] if len(winners) == 2 else []

    pairs: list[tuple[str, str]] = []
    for conference in CONFERENCES:
        in_conf = [s for s in finished if s.conference == conference]
        if nxt == CONFERENCE_SEMIS:
            by_rank = {s.high_rank: s for s in in_conf}
            for top, bottom in SEMIFINAL_PAIRS:
                first, second = by_rank.get(top[0]), by_rank.get(bottom[0])
                if first and second and first.winner and second.winner:
                    pairs.append((first.winner, second.winner))
        else:  # conference finals: the two survivors meet
            winners = [s.winner for s in in_conf if s.winner]
            if len(winners) == 2:
                pairs.append((winners[0], winners[1]))
    return pairs


def _ordered(league, pair: tuple[str, str]) -> tuple[str, str]:
    """(higher seed, lower seed) for a pair, on regular-season seeding."""
    ranks = _ranks(league)
    a, b = pair
    rank_a = ranks.get(a, ("", 99))[1]
    rank_b = ranks.get(b, ("", 99))[1]
    if rank_a == rank_b:
        # Cross-conference: the Keystone Finals. Fall back to record.
        row_a, row_b = league.standings.get(a), league.standings.get(b)
        key_a = (row_a.wins if row_a else 0, row_a.point_differential if row_a else 0)
        key_b = (row_b.wins if row_b else 0, row_b.point_differential if row_b else 0)
        return (a, b) if key_a >= key_b else (b, a)
    return (a, b) if rank_a < rank_b else (b, a)


def advance(league) -> list[ScheduledGame]:
    """Add every playoff fixture that is now knowable. Returns what was added.

    Idempotent: calling it twice in a row adds nothing the second time, which
    is what lets `League.tick` call it on every heartbeat.
    """
    if not regular_season_complete(league):
        return []

    added: list[ScheduledGame] = []

    # Round one, if it has not started.
    if not series_in(league, FIRST_ROUND):
        start = _regular_season_end(league) + timedelta(days=DAYS_BETWEEN_ROUNDS)
        # Order the openers the way the bracket reads -- 1/8, 4/5, 2/7, 3/6 --
        # so the two games sharing a day are the two that will meet, not two
        # halves of the draw that never touch.
        for conference in CONFERENCES:
            seeds = seed_conference(league, conference)
            if len(seeds) < SEEDS:
                continue
            for high_seed in _FIRST_ROUND_ORDER:
                high = seeds[high_seed - 1]
                low = seeds[SEEDS - high_seed]
                tipoff = _next_slot(league.schedule + added, start)
                added.append(_make_game(
                    league, FIRST_ROUND, high, low, 1, tipoff))
        if added:
            league.set_schedule(league.schedule + added)
        return added

    # Any live series that needs its next game, and any round that has just
    # become possible.
    for label in ROUNDS:
        existing = series_in(league, label)
        if not existing:
            continue
        for s in existing:
            if s.complete or not s.decided_but_unplayed:
                continue
            if len(s.games) >= MAX_GAMES:
                continue
            earliest = s.games[-1].tipoff_at.astimezone(PACIFIC).date() + \
                timedelta(days=DAYS_BETWEEN_GAMES)
            tipoff = _next_slot(league.schedule + added, earliest)
            added.append(_make_game(
                league, label, s.high_seed, s.low_seed, len(s.games) + 1, tipoff))

        nxt = _next_round(label)
        if nxt and not series_in(league, nxt):
            pairs = _pairs_for_next_round(league, label)
            if pairs:
                last = _last_playoff_day(league) or _regular_season_end(league)
                start = last + timedelta(days=DAYS_BETWEEN_ROUNDS)
                for pair in pairs:
                    high, low = _ordered(league, pair)
                    tipoff = _next_slot(league.schedule + added, start)
                    added.append(_make_game(league, nxt, high, low, 1, tipoff))

    if added:
        league.set_schedule(league.schedule + added)
    return added
