import * as THREE from 'three'

/**
 * Shared STEP tessellation meshing (occt-import-js result -> Three.js meshes).
 * Experimental: triangle meshes only, not full CAD B-Rep / PMI fidelity.
 */

export interface OcctMeshData {
  name?: string
  color?: number[] | null
  attributes: {
    position: { array: number[] | Float32Array }
    normal?: { array: number[] | Float32Array }
  }
  index: { array: number[] | Uint32Array }
}

/** Canonical STEP preview material (deliberate browser values, shared with Node). */
export const STEP_MATERIAL = {
  roughness: 0.65,
  metalness: 0.15,
  defaultColor: 0xb8b8b8,
}

function toFloatArray(input: number[] | Float32Array): Float32Array {
  return input instanceof Float32Array ? input : new Float32Array(input)
}

function toIndexArray(input: number[] | Uint32Array): Uint32Array {
  return input instanceof Uint32Array ? input : new Uint32Array(input)
}

export function buildStepMesh(data: OcctMeshData): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(toFloatArray(data.attributes.position.array), 3))
  if (data.attributes.normal) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(toFloatArray(data.attributes.normal.array), 3))
  } else {
    geometry.computeVertexNormals()
  }
  geometry.setIndex(new THREE.BufferAttribute(toIndexArray(data.index.array), 1))
  const color = data.color
    ? new THREE.Color(data.color[0], data.color[1], data.color[2])
    : new THREE.Color(STEP_MATERIAL.defaultColor)
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: STEP_MATERIAL.roughness,
    metalness: STEP_MATERIAL.metalness,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = data.name || ''
  return mesh
}

export function buildStepGroup(meshes: OcctMeshData[]): THREE.Group {
  const group = new THREE.Group()
  for (const data of meshes) group.add(buildStepMesh(data))
  return group
}
