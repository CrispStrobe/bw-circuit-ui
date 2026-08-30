/**
 * The import menu can only offer formats that exist, and every degradation
 * has to be sayable.
 *
 * X0.5 — the "Diagram (.json)" entry in BoardCanvas's import submenu forced
 * `pendingFormat = 'json'`. There is no `json` key in IMPORTERS. importCircuit
 * returned `{parts: [], wires: [], warnings: ['Unknown import format: "json"…']}`,
 * the caller wrote `if (r.parts.length) onImport(...)` and the warning went
 * nowhere. Clicking it did nothing, said nothing, and logged nothing.
 *
 * X0.6 — importers/wokwi.js mapped four types onto DIFFERENT parts (a DS1307
 * onto a DS1302, a DHT22 onto a DHT11, a slide pot onto a rotary one, a
 * biaxial stepper onto a single-shaft one) with no `_note`, no warning and no
 * trace, while every other importer in this repo states what it could not do.
 * A silent degrade is worse than a refusal: the user gets a circuit they did
 * not draw and the engine simulates it confidently.
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupportedFormats, IMPORT_FORMATS, NOT_OFFERED, importCircuit }
  from '../src/importers/index.js';
import { importWokwi, exportWokwi } from '../src/importers/wokwi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

describe('the import menu offers formats that exist (X0.5)', () => {
  it('every offered id is a real importer key', () => {
    const known = new Set(getSupportedFormats());
    const bogus = IMPORT_FORMATS.filter(f => f.id !== null && !known.has(f.id)).map(f => f.id);
    assert.deepEqual(bogus, [],
      `menu ids with no importer — this is exactly what 'json' was. Known: ${[...known].join(', ')}`);
  });

  it('every importer is either offered or excluded with a reason', () => {
    const offered = new Set(IMPORT_FORMATS.map(f => f.id).filter(Boolean));
    const unaccounted = getSupportedFormats()
      .filter(k => !offered.has(k) && !NOT_OFFERED.has(k));
    assert.deepEqual(unaccounted, [],
      'registered importers nobody can pick and nobody decided not to offer');
    for (const [k, why] of NOT_OFFERED) {
      assert.ok(getSupportedFormats().includes(k), `NOT_OFFERED names a dead key: ${k}`);
      assert.ok(why && why.length > 20, `NOT_OFFERED[${k}] needs a real reason`);
    }
  });

  it('the menu renders from IMPORT_FORMATS, not from ids typed into JSX', () => {
    const canvas = readFileSync(path.join(SRC, 'components/BoardCanvas.jsx'), 'utf-8');
    assert.ok(canvas.includes('IMPORT_FORMATS'), 'the submenu must map over IMPORT_FORMATS');
    assert.ok(!/pickImport\('json'\)/.test(canvas), "the dead 'json' entry is gone");
    // pickImport now takes a format OBJECT; a bare string id would be the old
    // shape sneaking back.
    assert.ok(!/pickImport\('[a-z-]+'\)/.test(canvas),
      'pickImport must take a registry entry, not a hand-typed id');
  });

  it('an unknown format is a named refusal, not an empty result', () => {
    const r = importCircuit('json', '{}');
    assert.equal(r.parts.length, 0);
    assert.ok(r.warnings.some(w => /Unknown import format/.test(w)),
      'importCircuit already said so — the UI is what had to listen');
  });

  it('the import path surfaces the refusal instead of returning silently', () => {
    const canvas = readFileSync(path.join(SRC, 'components/BoardCanvas.jsx'), 'utf-8');
    const start = canvas.indexOf('const handleImportFile');
    const body = canvas.slice(start, canvas.indexOf('const pickImport', start));
    assert.ok(start > 0 && body.length > 200, 'handleImportFile found');
    // The two silent exits: no detected format, and nothing imported.
    assert.ok(/if \(!format\) \{[\s\S]*?say\(/.test(body),
      'an unrecognised file must produce a report, not a bare return');
    assert.ok(/say\(\{[\s\S]*?unmapped/.test(body),
      'unmapped parts must reach the report');
    assert.ok(!/console\.(log|warn)/.test(body), 'no console-only user guidance');
  });
});

describe('part substitutions are named (X0.6)', () => {
  const CASES = [
    ['wokwi-ds1307', 'ds1302', /DS1307[\s\S]*DS1302/i],
    ['wokwi-dht22', 'dht11', /DHT22[\s\S]*DHT11/i],
    ['wokwi-slide-potentiometer', 'potentiometer', /[Ss]lide/],
    ['wokwi-biaxial-stepper', 'stepper', /[Bb]iaxial/],
  ];

  for (const [type, kind, mentionsBothSides] of CASES) {
    it(`${type} -> ${kind} arrives with a note naming both sides`, () => {
      const r = importWokwi(JSON.stringify({
        version: 1,
        parts: [{ type, id: 'p1', top: 0, left: 0, attrs: {} }],
        connections: [],
      }));
      assert.equal(r.parts.length, 1, 'the part is still placed — this is a substitution, not a refusal');
      assert.equal(r.parts[0].kind, kind);
      assert.ok(r.parts[0].params._note, `${type} carries no _note`);
      assert.match(r.parts[0].params._note, mentionsBothSides,
        'the note must name what was asked for AND what was given');
      assert.equal(r.parts[0].params._substituted, type,
        'the original type travels with the part');
      assert.ok(r.warnings.some(w => w.includes('p1')),
        `no warning for ${type}: ${JSON.stringify(r.warnings)}`);
    });
  }

  it('a faithful mapping carries no note — the notice means something', () => {
    const r = importWokwi(JSON.stringify({
      version: 1,
      parts: [{ type: 'wokwi-led', id: 'led1', top: 0, left: 0, attrs: {} }],
      connections: [],
    }));
    assert.equal(r.parts[0].params._note, undefined);
    assert.deepEqual(r.warnings, []);
  });

  it('every approximating map entry has a note — none can be added silently', () => {
    // The gate that makes the class un-reopenable: read the source, find the
    // types listed as approximations, and require each to produce a note.
    const src = readFileSync(path.join(SRC, 'importers/wokwi.js'), 'utf-8');
    const block = src.slice(src.indexOf('const APPROXIMATIONS'), src.indexOf('const KIND_TO_WOKWI'));
    const types = [...block.matchAll(/'(wokwi-[a-z0-9-]+)':\s*\{/g)].map(m => m[1]);
    assert.ok(types.length >= 4, `only ${types.length} approximations parsed`);
    for (const type of types) {
      const r = importWokwi(JSON.stringify({
        version: 1, parts: [{ type, id: 'x', top: 0, left: 0, attrs: {} }], connections: [],
      }));
      assert.ok(r.parts[0]?.params?._note, `${type} is listed as an approximation but says nothing`);
    }
  });
});

describe('the diagram exporter names what it could not write (X0.3)', () => {
  it('an unmapped kind is skipped and named, never invented', () => {
    const out = exportWokwi({
      parts: [
        { id: 'led1', kind: 'led', params: {}, x: 0, y: 0 },
        { id: 'u1', kind: 'max232', params: {}, x: 10, y: 0 },
      ],
      wires: [],
    });
    const parsed = JSON.parse(out.text);
    assert.equal(parsed.parts.length, 1, 'only the mappable part is written');
    assert.deepEqual(out.skipped, [{ id: 'u1', kind: 'max232' }]);
    // The old exporter wrote `wokwi-max232` — a plausible name no reader knows.
    assert.ok(!out.text.includes('max232'), `an invented type leaked: ${out.text}`);
  });

  it('a wire onto a skipped part is dropped too, not left dangling', () => {
    const out = exportWokwi({
      parts: [
        { id: 'led1', kind: 'led', params: {}, x: 0, y: 0 },
        { id: 'u1', kind: 'max232', params: {}, x: 10, y: 0 },
      ],
      wires: [{ from: 'u1', fromTerminal: 'a', to: 'led1', toTerminal: 'anode' }],
    });
    const parsed = JSON.parse(out.text);
    assert.equal(parsed.connections.length, 0,
      'a connection naming a part the file does not contain will not load');
  });

  it('a kind with only an approximate spelling still exports, and says so', () => {
    const out = exportWokwi({
      parts: [{ id: 'h1', kind: 'dht11', params: {}, x: 0, y: 0 }],
      wires: [],
    });
    assert.equal(JSON.parse(out.text).parts.length, 1);
    assert.equal(out.substituted.length, 1);
    assert.match(out.substituted[0].note, /DHT22[\s\S]*DHT11/i);
  });

  it('an exact spelling is preferred over an approximate one', () => {
    // `potentiometer` imports from BOTH wokwi-potentiometer and the slide
    // variant; the export must pick the exact one.
    const out = exportWokwi({
      parts: [{ id: 'rv1', kind: 'potentiometer', params: {}, x: 0, y: 0 }],
      wires: [],
    });
    assert.equal(JSON.parse(out.text).parts[0].type, 'wokwi-potentiometer');
    assert.deepEqual(out.substituted, []);
  });
});
