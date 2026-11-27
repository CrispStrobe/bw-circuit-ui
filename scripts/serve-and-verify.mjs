#!/usr/bin/env node
/**
 * Run URL-taking browser gates against ONE dev server.
 *
 *   node scripts/serve-and-verify.mjs scripts/verify-touch-pinch.mjs ...
 *
 * The gates each accept a base URL, so they stay runnable by hand against an
 * already-served build; this only spares CI a vite start per gate. It REFUSES a
 * busy port rather than testing whatever happens to answer there — a stale
 * server on the gate port has passed gates against a deleted build before.
 */
import { spawn } from 'node:child_process';

const gates = process.argv.slice(2);
if (!gates.length) {
  console.error('usage: serve-and-verify.mjs <gate.mjs> [gate.mjs ...]');
  process.exit(2);
}
const PORT = Number(process.env.BW_GATE_PORT || 3157);
const BASE = `http://localhost:${PORT}`;

const answers = async () => {
  const c = AbortSignal.timeout(1500);
  try { await fetch(`${BASE}/`, {signal: c}); return true; } catch { return false; }
};

if (await answers()) {
  console.error(`\n✖ REFUSING TO RUN: something already serves port ${PORT}.`);
  console.error('  Whatever answers there is not the tree under test.');
  console.error('  Free the port, or set BW_GATE_PORT.');
  process.exit(1);
}

// Own process group: `npx` does not always exec vite in place, and killing
// only the npx wrapper left vite listening, so the NEXT serve-and-verify step
// in CI met "something already serves port" (seen once verify:touch went green
// and verify:microtronic:native ran after it). Shutdown kills the whole group.
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const shutdown = (signal = 'SIGTERM') => {
  try { process.kill(-server.pid, signal); } catch { /* group already gone */ }
  try { server.kill(signal); } catch { /* already gone */ }
};
process.on('exit', () => shutdown('SIGKILL'));
/** Stop the server and do not return until the port is actually free. */
const stopServer = async () => {
  shutdown('SIGTERM');
  const t = Date.now();
  while (await answers()) {
    if (Date.now() - t > 10000) {
      shutdown('SIGKILL');
      if (Date.now() - t > 15000) {
        console.error(`✖ the gate server still answers ${BASE} after shutdown`);
        return false;
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return true;
};

const t0 = Date.now();
let up = false;
while (Date.now() - t0 < 90000) {
  if (server.exitCode !== null) {
    console.error(`✖ vite exited (${server.exitCode}) before serving:\n${serverLog}`);
    process.exit(1);
  }
  if (await answers()) { up = true; break; }
}
if (!up) {
  console.error(`✖ vite never answered ${BASE} in 90s:\n${serverLog}`);
  process.exit(1);
}

let failed = 0;
for (const gate of gates) {
  console.log(`\n=== ${gate} ===`);
  const code = await new Promise(res => {
    spawn(process.execPath, [gate, BASE], {stdio: 'inherit'}).on('close', res);
  });
  if (code !== 0) { failed++; console.log(`✖ ${gate} exited ${code}`); }
}
const stopped = await stopServer();
console.log(`\n${gates.length} gates · ${gates.length - failed} passed · ${failed} failed`);
process.exit(failed || !stopped ? 1 : 0);
