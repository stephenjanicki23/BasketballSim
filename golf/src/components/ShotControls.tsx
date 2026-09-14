/**
 * Everything the player needs to make one decision.
 *
 * The point of this panel is that the answer to "what happens if I hit this
 * club at that spot" is never a mystery: the yardage, what it plays like after
 * wind and hill, how wide the golfer's own dispersion is, and the resulting odds
 * on every outcome including the water. The player still has to decide whether
 * the reward is worth it.
 */

import { CLUB_BY_ID, LIES, SHOT_TYPES, type ShotTypeId } from '../simulation/config';
import { availableShotTypes, legalClubs, sigmaForShare } from '../simulation/shotEngine';
import { bagFor } from '../simulation/golferEngine';
import { type PlanView, sessionContext, type PlaySession } from '../game/session';
import { dist } from '../simulation/geometry';
import { feet, Panel, pct, Stat, yards } from './ui';
import { useStore } from '../state/store';
import type { ClubId, Golfer } from '../simulation/types';

const RISK_ROWS: { key: 'fairway' | 'green' | 'rough' | 'sand' | 'water' | 'trees' | 'ob'; label: string; tone: string }[] = [
  { key: 'green', label: 'Green', tone: '#6fd08a' },
  { key: 'fairway', label: 'Fairway', tone: '#9dc86a' },
  { key: 'rough', label: 'Rough', tone: '#b0a05a' },
  { key: 'sand', label: 'Sand', tone: '#e2cd94' },
  { key: 'trees', label: 'Trees / straw', tone: '#7f6a4e' },
  { key: 'water', label: 'Water', tone: '#4f9ad0' },
  { key: 'ob', label: 'Out of bounds', tone: '#d0655f' },
];

export function ShotControls({ session, golfer, plan }: { session: PlaySession; golfer: Golfer; plan: PlanView }): JSX.Element {
  const { pickClub, pickShotType, nudge, nudgeLength, playShot, zones, setZones } = useStore();
  const ctx = sessionContext(session, golfer);
  const bag = bagFor(golfer);
  const distanceToTarget = dist(session.ball, session.target);
  const lie = LIES[session.lie];
  const disabled = session.status !== 'aiming';

  const clubs = session.lie === 'green' ? [] : legalClubs(ctx);
  const types = session.lie === 'green' ? ['putt' as ShotTypeId] : availableShotTypes(ctx, distanceToTarget);

  return (
    <div className="shot-controls">
      {plan.kind === 'swing' ? (
        <Panel title="The shot" className="panel--tight">
          <div className="stat-row">
            <Stat label="To target" value={yards(plan.plan.distanceToTarget)} />
            <Stat
              label="Plays like"
              value={yards(plan.plan.playsLike)}
              hint={`${plan.plan.elevationDelta >= 0 ? '+' : ''}${Math.round(plan.plan.elevationDelta)} ft · wind ${plan.plan.wind.carryDelta >= 0 ? '+' : ''}${Math.round(plan.plan.wind.carryDelta)} yd`}
            />
            <Stat label="Expected carry" value={yards(plan.plan.expectedCarry)} hint={`roll ${Math.round(plan.plan.expectedRoll)} yd`} />
            <Stat
              label="Swing"
              value={`${Math.round(plan.plan.swingScale * 100)}%`}
              hint={plan.plan.swingScale > 0.98 ? 'full' : 'controlled'}
            />
          </div>
          <div className="dispersion-summary">
            <div>
              <span className="label">Dispersion (1σ)</span>
              <strong>
                {plan.plan.sigmaLong.toFixed(1)} yd long · {plan.plan.sigmaLat.toFixed(1)} yd wide
              </strong>
            </div>
            <div>
              <span className="label">50% of shots finish inside</span>
              <strong>
                {(plan.plan.sigmaLong * sigmaForShare(0.5) * 2).toFixed(0)} × {(plan.plan.sigmaLat * sigmaForShare(0.5) * 2).toFixed(0)} yd
              </strong>
            </div>
          </div>
          {plan.plan.warnings.length > 0 && (
            <ul className="warnings">
              {plan.plan.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="risk">
            <div className="risk__head">
              <span>Where this shot finishes</span>
              <span>
                {plan.plan.odds.expectedStrokes.toFixed(2)} expected strokes · {yards(plan.plan.odds.proximity)} from the pin
              </span>
            </div>
            {RISK_ROWS.filter((row) => plan.plan.odds[row.key] > 0.004).map((row) => (
              <div className="risk__row" key={row.key}>
                <span className="risk__label">{row.label}</span>
                <span className="risk__bar">
                  <span style={{ width: `${Math.min(100, plan.plan.odds[row.key] * 100)}%`, background: row.tone }} />
                </span>
                <span className="risk__value">{pct(plan.plan.odds[row.key], 0)}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <Panel title="The putt" className="panel--tight">
          <div className="stat-row">
            <Stat label="Distance" value={feet(plan.plan.distanceFeet)} />
            <Stat label="Plays like" value={feet(plan.plan.playsLikeFeet)} hint={plan.plan.speedNote} />
            <Stat label="Break" value={plan.plan.readNote} hint={`side slope ${plan.plan.sideGrade.toFixed(1)}%`} />
            <Stat label="Green speed" value={plan.plan.greenSpeed.toFixed(1)} hint="stimp" />
          </div>
          <div className="dispersion-summary">
            <div>
              <span className="label">Make chance</span>
              <strong>{pct(plan.plan.makeChance, 0)}</strong>
            </div>
            <div>
              <span className="label">Three-putt risk</span>
              <strong>{pct(plan.plan.threePuttChance, 0)}</strong>
            </div>
            <div>
              <span className="label">Expected putts</span>
              <strong>{plan.plan.expectedPutts.toFixed(2)}</strong>
            </div>
          </div>
          <p className="hint">
            The green marker is the line the read says to start it on. Aiming somewhere else is a choice —
            {Math.abs(plan.plan.aimOffsetFeet + plan.plan.breakFeet) < 0.1
              ? ' you are on it.'
              : ` you are ${feet(Math.abs(plan.plan.aimOffsetFeet + plan.plan.breakFeet))} off it.`}
          </p>
        </Panel>
      )}

      <Panel title="Club" className="panel--tight">
        <div className="club-grid">
          {clubs.map((club) => {
            const yardage = bag[club.id].total;
            return (
              <button
                type="button"
                key={club.id}
                className={session.club === club.id ? 'club club--active' : 'club'}
                onClick={() => pickClub(club.id)}
                disabled={disabled}
                title={`${club.name} — ${Math.round(bag[club.id].carry)} carry, ${Math.round(yardage)} total`}
              >
                <span className="club__name">{club.short}</span>
                <span className="club__yards">{Math.round(yardage)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={session.club === 'P' ? 'club club--active' : 'club'}
            onClick={() => pickClub('P')}
            disabled={disabled || (session.lie !== 'green' && session.lie !== 'fringe')}
            title="Putter"
          >
            <span className="club__name">Pt</span>
            <span className="club__yards">—</span>
          </button>
        </div>
        {session.lie !== 'green' && (
          <p className="hint">
            {lie.name}: distance ×{lie.distance.toFixed(2)}, dispersion ×{lie.accuracy.toFixed(2)}. {lie.note}
          </p>
        )}
      </Panel>

      <Panel title="Shot" className="panel--tight">
        <div className="type-grid">
          {types.map((type) => (
            <button
              type="button"
              key={type}
              className={session.shotType === type ? 'type type--active' : 'type'}
              onClick={() => pickShotType(type)}
              disabled={disabled}
              title={SHOT_TYPES[type].blurb}
            >
              {SHOT_TYPES[type].name}
            </button>
          ))}
        </div>
        <p className="hint">{SHOT_TYPES[session.shotType].blurb}</p>
      </Panel>

      <Panel title="Aim" className="panel--tight">
        <div className="aim-controls">
          <div className="aim-controls__row">
            <span>Left / right</span>
            <button type="button" onClick={() => nudge(-10)} disabled={disabled}>−10</button>
            <button type="button" onClick={() => nudge(-3)} disabled={disabled}>−3</button>
            <button type="button" onClick={() => nudge(3)} disabled={disabled}>+3</button>
            <button type="button" onClick={() => nudge(10)} disabled={disabled}>+10</button>
          </div>
          <div className="aim-controls__row">
            <span>Longer / shorter</span>
            <button type="button" onClick={() => nudgeLength(-10)} disabled={disabled}>−10</button>
            <button type="button" onClick={() => nudgeLength(-3)} disabled={disabled}>−3</button>
            <button type="button" onClick={() => nudgeLength(3)} disabled={disabled}>+3</button>
            <button type="button" onClick={() => nudgeLength(10)} disabled={disabled}>+10</button>
          </div>
          <div className="aim-controls__row aim-controls__row--zones">
            <span>Zones</span>
            <label>
              <input type="checkbox" checked={zones.fifty} onChange={(e) => setZones({ ...zones, fifty: e.target.checked })} /> 50%
            </label>
            <label>
              <input type="checkbox" checked={zones.seventyFive} onChange={(e) => setZones({ ...zones, seventyFive: e.target.checked })} /> 75%
            </label>
            <label>
              <input type="checkbox" checked={zones.ninety} onChange={(e) => setZones({ ...zones, ninety: e.target.checked })} /> 90%
            </label>
          </div>
        </div>
        <button type="button" className="hit" onClick={playShot} disabled={disabled}>
          {session.lie === 'green' ? 'Putt' : `Hit ${CLUB_BY_ID[session.club].name}`}
          <span className="hit__hint">space</span>
        </button>
      </Panel>
    </div>
  );
}

export function clubLabel(club: ClubId): string {
  return CLUB_BY_ID[club].name;
}
