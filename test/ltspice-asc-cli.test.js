import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/bwc.mjs', import.meta.url));

test('bwc reads UTF-16 ASC with bounded sibling ASYs and reports the document layer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-asc-cli-'));
  try {
    const asy = `Version 4
SymbolType CELL
PIN 0 0 LEFT 8
PINATTR SpiceOrder 1
PIN 0 16 LEFT 8
PINATTR SpiceOrder 2
PIN 64 0 RIGHT 8
PINATTR SpiceOrder 3
PIN 64 16 RIGHT 8
PINATTR SpiceOrder 4
SYMATTR Prefix E
`;
    const asc = `Version 4.1
SHEET 1 400 300
SYMBOL controlled 100 100 R0
SYMATTR InstName E1
SYMATTR Value 2
FLAG 100 100 OP
FLAG 100 116 ON
FLAG 164 100 IP
FLAG 164 116 IN
UNKNOWN retained
`;
    writeFileSync(join(dir, 'controlled.asy'), asy);
    writeFileSync(join(dir, 'bench.asc'), Buffer.concat([
      Buffer.from([0xff, 0xfe]), Buffer.from(asc, 'utf16le'),
    ]));
    const output = execFileSync(process.execPath, [CLI, 'info', join(dir, 'bench.asc')],
      { encoding: 'utf8' });
    assert.match(output, /parts\s+: 1/);
    assert.match(output, /ASC doc\s+: 10 records, 1 symbols, 4 pins recovered/);
    assert.match(output, /vcvs×1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bwc converts SPICE to ASC and writes required companion ASYs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-spice-asc-'));
  try {
    const spicePath = join(dir, 'bench.cir'); const ascPath = join(dir, 'bench.asc');
    writeFileSync(spicePath, `cli conversion
Q1 c b 0 QMOD
E1 out 0 b 0 2
.model QMOD NPN (IS=1e-14 BF=100)
.end
`);
    execFileSync(process.execPath, [CLI, 'convert', spicePath, '--to', 'asc', '-o', ascPath],
      { encoding: 'utf8' });
    assert.match(readFileSync(ascPath, 'utf8'), /SYMBOL bw_npn/);
    assert.equal(existsSync(join(dir, 'bw_npn.asy')), true);
    assert.equal(existsSync(join(dir, 'bw_vcvs.asy')), true);
    const info = execFileSync(process.execPath, [CLI, 'info', ascPath], { encoding: 'utf8' });
    assert.match(info, /parts\s+: 3/);
    assert.match(info, /npn×1/);
    assert.match(info, /vcvs×1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
