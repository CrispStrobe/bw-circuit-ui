/** The example catalogue and external intro button share one intro document. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const browser = readFileSync(new URL('../src/components/ExamplesBrowser.jsx', import.meta.url), 'utf8');
const intro = readFileSync(new URL('../src/intro-doc.jsx', import.meta.url), 'utf8');

const assertConverged = ({browserSource, introSource}) => {
  const sharedImport = /import \{([\s\S]*?)\}\s*from ['"]\.\.\/intro-doc\.jsx['"]/.exec(browserSource);
  assert.ok(sharedImport, 'ExamplesBrowser must import the shared intro document by its stable relative path');
  for (const name of ['INTRO_L10N', 'LEVEL_LABELS', 'LEVEL_COLORS', 'parseIntro', 'renderMarkdown']) {
    assert.match(sharedImport[1], new RegExp(`\\b${name}\\b`),
      `ExamplesBrowser no longer imports shared ${name}`);
    assert.match(introSource, new RegExp(`export (?:const|function) ${name}\\b`),
      `intro-doc no longer exports ${name}`);
  }
  assert.doesNotMatch(browserSource, /function (?:parseIntro|renderMarkdown)\b/,
    'the catalogue rebuilt a private intro parser or renderer');
  assert.doesNotMatch(browserSource, /\bdeviceCompat(?:Reason)?\s*\(/,
    'the catalogue must not judge an example against a device chosen before browsing');
  assert.match(browserSource, /disabled=\{false\}[\s\S]*disabledReason=\{''\}/,
    'catalogue cards must remain browsable until the confirm dialog chooses a device');
};

test('ExamplesBrowser consumes the extracted intro contract and does not pre-disable cards', () => {
  assertConverged({browserSource: browser, introSource: intro});
});

test('the convergence contract catches duplicate parser and pre-selection mutations', () => {
  assert.throws(() => assertConverged({
    browserSource: `${browser}\nfunction parseIntro() { return {}; }`, introSource: intro
  }), /private intro parser/);
  assert.throws(() => assertConverged({
    browserSource: browser.replace('disabled={false}', 'disabled={deviceCompat(ex, currentDevice).ok}'),
    introSource: intro
  }), /chosen before browsing/);
  assert.throws(() => assertConverged({
    browserSource: browser, introSource: intro.replace('export function renderMarkdown', 'function renderMarkdown')
  }), /intro-doc no longer exports renderMarkdown/);
});
