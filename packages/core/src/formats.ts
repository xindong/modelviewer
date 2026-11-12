/**
 * Platform-agnostic model format tables and magic-byte sniffing.
 * Shared by the browser viewer and Node tooling so both identify formats identically.
 */

export const EXT_MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'model/obj',
  fbx: 'application/octet-stream',
  stl: 'model/stl',
  ply: 'application/octet-stream',
  dae: 'model/vnd.collada+xml',
  '3mf': 'model/3mf',
  '3ds': 'application/octet-stream',
  zip: 'application/zip',
  wrl: 'model/vrml',
  vrml: 'model/vrml',
  step: 'model/step',
  stp: 'model/step',
}

export const MIME_EXT: Record<string, string> = {
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'model/gltf': 'gltf',
  'model/obj': 'obj',
  'text/plain': '',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'model/stl': 'stl',
  'model/vnd.collada+xml': 'dae',
  'model/3mf': '3mf',
  'model/vrml': 'wrl',
  'x-world/x-vrml': 'wrl',
  'model/step': 'step',
  'application/step': 'step',
  'application/STEP': 'step',
}

/** Supported model entry extensions, in the default archive format order. */
export const MODEL_FORMATS: readonly string[] = Object.freeze([
  'glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae',
  '3mf', '3ds', 'wrl', 'vrml', 'step', 'stp',
])

export function extensionOf(name: string): string {
  let base = name.split(/[\\/]/).pop() || ''
  base = base.split(/[?#]/)[0] || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function hasModelExtension(name: string): boolean {
  return Boolean(extensionOf(name))
}

export function ensureModelExtension(name: string, ext: string): string {
  if (hasModelExtension(name)) return name
  return `${name}.${ext}`
}

export function extFromMime(mime: string): string | null {
  if (!mime) return null
  const key = mime.split(';')[0].trim().toLowerCase()
  const ext = MIME_EXT[key]
  return ext || null
}

function startsWithBytes(buf: Uint8Array, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false
  for (let index = 0; index < bytes.length; index++) {
    if (buf[index] !== bytes[index]) return false
  }
  return true
}

function ascii(buf: Uint8Array, start = 0, end = Math.min(buf.length, start + 64)): string {
  let text = ''
  for (let index = start; index < end && index < buf.length; index++) text += String.fromCharCode(buf[index])
  return text
}

/** Sniff format from file magic / leading text. Returns extension without dot. */
export function extFromMagic(buf: Uint8Array): string | null {
  if (buf.length < 4) return null

  if (startsWithBytes(buf, [0x67, 0x6c, 0x54, 0x46])) return 'glb'
  if (startsWithBytes(buf, [0x50, 0x4b])) return 'zip'
  if (ascii(buf, 0, 20).startsWith('Kaydara FBX Binary')) return 'fbx'
  if (buf[0] === 0x4d && buf[1] === 0x4d) return '3ds'

  const head = ascii(buf, 0, Math.min(buf.length, 256)).replace(/^\uFEFF/, '')
  const trimmed = head.trimStart()

  if (/^#VRML/i.test(trimmed)) return 'wrl'
  if (/^ISO-10303/i.test(trimmed)) return 'step'
  if (/^solid\b/i.test(trimmed) && /\bfacet\b|\bendsolid\b/i.test(ascii(buf, 0, 1024))) {
    return 'stl'
  }
  if (/^\{/.test(trimmed) && /"asset"\s*:/.test(ascii(buf, 0, 2048))) return 'gltf'
  if (/^#?\s*(v|vn|vt|f|o|g|mtllib|usemtl)\s/m.test(ascii(buf, 0, 512))) {
    if (/^#VRML/i.test(trimmed)) return 'wrl'
    return 'obj'
  }
  if (/^ply\b/i.test(trimmed)) return 'ply'
  if (/^<?xml\b/i.test(trimmed) && /collada/i.test(ascii(buf, 0, 1024))) return 'dae'

  return null
}
