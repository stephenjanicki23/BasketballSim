"""The newsroom: league news written from what actually happened.

The home page carries a feed of stories -- a triple-double, a streak, a
milestone, the night's headline game. There are 1,230 fixtures in a season, so
none of this can be written by hand. It is generated, which raises the only
question that matters about generated sports writing:

**Where did that number come from?**

Every figure in every sentence here is read off a box score, a standings row or
a season line. Nothing is estimated, rounded up for effect, or filled in
because the sentence wanted a number. That is not a promise in a docstring, it
is enforced: prose is assembled through `Copy`, which records each number as it
formats it, and `tests/test_news.py` pulls every numeral back out of the
finished article and fails if one of them was never recorded. A story cannot
carry a statistic the data did not supply.

The same rule decides what this module *does not* write. A manager game's news
feed wants injury reports, trades, firings and playoff races, and this league
has none of those -- nothing in the simulation injures a player, moves one
between clubs, or plays a postseason. Those categories are absent rather than
imagined. When the simulation grows a transfer window, the newsroom can cover
it; until then a trade story would be fiction with a byline.

What is real, and what the detectors below read:

  * **Box scores** -- every line of every finished game, so a triple-double or
    a 40-point night is counted, not guessed.
  * **Season lines** -- totals and averages to date, which is where milestones,
    the scoring race and the rookie class come from.
  * **Standings** -- records, streaks and margins, derived from results.
  * **Rosters** -- age, draft class, position, and the coach on the bench.

Stories are deterministic. The same league state produces the same feed, and
which of several phrasings a story uses is drawn from its own id, so an article
reads the same on every refresh and two similar games do not read alike.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .ability import ca_tier
from .engine.rng import seed_from_string
from .league.calendar import GameStatus

# --------------------------------------------------------------------------
# Categories, and what a story is worth.
#
# Importance drives the feed order and how much room the page gives a story.
# The numbers are anchors, not the final value: a detector starts from its
# anchor and moves it with the size of what happened, so a 47-point night
# outranks a 36-point one without either needing its own category.
# --------------------------------------------------------------------------

TRIPLE_DOUBLE = "Triple Double"
SEASON_HIGH = "Season High"
HOT_STREAK = "Hot Streak"
MILESTONE = "Milestone"
BIG_GAME = "Big Individual Game"
MVP_RACE = "MVP Race"
ROOKIE_WATCH = "Rookie Watch"
GAME_RECAP = "Game Recap"
COACHING = "Coaching"
LEAGUE_NEWS = "League News"
POWER_RANKINGS = "Power Rankings"

# The offseason wire. These four only ever fire between seasons, from
# `offseason_stories` rather than `write_stories`, because the summer is a
# different feed with a different question: not "what happened last night" but
# "what has changed about who plays for whom".
MVP_COLUMN = "MVP Column"
RETIREMENT = "Retirement"
CONTRACT = "Contract"
FREE_AGENCY = "Free Agency"
COACH_MOVE = "Coaching Move"

ANCHOR = {
    TRIPLE_DOUBLE: 90,
    SEASON_HIGH: 85,
    HOT_STREAK: 80,
    MILESTONE: 75,
    MVP_RACE: 72,
    BIG_GAME: 70,
    ROOKIE_WATCH: 65,
    GAME_RECAP: 60,
    COACHING: 55,
    LEAGUE_NEWS: 45,
    POWER_RANKINGS: 68,
    # A columnist arguing a case sits just under the scoring-race report it
    # argues about -- the report is what happened, the column is one reading of
    # it, and the page should lead with the first.
    MVP_COLUMN: 66,
    # A career ending is the biggest story a summer produces; a role player
    # re-signing is the smallest.
    RETIREMENT: 88,
    FREE_AGENCY: 74,
    CONTRACT: 62,
    COACH_MOVE: 58,
}

# Thresholds. Each is the point at which a line stops being a good night and
# starts being news, and each is here rather than inline so the bar the
# newsroom applies is one list you can read.
TRIPLE_DOUBLE_FLOOR = 10
BIG_GAME_POINTS = 35
BIG_GAME_REBOUNDS = 18
BIG_GAME_ASSISTS = 13
SEASON_HIGH_POINTS = 30        # a season high below this is not a story
SEASON_HIGH_MARGIN = 6         # ...and it has to clear his previous best
STREAK_FLOOR = 4
BLOWOUT_MARGIN = 25
THRILLER_MARGIN = 3
MVP_MIN_GAMES = 8
ROOKIE_POINTS = 22
POINT_MILESTONES = (250, 500, 750, 1000, 1500, 2000)
COUNTING_MILESTONES = (200, 400, 600, 800, 1000)


# --------------------------------------------------------------------------
# Copy: prose that cannot outrun its data.
# --------------------------------------------------------------------------

class Copy:
    """A sentence builder that remembers every number it was given.

    Call `n()` (or one of its shapes) for anything numeric and it returns the
    formatted string while recording it. What comes out of `recorded` is the
    complete set of figures the story is entitled to print, which is what makes
    the "never invent statistics" rule testable instead of aspirational.
    """

    def __init__(self) -> None:
        self.recorded: set[str] = set()

    def n(self, value: int | float, fmt: str = "") -> str:
        text = format(value, fmt) if fmt else str(value)
        self.recorded.add(text)
        # A negative differential prints as "-87", but a reader scanning the
        # prose for numbers cannot tell that hyphen from the one in "125-120".
        # Record the unsigned form too so the audit compares like with like.
        if text.startswith("-"):
            self.recorded.add(text[1:])
        return text

    def pct(self, made: int, attempted: int) -> str:
        """A shooting line, both halves recorded."""
        rate = made / attempted if attempted else 0.0
        return f"{self.n(made)} of {self.n(attempted)} ({self.n(rate * 100, '.1f')}%)"

    def record(self, wins: int, losses: int) -> str:
        return f"{self.n(wins)}-{self.n(losses)}"

    def score(self, winner: int, loser: int) -> str:
        return f"{self.n(winner)}-{self.n(loser)}"

    def line(self, points: int, rebounds: int, assists: int) -> str:
        return (f"{self.n(points)} points, {self.n(rebounds)} rebounds and "
                f"{self.n(assists)} assists")

    def plural(self, count: int, singular: str, plural: str | None = None) -> str:
        word = singular if count == 1 else (plural or singular + "s")
        return f"{self.n(count)} {word}"

    def clock(self, minutes: str) -> str:
        """Floor time, "36:59" -- two numbers, both of which must be recorded.

        Interpolating `line.minutes` straight into a sentence looks harmless
        and is not: it puts digits on the page that never passed through here,
        which is the one thing this class exists to prevent.
        """
        for part in minutes.split(":"):
            self.recorded.add(part)
        self.recorded.add(minutes)
        return minutes


@dataclass
class Story:
    """One article, in the shape the home page renders."""

    headline: str
    subheadline: str
    category: str
    importance: int
    summary: str
    article: str

    # Everything below is plumbing rather than copy: it lets the page link a
    # story to the game, club or player it is about, and lets the feed sort.
    id: str = ""
    day: date | None = None
    game_id: str | None = None
    team_ids: tuple[str, ...] = ()
    player_ids: tuple[str, ...] = ()
    figures: frozenset[str] = frozenset()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "headline": self.headline,
            "subheadline": self.subheadline,
            "category": self.category,
            "importance": self.importance,
            "summary": self.summary,
            "article": self.article,
            "day": self.day.isoformat() if self.day else None,
            "gameId": self.game_id,
            "teamIds": list(self.team_ids),
            "playerIds": list(self.player_ids),
        }


def possessive(name: str) -> str:
    """Club nicknames are plural: the Monarchs' win, not the Monarchs's win."""
    return name + ("'" if name.endswith("s") else "'s")


def pick(options: list[str], key: str) -> str:
    """Choose a phrasing from the story's own id.

    Deterministic, so an article does not rewrite itself between refreshes,
    and keyed per story so two triple-doubles on the same night do not open
    with the same sentence.
    """
    return options[seed_from_string(key) % len(options)]


def paragraphs(*blocks: str) -> str:
    return "\n\n".join(block.strip() for block in blocks if block and block.strip())


# --------------------------------------------------------------------------
# Reading the league. Small views over what the season already knows, so the
# detectors below stay about journalism rather than about traversal.
# --------------------------------------------------------------------------

@dataclass
class Night:
    """One finished game, with both sides' box scores flattened and named."""

    game_id: str
    day: date
    home_id: str
    away_id: str
    home_score: int
    away_score: int
    periods: int
    lines: dict[str, list]  # team id -> player lines, best first
    boxes: dict[str, object] = field(default_factory=dict)  # team id -> TeamBox

    @property
    def winner_id(self) -> str:
        return self.home_id if self.home_score > self.away_score else self.away_id

    @property
    def loser_id(self) -> str:
        return self.away_id if self.home_score > self.away_score else self.home_id

    @property
    def winning_score(self) -> int:
        return max(self.home_score, self.away_score)

    @property
    def losing_score(self) -> int:
        return min(self.home_score, self.away_score)

    @property
    def margin(self) -> int:
        return self.winning_score - self.losing_score

    @property
    def overtime(self) -> int:
        return max(0, self.periods - 4)


@dataclass
class Newsroom:
    """Everything the detectors read, gathered once."""

    league: object
    played: list = field(default_factory=list)
    nights: list[Night] = field(default_factory=list)
    latest_day: date | None = None

    def __post_init__(self) -> None:
        self.played = sorted(
            (g for g in self.league.schedule
             if g.status == GameStatus.FINAL and g.result is not None),
            key=lambda g: g.tipoff_at,
        )
        for game in self.played:
            result = game.result
            self.nights.append(Night(
                game_id=game.id,
                day=game.game_date,
                home_id=game.home_team_id,
                away_id=game.away_team_id,
                home_score=result.home_score,
                away_score=result.away_score,
                periods=result.periods_played,
                lines={
                    game.home_team_id: sorted(
                        result.home_box.players.values(), key=lambda l: -l.points),
                    game.away_team_id: sorted(
                        result.away_box.players.values(), key=lambda l: -l.points),
                },
                boxes={
                    game.home_team_id: result.home_box,
                    game.away_team_id: result.away_box,
                },
            ))
        self.latest_day = self.nights[-1].day if self.nights else None

    # -- lookups ---------------------------------------------------------
    def team(self, team_id: str):
        return self.league.teams.get(team_id)

    def club(self, team_id: str) -> str:
        team = self.team(team_id)
        return team.full_name if team else team_id

    def nickname(self, team_id: str) -> str:
        team = self.team(team_id)
        return team.name if team else team_id

    def player(self, player_id: str):
        for team in self.league.teams.values():
            found = team.player(player_id)
            if found is not None:
                return found
        return None

    def player_team(self, player_id: str) -> str | None:
        for team in self.league.teams.values():
            if team.player(player_id) is not None:
                return team.id
        return None

    def standing(self, team_id: str):
        return self.league.standings.get(team_id)

    def season_line(self, player_id: str):
        return self.league.stats.players.get(player_id)

    def tonight(self) -> list[Night]:
        return [n for n in self.nights if n.day == self.latest_day]

    def results_for(self, team_id: str) -> list[Night]:
        return [n for n in self.nights if team_id in (n.home_id, n.away_id)]

    def streak(self, team_id: str) -> int:
        """Wins in a row, counting back from the club's latest game.

        Negative for a losing run, zero when the club has not played.
        """
        run = 0
        for night in reversed(self.results_for(team_id)):
            won = night.winner_id == team_id
            if run == 0:
                run = 1 if won else -1
            elif won and run > 0:
                run += 1
            elif not won and run < 0:
                run -= 1
            else:
                break
        return run

    def totals_before(self, player_id: str, game_id: str, key: str) -> int:
        """A player's total in `key` going into a given game.

        Milestones need the crossing, not the finish: 500 points is a story on
        the night it happens and old news the night after.
        """
        total = 0
        for night in self.nights:
            if night.game_id == game_id:
                break
            for lines in night.lines.values():
                for line in lines:
                    if line.player_id == player_id:
                        total += getattr(line, key)
        return total

    def best_before(self, player_id: str, game_id: str, key: str) -> int:
        best = 0
        for night in self.nights:
            if night.game_id == game_id:
                break
            for lines in night.lines.values():
                for line in lines:
                    if line.player_id == player_id:
                        best = max(best, getattr(line, key))
        return best

    def games_before(self, player_id: str, game_id: str) -> int:
        played = 0
        for night in self.nights:
            if night.game_id == game_id:
                break
            for lines in night.lines.values():
                if any(line.player_id == player_id for line in lines):
                    played += 1
        return played


def line_for(night: Night, player_id: str):
    for lines in night.lines.values():
        for line in lines:
            if line.player_id == player_id:
                return line
    return None


def double_digit_categories(line) -> list[tuple[str, int]]:
    return [
        (name, value) for name, value in (
            ("points", line.points), ("rebounds", line.rebounds),
            ("assists", line.assists), ("steals", line.steals),
            ("blocks", line.blocks),
        ) if value >= TRIPLE_DOUBLE_FLOOR
    ]


def held(importance: float) -> int:
    return int(max(1, min(100, round(importance))))


# --------------------------------------------------------------------------
# Shared paragraph builders.
#
# An article is 150-300 words, and the difference between that and a caption is
# supporting detail. All of it is in the box score already -- team shooting,
# the quarter-by-quarter, who else turned up, what the standings say -- so the
# detectors below assemble rather than pad.
# --------------------------------------------------------------------------

def player_splits(c: Copy, line) -> str:
    """A player's shooting night, only including the lines he attempted."""
    parts = [f"{c.pct(line.fgm, line.fga)} from the field"]
    if line.tpa:
        parts.append(f"{c.pct(line.tpm, line.tpa)} from three")
    if line.fta:
        parts.append(f"{c.pct(line.ftm, line.fta)} at the line")
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def extras(c: Copy, line) -> str:
    """Steals, blocks and turnovers, when there are any worth printing."""
    bits = []
    if line.steals:
        bits.append(c.plural(line.steals, "steal"))
    if line.blocks:
        bits.append(c.plural(line.blocks, "block"))
    if line.turnovers:
        bits.append(c.plural(line.turnovers, "turnover"))
    if not bits:
        return ""
    if len(bits) == 1:
        return bits[0]
    return ", ".join(bits[:-1]) + " and " + bits[-1]


def team_shooting(c: Copy, box) -> str:
    return (f"{c.pct(box.total('fgm'), box.total('fga'))} from the field and "
            f"{c.pct(box.total('tpm'), box.total('tpa'))} from three")


def quarter_line(c: Copy, night: Night, first: str, second: str) -> str:
    """The scoreboard by period, when both sides recorded one."""
    ours = getattr(night.boxes.get(first), "points_by_period", None)
    theirs = getattr(night.boxes.get(second), "points_by_period", None)
    if not ours or not theirs or len(ours) != len(theirs):
        return ""
    return ", ".join(f"{c.n(a)}-{c.n(b)}" for a, b in zip(ours, theirs))


def supporting(c: Copy, room: "Newsroom", lines, exclude: str, count: int = 2) -> str:
    """The next names down the box score, in the club's own order."""
    others = [l for l in lines if l.player_id != exclude and l.points > 0][:count]
    if not others:
        return ""
    said = [f"{l.name} added {c.plural(l.points, 'point')}" for l in others[:1]]
    for line in others[1:]:
        said.append(
            f"{line.name} had {c.plural(line.points, 'point')} and "
            f"{c.plural(line.rebounds, 'rebound')}"
        )
    return "; ".join(said) + "."


def standings_note(c: Copy, room: "Newsroom", team_id: str) -> str:
    row = room.standing(team_id)
    if row is None:
        return ""
    return (f"{room.club(team_id)} are {c.record(row.wins, row.losses)} with a "
            f"points differential of {c.n(row.point_differential)}")


def season_note(c: Copy, room: "Newsroom", player_id: str) -> str:
    line = room.season_line(player_id)
    if line is None:
        return ""
    return (f"{c.n(line.per_game('points'), '.1f')} points, "
            f"{c.n(line.per_game('rebounds'), '.1f')} rebounds and "
            f"{c.n(line.per_game('assists'), '.1f')} assists across "
            f"{c.plural(line.games, 'appearance')}")


def role(player) -> str:
    """Guard, wing, forward or centre — for a second reference by position."""
    return {
        "PG": "guard", "SG": "guard", "SF": "wing", "PF": "forward", "C": "centre",
    }.get(player.position.value, "player")


# --------------------------------------------------------------------------
# Detectors. Each returns the stories it can prove.
# --------------------------------------------------------------------------

def triple_doubles(room: Newsroom, night: Night) -> list[Story]:
    stories = []
    for team_id, lines in night.lines.items():
        for line in lines:
            categories = double_digit_categories(line)
            if len(categories) < 3:
                continue
            player = room.player(line.player_id)
            if player is None:
                continue
            c = Copy()
            story_id = f"td-{night.game_id}-{line.player_id}"
            won = night.winner_id == team_id
            opponent = night.away_id if team_id == night.home_id else night.home_id
            quadruple = len(categories) >= 4

            # A verb that matches the scoreboard: "hold on" is a lie about a
            # thirty-point win, and "fall short" is a lie about a rout.
            if won:
                outcome = "hold on" if night.margin <= THRILLER_MARGIN else (
                    "roll" if night.margin >= BLOWOUT_MARGIN else "win")
            else:
                outcome = "fall short" if night.margin <= THRILLER_MARGIN else (
                    "are routed" if night.margin >= BLOWOUT_MARGIN else "lose")

            headline = pick([
                f"{player.name} posts triple-double in {room.nickname(team_id)} "
                f"{'win' if won else 'loss'}",
                f"{player.last_name} fills the box score as "
                f"{room.nickname(team_id)} {outcome}",
                f"Triple-double night for {player.name} against "
                f"{room.nickname(opponent)}",
            ], story_id)

            body_one = (
                f"{player.name} recorded a triple-double on "
                f"{c.plural(line.points, 'point')}, "
                f"{c.plural(line.rebounds, 'rebound')} and "
                f"{c.plural(line.assists, 'assist')} as "
                f"{room.club(team_id)} "
                f"{'beat' if won else 'lost to'} {room.club(opponent)} "
                f"{c.score(night.winning_score, night.losing_score)}"
                f"{' in overtime' if night.overtime else ''}."
            )
            if quadruple:
                extra = [name for name, _v in categories
                         if name not in ("points", "rebounds", "assists")]
                body_one += (
                    f" He reached double figures in {c.n(len(categories))} categories, "
                    f"adding {' and '.join(extra)} to the three that usually define one."
                )
            quarters = quarter_line(c, night, team_id, opponent)
            if quarters:
                body_one += f" The game went {quarters} by quarter."

            other = extras(c, line)
            body_two = (
                f"The {c.n(player.age)}-year-old {role(player)} shot "
                f"{player_splits(c, line)} in {c.clock(line.minutes)} on the floor"
                + (f", with {other}." if other else ".")
            )
            box = night.boxes.get(team_id)
            if box is not None:
                body_two += (
                    f" As a side {room.club(team_id)} shot {team_shooting(c, box)}, "
                    f"with {c.plural(box.total('assists'), 'assist')} and "
                    f"{c.plural(box.total('turnovers'), 'turnover')}."
                )
            mates = supporting(c, room, lines, line.player_id)
            if mates:
                body_two += f" {mates}"
            rival = night.lines[opponent][0] if night.lines[opponent] else None
            if rival is not None:
                body_two += (
                    f" {rival.name} led {room.club(opponent)} with "
                    f"{c.plural(rival.points, 'point')}."
                )

            season = season_note(c, room, line.player_id)
            standing = standings_note(c, room, team_id)
            context = []
            if season:
                context.append(f"He is averaging {season} this season.")
            if standing:
                context.append(standing + ".")
            body_three = " ".join(context + [pick([
                "A triple-double remains the rarest line a box score produces, and "
                "it is the one number a manager can point to when arguing a player "
                "does more than score.",
                "Filling three columns in one night says more about a role than a "
                "scoring average does: it takes the ball in his hands, the minutes "
                "to use them, and a coach willing to leave him out there.",
                "Nights like it are how a player moves from a useful starter to a "
                "name the opposing coach builds a game plan around.",
            ], story_id + "-close")])

            stories.append(Story(
                headline=headline,
                subheadline=(
                    f"{player.name} finished with "
                    f"{c.line(line.points, line.rebounds, line.assists)} in "
                    f"{possessive(room.nickname(team_id))} "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win over' if won else 'defeat to'} {room.nickname(opponent)}."
                ),
                category=TRIPLE_DOUBLE,
                importance=held(ANCHOR[TRIPLE_DOUBLE] + (5 if quadruple else 0)),
                summary=(
                    f"{player.name} posted "
                    f"{c.line(line.points, line.rebounds, line.assists)} in a "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win' if won else 'loss'}."
                ),
                article=paragraphs(body_one, body_two, body_three),
                id=story_id,
                day=night.day,
                game_id=night.game_id,
                team_ids=(team_id, opponent),
                player_ids=(line.player_id,),
                figures=frozenset(c.recorded),
            ))
    return stories


def season_highs(room: Newsroom, night: Night) -> list[Story]:
    """A scoring career high, as far as one season can prove one.

    The league has played a single season, so this is a season high and is
    called one. Reporting it as a career high would be a claim about games
    that do not exist.
    """
    stories = []
    for team_id, lines in night.lines.items():
        for line in lines:
            if line.points < SEASON_HIGH_POINTS:
                continue
            previous = room.best_before(line.player_id, night.game_id, "points")
            appearances = room.games_before(line.player_id, night.game_id)
            if appearances < 3 or line.points < previous + SEASON_HIGH_MARGIN:
                continue
            player = room.player(line.player_id)
            if player is None:
                continue
            c = Copy()
            story_id = f"high-{night.game_id}-{line.player_id}"
            won = night.winner_id == team_id
            opponent = night.away_id if team_id == night.home_id else night.home_id

            headline = pick([
                f"{player.name} pours in season-high "
                f"{c.n(line.points)} against {room.nickname(opponent)}",
                f"Season-best {c.n(line.points)} from {player.name} lifts nothing "
                f"but the scoreboard" if not won else
                f"{player.name} sets season high with {c.n(line.points)}",
                f"{player.last_name} tops his season with "
                f"{c.n(line.points)}-point night",
            ], story_id)

            body_one = (
                f"{player.name} scored {c.plural(line.points, 'point')} against "
                f"{room.club(opponent)}, the most he has managed in a game this "
                f"season and {c.plural(line.points - previous, 'point')} clear of "
                f"his previous best of {c.n(previous)}. "
                f"{room.club(team_id)} "
                f"{'won' if won else 'lost'} "
                f"{c.score(night.winning_score, night.losing_score)}"
                f"{' in overtime' if night.overtime else ''}."
            )

            other = extras(c, line)
            body_two = (
                f"The {c.n(player.age)}-year-old {role(player)} shot "
                f"{player_splits(c, line)}, adding "
                f"{c.plural(line.rebounds, 'rebound')} and "
                f"{c.plural(line.assists, 'assist')} in {c.clock(line.minutes)}"
                + (f", with {other}." if other else ".")
            )
            box = night.boxes.get(team_id)
            if box is not None:
                body_two += (
                    f" {room.club(team_id)} shot {team_shooting(c, box)} as a side."
                )
            mates = supporting(c, room, lines, line.player_id)
            if mates:
                body_two += f" {mates}"

            season = room.season_line(line.player_id)
            body_three_parts = [
                f"It was his {c.n(appearances + 1)}th appearance of the season."
            ]
            if season:
                body_three_parts.append(
                    f"He is now averaging {season_note(c, room, line.player_id)}."
                )
            standing = standings_note(c, room, team_id)
            if standing:
                body_three_parts.append(standing + ".")
            body_three_parts.append(pick([
                "One night does not move a season average far, but it does change "
                "what a coach is willing to run for a player in the fourth quarter.",
                "A career is built out of games like this one, and the useful "
                "question is whether the shot profile behind it repeats or "
                "whether it was an evening of everything falling at once.",
                "Whether it is a breakout or an outlier is a question only the next "
                "ten games answer, and the honest reading of one night is that "
                "it raises the range of outcomes rather than settling them.",
            ], story_id + "-close"))
            body_three = " ".join(body_three_parts)

            stories.append(Story(
                headline=headline,
                subheadline=(
                    f"The {room.nickname(team_id)} {role(player)} beat his previous "
                    f"season best of {c.n(previous)} by "
                    f"{c.plural(line.points - previous, 'point')}."
                ),
                category=SEASON_HIGH,
                importance=held(ANCHOR[SEASON_HIGH] + min(8, (line.points - 30) / 3)),
                summary=(
                    f"{player.name} scored a season-high "
                    f"{c.plural(line.points, 'point')} in "
                    f"{possessive(room.nickname(team_id))} "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win' if won else 'loss'}."
                ),
                article=paragraphs(body_one, body_two, body_three),
                id=story_id,
                day=night.day,
                game_id=night.game_id,
                team_ids=(team_id, opponent),
                player_ids=(line.player_id,),
                figures=frozenset(c.recorded),
            ))
    return stories


def big_games(room: Newsroom, night: Night) -> list[Story]:
    """A dominant individual line that is not already a triple-double."""
    stories = []
    for team_id, lines in night.lines.items():
        for line in lines:
            if len(double_digit_categories(line)) >= 3:
                continue
            big = (line.points >= BIG_GAME_POINTS
                   or line.rebounds >= BIG_GAME_REBOUNDS
                   or line.assists >= BIG_GAME_ASSISTS)
            if not big:
                continue
            player = room.player(line.player_id)
            if player is None:
                continue
            c = Copy()
            story_id = f"big-{night.game_id}-{line.player_id}"
            won = night.winner_id == team_id
            opponent = night.away_id if team_id == night.home_id else night.home_id

            if line.points >= BIG_GAME_POINTS:
                lead = f"{c.plural(line.points, 'point')}"
                verb = "scored"
            elif line.rebounds >= BIG_GAME_REBOUNDS:
                lead = f"{c.plural(line.rebounds, 'rebound')}"
                verb = "pulled down"
            else:
                lead = f"{c.plural(line.assists, 'assist')}"
                verb = "handed out"

            headline = pick([
                f"{player.name} {verb} {lead} in "
                f"{room.nickname(team_id)} {'win' if won else 'defeat'}",
                f"{lead.capitalize()} for {player.name} against "
                f"{room.nickname(opponent)}",
                f"{player.last_name} carries {room.nickname(team_id)} with {lead}"
                if won else
                f"{player.last_name}'s {lead} not enough for "
                f"{room.nickname(team_id)}",
            ], story_id)

            body_one = (
                f"{player.name} {verb} {lead} as {room.club(team_id)} "
                f"{'beat' if won else 'lost to'} {room.club(opponent)} "
                f"{c.score(night.winning_score, night.losing_score)}"
                f"{' in overtime' if night.overtime else ''}."
            )
            quarters = quarter_line(c, night, team_id, opponent)
            if quarters:
                body_one += f" By quarter it went {quarters}."

            other = extras(c, line)
            body_two = (
                f"His full line read "
                f"{c.line(line.points, line.rebounds, line.assists)} on "
                f"{player_splits(c, line)} in {c.clock(line.minutes)}"
                + (f", with {other}." if other else ".")
            )
            box = night.boxes.get(team_id)
            if box is not None:
                body_two += (
                    f" {room.club(team_id)} shot {team_shooting(c, box)} as a side, "
                    f"with {c.plural(box.total('assists'), 'assist')}."
                )
            mates = supporting(c, room, lines, line.player_id)
            if mates:
                body_two += f" {mates}"
            rival = night.lines[opponent][0] if night.lines[opponent] else None
            if rival is not None:
                body_two += (
                    f" {rival.name} top-scored for {room.club(opponent)} with "
                    f"{c.plural(rival.points, 'point')} and "
                    f"{c.plural(rival.rebounds, 'rebound')}."
                )

            body_three_parts = []
            season = season_note(c, room, line.player_id)
            if season:
                body_three_parts.append(f"He is averaging {season} this season.")
            standing = standings_note(c, room, team_id)
            if standing:
                body_three_parts.append(standing + ".")
            club_line = room.league.stats.teams.get(team_id)
            if club_line is not None:
                body_three_parts.append(
                    f"As a club they are averaging "
                    f"{c.n(club_line.per_game('points'), '.1f')} points a game on "
                    f"{c.n(club_line.fg_pct * 100, '.1f')}% shooting."
                )
            body_three_parts.append(pick([
                "Nights like it are what separate a rotation player from a name the "
                "rest of the league game-plans for.",
                "A single line does not settle anything, but it does tell a manager "
                "what the ceiling looks like when the shots fall.",
                "The useful test is repeatability: one such night is form, ten is a "
                "role.",
            ], story_id + "-close"))
            body_three = " ".join(body_three_parts)

            over = max(0, line.points - BIG_GAME_POINTS)
            stories.append(Story(
                headline=headline,
                subheadline=(
                    f"{player.name} finished with "
                    f"{c.line(line.points, line.rebounds, line.assists)} in a "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win' if won else 'loss'}."
                ),
                category=BIG_GAME,
                importance=held(ANCHOR[BIG_GAME] + min(12, over)),
                summary=(
                    f"{player.name} {verb} {lead} in "
                    f"{possessive(room.nickname(team_id))} "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win' if won else 'loss'}."
                ),
                article=paragraphs(body_one, body_two, body_three),
                id=story_id,
                day=night.day,
                game_id=night.game_id,
                team_ids=(team_id, opponent),
                player_ids=(line.player_id,),
                figures=frozenset(c.recorded),
            ))
    return stories


def milestones(room: Newsroom, night: Night) -> list[Story]:
    """A season total crossing a round number, on the night it crosses."""
    stories = []
    checks = (
        ("points", "points", POINT_MILESTONES),
        ("rebounds", "rebounds", COUNTING_MILESTONES),
        ("assists", "assists", COUNTING_MILESTONES),
    )
    for team_id, lines in night.lines.items():
        for line in lines:
            for key, word, marks in checks:
                before = room.totals_before(line.player_id, night.game_id, key)
                after = before + getattr(line, key)
                crossed = [m for m in marks if before < m <= after]
                if not crossed:
                    continue
                mark = max(crossed)
                player = room.player(line.player_id)
                if player is None:
                    continue
                c = Copy()
                story_id = f"mile-{night.game_id}-{line.player_id}-{key}-{mark}"
                won = night.winner_id == team_id
                opponent = night.away_id if team_id == night.home_id else night.home_id
                season = room.season_line(line.player_id)

                headline = pick([
                    f"{player.name} reaches {c.n(mark)} {word} for the season",
                    f"{player.last_name} passes {c.n(mark)} {word} in "
                    f"{room.nickname(team_id)} {'win' if won else 'loss'}",
                    f"{c.n(mark)} {word} and counting for {player.name}",
                ], story_id)

                body_one = (
                    f"{player.name} moved past {c.plural(mark, word[:-1])} for the "
                    f"season during {possessive(room.club(team_id))} "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win over' if won else 'defeat to'} {room.club(opponent)}, "
                    f"finishing the night on {c.n(after)} for the campaign."
                )
                other = extras(c, line)
                body_two = (
                    f"The {c.n(player.age)}-year-old {role(player)} contributed "
                    f"{c.line(line.points, line.rebounds, line.assists)} against "
                    f"{room.club(opponent)}, shooting {player_splits(c, line)} in "
                    f"{c.clock(line.minutes)}"
                    + (f", with {other}." if other else ".")
                )
                box = night.boxes.get(team_id)
                if box is not None:
                    body_two += (
                        f" {room.club(team_id)} shot {team_shooting(c, box)} on the "
                        f"night."
                    )
                mates = supporting(c, room, lines, line.player_id, count=2)
                if mates:
                    body_two += f" {mates}"
                rival = night.lines[opponent][0] if night.lines[opponent] else None
                if rival is not None:
                    body_two += (
                        f" {rival.name} led {room.club(opponent)} with "
                        f"{c.plural(rival.points, 'point')}."
                    )

                body_three_parts = []
                if season:
                    body_three_parts.append(
                        f"Across {c.plural(season.games, 'appearance')} that is "
                        f"{c.n(season.per_game(key), '.1f')} {word} a game."
                    )
                    body_three_parts.append(
                        f"His full season line reads "
                        f"{season_note(c, room, line.player_id)}."
                    )
                standing = standings_note(c, room, team_id)
                if standing:
                    body_three_parts.append(standing + ".")
                body_three_parts.append(pick([
                    "Round numbers are arbitrary. The rate behind them is not, and "
                    "it is the rate a manager pays for when the contract comes "
                    "up and the milestone has stopped being news.",
                    "Milestones are a way of noticing durability: reaching one takes "
                    "production and the availability to keep producing, and "
                    "over a long season the second is the harder half.",
                    "The mark itself is a headline. What it certifies is a player "
                    "who has been on the floor and useful all season, which is "
                    "a rarer combination than any single evening of production.",
                ], story_id + "-close"))
                body_three = " ".join(body_three_parts)

                stories.append(Story(
                    headline=headline,
                    subheadline=(
                        f"The {room.nickname(team_id)} {role(player)} is up to "
                        f"{c.n(after)} {word} on the season."
                    ),
                    category=MILESTONE,
                    importance=held(ANCHOR[MILESTONE] + min(10, mark / 200)),
                    summary=(
                        f"{player.name} passed {c.n(mark)} {word} for the season, "
                        f"reaching {c.n(after)}."
                    ),
                    article=paragraphs(body_one, body_two, body_three),
                    id=story_id,
                    day=night.day,
                    game_id=night.game_id,
                    team_ids=(team_id, opponent),
                    player_ids=(line.player_id,),
                    figures=frozenset(c.recorded),
                ))
    return stories


def rookie_watch(room: Newsroom, night: Night) -> list[Story]:
    """The draft class that entered this season, when one of them delivers."""
    season_year = _draft_year(room)
    if season_year is None:
        return []
    stories = []
    for team_id, lines in night.lines.items():
        for line in lines:
            if line.points < ROOKIE_POINTS:
                continue
            player = room.player(line.player_id)
            if player is None or player.bio is None:
                continue
            draft = player.bio.draft
            if draft is None or draft.year != season_year:
                continue
            c = Copy()
            story_id = f"rook-{night.game_id}-{line.player_id}"
            won = night.winner_id == team_id
            opponent = night.away_id if team_id == night.home_id else night.home_id

            headline = pick([
                f"Rookie {player.name} scores {c.n(line.points)} for "
                f"{room.nickname(team_id)}",
                f"{player.last_name} shows his class with "
                f"{c.n(line.points)} in {room.nickname(team_id)} "
                f"{'win' if won else 'loss'}",
                f"First-year {player.name} goes for {c.n(line.points)}",
            ], story_id)

            body_one = (
                f"{player.name}, the number {c.n(draft.pick)} pick of the "
                f"{c.n(draft.year)} draft, scored "
                f"{c.plural(line.points, 'point')} in {possessive(room.club(team_id))} "
                f"{c.score(night.winning_score, night.losing_score)} "
                f"{'win over' if won else 'defeat to'} {room.club(opponent)}."
            )
            other = extras(c, line)
            body_two = (
                f"The {c.n(player.age)}-year-old {role(player)} added "
                f"{c.plural(line.rebounds, 'rebound')} and "
                f"{c.plural(line.assists, 'assist')} on {player_splits(c, line)} "
                f"across {c.clock(line.minutes)}"
                + (f", with {other}." if other else ".")
            )
            if player.bio.background:
                body_two += (
                    f" A round {c.n(draft.round)} pick, he arrived from "
                    f"{player.bio.background}."
                )
            box = night.boxes.get(team_id)
            if box is not None:
                body_two += (
                    f" {room.club(team_id)} shot {team_shooting(c, box)} as a side."
                )
            mates = supporting(c, room, lines, line.player_id, count=2)
            if mates:
                body_two += f" {mates}"
            rival = night.lines[opponent][0] if night.lines[opponent] else None
            if rival is not None:
                body_two += (
                    f" {rival.name} led {room.club(opponent)} with "
                    f"{c.plural(rival.points, 'point')}."
                )

            # Always present. The two notes below are both conditional -- a
            # rookie with no season line yet and a club with nothing worth
            # saying about its record leave this paragraph as one closing
            # sentence, and the article lands on the 150-word floor. Where a
            # man was taken is the thing a reader most wants next to what he
            # just did, and it is known for every player in the league.
            body_three_parts = [
                f"He was the {c.n(draft.pick)} pick of round "
                f"{c.n(draft.round)} in {c.n(draft.year)}."
                if not draft.undrafted else
                f"He went undrafted in {c.n(draft.year)}."
            ]
            season = season_note(c, room, line.player_id)
            if season:
                body_three_parts.append(f"He is averaging {season} this season.")
            standing = standings_note(c, room, team_id)
            if standing:
                body_three_parts.append(standing + ".")
            body_three_parts.append(pick([
                "First-year returns like it change how a club plans its next three "
                "summers, because a rookie contract is the cheapest production in "
                "the sport.",
                "A draft pick producing this early reshapes a rebuild's timeline "
                "more than any signing at the same price could.",
                "What a club does with a first-year player who can already score is "
                "the difference between a rebuild and a wasted window.",
            ], story_id + "-close"))
            body_three = " ".join(body_three_parts)

            stories.append(Story(
                headline=headline,
                subheadline=(
                    f"The {c.n(draft.year)} draft pick posted "
                    f"{c.plural(line.points, 'point')} against "
                    f"{room.nickname(opponent)}."
                ),
                category=ROOKIE_WATCH,
                importance=held(ANCHOR[ROOKIE_WATCH] + min(15, line.points - 20)),
                summary=(
                    f"Rookie {player.name} scored "
                    f"{c.plural(line.points, 'point')} in "
                    f"{possessive(room.nickname(team_id))} "
                    f"{c.score(night.winning_score, night.losing_score)} "
                    f"{'win' if won else 'loss'}."
                ),
                article=paragraphs(body_one, body_two, body_three),
                id=story_id,
                day=night.day,
                game_id=night.game_id,
                team_ids=(team_id, opponent),
                player_ids=(line.player_id,),
                figures=frozenset(c.recorded),
            ))
    return stories


def _draft_year(room: Newsroom) -> int | None:
    """The class that entered this season: the newest one on any roster."""
    years = [
        p.bio.draft.year
        for team in room.league.teams.values()
        for p in team.players
        if p.bio is not None and p.bio.draft is not None
    ]
    return max(years) if years else None



def power_moves(room: Newsroom) -> list[Story]:
    """A change at number one, and the day's biggest climb.

    The two rankings are recomputed rather than looked up -- `power.rate` is
    called for today and for the day before -- so a story about movement is a
    story about two real tables, not about a number somebody stored.
    """
    from .league import power

    league = room.league
    days = power.ranking_days(league)
    if len(days) < 2:
        return []

    today = power.rate(league, days[-1])
    yesterday = power.rate(league, days[-2])
    if not today or not yesterday:
        return []
    was = {row["teamId"]: row["rank"] for row in yesterday}
    stories: list[Story] = []

    leader, old_leader = today[0], yesterday[0]
    if leader["teamId"] != old_leader["teamId"]:
        c = Copy()
        story_id = f"power1-{days[-1]}-{leader['teamId']}"
        club = room.club(leader["teamId"])
        deposed = room.club(old_leader["teamId"])
        previous = was.get(leader["teamId"], 0)
        dropped = next(
            (r["rank"] for r in today if r["teamId"] == old_leader["teamId"]), 0)

        headline = pick([
            f"{club} take over at number one",
            f"{room.nickname(leader['teamId'])} rise to the top of the rankings",
            f"{room.nickname(leader['teamId'])} climb to first in the power rankings",
        ], story_id)

        body_one = (
            f"{club} are the league's new number one, up from "
            f"{c.n(previous)} on a record of "
            f"{c.record(leader['wins'], leader['losses'])} and a "
            f"{leader['lastTen']} run over their last {c.n(10)} games. They "
            f"displace {deposed}, who slip to {c.n(dropped)}. "
            f"{club} are currently on {leader['streak']}."
        )
        body_two = (
            f"Their power rating stands at {c.n(leader['rating'], '.1f')} on a "
            f"hundred-point scale, built on a net rating of "
            f"{c.n(leader['netRating'], '.1f')} per 100 possessions — "
            f"{c.n(leader['offensiveRating'], '.1f')} scored against "
            f"{c.n(leader['defensiveRating'], '.1f')} conceded — and a scoring "
            f"margin of {c.n(leader['differential'], '.1f')} a game. They are "
            f"{leader['homeRecord']} at home and {leader['awayRecord']} on the "
            f"road, with a best run this season of "
            f"{c.plural(leader['bestWinStreak'], 'straight win')}."
        )
        body_three = (
            f"The power rankings are not the standings and are not trying to be. "
            f"Form over the last ten games carries a quarter of the rating on its "
            f"own, every result is weighted by how recently it happened, and beating "
            f"a contender counts for more than beating a bottom-eight club. A team "
            f"can top this table without leading the league in wins, which is the "
            f"whole reason for having it alongside the other one. {club} are rated "
            f"a {leader['tier'].lower()} on current form."
        )
        stories.append(Story(
            headline=headline,
            subheadline=(
                f"{club} move up to first with a power rating of "
                f"{c.n(leader['rating'], '.1f')}."
            ),
            category=POWER_RANKINGS,
            importance=held(ANCHOR[POWER_RANKINGS] + 8),
            summary=f"{club} are the new number one, up from {c.n(previous)}.",
            article=paragraphs(body_one, body_two, body_three),
            id=story_id,
            day=days[-1],
            team_ids=(leader["teamId"], old_leader["teamId"]),
            figures=frozenset(c.recorded),
        ))

    climbs = sorted(
        ((was[row["teamId"]] - row["rank"], row) for row in today if row["teamId"] in was),
        key=lambda pair: (-pair[0], pair[1]["teamId"]),
    )
    climbs = [
        pair for pair in climbs
        if int(pair[1]["lastTen"].split("-")[0]) > int(pair[1]["lastTen"].split("-")[1])
    ]
    if climbs and climbs[0][0] >= 4:
        gained, row = climbs[0]
        c = Copy()
        story_id = f"powerup-{days[-1]}-{row['teamId']}"
        club = room.club(row["teamId"])
        headline = pick([
            f"{room.nickname(row['teamId'])} surge {c.n(gained)} places in the rankings",
            f"Biggest climb of the day belongs to {club}",
            f"{club} jump {c.n(gained)} places in the power rankings",
        ], story_id)

        body_one = (
            f"{club} are the day's biggest movers, up {c.plural(gained, 'place')} "
            f"to {c.n(row['rank'])} in the power rankings on the back of a "
            f"{row['lastTen']} run over their last {c.n(10)} games. They are "
            f"{c.record(row['wins'], row['losses'])} on the season and currently "
            f"{row['streak']}."
        )
        body_two = (
            f"The move puts their rating at {c.n(row['rating'], '.1f')}, with a net "
            f"rating of {c.n(row['netRating'], '.1f')} per 100 possessions — "
            f"{c.n(row['offensiveRating'], '.1f')} scored against "
            f"{c.n(row['defensiveRating'], '.1f')} conceded — and a scoring margin "
            f"of {c.n(row['differential'], '.1f')} a game. Home and away they "
            f"split {row['homeRecord']} and {row['awayRecord']}, with a best run "
            f"this season of {c.plural(row['bestWinStreak'], 'straight win')}."
        )
        body_three = (
            f"Recent games are weighted far more heavily than old ones — a result "
            f"from yesterday counts in full and one from three weeks ago counts for "
            f"almost nothing — so a stretch like this one moves a club quickly, and "
            f"would move it back just as fast. That is the trade a form table makes: "
            f"it answers who is playing well now rather than who has banked the most "
            f"wins since October. {club} are rated a {row['tier'].lower()}."
        )
        stories.append(Story(
            headline=headline,
            subheadline=(
                f"{club} climb {c.plural(gained, 'place')} to "
                f"{c.n(row['rank'])} after a {row['lastTen']} stretch."
            ),
            category=POWER_RANKINGS,
            importance=held(ANCHOR[POWER_RANKINGS] + min(10, gained)),
            summary=(
                f"{club} rose {c.plural(gained, 'place')} to "
                f"{c.n(row['rank'])} in the power rankings."
            ),
            article=paragraphs(body_one, body_two, body_three),
            id=story_id,
            day=days[-1],
            team_ids=(row["teamId"],),
            figures=frozenset(c.recorded),
        ))
    return stories


def streaks(room: Newsroom) -> list[Story]:
    stories = []
    for team_id in room.league.teams:
        run = room.streak(team_id)
        if run < STREAK_FLOOR:
            continue
        row = room.standing(team_id)
        recent = room.results_for(team_id)
        if row is None or not recent:
            continue
        c = Copy()
        story_id = f"streak-{team_id}-{run}"
        last = recent[-1]
        team = room.team(team_id)
        coach = team.coach if team else None

        headline = pick([
            f"{room.nickname(team_id)} win {c.n(run)} straight",
            f"{room.club(team_id)} stretch run to {c.n(run)} games",
            f"{c.n(run)} in a row for the {room.nickname(team_id)}",
        ], story_id)

        beaten = room.nickname(last.loser_id)
        body_one = (
            f"{room.club(team_id)} have won {c.plural(run, 'game')} in a row after "
            f"a {c.score(last.winning_score, last.losing_score)} win over "
            f"{room.club(last.loser_id)}, moving them to "
            f"{c.record(row.wins, row.losses)} on the season."
        )

        window = recent[-run:]
        scored = sum(n.home_score if n.home_id == team_id else n.away_score
                     for n in window)
        allowed = sum(n.away_score if n.home_id == team_id else n.home_score
                      for n in window)
        beaten_list = ", ".join(
            f"{room.nickname(n.loser_id)} "
            f"({c.score(n.winning_score, n.losing_score)})" for n in window
        )
        widest = max(window, key=lambda n: n.margin)
        tightest = min(window, key=lambda n: n.margin)
        body_two = (
            f"Over the run they have averaged {c.n(scored / run, '.1f')} points and "
            f"conceded {c.n(allowed / run, '.1f')}, a margin of "
            f"{c.n((scored - allowed) / run, '.1f')} a night. Against {beaten} the "
            f"margin was {c.plural(last.margin, 'point')}; the widest of the run was "
            f"{c.plural(widest.margin, 'point')} against "
            f"{room.nickname(widest.loser_id)} and the tightest "
            f"{c.plural(tightest.margin, 'point')} against "
            f"{room.nickname(tightest.loser_id)}. In order they have beaten "
            f"{beaten_list}."
        )

        top = max(
            (l for n in window for l in n.lines.get(team_id, [])),
            key=lambda l: l.points, default=None,
        )
        # Always present, and load-bearing for more than one reason. A short run
        # writes a short "in order they have beaten" list, and a three-game
        # streak against clubs with brief nicknames used to leave the article
        # under the 150-word floor -- which is a real fault in the piece, not
        # just in the count: a reader is owed something about *where* a run was
        # won. Home and away is that something, and it is always computable.
        home_games = sum(1 for n in window if n.home_id == team_id)
        away_games = run - home_games
        if home_games and away_games:
            venue = (f"{c.plural(home_games, 'win')} of the run came at home and "
                     f"{c.n(away_games)} on the road")
        elif home_games:
            venue = f"all {c.plural(home_games, 'win')} came at home"
        else:
            venue = f"all {c.plural(away_games, 'win')} came on the road"

        body_three_parts = [
            f"{venue.capitalize()}.",
            f"On the season they have scored {c.n(row.points_for)} and allowed "
            f"{c.n(row.points_against)}, a differential of "
            f"{c.n(row.point_differential)} across "
            f"{c.plural(row.games_played, 'game')}"
            + (f", with {coach.name} on the bench." if coach else ".")
        ]
        if top is not None:
            body_three_parts.append(
                f"The best individual night of the streak was "
                f"{c.plural(top.points, 'point')} from {top.name}."
            )
        team_line = room.league.stats.teams.get(team_id)
        if team_line is not None:
            body_three_parts.append(
                f"Across the season they are averaging "
                f"{c.n(team_line.per_game('points'), '.1f')} points on "
                f"{c.n(team_line.fg_pct * 100, '.1f')}% shooting and "
                f"{c.n(team_line.per_game('assists'), '.1f')} assists, while "
                f"conceding {c.n(team_line.per_game('points_against'), '.1f')}."
            )
        body_three_parts.append(pick([
            "A run this long is usually a mix of form and fixture list, and the "
            "table does not distinguish between them.",
            "Streaks end, but the differential they build stays on the season "
            "record and is what a tie-break eventually reads.",
            "The question a run like this raises is whether it is a level "
            "changing or a schedule softening.",
        ], story_id + "-close"))
        body_three = " ".join(body_three_parts)

        stories.append(Story(
            headline=headline,
            subheadline=(
                f"{room.club(team_id)} are {c.record(row.wins, row.losses)} after "
                f"a {c.n(run)}-game winning run."
            ),
            category=HOT_STREAK,
            importance=held(ANCHOR[HOT_STREAK] + min(15, (run - STREAK_FLOOR) * 3)),
            summary=(
                f"{room.club(team_id)} have won {c.plural(run, 'straight game')} "
                f"and sit at {c.record(row.wins, row.losses)}."
            ),
            article=paragraphs(body_one, body_two, body_three),
            id=story_id,
            day=last.day,
            game_id=last.game_id,
            team_ids=(team_id,),
            figures=frozenset(c.recorded),
        ))
    return stories


def recaps(room: Newsroom, night: Night) -> list[Story]:
    """The game itself, told through the scoreboard."""
    c = Copy()
    story_id = f"recap-{night.game_id}"
    winner, loser = night.winner_id, night.loser_id
    best = max(
        (l for lines in night.lines.values() for l in lines),
        key=lambda l: l.points, default=None,
    )
    if best is None:
        return []
    star = room.player(best.player_id)
    star_team = room.player_team(best.player_id)

    if night.overtime:
        shape = "overtime"
    elif night.margin <= THRILLER_MARGIN:
        shape = "thriller"
    elif night.margin >= BLOWOUT_MARGIN:
        shape = "rout"
    else:
        shape = "steady"

    headline = pick({
        "overtime": [
            f"{room.nickname(winner)} edge {room.nickname(loser)} in overtime",
            f"Extra time needed as {room.nickname(winner)} hold off "
            f"{room.nickname(loser)}",
        ],
        "thriller": [
            f"{room.nickname(winner)} hold on against {room.nickname(loser)}",
            f"{room.nickname(loser)} fall short in "
            f"{c.n(night.margin)}-point finish",
        ],
        "rout": [
            f"{room.nickname(winner)} run away from {room.nickname(loser)}",
            f"{room.nickname(loser)} overrun by {c.plural(night.margin, 'point')}",
        ],
        # Five words minimum, because "Mariners see off Forge" is a scoreline
        # with a verb in it rather than a headline.
        "steady": [
            f"{room.nickname(winner)} see off {room.nickname(loser)} at home"
            if winner == night.home_id else
            f"{room.nickname(winner)} see off {room.nickname(loser)} on the road",
            f"{room.nickname(winner)} take care of {room.nickname(loser)} "
            f"by {c.n(night.margin)}",
            f"{room.nickname(loser)} come up short against {room.nickname(winner)}",
        ],
    }[shape], story_id)

    body_one = (
        f"{room.club(winner)} beat {room.club(loser)} "
        f"{c.score(night.winning_score, night.losing_score)}"
        + (f" after {c.plural(night.overtime, 'period')} of overtime"
           if night.overtime else "")
        + "."
    )
    if shape == "rout":
        body_one += f" The margin was {c.plural(night.margin, 'point')}."
    elif shape == "thriller":
        body_one += (
            f" {c.plural(night.margin, 'point')} separated the sides at the buzzer."
        )
    quarters = quarter_line(c, night, winner, loser)
    if quarters:
        body_one += f" The quarters read {quarters} in the winners' favour."

    winning_lines = night.lines[winner]
    losing_lines = night.lines[loser]
    body_two_parts = []
    if star is not None:
        other = extras(c, best)
        body_two_parts.append(
            f"{star.name} led all scorers with "
            f"{c.plural(best.points, 'point')} for "
            f"{room.nickname(star_team or winner)} on "
            f"{player_splits(c, best)}, adding "
            f"{c.plural(best.rebounds, 'rebound')} and "
            f"{c.plural(best.assists, 'assist')}"
            + (f" with {other}." if other else ".")
        )
    if len(winning_lines) > 1 and winning_lines[0].player_id != best.player_id:
        top = winning_lines[0]
        body_two_parts.append(
            f"{top.name} top-scored for {room.nickname(winner)} with "
            f"{c.plural(top.points, 'point')}."
        )
    if len(winning_lines) > 1:
        second = next((l for l in winning_lines if l.player_id != best.player_id), None)
        if second is not None and second.player_id != winning_lines[0].player_id:
            body_two_parts.append(
                f"{second.name} chipped in {c.plural(second.points, 'point')}."
            )
    if losing_lines:
        beaten_best = losing_lines[0]
        if beaten_best.player_id != best.player_id:
            body_two_parts.append(
                f"{beaten_best.name} answered with "
                f"{c.plural(beaten_best.points, 'point')} and "
                f"{c.plural(beaten_best.rebounds, 'rebound')} for "
                f"{room.nickname(loser)}."
            )
    body_two = " ".join(body_two_parts)

    top_board = max(
        (l for lines in night.lines.values() for l in lines),
        key=lambda l: l.rebounds, default=None,
    )
    top_passer = max(
        (l for lines in night.lines.values() for l in lines),
        key=lambda l: l.assists, default=None,
    )
    if top_board is not None:
        body_two += (
            f" {top_board.name} led all rebounders with "
            f"{c.plural(top_board.rebounds, 'board')}"
        )
        if top_passer is not None:
            body_two += (
                f" and {top_passer.name} led all passers with "
                f"{c.plural(top_passer.assists, 'assist')}."
            )
        else:
            body_two += "."

    win_box, lose_box = night.boxes.get(winner), night.boxes.get(loser)
    if win_box is not None and lose_box is not None:
        win_reb = win_box.total("offensive_rebounds") + win_box.total("defensive_rebounds")
        lose_reb = lose_box.total("offensive_rebounds") + lose_box.total("defensive_rebounds")
        body_three_head = (
            f"{room.club(winner)} shot {team_shooting(c, win_box)}; "
            f"{room.club(loser)} shot {team_shooting(c, lose_box)}. "
            f"Rebounds finished {c.n(win_reb)}-{c.n(lose_reb)}"
            + (f" the winners' way" if win_reb > lose_reb
               else f", {room.nickname(loser)} taking the glass" if lose_reb > win_reb
               else ", level")
            + f", assists "
            f"{c.n(win_box.total('assists'))}-{c.n(lose_box.total('assists'))}, and "
            f"free-throw attempts {c.n(win_box.total('fta'))}-"
            f"{c.n(lose_box.total('fta'))}."
        )
    else:
        body_three_head = ""

    win_row, lose_row = room.standing(winner), room.standing(loser)
    tail = []
    if body_three_head:
        tail.append(body_three_head)
    if win_row and lose_row:
        tail.append(
            f"{room.club(winner)} move to {c.record(win_row.wins, win_row.losses)}; "
            f"{room.club(loser)} drop to "
            f"{c.record(lose_row.wins, lose_row.losses)}. "
            f"The two clubs are separated by "
            f"{c.plural(abs(win_row.point_differential - lose_row.point_differential), 'point')} "
            f"of season differential."
        )
    tail.append(pick({
        "overtime": [
            "Extra time is where rotations get exposed: the eighth and ninth men "
            "who were resting in the fourth end up deciding it.",
            "An overtime loss costs the same in the table as any other, and rather "
            "more in legs.",
        ],
        "thriller": [
            "One possession either way and the table reads differently, which is "
            "the whole argument for valuing point differential over record early "
            "in a season.",
            "Games decided this narrowly say less about the sides than the "
            "standings will suggest in April.",
        ],
        "rout": [
            "A margin that wide is usually a shooting night rather than a gulf in "
            "quality, and the return fixture rarely looks like it.",
            "Blowouts flatter and mislead in equal measure, but they do move a "
            "differential that tie-breaks eventually read.",
        ],
        "steady": [
            "Neither club will learn much from it, which is what most of an "
            "eighty-two game season is made of.",
            "A result like this one is the ordinary business of a long season: no "
            "drama, two points, on to the next.",
        ],
    }[shape], story_id + "-close"))
    body_three = " ".join(tail)

    return [Story(
        headline=headline,
        subheadline=(
            f"{room.club(winner)} won "
            f"{c.score(night.winning_score, night.losing_score)}"
            + (" in overtime." if night.overtime else ".")
        ),
        category=GAME_RECAP,
        importance=held(
            ANCHOR[GAME_RECAP]
            + (8 if night.overtime else 0)
            + (5 if shape == "thriller" else 0)
            + (3 if shape == "rout" else 0)
        ),
        summary=(
            f"{room.club(winner)} beat {room.club(loser)} "
            f"{c.score(night.winning_score, night.losing_score)}."
        ),
        article=paragraphs(body_one, body_two, body_three),
        id=story_id,
        day=night.day,
        game_id=night.game_id,
        team_ids=(winner, loser),
        player_ids=(best.player_id,),
        figures=frozenset(c.recorded),
    )]


def mvp_race(room: Newsroom) -> list[Story]:
    """The scoring race, read against the standings.

    Deliberately not a prediction. It reports who is scoring most and what
    their club's record is, and leaves the argument to the reader.
    """
    lines = [
        line for line in room.league.stats.players.values()
        if line.games >= MVP_MIN_GAMES
    ]
    if len(lines) < 3:
        return []
    ranked = sorted(lines, key=lambda l: -l.per_game("points"))[:3]
    leader = ranked[0]
    player = room.player(leader.player_id)
    if player is None:
        return []
    team_id = room.player_team(leader.player_id)
    row = room.standing(team_id) if team_id else None

    c = Copy()
    story_id = f"mvp-{leader.player_id}-{leader.games}"
    headline = pick([
        f"{player.name} leads the league in scoring",
        f"Scoring race: {player.last_name} out in front at "
        f"{c.n(leader.per_game('points'), '.1f')}",
        f"{player.name} tops the league at "
        f"{c.n(leader.per_game('points'), '.1f')} a game",
    ], story_id)

    body_one = (
        f"{player.name} leads the league in scoring at "
        f"{c.n(leader.per_game('points'), '.1f')} points a game through "
        f"{c.plural(leader.games, 'appearance')}"
        + (f", with {room.club(team_id)} at {c.record(row.wins, row.losses)}."
           if row else ".")
        + f" The {c.n(player.age)}-year-old {role(player)} is playing "
        f"{c.n(leader.per_game('minutes'), '.1f')} minutes a night."
    )

    chase = ", ".join(
        f"{(room.player(l.player_id).name if room.player(l.player_id) else l.name)} "
        f"({c.n(l.per_game('points'), '.1f')})"
        for l in ranked[1:]
    )
    boards = max(lines, key=lambda l: l.per_game("rebounds"))
    passes = max(lines, key=lambda l: l.per_game("assists"))
    board_man = room.player(boards.player_id)
    pass_man = room.player(passes.player_id)
    body_two = (
        f"He is shooting {c.n(leader.fg_pct * 100, '.1f')}% from the field and "
        f"{c.n(leader.tp_pct * 100, '.1f')}% from three, adding "
        f"{c.n(leader.per_game('rebounds'), '.1f')} rebounds, "
        f"{c.n(leader.per_game('assists'), '.1f')} assists and "
        f"{c.n(leader.per_game('steals'), '.1f')} steals a night. Behind him in the "
        f"scoring race: {chase}."
    )
    if board_man is not None and pass_man is not None:
        body_two += (
            f" The other two counting races have "
            f"{board_man.name} in front on the glass at "
            f"{c.n(boards.per_game('rebounds'), '.1f')} a game and {pass_man.name} "
            f"leading the assists at {c.n(passes.per_game('assists'), '.1f')}."
        )

    body_three = (
        "Scoring average is the loudest number in the argument and rarely the "
        "deciding one — a vote weighs it against record, availability and the "
        "two-way case, and a leading scorer on a losing side has historically "
        "struggled to win anything. On the first of those, "
        + (f"{room.club(team_id)} are "
           f"{c.record(row.wins, row.losses)} with a differential of "
           f"{c.n(row.point_differential)} across "
           f"{c.plural(row.games_played, 'game')}." if row and team_id else
           "the standings have the final word.")
        + " On the second, he has been available for "
        f"{c.plural(leader.games, 'game')} of a season still running."
    )

    return [Story(
        headline=headline,
        subheadline=(
            f"{player.name} is averaging "
            f"{c.n(leader.per_game('points'), '.1f')} points through "
            f"{c.plural(leader.games, 'game')}."
        ),
        category=MVP_RACE,
        importance=held(ANCHOR[MVP_RACE]),
        summary=(
            f"{player.name} leads the league at "
            f"{c.n(leader.per_game('points'), '.1f')} points a game."
        ),
        article=paragraphs(body_one, body_two, body_three),
        id=story_id,
        day=room.latest_day,
        team_ids=tuple(t for t in (team_id,) if t),
        player_ids=(leader.player_id,),
        figures=frozenset(c.recorded),
    )]


def mvp_columns(room: Newsroom) -> list[Story]:
    """The voting panel's columnists, adapted into feed stories.

    A thin adapter and nothing more. The argument, the numbers and the figure
    audit all happen in `bballsim/mvp.py`, which is where the ballots live --
    a column is a voter explaining his own ballot, so it belongs beside the
    ballot rather than in the newsroom's own detector list.
    """
    from . import mvp

    stories: list[Story] = []
    for piece in mvp.columns(room.league):
        stories.append(Story(
            headline=piece["headline"],
            subheadline=piece["subheadline"],
            category=MVP_COLUMN,
            # A dissenting column is the more interesting read, so it outranks
            # one that agrees with the board everybody can already see.
            importance=held(ANCHOR[MVP_COLUMN] + (6 if piece["dissenting"] else 0)),
            summary=piece["summary"],
            article=piece["article"],
            id=piece["id"],
            team_ids=tuple(piece["teamIds"]),
            player_ids=tuple(piece["playerIds"]),
            figures=piece["figures"],
        ))
    return stories


def coaching(room: Newsroom) -> list[Story]:
    """Who is getting the most out of a bench.

    No firings, no hirings, no rumours: the simulation has no coaching market,
    so this reports the record of the club at the top of the table and the
    coach who has it there.
    """
    rows = [
        (team_id, row) for team_id, row in room.league.standings.items()
        if row.games_played > 0
    ]
    if len(rows) < 4:
        return []
    team_id, row = max(rows, key=lambda pair: (pair[1].win_pct, pair[1].point_differential))
    team = room.team(team_id)
    coach = team.coach if team else None
    if coach is None:
        return []

    c = Copy()
    story_id = f"coach-{team_id}-{row.games_played}"
    headline = pick([
        f"{coach.name} has {room.nickname(team_id)} atop the league",
        f"Best record in the league belongs to {coach.name}'s "
        f"{room.nickname(team_id)}",
        f"{room.club(team_id)} lead the way under {coach.name}",
    ], story_id)

    body_one = (
        f"{room.club(team_id)} hold the league's best record at "
        f"{c.record(row.wins, row.losses)}, a differential of "
        f"{c.n(row.point_differential)} across "
        f"{c.plural(row.games_played, 'game')} under {coach.name}. They have scored "
        f"{c.n(row.points_for)} and conceded {c.n(row.points_against)}."
    )
    body_two = (
        f"{coach.name} rates {c.n(round(coach.ratings.offense))} for offence and "
        f"{c.n(round(coach.ratings.defense))} for defence on a hundred-point scale, "
        f"with tactics at {c.n(round(coach.ratings.tactics))}, player development at "
        f"{c.n(round(coach.ratings.development))}, leadership at "
        f"{c.n(round(coach.ratings.leadership))} and an eye for talent rated "
        f"{c.n(round(coach.ratings.talent_evaluation))}. His overall reputation "
        f"stands at {c.n(round(coach.ratings.reputation))}."
    )
    team_line = room.league.stats.teams.get(team_id)
    if team_line is not None:
        body_two += (
            f" His side average {c.n(team_line.per_game('points'), '.1f')} points on "
            f"{c.n(team_line.fg_pct * 100, '.1f')}% shooting, with "
            f"{c.n(team_line.per_game('assists'), '.1f')} assists and "
            f"{c.n(team_line.per_game('turnovers'), '.1f')} turnovers a game."
        )
    best = max(
        (l for l in room.league.stats.players.values()
         if room.player_team(l.player_id) == team_id and l.games > 0),
        key=lambda l: l.per_game("points"), default=None,
    )
    body_three_parts = []
    if best is not None:
        top_player = room.player(best.player_id)
        if top_player is not None:
            body_three_parts.append(
                f"{top_player.name} leads them at "
                f"{c.n(best.per_game('points'), '.1f')} points a game."
            )
    body_three_parts.append(
        "Coaching in this league is worth a handful of points a night rather than "
        "a roster's worth, which is exactly why a record like this one gets read "
        "as evidence about the players first and the bench second. What a coach "
        "reliably moves is the margin — and over a season, margins are what "
        "separate the top of a table from the middle of it."
    )
    body_three = " ".join(body_three_parts)

    return [Story(
        headline=headline,
        subheadline=(
            f"{room.club(team_id)} are {c.record(row.wins, row.losses)} with the "
            f"league's best mark."
        ),
        category=COACHING,
        importance=held(ANCHOR[COACHING]),
        summary=(
            f"{coach.name}'s {room.club(team_id)} own the league's best record at "
            f"{c.record(row.wins, row.losses)}."
        ),
        article=paragraphs(body_one, body_two, body_three),
        id=story_id,
        day=room.latest_day,
        team_ids=(team_id,),
        figures=frozenset(c.recorded),
    )]


def league_news(room: Newsroom) -> list[Story]:
    """The night in aggregate: how many games, how they went."""
    tonight = room.tonight()
    if len(tonight) < 2:
        return []
    c = Copy()
    story_id = f"league-{room.latest_day}-{len(tonight)}"
    total_points = sum(n.home_score + n.away_score for n in tonight)
    margins = sorted(n.margin for n in tonight)
    overtimes = sum(1 for n in tonight if n.overtime)
    closest = min(tonight, key=lambda n: n.margin)
    widest = max(tonight, key=lambda n: n.margin)

    # "0 into overtime" is not a headline, so that framing is only on the table
    # on a night that actually produced one.
    options = [
        f"Around the league: {c.plural(len(tonight), 'game')} on the slate",
        f"The night in full: {c.plural(len(tonight), 'result')}",
        f"{c.plural(len(tonight), 'game')}, and a median margin of "
        f"{c.n(margins[len(margins) // 2])}",
    ]
    if overtimes:
        options.append(
            f"{c.plural(len(tonight), 'game')}, {c.n(overtimes)} of them "
            f"into overtime"
        )
    headline = pick(options, story_id)

    body_one = (
        f"{c.plural(len(tonight), 'game')} were played, producing "
        f"{c.plural(total_points, 'point')} between them — an average of "
        f"{c.n(total_points / (len(tonight) * 2), '.1f')} a team."
        + (f" {c.plural(overtimes, 'game')} needed overtime." if overtimes else "")
    )
    highest = max(tonight, key=lambda n: n.home_score + n.away_score)
    body_two = (
        f"The closest finish was {possessive(room.club(closest.winner_id))} "
        f"{c.score(closest.winning_score, closest.losing_score)} win over "
        f"{room.club(closest.loser_id)}, decided by "
        f"{c.plural(closest.margin, 'point')}. The widest was "
        f"{possessive(room.club(widest.winner_id))} "
        f"{c.score(widest.winning_score, widest.losing_score)} result against "
        f"{room.club(widest.loser_id)}, a "
        f"{c.n(widest.margin)}-point margin. The highest-scoring game of "
        f"the night was {room.club(highest.winner_id)} against "
        f"{room.club(highest.loser_id)}, which produced "
        f"{c.plural(highest.home_score + highest.away_score, 'point')} between them."
    )

    best = max(
        (l for n in tonight for lines in n.lines.values() for l in lines),
        key=lambda l: l.points, default=None,
    )
    board = max(
        (l for n in tonight for lines in n.lines.values() for l in lines),
        key=lambda l: l.rebounds, default=None,
    )
    body_three_parts = []
    if best is not None and board is not None:
        body_three_parts.append(
            f"{best.name} was the night's leading scorer with "
            f"{c.plural(best.points, 'point')}, and {board.name} its leading "
            f"rebounder with {c.plural(board.rebounds, 'board')}."
        )
    body_three_parts.append(
        (f"{c.plural(overtimes, 'game')} of the {c.n(len(tonight))} went to "
         f"overtime. " if overtimes else "")
        + f"The median margin was "
        f"{c.plural(margins[len(margins) // 2], 'point')} against a mean of "
        f"{c.n(sum(margins) / len(margins), '.1f')}, with the night's results "
        f"running from {c.n(margins[0])} to {c.n(margins[-1])}. That spread is the "
        f"number worth watching across a season rather than any single scoreline: a "
        f"league where the middle game is decided by twenty has a competitive "
        f"balance problem no amount of scoring hides, and one where it is "
        f"decided by three has a schedule worth watching every night."
    )
    body_three = " ".join(body_three_parts)

    return [Story(
        headline=headline,
        subheadline=(
            f"{c.plural(len(tonight), 'game')} produced "
            f"{c.plural(total_points, 'point')} and a median margin of "
            f"{c.plural(margins[len(margins) // 2], 'point')}."
        ),
        category=LEAGUE_NEWS,
        importance=held(ANCHOR[LEAGUE_NEWS] + (5 if overtimes else 0)),
        summary=(
            f"{c.plural(len(tonight), 'game')} were played, with a median margin "
            f"of {c.plural(margins[len(margins) // 2], 'point')}."
        ),
        article=paragraphs(body_one, body_two, body_three),
        id=story_id,
        day=room.latest_day,
        figures=frozenset(c.recorded),
    )]


# --------------------------------------------------------------------------
# The desk: run the detectors, rank, and hand back a feed.
# --------------------------------------------------------------------------

# How far back the feed looks. A home page is about tonight; a story from three
# weeks ago is history, and the standings already tell it better.
RECENT_DAYS = 3

# How many of each category the feed will carry.
#
# This is the difference between a news page and a log. Ranking purely by
# importance sounds right and reads terribly: a night's slate is 45 games, the
# league produces about 126 triple-doubles a season, and every one of them
# scores 90 -- so the whole front page fills with the same story told six
# times before anything else gets a look in. Capping the common categories
# forces the page to spend its slots on different kinds of news.
CATEGORY_LIMIT = {
    TRIPLE_DOUBLE: 2,
    SEASON_HIGH: 2,
    BIG_GAME: 2,
    MILESTONE: 2,
    ROOKIE_WATCH: 2,
    HOT_STREAK: 2,
    GAME_RECAP: 3,
    MVP_RACE: 1,
    # Two at a time. Ten writers on the same race in one morning is a wall,
    # not a feed, and the rotation in `mvp.columns` brings the rest round.
    MVP_COLUMN: 2,
    COACHING: 1,
    LEAGUE_NEWS: 1,
    POWER_RANKINGS: 2,
}

# Slots held back from the ranking.
#
# Caps alone are not enough. Individual performances score highest by
# construction, and six categories of them at a cap of two fill a twelve-story
# page exactly -- so the scoring race, the night's results and the state of the
# table never appear, however long the season runs. These four are the stories
# that tell a reader where the season is rather than what happened last night,
# and the page keeps room for them.
RESERVED_FOR = (GAME_RECAP, POWER_RANKINGS, MVP_RACE, MVP_COLUMN, LEAGUE_NEWS,
                COACHING)


def write_stories(league, limit: int = 12) -> list[Story]:
    """The home page feed: the most newsworthy things that have happened.

    Ranked by importance, then recency, then id, so the order is stable across
    runs -- and then filtered three ways, because ranking alone does not make a
    front page:

      * **One angle per player.** A 40-point season high is also a big game and
        may also be a milestone. The detectors overlap deliberately so the best
        framing wins; printing all three is how a feed announces it was
        generated.
      * **One story per game.** If a game is already covered by a performance,
        its recap adds nothing.
      * **A ceiling per category**, so the page carries a mix rather than six
        of whatever was most common last night.
    """
    room = Newsroom(league=league)
    if not room.nights:
        return []

    recent_days = sorted({n.day for n in room.nights})[-RECENT_DAYS:]
    stories: list[Story] = []
    for night in room.nights:
        if night.day not in recent_days:
            continue
        stories.extend(triple_doubles(room, night))
        stories.extend(season_highs(room, night))
        stories.extend(big_games(room, night))
        stories.extend(milestones(room, night))
        stories.extend(rookie_watch(room, night))
        stories.extend(recaps(room, night))
    stories.extend(streaks(room))
    stories.extend(power_moves(room))
    stories.extend(mvp_race(room))
    stories.extend(mvp_columns(room))
    stories.extend(coaching(room))
    stories.extend(league_news(room))

    stories.sort(key=lambda s: (-s.importance, -(s.day.toordinal() if s.day else 0), s.id))

    used: dict[str, int] = {}
    seen_players: set[str] = set()
    seen_games: set[str] = set()
    taken: set[str] = set()
    feed: list[Story] = []

    def take(story: Story) -> bool:
        if story.id in taken:
            return False
        if used.get(story.category, 0) >= CATEGORY_LIMIT.get(story.category, 1):
            return False
        if story.game_id and story.game_id in seen_games:
            return False
        if set(story.player_ids) & seen_players:
            return False
        feed.append(story)
        taken.add(story.id)
        used[story.category] = used.get(story.category, 0) + 1
        seen_players.update(story.player_ids)
        if story.game_id:
            seen_games.add(story.game_id)
        return True

    # First the ranked pass, but stopping short of the full page. Individual
    # performances score highest by design, and left to itself the ranking
    # spends every slot on them -- the season's shape, the scoring race and the
    # night's results never make the page at all.
    headline_slots = max(1, limit - len(RESERVED_FOR))
    for story in stories:
        if len(feed) >= headline_slots:
            break
        take(story)

    # Then the reserved slots: the best available story from each category that
    # gives the page context rather than another individual line.
    for category in RESERVED_FOR:
        if len(feed) >= limit:
            break
        for story in stories:
            if story.category == category and take(story):
                break

    # Anything still open goes back to the ranking.
    for story in stories:
        if len(feed) >= limit:
            break
        if story.id not in taken:
            take(story)

    feed.sort(key=lambda s: (-s.importance, -(s.day.toordinal() if s.day else 0), s.id))
    return feed


# --------------------------------------------------------------------------
# The offseason wire.
#
# A separate feed with a separate entry point, and the separation is the point.
# `write_stories` answers "what happened in the games"; between seasons there
# are no games, and the questions a manager has are about who is leaving, who
# has been paid and who has gone home. Folding these detectors into the
# in-season feed would put a retirement notice on the page in November.
#
# The rule from the top of this module still holds and is still enforced by
# `tests/test_news.py`: every figure below comes out of a contract, a career
# profile or a season line, and goes through `Copy` on its way to the page. A
# salary is a number like any other.
# --------------------------------------------------------------------------

# A retirement is worth writing about at all only if the career was. Below this
# many seasons a player leaving is a roster move, not a story, and thirty of
# them would bury the ones that matter.
RETIREMENT_SEASONS_FLOOR = 6

# Contracts worth a headline of their own. Everything smaller is aggregated
# into the summary story rather than given its own article.
BIG_CONTRACT = 20_000_000

# Imported by value rather than by module so the copy below reads as prose.
# It is the same constant `contracts` declares; there is no second cap.
from .contracts import SALARY_CAP as K_SALARY_CAP


def money(c: Copy, amount: int) -> str:
    """A salary, recorded so the audit can find it.

    `$12.4M` prints one numeral run, `12.4`, which is what has to be recorded --
    not the raw dollar figure, which never appears on the page. Going through
    here rather than through `negotiation.format_money` directly is what keeps
    a salary inside the same no-invented-numbers rule as a rebounding average.
    """
    if amount >= 1_000_000:
        return f"${c.n(amount / 1_000_000, '.1f')}M"
    # Below a million the formatter prints grouped digits, so every group has
    # to be recorded separately: "980,000" scans as two numeral runs.
    text = f"{amount:,}"
    for part in text.split(","):
        c.recorded.add(part)
    c.recorded.add(text)
    return f"${text}"


def _seasons_phrase(c: Copy, seasons: int) -> str:
    return c.plural(seasons, "season")


def retirements(league, offseason) -> list[Story]:
    """One article per career worth marking, from what `develop` recorded.

    The rows come from `OffseasonReport.retired`, which the progression engine
    fills in as it ages each player -- so every number here (age, seasons, the
    CA he finished on, the peak he reached) is measured rather than narrated.
    """
    stories: list[Story] = []
    rows = sorted(getattr(offseason, "retired", []),
                  key=lambda r: -float(r.get("peakCa", 0)))
    for row in rows:
        seasons = int(row.get("seasons", 0))
        if seasons < RETIREMENT_SEASONS_FLOOR:
            continue
        c = Copy()
        name = row.get("name", "")
        age = int(row.get("age", 0))
        peak = float(row.get("peakCa", 0.0))
        final = float(row.get("ca", 0.0))
        team_id = row.get("teamId", "")
        club = league.teams[team_id].name if team_id in league.teams else ""
        story_id = f"retire-{row.get('playerId', name)}"

        fell = max(0.0, peak - final)
        headline = pick([
            f"{name} retires after {_seasons_phrase(c, seasons)} in the league",
            f"{name} calls it a career at {c.n(age)}",
            f"After {_seasons_phrase(c, seasons)}, {name} steps away",
        ], story_id)

        peak_tier = ca_tier(peak).lower()
        final_tier = ca_tier(final).lower()
        # A player can finish level with his own peak. `peak_ca` is a running
        # maximum and it can only run from the moment his career profile
        # exists, which on a fresh league is the first simulated summer --
        # `progression.implied_peak` reconstructs what it can for a career
        # already under way, but for a veteran whose ceiling was always close
        # to his ability there is genuinely nothing to report.
        #
        # The threshold is a quarter of a tier rather than zero, because "a
        # decline of 1.2 points" over fourteen seasons is not a decline, it is
        # a rounding error dressed as one. Asserting a fall anyway produced the
        # worst sentence this module has written: "peaked well above where it
        # ended", two lines above "a decline of 0.0 points".
        declined = fell >= 3.0
        opening = (
            f"{name} has retired at {c.n(age)}, closing a career that ran "
            f"{_seasons_phrase(c, seasons)}. He finishes with "
            f"{possessive(club)} shirt the last he wore, and with "
            + ("a body of work that peaked well above where it ended — which "
               "is what " if declined else
               "his ability still where it topped out, which is rarer than "
               "the alternative after ")
            + f"{_seasons_phrase(c, seasons)} of professional basketball "
            + ("does to almost everybody who plays that long."
               if declined else "and is its own kind of achievement.")
        )
        middle = (
            f"He peaked at a current ability of {c.n(peak, '.1f')} on the "
            f"scouting scale, which rates as {peak_tier}, and ended on "
            f"{c.n(final, '.1f')} — {final_tier}."
            + (f" That is a decline of {c.n(fell, '.1f')} points from his "
               f"best, which is the ordinary shape of a long career rather "
               f"than a collapse." if declined else
               f" He was, by that measure, as good on the last day as on his "
               f"best one.")
            + f" The players who leave at their peak are usually the ones who "
              f"leave early, and he did not: he stayed until the game asked "
              f"him to stop, which is a different and harder way to finish."
        )
        closing = (
            f"Clubs will now work through a summer without him on the board. "
            f"His place on the {club} roster passes to whoever they take in "
            f"the intake, and a rookie arriving this year will be "
            f"{_seasons_phrase(c, seasons)} away from the career {name} has "
            f"just completed. Most will not get there. That is the measure of "
            f"what he did rather than any single number in the record."
        )
        stories.append(Story(
            headline=headline,
            subheadline=f"{name} leaves the game at {c.n(age)} after "
                        f"{_seasons_phrase(c, seasons)}.",
            category=RETIREMENT,
            importance=held(ANCHOR[RETIREMENT] + min(8, seasons - RETIREMENT_SEASONS_FLOOR)),
            summary=f"{name} has retired after {_seasons_phrase(c, seasons)}, "
                    f"peaking at {c.n(peak, '.1f')} current ability.",
            article=paragraphs(opening, middle, closing),
            id=story_id,
            team_ids=(team_id,) if team_id else (),
            player_ids=(row.get("playerId", ""),) if row.get("playerId") else (),
            figures=frozenset(c.recorded),
        ))
    return stories


def contract_stories(league, offseason) -> list[Story]:
    """The signings that were big enough to be news on their own."""
    stories: list[Story] = []
    signings = [s for s in getattr(offseason, "signings", [])
                if not s.is_coach and s.salary >= BIG_CONTRACT]
    signings.sort(key=lambda s: -s.salary)
    for signing in signings[:6]:
        c = Copy()
        club = (league.teams[signing.team_id].name
                if signing.team_id in league.teams else "")
        story_id = f"contract-{signing.holder_id}"
        total = signing.salary * signing.years

        headline = pick([
            f"{signing.name} re-signs with {club} on a "
            f"{c.plural(signing.years, 'year')} deal",
            f"{club} keep {signing.name} for {c.plural(signing.years, 'year')}",
            f"{signing.name} stays put on {money(c, signing.salary)} a year",
        ], story_id)

        share = signing.salary / K_SALARY_CAP * 100.0
        opening = (
            f"{signing.name} has agreed a new contract with {club} worth "
            f"{money(c, signing.salary)} a year over "
            f"{c.plural(signing.years, 'season')}, a total commitment of "
            f"{money(c, total)}. It takes up {c.n(share, '.1f')}% of the "
            f"salary cap on its own, which is the figure that matters more "
            f"than the total: a club is only ever spending one year at a time."
        )
        middle = (
            f"The deal was struck before free agency opened, which is where "
            f"a club's advantage over its own players lies. It gets to make "
            f"the first offer and the only one that does not have to beat "
            f"anybody else's, and a player weighing it up is comparing a "
            f"known club against an open market that has not made him an "
            f"offer yet. {club} used that advantage rather than waiting to "
            f"find out what somebody else thought he was worth."
        )
        closing = (
            f"At {money(c, signing.salary)} a season he becomes one of the "
            f"larger items on the {club} payroll, and the "
            f"{c.plural(signing.years, 'year')} run to the end of the deal "
            f"without an option on either side — no club option to walk away "
            f"early, no player option to leave. Both parties are committed "
            f"for the full term, which is the plainest kind of contract there "
            f"is and increasingly the rarest."
        )
        stories.append(Story(
            headline=headline,
            subheadline=f"{club} keep {signing.name} on "
                        f"{money(c, signing.salary)} a year.",
            category=CONTRACT,
            importance=held(ANCHOR[CONTRACT] + min(20, signing.salary // 3_000_000)),
            summary=f"{signing.name} signs for {c.plural(signing.years, 'season')} "
                    f"at {money(c, signing.salary)} a year.",
            article=paragraphs(opening, middle, closing),
            id=story_id,
            team_ids=(signing.team_id,),
            player_ids=(signing.holder_id,),
            figures=frozenset(c.recorded),
        ))
    return stories


def coach_stories(league, offseason) -> list[Story]:
    """Head coaches who signed again."""
    stories: list[Story] = []
    for signing in [s for s in getattr(offseason, "signings", []) if s.is_coach][:4]:
        c = Copy()
        club = (league.teams[signing.team_id].name
                if signing.team_id in league.teams else "")
        coach = getattr(league.teams.get(signing.team_id), "coach", None)
        story_id = f"coach-deal-{signing.holder_id}"
        tier = coach.tier if coach else ""
        specialism = coach.specialism.lower() if coach else ""

        headline = pick([
            f"{club} extend {signing.name} for {c.plural(signing.years, 'year')}",
            f"{signing.name} stays on the {club} bench",
            f"{club} keep faith with {signing.name}",
        ], story_id)

        seasons_in = getattr(coach, "seasons_coached", 0) if coach else 0
        opening = (
            f"{club} have agreed a new deal with head coach {signing.name}, "
            f"worth {money(c, signing.salary)} a year over "
            f"{c.plural(signing.years, 'season')}. He has "
            f"{_seasons_phrase(c, seasons_in)} in the job behind him, and the "
            f"club has decided it has seen enough of them to commit to more."
        )
        middle = (
            f"He is rated {tier.lower()} around the league and is known as a "
            f"{specialism}. Coaching is worth a handful of points a game "
            f"between the best in the league and the worst, which is small "
            f"enough that no coach carries a bad roster on his own and large "
            f"enough that a club does not change one lightly. The reputation "
            f"a coach carries is not the same thing as the work he does, "
            f"either — it lags what he is actually worth in both directions."
        )
        closing = (
            f"The {c.plural(signing.years, 'year')} take him beyond the "
            f"current cycle of the squad, which is the point of giving a "
            f"coach term: a man on an expiring deal manages for this season "
            f"and a man with three years left can afford to develop someone. "
            f"At {money(c, signing.salary)} a season the deal also sits "
            f"outside the salary cap calculation entirely — coaching pay has "
            f"never counted against it, and it never limits a signing."
        )
        stories.append(Story(
            headline=headline,
            subheadline=f"{signing.name} signs on for "
                        f"{c.plural(signing.years, 'more season')}.",
            category=COACH_MOVE,
            importance=held(ANCHOR[COACH_MOVE]),
            summary=f"{club} re-sign {signing.name} at "
                    f"{money(c, signing.salary)} a year.",
            article=paragraphs(opening, middle, closing),
            id=story_id,
            team_ids=(signing.team_id,),
            figures=frozenset(c.recorded),
        ))
    return stories


def free_agency_wire(league, offseason) -> list[Story]:
    """The summer in aggregate: who reached the market and who did not.

    The one story that is always worth writing, because it is the only place
    the *size* of the class gets stated. Individual signings do not add up to
    it on the page.
    """
    expected = list(getattr(offseason, "expected", []))
    if not expected:
        return []
    c = Copy()
    pool = list(getattr(offseason, "pool", []))
    signings = [s for s in getattr(offseason, "signings", []) if not s.is_coach]
    story_id = f"wire-{getattr(offseason, 'season', '')}-{len(expected)}"

    re_signed = len(signings)
    reached = len([e for e in pool if not e.is_coach])
    spent = sum(s.salary for s in signings)
    biggest = max(signings, key=lambda s: s.salary, default=None)

    headline = pick([
        f"{c.plural(len(expected), 'contract')} expired across the league",
        f"Summer business: {c.plural(re_signed, 'player')} re-signed",
        f"{c.plural(reached, 'player')} reach the open market",
    ], story_id)

    opening = (
        f"{c.plural(len(expected), 'player contract')} ran out at the end of "
        f"the season. Clubs re-signed {c.n(re_signed)} of them before free "
        f"agency opened; {c.n(reached)} went unsigned and are now available "
        f"to the rest of the league. That split is the whole story of a "
        f"summer in two numbers, and it is settled before a single rival "
        f"club is allowed to make an offer."
    )
    middle = (
        f"The re-signings committed {money(c, spent)} a year in new salary "
        f"between them."
        + (f" The largest was {biggest.name}, who agreed "
           f"{money(c, biggest.salary)} a season over "
           f"{c.plural(biggest.years, 'year')}." if biggest else "")
        + f" A club's own players are always the cheapest ones it can sign: "
          f"it makes the first offer, it makes the only offer that does not "
          f"have to beat anybody else's, and a player who wants to stay will "
          f"take less to do it. That is why the window before free agency is "
          f"where most of the business gets done."
    )
    closing = (
        f"The {c.plural(reached, 'player')} still without a club are the ones "
        f"whose sides decided the asking price was more than they were worth. "
        f"Every one of them was offered terms first, and every one of them "
        f"turned those terms down or was let go rather than matched. Their "
        f"old clubs keep the cap room instead, which is the trade a front "
        f"office is really making when it declines to match: not a player "
        f"against nothing, but a player against whoever that money signs next."
    )
    return [Story(
        headline=headline,
        subheadline=f"{c.n(re_signed)} re-signed, {c.n(reached)} reached the market.",
        category=FREE_AGENCY,
        importance=held(ANCHOR[FREE_AGENCY]),
        summary=f"{c.plural(len(expected), 'contract')} expired; "
                f"{c.n(re_signed)} were renewed.",
        article=paragraphs(opening, middle, closing),
        id=story_id,
        figures=frozenset(c.recorded),
    )]


def offseason_stories(league, limit: int = 12) -> list[Story]:
    """The League News page inside the OFFSEASON menu.

    Ranked and capped the same way the in-season feed is, and for the same
    reason: without a per-category ceiling a summer with nine retirements
    prints nine retirement notices and nothing else.
    """
    from .league import franchise

    offseason = getattr(league, "offseason", None)
    if offseason is None:
        return []

    stories: list[Story] = []
    stories.extend(retirements(league, offseason))
    stories.extend(free_agency_wire(league, offseason))
    stories.extend(contract_stories(league, offseason))
    stories.extend(coach_stories(league, offseason))
    stories.sort(key=lambda s: (-s.importance, s.id))

    caps = {RETIREMENT: 5, CONTRACT: 4, COACH_MOVE: 2, FREE_AGENCY: 1}
    used: dict[str, int] = {}
    feed: list[Story] = []
    for story in stories:
        if len(feed) >= limit:
            break
        if used.get(story.category, 0) >= caps.get(story.category, 2):
            continue
        feed.append(story)
        used[story.category] = used.get(story.category, 0) + 1
    return feed
