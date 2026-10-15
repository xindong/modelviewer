import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { createModelPreviewProcessor } from '../node/index.mjs';

const renderEnabled = Boolean(process.env.MIVO_TEST_RENDER);
const device = process.env.MIVO_TEST_DEVICE ?? 'auto';

async function embeddedGLB() {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document.createAccessor().setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]));
  const material = document.createMaterial().setDoubleSided(true)
    .setBaseColorFactor([1, 0.25, 0.1, 1]);
  const primitive = document.createPrimitive().setAttribute('POSITION', positions)
    .setMaterial(material);
  document.createScene().addChild(document.createNode()
    .setMesh(document.createMesh().addPrimitive(primitive)));
  return { bytes: await new NodeIO().writeBinary(document), fileName: 'preview-triangle.glb' };
}

function hostState() {
  const names = new Set([
    'window', 'document', 'navigator', 'self', 'Image', 'ImageData',
    'HTMLCanvasElement', 'OffscreenCanvas',
    ...Object.getOwnPropertyNames(globalThis).filter(name => /^GPU/.test(name)),
  ]);
  return {
    globals: Object.fromEntries([...names].map(name => [name,
      Object.getOwnPropertyDescriptor(globalThis, name)])),
    gpu: globalThis.navigator?.gpu,
    environment: { ...process.env },
  };
}

async function assertPreview(result, width, height) {
  assert.deepEqual(Object.keys(result).sort(), ['data', 'ok', 'outputs', 'warnings']);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), ['render', 'timings']);
  assert.ok(Array.isArray(result.warnings));
  for (const warning of result.warnings) {
    assert.equal(typeof warning.code, 'string');
    assert.equal(typeof warning.message, 'string');
  }
  assert.ok(Array.isArray(result.outputs));
  assert.equal(result.outputs.length, 1);
  const output = result.outputs[0];
  assert.equal(output.view, 'front');
  assert.equal(output.format, 'png');
  assert.equal(typeof output.name, 'string');
  assert.match(output.name, /\.png$/);
  assert.equal(output.width, width);
  assert.equal(output.height, height);
  assert.ok(output.bytes instanceof Uint8Array);
  assert.deepEqual(Buffer.from(output.bytes.subarray(0, 8)),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const metadata = await sharp(output.bytes).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  const { data } = await sharp(output.bytes).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(data.some((value, index) => index % 4 === 3 && value > 0),
    'The PNG must contain visible geometry, not just a transparent background');
  const render = result.data.render;
  assert.equal(render.width, width);
  assert.equal(render.height, height);
  assert.deepEqual(render.views, ['front']);
  const timings = result.data.timings;
  assert.equal(timings.unit, 'ms');
  for (const name of ['totalMs', 'queueMs', 'startupMs', 'loadMs', 'prepareMs',
    'renderMs', 'workerMs', 'gpuInitMs', 'gpuResizeMs']) {
    assert.ok(Number.isFinite(timings[name]) && timings[name] >= 0,
      `${name} must be a finite nonnegative number; received ${timings[name]}`);
  }
  assert.ok(timings.totalMs >= timings.workerMs);
  assert.ok(timings.workerMs >= timings.renderMs);
  assert.equal(typeof timings.cacheHit, 'boolean');
  assert.equal(typeof timings.gpuReused, 'boolean');
}

test('preview: processor options reject invalid budgets', () => {
  const minima = { maxQueue: 0, maxTasks: 1, maxRssBytes: 1, cacheEntries: 0,
    cacheBytes: 0, gpuPixels: 0, idleMs: 0 };
  for (const [name, minimum] of Object.entries(minima)) {
    for (const value of [minimum - 1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
      '1', null, true]) {
      assert.throws(() => createModelPreviewProcessor({ [name]: value }),
        { code: 'INVALID_ARGUMENT' }, `${name}=${String(value)}`);
    }
  }
});

test('preview: zero optional budgets and minimum positive budgets are accepted', async () => {
  const processor = createModelPreviewProcessor({ maxQueue: 0, maxTasks: 1,
    maxRssBytes: 1, cacheEntries: 0, cacheBytes: 0, gpuPixels: 0, idleMs: 0 });
  assert.equal(typeof processor.renderModelImages, 'function');
  assert.equal(typeof processor.close, 'function');
  await processor.close();
});

test('preview: invalid render options reject before loading a source', async t => {
  const processor = createModelPreviewProcessor();
  t.after(() => processor.close());
  for (const options of [null, [], { timeout: 0 }, { timeout: -1 },
    { timeout: Infinity }, { timeout: 86401 }, { width: 0 }, { height: -1 },
    { width: 1.5 }, { format: 'gif' }, { views: ['invalid-view'] },
    { onProgress: true }, { resourceDirs: 'somewhere' }]) {
    await assert.rejects(processor.renderModelImages('unused.glb', options),
      { code: 'INVALID_ARGUMENT' }, JSON.stringify(options));
  }
});

test('preview: omitted timeout accepts an already-aborted signal and preserves its reason', async t => {
  const before = hostState();
  const processor = createModelPreviewProcessor();
  t.after(() => processor.close());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(processor.renderModelImages('unused.glb', {
    signal: controller.signal,
  }), error => error === controller.signal.reason || error.code === 'ABORTED');
  const reason = Object.assign(new Error('Cancelled by caller'), { code: 'ABORTED' });
  await assert.rejects(processor.renderModelImages('unused.glb', {
    signal: AbortSignal.abort(reason),
  }), error => error === reason);
  assert.deepEqual(hostState(), before);
});

test('preview: close rejects running, queued and subsequent requests and is idempotent', {
  timeout: 15_000,
}, async t => {
  const processor = createModelPreviewProcessor();
  t.after(() => processor.close());
  const source = await embeddedGLB();
  // Register rejection handlers before closing; no GPU initialization is needed.
  const running = assert.rejects(processor.renderModelImages(source), { code: 'PREVIEW_DISPOSED' });
  const queued = assert.rejects(processor.renderModelImages(source), { code: 'PREVIEW_DISPOSED' });
  await Promise.all([running, queued, processor.close()]);
  await processor.close();
  await assert.rejects(processor.renderModelImages(source), { code: 'PREVIEW_DISPOSED' });
});

test('preview: embedded GLB resizes PNGs while reusing preparation and GPU in an isolated worker', {
  skip: !renderEnabled, timeout: 60_000,
}, async t => {
  const before = hostState();
  const processor = createModelPreviewProcessor({ idleMs: 0 });
  t.after(() => processor.close());
  const source = await embeddedGLB();
  const original = source.bytes.slice();
  try {
    for (const [index, [width, height]] of [[64, 64], [128, 96]].entries()) {
      // Deliberately omit the SDK timeout to exercise its default on real work.
      const result = await processor.renderModelImages(source, {
        width, height, views: ['front'], format: 'png', device,
      });
      t.diagnostic(JSON.stringify({ width, height, timings: result.data.timings,
        render: result.data.render }));
      await assertPreview(result, width, height);
      assert.equal(result.data.timings.cacheHit, index === 1);
      assert.equal(result.data.timings.gpuReused, index === 1);
      assert.deepEqual(source.bytes, original, 'Rendering must not mutate the source GLB');
      assert.deepEqual(hostState(), before, 'Worker adapters/GPU must not pollute the host');
    }
  } finally {
    await processor.close();
    assert.deepEqual(hostState(), before, 'Closing must leave host globals and environment intact');
  }
});

test('preview: maxTasks budget retires the worker and resets preparation/GPU reuse', {
  skip: !renderEnabled, timeout: 60_000,
}, async t => {
  const processor = createModelPreviewProcessor({ maxTasks: 1, idleMs: 0 });
  t.after(() => processor.close());
  const source = await embeddedGLB();
  for (let iteration = 0; iteration < 2; iteration++) {
    const result = await processor.renderModelImages(source, {
      width: 64, height: 64, views: ['front'], format: 'png', device,
    });
    t.diagnostic(JSON.stringify({ iteration, maxTasks: 1, timings: result.data.timings }));
    await assertPreview(result, 64, 64);
    assert.equal(result.data.timings.cacheHit, false, 'A retired worker must lose its model cache');
    assert.equal(result.data.timings.gpuReused, false, 'A retired worker must release its GPU');
  }
});
