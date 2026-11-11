import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from '../packages/node/index.mjs';

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
