/**
 * Canonical offscreen-render camera presets (Node semantics are authoritative).
 * glTF Y-up: side aliases left (+X); `none` is a fixed 3/4 view, not "keep current".
 */
export type PresetView =
  | 'front' | 'back' | 'left' | 'right' | 'side' | 'top' | 'bottom' | 'angled' | 'none'

export const PRESET_VIEWS: readonly PresetView[] = [
  'front', 'back', 'left', 'right', 'side', 'top', 'bottom', 'angled', 'none',
]

/** `angled` = 3/4 view, azimuth 35deg toward +X, elevation 25deg. */
const ANGLED_AZIMUTH = (35 * Math.PI) / 180
const ANGLED_ELEVATION = (25 * Math.PI) / 180
const ANGLED_DIRECTION: readonly [number, number, number] = [
  Math.cos(ANGLED_ELEVATION) * Math.sin(ANGLED_AZIMUTH),
  Math.sin(ANGLED_ELEVATION),
  Math.cos(ANGLED_ELEVATION) * Math.cos(ANGLED_AZIMUTH),
]

export const VIEW_DIRECTIONS: Record<PresetView, readonly [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  side: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  angled: ANGLED_DIRECTION,
  none: [1, 0.65, 1],
}

/** Framing margin: halfExtent = extent * (1 + padding). */
export const DEFAULT_RENDER_PADDING = 0.1
