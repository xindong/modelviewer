import { fork } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { safeText } from '../diagnostics.mjs';
import { validateOptions } from '../options.mjs';

const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const failure = (code, message, details) => Object.assign(new Error(message), { code, ...(details === undefined ? {} : { details }) });

/** A single persistent isolated worker, bounded queue, per-service preparation LRU.
 * Serial execution is required by the upstream loader's process-global adapters.
 * Cancellation never reuses a process whose native work might still be running. */
export function createPreviewPool({ maxQueue = 32, maxTasks = 64, maxRssBytes = 1024 ** 3,
  cacheEntries = 4, cacheBytes = 64 * 1024 ** 2, gpuPixels = 4 * 1024 ** 2,
  idleMs = 60_000 } = {}) {
  for (const [name, value] of Object.entries({ maxQueue, maxTasks, maxRssBytes, cacheEntries, cacheBytes, gpuPixels, idleMs })) {
    if (!Number.isSafeInteger(value) || value < (['maxTasks', 'maxRssBytes'].includes(name) ? 1 : 0))
      throw failure('INVALID_ARGUMENT', `${name} must be a bounded nonnegative integer.`);
  }
  const budget = { maxTasks, maxRssBytes, cacheEntries, cacheBytes, gpuPixels };
  let slot;
  let closed = false;
  let broken;
  let closing;
  let sequence = 0;
  const queue = [];
  const retirements = new Set();

  function finish(task, error, result) {
    if (!task || task.done) return;
    task.done = true;
    const timings = result?.data?.timings ?? error?.details?.timings;
    if (timings) {
      timings.queueMs = (task.startedAt ?? performance.now()) - task.submittedAt;
      timings.startupMs = task.startupMs ?? null;
      timings.totalMs = performance.now() - task.submittedAt;
    }
    clearTimeout(task.timer);
    task.signal?.removeEventListener('abort', task.abort);
    if (error) task.reject(error);
    else task.resolve(result);
  }

  function retire(worker) {
    if (worker.retiring) return worker.retiring;
    worker.dead = true;
    clearTimeout(worker.idleTimer);
    worker.retiring = (async () => {
      const child = worker.child;
      if (child?.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      } else if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (worker.childClosed) await worker.childClosed;
      // Match SDK cleanup: don't delete native FBX workspace while a descendant lives.
      if (child?.pid && process.platform !== 'win32') {
        const deadline = performance.now() + 5000;
        while (true) {
          try { process.kill(-child.pid, 0); }
          catch (error) {
            if (error.code === 'ESRCH') break;
            if (error.code !== 'EPERM') throw error;
          }
          if (performance.now() >= deadline) throw failure('WORKER_CLEANUP_FAILED', 'Model worker process group did not exit.');
          await delay(25);
        }
      }
      if (worker.directory) await rm(worker.directory, { recursive: true, force: true });
    })();
    retirements.add(worker.retiring);
    worker.retiring.then(() => retirements.delete(worker.retiring), () => retirements.delete(worker.retiring));
    return worker.retiring;
  }

  function failPool(error) {
    broken = failure('WORKER_CLEANUP_FAILED', '模型预览进程清理失败，运行时已停止', { cause: error.message });
    for (const task of queue.splice(0)) finish(task, broken);
  }

  async function stopWorker(worker, error, result) {
    if (worker.stopping) return worker.stopping;
    worker.stopping = (async () => {
      const task = worker.task;
      clearTimeout(task?.timer);
      try {
        await retire(worker);
        finish(task, error, result);
      } catch (cleanupError) {
        failPool(cleanupError);
        finish(task, broken);
      } finally {
        worker.task = undefined;
        if (slot === worker) slot = undefined;
        pump();
      }
    })();
    return worker.stopping;
  }

  function spawnWorker(task) {
    const worker = { task, ready: false, dead: false, stderr: '' };
    slot = worker;
    try {
      worker.directory = mkdtempSync(join(tmpdir(), 'mivo-model-task-'));
      const child = fork(workerPath, [worker.directory], {
        detached: process.platform !== 'win32', serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: ['--max-old-space-size=2048'],
      });
      worker.child = child;
      worker.childClosed = new Promise(resolve => child.once('close', resolve));
      child.stderr.on('data', bytes => { worker.stderr = (worker.stderr + safeText(bytes.toString())).slice(-16384); });
      child.on('error', error => { void stopWorker(worker, failure('WORKER_START_FAILED', error.message, { stderr: worker.stderr })); });
      child.on('exit', (code, signal) => {
        if (!worker.dead) void stopWorker(worker, failure('WORKER_CRASHED', `Model worker exited (${signal || code}).`, { stderr: worker.stderr }));
      });
      child.on('disconnect', () => {
        if (!worker.dead) void stopWorker(worker, failure('WORKER_CRASHED', 'Model worker IPC disconnected.', { stderr: worker.stderr }));
      });
      child.on('message', message => {
        if (worker.dead || slot !== worker) return;
        if (message?.type === 'ready' && message.protocol === 1) { worker.ready = true; dispatch(worker); return; }
        if (message?.type === 'progress') {
          const task = worker.task;
          if (task?.sent && !task.done && !task.cancelling && message.id === task.id) {
            try { task.onProgress?.(safeText(message.message)); } catch {}
          }
          return;
        }
        if (message?.type !== 'result' || !worker.task || !worker.task.sent || message.id !== worker.task.id) return;
        const task = worker.task;
        if (task.cancelling) return;
        if (message.ok !== true || message.recycle) {
          const cause = message.ok === true ? null : failure(message.error?.code || 'PROCESSING_FAILED',
            message.error?.message || 'Model render failed.', message.error?.details);
          void stopWorker(worker, cause, message.result);
        } else {
          finish(task, null, message.result);
          worker.task = undefined;
          pump();
        }
      });
    } catch (error) {
      void stopWorker(worker, failure('WORKER_START_FAILED', error.message));
    }
    return worker;
  }

  function dispatch(worker) {
    if (!worker.ready || worker.dead || !worker.task || worker.task.sent) return;
    const task = worker.task;
    task.sent = true;
    task.startupMs = performance.now() - task.startedAt;
    try {
      worker.child.send({ type: 'render', id: task.id, source: task.source,
        options: task.options, budget }, error => {
        if (error && slot === worker && worker.task === task && !task.done)
          void stopWorker(worker, failure('WORKER_START_FAILED', error.message));
      });
    } catch (error) {
      void stopWorker(worker, failure('WORKER_START_FAILED', error.message));
    }
  }

  function pump() {
    if (closed || broken || slot?.dead || slot?.task) return;
    while (queue[0]?.done) queue.shift();
    if (!queue.length) {
      if (slot && idleMs && !slot.idleTimer) {
        const worker = slot;
        worker.idleTimer = setTimeout(() => { void stopWorker(worker); }, idleMs);
        worker.idleTimer.unref();
      }
      return;
    }
    const task = queue.shift();
    task.startedAt = performance.now();
    const worker = slot || spawnWorker(task);
    if (worker.dead) return;
    clearTimeout(worker.idleTimer); worker.idleTimer = undefined;
    worker.task = task;
    dispatch(worker);
  }

  function renderModelImages(source, options = {}) {
    return new Promise((resolve, reject) => {
      if (closed) return reject(failure('PREVIEW_DISPOSED', '模型预览服务已关闭'));
      if (broken) return reject(broken);
      options = validateOptions('render', options);
      // Preview tasks use local resources only, including when bypassing TS types.
      options.allowNetwork = false;
      if (options.signal?.aborted) return reject(options.signal.reason || failure('ABORTED', 'Model task was cancelled.'));
      if ((slot?.task || slot?.dead) && queue.length >= maxQueue) return reject(failure('QUEUE_FULL', 'Model preview queue is full.'));
      const { signal, onProgress, ...serializable } = options;
      const task = { id: ++sequence, source, options: serializable, signal, onProgress, resolve, reject, submittedAt: performance.now() };
      function cancel(error) {
        if (task.done || task.cancelling) return;
        task.cancelling = true;
        if (slot?.task === task) void stopWorker(slot, error);
        else {
          const index = queue.indexOf(task);
          if (index >= 0) queue.splice(index, 1);
          finish(task, error); pump();
        }
      }
      task.abort = () => cancel(signal.reason || failure('ABORTED', 'Model task was cancelled.'));
      signal?.addEventListener('abort', task.abort, { once: true });
      task.timer = setTimeout(() => cancel(failure('TIMEOUT', 'Model task deadline exceeded.', {
        timings: { unit: 'ms', totalMs: performance.now() - task.submittedAt },
      })), options.timeout * 1000);
      queue.push(task);
      if (signal?.aborted) task.abort();
      else pump();
    });
  }

  function close() {
    if (closing) return closing;
    closed = true;
    const error = failure('PREVIEW_DISPOSED', '模型预览服务已关闭');
    for (const task of queue.splice(0)) finish(task, error);
    closing = (async () => {
      if (slot) await stopWorker(slot, error);
      await Promise.all([...retirements]);
      if (broken) throw broken;
    })();
    return closing;
  }
  return { renderModelImages, close };
}
