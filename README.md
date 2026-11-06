# music_voxel · 水中体素

在黑色的水面上放置方块、搭建结构，用声音和水波“演奏”自己的作品。

## 运行

**最简单：双击 `play.html`**，用浏览器打开即可，不需要安装任何东西。

`play.html` 是把 `src/` 下所有模块合并后的单文件版本，由构建脚本自动生成，**不要直接修改它**。

### 开发流程

1. 修改 `src/` 里的模块（参数基本都在 `src/config.js`）
2. 重新生成 `play.html`：`node tools/build.mjs`（需要 Node.js）
3. 刷新浏览器里的 `play.html`

如果想直接用模块版 `index.html` 调试，需要一个本地静态服务器（浏览器不允许 `file://` 加载模块），
例如 VS Code 的 Live Server 插件，或 `npx serve`。

three.js 从 CDN 加载（版本在 importmap 里），所以运行时需要联网。

## 目录结构

```
voxel-water/
├── play.html           ★ 双击即玩的单文件版（自动生成，勿手改）
├── index.html          模块版入口：HUD 文字、importmap、入口脚本
├── tools/build.mjs     构建脚本：src/ → play.html
├── style.css           HUD / 提示文字样式
└── src/
    ├── config.js       ★ 可调参数：水面高度、节奏、音量限制、配色、乐器表、组件形状
    ├── core.js         渲染器、场景、相机、灯光、时钟
    ├── water.js        低多边形水面着色器、涟漪、方块的水下效果（共享波浪函数）
    ├── world.js        方块与物块：放置 / 拆除 / 分裂 / 合并、网格生成、音高规则
    ├── audio.js        Web Audio 合成：8 种乐器、建筑音效、声部上限与回收
    ├── notes.js        发声队列：放置回响、敲水水波、防嘈杂限流
    ├── features.js     特殊建筑：识别规则、触发反应、建筑配色
    ├── progress.js     解锁进度：世界色彩变化、远处生成乐器组件
    ├── codex.js        图鉴：B 键打开，建筑剪影（未发现为暗色）
    ├── companion.js    陪伴者：水面下游动的小鱼
    ├── overlays.js     视觉覆盖层：发声闪光、塔顶微光、泉的气泡、灯塔光束、“差一点”提示
    ├── input.js        鼠标 / 触摸 / 键盘、射线拾取、放置预览
    ├── ui.js           提示文字（toast）、方块计数
    └── main.js         主循环：物块物理、相机跟随、每帧更新
```

## 想改什么，去哪里

| 想改的东西 | 文件 | 位置 |
|---|---|---|
| 回响节奏、水波速度、发声限流 | `config.js` | `ECHO_GAP` `WAVE_SPEED` `VOXEL_COOLDOWN` `NOTE_WINDOW*` |
| 建筑门槛、成长奖励的方块数 | `config.js` | `TOWER_MIN` `NEED` `MILESTONES` |
| 哪些建筑可以共用方块 | `features.js` | `COMPAT` |
| 点多远算“敲水” | `config.js` | `TAP_FAR` |
| 建筑颜色 | `config.js` | `PAL` |
| 乐器颜色、名字、建筑对应哪件乐器 | `config.js` | `INST` `TYPE_INST` |
| 远处生成组件的形状 | `config.js` | `SEED_SHAPES` |
| 乐器的音色本身 | `audio.js` | `INSTRUMENTS`（每件乐器一个函数） |
| 建筑发现时的音效 | `audio.js` | `bell` `spring` `chime` `arp` `chord` `scale` `whale` |
| 音高规则（高度 → 音阶） | `world.js` | `noteStep` |
| 新增一种特殊建筑 | `features.js` + `config.js` | 见下文 |
| 水面的样子 / 波浪 | `water.js` | `waveBase` `ripples` 和水面片元着色器 |
| 夜海与天空的颜色 | `water.js` / `progress.js` | `lo` `hi` / `BG_COLOR` |
| 漂浮手感（扶正、阻尼、浮沉） | `main.js` | 主循环里每个物块的 spin / heave 计算 |
| 相机距离、缩放范围 | `main.js` / `config.js` | `fit` / `ZMIN` `ZMAX` |
| 操作按键、平移速度 | `input.js` | `keydown` 监听、`updatePan` |

调试：按 **N** 解锁下一种建筑（连按 7 次看结局）。

## 新增一种特殊建筑

1. `features.js`：写一个 `detectXxx()`，返回 `Map<唯一key, 数据>`。
2. `features.js`：在 `updateFeatures` 的 `F` 里加上它；在 `REACT` 里加一个同名反应函数（返回显示名）；需要冷却就用 `once(...)`。
3. `features.js`：在 `applyColors` 里给它上色。
4. `config.js`：在 `PAL` 加颜色，在 `TYPE_INST` 指定解锁后生成的乐器；如果是新乐器，再到 `INST` 和 `audio.js` 的 `INSTRUMENTS` 各加一项。
5. `progress.js`：把 `TOTAL_TYPES` 加一。

## 核心概念

- **格子坐标**：所有方块共用一套整数坐标 `grid`（`"x,y,z" → voxel`）。
- **物块（body）**：一组相连的方块，是一个独立漂浮的刚体。拆除后断开的部分自动成为新物块；放置的方块同时碰到两个物块时会把它们合并。
- **乐器方块**：`voxel.inst` 不为空的方块，用对应乐器发声；在它旁边放的新方块会继承同样的乐器。
- **发声只由玩家触发**：放置（主音 + 回响）、敲水（水波按距离依次奏响），没有自动循环。
