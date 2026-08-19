# BitFun 宿主修复提案：worker_host.js 在 Node 下被按 ESM 加载导致 MiniApp JS Worker 秒崩

版本：v1 · 状态：待 BitFun 侧评估/应用（本提案只读，不修改 BitFun 仓库）

## 1. 目标

让本地版（`permissions.node.enabled = true`）MiniApp 的 JS Worker 在「只装了
Node、没有 bun」的机器上也能正常启动，消除对「机器 PATH 上存在真实 `bun.exe`」
的隐性依赖——任意用户拿到 BitFun + loopx-console 源码即可开箱运行，不依赖任何
本机 PATH 特性。

## 2. 症状（2026-08-19 Windows 开发机实测）

- LoopX Console 本地版导入后，横幅显示「未检测到 loopx CLI」并出现
  「一键安装 loopx」按钮——但本机 `loopx --version` 正常（0.2.13，已安装）。
- 点击一键安装报错：

  ```text
  TauriCommandError: Validation error: Worker call timeout (330000ms)
  → TauriCommandError: Validation error: 管道正在被关闭。 (os error 232)
  ```

  且全程没有任何 pip/python 进程出现——安装从未真正执行。
- 实例目录 `<appdata>\data\miniapps\<uuid>\debug-worker.log` 始终不存在
  → `source/worker.js` 从未被加载执行（该日志在 worker.js 顶层
  `dbgWorker('boot')` 即写入，是「worker 是否成功启动」的判据）。

## 3. 根因链（全部有实证）

1. `BitFun/package.json` 声明 `"type": "module"` → Node 把
   `src/apps/desktop/resources/worker_host.js` 按 ESM 解析；而该脚本是纯
   CommonJS（`const fs = require('fs')` 等）→ 第 12 行即抛
   `ReferenceError: require is not defined in ES module scope` → worker 进程秒崩。

   - 复现：`node worker_host.js '{}'`（cwd = 任意 miniapp 实例目录）→ 立即崩溃。
   - 对照：`bun worker_host.js '{}'` → 正常输出 `{"id":"__ready",...}`。
   - 本仓库 `tools/probe-worker.cjs` 可一键复现两种运行时下的差异。

2. 运行时探测 `detect_runtime()`（bun 优先、node 兜底）依赖 PATH 上的**真实可执行
   bun**。npm 方式安装的 bun 在 PATH 上只有 `bun` / `bun.cmd` / `bun.ps1` 壳脚本
   （真身 `%APPDATA%\npm\node_modules\bun\bin\bun.exe` 默认不在 PATH）→
   `which::which("bun")` 命中无扩展名壳脚本、`--version` 探测失败 → 回落到
   Node → 走第 1 条的崩溃路径。

3. JsWorkerPool 复用 worker 条目不查活（BitFun 已知行为）：已崩的 worker 仍被
   写入 stdin → 后续调用要么 330s 超时（`node.timeout_ms`），要么 `os error 232`
   （管道已关闭）。两个错误与症状第 2 条完全对应。

4. 对 loopx-console 的连锁反应：所有 `app.call('loopx.*')` 失败 → UI detect
   的 catch 分支 → 误显示「未找到 loopx」+ 安装按钮；安装点击直接报错。

影响面：**所有 `permissions.node.enabled = true` 的 MiniApp**（含 BitFun 内置
app 与第三方本地导入 app）在「只有 Node、无 bun」的机器上都受影响。市场版
（`node.enabled = false`、`miniapp_host_call` 直通）不受影响。

## 4. 修复方案

### 方案 A（推荐）：worker_host 改为 `.cjs` 扩展名

`.cjs` 扩展名强制 CommonJS，与任何 package.json 的 `"type"` 无关；Node 全版本、
bun 均支持；零运行时行为变化。

改动清单（全部在 BitFun 仓库）：

1. 重命名
   `git mv src/apps/desktop/resources/worker_host.js src/apps/desktop/resources/worker_host.cjs`
2. `src/apps/desktop/src/api/app_state.rs`
   - `resolve_worker_host_path()` 的六组候选路径（约 520-561 行）中
     `worker_host.js` → `worker_host.cjs`；
   - 初始化错误文案（约 180-200 行）中 `worker_host.js` → `worker_host.cjs`。
3. `src/apps/desktop/tauri.conf.json`（第 22 行）resources 映射：
   `"resources/worker_host.cjs": "resources/worker_host.cjs"`
4. `src/apps/desktop/tauri.dev.conf.json`（第 21 行）：同上。
5. `scripts/desktop-tauri-build.test.mjs`（335-349 行）资源映射断言同步改名。
6. 文档性引用（可选、无功能影响）：`host_dispatch.rs` 注释、
   `MiniApp/Skills/miniapp-dev/SKILL.md`、两处 Demo README 中的文件名。

### 方案 B（备选）：Node 运行时追加实验 flag

`JsWorker::spawn`（`src/crates/services/services-integrations/src/miniapp/worker.rs`）
中，仅当 `runtime.kind == RuntimeKind::Node` 时在命令行加
`--experimental-default-type=commonjs`。单文件改动，但要求 Node ≥ 20.10，更老
的 Node 依旧崩溃，且依赖实验性 flag。

### 方案 C（备选）：resources 目录加 package.json

新增 `src/apps/desktop/resources/package.json` = `{"type":"commonjs"}`，并在两处
tauri conf 的 resources 映射中打包该文件。同样全版本通用，但打包面多一个文件。

**推荐 A**：改动最小、全 Node 版本通用、无实验 flag。

## 5. 验证步骤

1. 重建：`cargo build -p bitfun-desktop`（增量，或 `pnpm run desktop:dev`）。
2. 重启后打开 LoopX Console 本地版：
   - 实例目录出现 `debug-worker.log`（worker.js 已加载）——关键判据；
   - 横幅消失（detect 找到 loopx），「一键安装 loopx」按钮隐藏；
   - 看板正常加载目标列表。
3. 反证：`node <resources>/worker_host.cjs '{}'`（cwd = 实例目录）→ 输出
   `{"id":"__ready",...}`，不再崩溃。

## 6. 顺带建议（本提案范围外）

worker 池对复用条目做存活检测（ready 握手 / stdin 写失败即重建条目），根治
`os error 232` 陈旧条目问题——本次修复只是让「秒崩」不再发生，陈旧条目复用
仍是一个独立的潜在缺陷。

## 7. 对 loopx-console 的影响

- 宿主修复前：本地版在「无 bun 的 Node 机器」上不可用；市场版不受影响
  （可作为临时绕行路径：市场版完全页面内桥接，无 Node worker）。
- 宿主修复后：本仓库无需任何改动。
- 复现工具：`tools/probe-worker.cjs`（node 崩 / bun 正常，一条命令即可验证）。
