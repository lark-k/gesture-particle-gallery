# 示例图片与模型

`public/samples/` 中随项目提供 20 张摄影示例和缩略图，用于交互应用的演示，**不是用户上传的内容**。来源逐张记在 `manifest.json` 的 `credit` 字段；文件编号与清单一致。来源为 Unsplash，使用依据为 [Unsplash License](https://unsplash.com/license)，允许下载、复制、修改和分发（不可原样销售照片，或用于复制竞争图片服务）。不冒称这些照片由本项目作者拍摄。没有调用 Unsplash API，也没有运行时远程图片依赖。

`scripts/setup-assets.mjs` 可重新生成缩略图；当本地原图已存在时不会再次下载。它从 Google 官方模型分发地址下载 Hand Landmarker float16 v1，并把安装的 `@mediapipe/tasks-vision` WASM 拷贝到 `public/mediapipe/`。模型及 WASM 是可重复获取的运行资源，已加入 `.gitignore`，部署前需要执行 `npm run setup:assets`。部署输出 `dist/` 会包含它们，浏览器无需访问 Google/CDN 即可识别。

- [MediaPipe 官方模型说明](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/index#models)
- [MediaPipe 仓库及 Apache-2.0 许可](https://github.com/google-ai-edge/mediapipe)
- 模型下载：`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`

界面使用设备本地的系统字体，不在运行时请求字体服务。


## 第三版自然环境与生成影像（2026-09-13）

默认收藏现在共25张：原20张 Unsplash 摄影，以及5张使用 OpenAI ImageGen 为此项目制作的生成影像：`forest-boardwalk`、`quiet-traveller`、`fern-dew`、`lake-pier`、`stone-passage`。新增生成内容的 credit 已标注，不冒称真人摄影作品，也不包含用户上传照片。原生尺寸与比例写在 manifest；高清文件不做虚假超分。

`public/environments/{forest,lake,meadow}-panorama.jpg` 是生成的2:1 LDR视觉底图，1774×887。`*-foreground.png` 是分别生成的蕨叶、湖岸石头与芦苇、草穗 RGBA 切片，具备真实透明通道。森林前景1100×1100，湖岸1100×825，草穗733×1100。参考图与部分生成原图归档在 `docs/design-references/`，不会作为公共静态资源打包。

### 真实 HDR 光照来源

下列 Radiance HDR 来源为 [Poly Haven](https://polyhaven.com/license)，其资产使用 CC0，可随项目分发。每个文件的官方URL及MD5完整性校验已保存在 `scripts/setup-environments.mjs`：

| 本地文件 | 官方资产 | 用途 |
|---|---|---|
| forest-light.hdr | [Forest Grove](https://polyhaven.com/a/forest_grove) | 森林自然光照 |
| lake-light.hdr | [Lakeside Dawn](https://polyhaven.com/a/lakeside_dawn) | 湖面晨光 |
| meadow-light.hdr | [Hausdorf Meadow](https://polyhaven.com/a/hausdorf_meadow) | 阴天草原光照 |

三份HDR合计约5.1MB，首次仅加载所选主题。JPEG用于视觉构图，HDR用于光照，两个用途明确分离；生成JPG不是测量得到的HDR、深度图或完整360度实拍全景。

## 相册集封面与窗影（2026-09-13）

`public/album-covers/` 中的 `meadow.webp`、`coast.webp`、`cat.webp`、`linen.webp` 和 `warm-window.webp` 均为使用 OpenAI ImageGen 专门生成的项目素材，不含用户照片。前三种为草地、海岸和午睡猫咪封面；亚麻纹理用于素色封面、书脊及内页，暖色窗影用于页面背景。森林与湖泊预设复用上述已生成的自然环境图。

生产界面使用压缩 WebP，五份共约 967 KiB；PNG 原稿保存在被 Git 忽略的 `docs/design-references/album-materials/`。动态背景由本地图片配合 CSS 缓慢移动与鼠标视差实现，没有视频下载或第三方媒体请求。照片封面仍使用当前用户的授权读取地址。

## 网站首页回忆相册（2026-09-14）

`public/home/memory-album.png` 是用户选定的 OpenAI ImageGen 融合素材（1672 × 941）：童年单车、家人围坐与海边同行。素材作为完整图片显示，同时用于生成过渡粒子的位置；没有读取用户私有照片。悬停后通过粒子过渡播放用户提供的家庭回忆视频。原始文件 `826208b3ea756e7c0093eb3196f9bc09.mp4` 保留；网页使用约 6 秒、1280 × 720 的 H.264 静音版 `family-memory.mp4`（支持循环及 faststart），`family-memory-poster.jpg` 为视频首帧，播放失败时作为彩色静态回退。移开、离屏或页面隐藏后暂停播放，完整还原后重置播放位置。

粒子亮核与柔和光晕的视觉方向参考 [MisterPrada/morph-particles](https://github.com/MisterPrada/morph-particles)。最终首页为统一浅色设计，使用独立编写的透明粒子着色器与双向变换时间线，未引入参考仓库的模型、声音或源码依赖。
