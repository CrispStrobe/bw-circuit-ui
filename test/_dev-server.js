/**
 * One dev server per browser test file, on a port nobody else claims.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 * Eleven browser tests, eight hand-rolled copies of spawn-vite-then-poll, and
 * two distinct bugs that only became visible once the suite could run at all
 * (it never had: this checkout had no `node_modules`, and the files were
 * outside every npm script — see docs/TEST-REGISTRATION.md):
 *
 *   1. FOUR files started NO server. `debug-status`, `e2e`, `rendering` and
 *      `snapshot-render` navigate to a hardcoded `localhost:3100` and assume
 *      someone has `npm run dev` open in another terminal. Run unattended they
 *      produce 19 failures, every one `ERR_CONNECTION_REFUSED`, which reads
 *      like nineteen broken features and is one missing server.
 *   2. TWO files claimed the SAME port. `serial-console` and
 *      `pendant-attiny88` both used 3195. `node --test` runs files
 *      concurrently, so that is a flake waiting for an unlucky schedule —
 *      and with `--strictPort` the loser does not fall back, it dies.
 *
 * The ports therefore live in ONE table, uniqueness is asserted at import, and
 * a file asks for its server by name. A duplicate is now impossible to write
 * without the assertion firing, and a file that forgets to start a server
 * cannot silently borrow someone else's.
 *
 * @module
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One port per browser test file. Values must be unique — asserted below. */
export const PORTS = {
  'debug-status': 3186,
  'e2e': 3187,
  'rendering': 3188,
  'vdp-keyboard': 3189,
  'snapshot-render': 3190,
  'tilevga-face': 3191,
  'snapshot-drop': 3192,
  'faces': 3193,
  'mcu-device-label': 3194,
  'serial-console': 3195,
  'pendant-attiny88': 3196,
  'export-views': 3197,
};

{
  const seen = new Map();
  for (const [name, port] of Object.entries(PORTS)) {
    if (seen.has(port)) {
      throw new Error(`test/_dev-server.js: ${name} and ${seen.get(port)} both claim port ${port}. `
        + 'node --test runs files concurrently and vite is started with --strictPort, so the '
        + 'loser dies rather than falling back. Give each file its own port.');
    }
    seen.set(port, name);
  }
}

/**
 * Start a vite dev server for one test file and wait until it answers.
 *
 * @param {keyof PORTS} name the test file's base name
 * @returns {Promise<{url: string, port: number, stop: () => void}>}
 */
export async function startDevServer (name) {
  const port = PORTS[name];
  if (!port) {
    throw new Error(`no port reserved for "${name}" in test/_dev-server.js. Add one — do not `
      + 'reuse another file\'s, and do not navigate to a server you did not start.');
  }
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    stdio: 'ignore', detached: false, cwd: ROOT,
  });
  let exited = null;
  proc.on('exit', (code) => { exited = code; });

  const url = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    if (exited !== null) {
      throw new Error(`vite exited with ${exited} before serving ${url}. Port ${port} is `
        + `probably already in use — every browser test needs its own (see PORTS).`);
    }
    try {
      const r = await fetch(`${url}/`);
      if (r.ok) return { url, port, stop: () => { try { proc.kill(); } catch { /* gone */ } } };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { proc.kill(); } catch { /* gone */ }
  throw new Error(`vite never answered on ${url} within 30s`);
}
