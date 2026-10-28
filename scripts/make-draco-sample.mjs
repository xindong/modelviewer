// Writes public/draco-sample.glb: a small Draco-compressed UV sphere generated here, so a
// clean checkout can reproduce it. Used by draco-files-check.html (public/*.glb is
// git-ignored). Usage: node scripts/make-draco-sample.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const SEGMENTS = 24;
const RINGS = 16;

function sphere() {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let ring = 0; ring <= RINGS; ring++) {
    const phi = (ring / RINGS) * Math.PI;
    for (let seg = 0; seg <= SEGMENTS; seg++) {
      const theta = (seg / SEGMENTS) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  const stride = SEGMENTS + 1;
  for (let ring = 0; ring < RINGS; ring++) {
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const a = ring * stride + seg;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

const { positions, normals, indices } = sphere();
const document = new Document();
const buffer = document.createBuffer();
const primitive = document
  .createPrimitive()
  .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
  .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
  .setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
const mesh = document.createMesh('sphere').addPrimitive(primitive);
document.createScene().addChild(document.createNode('sphere').setMesh(mesh));

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
await document.transform(draco());
const bytes = await io.writeBinary(document);
await mkdir('public', { recursive: true });
await writeFile('public/draco-sample.glb', bytes);
console.log(`public/draco-sample.glb: ${bytes.byteLength} bytes, ${indices.length / 3} triangles (Draco compressed)`);
