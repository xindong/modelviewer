import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { preparePreviewBytes } from './load.mjs';
import { renderDocument } from './render.mjs';
import { createRenderer } from './gpu.mjs';
import { validateOptions } from '../options.mjs';
import { safeDiagnostics } from '../diagnostics.mjs';
import { limitsFor } from '../resources.mjs';

const directory = process.argv[2];
let stopping = false;
let busy = false;
let gpu;
let completed = 0;
let cacheBytes = 0;
const cache = new Map();
console.log = (...args) => console.error(...args);

// Same SDK janitor and POSIX process-group contract, covering native FBX children.
process.once('disconnect', () => {
  if (stopping) return;
  if (process.platform === 'win32') process.exit(1);
  const janitor = spawn(process.execPath, [
    fileURLToPath(new URL('../orphan-cleanup.mjs', import.meta.url)),
    String(process.pid), directory,
  ], { detached: true, stdio: 'ignore' });
  janitor.on('error', () => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } });
  janitor.unref();
});

// Keep this list aligned with preparePreviewBytes and its loader/resource adapters.
// Image dimensions, camera, shading, device, encoding and task deadlines do not
// change prepared geometry/textures and must share preparations across renders.
const preparationKeys = Object.freeze([
  'entry', 'entryFormats', 'entryDepth', 'fbxBackend', 'strict', 'strictFidelity',
  'center', 'animations', 'noAnimations', 'onlyVisible', 'maxTextureSize',
  'maxTexturePixels', 'stepParameters',
]);

function keyFor(source, options) {
  // Disk resources and executable overrides can change independently of the
  // supplied bytes. Do not cache preparations whose full dependency set is unknown.
  if (!source || typeof source !== 'object' || !(source.bytes instanceof Uint8Array) ||
      options.resourceDirs?.length || options.fbxBinary) return null;
  const hash = createHash('sha256');
  const part = value => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Model resources must be Uint8Array.');
    hash.update(String(bytes.byteLength)).update(':').update(bytes);
  };
  const preparation = Object.fromEntries(preparationKeys.map(key => [key, options[key]]));
  preparation.limits = limitsFor(options);
  part(JSON.stringify(preparation));
  part(source.fileName); part(source.bytes);
  for (const [name, bytes] of Object.entries(source.resources ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    part(name); part(bytes);
  }
  return hash.digest('hex');
}

function remember(key, prepared, budget) {
  // Account for diagnostics as well as encoded geometry/textures; never retain input resources.
  const size = prepared.bytes.byteLength + Buffer.byteLength(JSON.stringify(prepared.warnings));
  if (!key || !budget.cacheEntries || size > budget.cacheBytes) return;
  while (cache.size && (cache.size >= budget.cacheEntries || cacheBytes + size > budget.cacheBytes)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).size; cache.delete(oldest);
  }
  cache.set(key, { ...prepared, bytes: new Uint8Array(prepared.bytes), size }); cacheBytes += size;
}

process.on('message', async message => {
  if (message.type !== 'render' || busy || stopping) return;
  busy = true;
  const { id, source, budget } = message;
  const started = performance.now();
  const timings = { unit: 'ms', loadMs: null, exportMs: null, optimizationMs: null,
    simplifyMs: null, renderMs: null, conversionMs: null, convertAndOptimizeMs: null,
    nativeConversionMs: null, workerMs: null, prepareMs: null, cacheHit: false,
    gpuReused: false, gpuInitMs: 0, gpuResizeMs: 0 };
  let tempDir;
  let response;
  try {
    const options = validateOptions('render', { ...message.options, allowNetwork: false });
    tempDir = await mkdtemp(join(directory, 'preview-'));
    const context = {
      tempDir,
      log(message) {
        if (process.connected) process.send(safeDiagnostics({ type: 'progress', id, message }));
      },
      async acquireGPU(width, height, settings) {
        // Retain at most one device/target. Large outputs work but aren't held idle.
        const started = performance.now();
        if (width * height > budget.gpuPixels) {
          gpu?.dispose(); gpu = undefined;
          const transient = await createRenderer(width, height, settings);
          timings.gpuInitMs = performance.now() - started;
          return transient;
        }
        if (!gpu) {
          gpu = await createRenderer(width, height, settings);
          timings.gpuInitMs = performance.now() - started;
        } else if (gpu.requestedDevice !== (settings.device ?? 'auto')) {
          gpu.dispose(); gpu = undefined;
          gpu = await createRenderer(width, height, settings);
          timings.gpuInitMs = performance.now() - started;
        } else {
          gpu.resize(width, height);
          timings.gpuReused = true;
          timings.gpuResizeMs = performance.now() - started;
        }
        return gpu;
      },
      async releaseGPU(leased) {
        try { await leased.device.queue.onSubmittedWorkDone(); }
        finally { if (leased !== gpu) leased.dispose(); }
      },
    };
    context.log('Preparing model preview.');
    const loadStarted = performance.now();
    const key = keyFor(source, options);
    let prepared = cache.get(key);
    if (prepared) {
      timings.cacheHit = true;
      context.log('Reusing prepared model from memory cache.');
      for (const warning of prepared.warnings) context.log(warning.message);
      cache.delete(key); cache.set(key, prepared);
    } else {
      prepared = await preparePreviewBytes(source, options, context);
    }
    timings.loadMs = performance.now() - loadStarted;
    timings.prepareMs = timings.loadMs;
    timings.nativeConversionMs = timings.cacheHit ? 0 : prepared.nativeConversionMs;
    timings.fastPath = prepared.fastPath;
    context.log('Rendering model preview.');
    const renderStarted = performance.now();
    const rendered = await renderDocument(prepared.bytes, options, context);
    timings.renderMs = performance.now() - renderStarted;
    for (const warning of rendered.warnings) context.log(warning.message);
    // Cache only successfully validated/rendered preparations.
    if (!timings.cacheHit) remember(key, prepared, budget);
    response = { type: 'result', id, ok: true, result: { ok: true, outputs: rendered.outputs,
      warnings: [...prepared.warnings, ...rendered.warnings], data: { timings, render: rendered.data } } };
  } catch (error) {
    response = { type: 'result', id, ok: false, error: { code: error.code || 'PROCESSING_FAILED',
      message: error.message || String(error), details: { ...error.details,
        ...(error.warnings ? { warnings: error.warnings } : {}), timings } } };
  }
  // No task reply until per-task scene cleanup (renderDocument finally), GPU fence,
  // and native FBX staging directory cleanup have finished.
  try { if (tempDir) await rm(tempDir, { recursive: true, force: true }); }
  catch (error) {
    response = { type: 'result', id, ok: false, error: { code: 'WORKER_CLEANUP_FAILED',
      message: error.message, details: { timings } } };
  }
  completed++;
  const rss = process.memoryUsage().rss;
  const recycle = !response.ok || completed >= budget.maxTasks || rss >= budget.maxRssBytes;
  if (recycle) {
    stopping = true;
    try { gpu?.dispose(); } catch { /* Parent hard-kills this process on retirement. */ }
    gpu = undefined; cache.clear(); cacheBytes = 0;
  }
  timings.workerMs = performance.now() - started;
  response.rss = rss; response.recycle = recycle; response.cacheBytes = cacheBytes;
  if (process.connected) process.send(safeDiagnostics(response), error => {
    if (error) process.exit(1);
    if (recycle) { process.disconnect(); process.exit(response.ok ? 0 : 1); }
  });
  busy = false;
});
process.send({ type: 'ready', protocol: 1 });
