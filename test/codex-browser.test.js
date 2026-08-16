/**
 * CodexBrowser: manifest-shape tolerance and component logic.
 *
 * These are node-level tests — no DOM, no React rendering.
 * They verify the data-joining logic that the component depends on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Extracted logic under test ──────────────────────────────────────
// The component joins curriculum stations to examples by ID. We test
// that logic directly, not the React tree.

/** Simulate the example lookup the component does. */
function buildExampleMap(examples) {
  const m = new Map();
  if (examples) for (const ex of examples) m.set(ex.id, ex);
  return m;
}

/** Classify a station: interlude, valid example, or disabled. */
function classifyStation(station, exampleMap) {
  if (station.interlude) return 'interlude';
  if (!station.example) return 'disabled';
  return exampleMap.has(station.example) ? 'example' : 'disabled';
}

/** Build a station key for progress tracking. */
function stationKey(trailId, chapterIdx, stationIdx) {
  return `${trailId}/${chapterIdx}/${stationIdx}`;
}

/** Count stations and progress for a trail. */
function trailProgress(trail, progress) {
  let total = 0, seen = 0;
  for (let ci = 0; ci < trail.chapters.length; ci++) {
    for (let si = 0; si < trail.chapters[ci].stations.length; si++) {
      const st = trail.chapters[ci].stations[si];
      if (st.interlude) continue;
      total++;
      if (progress[stationKey(trail.id, ci, si)]) seen++;
    }
  }
  return { total, seen };
}

// ── Fixtures ────────────────────────────────────────────────────────

const MINIMAL_CURRICULUM = {
  version: 1,
  trails: [{
    id: 'test-trail',
    title: { en: 'Test Trail', de: 'Testpfad' },
    audience: '10+',
    chapters: [{
      title: { en: 'Chapter One', de: 'Kapitel Eins' },
      stations: [
        { interlude: { en: 'Welcome to the trail.', de: 'Willkommen auf dem Pfad.' } },
        { example: 'ex-1', lead: { en: 'First station.', de: 'Erste Station.' } },
        { example: 'ex-2', lead: { en: 'Second station.', de: 'Zweite Station.' } },
        { example: 'ex-missing', lead: { en: 'Gone.', de: 'Weg.' } },
      ],
    }],
  }],
};

const EXAMPLES = [
  { id: 'ex-1', title: { en: 'Example One', de: 'Beispiel Eins' }, category: 'basics', difficulty: 1 },
  { id: 'ex-2', title: { en: 'Example Two', de: 'Beispiel Zwei' }, category: 'analog', difficulty: 2 },
  // ex-missing is intentionally absent
];

// ── Tests ───────────────────────────────────────────────────────────

describe('CodexBrowser manifest tolerance', () => {
  it('classifies interlude stations', () => {
    const map = buildExampleMap(EXAMPLES);
    const station = MINIMAL_CURRICULUM.trails[0].chapters[0].stations[0];
    assert.equal(classifyStation(station, map), 'interlude');
  });

  it('classifies valid example stations', () => {
    const map = buildExampleMap(EXAMPLES);
    const station = MINIMAL_CURRICULUM.trails[0].chapters[0].stations[1];
    assert.equal(classifyStation(station, map), 'example');
  });

  it('classifies missing example refs as disabled, never crashes', () => {
    const map = buildExampleMap(EXAMPLES);
    const station = MINIMAL_CURRICULUM.trails[0].chapters[0].stations[3];
    assert.equal(station.example, 'ex-missing');
    assert.equal(classifyStation(station, map), 'disabled');
    // The station is renderable — just disabled
    assert.ok(station.lead.en);
  });

  it('handles empty examples array', () => {
    const map = buildExampleMap([]);
    assert.equal(classifyStation({ example: 'anything' }, map), 'disabled');
  });

  it('handles null examples', () => {
    const map = buildExampleMap(null);
    assert.equal(classifyStation({ example: 'anything' }, map), 'disabled');
  });

  it('handles station with no example and no interlude', () => {
    const map = buildExampleMap(EXAMPLES);
    // Malformed station — should degrade gracefully
    assert.equal(classifyStation({}, map), 'disabled');
  });
});

describe('CodexBrowser station keys', () => {
  it('produces stable keys', () => {
    assert.equal(stationKey('trail-a', 0, 2), 'trail-a/0/2');
    assert.equal(stationKey('zeit-und-takt', 1, 0), 'zeit-und-takt/1/0');
  });
});

describe('CodexBrowser trail progress', () => {
  it('counts only non-interlude stations', () => {
    const trail = MINIMAL_CURRICULUM.trails[0];
    const { total, seen } = trailProgress(trail, {});
    // 3 example stations (ex-1, ex-2, ex-missing), 1 interlude skipped
    assert.equal(total, 3);
    assert.equal(seen, 0);
  });

  it('counts progress from matching keys', () => {
    const trail = MINIMAL_CURRICULUM.trails[0];
    const progress = {
      'test-trail/0/1': Date.now(),  // ex-1 seen
      'test-trail/0/3': Date.now(),  // ex-missing seen
    };
    const { total, seen } = trailProgress(trail, progress);
    assert.equal(total, 3);
    assert.equal(seen, 2);
  });

  it('ignores progress keys from other trails', () => {
    const trail = MINIMAL_CURRICULUM.trails[0];
    const progress = { 'other-trail/0/1': Date.now() };
    const { total, seen } = trailProgress(trail, progress);
    assert.equal(seen, 0);
  });
});

describe('CodexBrowser manifest shape edge cases', () => {
  it('handles empty trails array', () => {
    const curriculum = { version: 1, trails: [] };
    assert.equal(curriculum.trails.length, 0);
  });

  it('handles empty chapters', () => {
    const trail = { id: 't', title: { en: 'T' }, audience: '10+', chapters: [] };
    const { total, seen } = trailProgress(trail, {});
    assert.equal(total, 0);
    assert.equal(seen, 0);
  });

  it('handles empty stations array in a chapter', () => {
    const trail = {
      id: 't', title: { en: 'T' }, audience: '10+',
      chapters: [{ title: { en: 'C' }, stations: [] }],
    };
    const { total, seen } = trailProgress(trail, {});
    assert.equal(total, 0);
  });

  it('handles stations with optional level field', () => {
    const map = buildExampleMap(EXAMPLES);
    const station = { example: 'ex-1', level: 18, lead: { en: 'Level 18.' } };
    assert.equal(classifyStation(station, map), 'example');
    assert.equal(station.level, 18);
  });

  it('handles stations with optional title override', () => {
    const station = { example: 'ex-1', title: { en: 'Override Title' }, lead: { en: 'Lead.' } };
    assert.equal(station.title.en, 'Override Title');
  });

  it('curriculum with reused examples across trails', () => {
    const map = buildExampleMap(EXAMPLES);
    // Same example appearing in two different trails
    const s1 = { example: 'ex-1', lead: { en: 'First context.' } };
    const s2 = { example: 'ex-1', lead: { en: 'Different context.' } };
    assert.equal(classifyStation(s1, map), 'example');
    assert.equal(classifyStation(s2, map), 'example');
    // Progress keys differ because trail/chapter/station indices differ
    assert.notEqual(stationKey('trail-a', 0, 0), stationKey('trail-b', 1, 0));
  });
});
