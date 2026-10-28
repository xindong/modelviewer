import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importOptional, isMissingModuleError } from '../node/optional.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const hook = pathToFileURL(fileURLToPath(new URL('./support/block-optional-deps.mjs', import.meta.url))).href;

test('isMissingModuleError recognises missing packages and platform binaries, not real failures', () => {
  assert.equal(isMissingModuleError(Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' })), true);
  assert.equal(isMissingModuleError(Object.assign(new Error('x'), { code: 'MODULE_NOT_FOUND' })), true);
  assert.equal(isMissingModuleError(Object.assign(new Error('x'), { code: 'ERR_DLOPEN_FAILED' })), true);
  assert.equal(isMissingModuleError(new Error("Cannot find package 'sharp' imported from x")), true);
  assert.equal(isMissingModuleError(new Error('Could not load the "sharp" module using the darwin-arm64 runtime')), true);
  assert.equal(isMissingModuleError(new Error('boom')), false);
  assert.equal(isMissingModuleError(Object.assign(new Error('x'), { code: 'EACCES' })), false);
  assert.equal(isMissingModuleError(null), false);
  assert.equal(isMissingModuleError('string'), false);
});

test('importOptional passes a loaded module through untouched', async () => {
  const mod = { default: 1 };
  assert.equal(await importOptional('whatever', 'feature', async () => mod), mod);
});

test('importOptional turns a missing package into a stable, actionable error', async () => {
  await assert.rejects(
    importOptional('sharp', 'Image encoding (render)', async () => {
      throw Object.assign(new Error("Cannot find package 'sharp'"), { code: 'ERR_MODULE_NOT_FOUND' });
    }),
    (error) => {
      assert.equal(error.code, 'OPTIONAL_DEPENDENCY_MISSING');
      assert.equal(error.dependency, 'sharp');
      assert.match(error.message, /Image encoding \(render\)/);
      assert.match(error.message, /npm install sharp/);
      assert.match(error.message, /--omit=optional/);
      return true;
    },
  );
});

test('importOptional rethrows genuine failures instead of masking them as "not installed"', async () => {
  const failure = new TypeError('syntax error inside the package');
  await assert.rejects(importOptional('sharp', 'x', async () => { throw failure; }), (error) => error === failure);
});

// The point of declaring @napi-rs/canvas as optional: with it absent the Node modules
// still load, and the code paths that need it fail with a clear, stable code.
test('without @napi-rs/canvas: modules load and the texture adapters fail with OPTIONAL_DEPENDENCY_MISSING', () => {
  const script = `
    await import('./node/optimize.mjs');
    await import('./node/render.mjs');
    await import('./node/preview/render.mjs');
    const { installNodeAdapters } = await import('./node/adapters.mjs');
    const { installNodeAdapters: installPreviewAdapters } = await import('./node/preview/adapters.mjs');
    const describe = (e) => ({ code: e.code, dependency: e.dependency });
    const adapters = await installNodeAdapters({}).then(() => 'ok', describe);
    const preview = await installPreviewAdapters({}).then(() => 'ok', describe);
    console.log(JSON.stringify({ adapters, preview }));
  `;
  const run = spawnSync(process.execPath, ['--import', hook, '--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}`);
  const result = JSON.parse(run.stdout.trim().split('\n').pop());
  const expected = { code: 'OPTIONAL_DEPENDENCY_MISSING', dependency: '@napi-rs/canvas' };
  assert.deepEqual(result.adapters, expected);
  assert.deepEqual(result.preview, expected);
});

// `npm install --omit=optional` (or a platform without a prebuilt binary) is a supported
// install: the success path can only be asserted when the package actually loads here.
const canvasInstalled = await import('@napi-rs/canvas').then(() => true, () => false);

test('with the packages installed, the adapters install and dispose normally', { skip: !canvasInstalled && '@napi-rs/canvas is not installed' }, () => {
  const script = `
    const { installNodeAdapters } = await import('./node/adapters.mjs');
    const adapter = await installNodeAdapters({});
    console.log(JSON.stringify({ ok: !!adapter }));
    await adapter?.dispose?.();
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}`);
  assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()), { ok: true });
});
