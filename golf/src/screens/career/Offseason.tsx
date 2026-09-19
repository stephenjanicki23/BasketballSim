/**
 * The offseason: what the year was worth, and what to do with it.
 *
 * Built around one idea — that spending XP should feel like a decision about a
 * career rather than shopping. So every line shows its price *and* its ceiling
 * together, the soft cap is stated in plain words when it starts charging more
 * ("the last few points of a specialism are the expensive ones"), and what the
 * years have taken is shown beside what the season earned, because at 34 those are
 * the two halves of the same calculation.
 *
 * Nothing is committed until the player asks for it. The basket is local; pressing
 * the button sends one request, the backend prices the whole thing again, and it is
 * all-or-nothing.
 */

import { useMemo, useState } from 'react';

import { Empty, Panel, Stat, money, ordinal } from '../../components/ui';
import { SkillBar } from '../../components/SkillBar';
import {
  PROGRESSION, SKILL_LINES, SKILL_LINE_BY_ID, ageAdjustment, ageNotes, careerArchetype, effectiveLines,
  lineCaps, sortedEntries, stepCost, type SkillLineId,
} from '../../career';
import { useStore } from '../../state/store';

const SECTIONS = [...new Set(SKILL_LINES.map((line) => line.section))];

export function Offseason(): JSX.Element {
  const { career: careerState, universe } = useStore();
  const career = careerState.career!;
  const [basket, setBasket] = useState<Partial<Record<SkillLineId, number>>>({});

  const season = career.seasons[0];
  const archetype = careerArchetype(career.archetype);
  const caps = lineCaps(career.archetype);
  const effective = effectiveLines(career);
  const adjust = ageAdjustment(career.age);
  const notes = ageNotes({ archetype: career.archetype, lines: career.lines, age: career.age - 1 }, career.age);

  /**
   * Price the basket the way the backend will: in order, one point at a time, so
   * the second point of a line costs more than the first and the total is the
   * number the request will actually be charged.
   */
  const priced = useMemo(() => {
    const running = { ...career.lines };
    let total = 0;
    const perLine: Partial<Record<SkillLineId, { points: number; xp: number }>> = {};
    for (const line of SKILL_LINES) {
      const wanted = basket[line.id] ?? 0;
      if (!wanted) continue;
      const cap = caps[line.id];
      let xp = 0;
      let bought = 0;
      for (let n = 0; n < wanted && running[line.id] < cap; n++) {
        xp += stepCost(running[line.id], cap);
        running[line.id]++;
        bought++;
      }
      if (bought) perLine[line.id] = { points: bought, xp };
      total += xp;
    }
    return { total, perLine };
  }, [basket, career]);

  const remaining = career.availableXp - priced.total;
  const busy = careerState.authBusy !== null;

  const alreadyGained = (line: SkillLineId) => career.gainedThisOffseason[line] ?? 0;

  const add = (line: SkillLineId, delta: number) => {
    setBasket((current) => {
      const cap = caps[line];
      const headroomToCeiling = cap - career.lines[line];
      const headroomThisWinter = PROGRESSION.maxGainPerLinePerOffseason - alreadyGained(line);
      const next = Math.max(0, Math.min(headroomToCeiling, headroomThisWinter, (current[line] ?? 0) + delta));
      return { ...current, [line]: next };
    });
  };

  const commitSpend = async () => {
    if (priced.total === 0) return;
    const ok = await careerState.spendXp(basket);
    if (ok) setBasket({});
  };

  return (
    <div className="screen career">
      <Panel
        title={`Offseason — ${season ? season.season : universe.season - 1} in the books`}
        right={<span className="badge">Season {career.careerSeason - 1} of your career complete</span>}
      >
        {season ? (
          <>
            <div className="stat-row">
              <Stat label="Events" value={season.events} hint={`${season.cutsMade} cuts made`} />
              <Stat label="Wins" value={season.wins} tone={season.wins > 0 ? 'good' : undefined} />
              <Stat label="Top tens" value={season.top10s} hint={`${season.top25s} top 25s`} />
              <Stat label="Scoring average" value={season.scoringAverage ? season.scoringAverage.toFixed(2) : '—'} />
              <Stat label="Earnings" value={money(season.earnings)} />
              <Stat label="Points standings" value={season.standingsRank ? ordinal(season.standingsRank) : '—'} />
              <Stat label="World ranking" value={season.worldRank ? ordinal(season.worldRank) : '—'} />
              <Stat label="Best finish" value={season.bestFinish ? ordinal(season.bestFinish) : 'Missed every cut'} />
              <Stat label="Birdies" value={season.birdies} hint={`${season.eagles} eagles`} />
              <Stat
                label="Ability"
                value={season.abilityBefore || '—'}
                hint={`age ${season.age} → ${career.age}`}
              />
            </div>

            <div className="xp-banner">
              <div>
                <span>XP earned this season</span>
                <strong>{season.xpEarned.toLocaleString()}</strong>
              </div>
              <div>
                <span>XP available to spend</span>
                <strong className="xp-banner__available">{career.availableXp.toLocaleString()}</strong>
              </div>
              <div>
                <span>Earned over the career</span>
                <strong>{career.experience.toLocaleString()}</strong>
              </div>
            </div>

            <details className="ledger">
              <summary>Where the {season.xpEarned.toLocaleString()} XP came from</summary>
              <ul>
                {sortedEntries(career.pending).map((entry) => (
                  <li key={entry.reason}>
                    <span>{entry.label}{entry.count > 1 ? ` × ${entry.count}` : ''}</span>
                    <b>{entry.xp.toLocaleString()}</b>
                  </li>
                ))}
                {career.pending.entries.length === 0 && <li><span>Nothing recorded this season.</span></li>}
              </ul>
            </details>
          </>
        ) : (
          <Empty>No season on the record yet.</Empty>
        )}

        {notes.length > 0 && (
          <div className="agenotes">
            <h3>A year older</h3>
            <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </div>
        )}
      </Panel>

      <div className="career__split">
        <div className="career__main">
          <Panel title="Development">
            <p className="lede">
              Buy rating points with XP. A point costs more the higher the rating already is, and the last few
              points before your {archetype.name} ceiling cost several times list price — reaching the top of an
              archetype is meant to be the work of a career. No line can move more than{' '}
              {PROGRESSION.maxGainPerLinePerOffseason} in one winter.
            </p>
            {SECTIONS.map((section) => (
              <div key={section} className="skillgroup">
                <h3>{section}</h3>
                {SKILL_LINES.filter((line) => line.section === section).map((line) => {
                  const cap = caps[line.id];
                  const bought = career.lines[line.id];
                  const pending = priced.perLine[line.id]?.points ?? 0;
                  const next = bought + pending;
                  const atCeiling = next >= cap;
                  const winterLeft = PROGRESSION.maxGainPerLinePerOffseason - alreadyGained(line.id) - pending;
                  const cost = atCeiling ? null : stepCost(next, cap);
                  const multiplier = cost !== null ? cost / stepCost(next, next + 40) : 1;
                  return (
                    <div key={line.id} className="upgrade">
                      <SkillBar
                        name={line.name}
                        value={bought}
                        cap={cap}
                        pending={pending}
                        from={career.startingLines[line.id]}
                        hint={
                          atCeiling
                            ? `At the ceiling for a ${archetype.name}. Nothing more to buy, ever.`
                            : winterLeft <= 0
                              ? `Already up ${PROGRESSION.maxGainPerLinePerOffseason} this winter — the rest waits for next year.`
                              : multiplier > 1.2
                                ? `Next point ${cost!.toLocaleString()} XP — ${multiplier.toFixed(1)}× list price this close to the ceiling.`
                                : `Next point ${cost!.toLocaleString()} XP.`
                        }
                      />
                      <div className="upgrade__buttons">
                        <button type="button" disabled={pending === 0} onClick={() => add(line.id, -1)} aria-label={`One less ${line.name}`}>−</button>
                        <span className="upgrade__count">{pending > 0 ? `+${pending}` : '—'}</span>
                        <button
                          type="button"
                          disabled={atCeiling || winterLeft <= 0 || cost === null || cost > remaining}
                          onClick={() => add(line.id, 1)}
                          aria-label={`One more ${line.name}`}
                        >
                          +
                        </button>
                        <span className="upgrade__cost">
                          {atCeiling ? 'maxed' : cost !== null && cost > remaining ? 'not enough XP' : `${cost?.toLocaleString()} XP`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </Panel>
        </div>

        <aside className="career__side">
          <Panel title="Spending">
            <div className="xp-summary">
              <div><span>Available</span><b>{career.availableXp.toLocaleString()}</b></div>
              <div><span>In the basket</span><b>{priced.total.toLocaleString()}</b></div>
              <div className={remaining < 0 ? 'xp-summary--bad' : ''}><span>Left over</span><b>{remaining.toLocaleString()}</b></div>
            </div>

            {Object.keys(priced.perLine).length > 0 ? (
              <ul className="basket">
                {(Object.entries(priced.perLine) as [SkillLineId, { points: number; xp: number }][]).map(([line, entry]) => (
                  <li key={line}>
                    <span>{SKILL_LINE_BY_ID[line].name}</span>
                    <em>
                      {career.lines[line]} → {career.lines[line] + entry.points}
                    </em>
                    <b>{entry.xp.toLocaleString()}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">Nothing selected. You can also bank the XP and spend it next winter — it does not expire.</p>
            )}

            {careerState.problems.length > 0 && (
              <div className="form__errors" role="alert">
                {careerState.problems.map((entry) => <p key={`${entry.field}:${entry.message}`}>{entry.message}</p>)}
              </div>
            )}

            <div className="button-row">
              <button type="button" className="hit" disabled={busy || priced.total === 0 || remaining < 0} onClick={commitSpend}>
                {careerState.authBusy ?? `Put in the work — ${priced.total.toLocaleString()} XP`}
              </button>
              <button type="button" className="ghost" disabled={busy || priced.total === 0} onClick={() => setBasket({})}>
                Clear
              </button>
            </div>

            <hr />

            <p className="hint">
              When you are done, the {universe.season} season starts. Unspent XP carries over.
            </p>
            <button
              type="button"
              className="hit hit--wide"
              disabled={busy}
              onClick={() => void careerState.finishOffseason()}
            >
              Start the {universe.season} season
            </button>
          </Panel>

          <Panel title="Where the years went">
            <p className="hint">
              Your golfer is {career.age}. Nothing here is bought — it is what age does on its own, on top of
              whatever you buy.
            </p>
            <ul className="drift">
              {SKILL_LINES.filter((line) => (adjust[line.id] ?? 0) !== 0).map((line) => (
                <li key={line.id} className={(adjust[line.id] ?? 0) < 0 ? 'drift--down' : 'drift--up'}>
                  <span>{line.name}</span>
                  <b>{(adjust[line.id] ?? 0) > 0 ? '+' : ''}{adjust[line.id]}</b>
                  <em>{effective[line.id]} as played</em>
                </li>
              ))}
              {SKILL_LINES.every((line) => (adjust[line.id] ?? 0) === 0) && (
                <li><span>Nothing yet. Physical decline starts after {PROGRESSION.age.declineFrom}.</span></li>
              )}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

