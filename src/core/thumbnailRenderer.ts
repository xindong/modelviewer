import { ViewerEngine } from './ViewerEngine'
import {
  applyEngineOptions,
  assertValidPadding,
  defaultBackground,
  renderOne,
  resolveModelInput,
  type ImageFormat,
  type RenderModelImageOptions,
  type RenderedImage
} from './renderModelImage'

/**
 * 缩略图渲染器：整个生命周期内复用同一个 `ViewerEngine`（一个 WebGL 上下文），
 * 任务串行执行。批量出图（聊天列表、资源库）时用它代替 `renderModelImage`，
 * 避免每张图都新建 / 销毁一个 WebGL 上下文。
 */
export interface ThumbnailRendererOptions {
  /** 空闲多少毫秒后释放引擎与 WebGL 上下文，下次出图时按需重建。0 = 不自动释放 @default 30000 */
  idleMs?: number
  /** 出图任务的默认宽度 @default 512 */
  width?: number
  /** @default 与 width 相同 */
  height?: number
}

/**
 * 与 `renderModelImage` 同一套选项（不含 `views`）。差别：缩略图默认机位是 `angled`（3/4 斜视角），
 * 而不是 `front`——正对镜头的规则形体会退化成一块平面，看不出是 3D。需要正面时显式传 `presetView: 'front'`。
 */
export type ThumbnailRenderOptions = Omit<RenderModelImageOptions, 'views'>

export interface ThumbnailRenderer {
  /**
   * 渲染一张图。并发调用按调用顺序排队，实际渲染严格串行。
   *
   * `signal` 覆盖任务的完整生命周期：排队中取消会立即拒绝（不等前面的任务），
   * 运行中取消会立即拒绝，后台的加载 / 渲染在下一个检查点终止并丢弃结果。
   * `dispose()` 同理：排队中与运行中的任务都会立即以 `ThumbnailRenderer is disposed` 拒绝。
   */
  render(options: ThumbnailRenderOptions): Promise<RenderedImage>
  /** 立即释放引擎与 WebGL 上下文，拒绝所有未完成的任务，可重复调用 */
  dispose(): void
}

const DEFAULT_IDLE_MS = 30_000
const DEFAULT_SIZE = 512

interface EngineBundle {
  engine: ViewerEngine
  host: HTMLElement
}

interface QueueItem {
  options: ThumbnailRenderOptions
  resolve: (image: RenderedImage) => void
  reject: (reason: unknown) => void
  settled: boolean
  cleanup: () => void
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function createDisposedError(): Error {
  return new Error('ThumbnailRenderer is disposed')
}

function createBundle(width: number, height: number): EngineBundle {
  const host = document.createElement('div')
  host.setAttribute('data-mivo-render', '1')
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${width}px`,
    `height:${height}px`,
    'opacity:0',
    'pointer-events:none',
    'overflow:hidden'
  ].join(';')
  document.body.appendChild(host)
  // alpha 上下文可以同时出透明底与不透明底，背景在每次出图时通过 setBackground 切换
  const engine = new ViewerEngine(host, {
    width,
    height,
    alpha: true,
    headless: true,
    clearColor: null,
    clearAlpha: 0,
    pixelRatio: 1
  })
  return { engine, host }
}

export function createThumbnailRenderer(
  rendererOptions: ThumbnailRendererOptions = {}
): ThumbnailRenderer {
  const idleMs = rendererOptions.idleMs ?? DEFAULT_IDLE_MS
  const defaultWidth = rendererOptions.width ?? DEFAULT_SIZE
  const defaultHeight = rendererOptions.height ?? defaultWidth

  let bundle: EngineBundle | null = null
  let disposed = false
  let running: QueueItem | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const queue: QueueItem[] = []

  const clearIdleTimer = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const releaseBundle = () => {
    clearIdleTimer()
    if (!bundle) return
    const current = bundle
    bundle = null
    try {
      current.engine.dispose()
    } finally {
      current.host.remove()
    }
  }

  const scheduleIdleRelease = () => {
    if (idleMs <= 0 || disposed || running || queue.length > 0) return
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (!running && queue.length === 0) releaseBundle()
    }, idleMs)
  }

  const settle = (item: QueueItem, fn: () => void) => {
    if (item.settled) return
    item.settled = true
    item.cleanup()
    fn()
  }

  /** 任务是否仍然有效：未销毁、未取消、引擎仍是启动时的那个 */
  const assertActive = (item: QueueItem, expected: EngineBundle) => {
    if (disposed || bundle !== expected) throw createDisposedError()
    if (item.settled) throw createAbortError(item.options.signal)
    item.options.signal?.throwIfAborted?.()
  }

  async function run(item: QueueItem): Promise<RenderedImage> {
    const options = item.options
    const format: ImageFormat = options.format ?? 'png'
    const width = options.width ?? defaultWidth
    const height = options.height ?? (options.width ? options.width : defaultHeight)

    const file = await resolveModelInput(options.model, {
      fileName: options.fileName,
      signal: options.signal
    })
    if (disposed) throw createDisposedError()
    if (item.settled) throw createAbortError(options.signal)
    options.signal?.throwIfAborted?.()

    clearIdleTimer()
    if (!bundle) bundle = createBundle(width, height)
    const current = bundle
    const { engine, host } = current

    host.style.width = `${width}px`
    host.style.height = `${height}px`
    engine.setRenderSize(width, height)

    try {
      await engine.loadFromFile(file)
      // dispose 会让引擎作废在途的加载并丢弃迟到的结果，这里确保不会继续使用已销毁的引擎
      assertActive(item, current)

      if (options.background !== undefined) {
        engine.setBackground(options.background)
      }
      if (options.panorama) {
        await engine.setPanorama(options.panorama, { hideGrid: !options.showGrid })
        assertActive(item, current)
      }
      applyEngineOptions(engine, options, format)

      const image = await renderOne(
        engine,
        options,
        file,
        options.presetView ?? 'angled',
        width,
        height,
        format
      )
      assertActive(item, current)
      return image
    } finally {
      // 只复位仍然有效的引擎；被销毁 / 替换的引擎已经释放，不能再碰。
      // 引擎 loadFromFile 会提前把 state.projectionMode 改回 perspective，但相机并不切回，
      // 所以必须在 state 仍为 orthographic 时主动复位，否则下一张图会沿用正交相机。
      if (!disposed && bundle === current) {
        try {
          engine.toggleProjectionMode('perspective')
          engine.clearPanorama()
          engine.setBackground(options.background ?? defaultBackground(format))
        } catch {
          // 复位失败说明引擎状态不可信，丢弃它，下次出图重建
          releaseBundle()
        }
      }
    }
  }

  const pump = () => {
    if (running || disposed) return
    const item = queue.shift()
    if (!item) {
      scheduleIdleRelease()
      return
    }
    running = item
    run(item).then(
      (image) => settle(item, () => item.resolve(image)),
      (error) => settle(item, () => item.reject(error))
    ).finally(() => {
      running = null
      pump()
    })
  }

  return {
    render(options) {
      if (disposed) return Promise.reject(createDisposedError())
      try {
        assertValidPadding(options.padding)
      } catch (error) {
        return Promise.reject(error)
      }
      const signal = options.signal
      if (signal?.aborted) return Promise.reject(createAbortError(signal))

      return new Promise<RenderedImage>((resolve, reject) => {
        const item: QueueItem = {
          options,
          resolve,
          reject,
          settled: false,
          cleanup: () => signal?.removeEventListener('abort', onAbort)
        }
        // 取消立即生效：排队中的任务直接移出队列，运行中的任务立即拒绝调用方，
        // 后台工作在下一个检查点终止（assertActive 会看到 item.settled）
        function onAbort() {
          const index = queue.indexOf(item)
          if (index >= 0) queue.splice(index, 1)
          settle(item, () => reject(createAbortError(signal)))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        queue.push(item)
        clearIdleTimer()
        pump()
      })
    },
    dispose() {
      if (!disposed) {
        disposed = true
        const error = createDisposedError()
        const pendingItems = [...queue, ...(running ? [running] : [])]
        queue.length = 0
        for (const item of pendingItems) settle(item, () => item.reject(error))
      }
      releaseBundle()
    }
  }
}
