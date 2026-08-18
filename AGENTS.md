# AGENTS.md — LoopX Console

LoopX Console（`xielixing/loopx-console`）是一个 **BitFun MiniApp**：粘贴 GitHub
Issue 链接，由 BitFun 宿主 Agent 驱动本机 loopx CLI 持续修复，心跳调度、人工
审批、中途插话。产品规格见 [`docs/product-spec.md`](docs/product-spec.md)。

## 1. 三个仓库的关系（必读）

```
┌─────────────────────────────────────────────┐
│ BitFun (GCWing/BitFun)                      │  ← 宿主应用（我们被嵌入其中）
│   └─ MiniApp 场景 ── iframe 加载 loopx-console│
│       └─ (可选) Node/Bun worker 运行 source/worker.js
└─────────────────────────────────────────────┘
         │ app.call / app.on / shell / fs / net / agent 桥
         ▼
┌─────────────────────────────────────────────┐
│ loopx-console (本仓库)                      │
│   source/   本地导入版（有 Node worker）      │
│   market/   市场版（无 worker，页面内桥接）    │
└─────────────────────────────────────────────┘
         │ spawn `loopx --format json …`（CLI 协议，非代码依赖）
         ▼
┌─────────────────────────────────────────────┐
│ loopx (huangruiteng/loopx)                  │  ← 本机安装的 Python CLI
│   ~/.codex/loopx/ 全局数据                    │
│   <repo>/.loopx/  项目级注册表                │
└─────────────────────────────────────────────┘
```

**铁律**：

- **BitFun 是宿主，只读不写**。开发 loopx-console 时可以读 BitFun 源码来理解
  宿主桥契约（`useMiniAppBridge.ts`、`miniapp_api.rs`、`host_dispatch.rs`、
  `compiler.rs`、`worker_pool.rs` 等），**但绝不修改 BitFun 仓库**——MiniApp
  被嵌入 BitFun，必须只通过已发布的桥 API 与宿主协作，不能指望宿主为我们
  改任何东西。任何"需要宿主配合"的能力都要写成提案（见
  [`docs/market-proposal.md`](docs/market-proposal.md)）。
- **loopx 是外部依赖，同样只读**。本仓库不含 loopx 源码；运行时通过
  `spawn(['loopx', '--format', 'json', …])` 调用用户机器上安装的 CLI
  （本机开发环境为 `pip install -e D:\loopx`，版本 0.2.13）。loopx 命令的
  JSON 输出契约就是我们的接口面，改动 loopx 语义会破坏本应用——不修改它，
  只在需要时读它的 `cli_commands/`、`control_plane/`、`bootstrap.py` 等
  确认参数语义。
- 三个仓库完全独立、各自 git 管理；本仓库只提交自己的代码。

## 2. 目录结构与双版本

| 路径 | 内容 |
|---|---|
| `source/` | **本地导入版**（默认分发）：index.html / style.css / ui.js / worker.js / esm_dependencies.json |
| `market/` | **市场版**：meta.json（`node.enabled=false`）+ source（worker.js 必须为空模块）+ `lx-module.js`（页面内 loopx 桥接，monkey-patch `app.call`） |
| `tools/build-market.cjs` | 从主源码树生成 `market/source/*`：**每次改完 source/ 必须跑一次并提交产物** |
| `tools/i18n-parity.cjs` | 校验 zh-CN / en-US i18n 表键位一致 |
| `tests/` | 契约测试（输入语法、autoClone 守卫） |
| `docs/` | product-spec.md（产品规格）、market-proposal.md（市场提案） |
| `.github/workflows/` | `release.yml`（tag `v*` → 本地版 zip）、`market-release.yml`（tag `market-v*` → 市场版 zip + 静态契约校验） |

**双版本架构**：本地版用 Node worker 跑 loopx；市场版禁止 Node worker（市场
校验 `node.enabled=false`、worker 代码必须为空、禁 ESM/npm 依赖），全部逻辑在
页面内用宿主原语（`app.shell.exec(argv 数组)` / `app.fs.*` / `app.net.fetch`）
重写。两者共用 `source/ui.js`（lx-module 通过 monkey-patch `app.call('loopx.*')`
+ 重放 `worker:taskIntake:*` 事件实现无缝复用）。

## 3. 宿主桥契约要点（写代码前先查 BitFun 源码核实）

- `window.app`：`app.call(method, params)`（worker RPC / 市场版拦截）、
  `app.on(event, fn)`、`app.t(table, fallback)`、`app.ai.getModels()`、
  `app.agent.run(prompt, {sessionName, sessionId, enableTools, model})`、
  `app.shell.exec({args, timeout, cwd})`、`app.fs.*`、`app.net.fetch`、
  `app.storage.get/set`、`app.appDataDir`、`app.workspaceDir`。
- **shell.exec**：argv 数组（市场版禁止命令字符串）、返回
  `{stdout, stderr, exit_code}`、**非零退出以 stderr 内容 reject**、默认 30s
  超时（显式 `timeout` 覆盖）、宿主注入 `GIT_TERMINAL_PROMPT=0, LC_ALL=C`。
- **市场版 shell 白名单禁止解释器**：sh/bash/cmd/powershell/python/node/bun
  等一律被拒；`loopx`（pip console-script 真实 PE）与 `git` 可用。
- **权限**：`meta.json` 的 `shell.allow` 按 basename 匹配；`fs.read/write` 按
  作用域（`{home}/{appdata}/{user-selected}`）；`net.allow` 按主机。
- **主题**：宿主异步注入 `--bitfun-*` CSS 变量，首帧用回退色会闪——首页
  内联脚本 + ui.js 做了 paint gate（`visibility`），改动时保持三路释放。
- **宿主悬浮聊天气泡**：右下角 fixed（right:20px、42px 圆钮）会压住小应用
  右下角，布局需留 72px 右侧安全区。
- **worker 池已知行为**：复用 worker 不查活；外部杀掉 worker 后调用报
  `os error 232`，只能关标签页重开（不要杀 worker 来"清理"）。

## 4. 数据位置（重要，清理/迁移时要知道）

| 位置 | 内容 | 生命周期 |
|---|---|---|
| `%APPDATA%\bitfun\data\miniapps\<uuid>\` | 实例（导入副本）：compiled.html、storage.json、debug-ui.log、debug-worker.log | **重导入会删除**（复制语义：改代码必须删实例+重新导入） |
| `~/.bitfun/loopx-console/repos/<owner>-<repo>` | **稳定克隆缓存**（跨重导入保留） | 手动删除才消失 |
| `~/.codex/loopx/` | loopx 全局注册表 + goal 运行时 + archived-goals | loopx 所有 |
| `<repo>/.loopx/registry.json`、`<repo>/.codex/goals/` | 项目级目标状态 | 随克隆缓存 |

注册表修改一律先留时间戳备份（`.del-bak-*` / `retire-goal-backup-*`）；
删除目标 = `loopx archive-runtime --allow-registered --execute` + 项目/全局
注册表条目移除。

## 5. 关键产品决策（改代码前先读，别推翻）

- **默认暂停、显式启动**：新创建的任务立即自动跑（用户刚发起＝明确意图）；
  **每次打开控制台时，所有既有任务一律回到暂停（自动已关）**，点卡片上的
  「继续」才恢复自动执行——打开应用绝不自动续跑上次的任务。确认单即授权
  （bootstrap `--write-scope write` 预授写权限 + intake 写入的 role=user
  计划门自动以 approve 完成 + 「离开只读适配器/写权限」类门禁也自动批准）；
  `publish`（提 PR）才需要人批准。
- **生命周期跟随控制台**：控制台关闭（标签页/场景卸载/应用退出）时，所有
  心跳定时器停止、所有进行中的宿主 Agent turn 被 cancel——界面显示「没有在
  运行」就等于真的没有在运行，不留残留进程。
- **composer 两种模式**：
  - **新建任务（默认）**：链接 → issue 入库，创建**完全独立**的新任务（允许同仓库多任务，互不影响）；
  - **选择已有任务**：输入框内容（链接或自由文本一律）作为**人类反馈**以
    user_action todo 注入该任务，引导 Agent 后续行为——不再走入库、不弹
    issue 列表。
  - **按 issue URL 去重**：重复粘贴同一 issue 会跳过、不写重复 todo
    （worker 侧守卫）。历史原因产生的同仓库多任务是旧版行为，应清理。
- **看板只有两列**：等你处理（阻塞审批）/ 进行中；排队不可见；已停表/异常
  置灰留在进行中目录栏下方；已完成/其他主机收进 review 区底部胶囊。
- **右侧面板 = 纯日志**：模型文本+思考全流式、工具行带参数、
  每个工具调用一行、连续重复折叠 ×N、标题下实时计时器。审批事项只在
  「等你处理」列的卡片上展示和处理，面板不重复渲染同一批卡片。
- **生命周期按钮在卡片上**：中止 / 继续 / 删除（带确认框），面板不再放按钮。
- **发布即 PR（默认）**：publish 类门禁（external_pr_creation / external_review_request
  等）批准时，控制台自己执行 **fork（没有则创建并等待）→ 推送分支 → REST 创建 PR**，
  然后完成 todo 让 loopx 对账；Agent 不自行 push。PR 标题统一带
  **`[bitfun-loopx]`** 前缀、正文带同一标识（GitHub 用 `"bitfun-loopx" in:title`
  即可统计本工具产出的 PR）。GitHub Token（fine-grained PAT，repo 读写）由用户
  在顶栏「GitHub 设置」配置，仅存于本机应用存储；push 时 token 只走一次性的
  x-access-token URL，不写入 git config。

## 6. 验证命令

```bash
node --check source/ui.js && node --check source/worker.js
node tools/build-market.cjs && node --check market/source/ui.js
node tests/classify-contract.cjs && node tests/autoclone-guard.cjs
node tools/i18n-parity.cjs
```

提交前：跑全上面的命令；`git tag vX.Y.Z && git push origin vX.Y.Z`
（`market-vX.Y.Z` 同理）。改完 source/ 后**先跑 build-market 再提交**。

## 7. 本机开发环境备忘

- BitFun 开发机：`D:\BitFun`（**只读参考**）；应用经 `D:\BitFun\.bitfun\start-dev.cmd`
  启动（bun 在 PATH、SHERPA_ONNX_ARCHIVE_DIR、GC 关）。
- loopx 源码：`D:\loopx`（只读参考）；CLI 安装在
  `%LOCALAPPDATA%\Programs\Python\Python314\Scripts\`。
- 调试产物：实例目录内 `debug-ui.log`（UI 时间线）与 `debug-worker.log`
  （worker 侧探测/错误），不依赖宿主日志。
