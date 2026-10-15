import { sdkImport } from './dependencies.mjs';
import { prepareDevice, checkDevice } from '../gpu-device.mjs';

/** Dawn/WebGPU adapter. Imported only inside the isolated render task. */
export async function createRenderer(width, height, options = {}) {
  const requestedDevice = options.device ?? 'auto';
  const selection = await prepareDevice(requestedDevice);
  let binding;
  try { binding = await sdkImport('webgpu'); }
  catch (cause) { throw Object.assign(new Error('Node WebGPU is unavailable. Install optional npm dependencies for this platform.', { cause }), { code: 'RENDER_DEPENDENCY_MISSING' }); }
  Object.assign(globalThis, binding.globals);
  let gpu;
  let device;
  let renderer;
  let screenTexture;
  let target;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    // Releasing one Three resource may throw; always reach native device teardown.
    try { target?.dispose(); }
    finally {
      try { renderer?.dispose(); }
      finally {
        try { screenTexture?.destroy(); }
        finally {
          try { device?.destroy(); }
          finally { delete globalThis.navigator; gpu = null; }
        }
      }
    }
  }
  try {
    const { backend } = selection;
    const args = [`backend=${backend}`];
    if (selection.adapter) args.push(`adapter=${selection.adapter}`);
    gpu = binding.create(args);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu, userAgent: 'Mivo Node renderer' } });
    globalThis.self = { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
    const THREE = await sdkImport('three/webgpu');
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No WebGPU adapter. On Linux install libvulkan1 and mesa-vulkan-drivers.');
    }
    const deviceType = checkDevice(requestedDevice, adapter);
    const limits = adapter.limits;
    if (width > limits.maxTextureDimension2D || height > limits.maxTextureDimension2D) throw new Error(`Image size exceeds the device limit ${limits.maxTextureDimension2D}.`);
    device = await adapter.requestDevice();
    const canvas = { width, height, style: {}, addEventListener() {}, removeEventListener() {} };
    // No DOM canvas or swapchain: Three gets an offscreen GPUTexture when needed.
    const context = {
      configure() {}, unconfigure() {},
      getCurrentTexture() {
        screenTexture?.destroy();
        screenTexture = device.createTexture({ size: [canvas.width, canvas.height], format: gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        return screenTexture;
      }
    };
    renderer = new THREE.WebGPURenderer({ canvas, context, device, alpha: true, antialias: false });
    renderer.backend.parameters.getFallback = undefined;
    renderer.onDeviceLost = (event) => { if (event.reason !== 'destroyed') console.error('WebGPU device lost:', event.message); };
    await renderer.init();
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    target = new THREE.RenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    renderer.setRenderTarget(target);
    return {
      THREE, renderer, device,
      resize(nextWidth, nextHeight) {
        if (nextWidth > limits.maxTextureDimension2D || nextHeight > limits.maxTextureDimension2D)
          throw Object.assign(new Error('Image size exceeds the device limit.'), { code: 'RENDER_INIT_FAILED' });
        if (width === nextWidth && height === nextHeight) return;
        renderer.setRenderTarget(null);
        target.dispose();
        width = nextWidth; height = nextHeight;
        renderer.setSize(width, height, false);
        target = new THREE.RenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true });
        target.texture.colorSpace = THREE.SRGBColorSpace;
        renderer.setRenderTarget(target);
      },
      backend, deviceType, requestedDevice,
      adapter: { vendor: adapter.info?.vendor || '', description: adapter.info?.description || '' },
      async render(scene, camera) {
        device.pushErrorScope('validation');
        let pixels;
        let failure;
        try {
          await renderer.renderAsync(scene, camera);
          // Three r170's readback type table omits rgba8unorm-srgb. Read the
          // encoded render target with Dawn directly, including row alignment.
          const texture = renderer.backend.get(target.texture).texture;
          const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
          const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          try {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height, depthOrArrayLayers: 1 });
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const mapped = new Uint8Array(buffer.getMappedRange());
            pixels = new Uint8Array(width * height * 4);
            for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
            buffer.unmap();
          } finally { buffer.destroy(); }
        } catch (error) { failure = error; }
        const validation = await device.popErrorScope();
        if (failure) throw failure;
        if (validation) throw Object.assign(new Error(validation.message), { code: 'RENDER_FAILED' });
        return pixels;
      },
      dispose
    };
  } catch (cause) {
    try { dispose(); } catch { /* Preserve the initialization error. */ }
    throw Object.assign(new Error(`Cannot initialize Node rendering: ${cause.message}`, { cause }), { code: cause.code || 'RENDER_INIT_FAILED' });
  }
}
