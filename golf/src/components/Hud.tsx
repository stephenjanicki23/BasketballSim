/**
 * The heads-up display.
 *
 * Everything you need to hit the shot, over the course itself: who is playing
 * and where they stand, the hole, the wind, the club, the lie, and the button
 * that swings it. It is the whole interface on a phone — the panels either side
 * are a drawer away rather than a scroll away — and on a big screen it sits over
 * the course as the quick read while the panels carry the detail.
 *
 * The rule for what belongs here: if you cannot decide the shot without it, it
 * is on the HUD; if it is the reasoning behind the decision, it is in a panel.
 */

import { useState } from 'react';
import { CLUB_BY_ID, LIES, PUTT_INTENTS, SHOT_TYPES } from '../simulation/config';
import { availableShotTypes, legalClubs } from '../simulation/shotEngine';
import { lieStateFor } from '../simulation/lieState';
import { bagFor } from '../simulation/golferEngine';
import { windComponents } from '../simulation/weatherEngine';
import { sessionContext, roundToPar, type PlaySession } from '../game/session';
import { dist } from '../simulation/geometry';
import { toPar, toParClass } from './ui';
import type { PuttDecision } from '../simulation/puttingEngine';
import type { PuttIntentId } from '../simulation/config';
import type { ClubId, Golfer, HoleGeometry } from '../simulation/types';
import type { ShotTypeId } from '../simulation/config';

const SHOT_NAMES = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export interface HudProps {
  session: PlaySession;
  golfer: Golfer;
  hole: HoleGeometry;
  /** Present only on the green. */
  putt: { decision: PuttDecision; recommended: PuttIntentId; onChoose: (intent: PuttIntentId) => void } | null;
  onSwing: () => void;
  onPickClub: (club: ClubId) => void;
  onPickShotType: (type: ShotTypeId) => void;
  onCaddie: () => void;
  onDrawer: (side: 'left' | 'right') => void;
}

/** The wind as an arrow, with the line of play up the screen. */
function WindArrow({ degrees }: { degrees: number }): JSX.Element {
  return (
    <svg className="hud__wind-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <g transform={`rotate(${degrees} 8 8)`}>
        <path d="M8 1.6 L11.6 9 L8 7.2 L4.4 9 Z" fill="currentColor" />
        <rect x="7.3" y="8.4" width="1.4" height="5.6" fill="currentColor" opacity="0.6" />
      </g>
    </svg>
  );
}

export function Hud(props: HudProps): JSX.Element {
  const { session, golfer, hole, putt, onSwing, onPickClub, onPickShotType, onCaddie, onDrawer } = props;
  const [sheet, setSheet] = useState<'club' | 'shot' | null>(null);

  const aiming = session.status === 'aiming';
  const putting = session.lie === 'green';
  const lie = LIES[session.lie];
  const lieState = lieStateFor(session.lie, session.ball, {
    weather: session.conditions.weather,
  });
  const club = CLUB_BY_ID[session.club];
  const bag = bagFor(golfer);
  const toPin = dist(session.ball, hole.pin);
  const wind = windComponents(session.conditions.weather, hole.spec.bearing);
  const relative = wind.toward - hole.spec.bearing;
  const surname = golfer.name.split(' ').slice(-1)[0].toUpperCase();
  const shotName = SHOT_NAMES[session.strokesThisHole + 1] ?? `${session.strokesThisHole + 1}th`;

  const ctx = sessionContext(session, golfer);
  const clubs = putting ? [] : legalClubs(ctx);
  const types = putting ? [] : availableShotTypes(ctx, dist(session.ball, session.target));

  return (
    <div className="hud">
      {/* --- Who, and where they stand ------------------------------------ */}
      <div className="hud__corner hud__corner--tl">
        <div className="hud__chip hud__chip--player">
          <span className="hud__name">{surname}</span>
          <span className={`hud__score ${toParClass(roundToPar(session))}`}>{toPar(roundToPar(session))}</span>
        </div>
        <div className="hud__sub">
          {shotName} shot · {putting ? `${Math.round(toPin * 3)} ft` : `${Math.round(toPin)} yds`}
        </div>
      </div>

      {/* --- The hole, and the wind --------------------------------------- */}
      <div className="hud__corner hud__corner--tr">
        <div className="hud__chip hud__chip--hole">
          <span className="hud__name">HOLE {hole.spec.number}</span>
          <span className="hud__par">PAR {hole.spec.par}</span>
        </div>
        <div className="hud__sub hud__sub--right">
          {putting ? (
            <>{session.conditions.weather.greenSpeed.toFixed(1)} stimp</>
          ) : (
            <>
              <WindArrow degrees={relative} />
              {Math.round(session.conditions.weather.windSpeed)} mph
              <span className="hud__dim"> · {wind.axis.toLowerCase()}</span>
            </>
          )}
        </div>
      </div>

      <div className="hud__bottom">
      {/* --- The rest of the game, one tap away ---------------------------- */}
      <div className="hud__tabs hud__tabs--stacked">
        <button type="button" onClick={() => onDrawer('left')}>Card</button>
        {!putting && (
          <button type="button" onClick={() => setSheet(sheet === 'shot' ? null : 'shot')} disabled={!aiming}>
            Shot
          </button>
        )}
        {!putting && <button type="button" onClick={onCaddie} disabled={!aiming}>Caddie</button>}
        <button type="button" onClick={() => onDrawer('right')}>Numbers</button>
      </div>

      {/* --- The club and the lie, either side of the swing --------------- */}
      <div className={`hud__bar ${putting ? 'hud__bar--putting' : ''}`}>
        {putting ? null : (
          <button
            type="button"
            className={`hud__chip hud__chip--club ${sheet === 'club' ? 'is-open' : ''}`}
            onClick={() => setSheet(sheet === 'club' ? null : 'club')}
            disabled={!aiming}
          >
            <span className="hud__name">{club.name.toUpperCase()}</span>
            <span className="hud__sub">
              {SHOT_TYPES[session.shotType].name} · {Math.round(bag[session.club].total)} yds
            </span>
          </button>
        )}

        <div className="hud__action">
          {putt ? (
            <div className="hud__putts">
              {putt.decision.options.map((option) => (
                <button
                  type="button"
                  key={option.intent}
                  className={`hud__putt ${putt.recommended === option.intent ? 'is-caddie' : ''}`}
                  onClick={() => putt.onChoose(option.intent)}
                  disabled={!aiming}
                >
                  <strong>{PUTT_INTENTS[option.intent].name}</strong>
                  <span>{Math.round(option.make * 100)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="hud__swing" onClick={onSwing} disabled={!aiming}>
              Swing
            </button>
          )}
        </div>

        {putting ? null : (
          <div className="hud__chip hud__chip--lie hud__chip--static">
            <span className="hud__name">{lie.short.toUpperCase()}</span>
            <span className="hud__sub">{lieState ? `${Math.round(lieState.quality * 100)}% lie` : lie.name}</span>
          </div>
        )}
      </div>

      {/* --- Pickers ------------------------------------------------------- */}
      {sheet === 'club' && (
        <div className="hud__sheet">
          {clubs.map((option) => (
            <button
              type="button"
              key={option.id}
              className={option.id === session.club ? 'is-active' : ''}
              onClick={() => {
                onPickClub(option.id);
                setSheet(null);
              }}
            >
              <strong>{option.short}</strong>
              <span>{Math.round(bag[option.id].total)}</span>
            </button>
          ))}
        </div>
      )}
      {sheet === 'shot' && (
        <div className="hud__sheet hud__sheet--wide">
          {types.map((type) => (
            <button
              type="button"
              key={type}
              className={type === session.shotType ? 'is-active' : ''}
              onClick={() => {
                onPickShotType(type);
                setSheet(null);
              }}
            >
              <strong>{SHOT_TYPES[type].name}</strong>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
