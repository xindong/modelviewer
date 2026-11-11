# mivo-model-viewer

浏览器 3D 模型查看器 SDK：默认提供完整可交互 UI，也可裁剪主题、关掉 UI 只用无头引擎，或离屏出图。基于 TypeScript + Three.js。

> monorepo 的浏览器包。Node 工具与 CLI 见 [`mivo-model-node`](../node/README.md)；两端共享平台无关核心 `@mivo/model-core`（格式识别 / 视角 / 取景 / 渲染参数 / 材质匹配 / STEP 网格化）。完整文档见仓库根 [README](../../README.md)。

## 安装

```bash
npm install mivo-model-viewer three
```

`three` 为 peerDependency（宿主安装，避免多实例）；STEP 实验性展示需可选 `occt-import-js`。

## 默认 UI

```ts
import { createModelViewer } from 'mivo-model-viewer'

const viewer = createModelViewer('#app', {
  locale: 'zh-CN',
  theme: { primary: '#745ef5' }
})
// await viewer.load(file)
```

容器需有明确高度（如 `style="width:100%;height:100vh"`）。

## 无头引擎 / 离屏出图

```ts
import { ViewerEngine, renderModelImage, createThumbnailRenderer } from 'mivo-model-viewer/core'

const blob = await renderModelImage({
  model: file,            // File | Blob | URL
  fileName: 'chair.obj',  // Blob/无扩展名 URL 时用于推断格式
  width: 1200,
  presetView: 'front',
  padding: 0.1            // 留白比例，与 Node 渲染一致
})
```

离屏取景与 Node 渲染共用 `@mivo/model-core` 的规范算法（视角并集 front/back/left/right/side/top/bottom/angled/none，`none` 为固定 3/4 机位）。批量缩略图用 `createThumbnailRenderer` 复用同一 WebGL 上下文。

## 支持格式

GLB / glTF / OBJ / FBX / STL / PLY / DAE / 3MF / 3DS / ZIP 资源包；实验性 VRML / STEP。

## License

[MIT](LICENSE)
