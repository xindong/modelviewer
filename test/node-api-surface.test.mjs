import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from '../packages/node/index.mjs';
import { PRESET_VIEWS } from '../packages/core/src/index.ts';
import { validateOptions } from '../packages/node/options.mjs';

// Guards the hand-written Node type declarations against drift from the runtime API.
const dts = fs.readFileSync(new URL('../packages/node/index.d.ts', import.meta.url), 'utf8');
const declaredFunctions = new Set([...dts.matchAll(/export function (\w+)/g)].map((match) => match[1]));
const runtimeFunctions = Object.keys(api).filter((key) => typeof api[key] === 'function');

test('node runtime function exports are all declared in index.d.ts', () => {
  assert.ok(runtimeFunctions.length > 0, 'no runtime exports detected');
  for (const name of runtimeFunctions) {
    assert.ok(declaredFunctions.has(name), `runtime export "${name}" is missing from index.d.ts`);
  }
});

test('index.d.ts declares no function the runtime does not export', () => {
  for (const name of declaredFunctions) {
    assert.ok(runtimeFunctions.includes(name), `index.d.ts declares "${name}" but the runtime does not export it`);
  }
});

test('index.d.ts PresetView union matches the shared PRESET_VIEWS', () => {
  const match = dts.match(/export type PresetView =([^;]+);/);
  assert.ok(match, 'PresetView type not found in index.d.ts');
  const declaredViews = new Set([...match[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
  for (const view of PRESET_VIEWS) {
    assert.ok(declaredViews.has(view), `PRESET_VIEWS has "${view}" but index.d.ts PresetView does not`);
  }
  for (const view of declaredViews) {
    assert.ok(PRESET_VIEWS.includes(view), `index.d.ts PresetView has "${view}" but PRESET_VIEWS does not`);
  }
});

test('render validator accepts every shared preset view', () => {
  for (const view of PRESET_VIEWS) {
    const options = validateOptions('render', { view });
    assert.equal(options.view, view);
  }
});
