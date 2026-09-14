#!/usr/bin/env node
/**
 * Compose the built app into a page the Artifact host can publish.
 *
 * The host wraps whatever it is given in its own `<!doctype html><head>…<body>`,
 * so the page must be body content only: no doctype, no <html>, no <head>. The
 * stylesheet is inlined (it is small, and a <link> in the body is needless
 * risk); the bundle stays a separate file referenced by a relative path, which
 * is how the host serves supporting files.
 *
 *   npm run build && node tools/artifact.mjs
 *
 * Prints the JSON the Artifact call needs: the page path and its asset map.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const outDir = process.argv[2] ?? join(dirname(dist), 'artifact');

const assets = await readdir(join(dist, 'assets'));
const js = assets.find((name) => name.endsWith('.js'));
const css = assets.find((name) => name.endsWith('.css'));
if (!js || !css) throw new Error('No build found — run npm run build first.');

const styles = await readFile(join(dist, 'assets', css), 'utf8');

const page = `<title>Golf Universe</title>
<style>
${styles}

/* Shown for the moment between the page painting and React mounting. */
.boot {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; height: 100vh; color: var(--text-dim); text-align: center; padding: 24px;
}
.boot__mark { font-size: 34px; }
.boot strong { color: var(--text); font-size: 15px; font-weight: 600; }
</style>

<div id="root">
  <div class="boot">
    <span class="boot__mark">⛳</span>
    <strong>Golf Universe</strong>
    <span>Generating fifty golfers, three courses and a season…</span>
  </div>
</div>

<script type="module" src="assets/${js}"></script>
`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.html'), page, 'utf8');

console.log(JSON.stringify({ page: join(outDir, 'index.html'), files: { [`assets/${js}`]: join(dist, 'assets', js) } }, null, 2));
