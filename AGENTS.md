# AGENTS.md -- dsh-chat-enter-newline

DSH 插件：让输入框的 `Enter` / `Shift+Enter` / `Ctrl(Cmd)+Enter` 各自可选「发送消息」或「换行」。

面向使用者的说明在 `README.md`（英文 `README.en.md`）；本文件只写维护这份代码必须知道、且无法从代码稳妥推断的约定。

## 结构约定

| 文件 | 职责 |
|---|---|
| `index.js` | 宿主半边。只声明 `Config`（字段必须标 `volatile()`）并调用 `settings.configure({ auto: false })` |
| `client.js` | 浏览器半边。单个 bundle，`window.__ModuleLoader__.load({ id, factory })` |
| `cordis.patch.yml` | 组合层，插入一条 Loader 条目 |
| `test.mjs` | 纯逻辑单测，用假的 `window.__ModuleLoader__` 接住工厂 |
| `tools/asar.mjs` | 只读检查打包后的 `app.asar`：`check` 一次核对下面全部引擎契约，另有 `list` / `grep` / `extract` / `versions` |
| `package.json` | `exports["./client"]` 是客户端 bundle 的发现入口；`dsh.bundle.patch` 是组合层入口；`peerDependencies` 是引擎真正会拦的兼容性声明 |

`package.json` 的 `files` 只收运行时与文档（`index.js`、`client.js`、`cordis.patch.yml`、`README.md`、`README.en.md`、`LICENSE`）：`test.mjs`、`tools/`、`AGENTS.md`、`CHANGELOG.md` 只在 Git 仓库里，不进 npm tarball。

## 不变量（改动前先读）

1. **两套名字，各自必须自洽**：
   - 包名 `dsh-chat-enter-newline` **必须等于** `client.js` 里 bundle 的 `id`（引擎按包名解析 bundle）。
   - Loader 条目 id `chat-enter-newline`（`cordis.patch.yml`）**必须等于** `ctx.configForms.get(...)` 的命名空间、设置行的 `id`、以及 `client.js` 里的 `ENTRY_ID` 与 locale 命名空间 `NS`。
   - 包名带 `dsh-` 前缀、条目 id 不带，这是刻意的，与引擎其它插件一致（`dsh-agent-loop` → `agent-loop`）。不一致时设置行会静默消失。
2. **改包名要连 profile 补丁层一起改**。用户偏好写在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，那条记录同时带 `id` 与 `name`；只改包名不改那里的 `name`，Loader 会去加载一个已不存在的包，启动即报错。
3. **`volatile()` 不能省**：只有标了 `volatile()` 的字段才进入设置表单投影，浏览器端才能读到、写回。
4. **宿主半边不做别的**：不注册服务、路由、监听或定时器。加东西前先确认真的需要宿主侧能力。
5. **浏览器半边只 `require('react')`**：不引用任何引擎客户端包（官方 `practices.md` 禁止）。要控件的样式就从引擎包 `lib/**/*.css` 复制并改前缀，只保留 `--dsw-alias-*` 主题 token。
6. **默认值必须等于引擎键位表**：`send` / `newline` / `send`。默认即零干预，这是「装上去不改用户习惯」的前提，也是 `test.mjs` 断言的核心性质。
7. **只改写修饰键，不接管语义**：在 document 捕获阶段改写 `shiftKey` / `ctrlKey` / `metaKey`，不 `preventDefault`、不阻断传播、不重放合成事件（合成事件 `isTrusted: false`）。发送与换行的语义始终由引擎决定。
8. **作用域收窄**：只在 `[data-composer-input="true"]` 内生效，且放行输入法组合、`Alt` 组合、`/` 与 `@` 菜单展开时的 Enter。

## 依赖的引擎契约

**先跑 `node tools/asar.mjs check`**：它逐条核对下面八项并打印关键引擎包版本，全过即兼容。以下是给人看的对应关系，以及失败时该改什么：

1. `[data-composer-input="true"]`、`[data-composer-card]`、`[data-trigger-menu]` 三个属性仍在（`dsh-client-ui-conversation` / `dsh-client-ui-input-trigger`）。
2. Enter 命令仍以 `event.shiftKey` 分流换行/提交，`Ctrl`/`Meta` 走同一条提交路径。
3. `ctx.configForms.get(entryId)` 返回的表单仍有 `getSnapshot/subscribe/set`，且 `whileServed()` 仍在。
4. `settings.general.item` 槽位仍在，`hooks` 隔舱仍转成 `use<Name>` 选择器钩子（`dsh-client-ui-renderer`）。
5. 宿主侧 `@deepseek-ai/schemastery` 仍支持 `z.union([...]).default(...).volatile()`。

## 兼容性声明的两种机制

- `peerDependencies["@deepseek-ai/dsh"]`：**引擎会拦**。`evaluatePluginCompatibility` 只检查 `peerDependencies` 里的 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`，不满足时安装被拒（可用 profile 的 `compatibility.json` 精确豁免放行）。
- `dsh.compatibility.dshReleases`：**引擎不读**，是社区商店上架检查用的逐版本精确映射。改动兼容范围时两处都要更新。

## 验证入口

```sh
node --check index.js && node --check client.js && node test.mjs   # 逻辑
node tools/asar.mjs check                                          # 引擎契约（升级 DSH 后必跑）
```

`tools/asar.mjs` 默认读 `D:\Tools\DeepSeek\resources\app.asar`，可用 `--archive=` 或 `$DSH_ASAR` 覆盖；它只读，只有 `extract` 会写文件。

装好之后的机器可检项（不需要人眼看界面）：

- `cordis_inspect_query`（host，Config，`{"name": "dsh-chat-enter-newline"}`）应返回 `patchId: chat-enter-newline` 且三个字段带 `x-cordis.volatile`。
- `cordis_inspect_query`（client，Slots，`{"root": "settings.general.item"}`）应多出一个 `registrant: chat-enter-newline`、`order: 21` 的占位项——它出现即证明 Host 已在服务本命名空间。

真人验收只剩一项：在输入框按一次 `Enter` 与 `Ctrl+Enter`，确认与设置行的选择一致。合成键盘事件无法替代这一步。

## 工程边界

- **不改 `app.asar`**。插件只进 profile（本机桌面应用为 `desktop`），升级 DSH 不受影响。
- **改完源码要重跑一次安装**：`file:` 安装是把文件复制进 `profiles/<name>/node_modules/`，不是软链，改本目录的源码不会自动生效。装完刷新页面即可，不必重启引擎。
- 改 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 前先备份；该文件同时存放用户其它设置。
- 卸载：`dsh plugin --profile desktop remove dsh-chat-enter-newline`。
- 版本策略：DSH 仍在 rc 阶段，插件按 `0.x` 递增；每次更新 `peerDependencies` 与 `dsh.compatibility` 前，先用 `tools/asar.mjs check` 确认新引擎仍满足上面那些契约。

## 历史命名（避免误用）

本插件改过两次名，顺序如下：

| 时间 | 包名 | 条目 id / 命名空间 |
|---|---|---|
| 最初 | `dsh-composer-enter-keys` | `composer-enter-keys` |
| 2026-10-04 | `dsh-send-or-newline` | `send-or-newline` |
| 2026-10-20（当前） | `dsh-chat-enter-newline` | `chat-enter-newline` |

改名后旧命名空间下的偏好不会自动迁移：需要在 profile 补丁层里把那条记录的 `id` / `name` 一并对齐到当前名字，`config` 段的值原样保留。改名时三个位置必须同步——`package.json` 的 `name`、`client.js` 里 bundle 的 `id`（两者必须相等），以及 `cordis.patch.yml` 的条目 `id` / `name`（与 `ENTRY_ID`、`NS`、设置行 `id` 相等）。

另外两点历史教训：社区里有两个已占用 `composer-keys` 条目 id 的插件（`dsh-composer-keys`、`dsh-keys-setting`），同类插件不要混装——它们都在捕获阶段改写键盘事件，装在一起会互相打架；`dsh-keys-setting` 还用了本文件第 2 条不变量所说已废弃的 `settings.register` API，在 0.2.0-rc.2 上装不出效果。
