#!/usr/bin/env node
/**
 * Bundle a TypeScript entry with esbuild and run it in node.
 *
 * The game itself is built by vite; this exists so the simulation engines can be
 * exercised and calibrated from the command line without a browser.
 *
 *   node tools/tsrun.mjs test/calibration.ts
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node tools/tsrun.mjs <entry.ts> [args...]');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'golfsim-'));
const outfile = join(dir, 'bundle.mjs');
try {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'warning',
  });
  process.argv = [process.argv[0], outfile, ...process.argv.slice(3)];
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
