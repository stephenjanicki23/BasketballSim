/**
 * The putting decision.
 *
 * One read of the green, one number for what a normal stroke holes, and two
 * strategies with their real consequences beside them. The player presses a
 * button; the engine rolls the ball. There is no line to draw and no meter to
 * time, because the interesting question on a green is not whether you can aim a
 * mouse — it is whether this golfer, on this green, at this moment in the
 * tournament, should be trying to hole it at all.
 */

import { PUTT_INTENTS, type PuttIntentId } from '../simulation/config';
import type { PuttDecision, PuttOption } from '../simulation/puttingEngine';
import { PUTTING_STYLES } from '../simulation/golferEngine';
import { Panel, Stat, feet, ordinal, pct } from './ui';
import type { Golfer } from '../simulation/types';

const INTENT_TONE: Record<PuttIntentId, string> = {
  safe: 'putt-option--safe',
  lag: 'putt-option--lag',
  attack: 'putt-option--attack',
};

function Stars({ level }: { level: number }): JSX.Element {
  return (
    <span className="stars" aria-label={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= level ? 'stars__on' : 'stars__off'}>
          ★
        </span>
      ))}
    </span>
  );
}

function OptionCard({
  option,
  onChoose,
  disabled,
  recommended,
}: {
  option: PuttOption;
  onChoose: (intent: PuttIntentId) => void;
  disabled: boolean;
  recommended: boolean;
}): JSX.Element {
  const profile = PUTT_INTENTS[option.intent];
  return (
    <div className={`putt-option ${INTENT_TONE[option.intent]}`}>
      <div className="putt-option__head">
        <strong>{profile.name}</strong>
        {recommended && <span className="badge badge--small">Caddie</span>}
      </div>
      <p>{profile.blurb}</p>
      <dl className="putt-option__numbers">
        <div>
          <dt>Make</dt>
          <dd>{pct(option.make, 0)}</dd>
        </div>
        <div>
          <dt>3-putt risk</dt>
          <dd className={option.threePutt > 0.12 ? 'over' : ''}>{pct(option.threePutt, 0)}</dd>
        </div>
        <div>
          <dt>Expected leave</dt>
          <dd>{feet(option.expectedLeaveFeet)}</dd>
        </div>
        <div>
          <dt>Inside 3 ft</dt>
          <dd>{pct(option.within3, 0)}</dd>
        </div>
      </dl>
      <button type="button" className="hit" onClick={() => onChoose(option.intent)} disabled={disabled}>
        {profile.name}
      </button>
    </div>
  );
}

export function PuttPanel({
  decision,
  golfer,
  holeNumber,
  recommended,
  onChoose,
  disabled,
}: {
  decision: PuttDecision;
  golfer: Golfer;
  holeNumber: number;
  recommended: PuttIntentId | null;
  onChoose: (intent: PuttIntentId) => void;
  disabled: boolean;
}): JSX.Element {
  const { read } = decision;
  const style = PUTTING_STYLES[golfer.puttingStyle];

  return (
    <div className="shot-controls">
      <Panel className="panel--tight">
        <div className="putt-head">
          <h3>
            {ordinal(holeNumber)} hole — {feet(read.distanceFeet)} {decision.forScore}
          </h3>
          <p className="putt-head__green">
            {read.speedLabel} · {read.breakLabel} · {read.gradeLabel}
          </p>
          <div className="putt-head__row">
            <span>Putt difficulty</span>
            <Stars level={read.difficulty} />
          </div>
          <div className="putt-head__make">
            <span>Estimated make chance</span>
            <strong>{pct(decision.estimatedMake, 0)}</strong>
          </div>
        </div>
        <div className="stat-row stat-row--compact">
          <Stat label="Putting" value={golfer.ratings.putting} />
          <Stat label="Green reading" value={golfer.ratings.greenReading} />
          <Stat label="Speed control" value={golfer.ratings.speedControl} />
          <Stat label="Lag" value={golfer.ratings.lagPutting} />
        </div>
        <p className="hint">
          {style.name}: {style.blurb}
        </p>
      </Panel>

      <Panel title="Choose your approach" className="panel--tight">
        <div className="putt-options">
          {decision.options.map((option) => (
            <OptionCard
              key={option.intent}
              option={option}
              onChoose={onChoose}
              disabled={disabled}
              recommended={recommended === option.intent}
            />
          ))}
        </div>
        <p className="hint">
          Plays {feet(read.playsLikeFeet)} once the hill is taken into account
          {Math.abs(read.breakFeet) >= 0.2
            ? `, and breaks ${feet(Math.abs(read.breakFeet))} ${read.breakFeet > 0 ? 'to the right' : 'to the left'}.`
            : '.'}
        </p>
      </Panel>
    </div>
  );
}
