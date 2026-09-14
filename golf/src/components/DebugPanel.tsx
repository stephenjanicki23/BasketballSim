/**
 * The reconstruction, against what it was reconstructed from.
 *
 * This is a development tool, not a game screen: it lays the source photograph
 * over the hole at the alignment the trace recorded, and draws the geometry the
 * engine actually plays on top of it. Where the two disagree, the trace is
 * wrong — which is the whole point of having it.
 */

import type { DebugOptions } from './render/holeRenderer';
import type { HoleGeometry } from '../simulation/types';
import { Panel } from './ui';

const LAYER_NAMES: Record<keyof DebugOptions['layers'], string> = {
  fairway: 'Fairway',
  rough: 'Rough',
  bunkers: 'Bunkers',
  water: 'Water',
  green: 'Green',
  ob: 'Out of bounds',
  paths: 'Cart paths',
  trees: 'Trees',
  centreline: 'Centreline',
  grid: '50 yd rings',
};

export function DebugPanel({
  hole,
  debug,
  onChange,
  onClose,
}: {
  hole: HoleGeometry;
  debug: DebugOptions;
  onChange: (next: DebugOptions) => void;
  onClose: () => void;
}): JSX.Element {
  const reference = hole.spec.reference;
  const set = (patch: Partial<DebugOptions>) => onChange({ ...debug, ...patch });
  const toggle = (layer: keyof DebugOptions['layers']) =>
    onChange({ ...debug, layers: { ...debug.layers, [layer]: !debug.layers[layer] } });

  return (
    <Panel
      title="Trace check"
      right={<button type="button" className="ghost ghost--small" onClick={onClose}>Close</button>}
    >
      <p className="hint">
        {!reference
          ? 'This hole was not traced from an image — geometry only.'
          : debug.missing
            ? `No image at ${reference.image}. Reference images are local working files; drop it there to compare.`
            : `Overlay aligned from the trace: ${reference.scale.toFixed(3)} yd per pixel.`}
      </p>

      {reference && (
        <div className="debug-sliders">
          <label>
            Overlay
            <input
              type="range" min={0} max={1} step={0.02} value={debug.opacity}
              onChange={(event) => set({ opacity: Number(event.target.value) })}
            />
            <span>{Math.round(debug.opacity * 100)}%</span>
          </label>
          <label>
            Scale
            <input
              type="range" min={0.8} max={1.2} step={0.002} value={debug.zoom}
              onChange={(event) => set({ zoom: Number(event.target.value) })}
            />
            <span>{debug.zoom.toFixed(3)}×</span>
          </label>
          <label>
            Rotate
            <input
              type="range" min={-0.15} max={0.15} step={0.002} value={debug.rotate}
              onChange={(event) => set({ rotate: Number(event.target.value) })}
            />
            <span>{((debug.rotate * 180) / Math.PI).toFixed(1)}°</span>
          </label>
          <label>
            Across
            <input
              type="range" min={-40} max={40} step={0.5} value={debug.offset.x}
              onChange={(event) => set({ offset: { ...debug.offset, x: Number(event.target.value) } })}
            />
            <span>{debug.offset.x.toFixed(1)} yd</span>
          </label>
          <label>
            Along
            <input
              type="range" min={-40} max={40} step={0.5} value={debug.offset.y}
              onChange={(event) => set({ offset: { ...debug.offset, y: Number(event.target.value) } })}
            />
            <span>{debug.offset.y.toFixed(1)} yd</span>
          </label>
        </div>
      )}

      <div className="debug-layers">
        {(Object.keys(LAYER_NAMES) as (keyof DebugOptions['layers'])[]).map((layer) => (
          <label key={layer}>
            <input type="checkbox" checked={debug.layers[layer]} onChange={() => toggle(layer)} />
            {LAYER_NAMES[layer]}
          </label>
        ))}
      </div>

      <div className="stat-row">
        <div className="debug-readout">
          <span className="label">Hole</span>
          <strong>{hole.centerlineLength.toFixed(0)} yd on the centreline</strong>
        </div>
        <div className="debug-readout">
          <span className="label">Green</span>
          <strong>{(hole.green.radius * 2).toFixed(0)} yd across, {hole.green.outline.length} points</strong>
        </div>
        <div className="debug-readout">
          <span className="label">Features</span>
          <strong>
            {hole.bunkers.length} bunkers, {hole.water.length} water, {hole.ob.length} OB, {hole.trees.length} trees
          </strong>
        </div>
      </div>
    </Panel>
  );
}
