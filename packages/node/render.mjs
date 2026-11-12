import { sdkImport } from './dependencies.mjs';
const { default: sharp } = await sdkImport('sharp');
import { importOptional } from './optional.mjs';
import { createRenderer } from './gpu.mjs';
import { unpremultiplySRGB } from './pixels.mjs';
import { loadThreeScene, parseGLBForRender } from './load.mjs';
import { computeCameraPoses, DEFAULT_RENDER_PADDING } from '#core';

export async function renderDocument(document, options = {}, context = {}) {
  const width = options.width ?? 1024;
  const height = options.height ?? width;
  const format = options.format ?? 'png';
  const gpu = context.acquireGPU ? await context.acquireGPU(width, height, options) : await createRenderer(width, height, options);
  const { THREE: T, renderer } = gpu;
  let loaded;
  let scene;
  const warnings = [];
  const temporaryMaterials = new Set();
  const dataTextures = new Set();
  const textureBindings = [];
  const materialBindings = new Map();
  let grid;
  try {
    loaded = document instanceof Uint8Array
      ? await parseGLBForRender(document, options, context)
      : await loadThreeScene(document, options, context);
    warnings.push(...(loaded.warnings || []));
    const root = loaded.scene;
    root.updateMatrixWorld(true);
    // Dawn cannot upload a browser image; decoded RGBA DataTextures need no DOM interop.
    const converted = new Map();
    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'specularColorMap', 'specularIntensityMap', 'anisotropyMap'];
    const pending = [];
    root.traverse(object => {
      if (!(object.isMesh || object.isPoints || object.isLine)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        for (const slot of slots) {
          const texture = material[slot];
          if (!texture || texture.isDataTexture) continue;
          textureBindings.push({ material, slot, texture });
          if (texture.isCompressedTexture) {
            warnings.push({ code: 'RENDER_TEXTURE_UNSUPPORTED', message: `Compressed texture ${texture.name || slot} cannot be decoded by the Node renderer.`, affectsFidelity: true });
            material[slot] = null;
            continue;
          }
          if (!converted.has(texture)) converted.set(texture, decodeTexture(texture, T).then(value => { dataTextures.add(value); return value; }));
          pending.push(converted.get(texture).then(value => { material[slot] = value; material.needsUpdate = true; }));
        }
      }
    });
    // Wait for every decoder before cleanup, including when one rejects.
    const decoded = await Promise.allSettled(pending);
    const failedDecode = decoded.find(result => result.status === 'rejected');
    if (failedDecode) throw failedDecode.reason;
    const mode = options.textureMode ?? 'textured';
    if (mode !== 'textured') root.traverse(object => {
      if (!object.isMesh) return;
      const replace = original => {
        let material;
        if (mode === 'normal') material = new T.MeshNormalMaterial({ side: original.side });
        else if (mode === 'albedo') material = new T.MeshBasicMaterial({ color: original.color ?? 0xffffff, map: original.map ?? null, vertexColors: original.vertexColors, side: original.side, transparent: original.transparent, opacity: original.opacity, alphaTest: original.alphaTest, alphaMap: original.alphaMap });
        else material = new T.MeshStandardMaterial({
          color: mode === 'white' ? 0xffffff : 0xc7c7c7,
          roughness: 0.8, metalness: 0, side: original.side,
        });
        temporaryMaterials.add(material);
        return material;
      };
      materialBindings.set(object, object.material);
      object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
    });
    const box = new T.Box3().setFromObject(root);
    if (box.isEmpty()) throw Object.assign(new Error('Model has no renderable geometry.'), { code: 'EMPTY_MODEL' });
    const sphere = box.getBoundingSphere(new T.Sphere());
    const radius = Math.max(sphere.radius, 0.0001);
    const center = sphere.center;
    scene = new T.Scene();
    scene.add(root);
    const angle = (options.lightAngle ?? 0) * Math.PI / 180;
    const light = new T.DirectionalLight(0xffffff, options.lightIntensity ?? 2);
    light.position.copy(center).add(new T.Vector3(Math.sin(angle) * radius * 3, radius * 3, Math.cos(angle) * radius * 3));
    light.target.position.copy(center); scene.add(light, light.target);
    scene.add(new T.AmbientLight(0xffffff, options.ambientIntensity ?? 2));
    if (options.showGrid) {
      grid = new T.GridHelper(radius * 3, 12); grid.position.set(center.x, box.min.y, center.z); scene.add(grid);
    }
    const background = options.background ?? (format === 'jpeg' ? '#ffffff' : 'transparent');
    renderer.setClearColor(background === 'transparent' ? 0 : new T.Color(background), background === 'transparent' ? 0 : 1);
    const size = box.getSize(new T.Vector3());
    const padding = options.padding ?? DEFAULT_RENDER_PADDING;
    const views = options.views ?? [options.view ?? 'front'];
    const poses = computeCameraPoses(
      { radius, center: [center.x, center.y, center.z], size: [size.x, size.y, size.z] },
      { aspect: width / height, padding, projection: options.projection, views }
    );
    const outputs = [];
    for (const pose of poses) {
      const view = pose.view;
      context.log?.(`Rendering ${view} (${width}×${height})`);
      const camera = pose.projection === 'orthographic'
        ? new T.OrthographicCamera(pose.ortho.left, pose.ortho.right, pose.ortho.top, pose.ortho.bottom, pose.near, pose.far)
        : new T.PerspectiveCamera(pose.fov, width / height, pose.near, pose.far);
      camera.up.set(...pose.up);
      camera.position.set(...pose.position);
      camera.updateProjectionMatrix();
      camera.lookAt(new T.Vector3(...pose.target));
      camera.updateMatrixWorld(true);
      const rgba = await gpu.render(scene, camera);
      if (background === 'transparent') unpremultiplySRGB(rgba);
      const image = sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } });
      // GPU blending is premultiplied in linear space; pixels have been converted
      // to straight alpha before Sharp encodes PNG/WebP.
      const bytes = await image.toFormat(format, format === 'png' ? {} : { quality: Math.max(1, Math.round((options.quality ?? 0.92) * 100)) }).toBuffer();
      outputs.push({ name: `model-${view}.${format === 'jpeg' ? 'jpg' : format}`, format, bytes, view, width, height });
    }
    return {
      outputs, warnings,
      data: {
        renderer: 'three-webgpu/dawn', backend: gpu.backend, adapter: gpu.adapter,
        device: gpu.deviceType, requestedDevice: gpu.requestedDevice,
        projection: options.projection ?? 'perspective', padding,
        width, height, views,
      },
    };
  } finally {
    try {
      // Restore the loader's ownership graph before its disposer traverses it.
      for (const [object, material] of materialBindings) object.material = material;
      for (const { material, slot, texture } of textureBindings) material[slot] = texture;
      for (const material of temporaryMaterials) material.dispose();
      for (const texture of dataTextures) texture.dispose();
      await loaded?.dispose?.();
      grid?.geometry.dispose();
      for (const material of grid ? (Array.isArray(grid.material) ? grid.material : [grid.material]) : []) material.dispose();
      scene?.clear();
      renderer.info.reset();
    } finally {
      // NodeFrame keeps the last object/material/scene strongly referenced even
      // after their GPU resources are disposed. Drop those per-task references.
      const frame = renderer._nodes?.nodeFrame;
      if (frame) frame.object = frame.material = frame.camera = frame.scene = null;
      if (context.releaseGPU) await context.releaseGPU(gpu);
      else gpu.dispose();
    }
  }
}

async function decodeTexture(texture, T) {
  const image = texture.image;
  if (!image) throw Object.assign(new Error(`Texture ${texture.name} has no decoded image.`), { code: 'TEXTURE_DECODE_FAILED' });
  let rgba, width, height;
  if (image.data && image.width && image.height) {
    ({ data: rgba, width, height } = image);
    if (rgba.length !== width * height * 4) throw new Error('Expected RGBA image.');
  } else {
    const { createCanvas } = await importOptional('@napi-rs/canvas', 'Texture decoding (render)', sdkImport);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    rgba = pixels.data; width = pixels.width; height = pixels.height;
  }
  const result = new T.DataTexture(new Uint8Array(rgba), width, height, T.RGBAFormat, T.UnsignedByteType);
  for (const key of ['name', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'flipY', 'colorSpace', 'channel', 'rotation', 'matrixAutoUpdate', 'generateMipmaps']) result[key] = texture[key];
  result.offset.copy(texture.offset); result.repeat.copy(texture.repeat); result.center.copy(texture.center); result.matrix.copy(texture.matrix);
  result.needsUpdate = true;
  return result;
}
