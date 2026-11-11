import { VIEW_DIRECTIONS, DEFAULT_RENDER_PADDING, type PresetView } from './views.ts'

/**
 * Canonical offscreen-render framing (Node semantics are authoritative).
 * Pure math: no Three.js / DOM / GPU, so the browser and Node build identical cameras.
 */

export type Projection = 'perspective' | 'orthographic'

export interface FramingBounds {
  radius: number
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

export interface FramingOptions {
  aspect: number
  padding?: number
  projection?: Projection
  views: readonly PresetView[]
}

export interface OrthoFrustum {
  left: number
  right: number
  top: number
  bottom: number
}

export interface CameraPose {
  view: PresetView
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  near: number
  far: number
  distance: number
  projection: Projection
  fov: number
  ortho: OrthoFrustum | null
}

export const RENDER_FOV = 45

function normalize(vec: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(vec[0], vec[1], vec[2]) || 1
  return [vec[0] / length, vec[1] / length, vec[2] / length]
}

/** Compute one camera pose per requested view, matching the Node renderer exactly. */
export function computeCameraPoses(bounds: FramingBounds, options: FramingOptions): CameraPose[] {
  const padding = options.padding ?? DEFAULT_RENDER_PADDING
  const projection = options.projection ?? 'perspective'
  const aspect = options.aspect
  const radius = Math.max(bounds.radius, 0.0001)
  const [cx, cy, cz] = bounds.center
  const axisExtent = Math.max(bounds.size[0], bounds.size[1], bounds.size[2], 0.0001) / 2
  // Oblique (`none`) views need the bounding sphere to avoid clipping rotated corners.
  const halfExtent = (options.views.includes('none') ? radius : axisExtent) * (1 + padding)
  const near = Math.max(radius / 10000, 0.000001)
  const baseFar = radius * 100 + near

  const poses: CameraPose[] = []
  for (const view of options.views) {
    let distance: number
    let ortho: OrthoFrustum | null = null
    if (projection === 'orthographic') {
      const horizontal = halfExtent * Math.max(aspect, 1)
      const vertical = halfExtent / Math.min(aspect, 1)
      ortho = { left: -horizontal, right: horizontal, top: vertical, bottom: -vertical }
      distance = radius * 4
    } else {
      const verticalDistance = radius / Math.sin(Math.PI / 8)
      const horizontalDistance = radius / Math.sin(Math.atan(Math.tan(Math.PI / 8) * aspect))
      distance = Math.max(verticalDistance, horizontalDistance) * (1 + padding)
    }
    const far = Math.max(baseFar, distance + radius * 2)
    const direction = normalize(VIEW_DIRECTIONS[view])
    const position: [number, number, number] = [
      cx + direction[0] * distance,
      cy + direction[1] * distance,
      cz + direction[2] * distance,
    ]
    const up: [number, number, number] =
      view === 'top' ? [0, 0, -1] : view === 'bottom' ? [0, 0, 1] : [0, 1, 0]
    poses.push({
      view, position, target: [cx, cy, cz], up, near, far, distance,
      projection, fov: RENDER_FOV, ortho,
    })
  }
  return poses
}
