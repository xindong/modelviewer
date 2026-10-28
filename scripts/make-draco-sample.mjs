// Writes public/box-draco.glb: a Draco-compressed copy of public/BoxAnimated.glb, used by
// draco-files-check.html (public/*.glb is git-ignored). Usage: node scripts/make-draco-sample.mjs
import { writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const document = await io.read('public/BoxAnimated.glb');
await document.transform(draco());
const bytes = await io.writeBinary(document);
await writeFile('public/box-draco.glb', bytes);
console.log(`public/box-draco.glb: ${bytes.byteLength} bytes`);
