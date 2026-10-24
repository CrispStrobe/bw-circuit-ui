import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

/** Real chooser, installed engine, scope controls and native audio nodes. */
export async function verifyScopeAperture(page, origin) {
  await page.addInitScript(() => {
    const Native = window.AudioContext || window.webkitAudioContext;
    window.__scopeNativeSources = [];
    if (!Native) return;
    window.AudioContext = class extends Native {
      createBufferSource() {
        window.__scopeNativeContext = this;
        const source = super.createBufferSource();
        const record = {started: false, disconnected: false};
        window.__scopeNativeSources.push(record);
        const start = source.start.bind(source), disconnect = source.disconnect.bind(source);
        source.start = (...args) => {
          record.started = true; record.rate = source.buffer.sampleRate;
          record.frames = source.buffer.length;
          record.peak = Math.max(...source.buffer.getChannelData(0).map(Math.abs));
          return start(...args);
        };
        source.disconnect = (...args) => {record.disconnected = true; return disconnect(...args);};
        return source;
      }
    };
  });
  await page.goto(`${origin}/?examples=none`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__circuit && window.__board);
  const fixture = {parts: [
    {id: 'pulse', kind: 'vsource', x: 100, y: 100,
      params: {wave: 'spice-pulse', v1: 0, v2: 4, td: .000025, tr: .000001, tf: .000001, pw: 0, per: .001}},
    {id: 'load', kind: 'resistor', x: 250, y: 100, params: {ohms: 1000}},
    {id: 'ground', kind: 'gnd', x: 100, y: 230, params: {}},
  ], nets: [
    {id: 'signal', terminals: [{part: 'pulse', terminal: 'pos'}, {part: 'load', terminal: 'a'}]},
    {id: 'ground', terminals: [{part: 'pulse', terminal: 'neg'}, {part: 'load', terminal: 'b'}, {part: 'ground', terminal: 'gnd'}]},
  ]};
  await page.getByRole('button', {name: 'More circuit controls', exact: true}).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', {name: /^📂 Open$/}).click();
  await (await choosing).setFiles({name: 'aperture-pulses.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(() => window.__circuit.parts.length === 3 && window.__circuit.getPart('pulse'));
  if (!await page.locator('[data-instruments-column]').count()) await page.getByRole('button', {name: /Expand instruments panel/i}).click();
  if (!await page.locator('[data-scope-panel]').count()) await page.getByRole('button', {name: /Scope/i}).first().click();
  const scope = page.locator('[data-scope-panel]');
  const allReleased = () => page.waitForFunction(() => window.__scopeNativeSources.every(s => !s.started || s.disconnected));
  const startLive = async () => {
    const before = await page.evaluate(() => window.__scopeNativeSources.filter(s => s.started).length);
    await scope.getByTestId('bw-scope-audio-listen').click();
    await page.waitForFunction(before => window.__scopeNativeSources.filter(s => s.started).length > before
      && window.__scopeNativeSources.some(s => s.started && !s.disconnected), before);
  };
  await scope.locator('select').last().selectOption('signal');
  await scope.getByRole('button', {name: '+ channel', exact: true}).click();
  await scope.getByTestId('bw-scope-view-spectrum').click();
  assert.equal(await scope.getByTestId('bw-scope-capture-mode').inputValue(), 'sample');
  await page.getByRole('radio', {name: /Sim/i}).first().click();
  const records = () => page.evaluate(() => [...window.__board._scopeChannels]
    .map(([handle]) => ({handle, data: window.__board.getScopeData(handle)}))
    .map(({handle, data}) => {
      const depth = data.samples.length / 2, available = Math.min(data.count, depth);
      const oldest = (data.writeIndex - available + depth) % depth;
      return {handle, capture: data.capture, count: data.count,
        interval: String(data.sampleIntervalNs), aperture: String(data.apertureNs),
        values: Array.from({length: available}, (_, i) => data.samples[((oldest + i) % depth) * 2])};
    }));
  await page.waitForFunction(() => [...window.__board._scopeChannels.values()].some(c => c.capture === 'sample' && c.count >= 1000));
  const points = (await records()).find(r => r.capture === 'sample');
  assert.ok(points.values.every(v => Math.abs(v) < 1e-8), 'point sampling misses these authored narrow pulses');
  assert.equal(await scope.getByTestId('bw-scope-audio-input').inputValue(), 'average');
  await scope.getByTestId('bw-scope-audio-play').click();
  await page.waitForFunction(() => window.__scopeNativeSources.some(s => s.started && s.peak > 0));
  await scope.getByTestId('bw-scope-audio-stop').click(); await allReleased();
  assert.equal(await scope.getByTestId('bw-scope-capture-mode').inputValue(), 'sample',
    'default interval-mean audio does not change the FFT acquisition');
  await scope.getByTestId('bw-scope-audio-input').selectOption('spectrum');
  await page.waitForFunction(() => [...window.__board._scopeChannels.values()].every(c => c.capture !== 'average'));
  await scope.getByTestId('bw-scope-spectrum-0').filter({hasText: /pts, .*Hz\/bin/}).waitFor();
  await scope.getByRole('button', {name: 'RUN', exact: true}).click();
  await scope.getByTestId('bw-scope-capture-mode').selectOption('average');
  await scope.getByTestId('bw-scope-spectrum-0').waitFor({state: 'detached'});
  await page.waitForFunction(() => [...window.__board._scopeChannels.values()].some(c => c.capture === 'average' && c.count >= 1000));
  const mean = (await records()).find(r => r.capture === 'average');
  assert.equal(mean.aperture, mean.interval); assert.equal(mean.interval, '100000');
  const complete = mean.values.length - mean.values.length % 10;
  const area = mean.values.slice(0, complete).reduce((sum, v) => sum + v * .0001, 0);
  assert.ok(Math.abs(area - complete / 10 * .000004) < 1e-9,
    'actual triangle area survives independently of capture phase');
  assert.equal((await records()).filter(r => r.capture === 'sample').length, 0);
  await scope.getByRole('button', {name: 'HOLD', exact: true}).click();
  await scope.getByTestId('bw-scope-aperture-description').filter({hasText: /100 µs/}).waitFor();
  await scope.getByTestId('bw-scope-acquisition-0').filter({hasText: /Interval means.*aperture 100 µs/}).waitFor();
  const downloading = page.waitForEvent('download');
  await scope.getByTestId('bw-scope-audio-wav').click();
  const download = await downloading, wav = await readFile(await download.path());
  assert.equal(download.suggestedFilename(), 'scope-interval-means.wav');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), 10000);
  assert.ok(wav.subarray(44).some(value => value !== 0), 'export contains actual filtered pulse data');
  await scope.getByTestId('bw-scope-audio-play').click();
  await page.waitForFunction(() => window.__scopeNativeSources.some(s => s.started && s.rate === 10000 && s.peak > 0));
  await scope.getByTestId('bw-scope-audio-stop').click();
  await allReleased();
  await startLive();
  await scope.getByTestId('bw-scope-audio-stream-status').filter({hasText: /Playing|Buffering/}).waitFor();
  const before = mean.handle;
  await scope.getByTestId('bw-scope-audio-bandwidth').selectOption('none');
  await allReleased();
  assert.equal((await records()).find(r => r.capture === 'average').handle, before, 'output filtering never replaces the acquisition');
  await startLive();
  await scope.getByTestId('bw-scope-capture-mode').selectOption('sample');
  await allReleased();
  await page.waitForFunction(() => [...window.__board._scopeChannels.values()].every(c => c.capture !== 'average'));
  await startLive();
  await page.getByRole('button', {name: /Scope/i}).first().click();
  await scope.waitFor({state: 'detached'}); await allReleased();
  const closed = await page.evaluate(() => ({time: window.__scopeNativeContext.currentTime,
    count: window.__scopeNativeSources.length}));
  await page.waitForFunction(time => window.__scopeNativeContext.currentTime > time + .06, closed.time);
  assert.equal(await page.evaluate(() => window.__scopeNativeSources.length), closed.count,
    'unmounted listening cannot schedule new native nodes');
  return ['authored pulses survive explicit aperture acquisition and actual WAV/native replay',
    'filter, capture and unmount changes release native audio without changing acquisition'];
}
