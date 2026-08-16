#!/usr/bin/env node
/**
 * Displays acceptance suite — run all probes and generate RESULTS.md.
 *
 * Usage:
 *   node scripts/deployed-acceptance/run-all.mjs [URL]
 *   PROOF_URL=https://... node scripts/deployed-acceptance/run-all.mjs
 *   npm run acceptance
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { makeUtils, resolveUrl } from './helpers.mjs';

// Import all probes.
import * as probeMatrix from './probe-matrix.mjs';
import * as probeCharLcd from './probe-char-lcd.mjs';
import * as probe7seg from './probe-7seg.mjs';
import * as probeSevSeg3 from './probe-seven-seg-3.mjs';
import * as probeSsd1306 from './probe-ssd1306.mjs';
import * as probeVdp from './probe-vdp.mjs';
import * as probeSerial from './probe-serial.mjs';

const PROBES = [
  probeMatrix,
  probeCharLcd,
  probe7seg,
  probeSevSeg3,
  probeSsd1306,
  probeVdp,
  probeSerial,
];

const url = resolveUrl();
let deploySha = 'unknown';
try {
  deploySha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch { /* not in a git repo */ }

console.log(`\n  Displays acceptance suite`);
console.log(`  URL:  ${url}`);
console.log(`  SHA:  ${deploySha}`);
console.log(`  Date: ${new Date().toISOString()}\n`);

const browser = await chromium.launch();
const results = [];

for (const probe of PROBES) {
  const row = probe.ROW;
  console.log(`── ${row} ──`);
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', () => {});
  page.on('dialog', (d) => d.accept());
  const utils = makeUtils(page, url);

  try {
    const result = await probe.run(page, utils);
    results.push(result);
    const icon = result.verdict === 'PASS' ? '\u2714' : result.verdict === 'SKIP' ? '\u25CB' : '\u2716';
    console.log(`  ${icon} ${result.verdict}: ${result.notes}`);
    if (result.attribution) console.log(`    attribution: ${result.attribution}`);
  } catch (e) {
    const errMsg = String(e).split('\n')[0].slice(0, 120);
    console.error(`  \u2716 ERROR: ${errMsg}`);
    results.push({
      row,
      verdict: 'ERROR',
      screenshot: '',
      notes: errMsg,
      attribution: 'harness — probe threw an unhandled exception',
    });
  }

  await page.close();
}

await browser.close();

// ── Generate RESULTS.md ──────────────────────────────────────────
const passCount = results.filter((r) => r.verdict === 'PASS').length;
const failCount = results.filter((r) => r.verdict === 'FAIL' || r.verdict === 'ERROR').length;
const skipCount = results.filter((r) => r.verdict === 'SKIP').length;

const lines = [
  `# Displays Acceptance — Results`,
  ``,
  `| Field | Value |`,
  `|-------|-------|`,
  `| Date | ${new Date().toISOString()} |`,
  `| Deploy SHA | \`${deploySha}\` |`,
  `| URL | ${url} |`,
  `| Summary | **${passCount} PASS**, ${failCount} FAIL, ${skipCount} SKIP |`,
  ``,
  `## Probe results`,
  ``,
  `| Row | Verdict | Screenshot | Notes |`,
  `|-----|---------|------------|-------|`,
];

for (const r of results) {
  const icon =
    r.verdict === 'PASS' ? '\u2705' : r.verdict === 'SKIP' ? '\u26AA' : '\u274C';
  const ssCell = r.screenshot ? `\`${r.screenshot}\`` : '—';
  const notesCell = r.notes?.replace(/\|/g, '\\|') || '—';
  lines.push(`| ${r.row} | ${icon} ${r.verdict} | ${ssCell} | ${notesCell} |`);
}

lines.push('');

// Findings section for FAILs.
const findings = results.filter((r) => r.attribution);
if (findings.length > 0) {
  lines.push(`## Findings`);
  lines.push('');
  for (const f of findings) {
    lines.push(`- **${f.row}** (${f.verdict}): ${f.attribution}`);
  }
  lines.push('');
}

const md = lines.join('\n');
const resultsPath = 'scripts/deployed-acceptance/RESULTS.md';
writeFileSync(resultsPath, md);
console.log(`\n━━━ ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP ━━━`);
console.log(`Results written to ${resultsPath}\n`);

process.exit(failCount > 0 ? 1 : 0);
