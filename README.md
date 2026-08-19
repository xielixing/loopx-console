# loopx-console

**把 [LoopX](https://github.com/huangruiteng/loopx) 装进 [BitFun](https://github.com/GCWing/BitFun) 的驾驶舱。**

粘贴一个 GitHub Issue 链接，它自己克隆仓库、自己修、修到要发 PR 了才把你叫起来点一下「批准」。
剩下的时间你可以去睡觉。

```
你贴链接 ──▶ loopx-console（本应用）──▶ LoopX CLI：目标/待办/门禁/额度的账本
                                        │
                                        ├─ 心跳当闹钟（quota should-run）
                                        └─ BitFun 宿主 Agent 当手（app.agent.run）
```

> 非官方出品：第三方封装，与 LoopX 项目无隶属或背书关系（见[合规说明](#与-loopx-的关系)）。

## 现在能做什么，接下来接什么

当前只开了一个场景：**自动修 GitHub Issue**。LoopX 的能力面远不止这些，逐项对照如下
（✅ = 已接入；⬜ = LoopX 现成、还没接，是后续候选）。

| LoopX 能力 | LoopX 侧入口 | 本应用 |
|---|---|---|
| 目标生命周期（创建/状态/归档/恢复） | `start-goal` / `status` / `archive-runtime` | ✅ 看板、删除、恢复全靠它 |
| 待办与人工门禁 | `todo add` / `todo list` / `todo complete` | ✅ 审批卡即门禁，批准即放行 |
| 心跳调度与配额 | `quota should-run`（outer_controller） | ✅ 自适应心跳核心 |
| Issue / PR 自动修复 | `issue-fix workflow-plan` | ✅ 唯一开放场景（主打） |
| 执行 turns | `heartbeat-prompt` | ✅ BitFun 宿主 Agent 代跑 |
| 发布即 PR | 门禁 `external_pr_creation` | ✅ 批准后自动 fork → push → 建 PR，标题带 `[bitfun-loopx]` |
| 多 Agent 注册 / 认领 | `register-agent` | ✅ 认领别的主机的目标 |
| 诊断 | `doctor` | ✅ `loopx.doctor` 直通 |
| 配额与就绪度面板 | `quota status` / `ready_score` | ⬜ |
| 基准评测 | `benchmark*` / `terminal_bench_adapter` | ⬜ |
| 探索图谱 | `explore*` | ⬜ |
| 自动研究与做梦 | `dreaming` / `canary` | ⬜ |
| 多智能体并行 | `multi_agent` / `task_lease` | ⬜（目前只有一个 BitFun 宿主 Agent） |
| 飞书连接器 | `lark_inbox` / `lark_kanban` | ⬜ |
| PR 审查 | `pr_review` | ⬜（发布只管创建，评审待接） |
| slash commands / 终端 TUI | `slash_commands` / `starter*` | ⬜ |
| 历史与证据账本 | `history` / `evidence_log` | ⬜ |
| 宿主模式计划 | `host_mode_plan` | ⬜ |

## 与 LoopX 的关系

**怎么依赖的**：不是 fork、不含源码、不改动 LoopX 一行。运行时
`spawn(['loopx', '--format', 'json', ...])` 调本机 CLI，JSON 输出是唯一接口面；
只在需要时读它的源码确认参数语义。

**没装 LoopX 也能用**（应用内自动解决）：

1. 本机已装 CLI（`pip install -e` 或 PATH 里有 `loopx`）→ 直接用；
2. 没装 → 应用内一键拉源码到 `~/.bitfun/loopx-console/vendor/loopx`（固定 pin
   `v0.2.13`，源码保留其 LICENSE），用 `python -m loopx.cli` 直跑——LoopX 零运行时
   依赖，只要 **Python ≥ 3.11 + git**；
3. 连 Python/git 都没有 → 横幅明确点名缺什么、给安装指引，不静默失败。

**合规**：

- LoopX 是 **MIT License**（© 2026 LoopX contributors），本仓库不分发其源码、
  不触发再分发义务；将来若随包捆绑二进制，会附其 LICENSE；
- 命名遵循 [TRADEMARKS.md](https://github.com/huangruiteng/loopx/blob/main/TRADEMARKS.md)
  的描述性使用：说明"基于 LoopX 构建"可以，但本应用与 LoopX 项目**无隶属、
  无背书关系**；
- BitFun 同样是 MIT（© 2026 CWing），本仓库只通过其公开桥 API 协作。

## 装进 BitFun

**前提**：装好 [BitFun](https://github.com/GCWing/BitFun)；本机有 Python 3.11+ 与
git（没有也行，应用会引导）。

1. 下载 [Releases](https://github.com/xielixing/loopx-console/releases) 里最新的
   `loopx-console-*.zip` 并解压（或 clone 本仓库）；
2. BitFun → 小应用画廊 →「从文件夹导入」→ 选含 `meta.json` 的目录；
3. 打开「LoopX Console」，第一次用点「GitHub 设置」：一键 `gh auth login`（自动装
   GitHub CLI、自动走系统代理、弹浏览器登录）或粘贴 Fine-grained PAT——凭据只存本机；
4. 粘贴 Issue 链接（单个、PR、仓库主页或 issues 列表都行）→ 确认入库 → 之后全自动。

更新 = 删掉旧实例重新导入（导入是复制语义）。

## 怎么工作的

- **心跳**：本应用持 setTimeout 链，每次问 LoopX「该不该跑」
  （`quota should-run --runtime-profile outer_controller`），按 `scheduler_hint`
  调整下次间隔；执行交给 BitFun 宿主 Agent。
- **门禁**：LoopX 的 user 泳道 todo 决定"要不要你拍板"；指引类 todo 不打扰你。
- **发布**：你点「批准并发布」，应用自己 fork → push → 建 PR（标题带
  `[bitfun-loopx]`，正文含 Fixes 绑定、原因/解决方案、涉及文件清单）；Agent 从不自行 push。

## 几个「怪脾气」

- **打开即暂停**：旧任务一律回到暂停，点「继续」才恢复，绝不偷偷续跑。
- **关了就是真停**：心跳全停、进行中 turn 被 cancel，不留后台残留。
- **图片保守**：Issue 描述带截图、而当前模型看不懂图时，确认单会先提醒你补充文字，
  不瞎猜着改。

## 开发与发版

```bash
# 本地版
git tag v3.9.30 && git push origin v3.9.30
# 市场版
git tag market-v0.3.30 && git push origin market-v0.3.30
```

改完 `source/` 先跑 `node tools/build-market.cjs` 再提交；提交前跑全
[AGENTS.md](AGENTS.md) §6 的验证命令（含 `node tests/regression-guards.cjs`）。

## 相关链接

[LoopX](https://github.com/huangruiteng/loopx) · [BitFun](https://github.com/GCWing/BitFun) ·
[产品规格](docs/product-spec.md) · [市场提案](docs/market-proposal.md) ·
[宿主提案：worker 修复](docs/bitfun-worker-host-cjs-proposal.md) ·
[宿主提案：模型能力字段](docs/bitfun-model-capability-proposal.md)
