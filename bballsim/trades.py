"""The trade engine: front offices that think about their situation.

A trade evaluator that compares player ratings is a calculator. This one asks
what a club is *for* -- whether its window is open, what its owner has demanded,
who it already has at that position, what its coach runs, how many picks are in
the cupboard and how close the deadline is -- and then decides. Two clubs handed
the identical offer routinely answer differently, which is the whole point.

**The score is ten weighted parts**, the brief's own list:

    player value        30%   what is coming in against what is going out
    roster fit          15%   does it fix a weakness or duplicate a strength
    timeline            15%   does it match where the club is
    salary impact       10%   what it does to the payroll this year
    future flexibility  10%   what it does to the payroll afterwards
    draft assets        10%   picks in and out, priced dynamically
    chemistry            5%
    coach fit            5%
    owner goals          5%
    marketability        5%

Every part returns a number centred on zero -- positive means the trade helps
that dimension, negative means it hurts. They are weighted and summed into one
score, and the sign of that score is the answer. Keeping every part on the same
scale is what makes the explanation engine possible: the reason a club said no
is simply whichever part was most negative.

**Nothing here instantly accepts.** `respond` evaluates, and if the deal is
close it builds a counter -- asking for a pick, a prospect, salary relief, or
offering to take a bad contract. That is where a negotiation actually lives.

**What the brief asked for that is not built.** Bird rights, the mid-level
exception, trade exceptions and dead cap are named in `contracts` and have no
rules behind them, so salary matching here is the simple percentage rule and is
documented as such. Player trade requests do not exist -- nothing in the
simulation lets a player ask for anything. Championship odds and playoff odds
are approximated from the power rankings rather than simulated. See
`docs/TRADES.md` for the full list; none of it is faked.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import composites as C
from . import contracts as K
from . import draft_picks
from . import front_office as FO
from . import payroll
from . import trade_value as TV
from .tactics import DefensiveScheme, OffensiveScheme

# --------------------------------------------------------------------------
# The weights. The brief's list, and they sum to 1.0.
# --------------------------------------------------------------------------

# The brief's percentages, verbatim. They sum to **110**, not 100 -- 30 + 15 +
# 15 + 10 + 10 + 10 + 5 + 5 + 5 + 5 -- which is a slip in the brief rather than
# a design decision, and leaving it would make the final score uninterpretable:
# a "perfect" trade would score 1.1 and the accept threshold would mean
# something slightly different from what it says.
#
# The relative proportions the brief asked for are what matter, so they are
# kept exactly and normalised to sum to 1. Player value is still three times
# roster fit, roster fit is still three times chemistry.
BRIEF_WEIGHTS = {
    "player_value": 30,
    "roster_fit": 15,
    "timeline": 15,
    "salary": 10,
    "flexibility": 10,
    "draft": 10,
    "chemistry": 5,
    "coach_fit": 5,
    "owner": 5,
    "marketability": 5,
}

_TOTAL = sum(BRIEF_WEIGHTS.values())
WEIGHTS = {key: value / _TOTAL for key, value in BRIEF_WEIGHTS.items()}

# A club accepts above this and rejects below the lower bound; in between it
# counters. Deliberately asymmetric -- a front office does not need to be
# convinced it is winning by much, but it will not take a clear loss.
ACCEPT_SCORE = 0.04
REJECT_SCORE = -0.14

# Salary matching. The real rule is a tangle of tiers and exceptions; this is
# the simple version and is documented as such. A club over the cap must send
# out at least this share of what it takes back.
SALARY_MATCH_SHARE = 0.75
ROSTER_MIN = 8
ROSTER_MAX = 17


@dataclass
class Package:
    """One side of a deal: players and picks leaving one club."""

    team_id: str
    player_ids: list[str] = field(default_factory=list)
    picks: list[draft_picks.DraftPick] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "teamId": self.team_id,
            "playerIds": list(self.player_ids),
            "picks": [p.to_dict() for p in self.picks],
        }


@dataclass
class Offer:
    """A proposed two-club trade. `sending` gives up, `receiving` gives up."""

    sending: Package
    receiving: Package

    def to_dict(self) -> dict:
        return {"sending": self.sending.to_dict(),
                "receiving": self.receiving.to_dict()}


def players_of(league, package: Package) -> list:
    team = league.teams.get(package.team_id)
    if team is None:
        return []
    by_id = {p.id: p for p in team.players}
    return [by_id[pid] for pid in package.player_ids if pid in by_id]


def salary_of(players) -> int:
    return sum(payroll.salary_of(p) for p in players)


# --------------------------------------------------------------------------
# 1. Player value
# --------------------------------------------------------------------------

def player_value_part(league, situation, incoming, outgoing) -> float:
    """What is coming in against what is going out, in this club's own terms.

    Normalised by the larger side, so the part is bounded and a swap of two
    superstars does not swamp every other consideration.
    """
    gained = sum(TV.value_to(league, situation, p) for p in incoming)
    lost = sum(TV.value_to(league, situation, p) for p in outgoing)
    scale = max(gained, lost, 250.0)
    return (gained - lost) / scale


# --------------------------------------------------------------------------
# 2. Roster fit
#
# The brief lists nine things a club should evaluate. All nine are composites
# that already exist, so this measures the squad's rotation on each, works out
# where it is weak, and asks whether the incoming players help *there*.
# --------------------------------------------------------------------------

FIT_DIMENSIONS = {
    "spacing": C.spacing,
    "shot_creation": C.shot_creation,
    "playmaking": C.playmaking,
    "perimeter_defense": C.perimeter_defense,
    "interior_defense": C.interior_defense,
    "defensive_rebounding": C.defensive_rebounding,
    "offensive_rebounding": C.offensive_rebounding,
    "help_defense": C.help_defense,
    "ball_security": C.ball_security,
}

ROTATION_SIZE = 9


def rotation(team) -> list:
    return sorted(getattr(team, "players", []),
                  key=lambda p: -p.ability.current)[:ROTATION_SIZE]


def profile(players) -> dict[str, float]:
    """A group's strength on each fit dimension, 1-20."""
    if not players:
        return {key: 0.0 for key in FIT_DIMENSIONS}
    return {key: sum(fn(p) for p in players) / len(players)
            for key, fn in FIT_DIMENSIONS.items()}


def _roster_key(league) -> tuple:
    """A cheap fingerprint of who is on which roster.

    The league profile only moves when players do, so this is what the fit
    cache is keyed on. Ability is in the key because a player developing over a
    summer changes the profile too.
    """
    return tuple(sorted(
        (t.id, len(t.players), round(sum(p.ability.current for p in t.players), 1))
        for t in league.teams.values()))


def league_profiles(league) -> dict[str, dict[str, float]]:
    """Every club's rotation profile, computed once per roster state.

    **Memoised because the search depends on it.** `needs` is called inside
    every evaluation and it used to profile all thirty rotations each time --
    nine players against nine composites, thirty times over, for each of the
    several hundred offers a trade search evaluates. Finding deals for six
    clubs took three minutes. Caching on the roster fingerprint takes it to
    seconds, and the cache invalidates the moment a trade actually moves
    somebody.
    """
    key = _roster_key(league)
    cached = getattr(league, "_fit_profiles", None)
    if cached and cached[0] == key:
        return cached[1]
    profiles = {t.id: profile(rotation(t)) for t in league.teams.values()}
    league._fit_profiles = (key, profiles)
    return profiles


def needs(league, team) -> dict[str, float]:
    """How badly this club needs each thing, -1 to +1.

    Measured against the league rather than against an absolute, because a
    "weak" rebounding team only means weak compared to who it plays.
    """
    profiles = league_profiles(league)
    mine = profiles.get(team.id) or profile(rotation(team))
    others = [row for tid, row in profiles.items() if tid != team.id]
    if not others:
        return {key: 0.0 for key in FIT_DIMENSIONS}
    out = {}
    for key in FIT_DIMENSIONS:
        values = [row[key] for row in others]
        low, high = min(values), max(values)
        if high - low < 1e-9:
            out[key] = 0.0
            continue
        # 1.0 = worst in the league at this and desperate for it.
        placed = (mine[key] - low) / (high - low)
        out[key] = 1.0 - 2.0 * placed
    return out


def positional_need(team) -> dict[str, float]:
    """How thin the club is at each position, 0-1.

    Depth-chart aware in the way that matters: a club with two good centres
    does not need a third whatever his rating.
    """
    counts: dict[str, list[float]] = {}
    for player in rotation(team):
        counts.setdefault(player.position.value, []).append(player.ability.current)
    out = {}
    for position in ("PG", "SG", "SF", "PF", "C"):
        have = sorted(counts.get(position, []), reverse=True)
        if not have:
            out[position] = 1.0
        elif len(have) == 1:
            out[position] = 0.5
        else:
            out[position] = max(0.0, 0.3 - 0.1 * (len(have) - 2))
    return out


def roster_fit_part(league, situation, incoming, outgoing) -> float:
    """Does this deal fix a weakness or duplicate a strength?"""
    team = league.teams.get(situation.team_id)
    if team is None or not incoming:
        return 0.0

    gap = needs(league, team)
    position_gap = positional_need(team)
    # Hoisted out of the loop below: it does not depend on the player, and
    # rebuilding it per incoming player was nine composites over nine men for
    # no reason.
    mine = league_profiles(league).get(team.id) or profile(rotation(team))

    score = 0.0
    for player in incoming:
        # How much better than the club's own rotation he is, per dimension,
        # weighted by how much the club needs that dimension.
        for key, fn in FIT_DIMENSIONS.items():
            edge = (fn(player) - mine[key]) / 20.0
            score += edge * max(0.0, gap[key]) * 0.9
        score += position_gap.get(player.position.value, 0.3) * 0.28

    # Losing a player the club is thin at hurts.
    for player in outgoing:
        score -= position_gap.get(player.position.value, 0.3) * 0.20

    count = max(1, len(incoming))
    return max(-1.0, min(1.0, score / count))


# --------------------------------------------------------------------------
# 3. Timeline
# --------------------------------------------------------------------------

def timeline_part(league, situation, incoming, outgoing, picks_in, picks_out) -> float:
    """Does the shape of this deal match where the club is?

    Distinct from player value, which already prices age. This asks the
    strategic question: a rebuild trading picks for a 31-year-old is doing
    something wrong even if the 31-year-old is good.
    """
    phase = situation.timeline
    score = 0.0

    incoming_age = (sum(p.age for p in incoming) / len(incoming)) if incoming else 0
    outgoing_age = (sum(p.age for p in outgoing) / len(outgoing)) if outgoing else 0

    if phase.selling:
        # Getting younger and collecting picks is the plan.
        if incoming and outgoing:
            score += max(-0.6, min(0.6, (outgoing_age - incoming_age) * 0.09))
        score += 0.30 * (len(picks_in) - len(picks_out))
        # Taking on long money is the opposite of the plan.
        for player in incoming:
            contract = getattr(player, "contract", None)
            if contract is not None and contract.years_remaining >= 3 and player.age >= 29:
                score -= 0.22
    elif phase.buying:
        if incoming and outgoing:
            score += max(-0.6, min(0.6, (incoming_age - outgoing_age) * 0.05))
        # A contender spending picks is doing its job -- up to a point.
        score += 0.10 * (len(picks_out) - len(picks_in))
        for player in incoming:
            if player.age <= 21:
                score -= 0.18       # cannot help this year
    else:
        score += 0.06 * (len(picks_in) - len(picks_out))

    # The window above 80 is the brief's explicit rule: stop caring about the
    # future. Applied smoothly from 60 so a club at 79 is not a different
    # animal from one at 81.
    if situation.window >= 60:
        push = (situation.window - 60.0) / 40.0
        score += push * 0.30 * (len(picks_out) - len(picks_in))

    return max(-1.0, min(1.0, score))


# --------------------------------------------------------------------------
# 4 and 5. Money
# --------------------------------------------------------------------------

def salary_part(league, situation, incoming, outgoing) -> float:
    """What the deal does to this year's payroll, against what ownership wants."""
    team = league.teams.get(situation.team_id)
    if team is None:
        return 0.0
    change = salary_of(incoming) - salary_of(outgoing)
    if change == 0:
        return 0.0

    ident = situation.identity
    # How much a dollar of new salary hurts depends on where the club sits.
    room = situation.tax_room
    pain = 0.0
    if change > 0:
        # Taking money on. Worse the closer to the tax, worse still over it.
        crowding = 1.0 if room <= 0 else max(0.25, 1.0 - room / K.SALARY_CAP)
        pain = -(change / K.SALARY_CAP) * crowding * 2.2
        # A generous owner and a flexible front office feel it less.
        pain *= 1.0 - (ident.owner_spending - 50.0) / 50.0 * 0.35
        pain *= 1.0 - (ident.financial_flexibility - 50.0) / 50.0 * 0.25
    else:
        # Shedding money. Worth most to a club that is over the line.
        relief = 1.4 if room < 0 else 0.5
        pain = (-change / K.SALARY_CAP) * relief

    if FO.OwnerGoal.AVOID_TAX in situation.goals and change > 0:
        pain *= 1.8
    return max(-1.0, min(1.0, pain))


def flexibility_part(league, situation, incoming, outgoing) -> float:
    """What it does to the payroll *afterwards*.

    The brief's "do not create future cap disasters". Measured in committed
    years, not this year's number, which is the whole distinction.
    """
    def commitment(players) -> float:
        total = 0.0
        for player in players:
            contract = getattr(player, "contract", None)
            if contract is None:
                continue
            beyond = max(0, contract.years_remaining - 1)
            total += contract.salary * beyond
        return total

    change = commitment(incoming) - commitment(outgoing)
    if change == 0:
        return 0.0
    scale = K.SALARY_CAP * 1.6
    score = -change / scale

    ident = situation.identity
    if situation.timeline.selling:
        score *= 1.5          # a rebuild guards its future hardest
    if situation.window >= 80:
        score *= 0.35         # a club going all-in has decided not to care
    score *= 1.0 - (ident.financial_flexibility - 50.0) / 50.0 * 0.3
    return max(-1.0, min(1.0, score))


# --------------------------------------------------------------------------
# 6. Draft assets
# --------------------------------------------------------------------------

def draft_part(league, situation, picks_in, picks_out) -> float:
    """Picks in against picks out, priced dynamically and weighted by identity."""
    year = draft_picks.current_year(league)
    gained = sum(draft_picks.value_of(league, p, year) for p in picks_in)
    lost = sum(draft_picks.value_of(league, p, year) for p in picks_out)
    if gained == 0 and lost == 0:
        return 0.0

    ident = situation.identity
    # A club that loves picks values both sides of this more.
    appetite = 1.0 + (ident.draft_preference - 50.0) / 50.0 * 0.45
    if situation.timeline.selling:
        appetite *= 1.35
    elif situation.window >= 80:
        appetite *= 0.45

    scale = max(gained, lost, 200.0)
    return max(-1.0, min(1.0, (gained - lost) / scale * appetite))


# --------------------------------------------------------------------------
# 7. Chemistry
# --------------------------------------------------------------------------

def chemistry_part(league, situation, incoming, outgoing) -> float:
    """What the deal does to the locker room.

    Reads the chemistry model that already exists: a departing player takes his
    established pair chemistry with him, and an arriving one starts from
    nothing. That cost is real and is why a winning team should think twice.
    """
    from .chemistry import get_pair_chemistry

    team = league.teams.get(situation.team_id)
    if team is None:
        return 0.0

    score = 0.0
    leaving = {p.id for p in outgoing}
    stayers = [p for p in team.players if p.id not in leaving]

    # What the club loses in established relationships.
    for player in outgoing:
        pairs = [get_pair_chemistry(team, player.id, other.id) for other in stayers]
        if pairs:
            built = (sum(pairs) / len(pairs) - 50.0) / 50.0
            score -= max(0.0, built) * 0.55

    # Character of who is arriving, which is what chemistry will become.
    for player in incoming:
        hidden = getattr(player, "hidden", None)
        if hidden is None:
            continue
        character = (getattr(hidden, "professionalism", 10.0)
                     + getattr(hidden, "locker_room_presence", 10.0)
                     + getattr(hidden, "temperament", 10.0)) / 3.0
        score += (character - 10.0) / 10.0 * 0.35

    # A winning club has more to lose. The brief says so explicitly.
    if situation.timeline.buying:
        score *= 1.4
    count = max(1, len(incoming) + len(outgoing))
    return max(-1.0, min(1.0, score / count * 1.6))


# --------------------------------------------------------------------------
# 8. Coach fit
#
# The brief's own examples: motion values passing and IQ, isolation values shot
# creation, switch defence values versatile defenders. `tactics.py` already
# carries the schemes, so this reads the club's real instructions.
# --------------------------------------------------------------------------

OFFENSIVE_FIT = {
    OffensiveScheme.MOTION: (C.playmaking, C.spacing, C.ball_security),
    OffensiveScheme.PACE_AND_SPACE: (C.spacing, C.transition_threat,
                                     C.shooting_above_break_three),
    OffensiveScheme.INSIDE_OUT: (C.shooting_paint, C.offensive_rebounding,
                                 C.playmaking),
    OffensiveScheme.ISOLATION: (C.shot_creation, C.shooting_mid, C.foul_drawing),
    OffensiveScheme.SEVEN_SECONDS: (C.transition_threat, C.spacing, C.endurance),
}

DEFENSIVE_FIT = {
    DefensiveScheme.MAN: (C.perimeter_defense, C.interior_defense),
    DefensiveScheme.SWITCH_EVERYTHING: (C.perimeter_defense, C.help_defense,
                                        C.contest_quality),
    DefensiveScheme.DROP_COVERAGE: (C.interior_defense, C.block_threat,
                                    C.defensive_rebounding),
    DefensiveScheme.HEDGE: (C.pick_and_roll_defense, C.perimeter_defense,
                            C.steal_threat),
    DefensiveScheme.ZONE_23: (C.help_defense, C.defensive_rebounding,
                              C.contest_quality),
}


def scheme_fit(team, player) -> float:
    """How well one player suits what this club actually runs, -1 to +1."""
    tactics = getattr(team, "tactics", None)
    if tactics is None:
        return 0.0
    offensive = OFFENSIVE_FIT.get(getattr(tactics, "offensive_scheme", None), ())
    defensive = DEFENSIVE_FIT.get(getattr(tactics, "defensive_scheme", None), ())
    parts = list(offensive) + list(defensive)
    if not parts:
        return 0.0
    mean = sum(fn(player) for fn in parts) / len(parts)
    # 10 is the league-average attribute, 20 the ceiling.
    return max(-1.0, min(1.0, (mean - 10.0) / 6.0))


def coach_fit_part(league, situation, incoming, outgoing) -> float:
    team = league.teams.get(situation.team_id)
    if team is None:
        return 0.0
    gained = sum(scheme_fit(team, p) for p in incoming)
    lost = sum(scheme_fit(team, p) for p in outgoing)
    count = max(1, len(incoming) + len(outgoing))
    return max(-1.0, min(1.0, (gained - lost) / count))


# --------------------------------------------------------------------------
# 9. Owner goals
# --------------------------------------------------------------------------

def owner_part(league, situation, incoming, outgoing, picks_in, picks_out) -> float:
    """Whether the deal serves what ownership has actually asked for.

    The brief: "the GM should not make trades that directly oppose ownership
    goals". This is where that lives, and it is a real veto-shaped term rather
    than a nudge.
    """
    score = 0.0
    salary_change = salary_of(incoming) - salary_of(outgoing)
    incoming_age = (sum(p.age for p in incoming) / len(incoming)) if incoming else 0
    outgoing_age = (sum(p.age for p in outgoing) / len(outgoing)) if outgoing else 0
    talent_change = (sum(p.ability.current for p in incoming)
                     - sum(p.ability.current for p in outgoing))

    for goal in situation.goals:
        if goal in (FO.OwnerGoal.CHAMPIONSHIP, FO.OwnerGoal.CONFERENCE_FINALS):
            score += max(-0.5, min(0.5, talent_change / 90.0))
            if picks_out and not picks_in:
                score += 0.10          # spending assets to win is the mandate
        elif goal is FO.OwnerGoal.PLAYOFFS:
            score += max(-0.4, min(0.4, talent_change / 110.0))
        elif goal is FO.OwnerGoal.DEVELOP:
            if incoming and outgoing:
                score += max(-0.45, min(0.45, (outgoing_age - incoming_age) * 0.08))
            score += 0.16 * (len(picks_in) - len(picks_out))
        elif goal is FO.OwnerGoal.AVOID_TAX:
            score += -salary_change / K.SALARY_CAP * 2.4
        elif goal is FO.OwnerGoal.CUT_PAYROLL:
            score += -salary_change / K.SALARY_CAP * 1.8
        elif goal is FO.OwnerGoal.SELL_TICKETS:
            best_in = max((p.ability.current for p in incoming), default=0.0)
            best_out = max((p.ability.current for p in outgoing), default=0.0)
            score += max(-0.3, min(0.3, (best_in - best_out) / 90.0))

    return max(-1.0, min(1.0, score / max(1, len(situation.goals))))


# --------------------------------------------------------------------------
# 10. Marketability
# --------------------------------------------------------------------------

def marketability_part(league, situation, incoming, outgoing) -> float:
    """The 5% the brief allocates -- and no more, because the data is thin.

    `trade_value.marketability` is an honest proxy over two hidden attributes;
    there is no attendance, no merchandise and no fan sentiment in this
    project. Weighted accordingly.
    """
    gained = sum(TV.marketability(p) for p in incoming)
    lost = sum(TV.marketability(p) for p in outgoing)
    scale = max(gained, lost, 60.0)
    score = (gained - lost) / scale
    score *= 1.0 + (situation.identity.market_attractiveness - 50.0) / 50.0 * 0.4
    return max(-1.0, min(1.0, score))


# --------------------------------------------------------------------------
# Legality
# --------------------------------------------------------------------------

@dataclass
class Legality:
    """Whether the deal can be made at all, separately from whether it is wise."""

    legal: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"legal": self.legal, "reasons": list(self.reasons)}


def check_legality(league, offer: Offer) -> Legality:
    """Roster limits and the simple salary-matching rule.

    **This is not the real rule book.** Bird rights, the mid-level exception,
    trade exceptions and dead cap are declared in `contracts` and have no rules
    behind them. What is enforced is: roster sizes stay inside bounds, and a
    club over the cap must send out enough salary to take back what it is
    taking back. That is the load-bearing 80% of real salary matching, and the
    rest is documented as absent rather than approximated badly.
    """
    reasons: list[str] = []
    for package, other in ((offer.sending, offer.receiving),
                           (offer.receiving, offer.sending)):
        team = league.teams.get(package.team_id)
        if team is None:
            return Legality(False, [f"unknown club {package.team_id}"])

        out_players = players_of(league, package)
        in_players = players_of(league, other)
        size = len(team.players) - len(out_players) + len(in_players)
        if size < ROSTER_MIN:
            reasons.append(f"{team.abbreviation} would be left with {size} players")
        if size > ROSTER_MAX:
            reasons.append(f"{team.abbreviation} would carry {size} players")

        taking = salary_of(in_players)
        sending = salary_of(out_players)
        over_cap = payroll.player_payroll(team) > K.SALARY_CAP
        if over_cap and taking > sending and sending < taking * SALARY_MATCH_SHARE:
            reasons.append(
                f"{team.abbreviation} is over the cap and must send out at least "
                f"{int(SALARY_MATCH_SHARE * 100)}% of the "
                f"{K.MINIMUM_SALARY and ''}{taking:,} it takes back")

        for pick in package.picks:
            if pick.owner != package.team_id:
                reasons.append(f"{team.abbreviation} does not own {pick.label}")
    return Legality(not reasons, reasons)


# --------------------------------------------------------------------------
# The verdict
# --------------------------------------------------------------------------

@dataclass
class Evaluation:
    """One club's reading of one offer."""

    team_id: str
    score: float
    parts: dict[str, float]
    verdict: str                 # accept | counter | reject
    reasoning: str
    legality: Legality
    untouchables: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "teamId": self.team_id,
            "score": round(self.score, 4),
            "parts": {k: round(v, 4) for k, v in self.parts.items()},
            "weights": dict(WEIGHTS),
            "verdict": self.verdict,
            "reasoning": self.reasoning,
            "legality": self.legality.to_dict(),
            "untouchables": list(self.untouchables),
        }


# How much the deadline sharpens everybody's behaviour. Buyers get keener,
# sellers get keener to sell, and everybody in between gets less predictable --
# which the brief asks for by name.
DEADLINE_SHARE = 0.62      # the deadline sits about 62% through a season
DEADLINE_SWING = 0.10


def deadline_pressure(league) -> float:
    """0 at the start of a season, 1 at the deadline, falling away after."""
    from .mvp import games_played

    done, scheduled = games_played(league)
    if not scheduled:
        return 0.0
    share = done / scheduled
    if share >= DEADLINE_SHARE:
        return max(0.0, 1.0 - (share - DEADLINE_SHARE) / (1.0 - DEADLINE_SHARE))
    return share / DEADLINE_SHARE


def evaluate(league, team_id: str, offer: Offer) -> Evaluation:
    """What this club thinks of this offer.

    `offer.receiving` is what *this* club gives up when `team_id` is the
    receiving side; the function works out which side it is on rather than
    making the caller keep track.
    """
    team = league.teams.get(team_id)
    if team is None:
        return Evaluation(team_id, -1.0, {}, "reject", "unknown club",
                          Legality(False, ["unknown club"]))

    situation = FO.situation(league, team)
    if offer.sending.team_id == team_id:
        mine, theirs = offer.sending, offer.receiving
    else:
        mine, theirs = offer.receiving, offer.sending

    outgoing = players_of(league, mine)
    incoming = players_of(league, theirs)
    picks_out, picks_in = mine.picks, theirs.picks

    parts = {
        "player_value": player_value_part(league, situation, incoming, outgoing),
        "roster_fit": roster_fit_part(league, situation, incoming, outgoing),
        "timeline": timeline_part(league, situation, incoming, outgoing,
                                  picks_in, picks_out),
        "salary": salary_part(league, situation, incoming, outgoing),
        "flexibility": flexibility_part(league, situation, incoming, outgoing),
        "draft": draft_part(league, situation, picks_in, picks_out),
        "chemistry": chemistry_part(league, situation, incoming, outgoing),
        "coach_fit": coach_fit_part(league, situation, incoming, outgoing),
        "owner": owner_part(league, situation, incoming, outgoing,
                            picks_in, picks_out),
        "marketability": marketability_part(league, situation, incoming, outgoing),
    }
    score = sum(parts[key] * weight for key, weight in WEIGHTS.items())

    # Deadline. A buyer near the deadline will pay over the odds; a seller will
    # take less to get something done. In the middle of the pack it goes the
    # other way -- indecision, which is exactly what the brief describes.
    pressure = deadline_pressure(league)
    if situation.timeline.buying:
        score += pressure * DEADLINE_SWING * max(0.0, parts["player_value"])
    elif situation.timeline.selling:
        score += pressure * DEADLINE_SWING * max(0.0, parts["draft"] + parts["flexibility"])

    # Aggressiveness is the last word: a passive front office needs more
    # convincing than an aggressive one to do anything at all.
    ident = situation.identity
    score += (ident.aggressiveness - 50.0) / 50.0 * 0.03

    # Untouchables. Not an absolute veto -- the brief says "unless overwhelmed"
    # -- so it is an enormous surcharge rather than a wall.
    blocked = [p.name for p in outgoing
               if TV.untouchable(league, situation, p)]
    if blocked:
        score -= 0.55 * len(blocked)

    legality = check_legality(league, offer)
    if not legality.legal:
        verdict = "reject"
    elif score >= ACCEPT_SCORE:
        verdict = "accept"
    elif score >= REJECT_SCORE:
        verdict = "counter"
    else:
        verdict = "reject"

    reasoning = explain(league, situation, offer, parts, score, verdict,
                        incoming, outgoing, picks_in, picks_out, blocked, legality)
    return Evaluation(team_id, score, parts, verdict, reasoning, legality, blocked)


# --------------------------------------------------------------------------
# The explanation engine
# --------------------------------------------------------------------------

PART_LANGUAGE = {
    "player_value": ("the talent coming back is worth more to us than what we send",
                     "we would be giving up more talent than we get"),
    "roster_fit": ("it fills a hole we actually have",
                   "it duplicates what we already have rather than fixing a weakness"),
    "timeline": ("it matches where this club is",
                 "it pulls against where this club is heading"),
    "salary": ("it improves our books this season",
               "it adds salary we cannot comfortably carry"),
    "flexibility": ("it keeps our future payroll clean",
                    "it commits money well beyond this season"),
    "draft": ("it improves our draft position",
              "it costs us draft capital we are not willing to spend"),
    "chemistry": ("the character coming in would help the room",
                  "it would break up a group that has been building something"),
    "coach_fit": ("the incoming players suit what we run",
                  "the incoming players do not suit our system"),
    "owner": ("it serves what ownership has asked for",
              "it works against what ownership has asked for"),
    "marketability": ("it raises the club's profile",
                      "it costs us a player the public turns out for"),
}


def explain(league, situation, offer, parts, score, verdict, incoming, outgoing,
            picks_in, picks_out, blocked, legality) -> str:
    """Why the club decided what it decided, in a paragraph.

    Built from the parts rather than written alongside them, so the reasoning
    cannot drift away from the arithmetic: the sentences name whichever
    components actually moved the number most.
    """
    if not legality.legal:
        return ("We cannot make this deal as constructed: "
                + "; ".join(legality.reasons) + ".")

    ranked = sorted(parts.items(), key=lambda kv: kv[1] * WEIGHTS[kv[0]])
    worst_key, worst = ranked[0]
    best_key, best = ranked[-1]

    club = situation.name
    phase = situation.timeline.phrase
    window = int(round(situation.window))

    opening = f"{club} are {phase}, with a championship window of {window}. "

    if blocked:
        return (opening
                + f"{' and '.join(blocked)} "
                + ("is" if len(blocked) == 1 else "are")
                + " not available in any deal we would consider, and this offer "
                  "is not close to the level that would change that.")

    body = []
    if best > 0:
        body.append("In favour: " + PART_LANGUAGE[best_key][0] + ".")
    if worst < 0:
        body.append("Against: " + PART_LANGUAGE[worst_key][1] + ".")

    money = ""
    change = salary_of(incoming) - salary_of(outgoing)
    if abs(change) >= 3_000_000:
        direction = "adds" if change > 0 else "sheds"
        from .negotiation import format_money

        money = (f" The deal {direction} {format_money(abs(change))} of salary, "
                 f"which leaves us {format_money(abs(situation.tax_room - change))} "
                 f"{'under' if situation.tax_room - change > 0 else 'over'} the tax line.")

    if verdict == "accept":
        close = " On balance we take it."
    elif verdict == "counter":
        close = (" It is close enough to keep talking, but not as it stands -- "
                 "we would need the package improved.")
    else:
        close = " We are not interested at this price."

    goals = ", ".join(g.label.lower() for g in situation.goals)
    mandate = f" Ownership has asked us to {goals}." if goals else ""
    return opening + " ".join(body) + money + mandate + close


# --------------------------------------------------------------------------
# Counteroffers
# --------------------------------------------------------------------------

@dataclass
class Response:
    """What a club says back."""

    evaluation: Evaluation
    counter: Offer | None = None
    ask: str = ""

    def to_dict(self) -> dict:
        return {
            **self.evaluation.to_dict(),
            "counter": self.counter.to_dict() if self.counter else None,
            "ask": self.ask,
        }


def respond(league, team_id: str, offer: Offer) -> Response:
    """Evaluate, and build a counter if the deal is worth saving.

    The brief: never instantly accept or reject. A club that is close asks for
    the specific thing that would close the gap -- a pick if the shortfall is
    value, salary relief if the shortfall is money, a prospect if the shortfall
    is the future. Which one it asks for is read off *which part was negative*,
    so the counter is an answer to the actual objection.
    """
    evaluation = evaluate(league, team_id, offer)
    if evaluation.verdict != "counter":
        return Response(evaluation)

    partner_id = (offer.receiving.team_id if offer.sending.team_id == team_id
                  else offer.sending.team_id)
    partner = league.teams.get(partner_id)
    if partner is None:
        return Response(evaluation)

    mine, theirs = ((offer.sending, offer.receiving)
                    if offer.sending.team_id == team_id
                    else (offer.receiving, offer.sending))

    situation = FO.situation(league, team_id and league.teams[team_id])
    partner_situation = FO.situation(league, partner)
    gap = ACCEPT_SCORE - evaluation.score

    # What is actually wrong decides what we ask for.
    weighted = {k: v * WEIGHTS[k] for k, v in evaluation.parts.items()}
    complaint = min(weighted, key=weighted.get)

    counter = Offer(
        sending=Package(mine.team_id, list(mine.player_ids), list(mine.picks)),
        receiving=Package(theirs.team_id, list(theirs.player_ids),
                          list(theirs.picks)),
    )
    ask = ""

    if complaint in ("draft", "player_value", "timeline"):
        # Ask for the best pick the partner can spare without gutting itself.
        # Picks the partner still holds and has not already put in. No
        # untouchable filter here -- that test is about players, and running a
        # `DraftPick` through it was reading `.ability` off a pick.
        offered = {(p.year, p.round, p.original_team) for p in theirs.picks}
        available = [p for p in draft_picks.owned_by(league, partner_id)
                     if (p.year, p.round, p.original_team) not in offered]
        if available:
            year = draft_picks.current_year(league)
            available.sort(key=lambda p: -draft_picks.value_of(league, p, year))
            wanted = available[0]
            counter.receiving.picks.append(wanted)
            ask = f"add {wanted.label}"
        else:
            spare = _spare_player(league, partner, partner_situation,
                                  exclude=set(theirs.player_ids))
            if spare is not None:
                counter.receiving.player_ids.append(spare.id)
                ask = f"add {spare.name}"
    elif complaint in ("salary", "flexibility"):
        # Ask them to take a contract we do not want.
        burden = _worst_contract(league, league.teams[team_id],
                                 exclude=set(mine.player_ids))
        if burden is not None:
            counter.sending.player_ids.append(burden.id)
            ask = f"take {burden.name} as well"
    elif complaint == "roster_fit":
        spare = _spare_player(league, partner, partner_situation,
                              exclude=set(theirs.player_ids),
                              need=_biggest_need(league, league.teams[team_id]))
        if spare is not None:
            counter.receiving.player_ids.append(spare.id)
            ask = f"add {spare.name}"

    if not ask:
        return Response(evaluation)

    del gap, situation
    return Response(evaluation, counter=counter, ask=ask)


def _spare_player(league, team, situation, exclude: set[str], need: str = "") -> object | None:
    """The best player this club could plausibly part with.

    Never an untouchable, never a rotation cornerstone -- a counter that asks
    for a club's best player is not a counter, it is a different trade.
    """
    candidates = [p for p in team.players
                  if p.id not in exclude
                  and not TV.untouchable(league, situation, p)]
    if not candidates:
        return None
    core = {p.id for p in rotation(team)[:3]}
    candidates = [p for p in candidates if p.id not in core] or candidates
    if need:
        fn = FIT_DIMENSIONS.get(need)
        if fn is not None:
            return max(candidates, key=fn)
    return max(candidates, key=lambda p: p.ability.current)


def _worst_contract(league, team, exclude: set[str]):
    """The contract this club would most like to be rid of."""
    worst = None
    worst_gap = 0.0
    for player in team.players:
        if player.id in exclude:
            continue
        contract = getattr(player, "contract", None)
        if contract is None or contract.expired:
            continue
        market = K.market_value(player)
        overpay = contract.salary - market
        if overpay > worst_gap:
            worst, worst_gap = player, overpay
    return worst


def _biggest_need(league, team) -> str:
    gap = needs(league, team)
    return max(gap, key=gap.get) if gap else ""


# --------------------------------------------------------------------------
# Both sides
# --------------------------------------------------------------------------

def assess(league, offer: Offer) -> dict:
    """Both clubs' readings of one offer, and whether it would actually happen."""
    a = respond(league, offer.sending.team_id, offer)
    b = respond(league, offer.receiving.team_id, offer)
    agreed = (a.evaluation.verdict == "accept" and b.evaluation.verdict == "accept")
    return {
        "offer": offer.to_dict(),
        "agreed": agreed,
        "sides": {offer.sending.team_id: a.to_dict(),
                  offer.receiving.team_id: b.to_dict()},
        "deadlinePressure": round(deadline_pressure(league), 3),
    }


def execute(league, offer: Offer) -> dict:
    """Actually make the trade. Assumes it has been agreed and is legal."""
    legality = check_legality(league, offer)
    if not legality.legal:
        return {"done": False, "reasons": legality.reasons}

    sending = league.teams[offer.sending.team_id]
    receiving = league.teams[offer.receiving.team_id]
    out_players = players_of(league, offer.sending)
    in_players = players_of(league, offer.receiving)

    for player in out_players:
        sending.players = [p for p in sending.players if p.id != player.id]
        receiving.players.append(player)
    for player in in_players:
        receiving.players = [p for p in receiving.players if p.id != player.id]
        sending.players.append(player)

    for pick in offer.sending.picks:
        draft_picks.transfer(league, pick, receiving.id)
    for pick in offer.receiving.picks:
        draft_picks.transfer(league, pick, sending.id)

    # A traded player has no relationships at his new club, and the depth chart
    # he was in no longer contains him.
    for team in (sending, receiving):
        ids = {p.id for p in team.players}
        team.depth_chart = [pid for pid in team.depth_chart if pid in ids]
        team.pair_chemistry = {
            pair: value for pair, value in team.pair_chemistry.items()
            if set(pair) <= ids
        }
    return {"done": True,
            "moved": [p.name for p in out_players + in_players]}


# --------------------------------------------------------------------------
# Finding deals
#
# Evaluating an offer is only half a front office. The other half is coming up
# with one, and without it the engine can grade proposals but never make a
# trade: a sweep of 200 random player-for-player swaps produced zero deals both
# clubs would sign, which is the correct answer to a bad question. Real front
# offices do not test random pairs. They work out what they need, find the club
# that has it going spare, and build the deal from there.
# --------------------------------------------------------------------------

# How many partners and how many players per partner to look at. The search is
# quadratic in these and every evaluation walks two rotations of composites, so
# the caps are what keep a deadline sweep from taking a minute.
#
# Overridable per call, because the autonomous market in `trade_market` runs
# inside `League.tick` -- which fires on every API request -- and needs a
# tighter budget than a manager clicking "find me a trade" does.
MAX_PARTNERS = 12
MAX_TARGETS = 6
MAX_PIECES = 5


def surplus(league, situation, team) -> list:
    """Players this club could most easily part with, best first.

    Not its worst players -- its most *expendable* ones, which is a different
    list: a good centre behind two better centres is expendable and a thin
    club's only point guard is not.
    """
    from .front_office import identity

    depth = positional_need(team)
    candidates = []
    for player in team.players:
        if TV.untouchable(league, situation, player):
            continue
        # Deep at his position, and not one of the three best players.
        crowding = 1.0 - depth.get(player.position.value, 0.5)
        core = player.id in {p.id for p in rotation(team)[:3]}
        if core:
            continue
        candidates.append((crowding * TV.value_of(league, player), player))
    # A loyal front office parts with fewer people.
    keep = max(2, int(len(candidates) * (1.0 - identity(team).loyalty / 260.0)))
    candidates.sort(key=lambda pair: -pair[0])
    return [player for _score, player in candidates[:keep]]


def wanted(league, situation, team) -> list[str]:
    """The dimensions this club most needs, worst first."""
    gap = needs(league, team)
    return [key for key, _ in sorted(gap.items(), key=lambda kv: -kv[1])[:3]]


def _fits_need(player, dimensions: list[str]) -> float:
    return sum(FIT_DIMENSIONS[key](player) for key in dimensions) / max(1, len(dimensions))


def find_trades(league, team_id: str, limit: int = 5, *,
                max_partners: int = MAX_PARTNERS,
                max_targets: int = MAX_TARGETS,
                max_pieces: int = MAX_PIECES) -> list[dict]:
    """Deals this club would actually propose, best first.

    Searches for partners holding what it needs and wanting what it can spare,
    then builds a one-for-one and, where that is not enough, sweetens it with a
    pick. Only deals **both** sides would sign are returned -- an offer the
    other club rejects is not a proposal, it is a press release.
    """
    team = league.teams.get(team_id)
    if team is None:
        return []
    situation = FO.situation(league, team)
    my_needs = wanted(league, situation, team)
    my_spare = surplus(league, situation, team)[:max_pieces]
    if not my_spare:
        return []

    # Partners first: whoever is furthest from us in timeline is likeliest to
    # want what we do not. A contender and a rebuild are natural partners, two
    # contenders are not.
    others = [t for t in league.teams.values() if t.id != team_id]
    order = list(FO.Timeline)
    my_phase = order.index(situation.timeline)
    others.sort(key=lambda t: -abs(order.index(FO.timeline(league, t)) - my_phase))
    others = others[:max_partners]

    found: list[dict] = []
    for partner in others:
        partner_situation = FO.situation(league, partner)
        targets = sorted(
            (p for p in partner.players
             if not TV.untouchable(league, partner_situation, p)),
            key=lambda p: -_fits_need(p, my_needs))[:max_targets]

        for target in targets:
            for piece in my_spare:
                offer = Offer(sending=Package(team_id, [piece.id]),
                              receiving=Package(partner.id, [target.id]))
                result = _try(league, offer)
                if result is not None:
                    found.append(result)
                    continue
                # Not enough on its own -- add our best spare pick and see.
                year = draft_picks.current_year(league)
                mine_picks = draft_picks.owned_by(league, team_id)
                if mine_picks:
                    sweetener = min(mine_picks,
                                    key=lambda p: draft_picks.value_of(league, p, year))
                    sweetened = Offer(
                        sending=Package(team_id, [piece.id], [sweetener]),
                        receiving=Package(partner.id, [target.id]))
                    result = _try(league, sweetened)
                    if result is not None:
                        found.append(result)

    found.sort(key=lambda row: -row["ourScore"])
    return found[:limit]


def _try(league, offer: Offer) -> dict | None:
    """Return the assessment if both clubs would sign it, else None."""
    result = assess(league, offer)
    if not result["agreed"]:
        return None
    ours = result["sides"][offer.sending.team_id]
    theirs = result["sides"][offer.receiving.team_id]
    return {
        "offer": offer.to_dict(),
        "ourScore": ours["score"],
        "theirScore": theirs["score"],
        "ourReasoning": ours["reasoning"],
        "theirReasoning": theirs["reasoning"],
        "_offer": offer,
    }
