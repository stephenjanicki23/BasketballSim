/**
 * Weather, and the one thing the player actually has to read: the wind.
 *
 * Wind is stored once for a round, as a compass direction and a speed, and each
 * hole resolves it against its own bearing. That is why the 4th plays downwind
 * and the 8th plays into it on the same afternoon, and why a links round never
 * feels like eighteen copies of the same hole.
 */

import { clamp, createRng, lerp, type Rng } from './rng';
import type { Conditions, Course, SkyId, Weather } from './types';
import { styleFor } from './courseEngine';

interface SkyProfile {
  id: SkyId;
  label: string;
  /** Relative likelihood, before the course's own bias. */
  weight: number;
  windMultiplier: number;
  tempOffset: number;
  rain: number;
}

const SKIES: SkyProfile[] = [
  { id: 'clear', label: 'Clear', weight: 26, windMultiplier: 0.75, tempOffset: 4, rain: 0 },
  { id: 'cloudy', label: 'Cloudy', weight: 24, windMultiplier: 0.95, tempOffset: -1, rain: 0 },
  { id: 'windy', label: 'Windy', weight: 20, windMultiplier: 1.65, tempOffset: -3, rain: 0.05 },
  { id: 'rain', label: 'Rain', weight: 12, windMultiplier: 1.15, tempOffset: -6, rain: 0.55 },
  { id: 'heavyRain', label: 'Heavy Rain', weight: 5, windMultiplier: 1.35, tempOffset: -9, rain: 1 },
  { id: 'hot', label: 'Hot', weight: 8, windMultiplier: 0.7, tempOffset: 11, rain: 0 },
  { id: 'cold', label: 'Cold', weight: 5, windMultiplier: 1.1, tempOffset: -16, rain: 0.1 },
];

/** Each venue gets its own weather personality. */
const COURSE_BIAS: Record<string, Partial<Record<SkyId, number>>> = {
  links: { windy: 2.5, rain: 1.6, heavyRain: 1.5, cold: 1.6, hot: 0.15, clear: 0.7 },
  desert: { hot: 4.5, clear: 2.2, rain: 0.12, heavyRain: 0.04, cold: 0.15, windy: 0.7 },
  parkland: { cloudy: 1.5, rain: 1.5, heavyRain: 1.2, windy: 0.55, hot: 0.8 },
};

export function generateWeather(course: Course, rng: Rng, previous?: Weather): Weather {
  const style = styleFor(course.style);
  const bias = COURSE_BIAS[course.style] ?? {};
  const weighted = SKIES.map((sky) => ({ sky, weight: sky.weight * (bias[sky.id] ?? 1) }));
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);

  let roll = rng.next() * total;
  let chosen = weighted[0].sky;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) {
      chosen = entry.sky;
      break;
    }
  }

  // Weather has momentum: tomorrow starts from today.
  const baseWind = style.baseWind * chosen.windMultiplier * rng.range(0.75, 1.3);
  const windSpeed = clamp(previous ? lerp(previous.windSpeed, baseWind, 0.68) : baseWind, 1, 42);
  const windFrom = previous
    ? (previous.windFrom + rng.range(-55, 55) + 360) % 360
    : rng.range(0, 360);
  const gust = clamp(windSpeed * rng.range(0.18, 0.55) + (chosen.id === 'windy' ? 4 : 0), 0, 22);
  const temperature = clamp(
    style.baseTemp + chosen.tempOffset + rng.range(-6, 6) + (previous ? (previous.temperature - style.baseTemp) * 0.3 : 0),
    24,
    116,
  );
  const rain = clamp(chosen.rain * rng.range(0.7, 1.25), 0, 1);

  // Rain softens everything: the ground stops running and the greens hold.
  const softness = clamp(rain * 0.9 + (previous ? previous.softness * 0.35 : 0), 0, 1);
  const firmness = style.firmness * lerp(1, 0.62, softness);
  const greenSpeed = style.greenSpeed * lerp(1, 0.86, softness) - windSpeed * 0.004;
  const greenFirmness = clamp(style.greenFirmness * lerp(1, 0.68, softness), 25, 100);

  return {
    sky: chosen.id,
    label: chosen.label,
    windSpeed,
    windFrom,
    gust,
    temperature,
    rain,
    softness,
    greenSpeed,
    greenFirmness,
    firmness,
  };
}

export function conditionsFor(weather: Weather, seed: string): Conditions {
  return { weather, gustPhase: createRng(seed).range(0, Math.PI * 2) };
}

/** Wind as it applies to one shot: sustained speed plus whatever the gust is doing. */
export function gustedWind(conditions: Conditions, shotIndex: number): number {
  const { weather, gustPhase } = conditions;
  const wave =
    0.5 * Math.sin(shotIndex * 0.9 + gustPhase) +
    0.3 * Math.sin(shotIndex * 2.3 + gustPhase * 2.1) +
    0.2 * Math.sin(shotIndex * 5.1 + gustPhase * 0.6);
  return Math.max(0, weather.windSpeed + weather.gust * wave);
}

export interface WindComponents {
  /** mph, positive into the player's face. */
  head: number;
  /** mph, positive pushing the ball to the right. */
  cross: number;
  speed: number;
  /** Compass direction the wind blows toward. */
  toward: number;
  label: string;
  /** Short tag: 'Into', 'Down', 'Across'. */
  axis: string;
}

/**
 * Resolve the round's wind against a hole (or a shot) bearing.
 * `bearing` is the compass direction the shot is being played toward.
 */
export function windComponents(weather: Weather, bearing: number, speed = weather.windSpeed): WindComponents {
  const toward = (weather.windFrom + 180) % 360;
  const theta = ((toward - bearing) * Math.PI) / 180;
  const head = -speed * Math.cos(theta);
  const cross = speed * Math.sin(theta);
  const axis = Math.abs(head) > Math.abs(cross) ? (head > 0 ? 'Into' : 'Down') : 'Across';
  const side = cross > 0 ? 'L→R' : 'R→L';
  const label =
    speed < 3
      ? 'Calm'
      : axis === 'Across'
        ? `${Math.round(speed)} mph across, ${side}`
        : `${Math.round(Math.abs(head))} mph ${head > 0 ? 'into' : 'down'}, ${Math.abs(cross) > 3 ? side : 'straight'}`;
  return { head, cross, speed, toward, label, axis };
}

/** Human-readable summary for the tournament and home screens. */
export function describeWeather(weather: Weather): string {
  const wind = weather.windSpeed < 5 ? 'calm' : `${Math.round(weather.windSpeed)} mph wind`;
  return `${weather.label}, ${Math.round(weather.temperature)}°F, ${wind}`;
}

export function compassName(degrees: number): string {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** Benign practice-round conditions, for the range and for tests. */
export function calmWeather(course: Course): Weather {
  const style = styleFor(course.style);
  return {
    sky: 'clear',
    label: 'Clear',
    windSpeed: 4,
    windFrom: 225,
    gust: 1,
    temperature: style.baseTemp,
    rain: 0,
    softness: 0,
    greenSpeed: style.greenSpeed,
    greenFirmness: style.greenFirmness,
    firmness: style.firmness,
  };
}
