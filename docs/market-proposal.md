# LoopX Console 市场投稿方案（BitFun MiniApp Marketplace）

版本：v0.1（市场版 v1 已就绪） · 状态：待 BitFun 市场侧评估

## 1. 目标

用户下载 BitFun 后，从云端市场安装 LoopX Console，即可持续修复 GitHub Issues：
心跳调度、人工审批、中途插话，与本地导入版功能一致。

## 2. 市场版 v1 架构（已实现）

BitFun 市场严格运行时的能力边界（已核对宿主源码）：

- 禁止 Node/Bun worker（`permissions.node.enabled` 必须为 false，worker 代码必须为空）；
- 允许 `shell.exec`，但必须是**非空 argv 字符串数组**（禁止命令字符串）；
- **禁止一切解释器与 shell**：`sh/bash/zsh/fish/cmd/powershell/pwsh/python/python3/node/bun/deno/ruby/perl`；
- `net.fetch` 走宿主白名单（redirect 重校验、16MiB 响应上限）；
- `fs.*` 走权限作用域（本包：读 `{home}/{appdata}/{user-selected}`，写 `{appdata}`）。

市场版因此把整个 loopx 桥接层从 worker 移到**页面内**（`market/lx-module.js`），
只用 `app.shell.exec(['loopx', …])` / `app.shell.exec(['git', …])` / `app.fs.*` /
`app.net.fetch` 四个宿主原语，UI（`source/ui.js`）通过 `app.call('loopx.*')`
monkey-patch 复用同一份代码。产物由 `tools/build-market.cjs` 从主源码树生成。

- `shell.allow = ["loopx", "git"]`：`loopx` 是 pip 安装的 console-script 启动器
  （真实 PE 文件，非解释器）；`git` 用于自动克隆。
- 克隆缓存与本地版共用同一稳定目录 `~/.bitfun/loopx-console/repos`。
- loopx 本体**不随包分发**：未安装时横幅给出安装命令
  （`pip install git+https://github.com/huangruiteng/loopx.git`，用户在**自己的
  终端**执行——市场规则禁止页面内调用 pip/python）。

已知取舍（v1）：

- `shell.exec` 无流式输出：克隆进度退化为"正在克隆…"阶段提示；
- 宿主给子进程注入 `GIT_TERMINAL_PROMPT=0, LC_ALL=C`，无法设置 `PYTHONUTF8`；
  zh-CN Windows 上 loopx stdout 的 CJK 文本可能乱码（ASCII 键与 JSON 结构不受影响，
  受影响的字符串基本不进入用户可见文案）；
- 30s 默认超时；本包按调用显式传 `timeout`（最长 600s，克隆）。

## 3. 投稿前自检清单

- [x] `permissions.node.enabled = false`
- [x] `esm_dependencies`/`npm_dependencies` 为空
- [x] `source/worker.js` 为空模块（`module.exports = {}`）
- [x] 所有 `shell.exec` 均为 argv 数组；argv[0] basename 仅 `loopx` / `git`（非解释器）
- [x] `net.allow` 仅 `api.github.com` / `github.com`
- [x] `fs.read` 仅 `{appdata}/{user-selected}/{home}`，`fs.write` 仅 `{appdata}`
- [x] 通过 `node --check` 语法校验（`tools/build-market.cjs` 生成后运行）

## 4. 需要 BitFun 市场侧明确的事项（提案）

1. **agent 权限与工具白名单**：市场版依赖 `agent.enabled` + 宿主 Agent 执行
   `ExecCommand`/文件工具（驱动 loopx CLI 与仓库修改）。请确认市场包可用该能力，
   或给出市场版可用的 agent 工具白名单；若禁止 ExecCommand，本应用无法运行。
2. **shell.allow 的审批口径**：确认 `loopx`（pip console-script）与 `git` 可通过审核。
3. **市场版 v2：捆绑 loopx 二进制**（真·零安装，见 §5）。

## 5. 市场版 v2 提案（捆绑预编译 loopx）

目标：用户安装即用，无需自装 Python/loopx。

方案：发布流水线拉取 loopx 源码，用 PyInstaller/Nuitka 编译 per-platform 单文件
二进制（`loopx-win-x64.exe` / `loopx-macos-arm64` / `loopx-linux-x64`），随包分发，
`shell.exec` 指向包内二进制。

需要市场侧支持：

- **包体积上限**：预估 50–150MB/平台（Python 运行时），三平台打包体积更大；
  是否允许体积上限例外或资产按平台裁剪下载（按宿主平台只下载对应二进制）？
- **不透明二进制的审核政策**：能否接受"声明构建脚本 + 可复现构建（哈希可验）"
  的二进制资产，而不是源码审计？建议引入构建产物校验（如 GitHub Actions 构建、
  产物哈希公示）。
- **执行权限**：包内二进制的执行仍走 `shell.exec`；basename 白名单需覆盖包内
  二进制（建议按包的 asset 清单自动授信）。

如市场侧暂不接受捆绑二进制，v1（用户自装 loopx）即为发布形态。
