/**
 * Land patterns: the Phase-1 oracle, and proof that it can fail.
 *
 * The registry-wide sweep enforces "pads cover EXACTLY the kind's
 * terminals" as a hard error. The can-fail cases (§ house rule: a gate
 * that cannot fail is not a gate): a header validated against the wrong
 * pin count must produce problems, and a bogus kind must not validate.
 *
 * The button's terminal map is asserted against MEASURED reality: pads at
 * (±3.25, ±2.25) on the real TS-6645 board, vertical pairs one node.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLandPattern, listLandPatternKinds, listVariants, terminalMap,
  padTerminal, validateLandPattern, validatePattern, recognizePackage,
} from '../src/model/land-patterns.js';
import { PAD_TERMINALS } from '../src/data/land-patterns.js';

const headerPins = (variant) => Number(/^1x(\d+)$/.exec(variant)[1]);

describe('the registry validates, kind by kind', () => {
  for (const kind of listLandPatternKinds()) {
    for (const variant of listVariants(kind)) {
      test(`${kind}/${variant}`, () => {
        const params = kind === 'header' ? { pins: headerPins(variant) } : undefined;
        assert.deepEqual(validateLandPattern(kind, variant, params), []);
      });
    }
  }
});

describe('the gate can fail', () => {
  test('a pattern missing a terminal is rejected', () => {
    const broken = {
      variant: 'broken', pads: [{ num: '1', terminal: 'anode', x: 0, y: 0, shape: 'circle', w: 1.8, h: 1.8, drill: 0.9 }],
      courtyard: { w: 5, h: 5 },
    };
    const problems = validatePattern(broken, 'led');
    assert.ok(problems.some((p) => /terminal "cathode" has no pad/.test(p)), problems.join('; '));
  });

  test('a pad naming a terminal the kind does not have is rejected', () => {
    const broken = {
      variant: 'broken',
      pads: [
        { num: '1', terminal: 'a', x: -1, y: 0, shape: 'circle', w: 1.6, h: 1.6, drill: 0.8 },
        { num: '2', terminal: 'wiper', x: 1, y: 0, shape: 'circle', w: 1.6, h: 1.6, drill: 0.8 },
      ],
      courtyard: { w: 5, h: 3 },
    };
    const problems = validatePattern(broken, 'resistor');
    assert.ok(problems.some((p) => /unknown terminal "wiper"/.test(p)), problems.join('; '));
  });

  test('a drill that swallows its pad is rejected', () => {
    const broken = {
      variant: 'broken',
      pads: [
        { num: '1', terminal: 'a', x: -1, y: 0, shape: 'circle', w: 1.0, h: 1.0, drill: 1.2 },
        { num: '2', terminal: 'b', x: 1, y: 0, shape: 'circle', w: 1.6, h: 1.6, drill: 0.8 },
      ],
      courtyard: { w: 5, h: 3 },
    };
    assert.ok(validatePattern(broken, 'resistor').some((p) => /swallows/.test(p)));
  });

  test('a kind with no pattern is a problem, not a null', () => {
    assert.ok(validateLandPattern('flux_capacitor', null).length === 1);
  });
});

describe('the button map is the measured one', () => {
  const p = getLandPattern('button');

  test('a covers pads 1 and 3, b covers 2 and 4', () => {
    assert.deepEqual(terminalMap(p), { a: ['1', '3'], b: ['2', '4'] });
    assert.equal(padTerminal(p, 2), 'b');
    assert.equal(padTerminal(p, '3'), 'a');
  });

  test('the shared pads are the vertical 4.5 mm pairs', () => {
    const at = (n) => p.pads.find((q) => q.num === String(n));
    // Same terminal = same x (one side of the body), 4.5 mm apart.
    assert.equal(at(1).x, at(3).x);
    assert.equal(at(1).y - at(3).y, 4.5);
    assert.equal(at(2).x - at(1).x, 6.5);
  });
});

describe('package recognition (strings measured on real boards)', () => {
  const cases = [
    ['SW-TH_4P-L6.0-W6.0-TS-6645DD6X6X6.0', 'button', 'tact-6x6'],
    ['R_AXIAL-0.4', 'resistor', 'axial-0.4'],
    ['0.96OLED_4P', 'header', '1x4'],
    ['HDR-1X8', 'header', '1x8'],
    ['RASPBERRY PI PICO/ RASPBERRY PI PICO W', 'pi_pico', 'module-dip40'],
    ['BAT-TH_BH-AA-A1AJ029', 'battery_aa', 'bh-aa'],
    ['LED-TH-5MM', 'led', 'tht-5mm'],
  ];
  for (const [pkg, kind, variant] of cases) {
    test(`${pkg} -> ${kind}${variant ? '/' + variant : ''}`, () => {
      const rec = recognizePackage(pkg);
      assert.ok(rec, 'must recognise');
      assert.equal(rec.kind, kind);
      assert.equal(rec.variant, variant);
    });
  }

  test('an unknown package is null, never a guess', () => {
    assert.equal(recognizePackage('TQFP-144_EP'), null);
  });

  test('a header size without a pattern is kind-only', () => {
    const rec = recognizePackage('HDR-1X40');
    assert.equal(rec.kind, 'header');
    assert.equal(rec.variant, null);
    assert.deepEqual(rec.params, { pins: 40 });
  });
});

describe('module pad tables', () => {
  test('the Pico table is the physical pinout: every gnd pin is a gnd name', () => {
    const t = PAD_TERMINALS.pi_pico;
    assert.equal(t.length, 40);
    // Physical GND pins of the Pico: 3, 8, 13, 18, 23, 28, 33, 38 — the
    // live board's U2 carried GND on a subset of exactly these.
    for (const pin of [3, 8, 13, 18, 23, 28, 33, 38]) {
      assert.match(t[pin - 1], /gnd/i, `pin ${pin} -> ${t[pin - 1]}`);
    }
    assert.equal(t[0], 'gp0');
    assert.equal(t[39], 'vbus');
    assert.equal(t[29], 'run');
  });
});
