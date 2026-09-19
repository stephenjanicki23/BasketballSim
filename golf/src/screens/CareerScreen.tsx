/**
 * The career screen, which is really four screens.
 *
 * Which one you get is decided by the state of the account rather than by
 * navigation, because at any moment there is exactly one thing a player can
 * usefully do: sign in, make a golfer, spend the winter's XP, or look at what they
 * have built. Routing on state rather than on clicks is also what makes the
 * offseason a real gate — there is no URL that skips it.
 */

import { Panel } from '../components/ui';
import { AccountGate } from './career/AccountGate';
import { CreateGolfer } from './career/CreateGolfer';
import { Offseason } from './career/Offseason';
import { CareerHub } from './career/CareerHub';
import { useStore } from '../state/store';

export function CareerScreen(): JSX.Element {
  const { career } = useStore();

  if (career.starting) {
    return (
      <div className="screen career">
        <Panel title="Career"><p className="hint">Looking for your account…</p></Panel>
      </div>
    );
  }
  if (!career.account) return <AccountGate />;
  if (!career.career) return <CreateGolfer />;
  if (career.career.offseasonOpen) return <Offseason />;
  return <CareerHub />;
}
