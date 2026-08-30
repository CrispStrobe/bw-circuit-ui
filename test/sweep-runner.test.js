// sweep-runner: the offline-copy contract and the truthful refusals.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listSweepSources, netOfTerminal, buildSweepBoard, runKennlinie, runBode,
} from '../src/model/sweep-runner.js';

function fakeLiveBoard() {
  return {
    vcc: 5,
    parts: [
      { id: 'vs', kind: 'vsource', params: { volts: 2 } },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
    ],
    getNets: () => [
      { id: 'n_in', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'r1', terminal: 'b' }] },
    ],
  };
}

class StubBoard {
  constructor(vcc) { this.vcc = vcc; this.powered = false; }
  setNetlist(parts, nets) { this.parts = parts; this.nets = nets; }
  setPower(on) { this.powered = on; }
  runAc(opts) { return this.acRows ? this.acRows(opts) : []; }
}

describe('sweep-runner', () => {
  it('lists vsources and resolves terminal nets', () => {
    const b = fakeLiveBoard();
    assert.deepEqual(listSweepSources(b).map(s => s.id), ['vs']);
    assert.equal(netOfTerminal(b, 'vs', 'pos'), 'n_in');
    assert.equal(netOfTerminal(b, 'r1', 'nope'), null);
  });

  it('builds a FRESH powered board and never touches the live parts', () => {
    const live = fakeLiveBoard();
    const engine = { BoardImpl: StubBoard };
    const fresh = buildSweepBoard(engine, live, {
      sourceId: 'vs', sourceParams: { wave: 'sine', amplitude: 1 },
    });
    assert.equal(fresh.powered, true, 'sweep board is powered');
    assert.equal(fresh.parts.find(p => p.id === 'vs').params.wave, 'sine');
    // The live board's source params are untouched — offline copy only.
    assert.equal(live.parts.find(p => p.id === 'vs').params.wave, undefined);
    assert.equal(live.parts.find(p => p.id === 'vs').params.volts, 2);
  });

  it('runKennlinie plumbs through to runDcSweep on the fresh board', () => {
    let got = null;
    const engine = {
      BoardImpl: StubBoard,
      runDcSweep: (board, opts) => { got = { board, opts }; return [{ v: 0, i: 0 }]; },
    };
    const r = runKennlinie(engine, fakeLiveBoard(), { sourceId: 'vs', from: 0, to: 3, steps: 7 });
    assert.equal(r.ok, true);
    assert.ok(got.board instanceof StubBoard, 'sweep ran on the offline copy');
    assert.deepEqual({ from: got.opts.from, to: got.opts.to, steps: got.opts.steps }, { from: 0, to: 3, steps: 7 });
  });

  it('refusals are truthful: missing engine functions blame the host', () => {
    const r1 = runKennlinie({}, fakeLiveBoard(), { sourceId: 'vs' });
    assert.equal(r1.ok, false);
    assert.ok(r1.reason.includes('runDcSweep via setEngine'), r1.reason);
    const r2 = runBode({}, fakeLiveBoard(), { sourceId: 'vs', inNet: 'n_in', outNet: 'n_g' });
    assert.equal(r2.ok, false);
    assert.ok(r2.reason.includes('BoardImpl'), r2.reason);
  });

  it('refusals name what the student must pick, not a generic error', () => {
    const engine = { BoardImpl: StubBoard, runDcSweep: () => [], runAcSweep: () => [], logSpace: () => [] };
    assert.ok(runKennlinie(engine, fakeLiveBoard(), {}).reason.includes('no vsource selected'));
    assert.ok(runBode(engine, fakeLiveBoard(), { sourceId: 'vs' }).reason.includes('input and an output net'));
  });

  it('scope-mode runBode forces a sine on the copy and hands frequencies to runAcSweep', () => {
    let got = null;
    const engine = {
      BoardImpl: StubBoard,
      runAcSweep: (board, opts) => { got = { board, opts }; return [{ f: 10, magDb: 0, phaseDeg: 0 }]; },
      logSpace: (a, b, ppd) => [a, b],
    };
    const r = runBode(engine, fakeLiveBoard(), { sourceId: 'vs', inNet: 'n_in', outNet: 'n_g', fFrom: 10, fTo: 1000, method: 'scope' });
    assert.equal(r.ok, true);
    assert.equal(got.board.parts.find(p => p.id === 'vs').params.wave, 'sine');
    assert.deepEqual(got.opts.freqs, [10, 1000]);
    assert.deepEqual([got.opts.inNet, got.opts.outNet], ['n_in', 'n_g']);
  });

  it('analytical runBode preserves DC bias, computes out/in, and carries region honesty', () => {
    let copiedSource;
    class AcBoard extends StubBoard {
      runAc(opts) {
        copiedSource = this.parts.find(p => p.id === 'vs').params;
        assert.deepEqual(opts.probes, ['n_in', 'n_g']);
        return [{ hz: 100, results: new Map([
          ['n_in', { mag: 2, phaseDeg: 170 }],
          ['n_g', { mag: 1, phaseDeg: -170 }],
        ]), outOfLinear: [{ part: 'U1', kind: 'opamp', region: 'high' }] }];
      }
    }
    const r = runBode({ BoardImpl: AcBoard }, fakeLiveBoard(), {
      sourceId: 'vs', inNet: 'n_in', outNet: 'n_g', fFrom: 10, fTo: 1000,
    });
    assert.equal(r.ok, true, r.reason);
    assert.equal(copiedSource.volts, 2, 'the operating-point bias is retained');
    assert.equal(copiedSource.wave, undefined, 'analytical AC does not rewrite the source');
    assert.ok(Math.abs(r.rows[0].magDb - (-6.020599913279624)) < 1e-12);
    assert.equal(r.rows[0].phaseDeg, 20, 'phase subtraction wraps to the principal range');
    assert.deepEqual(r.rows[0].outOfLinear, [{ part: 'U1', kind: 'opamp', region: 'high' }]);
  });

  it('preserves the historical one-frequency Bode contract', () => {
    class AcBoard extends StubBoard {
      runAc(opts) {
        assert.ok(opts.to > opts.from, 'the BoardImpl contract remains strict');
        return [opts.from, opts.to].map(hz => ({ hz, results: new Map([
          ['n_in', { mag: 1, phaseDeg: 0 }], ['n_g', { mag: 0.5, phaseDeg: -45 }],
        ]) }));
      }
    }
    const r = runBode({ BoardImpl: AcBoard }, fakeLiveBoard(), {
      sourceId: 'vs', inNet: 'n_in', outNet: 'n_g', fFrom: 159.155, fTo: 159.155,
    });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].f, 159.155);
  });
});
