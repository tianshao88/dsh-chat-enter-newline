# dsh-send-or-newline

DSH 插件：让输入框的 `Enter` / `Shift+Enter` / `Ctrl(Cmd)+Enter` 各自可选「发送消息」或「换行」，并在 设置 → 通用 增加一行「输入快捷键」。

[English](README.en.md) | 中文

## 为什么需要它

DSH 把「发送消息」「换行」登记为**固定输入操作**（`registerFixed()`）：它们只出现在 设置 → 快捷键 的速查表里，用于展示、占用键位和冲突校验，刻意不带覆盖配置、不能录键。真正的按键判定写死在输入框编辑器的 Enter 命令里。

本插件不动引擎的键位表，也不接管那两行只读项，而是在 document 捕获阶段按偏好**改写原事件上的修饰键**，让引擎自己读到另一种手势：事件保持可信、不 `preventDefault`、不阻断传播，「发送」和「换行」的语义仍由引擎决定。

## 与同类实现的区别

这个需求已有多个社区插件（`dsh-composer-keys`、`dsh-keys-setting`、`dsh-composer-enter`、`dsh-ctrl-enter-submit`、`dsh-enter-swap` 等）。本插件的取舍是**最小且可通读**：

- **无宿主 HTTP 路由**。宿主半边只有 25 行：声明一个 `volatile` Config 并声明界面自带，不注册路由、服务、监听或定时器。
- **只改写修饰键，不重放事件**。不合成 `KeyboardEvent`、不碰 Lexical 内部、不直接改 DOM；`isTrusted` 与事件传播链完全不变。
- **默认与引擎逐字一致**。默认值就是引擎键位表，未改动偏好时干预次数为 0。
- **无构建步骤**。浏览器半边是手写的 `window.__ModuleLoader__.load({ id, factory })` bundle，只 `require('react')`。
- **依赖最少**。运行时依赖只有引擎同款 `@deepseek-ai/schemastery`，用于声明 Config schema。

代价是功能收敛：不提供「打断键」、不提供键位方案预设、不支持把发送键改成任意自定义组合键——那些交给上面那些更完整的实现。

## 行为

| 手势 | 默认（与引擎一致） | 可改为 |
|---|---|---|
| `Enter` | 发送消息 | 换行 |
| `Shift+Enter` | 换行 | 发送消息 |
| `Ctrl/Cmd+Enter` | 发送消息 | 换行 |

偏好等于引擎默认时**不做任何改写**，所以装上去不改你的现有习惯。`Ctrl+Shift+Enter` 归入 Shift 手势（引擎键位表 Shift 优先）。

只在主输入框（`[data-composer-input="true"]`）内生效。队列编辑框、提问卡片等其它输入不受影响。输入法组合（`isComposing`、`keyCode 229`）与 `Alt` 组合一律放行；`/`、`@` 菜单展开时 Enter 归菜单。

## 偏好存在哪

可持久化的插件偏好由 profile 的 Cordis 补丁层承载：

- 命名空间：`send-or-newline`（等于 `cordis.patch.yml` 里的 Loader 条目 id）
- 字段：`enter` / `shiftEnter` / `ctrlEnter`，取值 `send` 或 `newline`
- 落盘位置：`$DSH_HOME/profiles/<profile>/cordis.patch.yml`

持久化不用重启：设置行里的选择立即写进该文件并立即生效。也可以直接手改该文件，插件行写成：

```yaml
- id: send-or-newline
  name: dsh-send-or-newline
  config:
    enter: newline     # 只写要覆盖的手势；未写的字段走 schema 默认
    ctrlEnter: send
```

## 两个半边

| 半边 | 文件 | 职责 |
|---|---|---|
| 宿主 | `index.js` | 只声明 `Config`（字段标 `volatile()`，才会进入设置表单投影）并调用 `settings.configure({ auto: false })`，表明界面自带 |
| 浏览器 | `client.js` | 绑定 `ctx.configForms.get(条目 id)`、改写 Enter 手势、把设置行注册进 `settings.general.item`（order 21） |

浏览器半边只 `require('react')`，刻意不引用任何引擎客户端包——官方 `practices.md` 禁止这么做，且它们的导出会随版本变化。

## 依赖的引擎契约

升级 DSH 后若出现「设置行不见了」或「按键不生效」，跑一次自检（需要本机装有 DSH，默认读 `D:\Tools\DeepSeek\resources\app.asar`，可用 `--archive=` 或 `$DSH_ASAR` 覆盖）：

```sh
node tools/asar.mjs check
```

它逐条核对下表并打印关键引擎包版本：

1. `[data-composer-input="true"]`、`[data-composer-card]`、`[data-trigger-menu]` 三个属性仍在（`dsh-client-ui-conversation` / `dsh-client-ui-input-trigger`）。
2. Enter 命令仍按 `event.shiftKey` 分流换行/提交，且 `Ctrl`/`Meta` 走同一条提交路径。
3. `settings.general.item` 槽位与 `ctx.configForms.get(entryId)` / `whileServed()` 仍在（`dsh-client-ui-settings`）。
4. `hooks` 隔舱仍转成 `use<Name>` 选择器钩子（`dsh-client-ui-renderer`）。
5. 宿主侧 `@deepseek-ai/schemastery` 仍支持 `z.union([...]).default(...).volatile()`。

## 开发与验证

```sh
node --check index.js && node --check client.js
node test.mjs              # 逻辑单测（27 项）
node tools/asar.mjs check  # 引擎契约自检
```

`test.mjs` 用假的 `window.__ModuleLoader__` 接住工厂，覆盖手势识别、改写决策、输入法/Alt/已消费事件放行，以及修饰键写回。

`tools/asar.mjs` 只读检查打包后的 `app.asar`（DSH 的实现代码全在里面，PowerShell 与 ripgrep 都读不进去）：`check` 逐条核对上面那些契约，另有 `list` / `grep` / `extract` / `versions`。

## 安装与卸载

```sh
# 从 Git 仓库或本地目录安装（profile 要与实际运行的一致）
dsh plugin --profile <profile> add github:tshchief/dsh-send-or-newline
dsh plugin --profile <profile> add file:<本目录绝对路径>

# 卸载
dsh plugin --profile <profile> remove dsh-send-or-newline
```

桌面应用启动的 profile 名是 `desktop`；用 `dsh web` 启动时是 `web`。安装后无需重启引擎，刷新页面即可看到设置行；若没出现，再重启引擎。**改完本目录的源码要重跑一次安装**——`file:` 是复制而不是软链。

## 测试过的组合

| DSH | 平台 | 状态 |
|---|---|---|
| `0.2.0-rc.2` | Windows 桌面端（Web GUI） | 已实测：设置行写入、`Enter` 换行、`Ctrl+Enter` 发送 |

其它版本未验证。`package.json` 用 `peerDependencies` 声明 `@deepseek-ai/dsh: ^0.2.0-rc.2`：这是引擎**真正会拦**的兼容性声明（`evaluatePluginCompatibility` 只检查 `peerDependencies` 里的 `@deepseek-ai/dsh*`）；另外还有一份 `dsh.compatibility.dshReleases`，那是社区商店的上架元数据，引擎不校验。

## 已知限制

- 设置 → 快捷键 的速查表仍显示 `Enter` / `Shift+Enter` 且只读：那是引擎的固定输入操作目录，插件无法改写，因此两处显示会不一致。
- 偏好按设备与平台独立，和引擎自己的键位覆盖一样不跨设备同步。
- 本插件不改变「忙碌时 Enter 是排队还是插话」的行为，那是 设置 → 通用 里引擎自己的 `composer-enter` 行。
- 依赖引擎的几个 DOM 语义属性与槽位名（见上文契约）。引擎大版本改动时失效模式是「静默不生效」，不会破坏原生功能。

## 发布前清单

已完成：

- `repository` / `bugs` / `homepage` 指向 `https://github.com/tshchief/dsh-send-or-newline`（在 GitHub 建好同名仓库后即生效）。
- `LICENSE` 署名为 `Eric`，与 GitHub 显示名一致。

待办：

- 在 GitHub 创建 `dsh-send-or-newline` 仓库并推送（本目录尚未初始化 git）。
- npm 发布：需要 npm 账号；推荐用 GitHub Actions + npm OIDC 可信发布（带 provenance 签名），与同类插件的做法一致。
- 版本策略：DSH 仍在 rc 阶段，本插件按 `0.x` 递增；`peerDependencies` 与 `dsh.compatibility` 随已验证的 DSH 版本更新。

## 许可

MIT，见 [LICENSE](LICENSE)。
