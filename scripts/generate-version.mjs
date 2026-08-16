/*
 * Writes public/version.json — the build stamp the running app polls to find out
 * that a newer one has been deployed.
 *
 * Why this file has to exist at all: the service worker cannot answer the
 * question. `sw.js` is a static asset that is byte-identical from one build to
 * the next, so `registration.update()` finds no new worker even when every
 * hashed bundle behind it has changed. Without a value that moves on each build
 * there is nothing for a running tab to compare itself against.
 *
 * Run from the `build` script, so `next build` always copies a fresh stamp into
 * out/. The file is generated, never committed (see .gitignore).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'version.json');

// The timestamp is what actually makes each build distinct — the commit is for
// humans reading the file, and is absent on a tree with no git or no commits.
let commit = null;
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  /* not a repo, or no commits yet — the timestamp alone identifies the build */
}

const stamp = { buildId: String(Date.now()), builtAt: new Date().toISOString(), commit };

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`[version] ${stamp.buildId}${commit ? ` (${commit})` : ''} → public/version.json`);
