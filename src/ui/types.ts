import type {
  PresetView,
  ProjectionMode,
  TextureMode,
  ViewerState,
  PanoramaSource
} from '../core'
import type { Locale } from './i18n'

export type ModelSource = File | Blob | string

export interface LoadModelOptions {
  /**
   * Source file name **with extension** (e.g. `"chair.obj"`, `"pack.zip"`).
   * Required when the source is a Blob or a URL without an extension,
   * unless MIME / magic bytes can identify the format.
   * The SDK does **not** default to `.glb`.
   */
  fileName?: string
}

export interface ModelViewerUIOptions {
  /** Left model-info panel @default true */
  infoPanel?: boolean
  /** Right display + lighting panel @default true */
  settingsPanel?: boolean
  /** Bottom toolbar @default true */
  toolbar?: boolean
  /** Import / replace control @default true */
  import?: boolean
  /** Export source-file control @default true */
  export?: boolean
  /** Screenshot control @default true */
  screenshot?: boolean
  /** Texture-mode switch group @default true */
  textureModes?: boolean
  /** 「场景背景」全景图导入控件 @default true */
  panorama?: boolean
  /** Built-in toast notifications @default true */
  toasts?: boolean
  /** Empty-state hint over canvas @default true */
  emptyHint?: boolean
  /** Loading overlay @default true */
  loadingOverlay?: boolean
}

export interface ModelViewerTheme {
  /** Accent: active states, slider fill, hover outlines. Any CSS colour, `var(...)` included @default #745ef5 */
  primary?: string
  /** Foreground. Muted text, hover and divider tints are derived from it @default #ffffff */
  text?: string
  /** Side-panel surface @default rgba(18,18,18,0.92) */
  panelBg?: string
  /** Surface of the toolbar group and the small action buttons @default rgba(26,26,26,1) */
  controlBg?: string
  /** Side-panel outline @default rgba(255,255,255,0.08) */
  border?: string
  /** Viewport background (any CSS `background` value, e.g. `transparent`) @default linear-gradient(...) */
  background?: string
  /**
   * Draw the active / hovered view and projection icons in the same plain white as the inactive ones.
   * The icons are two-tone images with a built-in purple detail that CSS variables cannot recolour;
   * turn this on when the theme's `primary` is not purple @default false
   */
  monochromeIcons?: boolean
}

export interface ModelViewerOptions {
  /** Optional model to load on mount (File | Blob | URL) */
  src?: ModelSource
  /** File name for `src` when it is a Blob / URL without extension */
  srcFileName?: string
  /**
   * Default UI configuration.
   * - `true` / omitted: show full default chrome
   * - object: start from defaults, toggle individual panels
   * - `false`: headless canvas only — drive via `instance.engine`
   */
  ui?: boolean | ModelViewerUIOptions
  theme?: ModelViewerTheme
  /**
   * 等距圆柱（2:1）全景图作为 3D 场景背景：URL / Blob / Texture。
   * 默认同时用作环境光，模型更容易融进场景。
   */
  panorama?: PanoramaSource
  locale?: Locale
  defaults?: {
    lightIntensity?: number
    ambientIntensity?: number
  }
  onStateChange?: (state: ViewerState) => void
  onReady?: (state: ViewerState) => void
  onLoadError?: (error: Error) => void
  onFileRejected?: (file: File) => void
}

export interface ModelViewerInstance {
  /** Escape hatch: underlying Three.js engine */
  readonly engine: import('../core').ViewerEngine
  /** Root DOM node created by the component */
  readonly root: HTMLElement
  readonly state: ViewerState
  load(source: ModelSource, options?: LoadModelOptions): Promise<void>
  subscribe(listener: (state: ViewerState) => void): () => void
  setProjection(mode: ProjectionMode): void
  setPresetView(view: PresetView): void
  setTextureMode(mode: TextureMode): void
  setLightIntensity(value: number): void
  setAmbientIntensity(value: number): void
  setLightAngle(angle: number): void
  /** 切换 / 关闭（传 null）全景图场景背景 */
  setPanorama(source: PanoramaSource | null): Promise<void>
  captureScreenshot(): Promise<Blob>
  exportModel(): Blob | null
  dispose(): void
}
