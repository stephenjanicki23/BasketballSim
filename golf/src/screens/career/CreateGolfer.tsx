/**
 * Create a golfer: who they are, what kind of player, and where the points go.
 *
 * Four steps, and the second and third are the ones that matter. Choosing an
 * archetype is choosing a set of ceilings you will live with for twenty seasons, so
 * the card shows them — not a blurb about being "powerful", the actual numbers and
 * the actual limits. Allocating points then happens *against* those ceilings, with
 * every bar showing where it can eventually reach, so the trade-off is visible
 * while it is being made rather than discovered four seasons later.
 *
 * Everything shown here is computed by the same rulebook the backend enforces, so
 * the preview cannot promise a golfer the backend will refuse.
 */

import { useMemo, useState } from 'react';

import { Panel, RatingChip, ratingColour } from '../../components/ui';
import { SkillBar, shapeOf } from '../../components/SkillBar';
import { RadarChart } from '../../components/RadarChart';
import {
  CAREER_ARCHETYPES, CREATION, NATIONALITIES, PUTTING_STYLE_CHOICES, SKILL_LINES,
  baseLines, buildCreatedGolfer, startingCapForLine, startingLineCost, startingSpend,
  validateCreation, type CareerArchetype, type SkillLineId, type SkillLines,
} from '../../career';
import { PUTTING_STYLES } from '../../simulation/golferEngine';
import { currentAbility } from '../../simulation/golferEngine';
import { useStore } from '../../state/store';
import type { PuttingStyleId } from '../../simulation/types';

type Step = 'identity' | 'archetype' | 'skills' | 'review';

const STEPS: { id: Step; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'archetype', label: 'Archetype' },
  { id: 'skills', label: 'Skills' },
  { id: 'review', label: 'Review' },
];

const LINE_NAMES = Object.fromEntries(SKILL_LINES.map((line) => [line.id, line.name]));
const SECTIONS = [...new Set(SKILL_LINES.map((line) => line.section))];

export function CreateGolfer(): JSX.Element {
  const { career } = useStore();
  const [step, setStep] = useState<Step>('identity');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState(NATIONALITIES[0].country);
  const [archetypeId, setArchetypeId] = useState<CareerArchetype['id'] | null>(null);
  const [puttingStyle, setPuttingStyle] = useState<PuttingStyleId>('steady');
  const [lines, setLines] = useState<SkillLines>(baseLines);

  const archetype = archetypeId ? CAREER_ARCHETYPES.find((entry) => entry.id === archetypeId) ?? null : null;

  /** Clamp every line into the new archetype's ceilings when the choice changes. */
  const chooseArchetype = (next: CareerArchetype) => {
    setArchetypeId(next.id);
    setLines((current) => {
      const clamped = { ...current };
      for (const line of SKILL_LINES) {
        clamped[line.id] = Math.min(clamped[line.id], startingCapForLine(next.id, line.id));
      }
      return clamped;
    });
  };

  const spent = startingSpend(lines);
  const left = CREATION.startingSkillPoints - spent;

  /** What one more point on this line would cost, and whether it can be afforded. */
  const stepUpCost = (line: SkillLineId): number => startingLineCost(lines[line] + 1) - startingLineCost(lines[line]);

  const setLine = (line: SkillLineId, next: number) => {
    if (!archetype) return;
    const cap = startingCapForLine(archetype.id, line);
    const clamped = Math.max(CREATION.minRating, Math.min(cap, Math.round(next)));
    setLines((current) => {
      const candidate = { ...current, [line]: clamped };
      // Never let the slider put the build over budget: the rule is the same one
      // the backend applies, so the UI simply refuses to show an illegal state.
      if (startingSpend(candidate) > CREATION.startingSkillPoints) return current;
      return candidate;
    });
  };

  const preview = useMemo(() => {
    if (!archetype) return null;
    const validated = validateCreation({
      firstName: firstName || 'New', lastName: lastName || 'Golfer', displayName,
      country, archetype: archetype.id, puttingStyle, lines,
    });
    if (!validated.ok) return null;
    return buildCreatedGolfer('preview', validated.value, 2026);
  }, [archetype, firstName, lastName, displayName, country, puttingStyle, lines]);

  const shape = archetype ? shapeOf(lines, LINE_NAMES) : { strengths: [], development: [], absolute: false };
  const identityDone = firstName.trim().length >= CREATION.nameMinLength && lastName.trim().length >= CREATION.nameMinLength;
  const problemFor = (field: string) => career.problems.find((entry) => entry.field === field)?.message;

  const confirm = async () => {
    if (!archetype) return;
    await career.createGolfer({
      firstName, lastName, displayName: displayName || undefined, country,
      archetype: archetype.id, puttingStyle, lines,
    });
  };

  return (
    <div className="screen career">
      <ol className="steps">
        {STEPS.map((entry, index) => {
          const reachable =
            entry.id === 'identity' ||
            (entry.id === 'archetype' && identityDone) ||
            (entry.id !== 'review' && archetype !== null) ||
            (entry.id === 'review' && archetype !== null);
          return (
            <li key={entry.id} className={`steps__item${step === entry.id ? ' steps__item--active' : ''}`}>
              <button type="button" disabled={!reachable} onClick={() => setStep(entry.id)}>
                <span className="steps__number">{index + 1}</span>
                {entry.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="career__split">
        <div className="career__main">
          {step === 'identity' && (
            <Panel title="Who are you?">
              <p className="lede">
                You are turning professional at {CREATION.startingAge}. Everything else is up to you.
              </p>
              <div className="form form--grid">
                <label className="form__field">
                  <span>First name</span>
                  <input name="firstName" id="golf-first-name" value={firstName} maxLength={CREATION.nameMaxLength} onChange={(event) => setFirstName(event.target.value)} />
                  {problemFor('firstName') && <em className="form__error">{problemFor('firstName')}</em>}
                </label>
                <label className="form__field">
                  <span>Last name</span>
                  <input name="lastName" id="golf-last-name" value={lastName} maxLength={CREATION.nameMaxLength} onChange={(event) => setLastName(event.target.value)} />
                  {problemFor('lastName') && <em className="form__error">{problemFor('lastName')}</em>}
                </label>
                <label className="form__field">
                  <span>Name on the leaderboard <em>optional</em></span>
                  <input
                    name="golferDisplayName"
                    id="golf-golfer-display-name"
                    value={displayName}
                    placeholder={`${firstName} ${lastName}`.trim() || 'As it appears on the board'}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label className="form__field">
                  <span>Nationality</span>
                  <select name="country" id="golf-country" value={country} onChange={(event) => setCountry(event.target.value)}>
                    {NATIONALITIES.map((entry) => (
                      <option key={entry.country} value={entry.country}>{entry.flag} {entry.country}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button type="button" className="hit" disabled={!identityDone} onClick={() => setStep('archetype')}>
                  Choose an archetype
                </button>
              </div>
            </Panel>
          )}

          {step === 'archetype' && (
            <Panel title="What kind of player?">
              <p className="lede">
                This is the decision you cannot take back. An archetype sets the ceiling on every part of your
                game for the rest of your career: how good you can <em>ever</em> become at each of them, however
                many seasons you play and however much XP you earn.
              </p>
              <div className="archetypes">
                {CAREER_ARCHETYPES.map((entry) => (
                  <ArchetypeCard
                    key={entry.id}
                    archetype={entry}
                    selected={archetypeId === entry.id}
                    onSelect={() => chooseArchetype(entry)}
                  />
                ))}
              </div>
              {archetype && (
                <div className="button-row">
                  <button type="button" className="hit" onClick={() => setStep('skills')}>
                    Build a {archetype.name} — {CREATION.startingSkillPoints} points to spend
                  </button>
                </div>
              )}
            </Panel>
          )}

          {step === 'skills' && archetype && (
            <Panel
              title="Where do the points go?"
              right={
                <span className={`points${left === 0 ? ' points--spent' : ''}`}>
                  <strong>{left}</strong> of {CREATION.startingSkillPoints} left
                </span>
              }
            >
              <p className="lede">
                Every skill starts at {CREATION.baseRating} and can go as low as {CREATION.minRating} to fund
                another — but a point gets dearer the higher it goes, so you cannot be very good at everything.
                The faint line on each bar is where your {archetype.name} ceiling sits.
              </p>
              {SECTIONS.map((section) => (
                <div key={section} className="skillgroup">
                  <h3>{section}</h3>
                  {SKILL_LINES.filter((line) => line.section === section).map((line) => {
                    const cap = startingCapForLine(archetype.id, line.id);
                    const cost = stepUpCost(line.id);
                    return (
                      <SkillBar
                        key={line.id}
                        name={line.name}
                        value={lines[line.id]}
                        cap={archetype.caps[line.id]}
                        min={CREATION.minRating}
                        max={cap}
                        onChange={(next) => setLine(line.id, next)}
                        hint={
                          lines[line.id] >= cap
                            ? `${line.blurb} — as high as this can start.`
                            : `${line.blurb} — next point costs ${cost}.`
                        }
                      />
                    );
                  })}
                </div>
              ))}
              <div className="button-row">
                <button type="button" className="hit" onClick={() => setStep('review')}>Review the golfer</button>
                <button type="button" className="ghost" onClick={() => setLines(baseLines())}>Start again</button>
              </div>
            </Panel>
          )}

          {step === 'review' && archetype && preview && (
            <Panel title="Ready to turn professional?">
              <div className="review">
                <div className="review__who">
                  <span className="flag flag--large">{NATIONALITIES.find((n) => n.country === country)?.flag}</span>
                  <div>
                    <h3>{displayName || `${firstName} ${lastName}`}</h3>
                    <p>
                      {archetype.name} · {PUTTING_STYLES[puttingStyle].name} · age {CREATION.startingAge} ·{' '}
                      overall ability <RatingChip value={currentAbility(preview)} />
                    </p>
                    <p className="hint">{archetype.plan}</p>
                  </div>
                </div>

                <dl className="review__shape">
                  <dt>{shape.absolute ? 'Strengths, against the tour' : 'Strongest parts of your game'}</dt>
                  <dd>{shape.strengths.join(', ') || '—'}</dd>
                  <dt>{shape.absolute ? 'Development areas' : 'Weakest parts of your game'}</dt>
                  <dd>{shape.development.join(', ') || '—'}</dd>
                  <dt>Career ceilings</dt>
                  <dd>
                    {archetype.strengths.slice(0, 3).map((line) => `${LINE_NAMES[line]} ${archetype.caps[line]}`).join(', ') || 'Everything at 82.'}
                    {archetype.weaknesses.length > 0 && (
                      <> — and never better than {archetype.weaknesses.slice(0, 2).map((line) => `${LINE_NAMES[line]} ${archetype.caps[line]}`).join(' or ')}.</>
                    )}
                  </dd>
                </dl>

                {/*
                  * Unspent points are legal and almost never intended. A budget is
                  * not a maximum to creep up on: a golfer who turns professional
                  * with a third of it unspent is simply a worse golfer for the rest
                  * of their career, and there is nothing later that gives it back.
                  * So say so, loudly, and make going back the easy button.
                  */}
                {left > 0 && (
                  <div className="form__errors form__errors--warn" role="alert">
                    <p>
                      <strong>{left} of your {CREATION.startingSkillPoints} skill points are unspent.</strong> They
                      cannot be saved for later or turned into XP — a golfer who starts with them unspent is
                      permanently behind one who does not.
                    </p>
                  </div>
                )}

                {career.problems.length > 0 && (
                  <div className="form__errors" role="alert">
                    {career.problems.map((entry) => <p key={`${entry.field}:${entry.message}`}>{entry.message}</p>)}
                  </div>
                )}

                <div className="button-row">
                  <button type="button" className="hit" disabled={career.authBusy !== null} onClick={confirm}>
                    {career.authBusy ?? (left > 0 ? `Turn professional anyway` : 'Turn professional')}
                  </button>
                  <button type="button" className={left > 0 ? 'hit' : 'ghost'} onClick={() => setStep('skills')}>
                    {left > 0 ? `Spend the last ${left} points` : 'Change the build'}
                  </button>
                </div>
                <p className="hint">
                  You will join the tour ranked last of {157} card holders, with no XP and nothing on your record.
                  Everything after that is earned.
                </p>
              </div>
            </Panel>
          )}
        </div>

        <aside className="career__side">
          <Panel title="Your golfer">
            {!archetype ? (
              <p className="hint">Choose an archetype and the preview fills in.</p>
            ) : (
              <>
                {preview && <RadarChart golfer={preview} size={230} />}
                <div className="points-readout">
                  <span>Skill points left</span>
                  <strong className={left === 0 ? 'points--spent' : ''}>{left}</strong>
                </div>
                <div className="preview-lines">
                  {SKILL_LINES.map((line) => (
                    <div key={line.id} className="preview-lines__row">
                      <span>{line.name}</span>
                      <span className="preview-lines__value">
                        <b style={{ color: ratingColour(lines[line.id]) }}>{lines[line.id]}</b>
                        <em>→ {archetype.caps[line.id]}</em>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="putting-styles">
                  <h3>Putting style</h3>
                  <p className="hint">Biases the ratings it describes, and how boldly you take putts on.</p>
                  {PUTTING_STYLE_CHOICES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`chip-button${puttingStyle === id ? ' chip-button--active' : ''}`}
                      onClick={() => setPuttingStyle(id)}
                      title={PUTTING_STYLES[id].blurb}
                    >
                      {PUTTING_STYLES[id].name}
                    </button>
                  ))}
                  <p className="hint">{PUTTING_STYLES[puttingStyle].blurb}</p>
                </div>
              </>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** One archetype, with the ceilings that make it a choice rather than a label. */
function ArchetypeCard({
  archetype,
  selected,
  onSelect,
}: {
  archetype: CareerArchetype;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button type="button" className={`archetype${selected ? ' archetype--selected' : ''}`} onClick={onSelect}>
      <header>
        <strong>{archetype.name}</strong>
        <em>{archetype.tagline}</em>
      </header>
      <p>{archetype.blurb}</p>
      <div className="archetype__caps">
        {archetype.strengths.slice(0, 3).map((line) => (
          <span key={line} className="archetype__cap archetype__cap--up">
            {LINE_NAMES[line]} <b>{archetype.caps[line]}</b>
          </span>
        ))}
        {archetype.weaknesses.slice(0, 2).map((line) => (
          <span key={line} className="archetype__cap archetype__cap--down">
            {LINE_NAMES[line]} <b>{archetype.caps[line]}</b>
          </span>
        ))}
        {archetype.strengths.length === 0 && archetype.weaknesses.length === 0 && (
          <span className="archetype__cap">Every skill capped at {archetype.caps.power} — no peak, no hole.</span>
        )}
      </div>
    </button>
  );
}
