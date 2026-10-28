import { ViewerEngine } from './ViewerEngine'
import {
  applyEngineOptions,
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

export type ThumbnailRenderOptions = Omit<RenderModelImageOptions, 'views'>

export interface ThumbnailRenderer {
  /**
   * 渲染一张图。调用方并发调用时按调用顺序排队串行执行；
   * 排队中的任务可通过 `signal` 取消，运行中的任务在下一个检查点取消。
   */
  render(options: ThumbnailRenderOptions): Promise<RenderedImage>
  /** 立即释放引擎与 WebGL 上下文（等待中的任务会被拒绝），可重复调用 */
  dispose(): void
}

const DEFAULT_IDLE_MS = 30_000
const DEFAULT_SIZE = 512

interface EngineBundle {
  engine: ViewerEngine
  host: HTMLElement
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
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let pending = 0
  let tail: Promise<unknown> = Promise.resolve()

  const clearIdleTimer = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const releaseBundle = () => {
    clearIdleTimer()
    if (!bundle) return
    try {
      bundle.engine.dispose()
    } finally {
      bundle.host.remove()
      bundle = null
    }
  }

  const scheduleIdleRelease = () => {
    if (idleMs <= 0 || disposed || pending > 0) return
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (pending === 0) releaseBundle()
    }, idleMs)
  }

  async function run(options: ThumbnailRenderOptions): Promise<RenderedImage> {
    if (disposed) throw new Error('ThumbnailRenderer is disposed')
    options.signal?.throwIfAborted?.()

    const format: ImageFormat = options.format ?? 'png'
    const width = options.width ?? defaultWidth
    const height = options.height ?? (options.width ? options.width : defaultHeight)

    const file = await resolveModelInput(options.model, {
      fileName: options.fileName,
      signal: options.signal
    })
    options.signal?.throwIfAborted?.()
    if (disposed) throw new Error('ThumbnailRenderer is disposed')

    clearIdleTimer()
    if (!bundle) bundle = createBundle(width, height)
    const { engine, host } = bundle

    host.style.width = `${width}px`
    host.style.height = `${height}px`
    engine.setRenderSize(width, height)

    try {
      await engine.loadFromFile(file)
      options.signal?.throwIfAborted?.()

      if (options.background !== undefined) {
        engine.setBackground(options.background)
      }
      if (options.panorama) {
        await engine.setPanorama(options.panorama, { hideGrid: !options.showGrid })
      }
      applyEngineOptions(engine, options, format)

      return await renderOne(
        engine,
        options,
        file,
        options.presetView ?? 'front',
        width,
        height,
        format
      )
    } finally {
      // 复用引擎的清理：引擎 loadFromFile 会提前把 state.projectionMode 改回
      // perspective，但相机并不切回，所以这里必须在 state 仍为 orthographic
      // 时主动复位，否则下一张图会沿用正交相机。
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

  return {
    render(options) {
      if (disposed) return Promise.reject(new Error('ThumbnailRenderer is disposed'))
      pending += 1
      const task = tail.then(
        () => run(options),
        () => run(options)
      )
      const settled = task.then(
        () => undefined,
        () => undefined
      )
      tail = settled
      void settled.then(() => {
        pending -= 1
        scheduleIdleRelease()
      })
      return task
    },
    dispose() {
      disposed = true
      releaseBundle()
    }
  }
}
