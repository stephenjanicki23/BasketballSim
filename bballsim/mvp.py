"""The MVP race: ten voters who do not agree.

An MVP award is not a measurement, it is an **argument**, and the reason it is
worth simulating at all is that reasonable people reading the same season come
to different answers. A single "MVP score" would be a worse feature than no
feature: it would look objective, it would be one formula wearing a rosette,
and there would be nothing to follow.

So there is no league MVP formula anywhere in this module. There are ten
voters. Each has a stated philosophy and a scoring function that follows from
it, each submits a ranked ballot, and the leaderboard is what those ballots add
up to. A player leads the race because six of ten writers put him first, not
because a number said so.

**The ten disagree by construction.** Every voter reads a different column:

    Counting stats        points, rebounds, assists -- the back of the card
    Value over replacement VORP, and almost nothing else
    Team success          record first, production second
    Efficiency            what he does per shot, not per game
    Two-way play          defence weighted level with offence
    Availability          games played is a skill
    Burden               usage against efficiency: who carries a team
    Per-minute            rate over volume, minutes ignored
    Creation              assists, turnovers and possessions won
    Narrative             best player on the best team, the old-fashioned case

Those are not ten weightings of one idea. `AVAILABILITY` will rank a
sixty-eight-game superstar behind an eighty-two-game starter; `PER_MINUTE` will
do the exact reverse. That tension is the product.

**Derived, never stored.** Ballots are recomputed from the season totals every
time they are asked for, like the standings and the advanced table. An MVP race
is a *reading* of a season, and a stored one would disagree with the box scores
the moment another game finished.

**Deterministic.** No randomness anywhere. The same season produces the same
ballots, so the race moves only when the games move it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .league.advanced import advanced_table

# A voter will not consider anybody below this. Real awards have a games-played
# floor for the same reason: a man with nine brilliant games has not had a
# season, he has had nine games.
MIN_GAMES_SHARE = 0.55

# Early in a season everything is noise, so the race does not open at all until
# the league has played this much of it. Better a tab that says "not yet" than
# one that crowns a leader off four games.
#
# Set low on purpose. A real MVP conversation in November is thin and everyone
# knows it -- that is part of following one -- and a threshold high enough to
# be statistically comfortable would leave the tab empty for the first third of
# every season. `early` below carries the caveat instead of hiding the race.
RACE_OPENS_AFTER = 0.04

# Below this share of the season, the board is labelled as provisional. The
# race is shown; it is just not presented as though it means much yet.
RACE_SETTLES_AFTER = 0.25

# Ballot places and what each is worth, straight from the real award.
BALLOT_PLACES = 5
BALLOT_POINTS: tuple[int, ...] = (10, 7, 5, 3, 1)

# How many names the front-runner board carries.
FRONT_RUNNERS = 7


# --------------------------------------------------------------------------
# The panel
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Voter:
    """One writer: who he is, what he believes, and how he scores a season.

    `score` takes the merged basic-and-advanced row for one player and returns
    a number that is only ever compared against other players *on the same
    ballot*. Nothing compares two voters' raw scores, which is what lets each
    one use whatever units his philosophy actually implies.
    """

    id: str
    name: str
    outlet: str
    # One line, shown beside his ballot. This is the promise the score keeps.
    creed: str
    # The columns he actually reads, for the "what he weighs" chip row.
    reads: tuple[str, ...]
    score: object   # callable(row) -> float

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "outlet": self.outlet,
            "creed": self.creed,
            "reads": list(self.reads),
        }


def _rate(row: dict, key: str, per: float = 1.0) -> float:
    value = float(row.get(key, 0.0) or 0.0)
    return value / per if per else 0.0


def _per_game(row: dict, key: str) -> float:
    games = row.get("games", 0) or 0
    return float(row.get(key, 0.0) or 0.0) / games if games else 0.0


def _true_shooting(row: dict) -> float:
    """Points per shooting possession. The efficiency number that counts free
    throws, which field-goal percentage does not."""
    attempts = 2.0 * (float(row.get("fga", 0)) + 0.44 * float(row.get("fta", 0)))
    return float(row.get("points", 0)) / attempts if attempts > 0 else 0.0


def _per_36(row: dict, key: str) -> float:
    minutes = float(row.get("minutes", 0.0) or 0.0)
    return float(row.get(key, 0.0) or 0.0) * 36.0 / minutes if minutes > 0 else 0.0


# -- the ten scoring functions ---------------------------------------------
#
# Each is small on purpose. A voter whose philosophy needs twenty lines of code
# to express is not a philosophy, it is a model -- and the point of the panel is
# that you can read each one and know immediately what it will reward.

def _counting(row: dict) -> float:
    """The back of the basketball card. Points lead, everything else supports."""
    return (_per_game(row, "points")
            + _per_game(row, "rebounds") * 1.2
            + _per_game(row, "assists") * 1.5
            + _per_game(row, "steals") * 2.0
            + _per_game(row, "blocks") * 2.0)


def _vorp(row: dict) -> float:
    """Value over replacement, and almost nothing else."""
    return _rate(row, "vorp") * 10.0 + _rate(row, "bpm")


def _team_first(row: dict) -> float:
    """Winning is the whole point. Production only breaks ties between winners."""
    return row.get("_win_pct", 0.5) * 100.0 + _rate(row, "ws") * 1.6


def _efficiency(row: dict) -> float:
    """What he does per shot. Volume without efficiency is not value."""
    return (_true_shooting(row) * 100.0
            + _rate(row, "ws48") * 220.0
            + _rate(row, "ortg") * 0.08)


def _two_way(row: dict) -> float:
    """Defence counts the same as offence, which almost no ballot does."""
    return (_rate(row, "obpm") + _rate(row, "dbpm") * 1.9
            + _rate(row, "dws") * 2.2
            + _per_game(row, "steals") + _per_game(row, "blocks"))


def _availability(row: dict) -> float:
    """You cannot help your team in a suit. Games played is a skill."""
    games = float(row.get("games", 0))
    return games * 1.4 + _rate(row, "ws") * 2.2 + _per_game(row, "points") * 0.5


def _burden(row: dict) -> float:
    """Who carries the heaviest load and still shoots straight."""
    usage = _rate(row, "usg_pct")
    return usage * 1.5 + _true_shooting(row) * 60.0 + _per_game(row, "points") * 0.6


def _per_minute(row: dict) -> float:
    """Rate over volume. Minutes are a coaching decision, not a talent."""
    return (_per_36(row, "points")
            + _per_36(row, "rebounds") * 1.1
            + _per_36(row, "assists") * 1.4
            + _rate(row, "per") * 1.2)


def _creation(row: dict) -> float:
    """Possessions won and possessions created, rather than points scored.

    **Not a plus-minus voter, and that is deliberate.** The obvious tenth angle
    is on/off impact, and `PlayerLine.plus_minus` exists -- but the engine never
    fills it in, so it is zero for every player in every game ever simulated
    here. `league/history.py` omits the column from its game log for exactly
    this reason. A voter whose stated creed was "the scoreboard when he plays"
    would have been ranking on win shares while claiming otherwise, which is
    worse than not having the angle at all.

    So this reads the four rate columns no other voter touches: who creates for
    others, who does not give the ball away, who wins the possession battle.
    Give the engine on/off tracking and an impact voter becomes real.
    """
    return (_rate(row, "ast_pct") * 1.4
            - _rate(row, "tov_pct") * 1.1
            + _rate(row, "trb_pct") * 0.9
            + _rate(row, "stl_pct") * 3.0)


def _narrative(row: dict) -> float:
    """The best player on the best team. The oldest case there is."""
    return (row.get("_win_pct", 0.5) * 62.0
            + _per_game(row, "points") * 1.5
            + _rate(row, "per") * 0.8)


PANEL: tuple[Voter, ...] = (
    Voter("box", "Marlon Deeds", "The Sporting Ledger",
          "The back of the card still tells you who was best.",
          ("PPG", "RPG", "APG", "STL", "BLK"), _counting),
    Voter("vorp", "Priya Raghunath", "Hardwood Numbers",
          "One number does it better than five. Value over replacement.",
          ("VORP", "BPM"), _vorp),
    Voter("wins", "Cal Berringer", "Tribune Sports",
          "Most Valuable, not most productive. Value is measured in wins.",
          ("Record", "WS"), _team_first),
    Voter("eff", "Nadia Oyelaran", "The Efficiency Report",
          "Twenty-eight points on twenty-five shots is not an MVP season.",
          ("TS%", "WS/48", "ORtg"), _efficiency),
    Voter("twoway", "Desmond Achebe", "Full Court Press",
          "Half the game happens when you do not have the ball.",
          ("DBPM", "DWS", "STL", "BLK"), _two_way),
    Voter("iron", "Ruth Kettleborough", "The Beat",
          "Availability is a skill. You cannot win a game in a suit.",
          ("Games", "WS"), _availability),
    Voter("load", "Ike Vandermolen", "Possession Weekly",
          "Show me who carries a team and still shoots straight.",
          ("USG%", "TS%", "PPG"), _burden),
    Voter("rate", "Soo-jin Park", "Per Thirty-Six",
          "Minutes are a coaching decision. Rate is the player.",
          ("Per-36", "PER"), _per_minute),
    Voter("create", "Gideon Marsh", "Possession Quarterly",
          "Basketball is a possession game. Win them, create them, keep them.",
          ("AST%", "TOV%", "TRB%", "STL%"), _creation),
    Voter("story", "Bettina Cavallo", "The Column",
          "Best player on the best team. It has never been more complicated.",
          ("Record", "PPG", "PER"), _narrative),
)

VOTERS_BY_ID = {voter.id: voter for voter in PANEL}
MAX_BALLOT_POINTS = BALLOT_POINTS[0] * len(PANEL)


# --------------------------------------------------------------------------
# Reading the season
# --------------------------------------------------------------------------

def _candidate_rows(league, minimum_games: int) -> list[dict]:
    """Every qualifying player, with his basic and advanced lines merged.

    One row per player carrying both, because a voter should not have to know
    which table a column came from -- and because half of them read from both.
    """
    advanced = {row["player_id"]: row for row in advanced_table(league.stats)}
    standings = {row["team_id"]: row for row in league.standings_table()}

    rows: list[dict] = []
    for line in league.stats.players.values():
        if line.games < minimum_games:
            continue
        row = dict(advanced.get(line.player_id) or {})
        row.update({
            "player_id": line.player_id,
            "name": line.name,
            "team_id": line.team_id,
            "position": line.position,
            "games": line.games,
            "minutes": line.minutes,
            "points": line.points,
            "rebounds": line.rebounds,
            "assists": line.assists,
            "steals": line.steals,
            "blocks": line.blocks,
            "turnovers": line.turnovers,
            "fga": line.fga,
            "fta": line.fta,
            "fg_pct": line.fg_pct,
            "tp_pct": line.tp_pct,
            "ts_pct": _true_shooting(
                {"points": line.points, "fga": line.fga, "fta": line.fta}),
        })
        # His club's season, which four of the ten voters read. Prefixed so it
        # cannot be mistaken for one of the player's own columns.
        standing = standings.get(line.team_id) or {}
        row["_win_pct"] = float(standing.get("win_pct", 0.5) or 0.5)
        row["_wins"] = int(standing.get("wins", 0) or 0)
        row["_losses"] = int(standing.get("losses", 0) or 0)
        rows.append(row)
    return rows


def games_played(league) -> tuple[int, int]:
    """(finished, scheduled) for the regular season."""
    from .league import playoffs
    from .league.calendar import GameStatus

    regular = [g for g in league.schedule if not playoffs.is_playoff(g)]
    done = sum(1 for g in regular if g.status == GameStatus.FINAL)
    return done, len(regular)


def minimum_games(league) -> int:
    """The games-played floor, as a share of what the league has played.

    Scaled rather than fixed: a hard floor of forty would leave the race empty
    until February, and one of five would let a hot fortnight decide it in
    November. Either way the bar means the same thing -- "he has been there for
    most of it".
    """
    done, scheduled = games_played(league)
    if not scheduled:
        return 1
    per_team = max(1, round(2 * done / max(1, len(league.teams))))
    return max(1, int(per_team * MIN_GAMES_SHARE))


def is_open(league) -> bool:
    """Whether there is enough season to argue about yet."""
    done, scheduled = games_played(league)
    return scheduled > 0 and done / scheduled >= RACE_OPENS_AFTER


# --------------------------------------------------------------------------
# Ballots
# --------------------------------------------------------------------------

@dataclass
class Ballot:
    """One voter's top five, in order."""

    voter: Voter
    picks: list[dict] = field(default_factory=list)   # player rows, best first

    def to_dict(self) -> dict:
        return {
            **self.voter.to_dict(),
            "picks": [
                {
                    "rank": index + 1,
                    "points": BALLOT_POINTS[index],
                    "playerId": pick["player_id"],
                    "name": pick["name"],
                    "teamId": pick["team_id"],
                    "case": case_for(self.voter, pick),
                }
                for index, pick in enumerate(self.picks)
            ],
        }


def cast(voter: Voter, rows: list[dict]) -> Ballot:
    """One voter's ballot: his top five by his own scoring function.

    Ties break on player id rather than on anything meaningful, so two players
    a voter genuinely cannot separate come out in a stable order instead of a
    different one each time the page is opened.
    """
    ranked = sorted(rows, key=lambda row: (-voter.score(row), row["player_id"]))
    return Ballot(voter=voter, picks=ranked[:BALLOT_PLACES])


def case_for(voter: Voter, row: dict) -> str:
    """The statistics this voter would point at for this player.

    **It has to explain the order, not just name the metric.** A first version
    printed one number per voter, and several of them ranked on a composite --
    so the VORP ballot read 0.80, 0.75, 0.73, 0.79, 0.64 down the page, with
    fourth place apparently ahead of second. A column that contradicts the
    ranking beside it is worse than no column: it makes a working ballot look
    broken.

    So each voter shows every term his score actually weighs heavily. Where two
    numbers trade off, both are shown, and the reader can see the trade.
    """
    if voter.id == "box":
        return (f"{_per_game(row, 'points'):.1f} / {_per_game(row, 'rebounds'):.1f}"
                f" / {_per_game(row, 'assists'):.1f}")
    if voter.id == "vorp":
        return f"{_rate(row, 'vorp'):.2f} VORP · {_rate(row, 'bpm'):+.1f} BPM"
    if voter.id == "wins":
        return f"{row.get('_wins', 0)}-{row.get('_losses', 0)} · {_rate(row, 'ws'):.1f} WS"
    if voter.id == "eff":
        return (f"{_true_shooting(row) * 100:.1f} TS% · "
                f"{_rate(row, 'ws48'):.3f} WS/48")
    if voter.id == "twoway":
        return f"{_rate(row, 'dbpm'):+.1f} DBPM · {_rate(row, 'dws'):.2f} DWS"
    if voter.id == "iron":
        # Three numbers, because early in a season everybody has played every
        # game and the games column does no work at all -- the ballot is then
        # ordered entirely by the two behind it.
        return (f"{int(row.get('games', 0))} games · {_rate(row, 'ws'):.1f} WS · "
                f"{_per_game(row, 'points'):.1f} ppg")
    if voter.id == "load":
        return (f"{_rate(row, 'usg_pct'):.1f} USG% · "
                f"{_true_shooting(row) * 100:.1f} TS%")
    if voter.id == "rate":
        return f"{_per_36(row, 'points'):.1f} pts/36 · {_rate(row, 'per'):.1f} PER"
    if voter.id == "create":
        return (f"{_rate(row, 'ast_pct'):.1f} AST% · "
                f"{_rate(row, 'tov_pct'):.1f} TOV%")
    return f"{row.get('_wins', 0)}-{row.get('_losses', 0)} · {_rate(row, 'per'):.1f} PER"


def ballots(league) -> list[Ballot]:
    """All ten, cast against the season as it stands."""
    rows = _candidate_rows(league, minimum_games(league))
    if len(rows) < BALLOT_PLACES:
        return []
    return [cast(voter, rows) for voter in PANEL]


# --------------------------------------------------------------------------
# The board
# --------------------------------------------------------------------------

@dataclass
class Contender:
    """One player's standing in the race."""

    player_id: str
    name: str
    team_id: str
    points: int = 0
    firsts: int = 0
    appearances: int = 0          # how many of the ten had him anywhere
    row: dict = field(default_factory=dict)
    voters: list[str] = field(default_factory=list)   # voter ids who ranked him

    @property
    def share(self) -> float:
        """Share of the maximum possible points, the way the real award reports
        it. A unanimous winner scores 1.000."""
        return self.points / MAX_BALLOT_POINTS if MAX_BALLOT_POINTS else 0.0

    def to_dict(self) -> dict:
        row = self.row
        return {
            "playerId": self.player_id,
            "name": self.name,
            "teamId": self.team_id,
            "points": self.points,
            "share": round(self.share, 3),
            "firsts": self.firsts,
            "appearances": self.appearances,
            "voters": list(self.voters),
            "games": int(row.get("games", 0)),
            "ppg": round(_per_game(row, "points"), 1),
            "rpg": round(_per_game(row, "rebounds"), 1),
            "apg": round(_per_game(row, "assists"), 1),
            "per": round(_rate(row, "per"), 1),
            "ws": round(_rate(row, "ws"), 1),
            "vorp": round(_rate(row, "vorp"), 1),
            "bpm": round(_rate(row, "bpm"), 1),
            "tsPct": round(_true_shooting(row) * 100, 1),
            "usgPct": round(_rate(row, "usg_pct"), 1),
            "astPct": round(_rate(row, "ast_pct"), 1),
            "tovPct": round(_rate(row, "tov_pct"), 1),
            # No plus-minus. The engine never fills it in, and a contender card
            # is precisely where a +0.0 column would be read as a measurement.
            "record": f"{row.get('_wins', 0)}-{row.get('_losses', 0)}",
            "winPct": round(row.get("_win_pct", 0.0), 3),
        }


def tally(cast_ballots: list[Ballot]) -> list[Contender]:
    """Add the ballots up. Highest points first, first-place votes break ties.

    The tie-break matters and is the real award's: a player with more first-place
    votes beats one with more total mentions on equal points, because the panel
    disagreeing *about the winner* counts for more than broad mild support.
    """
    table: dict[str, Contender] = {}
    for ballot in cast_ballots:
        for index, pick in enumerate(ballot.picks):
            pid = pick["player_id"]
            entry = table.get(pid)
            if entry is None:
                entry = Contender(player_id=pid, name=pick["name"],
                                  team_id=pick["team_id"], row=pick)
                table[pid] = entry
            entry.points += BALLOT_POINTS[index]
            entry.appearances += 1
            entry.voters.append(ballot.voter.id)
            if index == 0:
                entry.firsts += 1
    return sorted(table.values(),
                  key=lambda c: (-c.points, -c.firsts, c.player_id))


def front_runners(league, count: int = FRONT_RUNNERS) -> list[Contender]:
    """The board: who is actually winning this thing."""
    return tally(ballots(league))[:count]


def race(league) -> dict:
    """Everything the MVP Race tab shows, in one shape.

    Assembled here rather than in the API layer for the same reason every other
    view is: the live app and the published demo have to read identical JSON.
    """
    done, scheduled = games_played(league)
    payload = {
        "open": is_open(league),
        "gamesPlayed": done,
        "gamesScheduled": scheduled,
        "minimumGames": minimum_games(league),
        "panel": [voter.to_dict() for voter in PANEL],
        "ballotPoints": list(BALLOT_POINTS),
        "maxPoints": MAX_BALLOT_POINTS,
        "contenders": [],
        "ballots": [],
        # Present on every path, including the closed one. A key that appears
        # only when the race is open is a shape the client has to branch on,
        # and it will forget to.
        "alsoReceivingVotes": [],
        "early": scheduled > 0 and done / scheduled < RACE_SETTLES_AFTER,
        "share": round(done / scheduled, 3) if scheduled else 0.0,
    }
    if not payload["open"]:
        return payload

    cast_ballots = ballots(league)
    if not cast_ballots:
        payload["open"] = False
        return payload

    payload["ballots"] = [ballot.to_dict() for ballot in cast_ballots]
    payload["contenders"] = [c.to_dict() for c in tally(cast_ballots)[:FRONT_RUNNERS]]
    # Everybody who got a vote, for the "also receiving votes" line -- a race
    # with fourteen names in it is a more honest picture than a top seven that
    # implies nobody else was mentioned.
    everyone = tally(cast_ballots)
    payload["alsoReceivingVotes"] = [
        {"playerId": c.player_id, "name": c.name, "teamId": c.team_id,
         "points": c.points}
        for c in everyone[FRONT_RUNNERS:]
    ]
    return payload


# --------------------------------------------------------------------------
# The columns
#
# Each voter writes his own case. The point of these is that they are
# *analytical* rather than descriptive: a recap tells you what happened, a
# column argues that it means something. What makes the argument possible is
# that each writer has a stated position and a metric behind it, so his column
# can do the thing a real one does -- name his pick, show his number, and say
# why the obvious alternative is wrong.
#
# The newsroom's rule still holds and is still enforced by the tests: every
# figure below comes off a season line or an advanced row and goes through
# `Copy` on the way to the page. A writer may be tendentious. He may not be
# making numbers up.
#
# These live here rather than in `news.py` because they are the voting panel's
# output, not the newsroom's -- `news.mvp_columns` is a thin adapter that hands
# them to the feed.
# --------------------------------------------------------------------------

# A column needs somebody to argue against, so it does not fire until the
# writer's own top two are far enough apart to be a claim rather than a
# coin-flip -- or close enough that the closeness is the story.
COLUMN_MIN_CANDIDATES = 3


def _ordinal(index: int) -> str:
    return ("first", "second", "third", "fourth", "fifth")[index]


def column_for(league, ballot: "Ballot", board: list["Contender"]) -> dict | None:
    """One writer's analytical column on the race as he sees it.

    Returns the raw materials -- headline, three paragraphs, the figures used --
    as a plain dict, so `news.py` can wrap it in a `Story` without this module
    having to import the newsroom.
    """
    from .news import Copy, pick, possessive

    if len(ballot.picks) < COLUMN_MIN_CANDIDATES or not board:
        return None

    c = Copy()
    mine = ballot.picks[0]
    second = ballot.picks[1]
    voter = ballot.voter
    leader = board[0]

    player_name = mine["name"]
    club = league.teams[mine["team_id"]].name if mine["team_id"] in league.teams else ""
    story_id = f"mvp-column-{voter.id}-{int(mine.get('games', 0))}"

    # Whether he agrees with the field is the spine of the piece: a writer
    # backing the front runner is defending a consensus, one who is not is
    # picking a fight. Same three paragraphs, opposite argument.
    dissenting = mine["player_id"] != leader.player_id

    headline = pick([
        f"{voter.name} on why {player_name} leads his ballot",
        f"The case for {player_name}, by the numbers that matter",
        f"{possessive(voter.outlet)} ballot: {player_name} first",
    ], story_id)

    opening = (
        f"{voter.creed} That is how this ballot gets filled in, and this "
        f"season it puts {player_name} of {club} at the top of it. "
        f"He is at {c.n(_per_game(mine, 'points'), '.1f')} points, "
        f"{c.n(_per_game(mine, 'rebounds'), '.1f')} rebounds and "
        f"{c.n(_per_game(mine, 'assists'), '.1f')} assists across "
        f"{c.plural(int(mine.get('games', 0)), 'game')}, on a club that has "
        f"gone {c.record(int(mine.get('_wins', 0)), int(mine.get('_losses', 0)))}."
    )

    middle = (
        f"The number this column actually votes on is a different one. "
        f"{player_name} sits at a player efficiency rating of "
        f"{c.n(_rate(mine, 'per'), '.1f')}, "
        f"{c.n(_rate(mine, 'ws'), '.1f')} win shares and "
        f"{c.n(_rate(mine, 'vorp'), '.1f')} value over replacement, shooting "
        f"{c.n(_true_shooting(mine) * 100, '.1f')}% true on a usage of "
        f"{c.n(_rate(mine, 'usg_pct'), '.1f')}%. "
        + (f"That last pairing is the argument in miniature: carrying that "
           f"much of an offence usually costs a player his efficiency, and it "
           f"has not."
           if _rate(mine, "usg_pct") > 24.0 and _true_shooting(mine) > 0.55
           else f"Those are the columns this ballot reads, and they are the "
                f"columns that separate him from the field.")
    )

    if dissenting:
        closing = (
            f"The wider panel has {leader.name} in front on "
            f"{c.plural(leader.points, 'point')} to this writer's "
            f"{c.n(_rate(mine, 'per'), '.1f')}-rated pick, and that gap is a "
            f"disagreement about what the award is for rather than about what "
            f"happened. {leader.name} has the bigger raw season. He does not "
            f"have the better one by the measure applied here, and a ballot "
            f"that changed its measure to match the consensus would not be "
            f"worth submitting."
        )
    else:
        closing = (
            f"The panel agrees, which is not always a comfortable place for "
            f"this column to be. {leader.name} leads the overall count on "
            f"{c.plural(leader.points, 'point')} from "
            f"{c.plural(leader.firsts, 'first-place vote')}. The nearest "
            f"challenger on this ballot is {second['name']}, and the case "
            f"against him is not that he has been poor -- it is that on the "
            f"one measure this column trusts, he is second, and second is "
            f"where he goes."
        )

    return {
        "id": story_id,
        "voterId": voter.id,
        "headline": headline,
        "subheadline": f"{voter.name}, {voter.outlet}: {player_name} "
                       f"{_ordinal(0)} on a five-man ballot.",
        # Deliberately *not* `case_for`. That builds its own display string
        # with its own formatting, so its numbers never pass through `Copy` --
        # and the figure audit correctly refused a summary carrying "0.80 VORP"
        # when only "0.8" had been recorded. Everything here is a figure the
        # paragraphs above already registered.
        "summary": f"{voter.name} puts {player_name} first at "
                   f"{c.n(_per_game(mine, 'points'), '.1f')} points a game.",
        "article": "\n\n".join((opening, middle, closing)),
        "playerIds": tuple(p["player_id"] for p in ballot.picks[:2]),
        "teamIds": (mine["team_id"],),
        "figures": frozenset(c.recorded),
        "dissenting": dissenting,
    }


def columns(league, limit: int = 3) -> list[dict]:
    """A rotating handful of columns, not all ten at once.

    Ten pieces on the same race published the same morning is a wall, not a
    feed. Which writers run is drawn from the number of games played, so the
    selection changes as the season does and every voter comes round -- and it
    is deterministic, so a refresh does not reshuffle the page.
    """
    cast_ballots = ballots(league)
    if not cast_ballots:
        return []
    board = tally(cast_ballots)
    if not board:
        return []

    done, _scheduled = games_played(league)
    start = (done // max(1, len(PANEL))) % len(PANEL)
    order = [cast_ballots[(start + step) % len(cast_ballots)]
             for step in range(len(cast_ballots))]

    written: list[dict] = []
    for ballot in order:
        if len(written) >= limit:
            break
        piece = column_for(league, ballot, board)
        if piece is not None:
            written.append(piece)
    return written
