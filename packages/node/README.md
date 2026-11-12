# mivo-model-node

纯 Node 模型处理工具与 CLI：`info` / `render` / `convert` / `optimize` / `doctor`。无需浏览器，模型任务在隔离 Node 子进程中执行，可用于本地处理和服务端流水线。

> monorepo 的 Node 包。浏览器 SDK 见 [`mivo-model-viewer`](../viewer/README.md)；两端共享平台无关核心 `@mivo/model-core`。CLI 参数、部署与耗时口径详见 [docs/cli-design.md](../../docs/cli-design.md)。

## 安装与运行

需要 **Node ≥22.18.0**（`three` 已作为依赖内置）。

```bash
npm install mivo-model-node
npx mivo-model-node --help
npx mivo-model-node render ./model.glb -o ./preview.png
npx mivo-model-node convert ./model.fbx -o ./model.glb --optimize
```

## Node API

```js
import { createModelProcessor } from 'mivo-model-node'

const processor = createModelProcessor({ concurrency: 1, maxQueue: 32 })
try {
  const result = await processor.convertModelToGlb('/data/model.fbx', { optimize: true })
  // result.outputs[0].bytes 为最终 GLB（Uint8Array）
} finally {
  await processor.close()
}
```

也导出 `inspectModel` / `renderModelImages` / `convertModelToGlb` / `optimizeModel` 独立函数，以及常驻预览 `createModelPreviewProcessor`（pool + worker，复用统一管线与 GPU 上下文）。

## 可选原生依赖

`webgpu`（Dawn 离屏渲染）、`@napi-rs/canvas`（贴图解码）、`fbx2gltf`（原生 FBX 转换）、`occt-import-js`（STEP）。缺失时相关功能报 `OPTIONAL_DEPENDENCY_MISSING`，其余功能不受影响。

## Docker（Linux 软件渲染）

见仓库根 [Dockerfile.node](../../Dockerfile.node)：Node 22 + Lavapipe Vulkan，无 GPU/浏览器。

## License

[MIT](LICENSE)。原生 FBX 转换器许可见 [THIRD_PARTY_FBX2GLTF_LICENSE.txt](THIRD_PARTY_FBX2GLTF_LICENSE.txt)。
