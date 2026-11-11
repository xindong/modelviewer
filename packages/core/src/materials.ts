/**
 * Canonical texture-slot matching rules shared by the browser viewer and Node tooling.
 * Pure heuristics over abstract file candidates; platform IO stays in each consumer.
 */

export const SLOT_KEYWORDS: Record<string, string[]> = {
  map: ['diffuse', 'albedo', 'basecolor', 'base_color', 'base-color', 'color', 'col', 'diff', '_d', 'albedo'],
  normalMap: ['normal', 'nrm', '_n', 'norm', 'bump'],
  roughnessMap: ['rough', 'roughness', '_r'],
  metalnessMap: ['metal', 'metallic', 'metalness', '_m'],
  aoMap: ['ao', 'occlusion', 'ambientocclusion', 'ambient_occlusion'],
  emissiveMap: ['emissive', 'emit', '_e'],
}

export type TextureSlot = keyof typeof SLOT_KEYWORDS

export interface TextureCandidate {
  path: string
  lowerBase: string
  ext: string
}

export function textureBasename(path: string): string {
  return (path.split('/').pop() || path).toLowerCase()
}

export function stripTextureExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/** Match one texture per slot by keyword, without reusing a file across slots. */
export function matchTextureByKeywords<T extends TextureCandidate>(
  files: T[],
  slots: TextureSlot[]
): Partial<Record<TextureSlot, T>> {
  const result: Partial<Record<TextureSlot, T>> = {}
  const used = new Set<string>()
  for (const slot of slots) {
    const keys = SLOT_KEYWORDS[slot]
    const hit = files.find((file) => {
      if (used.has(file.path)) return false
      return keys.some((keyword) => file.lowerBase.includes(keyword.toLowerCase()))
    })
    if (hit) {
      result[slot] = hit
      used.add(hit.path)
    }
  }
  return result
}

/** Resolve a texture reference by basename, then model directory, then preferred texture dirs. */
export function findTextureByReference<T extends TextureCandidate>(
  files: T[],
  reference: string,
  modelDir?: string
): T | null {
  if (!reference) return null
  const cleaned = decodeURIComponent(reference)
    .replace(/\\/g, '/')
    .replace(/^file:[^/]*/i, '')
    .replace(/^\/+/, '')
  const filePart = textureBasename(cleaned)
  const noExt = stripTextureExt(filePart)
  const entries = files.filter(
    (file) => file.ext && (file.lowerBase === filePart || stripTextureExt(file.lowerBase) === noExt)
  )
  if (entries.length === 0) return null
  if (modelDir) {
    const sameDir = entries.find(
      (file) => file.path.startsWith(`${modelDir}/`) || !file.path.includes('/')
    )
    if (sameDir) return sameDir
  }
  const preferredDir = entries.find((file) => /textures?|maps?|fbm|materials?/i.test(file.path))
  return preferredDir || entries[0]
}
