# CHANGELOG

## 0.1.0 -- 2026-10-04

首个公开版本。

- 输入框的 `Enter` / `Shift+Enter` / `Ctrl(Cmd)+Enter` 各自可选「发送消息」或「换行」。
- 设置 → 通用 增加一行「输入快捷键」，中英双语。
- 偏好写入 profile 的 Cordis 补丁层（`ctx.configForms` + 宿主 `volatile` Config），按设备与平台独立保存。
- 默认值与引擎原生键位表逐字一致：未改动偏好时不拦截任何按键。
- 实现边界：只改写原事件的修饰键，不重放合成事件、不阻断传播、不接管引擎语义、不提供宿主 HTTP 路由。
- 单测覆盖手势识别与改写决策（27 项）；`tools/asar.mjs check` 可在 DSH 升级后核对所依赖的引擎契约。
