/**
 * The physics, with its working shown — a development view, opened with P.
 *
 * Everything on this panel comes from `physicsReport`, which is the same
 * function the automated physics tests read. If the panel says a seven iron out
 * of this lie loses a fifth of its spin, that is the number the engine used.
 */

import { describeModifier, physicsReport, type PhysicsRow } from '../simulation/physicsDebug';
import type { ShotPlan } from '../simulation/shotEngine';
import { Panel } from './ui';

function Rows({ rows }: { rows: PhysicsRow[] }): JSX.Element {
  return (
    <dl className="physics__rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PhysicsPanel({ plan, onClose }: { plan: ShotPlan; onClose: () => void }): JSX.Element {
  const report = physicsReport(plan);
  const lie = plan.lieState;

  return (
    <Panel
      title="Physics"
      right={
        <button type="button" className="ghost ghost--small" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="physics">
        <section>
          <h4>Surface</h4>
          <Rows rows={report.surface} />
        </section>
        <section>
          <h4>Club</h4>
          <Rows rows={report.club} />
        </section>
        <section>
          <h4>Impact</h4>
          <Rows rows={report.impact} />
        </section>
        <section>
          <h4>Flight</h4>
          <Rows rows={report.flight} />
        </section>
        <section>
          <h4>Landing</h4>
          <Rows rows={report.landing} />
        </section>
        <section>
          <h4>Modifiers applied</h4>
          {report.modifiers.length === 0 ? (
            <p className="physics__clean">
              {lie.surface.name}: nothing between the face and the ball. Full ball speed, full spin.
            </p>
          ) : (
            <ul className="physics__modifiers">
              {report.modifiers.map((modifier, index) => {
                const text = describeModifier(modifier);
                const bad = text.startsWith('−') || (modifier.channel === 'contact' && modifier.value < 0.95);
                return (
                  <li key={`${modifier.source}:${modifier.channel}:${index}`} className={bad ? 'is-cost' : 'is-gain'}>
                    <span>{modifier.source}</span>
                    <em>{text}</em>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}
