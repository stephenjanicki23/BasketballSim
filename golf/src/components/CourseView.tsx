/**
 * The top-down course view: canvas, camera, aiming and the ball-flight animation.
 *
 * The camera always turns the line of play to point up the screen, so a dogleg
 * left looks like a dogleg left whichever way the hole runs on the compass. It
 * frames the ball, the target and the dispersion zone by default, and gets out of
 * the way as soon as the player scrolls or drags.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Camera, fitCamera, toWorld } from './render/camera';
import { drawHole, drawHoleMap } from './render/holeRenderer';
import { type Vec2, blobOutline, dist, norm, sub } from '../simulation/geometry';
import { dispersionContour, sigmaForShare, type ShotPlan } from '../simulation/shotEngine';
import type { PuttPlan } from '../simulation/puttingEngine';
import type { FlightAnimation } from '../game/session';
import type { HoleGeometry } from '../simulation/types';

export interface CourseViewProps {
  hole: HoleGeometry;
  ball: Vec2;
  target: Vec2 | null;
  plan: ShotPlan | null;
  putt: PuttPlan | null;
  shotLines: { from: Vec2; to: Vec2 }[];
  animation: FlightAnimation | null;
  onAnimationDone: () => void;
  onAim: (point: Vec2) => void;
  interactive: boolean;
  puttingView: boolean;
  windFrom: number;
  windSpeed: number;
  showZones: { fifty: boolean; seventyFive: boolean; ninety: boolean };
  showDispersion: boolean;
}

function rotationFor(direction: Vec2): number {
  return Math.PI / 2 - Math.atan2(direction.y, direction.x);
}

export function CourseView(props: CourseViewProps): JSX.Element {
  const {
    hole, ball, target, plan, putt, animation, onAnimationDone, onAim,
    interactive, puttingView, windFrom, windSpeed, showZones, showDispersion, shotLines,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [manual, setManual] = useState<{ zoom: number; pan: Vec2 } | null>(null);
  const [wholeHole, setWholeHole] = useState(false);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const dragRef = useRef<{ x: number; y: number; pan: Vec2 } | null>(null);
  const timeRef = useRef(0);
  const animStartRef = useRef<number | null>(null);
  const [flight, setFlight] = useState<{ x: number; y: number; h: number } | null>(null);
  const [trail, setTrail] = useState<{ x: number; y: number; h: number }[] | null>(null);

  // --- Sizing --------------------------------------------------------------
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.max(320, rect.width), height: Math.max(260, rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // --- Camera --------------------------------------------------------------
  const rotation = useMemo(() => {
    const reference = puttingView ? sub(hole.pin, ball) : sub(hole.pin, ball);
    const direction = dist(hole.pin, ball) < 1 ? sub(hole.greenCenter, hole.tee) : reference;
    return rotationFor(norm(direction));
  }, [hole, ball, puttingView]);

  const camera: Camera = useMemo(() => {
    const points: Vec2[] = [ball];
    if (wholeHole) {
      points.push(
        { x: hole.bounds.minX, y: hole.bounds.minY },
        { x: hole.bounds.maxX, y: hole.bounds.maxY },
        { x: hole.bounds.minX, y: hole.bounds.maxY },
        { x: hole.bounds.maxX, y: hole.bounds.minY },
      );
    } else if (puttingView) {
      points.push(...blobOutline(hole.green, 16), hole.pin);
      if (target) points.push(target);
    } else {
      points.push(hole.pin);
      if (target) points.push(target);
      if (plan) points.push(...dispersionContour(plan, sigmaForShare(0.9), 16));
      if (animation && animation.path.length > 0) {
        points.push(animation.path[animation.path.length - 1]);
      }
    }
    const margin = puttingView ? 6 : wholeHole ? 20 : 26;
    const base = fitCamera(points, size.width, size.height, {
      rotation,
      margin,
      maxScale: puttingView ? 26 : 9,
      minScale: 0.22,
    });
    if (!manual) return base;
    return {
      ...base,
      scale: Math.max(0.15, Math.min(40, base.scale * manual.zoom)),
      center: { x: base.center.x + manual.pan.x, y: base.center.y + manual.pan.y },
    };
  }, [ball, hole, target, plan, animation, size, rotation, manual, puttingView, wholeHole]);

  // --- Animation -----------------------------------------------------------
  useEffect(() => {
    if (!animation) {
      animStartRef.current = null;
      setFlight(null);
      setTrail(null);
      return;
    }
    animStartRef.current = null;
    let raf = 0;
    const step = (now: number) => {
      if (animStartRef.current === null) animStartRef.current = now;
      const elapsed = (now - animStartRef.current) / 1000;
      const duration = animation.duration;
      const t = Math.min(1, elapsed / duration);

      if (animation.putt) {
        const points = animation.putt;
        const index = Math.min(points.length - 1, Math.floor(t * (points.length - 1)));
        const point = points[index];
        setFlight({ x: point.x, y: point.y, h: 0 });
        setTrail(points.slice(0, index + 1).map((p) => ({ x: p.x, y: p.y, h: 0 })));
      } else {
        // Two phases: flight, then the roll-out.
        const flightShare = 0.78;
        if (t < flightShare) {
          const ft = t / flightShare;
          const points = animation.path;
          const index = Math.min(points.length - 1, Math.floor(ft * (points.length - 1)));
          setFlight(points[index]);
          setTrail(points.slice(0, index + 1));
        } else {
          const rt = (t - flightShare) / (1 - flightShare);
          const from = animation.rollPath[0];
          const to = animation.rollPath[animation.rollPath.length - 1];
          const eased = 1 - Math.pow(1 - rt, 2.2);
          setFlight({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, h: 0 });
          setTrail(animation.path);
        }
      }

      if (t >= 1) {
        onAnimationDone();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animation, onAnimationDone]);

  // --- Draw loop -----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const render = (now: number) => {
      timeRef.current = now / 1000;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawHole(ctx, {
        hole,
        camera,
        ball,
        target: interactive || animation ? target : null,
        plan: animation ? null : plan,
        putt: animation ? null : putt,
        flight,
        trail,
        shotLines,
        showDispersion,
        showZones,
        time: timeRef.current,
        windFrom,
        windSpeed,
        puttingView,
        hoverTarget: hover,
      });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [
    hole, camera, ball, target, plan, putt, flight, trail, shotLines, showDispersion,
    showZones, windFrom, windSpeed, puttingView, hover, size, interactive, animation,
  ]);

  // --- Hole map inset ------------------------------------------------------
  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = 120;
    const height = 150;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawHoleMap(ctx, hole, ball, target, width, height, rotationFor(norm(sub(hole.greenCenter, hole.tee))));
  }, [hole, ball, target]);

  // --- Interaction ---------------------------------------------------------
  const pointerWorld = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): Vec2 => {
      const rect = event.currentTarget.getBoundingClientRect();
      return toWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    },
    [camera],
  );

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    if (dragRef.current && (Math.abs(event.clientX - dragRef.current.x) > 4 || Math.abs(event.clientY - dragRef.current.y) > 4)) return;
    onAim(pointerWorld(event));
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    setManual((current) => ({
      zoom: Math.max(0.3, Math.min(8, (current?.zoom ?? 1) * factor)),
      pan: current?.pan ?? { x: 0, y: 0 },
    }));
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, pan: manual?.pan ?? { x: 0, y: 0 } };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (interactive) setHover(pointerWorld(event));
    const drag = dragRef.current;
    if (!drag || event.buttons !== 1) return;
    const dx = (event.clientX - drag.x) / camera.scale;
    const dy = (event.clientY - drag.y) / camera.scale;
    if (Math.abs(dx) + Math.abs(dy) < 2 / camera.scale) return;
    const c = Math.cos(-camera.rotation);
    const s = Math.sin(-camera.rotation);
    const worldDx = -dx * c - dy * s;
    const worldDy = -dx * s + dy * c;
    setManual({ zoom: manual?.zoom ?? 1, pan: { x: drag.pan.x + worldDx, y: drag.pan.y - worldDy * 1 } });
  };

  const handleMouseUp = () => {
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  return (
    <div className="course-view" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className={interactive ? 'course-canvas course-canvas--interactive' : 'course-canvas'}
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setHover(null)}
      />
      <div className="course-view__controls">
        <button type="button" onClick={() => setWholeHole((v) => !v)} className={wholeHole ? 'active' : ''}>
          {wholeHole ? 'Shot view' : 'Whole hole'}
        </button>
        <button type="button" onClick={() => setManual(null)} disabled={!manual}>
          Reset view
        </button>
      </div>
      <div className="course-view__map">
        <canvas ref={mapRef} />
      </div>
    </div>
  );
}
