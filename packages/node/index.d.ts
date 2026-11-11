/** Pure Node entry point. No browser or GPU initialization occurs in the host process. */
export type ModelSource = string | { bytes: Uint8Array; fileName: string; resources?: Record<string, Uint8Array> };
/** Server-compatible glTF Y-up views: left is +X, right is -X; side aliases left. */
export type PresetView =
  | 'front' | 'back' | 'left' | 'right' | 'side' | 'top' | 'bottom' | 'none';
export interface Warning { code: string; message: string; affectsFidelity: boolean; resource?: string; details?: unknown }
export interface CommonOptions {
  /** Native FBX2glTF by default; three retains the legacy loader. */
  fbxBackend?: 'native' | 'three';
  /** Explicit executable path. Never searched in PATH or replaced with a fallback. */
  fbxBinary?: string;
  timeout?: number;
  resourceDirs?: string[];
  entry?: string;
  entryFormats?: string[];
  entryDepth?: number;
  strict?: boolean;
  allowNetwork?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export interface OptimizationOptions {
  simplifyRatio?: number;
  simplifyError?: number;
  simplifyLockBorder?: boolean;
  simplify?: boolean;
  instance?: boolean;
  palette?: boolean;
  flatten?: boolean;
  join?: boolean;
  weld?: boolean;
  textureSize?: number;
  textureCompress?: 'auto' | 'webp' | 'avif' | 'none' | false | 'false';
  compress?: 'meshopt' | 'draco' | 'quantize' | 'none' | false | 'false';
}
export interface ConvertOptions extends CommonOptions, OptimizationOptions {
  optimize?: boolean;
  center?: boolean;
  onlyVisible?: boolean;
  animations?: boolean;
}
export interface RenderOptions extends CommonOptions {
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  device?: 'auto' | 'software' | 'hardware';
  /** Camera framing padding; defaults to 0.1. */
  padding?: number;
  view?: PresetView;
  views?: PresetView[];
  projection?: 'perspective' | 'orthographic';
  textureMode?: 'textured' | 'white' | 'clay' | 'normal' | 'albedo';
  background?: string;
  showGrid?: boolean;
  lightIntensity?: number;
  ambientIntensity?: number;
  lightAngle?: number;
}
export interface Artifact {
  name: string;
  format: string;
  bytes: Uint8Array;
  view?: PresetView;
  width?: number;
  height?: number;
}
/** Wall-clock milliseconds. Overlapping summary metrics must not be added together. */
export interface ModelTimings {
  unit: 'ms';
  loadMs: number | null;
  exportMs: number | null;
  optimizationMs: number | null;
  simplifyMs: number | null;
  renderMs: number | null;
  /** Loading/conversion plus export/validation, excluding optimization. Not a separate benchmark. */
  conversionMs: number | null;
  nativeConversionMs?: number | null;
  convertAndOptimizeMs: number | null;
  workerMs: number | null;
  queueMs: number;
  executionMs: number;
  totalMs: number;
  outputWriteMs?: number;
  cliTotalMs?: number;
}
export interface ModelResult {
  schemaVersion: 1;
  ok: true;
  command: 'info' | 'render' | 'convert' | 'optimize';
  input: string;
  entry: string;
  outputs: Artifact[];
  data: Record<string, unknown> & { timings: ModelTimings };
  warnings: Warning[];
  error: null;
}
export interface ModelProcessor {
  inspectModel(source: ModelSource, options?: CommonOptions): Promise<ModelResult>;
  renderModelImages(source: ModelSource, options?: RenderOptions): Promise<ModelResult>;
  convertModelToGlb(source: ModelSource, options?: ConvertOptions): Promise<ModelResult>;
  optimizeModel(source: ModelSource, options?: CommonOptions & OptimizationOptions): Promise<ModelResult>;
  /** Reject queued tasks and terminate running child processes. */
  close(): Promise<void>;
}
export function createModelProcessor(options?: { concurrency?: number; maxQueue?: number }): ModelProcessor;
export function inspectModel(source: ModelSource, options?: CommonOptions): Promise<ModelResult>;
export function renderModelImages(source: ModelSource, options?: RenderOptions): Promise<ModelResult>;
export function convertModelToGlb(source: ModelSource, options?: ConvertOptions): Promise<ModelResult>;
export function optimizeModel(source: ModelSource, options?: CommonOptions & OptimizationOptions): Promise<ModelResult>;

/** Binary resolution does not import the vendor wrapper or search PATH. */
export interface FbxBinaryMetadata {
  backend: 'fbx2gltf';
  binaryPath: string;
  binarySource: 'bundled' | 'override';
  packageVersion: string | null;
  platform: string;
  arch: string;
  binaryArch: 'x64' | null;
  requiresRosetta: boolean | null;
  compatibility: 'native' | 'rosetta' | 'unknown';
}
export interface FbxProbeResult extends Partial<FbxBinaryMetadata> {
  backend: 'fbx2gltf';
  ok: boolean;
  version: string | null;
  repairHints: string[];
  error: { code: string; message: string } | null;
}
export function resolveFbxBinary(
  options?: Pick<CommonOptions, 'fbxBinary'>,
  runtime?: { platform?: string; arch?: string },
): Promise<FbxBinaryMetadata>;
export function probeFbxBinary(
  options?: Pick<CommonOptions, 'fbxBinary' | 'signal'> & { isolated?: boolean },
  runtime?: { platform?: string; arch?: string },
): Promise<FbxProbeResult>;

/** Preview-only metrics; omitted by the existing per-task processor. */
export interface ModelTimings {
  startupMs?: number | null;
  prepareMs?: number | null;
  cacheHit?: boolean;
  fastPath?: boolean;
  gpuReused?: boolean;
  gpuInitMs?: number;
  gpuResizeMs?: number;
}

/** Budgets apply independently to each preview processor's persistent worker. */
export interface PreviewProcessorOptions {
  /** Maximum waiting tasks, excluding the running task. Default 32; 0 disables queuing. */
  maxQueue?: number;
  /** Recycle after this many completed tasks. Positive integer; default 64. */
  maxTasks?: number;
  /** Recycle when RSS reaches this value after a task. Default 1 GiB; not a hard memory cap. */
  maxRssBytes?: number;
  /** Maximum prepared models in the in-memory LRU. Default 4; 0 disables caching. */
  cacheEntries?: number;
  /** Prepared GLB bytes plus warning bytes retained by the LRU. Default 64 MiB. */
  cacheBytes?: number;
  /** Maximum width × height for a retained GPU target. Default 4,194,304; 0 disables reuse. */
  gpuPixels?: number;
  /** Recycle after this many idle milliseconds. Default 60,000; 0 disables idle recycling. */
  idleMs?: number;
}

/** Render options; signal and progress callbacks remain in the parent process. */
export interface PreviewRenderOptions extends Omit<RenderOptions, 'allowNetwork'> {
  /** Positive seconds, at most 86,400; includes queueing, startup and rendering. Default 120. */
  timeout?: number;
  /** Preview workers always disable network access. */
  allowNetwork?: false;
  /** Resource limits may only be lowered from the runtime defaults. */
  limits?: { maxEntries?: number; maxEntryBytes?: number; maxTotalBytes?: number };
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

/** The preview runtime reports workerMs rather than a separate executionMs. */
export interface PreviewTimings extends Omit<ModelTimings, 'executionMs'> {
  executionMs?: number;
}
export interface PreviewResult {
  ok: true;
  outputs: Artifact[];
  warnings: Warning[];
  data: {
    timings: PreviewTimings;
    render: Record<string, unknown>;
  };
}
export interface ModelPreviewProcessor {
  renderModelImages(source: ModelSource, options?: PreviewRenderOptions): Promise<PreviewResult>;
  /** Reject queued/running tasks and await worker/process-group and temporary-file cleanup. */
  close(): Promise<void>;
}
export function createModelPreviewProcessor(options?: PreviewProcessorOptions): ModelPreviewProcessor;
