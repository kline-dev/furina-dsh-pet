# 芙宁娜 DSH 桌宠 · Furina Desktop Pet for DeepSeek Harness

一只住在 DeepSeek Harness（DSH）里的芙宁娜桌宠：**桌面原生窗口 + 网页端悬浮宠物**双形态，实时反映 Agent 工作状态并汇报任务进度。

素材直接移植自 [petdex.dev/pets/furina-2](https://petdex.dev/pets/furina-2) 的官方雪碧图（未重绘形象），任务汇报功能参考 [wraven68/deepseek-harness-pet](https://github.com/wraven68/deepseek-harness-pet) 的读会话日志思路。

## 特性

- **工作状态 → 不同动作**（官方 9 个动作全部保留）：工作中跑步、思考（review）、等待许可、出错沮丧、收到消息挥手、完成庆祝；
- **任务进度汇报**：面板实时显示进度条 + 百分比 + x/y 计数 + 当前任务 + 完整待办清单，跨回合保持；
- **桌面形态**：无边框、置顶、透明窗口，可拖动（拖拽时按方向播跑步动画）；
- **右键菜单**：大小/透明度滑块（50%–200% / 0–100%）、任务面板开关、回到右下角、隐藏、退出；
- **干净边缘**：素材层 alpha 二值化 + 运行时反预乘，任意缩放比例无描线光晕。

## 架构

```
┌───────────────────────── DSH Host 插件 ─────────────────────────┐
│ 监听 agent/status、llm/stream、tools/execute 等事件               │
│ 读取会话 todo 投影 → 心情 + 任务进度                              │
│ 注册本地 HTTP 接口：                                             │
│   /dsh-pet-assets/furina/sprite.webp   清洁版雪碧图               │
│   /dsh-pet-assets/furina/status.json   实时状态 JSON              │
└──────────────┬───────────────────────────────┬──────────────────┘
               │ CSS 背景动画                    │ 每 0.4s 轮询
        ┌──────▼──────┐                 ┌───────▼────────┐
        │ 网页端宠物   │                 │ 桌面宠物窗口    │
        │ shell.overlay│                 │ Tkinter+Pillow │
        └─────────────┘                 └────────────────┘
```

## 安装

### 1. 依赖

- Python 3.11+，`pip install pillow numpy`
- DeepSeek Harness（插件与状态接口都运行在 DSH 内）

### 2. 安装 DSH 插件

在 DSH Web GUI 里让 Agent（或手动）执行动态插件定义：

1. `cordis_define`：新建插件，`code.host` = [`plugin/host.js`](plugin/host.js) 内容，`code.client` = [`plugin/client.js`](plugin/client.js) 内容；
2. `cordis_run` 运行该 Package，在界面中批准（可勾选"授权未来版本"）；
3. 插件会从**当前会话工作区**读取 `pet-assets/sprite-clean.png` —— 把本仓库的 `pet-assets/` 放进你的 DSH 工作区即可。

### 3. 启动桌面宠物

- Windows：双击 `启动芙宁娜桌宠.cmd`（或 `python tools/furina_pet_desktop.py`）；
- 状态接口地址默认 `http://127.0.0.1:3080`，可用环境变量 `FURINA_PET_BASE` 覆盖；
- 插件未运行时宠物也能启动（使用本地缓存素材），仅显示"连接中断…"，插件恢复后自动接上。

## 使用

| 操作 | 效果 |
| --- | --- |
| 左键拖动 | 移动宠物（左拖/右拖播方向跑步动画） |
| 单击 | 挥手 |
| 右键 → 大小 / 透明度设置… | 滑块实时调节（50%–200%、0–100%），自动保存 |
| 右键 → 任务面板 | 开关进度面板 |
| 右键 → 回到右下角 | 复位位置 |
| 右键 → 隐藏宠物 / 退出 | 隐藏后留 🐾 圆点可唤回；退出关闭程序 |
| 网页端双击宠物 | 隐藏（🐾 按钮恢复） |

## 重新生成清洁版素材

官方 `sprite.webp` 是有损 WebP，透明边缘带压缩杂色。如需从原图重新清理：

```bash
python tools/clean_sprite.py   # pet-assets/sprite.webp → sprite-clean.png
```

## 素材版权

芙宁娜精灵图 © 原画作者，来源 [petdex.dev/pets/furina-2](https://petdex.dev/pets/furina-2)，仅用于个人/学习用途；请通过 petdex 官方渠道支持原作者。代码部分按仓库 LICENSE 分发。

## 致谢

- [crafter-station/petdex](https://github.com/crafter-station/petdex) — 官方宠物资产与雪碧图渲染方案（帧 192×208、9 状态表）
- [wraven68/deepseek-harness-pet](https://github.com/wraven68/deepseek-harness-pet) — 任务进度汇报灵感
