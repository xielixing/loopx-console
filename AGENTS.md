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
  [`docs/market-proposal.md`](docs/market-proposal.md)、
  [`docs/bitfun-worker-host-cjs-proposal.md`](docs/bitfun-worker-host-cjs-proposal.md)）。
- **loopx 是外部依赖，同样只读**。本仓库不含 loopx 源码；运行时通过
  `spawn(['loopx', '--format', 'json', …])` 调用用户机器上安装的 CLI
  （或 vendor 固定版本源码检出，见 §5；本机开发环境为 `pip install -e D:\loopx`，
  版本 0.2.13）。loopx 命令的
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
| `docs/` | product-spec.md（产品规格）、market-proposal.md（市场提案）、bitfun-worker-host-cjs-proposal.md（宿主 worker 修复提案）、bitfun-model-capability-proposal.md（模型多模态能力字段提案） |
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
- **loopx 输出里的 "codex" 字样 ≠ 真实 Codex CLI**：`waiting_on="codex"` /
  `needs_codex` / `owner: codex` 是 loopx 对其 **agent 执行泳道**的遗留标签
  （codex 血统词汇）；本应用跑 `--runtime-profile outer_controller`，执行方
  就是 BitFun 宿主 Agent，无任何 codex 进程/CLI 耦合（`.codex/loopx/` 也只是
  loopx 数据目录的命名）。唯一需清洗的真实瑕疵：`heartbeat-prompt` 正文里
  一句 "Do not ask for permissions when the current Codex session is already
  trusted" —— worker 的 `loopx.turnPrompt` 已替换为 BitFun 表述；UI 的
  `waitingLabel` 把 codex/agent 显示为「等待 Agent 执行」，不透出裸标签。
- **宿主 worker 坑（只有 Node 没 bun 的机器必现）**：BitFun 根 package.json 是
  `"type":"module"`，Node 会把 CommonJS 的 `worker_host.js` 当 ESM 加载 → JS
  worker 秒崩；本应用随之**误报「未检测到 loopx」+ 出现「一键安装」按钮**、
  worker 调用报 330s 超时或 `os error 232`、实例目录没有 `debug-worker.log`
  （worker.js 从未加载＝关键判据）。本机 PATH 只有 bun 的 npm 壳脚本（真
  `bun.exe` 不在 PATH）→ 宿主回落 Node 触发此坑。详细根因与修复见
  [`docs/bitfun-worker-host-cjs-proposal.md`](docs/bitfun-worker-host-cjs-proposal.md)；
  临时绕行＝市场版（无 worker）或用 start-dev.cmd 重启（bun.exe 进 PATH）。

## 4. 数据位置（重要，清理/迁移时要知道）

| 位置 | 内容 | 生命周期 |
|---|---|---|
| `%APPDATA%\bitfun\data\miniapps\<uuid>\` | 实例（导入副本）：compiled.html、storage.json、debug-ui.log、debug-worker.log | **重导入会删除**（复制语义：改代码必须删实例+重新导入） |
| `~/.bitfun/loopx-console/repos/<owner>-<repo>` | **稳定克隆缓存**（跨重导入保留） | 手动删除才消失 |
| `~/.bitfun/loopx-console/vendor/loopx` | **loopx 源码固定版本检出**（pin 在 `worker.js` 的 `LOOPX_VENDOR_REF`，PYTHONPATH 直跑，无需 pip） | 跨重导入保留；`loopx.ensureVendor` 会重新 pin |
| `~/.codex/loopx/` | loopx 全局注册表 + goal 运行时 + archived-goals | loopx 所有 |
| `<repo>/.loopx/registry.json`、`<repo>/.codex/goals/` | 项目级目标状态 | 随克隆缓存 |

注册表修改一律先留时间戳备份（`.del-bak-*` / `retire-goal-backup-*`）；
删除目标 = `loopx archive-runtime --allow-registered --execute` + 项目/全局
注册表条目移除。

## 5. 关键产品决策（改代码前先读，别推翻）

- **loopx 获取优先级（通用化，无安装机器也可用）**：已装 CLI（PATH/绝对路径）
  → 一键拉取源码到 `~/.bitfun/loopx-console/vendor/loopx`（固定 pin，worker.js
  的 `LOOPX_VENDOR_REF`），用 `python -m loopx.cli` + PYTHONPATH 直跑（loopx
  零运行时依赖，仅需 Python ≥ 3.11）→ 都没有时横幅点名缺 Python/git 并给
  安装指引（pip 安装按钮保留为兜底）。**契约版本随 pin 走**：升级
  `LOOPX_VENDOR_REF` 前必须验证 CLI JSON 契约兼容。市场版走不了 vendor
  （禁解释器），保留 pip 指引文案。
- **卡片 issue 进度条**：批量目标（多 issue）在卡片上显示 `issues done/total`
  + 每个 issue 的状态胶囊（open/blocked/deferred/done，数据=agent todos 中
  `action_kind=fix_issue` 的投影，`loopx.goalIssues`，每目标 60s 懒加载缓存）；
  单 issue 目标显示单个 `#N` 胶囊（状态随目标分组：done→已修复）。胶囊点击
  直达 GitHub issue；目标文本只有 issues 列表 URL 时以投影为清单。市场版
  lx-module 同款投影。
- **图片感知保守策略**：issue 描述含图片（`bodyHasImages`：markdown 图 /
  `<img>` / GitHub 附件链接；列表接口自带 body，单 issue 入库另查一次详情）
  且当前模型非多模态时，入库确认单显示黄色警告（`intakeVisionWarn`）并为
  对应 issue 标 🖼——文字不足以确认根因就不盲改，建议用户补充文字（错误
  信息/复现步骤）或换视觉模型，用户仍可继续。模型能力探测
  `modelSupportsVision()`：宿主目录目前只暴露 `supports_text_chat`，无
  vision 标志 → 能力字段优先 + 名称启发式兜底，**未知模型按纯文本保守
  处理**。宿主提案见
  [`docs/bitfun-model-capability-proposal.md`](docs/bitfun-model-capability-proposal.md)。
- **默认暂停、显式启动**：新创建的任务立即自动跑（用户刚发起＝明确意图）；
  **每次打开控制台时，所有既有任务一律回到暂停（自动已关）**，点卡片上的
  「继续」才恢复自动执行——打开应用绝不自动续跑上次的任务。确认单即授权
  （bootstrap `--write-scope write` 预授写权限 + intake 写入的 role=user
  计划门自动以 approve 完成 + 「离开只读适配器/写权限」类门禁也自动批准）；
  `publish`（提 PR）才需要人批准。**批准即放行**：用户在门禁卡上批准后，
  任务自动清除停止态并恢复自动执行（`approveTodo` 清 userStopped/monitoring/
  autoRun 后立即 pollNow），不残留「继续/删除」等二次操作；连续批准多个
  门禁时，刷新会等前一次加载完成再强制重载，杜绝第二张卡因 TTL 缓存
  残留不消失。
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
  - 输入框占位符随模式切换：新建任务＝粘贴链接提示；选中已有目标＝「正在向
    「XX」插话」引导文案。删除目标时 `deleteGoal` 必须连带移走
    `~/.codex/loopx/archived-goals/<id>-*` 目录（改名备份），否则 listGoals
    会把已归档目标复活、下拉框不更新。
- **看板只有两列**：等你处理（阻塞审批）/ 进行中；排队不可见；已停表/异常
  置灰留在进行中目录栏下方；已完成/其他主机收进 review 区底部胶囊。more 区
  （底部胶囊+展开面板）按内容指纹跳过重建——心跳轮询每 1-2s 会触发整板重绘，
  若不跳过，展开中的归档面板会被反复销毁重建（滚动归零、闪烁乱跳）。
  **门禁判据 = waiting_on==user ∨ state 含 gate/user_action/operator ∨
  存在 open 的 user 泳道 todo**——多 issue 并行时 loopx 的 waiting_on 仍报
  codex（还能修别的 issue），但 publish 审批 todo 已存在，必须以 todo 为准
  进「等你处理」；publish 识别同时看 todo 的 action_kind/task_class 与文本
  （loopx 可能只写 user_action + 文本点名"创建 PR/publish"）。
  **「等你处理」只展示阻塞项**（user_gate / publish 类），指引类 user todo
  （"用户需要 xxx"等）一律不渲染成卡片、也不触发门禁——loopx 内部自己消化；
  角标只计阻塞项数（悬停 title 可看内部提示条数）。
- **右侧面板 = 纯日志**：模型文本+思考全流式、工具行带参数、
  每个工具调用一行、连续重复折叠 ×N、标题下实时计时器。审批事项只在
  「等你处理」列的卡片上展示和处理，面板不重复渲染同一批卡片。
  **日志 DOM 纪律（白屏事故教训）**：流式块在 DOM 里只保留尾部窗口
  （think 2K / agent 输出 6K / prompt 4K，`STREAM_DOM_CAPS`），全文只在
  内存与 raw 视图；text-chunk 事件按 rAF 每帧合并一次写 DOM（`streamPending`），
  禁止每 chunk 整块重排；持久化日志窗口 120 行 × 1.2KB（`saveLogs`）。
  创建与续写两条路径都必须截断——只截创建不截续写，会把完整累计文本
  反复写入 DOM，直接打爆宿主渲染进程内存（2.4GB → 白屏）。
- **生命周期按钮在卡片上**：中止 / 继续 / 删除（带确认框），面板不再放按钮。
- **人类视图模板（模型独白不面向人类）**：卡片为**分区结构**（`buildGoalSection`
  带标题+虚线的块：①修复目标=issue 胶囊行（计数+状态，标题在悬停；issue 目标
  不再写叙述文字，避免与审批卡「背景」重复）②需要你决定=阻塞审批卡
  ③当前进度/结果=stage/结论），禁止连续文字流与跨层重复（审批卡无任务名
  kicker、无独立背景行——三行摘要的「背景」行承载 issue 上下文）；卡片叙述＝
  非 issue 目标用 objective，issue 目标直接省略；卡片活动行＝工具/状态进度（`recordGoalActivity`），模型可见输出与思考
  一律不进卡片、思考块在日志面板默认折叠；审批卡＝中文标签 + 背景/已完成/
  需要你 + 「批准后会发生什么」（`gateAfterPublish/Approve`）；AI 生成的
  门禁摘要必须**解析而非过滤**：从模型输出中抽取最后一次出现的
  「背景：/已完成：/需要你：」三行（`extractGateSummary`→`cleanGateSummary`），
  思考块不进摘要缓冲（contentType=thinking 丢弃）、缓冲区上限 8K——
  模型推理墙（"Let me draft…"）绝不落卡；**摘要持久化**到 storage
  `gateSummaries`（`scheduleGateSummarySave`/启动恢复），首次生成后所有
  后续会话秒显，失败/缺失自动重试（`ensureGateSummary` 守卫只拦
  done/loading）。缓存的旧日志恢复时也按此
  过滤（currentActivity 优先取工具/状态行）。
- **发布即 PR（默认）**：publish 类门禁（external_pr_creation / external_review_request
  等）批准时，控制台自己执行 **fork（没有则创建并等待）→ 推送分支 → REST 创建 PR**，
  然后完成 todo 让 loopx 对账；Agent 不自行 push。PR 标题统一带
  **`[bitfun-loopx]`** 前缀、正文带同一标识（GitHub 用 `"bitfun-loopx" in:title`
  即可统计本工具产出的 PR）。**PR 正文模板**（`publishPr` 按 `issueUrl` 组装）：
  `Fixes #N` + `## 相关 Issue`（链接 + 一行描述，**绝不粘贴 issue 原文**）+
  `## 问题原因`/`## 解决方案`（发布时由模型按 issue 标题+分支+`loopx.gitLog`
  提交记录+`loopx.gitDiff` **文件清单**生成两行「原因：/解决：」——解决行
  要求具体到改了哪些文件、每处改动解决什么，`generateCauseAnalysis`，60s
  兜底，失败回退到提交列表）+ `## 涉及文件`（merge-base..HEAD 的
  `git diff --name-only` + `--shortstat`）+ 提交 subjects + marker。
  **提交列表只含分支自有提交**（`merge-base <base>..HEAD`，base 依次试 API
  默认分支/origin-x/main/master）——裸 `git log -15 HEAD` 会把主干继承的
  无关历史（docs/ci 提交）拖进 PR 淹没真正的修复。GitHub Token（fine-grained PAT，repo 读写）由用户
  在顶栏「GitHub 设置」配置，仅存于本机应用存储；push 时 token 只走一次性的
  x-access-token URL，不写入 git config。凭据对话框内置两种方式：①一键
  `gh auth login`（worker `loopx.ghLogin`：缺 gh 时 winget 安装——自动检测
  系统代理（WinINET ProxyServer）并经代理下载——再 `cmd start` 打开独立
  控制台跑 `gh auth login --web`（弹浏览器输一次性代码），轮询 `gh auth
  status` 至完成；`ghCliToken` 复用 `findGhExe()` 解析的绝对路径）②粘贴
  Fine-grained PAT（对话框内附创建链接，`app.system.openExternal` 打开）。

## 6. 验证命令

```bash
node --check source/ui.js && node --check source/worker.js
node tools/build-market.cjs && node --check market/source/ui.js
node tests/classify-contract.cjs && node tests/autoclone-guard.cjs
node tests/regression-guards.cjs
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
- BitFun 窗口「自己消失」：托盘图标**左键单击=显隐切换**（连点会闪没）；
  点窗口 X = 最小化到托盘（设置→窗口行为可改「退出」），右键托盘菜单才是
  真退出。
