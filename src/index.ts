/**
 * mivo-model-viewer
 *
 * Default-UI model viewer + headless engine escape hatch.
 */

// Component API
export { createModelViewer, ModelViewer } from './ui/ModelViewer'
export type {
  ModelViewerOptions,
  ModelViewerUIOptions,
  ModelViewerTheme,
  ModelViewerInstance,
  ModelSource,
  LoadModelOptions
} from './ui/types'
export { locales, resolveCopy } from './ui/i18n'
export type { Locale, ViewerCopy } from './ui/i18n'

// Core / headless
export {
  ViewerEngine,
  ModelLoader,
  isSupportedModelFile,
  isExperimentalModelFile,
  SUPPORTED_ACCEPT,
  getSupportedAccept,
  setEnabledFormats,
  getEnabledFormats,
  setDracoDecoderPath,
  getDracoDecoderPath,
  CAMERA_CONFIG,
  countTriangles,
  disposeObject3D,
  getModelDiagonal,
  hasValidModelDimensions,
  calculateOrthographicViewSize,
  sphericalToCartesian,
  extractAlbedoFromMaterial,
  loadVrmlFromBuffer,
  loadStepFromBuffer,
  setStepWasmUrl,
  getStepWasmUrl,
  loadPanoramaTexture,
  applyPanorama,
  captureView,
  captureFormatMime,
  computeFocusPose,
  focusCameraOn,
  loadModelObject,
  createThumbnailRenderer,
  renderModelImage,
  renderModelImageDetailed,
  renderModelImages,
  renderModelImageObjectURL,
  renderModelImageDataUrl,
  resolveModelInput,
  resolveModelFileName,
  sniffBlobExtension
} from './core'
export type {
  ViewerState,
  ViewerEngineOptions,
  LoadResult,
  ProgressCallback,
  AssetPack,
  VirtualFile,
  MaterialReport,
  ProjectionMode,
  PresetView,
  TextureMode,
  PanoramaSource,
  PanoramaApplyOptions,
  AppliedPanorama,
  CaptureViewOptions,
  CaptureFormat,
  FocusPose,
  FocusPoseOptions,
  FocusableControls,
  LoadModelObjectOptions,
  ModelLoadOptions,
  ViewerFrameInfo,
  ViewerFrameCallback,
  ViewerRenderCallback,
  ViewerCameraOptions,
  ViewerCaptureFrameOptions,
  ViewerFocusOptions,
  ModelInput,
  ImageFormat,
  RenderModelImageOptions,
  ThumbnailRenderer,
  ThumbnailRendererOptions,
  ThumbnailRenderOptions,
  RenderedImage
} from './core'
