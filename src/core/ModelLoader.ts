import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { createAssetPackFromZip, type AssetPack } from './AssetPack'
import {
  applyMaterialFallback,
  tryLoadMtlFromPack,
  type MaterialReport
} from './MaterialResolver'
import {
  loadVrmlFromBuffer,
  loadStepFromBuffer,
  VRML_EXTENSIONS,
  VRML_ACCEPT,
  STEP_EXTENSIONS,
  STEP_ACCEPT
} from './experimental'

export type ProgressCallback = (percent: number) => void

export interface LoadResult {
  object: THREE.Group
  animations: THREE.AnimationClip[]
  fileName: string
  fileBlob: Blob | null
  materialReport: MaterialReport
  /** 实际加载的入口（ZIP 时为包内文件） */
  entryName: string
  /** true = experimental format (VRML / STEP), simple preview only */
  experimental?: boolean
}

const MODEL_EXTENSIONS: readonly string[] = [
  'glb',
  'gltf',
  'obj',
  'fbx',
  'stl',
  'ply',
  'dae',
  '3mf',
  '3ds',
  'zip',
  ...VRML_EXTENSIONS,
  ...STEP_EXTENSIONS
]

/** 当前启用的扩展名（小写、无点）。null = 全部启用（默认，向后兼容）。 */
let enabledExtensions: ReadonlySet<string> | null = null

/**
 * 限定本进程内可加载的格式。传扩展名数组（如 `['glb','gltf','fbx']`，大小写、
 * 前导点均可），不在列表内的格式会被 `isSupportedModelFile` 判为不支持，
 * `ModelLoader.loadFromFile` 也会拒绝加载；传 `null` 恢复全部格式。
 *
 * 全局生效，请在创建查看器 / 渲染器之前调用。未识别的扩展名会被忽略。
 */
export function setEnabledFormats(exts: readonly string[] | null): void {
  if (exts === null) {
    enabledExtensions = null
    return
  }
  const known = new Set(MODEL_EXTENSIONS)
  const next = new Set<string>()
  for (const raw of exts) {
    const ext = raw.trim().replace(/^\./, '').toLowerCase()
    if (known.has(ext)) next.add(ext)
  }
  enabledExtensions = next
}

/** 当前启用的扩展名列表（无点、小写）。 */
export function getEnabledFormats(): string[] {
  return MODEL_EXTENSIONS.filter((ext) => isExtensionEnabled(ext))
}

function isExtensionEnabled(ext: string): boolean {
  if (!MODEL_EXTENSIONS.includes(ext)) return false
  return enabledExtensions === null || enabledExtensions.has(ext)
}

const BASE_ACCEPT_EXTENSIONS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae', '3mf', '3ds', 'zip']

/** 默认（全部格式）的 `<input accept>`；受 `setEnabledFormats` 影响请用 {@link getSupportedAccept}。 */
export const SUPPORTED_ACCEPT = [
  BASE_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(','),
  VRML_ACCEPT,
  STEP_ACCEPT
].join(',')

/** 按当前启用格式生成 `<input accept>`。 */
export function getSupportedAccept(): string {
  if (enabledExtensions === null) return SUPPORTED_ACCEPT
  return getEnabledFormats().map((e) => `.${e}`).join(',')
}

export function isSupportedModelFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return isExtensionEnabled(ext)
}

export function isExperimentalModelFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return (
    (VRML_EXTENSIONS as readonly string[]).includes(ext) ||
    (STEP_EXTENSIONS as readonly string[]).includes(ext)
  )
}

function ensureGroup(object: THREE.Object3D): THREE.Group {
  if (object instanceof THREE.Group) return object
  const group = new THREE.Group()
  group.add(object)
  return group
}

function normalizeObject(root: THREE.Object3D, options: ModelLoadOptions = {}) {
  const shouldCenter = options.center ?? true
  const shouldShadow = options.shadows ?? true

  if (shouldCenter) {
    const box = new THREE.Box3().setFromObject(root)
    if (!box.isEmpty()) {
      const center = new THREE.Vector3()
      box.getCenter(center)
      root.position.sub(center)
    }
  }

  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = shouldShadow
      mesh.receiveShadow = shouldShadow
      if (!mesh.geometry.attributes.normal) {
        mesh.geometry.computeVertexNormals()
      }
    }
  })
}

function emptyReport(note = ''): MaterialReport {
  return {
    texturesFound: 0,
    texturesMissing: 0,
    missingSlots: [],
    notes: note ? [note] : []
  }
}

function defaultPbrMaterial(color = 0xb0b0b0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide
  })
}

export interface ModelLoadOptions {
  /** 是否把模型包围盒中心移到原点 @default true；多模型编排建议 false，保留原始坐标 */
  center?: boolean
  /** 是否自动设置 castShadow / receiveShadow @default true */
  shadows?: boolean
}

const DEFAULT_DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
let dracoDecoderPath = DEFAULT_DRACO_DECODER_PATH

/**
 * 自托管 Draco 解码器目录（需包含 draco_decoder.js / draco_decoder.wasm /
 * draco_wasm_wrapper.js，可从 `three/examples/jsm/libs/draco/gltf/` 拷贝）。
 * 默认走 gstatic CDN；严格 CSP / 离线环境请在加载模型前设置。
 * 路径末尾的 `/` 会自动补齐；传空串恢复默认值。
 */
export function setDracoDecoderPath(url: string): void {
  const trimmed = url.trim()
  if (!trimmed) {
    dracoDecoderPath = DEFAULT_DRACO_DECODER_PATH
    return
  }
  dracoDecoderPath = trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export function getDracoDecoderPath(): string {
  return dracoDecoderPath
}

export class ModelLoader {
  private draco: DRACOLoader | null = null
  private manager = new THREE.LoadingManager()
  private activePack: AssetPack | null = null
  /** 本次加载的选项（ModelLoader 一次只加载一个模型，与 activePack 的生命周期一致） */
  private loadOptions: ModelLoadOptions = {}

  constructor() {
    this.draco = new DRACOLoader()
    this.draco.setDecoderPath(dracoDecoderPath)
  }

  private releasePack() {
    if (this.activePack) {
      this.activePack.dispose()
      this.activePack = null
    }
  }

  async loadFromFile(
    file: File,
    onProgress?: ProgressCallback,
    options: ModelLoadOptions = {}
  ): Promise<LoadResult> {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!isExtensionEnabled(ext)) {
      throw new Error(`Unsupported model format: ${file.name}`)
    }
    this.loadOptions = options
    this.releasePack()
    this.draco?.setDecoderPath(dracoDecoderPath)

    if (ext === 'zip') {
      return this.loadFromZip(file, onProgress)
    }

    if ((VRML_EXTENSIONS as readonly string[]).includes(ext)) {
      return this.loadExperimentalFile(file, ext, onProgress)
    }

    if ((STEP_EXTENSIONS as readonly string[]).includes(ext)) {
      return this.loadExperimentalFile(file, ext, onProgress)
    }

    const url = URL.createObjectURL(file)
    try {
      const result = await this.loadFromUrl(url, ext, onProgress, file.name)
      result.fileBlob = file
      result.fileName = file.name
      return result
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  /** Experimental VRML / STEP — simple mesh preview, not production CAD fidelity */
  private async loadExperimentalFile(
    file: File,
    ext: string,
    onProgress?: ProgressCallback
  ): Promise<LoadResult> {
    onProgress?.(5)
    const buffer = await file.arrayBuffer()
    onProgress?.(30)

    let object: THREE.Group
    let materialReport: MaterialReport

    if ((VRML_EXTENSIONS as readonly string[]).includes(ext)) {
      const loaded = await loadVrmlFromBuffer(buffer, file.name)
      object = loaded.object
      materialReport = loaded.materialReport
    } else if ((STEP_EXTENSIONS as readonly string[]).includes(ext)) {
      const loaded = await loadStepFromBuffer(buffer, file.name)
      object = loaded.object
      materialReport = loaded.materialReport
    } else {
      throw new Error(`不支持的实验性格式: .${ext}`)
    }

    onProgress?.(80)
    normalizeObject(object, this.loadOptions)
    onProgress?.(100)

    return {
      object,
      animations: [],
      fileName: file.name,
      fileBlob: file,
      materialReport,
      entryName: file.name,
      experimental: true
    }
  }

  private async loadFromZip(file: File, onProgress?: ProgressCallback): Promise<LoadResult> {
    onProgress?.(5)
    const pack = await createAssetPackFromZip(file)
    this.activePack = pack

    const entry = pack.files.get(pack.entryPath)
    if (!entry) {
      pack.dispose()
      throw new Error('ZIP 入口模型读取失败')
    }
    if (!entry.blobUrl) {
      entry.blobUrl = URL.createObjectURL(
        new Blob([entry.data as unknown as BlobPart], { type: entry.mimeType })
      )
      // AssetPack.dispose() owns all generated blob URLs, including the entry model.
      pack.blobUrls.push(entry.blobUrl)
    }

    onProgress?.(15)
    const manager = pack.manager
    manager.onProgress = (_url, loaded, total) => {
      if (total > 0) onProgress?.(20 + (loaded / total) * 70)
    }

    try {
      const object = await this.loadSceneFromUrl(
        entry.blobUrl,
        pack.entryExt,
        manager,
        pack.entryPath
      )

      // OBJ：尝试包内 MTL
      if (pack.entryExt === 'obj') {
        tryLoadMtlFromPack(pack, object)
      }

      // FBX/OBJ/3DS/DAE：材质启发式补全
      let materialReport = emptyReport('独立文件，无外挂资源包')
      if (['fbx', 'obj', '3ds', 'dae'].includes(pack.entryExt)) {
        materialReport = applyMaterialFallback(object, pack)
      } else if (pack.entryExt === 'gltf' || pack.entryExt === 'glb') {
        materialReport = emptyReport('GLTF/GLB 自带材质')
      }

      normalizeObject(object, this.loadOptions)
      onProgress?.(100)
      return {
        object,
        animations: (object.animations as THREE.AnimationClip[]) || [],
        fileName: file.name,
        fileBlob: file,
        materialReport,
        entryName: pack.entryPath
      }
    } catch (error) {
      pack.dispose()
      this.activePack = null
      throw error
    }
  }

  private async loadSceneFromUrl(
    url: string,
    ext: string,
    manager: THREE.LoadingManager,
    name: string
  ): Promise<THREE.Group> {
    switch (ext) {
      case 'glb':
      case 'gltf': {
        const loader = new GLTFLoader(manager)
        if (this.draco) loader.setDRACOLoader(this.draco)
        loader.setMeshoptDecoder(MeshoptDecoder)
        const gltf = await loader.loadAsync(url)
        const group = ensureGroup(gltf.scene)
        // GLTFLoader 把动画挂在 gltf.animations 上（不在 scene 上），这里补挂到 Object3D，
        // 上层才拿得到（ViewerEngine.getAnimations / 导演台时间轴）
        group.animations = gltf.animations || []
        return group
      }
      case 'obj': {
        const loader = new OBJLoader(manager)
        return ensureGroup(await loader.loadAsync(url))
      }
      case 'fbx': {
        const loader = new FBXLoader(manager)
        return ensureGroup(await loader.loadAsync(url))
      }
      case '3ds': {
        const loader = new TDSLoader(manager)
        const group = await loader.loadAsync(url)
        return ensureGroup(group)
      }
      case 'dae': {
        const loader = new ColladaLoader(manager)
        const collada = await loader.loadAsync(url)
        // ColladaLoader 已经把动画挂在 scene.animations 上，ensureGroup 后即可被上层读到
        return ensureGroup(collada.scene)
      }
      case '3mf': {
        const loader = new ThreeMFLoader(manager)
        return ensureGroup(await loader.loadAsync(url))
      }
      case 'ply': {
        const loader = new PLYLoader(manager)
        const geometry = await loader.loadAsync(url)
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(geometry, defaultPbrMaterial())
        return ensureGroup(mesh)
      }
      case 'stl': {
        const loader = new STLLoader(manager)
        const geometry = await loader.loadAsync(url)
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(geometry, defaultPbrMaterial())
        return ensureGroup(mesh)
      }
      case 'wrl':
      case 'vrml':
      case 'step':
      case 'stp':
        throw new Error(
          `实验性格式 .${ext} 请通过 loadFromFile / createModelViewer 的 File 入口加载（当前 URL 管线未接）`
        )
      default:
        throw new Error(`不支持的模型格式: .${ext} (${name})`)
    }
  }

  async loadFromUrl(
    url: string,
    ext: string,
    onProgress?: ProgressCallback,
    displayName?: string
  ): Promise<LoadResult> {
    const manager = this.manager
    manager.onProgress = (_url, loaded, total) => {
      if (total > 0) onProgress?.((loaded / total) * 100)
    }

    const object = await this.loadSceneFromUrl(
      url,
      ext,
      manager,
      displayName || url
    )

    let materialReport = emptyReport()
    if (ext === 'obj') {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh && !mesh.material) {
          mesh.material = defaultPbrMaterial(0xcccccc)
        } else if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m) => {
            const anyM = m as unknown as Record<string, unknown>
            if (m && !anyM.map) {
              anyM.roughness = 0.7
              anyM.metalness = 0.05
              m.needsUpdate = true
            }
          })
        }
      })
      materialReport = emptyReport('OBJ 未提供外挂 MTL/贴图时使用默认材质')
    }

    normalizeObject(object, this.loadOptions)
    return {
      object,
      animations: (object.animations as THREE.AnimationClip[]) || [],
      fileName: displayName || url.split('/').pop() || `model.${ext}`,
      fileBlob: null,
      materialReport,
      entryName: displayName || url
    }
  }

  dispose() {
    this.releasePack()
    this.draco?.dispose()
  }
}
