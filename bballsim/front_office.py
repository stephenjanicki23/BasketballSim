"""Who a club *is*: its identity, where it sits, and what its owner wants.

The premise of the whole trade system is that two clubs handed the same offer
should often answer differently, and that only works if a club is more than its
roster. So every franchise gets three things:

  **Identity** -- twelve hidden organisational traits, generated once and
  permanent. Aggressiveness, patience, risk tolerance, how much it trusts
  analytics, how loyal it is to its own players. These are the club's
  personality and they never change.

  **Timeline** -- which of eight competitive phases it is in, from Championship
  Favourite to Tanking. Derived from the standings and the roster, so it moves
  during a season: a club that starts 3-12 stops being a playoff team whatever
  it thought it was in October.

  **Window** -- a 0-100 score for how open its title chance is, blending roster
  strength, the age and contracts of its best players, its coach, and what it
  has in the cupboard.

Identity is *stored*, timeline and window are *derived*. That split is the
important one and it is the same one the rest of the project makes everywhere:
a trait is a fact about the club, a phase is a reading of a season.

**Owner goals come from identity plus results.** An owner who wanted a
championship and got 22 wins is not still asking for a championship in
February, and a GM who trades against the mandate is doing something the brief
explicitly forbids.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, fields
from enum import Enum

from . import contracts as K
from . import payroll
from .engine.rng import seed_from_string

TRAIT_AVERAGE = 50.0


def clamp(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------

@dataclass
class Identity:
    """Twelve hidden traits, 0-100. Generated once; never move.

    Every one is read somewhere -- an organisational trait that decorated a
    team page would be worse than none at all, so the docstring for each says
    which decision it changes.
    """

    # How readily it makes moves at all. Low aggressiveness sits on its hands.
    aggressiveness: float = TRAIT_AVERAGE
    # Willingness to accept variance: young players, injury risk, big swings.
    risk_tolerance: float = TRAIT_AVERAGE
    # How long it will wait. High patience rebuilds properly; low patience
    # panics and buys veterans.
    patience: float = TRAIT_AVERAGE
    # How much it believes it can raise a player's ceiling itself.
    development_focus: float = TRAIT_AVERAGE
    # Pressure to win *now*, independent of whether it can.
    championship_urgency: float = TRAIT_AVERAGE
    # How willing it is to take salary back.
    financial_flexibility: float = TRAIT_AVERAGE
    # How much it likes picks relative to players.
    draft_preference: float = TRAIT_AVERAGE
    # ...and how much it likes proven veterans relative to prospects.
    veteran_preference: float = TRAIT_AVERAGE
    # Whether it values efficiency and advanced production over reputation.
    analytics_focus: float = TRAIT_AVERAGE
    # How hard it is to persuade to trade its own players.
    loyalty: float = TRAIT_AVERAGE
    # How attractive the club is to outside players. Affects free agency
    # forecasting, not the value of what it already has.
    market_attractiveness: float = TRAIT_AVERAGE
    # How far above the tax line ownership will go.
    owner_spending: float = TRAIT_AVERAGE

    def __post_init__(self) -> None:
        for f in fields(self):
            setattr(self, f.name, clamp(getattr(self, f.name)))

    @classmethod
    def names(cls) -> list[str]:
        return [f.name for f in fields(cls)]

    def to_dict(self) -> dict:
        return {f.name: round(getattr(self, f.name), 1) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict) -> "Identity":
        known = set(cls.names())
        return cls(**{k: v for k, v in (data or {}).items() if k in known})

    @property
    def label(self) -> str:
        """What this front office is known as, in one phrase.

        Named from whichever trait is furthest from ordinary -- the same trick
        `Coach.specialism` uses -- and only when one actually is.
        """
        traits = (
            (self.aggressiveness, "Aggressive"),
            (self.patience, "Patient"),
            (self.analytics_focus, "Analytics-driven"),
            (self.draft_preference, "Asset-hoarding"),
            (self.veteran_preference, "Win-now"),
            (self.loyalty, "Loyal"),
            (self.risk_tolerance, "Risk-taking"),
            (self.development_focus, "Development-first"),
        )
        value, name = max(traits, key=lambda pair: pair[0])
        return name if value >= 66.0 else "Conventional"


# Archetypes. A front office is rarely balanced, so generation picks a leaning
# and spends above baseline there -- the same idea as `coach.COACH_PROFILES`,
# and for the same reason: it makes clubs different from each other rather
# than differently random.
IDENTITY_PROFILES: dict[str, dict[str, float]] = {
    "win_now": {"championship_urgency": 24, "veteran_preference": 18,
                "aggressiveness": 14, "patience": -22, "draft_preference": -18},
    "rebuilder": {"patience": 24, "draft_preference": 22,
                  "development_focus": 18, "championship_urgency": -24,
                  "veteran_preference": -20},
    "analytics": {"analytics_focus": 26, "draft_preference": 10,
                  "loyalty": -12, "veteran_preference": -8},
    "loyalist": {"loyalty": 26, "patience": 12, "aggressiveness": -14,
                 "risk_tolerance": -10},
    "gambler": {"risk_tolerance": 26, "aggressiveness": 20, "patience": -16,
                "financial_flexibility": 10},
    "frugal": {"owner_spending": -26, "financial_flexibility": -18,
               "draft_preference": 12, "veteran_preference": -10},
    "big_market": {"market_attractiveness": 26, "owner_spending": 20,
                   "championship_urgency": 12, "financial_flexibility": 14},
    "developer": {"development_focus": 24, "patience": 16,
                  "draft_preference": 12, "veteran_preference": -14},
    "balanced": {},
}


def generate(team_id: str) -> Identity:
    """A club's permanent identity, drawn from its id.

    Deterministic, so the league has the same thirty front offices every run
    and "Redstone never trade their own players" is a fact you can learn.
    """
    rng = random.Random(seed_from_string(f"front-office-{team_id}"))
    profile_name = rng.choice(sorted(IDENTITY_PROFILES))
    profile = IDENTITY_PROFILES[profile_name]
    values = {name: clamp(rng.gauss(TRAIT_AVERAGE + profile.get(name, 0.0), 13.0))
              for name in Identity.names()}
    return Identity(**values)


def identity(team) -> Identity:
    """The club's identity, generated and cached on first ask."""
    existing = getattr(team, "identity", None)
    if isinstance(existing, Identity):
        return existing
    made = generate(team.id)
    team.identity = made
    return made


# --------------------------------------------------------------------------
# Timeline
# --------------------------------------------------------------------------

class Timeline(str, Enum):
    """Where a club sits competitively. Ordered best to worst."""

    FAVOURITE = "favourite"
    CONTENDER = "contender"
    PLAYOFF = "playoff"
    PLAY_IN = "play_in"
    MIDDLE = "middle"
    SOFT_REBUILD = "soft_rebuild"
    FULL_REBUILD = "full_rebuild"
    TANKING = "tanking"

    @property
    def label(self) -> str:
        return {
            Timeline.FAVOURITE: "Championship Favourite",
            Timeline.CONTENDER: "Championship Contender",
            Timeline.PLAYOFF: "Playoff Team",
            Timeline.PLAY_IN: "Play-In Team",
            Timeline.MIDDLE: "Middle of the Pack",
            Timeline.SOFT_REBUILD: "Soft Rebuild",
            Timeline.FULL_REBUILD: "Full Rebuild",
            Timeline.TANKING: "Tanking",
        }[self]

    @property
    def phrase(self) -> str:
        """The label as it reads inside a sentence.

        `label` is a heading -- "Tanking", "Middle of the Pack" -- and dropping
        it into "we are a {label}" produces "we are a tanking". This is the
        form the explanation engine uses.
        """
        return {
            Timeline.FAVOURITE: "a championship favourite",
            Timeline.CONTENDER: "a championship contender",
            Timeline.PLAYOFF: "a playoff team",
            Timeline.PLAY_IN: "a play-in team",
            Timeline.MIDDLE: "a middle-of-the-pack team",
            Timeline.SOFT_REBUILD: "in a soft rebuild",
            Timeline.FULL_REBUILD: "in a full rebuild",
            Timeline.TANKING: "tanking",
        }[self]

    @property
    def buying(self) -> bool:
        """Whether this club is a buyer at the deadline."""
        return self in (Timeline.FAVOURITE, Timeline.CONTENDER, Timeline.PLAYOFF)

    @property
    def selling(self) -> bool:
        return self in (Timeline.SOFT_REBUILD, Timeline.FULL_REBUILD,
                        Timeline.TANKING)


def win_pct(league, team_id: str) -> float:
    for row in league.standings_table():
        if row.get("team_id") == team_id:
            played = row.get("wins", 0) + row.get("losses", 0)
            return row["wins"] / played if played else 0.5
    return 0.5


def conference_rank(league, team_id: str) -> int:
    for row in league.standings_table():
        if row.get("team_id") == team_id:
            return int(row.get("conference_rank", 8))
    return 8


# How a rotation is weighted. Not a mean: the top eight decide games and the
# twelfth man does not, so this falls away sharply down the depth chart.
ROTATION_WEIGHTS = (1.0, 0.92, 0.84, 0.76, 0.68, 0.52, 0.42, 0.32, 0.20, 0.12)


def roster_talent(team) -> float:
    """The club's weighted rotation ability, on the raw 0-200 CA scale."""
    players = sorted(getattr(team, "players", []),
                     key=lambda p: -p.ability.current)[:len(ROTATION_WEIGHTS)]
    if not players:
        return 0.0
    total = sum(w for w, _ in zip(ROTATION_WEIGHTS, players))
    weighted = sum(w * p.ability.current
                   for w, p in zip(ROTATION_WEIGHTS, players))
    return weighted / total if total else 0.0


def roster_strength(league, team) -> float:
    """The club's talent as a 0-100 rank **against the rest of the league**.

    Relative, and it has to be. A first version returned raw ability halved,
    which put all thirty clubs between 64 and 68 -- every roster in a
    generated league is built to a similar budget, so the absolute number
    carries almost no information. The league read as nineteen contenders and
    eleven playoff teams with nobody rebuilding and no window above 80.

    What a front office actually knows is where it stands, so that is what this
    returns: the worst roster scores near 0, the best near 100, and the spread
    in between is real.
    """
    mine = roster_talent(team)
    others = [roster_talent(t) for t in getattr(league, "teams", {}).values()]
    if len(others) < 2:
        return TRAIT_AVERAGE
    low, high = min(others), max(others)
    if high - low < 1e-9:
        return TRAIT_AVERAGE
    return clamp((mine - low) / (high - low) * 100.0)


def timeline(league, team) -> Timeline:
    """Which phase this club is in, right now.

    Blends where it *is* (record) with what it *has* (roster), because a club
    that has started badly with a strong roster is not rebuilding, and one on a
    lucky run with nothing is not a contender. Early in a season the roster
    dominates, because fifteen games of record is noise; late on the record
    does, because by then it is the truth.
    """
    from .mvp import games_played

    done, scheduled = games_played(league)
    share = done / scheduled if scheduled else 0.0
    # How much to trust the standings over the roster.
    record_weight = min(1.0, share * 2.2)

    strength = roster_strength(league, team) / 100.0
    record = win_pct(league, team.id)
    blended = record * record_weight + strength * (1.0 - record_weight)

    ident = identity(team)
    # A club with no patience talks itself into contention; a patient one is
    # honest with itself sooner. Small, but it is what makes two clubs with the
    # same record behave differently.
    blended += (TRAIT_AVERAGE - ident.patience) / TRAIT_AVERAGE * 0.02

    if blended >= 0.70:
        return Timeline.FAVOURITE
    if blended >= 0.62:
        return Timeline.CONTENDER
    if blended >= 0.545:
        return Timeline.PLAYOFF
    if blended >= 0.495:
        return Timeline.PLAY_IN
    if blended >= 0.44:
        return Timeline.MIDDLE
    if blended >= 0.375:
        return Timeline.SOFT_REBUILD
    if blended >= 0.30:
        return Timeline.FULL_REBUILD
    return Timeline.TANKING


# --------------------------------------------------------------------------
# Championship window
# --------------------------------------------------------------------------

# What goes into the window, and how much. Roster strength dominates because
# it should: a club with no players has no window whatever else is true.
WINDOW_WEIGHTS = {
    "roster": 0.38,
    "star_age": 0.16,
    "star_contracts": 0.12,
    "conference": 0.12,
    "coach": 0.08,
    "flexibility": 0.08,
    "picks": 0.06,
}


def best_players(team, count: int = 3) -> list:
    return sorted(getattr(team, "players", []),
                  key=lambda p: -p.ability.current)[:count]


def _star_age_score(team) -> float:
    """100 when the best players are in their prime, falling either side.

    A window is about *time*, and a club whose stars are 33 has less of it than
    one whose stars are 27 even at identical strength today.
    """
    stars = best_players(team)
    if not stars:
        return 0.0
    ages = [p.age for p in stars]
    mean_age = sum(ages) / len(ages)
    if mean_age <= 24:
        return 74.0            # good, but the window is not open *yet*
    if mean_age <= 29:
        return 100.0 - (mean_age - 26.5) ** 2 * 4.0
    return max(10.0, 92.0 - (mean_age - 29) * 13.0)


def _star_contracts_score(team) -> float:
    """How long the best players are actually under contract for."""
    stars = best_players(team)
    if not stars:
        return 0.0
    years = []
    for player in stars:
        contract = getattr(player, "contract", None)
        years.append(float(getattr(contract, "years_remaining", 0) or 0))
    mean_years = sum(years) / len(years)
    return min(100.0, mean_years * 26.0)


def _coach_score(team) -> float:
    coach = getattr(team, "coach", None)
    if coach is None:
        return TRAIT_AVERAGE
    ratings = coach.ratings
    return clamp((ratings.offense + ratings.defense + ratings.tactics) / 3.0)


def _flexibility_score(team) -> float:
    """Cap room, as a window input rather than a constraint.

    A club hard against the tax cannot improve itself, which shortens a window
    even when the roster is strong -- that is the real-world cost of an
    expensive roster and it belongs here.
    """
    room = payroll.room_below_tax(team)
    if room >= 0:
        return min(100.0, 50.0 + room / K.SALARY_CAP * 130.0)
    return max(0.0, 50.0 + room / K.SALARY_CAP * 110.0)


def _picks_score(league, team) -> float:
    from . import draft_picks

    own = draft_picks.capital(league, team.id)
    # A full cupboard is roughly eight picks of ordinary value.
    return min(100.0, own / 22.0)


def _conference_score(league, team) -> float:
    """How hard this club's own conference is, **relative to the other one**.

    A 55-win team in the weaker conference has a better title chance than the
    same team in the stronger one, and a front office reasons about that
    explicitly.

    Comparative rather than absolute, and that took two goes to get right. The
    first version scored the top four's raw win percentage against a fixed
    scale and returned 8-13 for all thirty clubs -- a tenth of the window
    behaving as a constant. The second regressed toward .500, which is worse
    than it sounds: the top four of a conference average well above .500 *by
    definition*, so ".500 is weak" is not a scale, it is a fixed offset.

    What actually matters is which conference is harder, so this measures one
    against the other. Two evenly matched conferences both score 50, which is
    also the right answer in October when nobody knows.
    """
    try:
        table = league.standings_table()
    except Exception:
        return TRAIT_AVERAGE

    by_conference: dict[str, list[float]] = {}
    mine = None
    for row in table:
        conference = row.get("conference") or ""
        by_conference.setdefault(conference, []).append(row.get("win_pct", 0.5))
        if row.get("team_id") == team.id:
            mine = conference
    if not mine or len(by_conference) < 2:
        return TRAIT_AVERAGE

    def top_four(values: list[float]) -> float:
        best = sorted(values, reverse=True)[:4]
        return sum(best) / len(best) if best else 0.5

    ours = top_four(by_conference[mine])
    theirs = max(top_four(v) for key, v in by_conference.items() if key != mine)

    # A five-point gap in the top four's win percentage is a real difference
    # between conferences and moves this a quarter of the scale.
    return clamp(TRAIT_AVERAGE + (theirs - ours) * 500.0)


def window(league, team) -> float:
    """0-100: how open this club's title window is.

    Above 80 the brief says a club should be willing to mortgage its future,
    and `trades` reads it exactly that way.
    """
    parts = {
        "roster": roster_strength(league, team),
        "star_age": _star_age_score(team),
        "star_contracts": _star_contracts_score(team),
        "coach": _coach_score(team),
        "flexibility": _flexibility_score(team),
        "picks": _picks_score(league, team),
        "conference": _conference_score(league, team),
    }
    score = sum(parts[key] * weight for key, weight in WINDOW_WEIGHTS.items())

    # Urgency does not open a window, but it does change how a club behaves at
    # the edge of one. Small on purpose -- a club cannot want its way into
    # contention.
    ident = identity(team)
    score += (ident.championship_urgency - TRAIT_AVERAGE) * 0.06
    return clamp(score)


def window_breakdown(league, team) -> dict:
    """The window with its parts shown, for the explanation engine and the UI."""
    parts = {
        "roster": roster_strength(league, team),
        "star_age": _star_age_score(team),
        "star_contracts": _star_contracts_score(team),
        "coach": _coach_score(team),
        "flexibility": _flexibility_score(team),
        "picks": _picks_score(league, team),
        "conference": _conference_score(league, team),
    }
    return {
        "score": round(window(league, team), 1),
        "parts": {key: round(value, 1) for key, value in parts.items()},
        "weights": dict(WINDOW_WEIGHTS),
    }


# --------------------------------------------------------------------------
# Owner goals
# --------------------------------------------------------------------------

class OwnerGoal(str, Enum):
    CHAMPIONSHIP = "championship"
    CONFERENCE_FINALS = "conference_finals"
    PLAYOFFS = "playoffs"
    DEVELOP = "develop"
    CUT_PAYROLL = "cut_payroll"
    AVOID_TAX = "avoid_tax"
    SELL_TICKETS = "sell_tickets"

    @property
    def label(self) -> str:
        return {
            OwnerGoal.CHAMPIONSHIP: "Win the championship",
            OwnerGoal.CONFERENCE_FINALS: "Reach the conference finals",
            OwnerGoal.PLAYOFFS: "Make the playoffs",
            OwnerGoal.DEVELOP: "Develop the young players",
            OwnerGoal.CUT_PAYROLL: "Reduce payroll",
            OwnerGoal.AVOID_TAX: "Stay under the luxury tax",
            OwnerGoal.SELL_TICKETS: "Put a watchable team on the floor",
        }[self]


def owner_goals(league, team) -> list[OwnerGoal]:
    """What ownership is asking for. Usually one competitive goal and one
    financial one, which is where most of the tension comes from.

    Derived rather than assigned, so it moves with the season: an owner who
    wanted a title and got 22 wins is not still asking for one in February.
    """
    ident = identity(team)
    phase = timeline(league, team)
    goals: list[OwnerGoal] = []

    if phase is Timeline.FAVOURITE:
        goals.append(OwnerGoal.CHAMPIONSHIP)
    elif phase is Timeline.CONTENDER:
        goals.append(OwnerGoal.CHAMPIONSHIP if ident.championship_urgency >= 62
                     else OwnerGoal.CONFERENCE_FINALS)
    elif phase in (Timeline.PLAYOFF, Timeline.PLAY_IN):
        goals.append(OwnerGoal.PLAYOFFS)
    elif phase is Timeline.MIDDLE:
        goals.append(OwnerGoal.PLAYOFFS if ident.patience < 45
                     else OwnerGoal.DEVELOP)
    else:
        goals.append(OwnerGoal.DEVELOP)

    # The financial mandate. A frugal owner over the tax wants it fixed; a big
    # spender does not care.
    if payroll.over_tax(team) and ident.owner_spending < 62:
        goals.append(OwnerGoal.AVOID_TAX)
    elif payroll.player_payroll(team) > K.SALARY_CAP and ident.owner_spending < 35:
        goals.append(OwnerGoal.CUT_PAYROLL)

    if ident.market_attractiveness >= 68 and phase.selling:
        goals.append(OwnerGoal.SELL_TICKETS)
    return goals


@dataclass
class Situation:
    """Everything about a club that a trade decision reads, gathered once.

    Built per evaluation rather than stored, because every field is derived and
    a stale one would be a front office reasoning about last month's league.
    """

    team_id: str
    name: str
    identity: Identity
    timeline: Timeline
    window: float
    goals: list[OwnerGoal]
    payroll_total: int
    tax_room: int
    cap_room: int
    pick_capital: float
    roster_strength: float
    win_pct: float

    def to_dict(self) -> dict:
        return {
            "teamId": self.team_id,
            "name": self.name,
            "identity": self.identity.to_dict(),
            "identityLabel": self.identity.label,
            "timeline": self.timeline.value,
            "timelineLabel": self.timeline.label,
            "window": round(self.window, 1),
            "goals": [g.value for g in self.goals],
            "goalLabels": [g.label for g in self.goals],
            "payroll": self.payroll_total,
            "taxRoom": self.tax_room,
            "capRoom": self.cap_room,
            "pickCapital": round(self.pick_capital, 1),
            "rosterStrength": round(self.roster_strength, 1),
            "winPct": round(self.win_pct, 3),
            "buying": self.timeline.buying,
            "selling": self.timeline.selling,
        }


def _situation_key(league) -> tuple:
    """What a club's situation depends on, cheaply. Rosters and results."""
    played = sum(1 for g in getattr(league, "schedule", [])
                 if getattr(g, "result", None) is not None)
    return (played, tuple(sorted(
        (t.id, len(t.players), round(sum(p.ability.current for p in t.players), 1))
        for t in league.teams.values())))


def situation(league, team) -> Situation:
    """Everything a trade decision reads about one club.

    **Memoised on the league's roster-and-results state.** Every field is
    derived and most are expensive -- the window alone walks all thirty
    rosters, the whole pick inventory and the standings -- and the trade search
    asks for a situation twice per candidate offer, several hundred times over.
    Rebuilding it each time made a single club's search take ten seconds.

    The cache key is what the situation actually depends on, so it invalidates
    the moment a trade moves a player or another game finishes. It is not a
    stored situation; it is the same derivation, not repeated pointlessly.
    """
    key = _situation_key(league)
    cache = getattr(league, "_situation_cache", None)
    if cache is None or cache[0] != key:
        cache = (key, {})
        league._situation_cache = cache
    hit = cache[1].get(team.id)
    if hit is not None:
        return hit
    built = _build_situation(league, team)
    cache[1][team.id] = built
    return built


def _build_situation(league, team) -> Situation:
    from . import draft_picks

    return Situation(
        team_id=team.id,
        name=getattr(team, "full_name", team.id),
        identity=identity(team),
        timeline=timeline(league, team),
        window=window(league, team),
        goals=owner_goals(league, team),
        payroll_total=payroll.player_payroll(team),
        tax_room=payroll.room_below_tax(team),
        cap_room=payroll.room_below_cap(team),
        pick_capital=draft_picks.capital(league, team.id),
        roster_strength=roster_strength(league, team),
        win_pct=win_pct(league, team.id),
    )
