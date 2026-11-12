import { isSupportedModelFile } from './ModelLoader'
import {
  EXT_MIME,
  MIME_EXT,
  extensionOf,
  hasModelExtension,
  ensureModelExtension,
  extFromMime,
  extFromMagic
} from '@mivo/model-core'

export {
  EXT_MIME,
  MIME_EXT,
  extensionOf,
  hasModelExtension,
  ensureModelExtension,
  extFromMime,
  extFromMagic
}

export async function sniffBlobExtension(blob: Blob): Promise<string | null> {
  const fromMime = extFromMime(blob.type)
  if (fromMime) return fromMime
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer())
  return extFromMagic(head)
}

/**
 * Pick a loader-facing filename for File/Blob/URL inputs.
 * Never silently assumes `.glb` when format is unknown.
 */
export async function resolveModelFileName(
  source: File | Blob | string,
  hintName?: string
): Promise<string> {
  if (typeof source === 'string') {
    const fromUrl = extensionOf(source)
    if (hintName && hasModelExtension(hintName)) return hintName
    if (fromUrl) {
      const base = source.split(/[\\/]/).pop()!.split(/[?#]/)[0]
      return base || `model.${fromUrl}`
    }
    if (hintName) {
      return hintName
    }
    throw new Error(
      `无法从 URL 推断模型扩展名：${source}。请传入 fileName，例如 fileName: "model.obj"`
    )
  }

  if (source instanceof File && source.name && hasModelExtension(source.name)) {
    return source.name
  }

  if (hintName && hasModelExtension(hintName)) {
    return hintName
  }

  const sniffed = await sniffBlobExtension(source as Blob)
  if (sniffed) {
    return ensureModelExtension(hintName || 'model', sniffed)
  }

  if (hintName) {
    throw new Error(
      `无法从 Blob.type / 文件头推断格式，请为 fileName 补上扩展名，例如 "${hintName}.obj"`
    )
  }

  throw new Error(
    'Blob 未带文件名，且无法从 MIME/文件头推断格式。请传入 fileName（如 "chair.obj" / "pack.zip"）'
  )
}

export { isSupportedModelFile }
