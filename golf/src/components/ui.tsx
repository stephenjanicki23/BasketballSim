/** Small shared building blocks and formatters. */

import type { ReactNode } from 'react';

export function Panel({ title, children, right, className }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {title && (
        <header className="panel__head">
          <h2>{title}</h2>
          {right}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'bad' | 'warn' }): JSX.Element {
  return (
    <div className={tone ? `stat stat--${tone}` : 'stat'}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}

export function Bar({ value, max = 100, tone }: { value: number; max?: number; tone?: string }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar__fill" style={{ width: `${pct}%`, background: tone ?? ratingColour(value) }} />
    </div>
  );
}

export function RatingChip({ value }: { value: number }): JSX.Element {
  return (
    <span className="chip" style={{ background: ratingColour(value), color: value >= 62 ? '#08130b' : '#f6f6f2' }}>
      {Math.round(value)}
    </span>
  );
}

/** A 1–100 rating's colour. Professional golf is a narrow band, so the scale is too. */
export function ratingColour(value: number): string {
  if (value >= 92) return '#59d98a';
  if (value >= 84) return '#7ed37f';
  if (value >= 76) return '#b4d271';
  if (value >= 68) return '#e0c96a';
  if (value >= 58) return '#e0a05f';
  if (value >= 48) return '#d87d5c';
  return '#c9605a';
}

export function toPar(value: number): string {
  if (value === 0) return 'E';
  return value > 0 ? `+${value}` : `${value}`;
}

export function toParClass(value: number): string {
  return value < 0 ? 'under' : value > 0 ? 'over' : 'level';
}

export function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function yards(value: number): string {
  return `${Math.round(value)} yd`;
}

export function feet(value: number): string {
  return value < 1 ? `${Math.round(value * 12)} in` : `${value.toFixed(1)} ft`;
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="empty">{children}</p>;
}
