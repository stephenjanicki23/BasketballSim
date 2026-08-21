# Scouting the draft class

Sixty cards, one per declared prospect: a face, a frame, where he came from,
what he does with the ball, and who he plays like.

And no idea whether he is any good. That is the design, not a gap in it.

---

## 1. The constraint

`docs/DRAFT.md` and `mock_draft.py` already refuse to print a prospect's
current ability or his ceiling, because finding out who turns into something is
the entire entertainment of a draft. A scouting card says a great deal more
than a mock draft does, and the same rule binds it:

> It may describe **how** a man plays. It must say nothing about **how well**.

That rule is easy to state, easy to believe you have followed, and easy to
break without noticing — which is why most of `tests/test_scouting.py` measures
rather than asserts.

---

## 2. Why the obvious card was a ratings readout

In this simulation style and quality are **not independent**.
`prospects.make_prospect` draws tendencies *from* the ratings, which are drawn
from current ability:

```python
usage            = gauss(5.0 + (target_ca / 200.0) * 12.0, 1.6)
three_point_rate = gauss(ratings.three_point, 2.4)
rim_rate         = gauss((ratings.layups + ratings.close_shot) / 2, 2.4)
```

So a good prospect's tendencies are **higher across the board** than a poor
one's. A card drawing them as bars would have been a CA readout with a
friendlier axis label. Measured over 480 prospects across eight classes:

| tendency | vs current ability |
|---|---|
| usage | **+0.435** |
| rim_rate | +0.419 |
| pass_first | +0.311 |
| crash_glass | +0.282 |
| three_point_rate | +0.280 |
| post_up_rate | +0.225 |

---

## 3. The fix is composition

A style here is the **share** each tendency takes of that player's own total,
so the five sum to one. Ability scales the tendencies roughly together, and
dividing by their sum cancels a common scale — which turns *how much he does*
into *what he does*, and only the second one is a style.

Same 480 prospects, the numbers the card actually publishes:

| share | vs current ability | vs potential |
|---|---|---|
| three_point_rate | +0.013 | +0.033 |
| rim_rate | −0.028 | −0.010 |
| post_up_rate | +0.017 | +0.011 |
| pass_first | −0.027 | −0.034 |
| crash_glass | +0.016 | −0.012 |

`usage` is **dropped** rather than normalised. It is a linear function of
current ability with noise on it, and it is not a shape at all.

The bars on the page carry no numbers, for the same reason: five percentages
invite a reader to add them into the rating the page exists not to print.

---

## 4. The comp is a style comp

Matching a prospect to the league's best player would be a quality claim
wearing a style label. So the match reads four ratios and never ability,
minutes or production:

| axis | prospect | player who has played |
|---|---|---|
| range | three-point share of his shot diet | 3PA ÷ FGA |
| rim | rim share of his shot diet | FTA ÷ FGA — who gets hit at the basket |
| creation | pass lean against his shot lean | AST ÷ (AST + FGA) |
| glass | glass lean against his shot lean | OREB ÷ (OREB + FGA) |

The pool is **everyone in the league now and everyone the archives remember**.
Both halves are measured by statistics, because a retired player's tendencies
do not survive him but his season lines do. Bridging tendency to statistic is
only legitimate because the first predicts the second — measured over 359
qualified players in a simulated season:

| | |
|---|---|
| usage → usage per 36 | **+0.80** |
| crash_glass → offensive rebounds per 36 | **+0.78** |
| pass_first → assist share | **+0.76** |
| three_point_rate → 3PA share | +0.59 |
| rim_rate → 3PA share | −0.37 *(correctly negative)* |

Both sides are then percentile-ranked inside their own population, which is
what makes a tendency and a statistic comparable without inventing a regression
between them. A prospect is ranked against **his own class**, which is also the
right cohort for a sentence like "the most perimeter-oriented big in this
class".

Positions are grouped rather than matched exactly — a power forward compared
with a centre is a useful sentence, and one compared with a point guard is not
— and a prospect whose nearest neighbour is still half a league away gets
silence instead of a name that does not fit.

**Does it leak?** Across 360 prospects, the comp's scoring correlates with the
prospect's current ability at **+0.02** and with his ceiling at **−0.05**.

> At n=60 the same figure reads +0.19. It was measured at n=360 because of
> that: a test written against a single class would have reported noise as
> signal.

---

## 5. The write-up

Assembled from the shape rather than written beside it, so it cannot drift from
the card it describes — the discipline `mock_draft.note_for` and the trade
engine's explanations already follow.

**It leads with what a man does most, not what he does most unusually.**
Ranking by lift against position peers instead led with a scoring guard's third
habit, calling someone who takes 18% of his shots from the post a post player.
Lift now decides only how emphatically the lead is put, and earns its own
sentence when a habit is genuinely unusual for the position:

> A scoring guard who spaces the floor and shoots from range, looks for his own
> shot first. Unusually for the position, he also works with his back to the
> basket. He is about the size the position expects.

**The vocabulary grades nothing.** There is no *elite*, no *raw*, no *polished*,
no *limited* — the words a scouting report normally lives on, every one of them
a claim about ability. `tests/test_scouting.py` audits the whole class for them.

---

## 6. Testing a negative

Most of this file's tests pin what the feature **must not** do, and they are
correlations rather than assertions about one player. A card can be free of
ability numbers and still be a perfect proxy for one — that was the first
design — and only a measurement over a population tells those two apart.

Three tests are worth knowing about:

* **`test_raw_tendencies_would_have_leaked`** — establishes the danger is real
  rather than theoretical. If it ever goes quiet, the composition is no longer
  doing any work and somebody should find out why.
* **`test_scaling_every_tendency_changes_nothing`** — the property the whole
  design rests on. Scaled *down*, because `Tendencies` clamps at 20 and
  multiplying up would measure the clamp.
* **`test_the_threshold_would_actually_catch_a_leak`** — a loose threshold
  passes everything, including a leak. So it builds the leak on purpose, giving
  every prospect the pool player whose scoring rank matches his ability rank,
  and checks the figure goes past the line. It reads **+0.98** against a limit
  of 0.15.

---

## 7. Where it lives

| | |
|---|---|
| `bballsim/scouting.py` | the shape, the write-up, the comp, the card |
| `bballsim/api/payload.py` | rides along with `offseason_preview` |
| Offseason → Prospects | the board, filterable by position |
| `tests/test_scouting.py` | 17 tests |

### One bug worth recording

The comp qualifier was a flat 20 games and 100 shots, which is a qualifier that
only works in April. In November nobody has played twenty games, so the pool
came back empty and every prospect on the board read *"nobody in the league
closely enough"* — for the two months of the year a draft preview is most worth
reading. It is a share of what has been played now, like the record book's rate
qualifier and the All-Star ballot's games floor.
