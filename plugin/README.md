# plugin — DSH 动态 Cordis 插件源码

| 文件 | 说明 |
| --- | --- |
| `host.js` | Host 半边：监听工作状态事件 + 读取任务投影，注册素材/状态 HTTP 接口与 RPC |
| `client.js` | Client 半边：右下角网页端宠物 + 任务面板（`shell.overlay` 槽位） |

## 安装步骤（DSH Web GUI）

1. 让 DSH Agent 使用 `cordis_define` 定义插件：
   - `plugin.kind: "new"`，`idPrefix` 任意 3-6 位小写字母（如 `furna`）；
   - `code.host` = `plugin/host.js` 的完整内容；
   - `code.client` = `plugin/client.js` 的完整内容；
2. 用返回的 `pluginId` / `packageId` 调用 `cordis_run`；
3. 界面出现授权请求时批准（建议勾选授权未来版本，后续升级免审批）；
4. 确保 DSH 工作区根目录下有 `pet-assets/sprite-clean.png`（把本仓库 `pet-assets/` 整个放进去即可；`host.js` 会自动读取当前会话工作区根目录）。

## 接口

- `GET /dsh-pet-assets/furina/sprite.webp` → 清洁版雪碧图（实际为 PNG 字节）
- `GET /dsh-pet-assets/furina/status.json` → 实时状态：

```json
{
  "ts": 1786896605460,
  "mood": "running",
  "detail": "pwsh",
  "subagents": 0,
  "progress": {
    "state": "working",
    "percent": 82,
    "completed": 9,
    "total": 11,
    "inProgress": 1,
    "currentTask": "大小/透明度滑块化（50-200% / 0-100%）",
    "hasTodos": true
  },
  "todos": [{"content": "任务内容", "status": "completed"}]
}
```

`mood` 取值：`idle` / `running` / `review` / `failed` / `waiting` / `waving` / `jumping`。
桌面宠物与网页端均轮询以上接口，任何其他客户端（壁纸引擎、悬浮窗）也可直接接入。
