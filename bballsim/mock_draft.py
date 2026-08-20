"""Five writers who mock the draft, twice a week.

The same argument as `mvp.py`, applied to a draft board. There is no league
consensus board anywhere in this module, because a consensus board is one
formula wearing a press pass. There are five writers, each with a stated
philosophy and a ranking that follows from it, and the interesting reading is
where they disagree -- the man one has ninth and another has second.

    Best available    the board, and nothing else. Need is for the summer.
    Team need         the club's weakest position, every time.
    Upside            ceiling and youth. Current ability is not the job.
    Pro-ready         floor, professionalism, and the small gap to a ceiling.
    Analytics         spacing, versatility and passing. The modern read.

Those are not five weightings of one idea. `UPSIDE` will take a 19-year-old
forty points short of his ceiling; `PRO_READY` will not touch him. The
disagreement is the product.

**Published Wednesdays and Sundays at midnight.** An edition is stamped with
the moment it went out, and the moment is derived from the league clock rather
than stored -- see `edition_at`. Between editions the boards do not move, which
is what makes them mocks rather than a live leaderboard: a writer publishes,
then lives with it while the games are played.

**A mock is a projection of two things**, and only one of them is a guess. The
*board* is fact -- `draft_class.board(year)` is declared months ahead and those
are the players who will arrive. The *order* is the guess, because it is read
off the standings as they are today and the standings have games left in them.

**What a mock cannot know.** The draft as simulated fills the holes retirement
leaves, so it is as long as the number of players who retire, not thirty. Who
retires is decided in the summer by `progression.develop_season` and is not
knowable now. So these mocks project the full first round in reverse-standings
order -- the conventional shape -- and `unfilled_note` says plainly that some
of those picks will not be used. Better a stated limit than a quietly short
board.

**No ability numbers reach the page.** A prospect's current ability and his
ceiling are what the draft is *for* -- finding out who turns into something is
the whole entertainment, and printing the answer beside his name gives it away
before a single game is played. The writers read those numbers; the reader does
not get them, and they are stripped from the payload rather than merely hidden
in the UI, because a surprise one browser tab away is not a surprise.

What is published is what a real mock draft publishes: who, where, position,
age, and where the consensus has him. **Board rank does not leak the answer.**
The board is ordered by current ability, and potential is drawn separately --
in one class the top three ceilings ran 191, 158, 143, and in another 182, 186,
178, second higher than first. Knowing a man is ranked fourth tells you what he
is now, which is precisely the thing that turns out not to matter.

**Derived, never stored.** Every board is rebuilt from the standings and the
class each time it is asked for, like the MVP race and the trade block.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from . import composites as C
from . import draft_class, draft_picks

# Publication days, as `datetime.weekday()` numbers: Wednesday and Sunday.
# Midnight UTC, matching every other moment in this project.
PUBLISH_WEEKDAYS: tuple[int, ...] = (2, 6)

# How many picks a mock covers. One round, which is what a mock draft is.
MOCK_PICKS = draft_class.ROUND_SIZE

# How far down the board a writer will reach for need or for upside. Without a
# bound, the need writer takes the 58th-ranked centre first overall and the
# feature stops being a draft board and becomes a positional sort.
REACH_LIMIT = 12


@dataclass(frozen=True)
class Writer:
    """One mock drafter: who he is, what he believes, and how he ranks.

    `score` returns a number for one prospect given the club on the clock,
    higher being better. It is only ever compared against other prospects on
    the same writer's board, so each is free to use whatever units his
    philosophy implies.

    `board_weight` is how much he defers to the consensus board, 0 to 1. It
    exists because the first version had none, and a writer who reads only his
    own lens will take the thirty-second-ranked prospect third overall -- which
    is not a dissenting mock draft, it is a different sport. Real writers argue
    with the board from inside it. The weight is stated per writer rather than
    shared, because how far each will stray *is* part of his character.
    """

    id: str
    name: str
    outlet: str
    creed: str
    reads: tuple[str, ...]
    score: object            # callable(prospect, context) -> float, higher better
    board_weight: float = 0.5

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "outlet": self.outlet,
                "creed": self.creed, "reads": list(self.reads),
                "boardWeight": self.board_weight}


@dataclass
class Context:
    """What a writer knows when a club is on the clock."""

    team_id: str
    # The club's weakest positions, worst first. Read off its own roster.
    thin_at: tuple[str, ...]
    # Board position, so a writer can be charged for reaching.
    board_rank: dict[str, int]


def _board_rank(prospect, context: Context) -> float:
    return float(context.board_rank.get(prospect.id, 999))


# --------------------------------------------------------------------------
# The five
# --------------------------------------------------------------------------

def _best_available(prospect, context: Context) -> float:
    """The board, and nothing else."""
    return -_board_rank(prospect, context)


def _team_need(prospect, context: Context) -> float:
    """Board order, moved by how badly the club needs that position.

    Bounded by `REACH_LIMIT`: a need is worth reaching for, not worth reaching
    past the whole first round for.
    """
    base = -_board_rank(prospect, context)
    if prospect.position.value in context.thin_at:
        depth = context.thin_at.index(prospect.position.value)
        return base + REACH_LIMIT * (1.0 - depth / max(1, len(context.thin_at)))
    return base - 2.0


def _upside(prospect, context: Context) -> float:
    """Ceiling and youth. What he is now is somebody else's concern.

    Ranked on unrealised ability -- the gap between potential and current --
    plus the ceiling itself, because a high floor with no headroom is exactly
    the prospect this writer will not take.
    """
    headroom = prospect.ability.potential - prospect.ability.current
    youth = max(0.0, 23 - prospect.age)
    return prospect.ability.potential * 0.55 + headroom * 0.9 + youth * 6.0


def _pro_ready(prospect, context: Context) -> float:
    """Floor first: current ability, professionalism, and a short gap to go.

    The gap is a *penalty* here, which is the exact inverse of `_upside`. A man
    forty points from his ceiling is forty points of projection, and this
    writer does not buy projection.
    """
    hidden = getattr(prospect.ratings, "hidden", None)
    character = 0.0
    if hidden is not None:
        character = (getattr(hidden, "professionalism", 10.0)
                     + getattr(hidden, "consistency", 10.0)) / 2.0
    headroom = prospect.ability.potential - prospect.ability.current
    return prospect.ability.current * 0.9 + character * 2.4 - headroom * 0.35


def _analytics(prospect, context: Context) -> float:
    """Spacing, versatility and passing -- the shape of a modern useful player.

    Reads the composites layer rather than raw attributes, like everything else
    in this project that has an opinion about a player.
    """
    return (C.spacing(prospect) * 2.0
            + C.playmaking(prospect) * 1.6
            + C.perimeter_defense(prospect) * 1.3
            + C.shooting_corner_three(prospect) * 1.2
            + C.ball_security(prospect) * 0.8)


PANEL: tuple[Writer, ...] = (
    Writer(
        id="board", name="Curtis Mbeki", outlet="The Draft Room",
        creed="The board is the board. You take the best player and you sort "
              "the rest out in the summer.",
        reads=("Board rank",),
        score=_best_available, board_weight=1.0,
    ),
    Writer(
        id="need", name="Delphine Achebe", outlet="Hardwood Weekly",
        creed="Nobody wins a title with four point guards. Draft the hole, "
              "not the ranking.",
        reads=("Board rank", "Positional depth"),
        score=_team_need, board_weight=0.55,
    ),
    Writer(
        id="upside", name="Rafael Okonjo", outlet="Ceiling Report",
        creed="You cannot teach a ceiling. Give me the nineteen-year-old with "
              "fifty points still to find.",
        reads=("Potential", "Headroom", "Age"),
        score=_upside, board_weight=0.45,
    ),
    Writer(
        id="floor", name="Marguerite Vance", outlet="The Rotation",
        creed="Most picks have to play next October. I want the man who is "
              "already a professional.",
        reads=("Current ability", "Professionalism", "Consistency"),
        score=_pro_ready, board_weight=0.45,
    ),
    Writer(
        id="numbers", name="Tobias Lindqvist", outlet="Possession Value",
        creed="Spacing, passing and switchable defence. Everything else is a "
              "highlight reel.",
        reads=("Spacing", "Playmaking", "Perimeter defence"),
        score=_analytics, board_weight=0.40,
    ),
)


# --------------------------------------------------------------------------
# When an edition goes out
# --------------------------------------------------------------------------

def edition_at(moment: datetime) -> datetime:
    """The most recent Wednesday-or-Sunday midnight at or before `moment`.

    Derived rather than stored, so an edition is a *reading* of the clock the
    same way the standings are a reading of the results. Two calls a minute
    apart return the same edition, and that is what stops the boards moving
    under a reader between publication days.
    """
    midnight = datetime.combine(moment.date(), time(0), tzinfo=moment.tzinfo
                                or timezone.utc)
    for back in range(0, 8):
        candidate = midnight - timedelta(days=back)
        if candidate.weekday() in PUBLISH_WEEKDAYS and candidate <= moment:
            return candidate
    return midnight


def next_edition_after(moment: datetime) -> datetime:
    """When the next mocks go out. Shown so a reader knows what to wait for."""
    current = edition_at(moment)
    for ahead in range(1, 9):
        candidate = current + timedelta(days=ahead)
        if candidate.weekday() in PUBLISH_WEEKDAYS and candidate > moment:
            return candidate
    return current + timedelta(days=3)


def edition_label(moment: datetime) -> str:
    day = "Wednesday" if moment.weekday() == 2 else "Sunday"
    return f"{day} {moment.strftime('%d %B')}".replace(" 0", " ")


# --------------------------------------------------------------------------
# The order, and what each club is short of
# --------------------------------------------------------------------------

def order(league) -> list[dict]:
    """Who picks where: reverse standings, with pick ownership applied.

    The order is `draft_picks.standings_order` -- worst first, no lottery,
    because this league does not run one. Ownership matters and is the reason
    this is not simply that list: a pick traded in February belongs to whoever
    holds it, and a mock that ignored that would show a club picking with an
    asset it sold.
    """
    worst_first = draft_picks.standings_order(league)
    year = draft_picks.current_year(league)
    owners = {}
    for pick in draft_picks.ensure(league):
        if pick.year == year and pick.round == 1:
            owners[pick.original_team] = pick.owner

    rows = []
    for slot, team_id in enumerate(worst_first[:MOCK_PICKS], start=1):
        owner = owners.get(team_id, team_id)
        rows.append({
            "slot": slot,
            "teamId": owner,
            "viaTeamId": team_id if owner != team_id else None,
        })
    return rows


def thin_positions(team) -> tuple[str, ...]:
    """The club's weakest positions, worst first.

    Counted over the rotation rather than the whole squad, because a twelfth
    man at a position is not depth at it. Ability-weighted, so two poor guards
    read as thinner than one good one.
    """
    from .trades import rotation
    strength: dict[str, float] = {p: 0.0 for p in ("PG", "SG", "SF", "PF", "C")}
    for player in rotation(team):
        strength[player.position.value] += player.ability.current
    ordered = sorted(strength, key=lambda pos: strength[pos])
    return tuple(ordered[:2])


# --------------------------------------------------------------------------
# A mock
# --------------------------------------------------------------------------

def _pick(writer: Writer, available: list, context: Context,
          ranks: dict[str, int]):
    """Who this writer takes, blending his own lens with the board.

    Both sides are converted to a **rank within the players still available**
    before they are blended, because the lenses are in wildly different units
    -- `_upside` returns about 250 and `_analytics` about 60, and adding a
    board position to either directly would mean one of them decided
    everything. Ranks are the only common currency the five share.

    Ties break on player id, so two prospects a writer genuinely cannot
    separate come out in a stable order rather than a different one per
    refresh.
    """
    by_lens = sorted(available,
                     key=lambda p: (-writer.score(p, context), p.id))
    lens_rank = {p.id: index for index, p in enumerate(by_lens)}
    by_board = sorted(available, key=lambda p: (ranks.get(p.id, 999), p.id))
    board_rank = {p.id: index for index, p in enumerate(by_board)}

    weight = writer.board_weight
    return min(available, key=lambda p: (
        lens_rank[p.id] * (1.0 - weight) + board_rank[p.id] * weight, p.id))


def mock(league, writer: Writer) -> list[dict]:
    """One writer's first round.

    Runs the board down pick by pick, which is the only way a mock can be
    internally consistent: the eleventh pick has to know the ten names already
    gone. That also means two writers who agree completely about players still
    produce different boards the moment one of them reaches early.
    """
    year = draft_picks.current_year(league)
    board = draft_class.board(year)
    ranks = {p.id: index + 1 for index, p in enumerate(board)}
    taken: set[str] = set()
    picks: list[dict] = []

    for row in order(league):
        team = league.teams.get(row["teamId"])
        if team is None:
            continue
        context = Context(team_id=team.id, thin_at=thin_positions(team),
                          board_rank=ranks)
        available = [p for p in board if p.id not in taken]
        if not available:
            break
        choice = _pick(writer, available, context, ranks)
        taken.add(choice.id)
        picks.append({
            "slot": row["slot"],
            "teamId": team.id,
            "viaTeamId": row["viaTeamId"],
            "playerId": choice.id,
            "name": choice.name,
            "position": choice.position.value,
            "age": choice.age,
            "boardRank": ranks[choice.id],
            "reach": ranks[choice.id] - row["slot"],
        })
    return picks


def consensus(league) -> list[dict]:
    """Average board position across the five, best first.

    Explicitly *not* a sixth opinion. It is a summary of the five, and it is
    labelled that way everywhere it appears: a player is first here because the
    panel put him first, not because a formula did.
    """
    year = draft_picks.current_year(league)
    board = draft_class.board(year)
    slots: dict[str, list[int]] = {}
    for writer in PANEL:
        for pick in mock(league, writer):
            slots.setdefault(pick["playerId"], []).append(pick["slot"])

    lookup = {p.id: p for p in board}
    rows = []
    for pid, places in slots.items():
        prospect = lookup[pid]
        rows.append({
            "playerId": pid,
            "name": prospect.name,
            "position": prospect.position.value,
            "age": prospect.age,
            "average": round(sum(places) / len(places), 1),
            "high": min(places),
            "low": max(places),
            "boards": len(places),
        })
    rows.sort(key=lambda row: (row["average"], -row["boards"], row["playerId"]))
    return rows


def note_for(league, writer: Writer, picks: list[dict]) -> dict | None:
    """One writer's short piece on his own board.

    Built from the picks rather than written alongside them, so it cannot drift
    from the board it is describing -- the same discipline the trade engine's
    explanations follow. Every numeral goes through `Copy`, so
    `tests/test_news.py`'s figure audit can pull them all back out.
    """
    from .news import Copy, pick as choose, possessive

    if not picks:
        return None

    c = Copy()
    year = draft_picks.current_year(league)
    first = picks[0]
    # Full name, not the nickname. "Falcons takes Silas Loveridge" was the
    # first draft of this line: a nickname is plural and the verb was not.
    team = league.teams.get(first["teamId"])
    club = team.full_name if team is not None else ""
    story_id = f"mock-{writer.id}-{year}-{len(picks)}"

    # The reach is the story. A writer who took the board in order is defending
    # a consensus; one who went twelve places off it is picking a fight, and
    # the piece has to know which it is.
    reaches = [p for p in picks if p["reach"] >= 4]
    biggest = max(picks, key=lambda p: p["reach"])

    headline = choose([
        f"{possessive(writer.outlet)} mock: {first['name']} at one",
        f"{writer.name} has {first['name']} first overall",
        f"Mock draft: {first['name']} to {club} at one",
    ], story_id)

    opening = (
        f"{writer.creed} On that basis the first pick is {first['name']}, "
        f"a {c.n(first['age'])}-year-old {first['position']} the board has "
        f"ranked {c.n(first['boardRank'])}, to {club}."
    )

    if reaches:
        middle = (
            f"{c.plural(len(reaches), 'pick')} on this board "
            f"{'comes' if len(reaches) == 1 else 'come'} at least "
            f"{c.n(4)} places earlier than the consensus has them, the "
            f"furthest being {biggest['name']} at {c.n(biggest['slot'])} "
            f"against a board rank of {c.n(biggest['boardRank'])}. "
            f"{writer.name} is not arguing about who these players are, but "
            f"about what a club should want."
        )
    else:
        middle = (
            f"Nothing here departs far from the consensus: the largest gap "
            f"between a slot and a board rank is {c.n(biggest['reach'])}. "
            f"On this class {writer.name} and the board are reading the same "
            f"players the same way, which does not happen every fortnight."
        )

    closing = (
        f"This is the {draft_class.label(year).lower()} {c.n(year)} class, and "
        f"the caveat on every mock applies to this one: the order is read off "
        f"a table with games left in it, and the draft itself only fills the "
        f"places retirement opens. Some of these {c.n(len(picks))} picks will "
        f"not be made."
    )

    return {
        "id": story_id,
        "writerId": writer.id,
        "headline": headline,
        "body": [opening, middle, closing],
        "figures": sorted(c.recorded),
    }


def unfilled_note(league) -> str:
    """The sentence that keeps a thirty-pick mock honest.

    A mock draft is thirty picks because that is what a mock draft is. The
    draft this league actually runs is as long as the number of players who
    retire, which is nobody's to know in February. Saying so on the page is the
    alternative to either faking a length or hiding the mismatch.
    """
    return (
        f"Mocks run the full first round, {MOCK_PICKS} picks in reverse "
        f"standings order. The draft itself only fills the places retirement "
        f"opens, so it is usually shorter — and a club with no vacancy does "
        f"not pick at all."
    )


def edition(league) -> dict:
    """Everything the Mock Draft screen shows, in one shape.

    Assembled here rather than in the API layer for the same reason every other
    view is: the live app and the published demo have to read identical JSON.
    """
    moment = league.clock.now()
    published = edition_at(moment)
    year = draft_picks.current_year(league)
    boards = [{"writer": writer.to_dict(),
               "picks": mock(league, writer),
               "note": note_for(league, writer, mock(league, writer))}
              for writer in PANEL]
    return {
        "year": year,
        "classLabel": draft_class.label(year),
        "classStrength": round(draft_class.strength(year), 3),
        "publishedAt": published.isoformat(),
        "publishedLabel": edition_label(published),
        "nextAt": next_edition_after(moment).isoformat(),
        "nextLabel": edition_label(next_edition_after(moment)),
        "picks": MOCK_PICKS,
        "note": unfilled_note(league),
        "panel": [writer.to_dict() for writer in PANEL],
        "boards": boards,
        "consensus": consensus(league)[:MOCK_PICKS],
        "splits": disagreements(league),
    }


def disagreements(league, limit: int = 5) -> list[dict]:
    """The players the panel cannot agree on, widest split first.

    The most interesting rows on the page, and the direct evidence that the
    five writers are five philosophies rather than one with noise on it.
    """
    rows = [row for row in consensus(league) if row["boards"] >= 2]
    rows.sort(key=lambda row: (-(row["low"] - row["high"]), row["playerId"]))
    return rows[:limit]
