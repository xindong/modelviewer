import { DEFAULT_RENDER_PADDING } from './views.ts'
import type { Projection } from './framing.ts'

/**
 * Canonical offscreen-render parameter schema (Node semantics are authoritative).
 * Constants, defaults and pure helpers shared by the browser viewer and Node tooling.
 * Platform-specific validation error styles stay in each consumer.
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp'
export type TextureMode = 'textured' | 'clay' | 'white' | 'normal' | 'albedo'

export const IMAGE_FORMATS: readonly ImageFormat[] = ['png', 'jpeg', 'webp']
export const TEXTURE_MODES: readonly TextureMode[] = ['textured', 'clay', 'white', 'normal', 'albedo']
export const PROJECTIONS: readonly Projection[] = ['perspective', 'orthographic']

export const MAX_RENDER_DIMENSION = 8192
export const MAX_RENDER_PIXELS = 16777216
export const PADDING_MIN = 0
export const PADDING_MAX = 10

export const RENDER_DEFAULTS = {
  width: 1024,
  format: 'png' as ImageFormat,
  padding: DEFAULT_RENDER_PADDING,
  textureMode: 'textured' as TextureMode,
  projection: 'perspective' as Projection,
  lightIntensity: 2,
  ambientIntensity: 2,
  lightAngle: 0,
  quality: 0.92,
  showGrid: false,
}

/** JPEG cannot be transparent; other formats default to transparent. */
export function defaultBackground(format: ImageFormat): string {
  return format === 'jpeg' ? '#ffffff' : 'transparent'
}

/** Browser-style padding guard (RangeError). Node uses its own INVALID_ARGUMENT validator. */
export function assertValidPadding(padding: number | undefined): void {
  if (padding == null) return
  if (!Number.isFinite(padding) || padding < PADDING_MIN || padding > PADDING_MAX) {
    throw new RangeError(`padding must be a finite number in [${PADDING_MIN}, ${PADDING_MAX}], got ${padding}`)
  }
}
