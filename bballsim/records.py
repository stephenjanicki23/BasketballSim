"""The record book: the best single game, and the best season.

Two halves that look alike on the page and are built in opposite ways, for a
reason worth stating plainly.

**Season records are derived.** Every finished season is archived with its
player and team *totals* (`offseason.SeasonArchive`), and the season in progress
is in `league.stats`. So "most points in a season" is a question the league can
always answer by looking, and this module never stores an answer to it -- same
discipline as the standings, the MVP race and the trade block.

**Single-game records have to be kept.** They are the one thing in this project
that genuinely cannot be re-derived. A box score lives on its `ScheduledGame`,
`offseason.reschedule` replaces the whole calendar every summer, and the archive
holds totals only -- so the night somebody scored 61 is gone the moment the
season rolls. Deriving it later is not slow, it is impossible.

That is the same argument `save.HISTORY_PATH` makes for archiving season totals
at all, and the same one `health` makes for storing fatigue. The rule this
project actually follows is not "never store" -- it is **never store what can be
derived**, and a game record cannot be.

**Kept idempotent rather than kept carefully.** Every mark carries the game id
it came from, and offering the same game twice replaces rather than duplicates.
That matters because a season restored from disk folds its results back through
`League._record`, and a book that counted a 61-point night twice on every boot
would be worse than no book. Idempotence means the hook can live wherever it is
convenient and cannot be got wrong.

**Playoff games count.** `_record` excludes the postseason from the standings
for good reasons -- seeding is read off the table -- but none of them apply
here. A record book that ignored the Finals would be a strange record book, so
each mark says which stage it came from and the screen shows it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .league import playoffs

# How many names deep each list runs. Ten is what a record book is; three reads
# as a leaderboard and fifty is a data dump.
DEPTH = 10

# A season line has to clear this share of the season to hold a *rate* record.
# Without it "most points per game" is won every year by somebody who played
# one game and scored 30. Totals need no such guard -- they are self-limiting.
RATE_MINIMUM_SHARE = 0.55


# --------------------------------------------------------------------------
# What is worth recording
#
# Each entry is (key, label, how to read it off a line). The keys are the
# contract with the front end and with `data/records.json`, so they are not
# renamed casually -- a renamed key silently empties a stored list.
# --------------------------------------------------------------------------

def _rebounds(line) -> int:
    return line.offensive_rebounds + line.defensive_rebounds


GAME_PLAYER_CATEGORIES: tuple[tuple[str, str, object], ...] = (
    ("points", "Points", lambda l: l.points),
    ("rebounds", "Rebounds", _rebounds),
    ("assists", "Assists", lambda l: l.assists),
    ("steals", "Steals", lambda l: l.steals),
    ("blocks", "Blocks", lambda l: l.blocks),
    ("tpm", "Three-pointers", lambda l: l.tpm),
    ("fgm", "Field goals", lambda l: l.fgm),
    ("ftm", "Free throws", lambda l: l.ftm),
    ("minutes", "Minutes", lambda l: l.seconds / 60.0),
)

# `TeamBox` sums on demand through `total()` rather than carrying its own
# counters, so these read through it instead of off attributes that do not
# exist. Only `points` is a property.
GAME_TEAM_CATEGORIES: tuple[tuple[str, str, object], ...] = (
    ("points", "Points", lambda box, scored, conceded: scored),
    ("margin", "Margin of victory", lambda box, scored, conceded: scored - conceded),
    ("tpm", "Three-pointers", lambda box, scored, conceded: box.total("tpm")),
    ("assists", "Assists", lambda box, scored, conceded: box.total("assists")),
    ("rebounds", "Rebounds", lambda box, scored, conceded:
     box.total("offensive_rebounds") + box.total("defensive_rebounds")),
)

SEASON_PLAYER_TOTALS: tuple[tuple[str, str, object], ...] = (
    ("points", "Points", lambda l: l.points),
    ("rebounds", "Rebounds", lambda l: l.rebounds),
    ("assists", "Assists", lambda l: l.assists),
    ("steals", "Steals", lambda l: l.steals),
    ("blocks", "Blocks", lambda l: l.blocks),
    ("tpm", "Three-pointers", lambda l: l.tpm),
)

SEASON_PLAYER_RATES: tuple[tuple[str, str, object], ...] = (
    ("ppg", "Points per game", lambda l: l.points / l.games),
    ("rpg", "Rebounds per game", lambda l: l.rebounds / l.games),
    ("apg", "Assists per game", lambda l: l.assists / l.games),
)

SEASON_TEAM_CATEGORIES: tuple[tuple[str, str, object], ...] = (
    ("wins", "Wins", lambda l: l.wins),
    ("points", "Points per game", lambda l: l.points / l.games if l.games else 0.0),
    ("margin", "Point differential", lambda l: (l.points - l.points_against) / l.games
     if l.games else 0.0),
)


@dataclass
class Mark:
    """One line in one list. A number, and enough to say whose and when."""

    value: float
    holder_id: str = ""          # player id, or team id for a team record
    name: str = ""
    team_id: str = ""
    season: str = ""
    game_id: str = ""            # empty for a season record
    opponent_id: str = ""
    played_on: str = ""
    stage: str = ""              # "" for the regular season, else the round
    detail: str = ""             # the rest of the line, e.g. "24 pts, 11 reb"

    def to_dict(self) -> dict:
        return {
            "value": round(self.value, 1),
            "holderId": self.holder_id,
            "name": self.name,
            "teamId": self.team_id,
            "season": self.season,
            "gameId": self.game_id,
            "opponentId": self.opponent_id,
            "playedOn": self.played_on,
            "stage": self.stage,
            "detail": self.detail,
        }


@dataclass
class Book:
    """Every stored single-game list. Season lists are not in here on purpose.

    Keys are `"player:points"` / `"team:margin"` so one flat dict survives a
    round trip through JSON without a nested shape to keep in step.
    """

    games: dict[str, list[Mark]] = field(default_factory=dict)

    def list_for(self, key: str) -> list[Mark]:
        return self.games.setdefault(key, [])


def book_for(league) -> Book:
    """The league's record book, created on first ask.

    Held on the league object for the same reason the offseason record and the
    pick inventory are: every screen wants the same one.
    """
    existing = getattr(league, "records", None)
    if isinstance(existing, Book):
        return existing
    made = Book()
    league.records = made
    return made


# --------------------------------------------------------------------------
# Watching games
# --------------------------------------------------------------------------

def _offer(marks: list[Mark], mark: Mark) -> bool:
    """Put a mark in a list if it belongs there. True if the list changed.

    Replaces any existing mark from the same game and holder, which is what
    makes observing a game twice a no-op instead of a duplicate.
    """
    if mark.value <= 0:
        return False
    kept = [m for m in marks
            if not (m.game_id == mark.game_id and m.holder_id == mark.holder_id)]
    kept.append(mark)
    # Ties break on the older game, so a record set first is listed first and a
    # later equal performance does not push it down.
    kept.sort(key=lambda m: (-m.value, m.played_on, m.holder_id))
    del kept[DEPTH:]
    changed = kept != marks
    marks[:] = kept
    return changed


def _line_detail(line) -> str:
    parts = []
    if line.points:
        parts.append(f"{line.points} pts")
    rebounds = _rebounds(line)
    if rebounds:
        parts.append(f"{rebounds} reb")
    if line.assists:
        parts.append(f"{line.assists} ast")
    return ", ".join(parts)


def observe(league, game) -> int:
    """Offer one finished game to every single-game list. Returns marks taken.

    Safe to call repeatedly with the same game -- see `_offer`.
    """
    result = getattr(game, "result", None)
    if result is None:
        return 0

    book = book_for(league)
    stage = getattr(game, "round_label", "") if playoffs.is_playoff(game) else ""
    played_on = game.tipoff_at.isoformat() if game.tipoff_at else ""
    season = getattr(game, "season", "") or getattr(league, "season", "")
    taken = 0

    sides = (
        (result.home_box, result.home_team_id, result.away_team_id,
         result.home_score, result.away_score),
        (result.away_box, result.away_team_id, result.home_team_id,
         result.away_score, result.home_score),
    )
    for box, team_id, opponent_id, scored, conceded in sides:
        for line in box.players.values():
            if line.seconds <= 0:
                continue
            for key, _label, read in GAME_PLAYER_CATEGORIES:
                taken += _offer(book.list_for(f"player:{key}"), Mark(
                    value=float(read(line)),
                    holder_id=line.player_id, name=line.name, team_id=team_id,
                    season=season, game_id=game.id, opponent_id=opponent_id,
                    played_on=played_on, stage=stage, detail=_line_detail(line),
                ))
        for key, _label, read in GAME_TEAM_CATEGORIES:
            taken += _offer(book.list_for(f"team:{key}"), Mark(
                value=float(read(box, scored, conceded)),
                holder_id=team_id, name=box.name, team_id=team_id,
                season=season, game_id=game.id, opponent_id=opponent_id,
                played_on=played_on, stage=stage,
                detail=f"{scored}-{conceded}",
            ))
    return taken


def backfill(league) -> int:
    """Offer every finished game still on the calendar to the book.

    For a league that predates the record book, or one whose `records.json` is
    missing. It cannot recover seasons whose calendars have already been
    replaced -- that is the whole reason the book is stored -- but it means an
    existing save is not left with an empty page.
    """
    return sum(observe(league, game) for game in getattr(league, "schedule", [])
               if getattr(game, "result", None) is not None)


# --------------------------------------------------------------------------
# Season records, derived
# --------------------------------------------------------------------------

def _season_sources(league):
    """Every season the league can still read totals for, newest last."""
    sources = []
    for archive in getattr(league, "history", []) or []:
        stats = getattr(archive, "stats", None)
        if stats is not None:
            sources.append((getattr(archive, "season", ""), stats))
    current = getattr(league, "stats", None)
    if current is not None:
        sources.append((getattr(league, "season", ""), current))
    return sources


def _season_length(league) -> int:
    """Games per club in the season being played, read off the fixtures."""
    regular = [g for g in getattr(league, "schedule", [])
               if not playoffs.is_playoff(g)]
    teams = len(getattr(league, "teams", {}) or {})
    if not regular or not teams:
        return 82
    return max(1, round(2 * len(regular) / teams))


def season_records(league) -> dict[str, list[dict]]:
    """Every season list, rebuilt from the archives and the live season."""
    minimum = max(1, int(_season_length(league) * RATE_MINIMUM_SHARE))
    out: dict[str, list[Mark]] = {}

    for season, stats in _season_sources(league):
        for line in stats.players.values():
            if not line.games:
                continue
            detail = (f"{line.points / line.games:.1f} pts, "
                      f"{line.rebounds / line.games:.1f} reb, "
                      f"{line.assists / line.games:.1f} ast")
            for key, _label, read in SEASON_PLAYER_TOTALS:
                _offer(out.setdefault(f"player:{key}", []), Mark(
                    value=float(read(line)), holder_id=line.player_id,
                    name=line.name, team_id=line.team_id, season=season,
                    game_id=f"{season}:{line.player_id}", detail=detail,
                ))
            if line.games >= minimum:
                for key, _label, read in SEASON_PLAYER_RATES:
                    _offer(out.setdefault(f"player:{key}", []), Mark(
                        value=float(read(line)), holder_id=line.player_id,
                        name=line.name, team_id=line.team_id, season=season,
                        game_id=f"{season}:{line.player_id}",
                        detail=f"{line.games} games",
                    ))
        for line in stats.teams.values():
            if not line.games:
                continue
            for key, _label, read in SEASON_TEAM_CATEGORIES:
                _offer(out.setdefault(f"team:{key}", []), Mark(
                    value=float(read(line)), holder_id=line.team_id,
                    name=line.name, team_id=line.team_id, season=season,
                    game_id=f"{season}:{line.team_id}",
                    detail=f"{line.wins}-{line.losses}",
                ))
    return {key: [m.to_dict() for m in marks] for key, marks in out.items()}


# --------------------------------------------------------------------------
# The page
# --------------------------------------------------------------------------

def _sections(categories, scope: str, stored: dict, kind: str,
              minimum_games: int = 0) -> list[dict]:
    """Build one card per category.

    `minimum_games` is carried on the rate sections so an empty one can say
    *why* it is empty. "Nothing on record yet" and "nobody has played enough of
    the season to qualify" are different statements, and only the second is
    true a third of the way through a year -- the first reads as a bug.
    """
    return [
        {
            "key": f"{scope}:{key}",
            "label": label,
            "scope": scope,
            "kind": kind,
            "minimumGames": minimum_games,
            "marks": stored.get(f"{scope}:{key}", []),
        }
        for key, label, _read in categories
    ]


def book(league) -> dict:
    """Everything the Records screen shows, in one shape.

    Assembled here rather than in the API layer for the same reason every other
    view is: the live app and the published demo have to read identical JSON.
    """
    stored = {key: [m.to_dict() for m in marks]
              for key, marks in book_for(league).games.items()}
    season = season_records(league)
    seasons = [label for label, _stats in _season_sources(league) if label]
    minimum = max(1, int(_season_length(league) * RATE_MINIMUM_SHARE))

    return {
        "depth": DEPTH,
        "seasons": seasons,
        "rateMinimum": minimum,
        "game": {
            "players": _sections(GAME_PLAYER_CATEGORIES, "player", stored, "game"),
            "teams": _sections(GAME_TEAM_CATEGORIES, "team", stored, "game"),
        },
        "season": {
            "players": (_sections(SEASON_PLAYER_TOTALS, "player", season, "season")
                        + _sections(SEASON_PLAYER_RATES, "player", season,
                                    "season", minimum_games=minimum)),
            "teams": _sections(SEASON_TEAM_CATEGORIES, "team", season, "season"),
        },
        # Said in the payload rather than only in the UI, because the published
        # demo reads the same JSON and the caveat is not decoration: it is the
        # difference between "no record" and "the record is not knowable".
        "note": (
            "Single-game records are kept as games finish, because a box score "
            "cannot be recovered once a season's calendar is replaced. Season "
            "records are rebuilt from the archives every time this page is "
            "opened. Both include the postseason."
        ),
    }
