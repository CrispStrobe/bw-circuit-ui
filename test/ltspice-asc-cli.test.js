import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

test('bwc converts SPICE to ASC using standard LTspice symbols without sidecars', () => {
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
    assert.match(readFileSync(ascPath, 'utf8'), /SYMBOL npn/);
    assert.match(readFileSync(ascPath, 'utf8'), /SYMBOL e/);
    const info = execFileSync(process.execPath, [CLI, 'info', ascPath], { encoding: 'utf8' });
    assert.match(info, /parts\s+: 3/);
    assert.match(info, /npn×1/);
    assert.match(info, /vcvs×1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bwc JSON conversion persists typed unrequested ASC output directives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-asc-analysis-json-'));
  try {
    const ascPath = join(dir, 'analysis.asc'); const jsonPath = join(dir, 'analysis.json');
    writeFileSync(ascPath, `Version 4
SHEET 1 400 300
SYMBOL voltage 100 100 R0
SYMATTR InstName V1
SYMATTR Value 1
FLAG 100 100 n1
FLAG 100 196 0
SYMBOL res 200 100 R0
SYMATTR InstName R1
SYMATTR Value 1k
FLAG 200 100 n1
FLAG 200 196 0
TEXT 20 220 Left 2 !.op
TEXT 20 240 Left 2 !.four 1k V(n1)
TEXT 20 260 Left 2 !.options plotwinsize=0
`);
    execFileSync(process.execPath, [CLI, 'convert', ascPath, '--to', 'json', '-o', jsonPath],
      { encoding: 'utf8' });
    const saved = JSON.parse(readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(saved.sourceAnalysis.analyses, ['.op']);
    assert.deepEqual(saved.sourceAnalysis.retainedDirectives, [
      { source: '.four 1k V(n1)', kind: 'output-request',
        handling: 'preserved-not-executed',
        consequence: 'retained as an unrequested output/control card; source analysis does not execute it' },
      { source: '.options plotwinsize=0', kind: 'output-request',
        handling: 'preserved-not-executed',
        consequence: 'retained as an unrequested output/control card; source analysis does not execute it' },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
