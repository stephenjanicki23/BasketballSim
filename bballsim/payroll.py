"""Team payroll: what a club is committed to, and how that sits against the cap.

**Derived, never stored.** This is the same discipline the standings, the
bracket and the advanced table are built on, and payroll is the case where it
matters most obviously: a stored total is wrong the instant a contract is
signed, expires or is traded, and the bug it produces is a number on a screen
that disagrees with the list of contracts directly underneath it. Summing
fifteen integers is cheap. Reconciling two sources of truth is not.

So there is no `Team.payroll` field anywhere. Every caller comes through here,
and every number below is a fresh sum over the contracts that exist right now.

**What is real and what is an anchor.** The totals, the counts and the space
calculations are real: they are what the contracts say. The cap, the tax line
and the aprons are *declared* in `contracts` and nothing in the codebase
prevents a club exceeding them -- there is no enforcement, no tax bill and no
hard cap. Those constants exist so that payroll is denominated against the
right scale from the start, and so a future cap system changes what is
permitted without moving a single number here.

The distinction is kept visible rather than smoothed over: `over_tax` tells you
a club is over the line, and no code path charges it anything for being there.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import contracts as K


def salary_of(holder) -> int:
    """What one player or coach is owed this season. Zero if unsigned.

    Absence is a real state -- a drafted prospect, an unsigned free agent, a
    league generated before contracts existed -- and it means no money owed
    rather than an error.

    **An expired contract pays nothing.** A player whose deal ran out and who
    was not re-signed stays on the roster today (see `franchise.fill_pool` for
    why), and his old salary is still sitting in the object. Counting it would
    charge a club for a man it is no longer paying, and the payroll screen
    would disagree with the contract list beside it.
    """
    contract = getattr(holder, "contract", None)
    if contract is None or getattr(contract, "expired", False):
        return 0
    return int(getattr(contract, "salary", 0) or 0)


def player_payroll(team) -> int:
    """The players only. This is the number a cap is measured against."""
    return sum(salary_of(p) for p in getattr(team, "players", []))


def coach_payroll(team) -> int:
    """The head coach. Kept separate because coaching salary does not count
    against a basketball cap in any real league, and folding the two together
    would make every cap calculation quietly wrong later."""
    coach = getattr(team, "coach", None)
    return salary_of(coach) if coach is not None else 0


def total_payroll(team) -> int:
    """Everything the club is paying out this season."""
    return player_payroll(team) + coach_payroll(team)


def committed(team, seasons: int = 1) -> int:
    """Salary already committed across the next `seasons` seasons.

    What a club is locked into, which is the question a manager actually asks
    before a signing: not "can I afford him this year" but "what does this do
    to me in three". Only counts a contract for as long as it runs.
    """
    total = 0
    for player in getattr(team, "players", []):
        contract = getattr(player, "contract", None)
        if contract is None:
            continue
        total += contract.salary * max(0, min(seasons, contract.years_remaining))
    return total


def room_below_cap(team) -> int:
    """Space under the salary cap. Negative when a club is over it."""
    return K.SALARY_CAP - player_payroll(team)


def room_below_tax(team) -> int:
    """Space under the luxury tax line. Negative when a club is into the tax."""
    return K.LUXURY_TAX_LINE - player_payroll(team)


def over_cap(team) -> bool:
    return player_payroll(team) > K.SALARY_CAP


def over_tax(team) -> bool:
    """Over the tax line. Nothing charges the club for this yet -- see the
    module note. It is reported so a screen can say so."""
    return player_payroll(team) > K.LUXURY_TAX_LINE


def below_floor(team) -> bool:
    """Under the minimum a club is required to spend."""
    return player_payroll(team) < K.SALARY_CAP * K.SALARY_FLOOR_SHARE


CAP_BANDS: tuple[tuple[str, str], ...] = (
    ("second_apron", "Second apron"),
    ("first_apron", "First apron"),
    ("tax", "Luxury tax"),
    ("over_cap", "Over the cap"),
    ("under_cap", "Cap space"),
    ("below_floor", "Below the floor"),
)


def cap_band(team) -> tuple[str, str]:
    """Which side of every line this club is on, as a key and a label."""
    total = player_payroll(team)
    if total > K.SECOND_APRON:
        return CAP_BANDS[0]
    if total > K.FIRST_APRON:
        return CAP_BANDS[1]
    if total > K.LUXURY_TAX_LINE:
        return CAP_BANDS[2]
    if total > K.SALARY_CAP:
        return CAP_BANDS[3]
    if total < K.SALARY_CAP * K.SALARY_FLOOR_SHARE:
        return CAP_BANDS[5]
    return CAP_BANDS[4]


@dataclass
class Payroll:
    """One club's finances, as a screen wants them.

    A view object, built on demand. It exists so the API and the UI read one
    shape rather than each assembling their own from six function calls, and so
    a future finances page has somewhere obvious to add revenue to.
    """

    team_id: str
    total: int
    players: int
    coach: int
    signed: int
    unsigned: int
    cap_room: int
    tax_room: int
    band: str
    band_label: str
    committed_next: int

    def to_dict(self) -> dict:
        return {
            "teamId": self.team_id,
            "total": self.total,
            "players": self.players,
            "coach": self.coach,
            "signed": self.signed,
            "unsigned": self.unsigned,
            "capRoom": self.cap_room,
            "taxRoom": self.tax_room,
            "band": self.band,
            "bandLabel": self.band_label,
            "committedNextSeason": self.committed_next,
            "salaryCap": K.SALARY_CAP,
            "luxuryTax": K.LUXURY_TAX_LINE,
            "overCap": self.cap_room < 0,
            "overTax": self.tax_room < 0,
        }


def summary(team) -> Payroll:
    """Everything about one club's money, in one object."""
    roster = list(getattr(team, "players", []))
    band, band_label = cap_band(team)
    return Payroll(
        team_id=team.id,
        total=total_payroll(team),
        players=player_payroll(team),
        coach=coach_payroll(team),
        signed=sum(1 for p in roster if getattr(p, "contract", None) is not None),
        unsigned=sum(1 for p in roster if getattr(p, "contract", None) is None),
        cap_room=room_below_cap(team),
        tax_room=room_below_tax(team),
        band=band,
        band_label=band_label,
        # Next season's commitments: only the men under contract beyond this
        # one, which is what makes an expiring squad look like the cap space it
        # actually is.
        committed_next=sum(
            p.contract.salary for p in roster
            if getattr(p, "contract", None) is not None
            and p.contract.years_remaining > 1
        ),
    )


def league_table(teams) -> list[dict]:
    """Every club's payroll, richest first. For a league finances screen."""
    rows = [summary(team).to_dict() | {"teamName": getattr(team, "full_name", team.id),
                                       "abbreviation": getattr(team, "abbreviation", "")}
            for team in teams]
    rows.sort(key=lambda row: -row["total"])
    return rows


def format_money(amount: int) -> str:
    """One formatter for the whole project -- see `negotiation.format_money`."""
    from .negotiation import format_money as fmt

    return fmt(amount)
