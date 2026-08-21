"""The offseason as a sequence of stages a manager walks through.

`offseason.roll` already turned one season into the next: archive, develop,
retire, draft, reschedule. That is a *transition*, and it happens in one call
with nobody watching. This module is the other thing an offseason is -- a
period the manager is inside, with decisions to take before he presses on.

The two are not rivals. `roll` is still the thing that ends a season, and
`advance` below finishes by calling it. What this adds is everything that has
to happen *before* that call, in an order that cannot be rearranged:

    1. contracts tick down          every player and coach, one year served
    2. expected free agents         whoever hit zero, gathered per club
    3. player negotiations          his own club gets first refusal
    4. coach negotiations           the same, for the bench
    5. free agent pool              whoever is still unsigned, league-wide
    6. retirements                  processed, and taken out of the pool
    7. news                         written from what the six steps did
    8. roll                         age, develop, draft, reschedule

**The order is the design.** Contracts tick before the expected list is built,
or the list is a season stale. Negotiations run before the pool is filled, or a
club never gets its first refusal. Retirements are processed after negotiations
and before news, so a man cannot retire out of a contract he just signed and so
the newsroom can report both. Each step is a function that takes the league and
returns what it did; `advance` is the list of them in order and nothing else.

**Phases are a state, not a script.** `Offseason.phase` says where the league
has got to, and the UI gates on it. A manager may sit in `NEGOTIATIONS` for as
long as he likes, making offers by hand; when he advances, whatever he has not
settled is auto-resolved by the same service his own offers went through. The
AI is not a different code path -- it is `negotiation.auto_resolve`, which is
what stops the twenty-nine clubs he is not managing drifting away from the
rules he is playing under.

**What is a placeholder and what is not.** Free agency, the draft lottery and
training camp are *named* phases with no logic behind them. They are declared
here so the menu, the save format and the phase ordering already have room for
them; each is documented as inert at the point it is declared. Nothing pretends
to run them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .. import contracts as K
from .. import negotiation as N
from .. import payroll
from .. import progression
from . import playoffs


class Phase(str, Enum):
    """Where the offseason has got to.

    Ordered, and `advance` moves through them in this order. `SEASON` is the
    state during play -- there is no offseason to be in.
    """

    SEASON = "season"                  # not in the offseason at all
    EXPIRING = "expiring"              # contracts ticked, list built
    NEGOTIATIONS = "negotiations"      # clubs talking to their own players
    COACHES = "coaches"                # clubs talking to their own coaches
    FREE_AGENCY = "free_agency"        # declared; no logic behind it yet
    RETIREMENTS = "retirements"
    DRAFT = "draft"                    # `offseason.draft` runs inside `roll`
    TRAINING_CAMP = "training_camp"    # declared; no logic behind it yet
    COMPLETE = "complete"

    @property
    def label(self) -> str:
        return {
            Phase.SEASON: "Season in progress",
            Phase.EXPIRING: "Expiring contracts",
            Phase.NEGOTIATIONS: "Contract negotiations",
            Phase.COACHES: "Coach negotiations",
            Phase.FREE_AGENCY: "Free agency",
            Phase.RETIREMENTS: "Retirements",
            Phase.DRAFT: "Draft",
            Phase.TRAINING_CAMP: "Training camp",
            Phase.COMPLETE: "Ready for next season",
        }[self]


@dataclass
class FreeAgent:
    """A player or coach whose contract has run out.

    Holds the id and enough of a snapshot to render a row without walking the
    league again. The snapshot is display data only -- anything that decides
    something reads the live player, so a stale row cannot change an outcome.
    """

    holder_id: str
    name: str
    team_id: str = ""
    is_coach: bool = False
    # What he was on before it expired, so a screen can show the step up.
    previous_salary: int = 0
    requested_years: int = 0
    requested_salary: int = 0
    interest: float = 50.0
    resolved: str = ""          # "", "re-signed", "pool", "retired"

    def to_dict(self) -> dict:
        return {
            "id": self.holder_id,
            "name": self.name,
            "teamId": self.team_id,
            "isCoach": self.is_coach,
            "previousSalary": self.previous_salary,
            "requestedYears": self.requested_years,
            "requestedSalary": self.requested_salary,
            "interest": round(self.interest, 1),
            "interestLabel": N.interest_label(self.interest),
            "resolved": self.resolved,
        }


@dataclass
class Signing:
    """A completed negotiation. The transaction log the newsroom reads."""

    holder_id: str
    name: str
    team_id: str
    years: int
    salary: int
    is_coach: bool = False
    by_manager: bool = False    # settled by hand rather than auto-resolved

    def to_dict(self) -> dict:
        return {
            "id": self.holder_id,
            "name": self.name,
            "teamId": self.team_id,
            "years": self.years,
            "salary": self.salary,
            "isCoach": self.is_coach,
            "byManager": self.by_manager,
        }


@dataclass
class Offseason:
    """The state of one summer. Saved with the league.

    Everything here is a record of what *happened* -- who expired, who signed,
    who walked, who retired. None of it is derived from anything still
    available afterwards: once a contract is re-signed, nothing left in the
    league says it used to be expiring. That is why this is stored rather than
    recomputed, and it is the same argument `save.HISTORY_PATH` makes for
    finished seasons.
    """

    season: str = ""
    phase: Phase = Phase.SEASON
    expected: list[FreeAgent] = field(default_factory=list)
    coaches_expected: list[FreeAgent] = field(default_factory=list)
    signings: list[Signing] = field(default_factory=list)
    # Unsigned after their own club had first refusal. The pool a future free
    # agency period would draw from; today it is a list that is filled,
    # displayed, and carried into the next season without being emptied by
    # anything but a manual signing.
    pool: list[FreeAgent] = field(default_factory=list)
    retired: list[dict] = field(default_factory=list)
    headlines: list[dict] = field(default_factory=list)

    def active(self) -> bool:
        return self.phase not in (Phase.SEASON,)

    def find(self, holder_id: str) -> FreeAgent | None:
        for entry in self.expected + self.coaches_expected + self.pool:
            if entry.holder_id == holder_id:
                return entry
        return None

    def to_dict(self) -> dict:
        return {
            "season": self.season,
            "phase": self.phase.value,
            "phaseLabel": self.phase.label,
            "expected": [e.to_dict() for e in self.expected],
            "coachesExpected": [e.to_dict() for e in self.coaches_expected],
            "signings": [s.to_dict() for s in self.signings],
            "pool": [e.to_dict() for e in self.pool],
            "retired": list(self.retired),
            "headlines": list(self.headlines),
        }


# --------------------------------------------------------------------------
# Getting at it
# --------------------------------------------------------------------------

def state(league) -> Offseason:
    """The league's offseason, created on first ask.

    Held on the league object rather than passed around, because every screen
    and every endpoint wants the same one and threading it through would mean
    every caller could pass a different one.
    """
    existing = getattr(league, "offseason", None)
    if isinstance(existing, Offseason):
        return existing
    made = Offseason(season=getattr(league, "season", ""))
    league.offseason = made
    return made


def is_available(league) -> bool:
    """Whether the OFFSEASON menu should exist yet.

    The gate the brief asks for: the Finals have to have concluded. That is
    exactly `playoffs.champion` being decided, which is the same test the
    honours screen already uses -- so the menu appears at the moment a trophy
    is lifted rather than on a date.
    """
    return playoffs.champion(league) is not None


def begin(league) -> Offseason:
    """Open the offseason if the Finals are done. Idempotent.

    Ticking contracts down is the first thing that happens and it must happen
    exactly once, which is why it lives here behind a phase check rather than
    anywhere a screen might call twice.
    """
    current = state(league)
    if not is_available(league):
        return current

    # A summer belongs to the season that just finished. If the league has
    # moved on, last year's record is finished business and this is a new one
    # -- without that check the second offseason found every entry already
    # marked `re-signed`, skipped all of them, and renewed nobody. The report
    # still said "199 expiring" because it was reading the previous summer's
    # list, which is exactly the kind of quiet wrong answer a phase guard is
    # supposed to prevent.
    if current.phase is not Phase.SEASON and current.season == league.season:
        return current
    if current.season != league.season:
        league.offseason = current = Offseason(season=league.season)

    current.season = league.season
    tick_contracts(league)
    current.expected, current.coaches_expected = collect_expiring(league)
    current.phase = Phase.EXPIRING
    return current


# --------------------------------------------------------------------------
# 1. The contract clock
# --------------------------------------------------------------------------

def tick_contracts(league) -> int:
    """One season served by every player and every coach in the league.

    Returns how many contracts reached zero. A contract at zero does **not**
    make a free agent -- that is the whole point of the expected-free-agent
    stage, and the reason expiry and free agency are two steps rather than one.
    """
    expired = 0
    for team in league.teams.values():
        for player in team.players:
            contract = getattr(player, "contract", None)
            if contract is None:
                continue
            K.tick_down(contract)
            if contract.expired:
                expired += 1
        coach = getattr(team, "coach", None)
        if coach is not None and getattr(coach, "contract", None) is not None:
            K.tick_down(coach.contract)
            if coach.contract.expired:
                expired += 1
    return expired


# --------------------------------------------------------------------------
# 2. Who is out of contract
# --------------------------------------------------------------------------

def collect_expiring(league) -> tuple[list[FreeAgent], list[FreeAgent]]:
    """Everyone whose deal has run out, players and coaches, best first.

    Sorted by ability rather than by club, because the question this list
    answers is "who is available", and that is a league-wide question.
    """
    players: list[FreeAgent] = []
    coaches: list[FreeAgent] = []

    for team in league.teams.values():
        for player in team.players:
            contract = getattr(player, "contract", None)
            if contract is None or not contract.expired:
                continue
            where = N.situation(league, team, player)
            ask = N.demand(player, where)
            players.append(FreeAgent(
                holder_id=player.id, name=player.name, team_id=team.id,
                previous_salary=contract.salary,
                requested_years=ask.years, requested_salary=ask.salary,
                interest=ask.interest,
            ))
        coach = getattr(team, "coach", None)
        contract = getattr(coach, "contract", None) if coach else None
        if coach is not None and contract is not None and contract.expired:
            where = N.situation(league, team, coach_placeholder(team))
            ask = N.coach_demand(coach, where)
            coaches.append(FreeAgent(
                holder_id=coach.id, name=coach.name, team_id=team.id,
                is_coach=True, previous_salary=contract.salary,
                requested_years=ask.years, requested_salary=ask.salary,
                interest=ask.interest,
            ))

    lookup = {p.id: p for team in league.teams.values() for p in team.players}
    players.sort(key=lambda e: -lookup[e.holder_id].ability.current
                 if e.holder_id in lookup else 0.0)
    coaches.sort(key=lambda e: -e.requested_salary)
    return players, coaches


def coach_placeholder(team):
    """A stand-in so `situation` can be built for a coach.

    `situation` reads a squad role, which a coach does not have. Rather than
    give `Situation` an optional player and branch inside it, the club's best
    player stands in -- the only fields the coach path reads are the club's
    own, and this keeps one `Situation` builder instead of two.
    """
    players = getattr(team, "players", [])
    if not players:
        return None
    return max(players, key=lambda p: p.ability.current)


# --------------------------------------------------------------------------
# 3 and 4. Negotiations
# --------------------------------------------------------------------------

def negotiate(league, holder_id: str, years: int, salary: int) -> dict:
    """Put an offer to one player or coach and get an answer.

    The manager's hand-made offer. Goes through exactly the same `negotiation`
    service the AI uses, so accepting a deal by hand and letting it auto-resolve
    are the same operation with a different number in it.
    """
    current = state(league)
    entry = current.find(holder_id)
    if entry is None:
        return {"error": "not an expiring contract", "id": holder_id}

    team = league.teams.get(entry.team_id)
    if team is None:
        return {"error": "team not found", "id": holder_id}

    offer = N.Offer(years=max(1, int(years)), salary=max(0, int(salary)))

    if entry.is_coach:
        coach = team.coach
        if coach is None or coach.id != holder_id:
            return {"error": "coach not found", "id": holder_id}
        where = N.situation(league, team, coach_placeholder(team))
        response = N.evaluate_coach(coach, where, offer)
        holder, is_coach = coach, True
    else:
        player = team.player(holder_id)
        if player is None:
            return {"error": "player not on this team", "id": holder_id}
        where = N.situation(league, team, player)
        response = N.evaluate(player, where, offer)
        holder, is_coach = player, False

    if response.verdict is N.Verdict.ACCEPT:
        _complete(current, holder, team, offer.years, offer.salary,
                  league.season, is_coach=is_coach, by_manager=True)

    return {
        "id": holder_id,
        "name": holder.name,
        "teamId": team.id,
        "offer": offer.to_dict(),
        **response.to_dict(),
        "payroll": payroll.summary(team).to_dict(),
    }


def _complete(current: Offseason, holder, team, years: int, salary: int,
              season: str, *, is_coach: bool, by_manager: bool) -> None:
    """Sign the deal and record it. The single place a contract is written."""
    K.sign(holder, years, salary, season=season,
           contract_type=K.ContractType.COACH if is_coach else None)
    entry = current.find(holder.id)
    if entry is not None:
        entry.resolved = "re-signed"
    current.signings.append(Signing(
        holder_id=holder.id, name=holder.name, team_id=team.id,
        years=years, salary=salary, is_coach=is_coach, by_manager=by_manager,
    ))


def resolve_players(league) -> list[Signing]:
    """Settle every player negotiation the manager did not.

    Each club gets first refusal on its own men, and takes it or does not
    according to `auto_resolve` -- which walks away when the price passes what
    it thinks he is worth. A club that re-signed everybody would leave free
    agency empty, so the ceiling in that function is what makes this stage
    produce a pool at all.
    """
    current = state(league)
    made: list[Signing] = []
    for entry in current.expected:
        if entry.resolved:
            continue
        team = league.teams.get(entry.team_id)
        player = team.player(entry.holder_id) if team else None
        if team is None or player is None:
            entry.resolved = "pool"
            continue
        where = N.situation(league, team, player)
        signed, terms = N.auto_resolve(player, where)
        if signed and terms is not None:
            before = len(current.signings)
            _complete(current, player, team, terms.years, terms.salary,
                      league.season, is_coach=False, by_manager=False)
            made.extend(current.signings[before:])
        else:
            entry.resolved = "pool"
    current.phase = Phase.COACHES
    return made


def resolve_coaches(league) -> list[Signing]:
    """The same, for the bench."""
    current = state(league)
    made: list[Signing] = []
    for entry in current.coaches_expected:
        if entry.resolved:
            continue
        team = league.teams.get(entry.team_id)
        coach = getattr(team, "coach", None) if team else None
        if team is None or coach is None or coach.id != entry.holder_id:
            entry.resolved = "pool"
            continue
        where = N.situation(league, team, coach_placeholder(team))
        signed, terms = N.auto_resolve_coach(coach, where)
        if signed and terms is not None:
            before = len(current.signings)
            _complete(current, coach, team, terms.years, terms.salary,
                      league.season, is_coach=True, by_manager=False)
            made.extend(current.signings[before:])
        else:
            entry.resolved = "pool"
    return made


# --------------------------------------------------------------------------
# 5. The pool
# --------------------------------------------------------------------------

def fill_pool(league) -> list[FreeAgent]:
    """Everyone still unsigned, gathered league-wide.

    **This is where the placeholder is.** A real free agency period would take
    this list and let thirty clubs bid on it. Nothing does. What happens today
    is that these men stay on the rosters they are on, unsigned and unpaid --
    they still play, because selection reads the depth chart and not the
    contract, and a player vanishing from a squad because his deal ran out
    would break a league that has no mechanism to replace him.

    That is the honest description: the pool is a *list*, correctly built, that
    a future feature will act on. Saying so here is better than a screen that
    implies thirty clubs are bidding when none are.
    """
    current = state(league)
    current.pool = [entry for entry in current.expected + current.coaches_expected
                    if entry.resolved == "pool"]
    current.phase = Phase.FREE_AGENCY
    return current.pool


# --------------------------------------------------------------------------
# 6. Retirements
# --------------------------------------------------------------------------

def apply_retirements(league, retired: list[dict]) -> list[dict]:
    """Record who finished, and take them out of the free agent pool.

    The retirement *decision* is not made here -- it belongs to `progression`,
    which is where a career is modelled, and duplicating it would give the
    project two answers to "is he finished". This takes the answer and does the
    contractual half: a retired player is not a free agent, and a screen that
    listed him as one would be offering a manager somebody who has gone home.
    """
    current = state(league)
    current.retired = list(retired)
    gone = {row.get("playerId") for row in retired}
    current.pool = [entry for entry in current.pool if entry.holder_id not in gone]
    for entry in current.expected:
        if entry.holder_id in gone:
            entry.resolved = "retired"
    current.phase = Phase.RETIREMENTS
    return current.retired


# --------------------------------------------------------------------------
# Payroll, for the screens
# --------------------------------------------------------------------------

def payroll_table(league) -> list[dict]:
    return payroll.league_table(league.teams.values())


# --------------------------------------------------------------------------
# The preview
#
# Everything below runs *during* a season and must not change anything. The
# OFFSEASON menu is now visible year-round, and the one rule that makes that
# safe is that nothing on the preview may tick a contract down: `begin` is what
# ages the league, it is meant to happen exactly once, and a screen that could
# trigger it by being looked at would age a league behind the manager's back.
#
# So these read the same facts the summer will read, a season early, and none
# of them writes.
# --------------------------------------------------------------------------

def projected_expiring(league, team=None) -> tuple[list[FreeAgent], list[FreeAgent]]:
    """Who *will* reach the market when this season ends.

    `team` narrows it to one club, for the squad page's own list. The league
    view and the club view therefore read one function: a per-club version
    written separately would answer "who is out of contract" differently from
    the league-wide screen the first time either was edited.

    `collect_expiring` reads `contract.expired`, which is only true after
    `tick_contracts` has run -- so during a season it correctly returns
    nobody, and a preview built on it would be an empty page. A deal with one
    year left is a deal that expires this summer, and that is knowable now.

    The asking prices are the same `negotiation` figures the summer will use.
    They can still move, because a player's situation and his season move them,
    and the screen says so rather than presenting them as agreed.
    """
    players: list[FreeAgent] = []
    coaches: list[FreeAgent] = []

    # `club`, not `team`: the loop variable shadowed the parameter, which
    # happened to work for a one-element list and would have quietly broken
    # anything added below it.
    clubs = [team] if team is not None else list(league.teams.values())
    for club in clubs:
        for player in club.players:
            contract = getattr(player, "contract", None)
            if contract is None or contract.years_remaining > 1:
                continue
            where = N.situation(league, club, player)
            ask = N.demand(player, where)
            players.append(FreeAgent(
                holder_id=player.id, name=player.name, team_id=club.id,
                previous_salary=contract.salary,
                requested_years=ask.years, requested_salary=ask.salary,
                interest=ask.interest,
            ))
        coach = getattr(club, "coach", None)
        contract = getattr(coach, "contract", None) if coach else None
        if coach is not None and contract is not None and contract.years_remaining <= 1:
            where = N.situation(league, club, coach_placeholder(club))
            ask = N.coach_demand(coach, where)
            coaches.append(FreeAgent(
                holder_id=coach.id, name=coach.name, team_id=club.id,
                is_coach=True, previous_salary=contract.salary,
                requested_years=ask.years, requested_salary=ask.salary,
                interest=ask.interest,
            ))

    lookup = {p.id: p for team in league.teams.values() for p in team.players}
    players.sort(key=lambda e: -lookup[e.holder_id].ability.current
                 if e.holder_id in lookup else 0.0)
    coaches.sort(key=lambda e: -e.requested_salary)
    return players, coaches


def retirement_watch(league, limit: int = 12) -> list[dict]:
    """Who looks closest to the end, most likely first.

    A *watch*, not a list of retirements. `progression.develop_season` decides
    who is finished, and it decides it in the summer against a season that has
    not finished being played -- so nothing here can be more than a reading of
    age and decline. Presented that way, with the risk shown rather than a name
    marked "retiring".
    """
    rows = []
    for team in league.teams.values():
        for player in team.players:
            risk = progression.retirement_risk(player)
            if risk <= 0.0:
                continue
            rows.append({
                "playerId": player.id,
                "name": player.name,
                "teamId": team.id,
                "position": player.position.value,
                "age": player.age,
                "ca": round(player.ability.current, 1),
                "risk": round(risk, 3),
            })
    rows.sort(key=lambda row: (-row["risk"], row["playerId"]))
    return rows[:limit]


# --------------------------------------------------------------------------
# The whole thing
# --------------------------------------------------------------------------

def advance(league, *, seed: str | None = None) -> dict:
    """Run the offseason to its end and start the next season.

    The order in the module docstring, executed. Each step runs to completion
    before the next begins, and the report says what each one did -- so a
    failure is attributable to a stage rather than to "the offseason".
    """
    from . import offseason as roll_module
    from .. import news

    if not is_available(league):
        return {"error": "the season is not over"}

    current = begin(league)          # ticks contracts, builds the list
    report: dict = {
        "season": current.season,
        "expiring": len(current.expected) + len(current.coaches_expected),
    }

    signed = resolve_players(league)
    report["playersReSigned"] = len(signed)

    coach_signings = resolve_coaches(league)
    report["coachesReSigned"] = len(coach_signings)

    pool = fill_pool(league)
    report["freeAgents"] = len(pool)

    # `roll` retires, develops, drafts and reschedules. It is called here
    # rather than reimplemented because it is already the definition of what a
    # season change is -- this module adds the contractual half in front of it.
    rolled = roll_module.roll(league, seed=seed)
    if rolled is None:
        return {"error": "the season is not over"}

    apply_retirements(league, rolled.retired)
    report["retired"] = len(rolled.retired)

    current.headlines = [story.to_dict() for story in news.offseason_stories(league)]
    report["headlines"] = len(current.headlines)

    # Newly drafted players arrive unsigned; give them rookie deals so a squad
    # never contains a man with no contract at all.
    sign_intake(league, rolled)
    report["drafted"] = len(rolled.arrived)

    current.phase = Phase.COMPLETE
    report["seasonStarting"] = rolled.season_starting
    report["champion"] = rolled.champion
    return report


def sign_intake(league, rolled) -> None:
    """Rookie contracts for everyone the draft brought in.

    A drafted player with no contract would show a blank salary on every roster
    screen and count zero against payroll, which is a worse lie than a
    generated number -- so the intake is signed on arrival at its scale value.
    """
    import random

    from ..engine.rng import seed_from_string

    arrived = {row.get("playerId") for row in getattr(rolled, "arrived", [])}
    if not arrived:
        return
    for team in league.teams.values():
        for player in team.players:
            if player.id not in arrived or getattr(player, "contract", None) is not None:
                continue
            rng = random.Random(seed_from_string(f"rookie-{player.id}"))
            contract = K.generate(player, rng, season=league.season, stagger=False)
            contract.contract_type = K.ContractType.ROOKIE
            player.contract = contract
