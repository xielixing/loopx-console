# bitfun-loopx —— BitFun 上的 LoopX 小程序

**贴一个 GitHub Issue 链接进来，它替你熬夜修；修到该发 PR 了，才把你叫起来拍板。**

底层驱动的是 [LoopX](https://github.com/huangruiteng/loopx)——给长任务 Agent「记账」的控制面 CLI：
目标、待办、门禁、额度它门儿清，但自己不设闹钟、不动手。本应用补上这两样：**心跳当闹钟，
BitFun 宿主 Agent 当手**，你只负责在它拿不定主意时拍板。

> 非官方出品：第三方封装，与 LoopX 项目无隶属或背书关系（见[合规](#与-loopx-的关系)）。
> 改名进行中：代码仓仍在 `xielixing/loopx-console`，应用显示名暂为「LoopX 控制台」。

## 现在能做什么，接下来接什么

当前只开了一个场景：**自动修 GitHub Issue**。LoopX 能力面更大，逐项对照：

| LoopX 能力 | 入口（LoopX 侧） | 本应用 |
|---|---|---|
| 目标生命周期 + 人工门禁 | `loopx status` / `start-goal` / `todo` | ✅ 看板、审批卡全靠它 |
| 心跳调度（quota） | `loopx quota should-run` | ✅ 心跳核心 |
| Issue / PR 自动修复 | `loopx issue-fix` | ✅ 唯一开放场景（主打） |
| 发布即 PR | 门禁 `external_pr_creation` | ✅ 批准后由本应用 fork→push→建 PR，标题带 `[bitfun-loopx]` |
| 定时报告 | `loopx periodic-report` | ⬜ |
| 内容运营 | `loopx content-ops` | ⬜ |
| 价值连接器 | `loopx value-connectors` | ⬜ |
| 探索图谱 | `loopx explore` | ⬜ |
| 自动研究 | `loopx auto-research` | ⬜ |
| ML 实验 | `loopx ml-experiment` | ⬜ |
| 基准评测 | `loopx benchmark` | ⬜ |
| 实验性上下文学习 | `loopx configure-goal --reward-memory-*` | ⬜ |
| 飞书看板投射 | `loopx lark-kanban` | ⬜ |
| 多智能体并行路由 | `loopx todo claim` | ⬜（现在只有 BitFun 宿主一个 Agent） |

✅ 已接入；⬜ LoopX 现成、还没接，即后续接入候选。

## 与 LoopX 的关系

**依赖**：不是 fork、不含源码。运行时 `spawn(['loopx', '--format', 'json', ...])` 调本机 CLI，
JSON 输出是唯一接口面——**不修改 loopx**，只在需要时读它的源码确认参数。

**获取**（没装也能用）：已装 CLI 直接用；没装 → 应用内一键拉源码到
`~/.bitfun/loopx-console/vendor/loopx`（固定 pin `v0.2.13`）`python -m loopx.cli` 直跑，
只要 **Python ≥ 3.11 + git**；都没有 → 横幅给 `pip install git+https://github.com/huangruiteng/loopx.git`。

**合规**：LoopX 是 [MIT](https://github.com/huangruiteng/loopx/blob/main/LICENSE)，本仓库不分发其
源码、不触发再分发义务；命名按 [TRADEMARKS.md](https://github.com/huangruiteng/loopx/blob/main/TRADEMARKS.md)
走描述性使用。将来若经 `packaging/loopx_launcher.py` 随包捆绑 loopx 二进制，须附其 LICENSE。

## 装进 BitFun

**前提**：装好 [BitFun](https://github.com/GCWing/BitFun)；本地版需 **Bun 或 Node** + git。

- **本地导入（默认，功能全）**：[Releases](https://github.com/xielixing/loopx-console/releases) 下
  `loopx-console-*.zip` 解压（或 clone 本仓库）→ BitFun 小应用画廊 →「从文件夹导入」→ 选含
  `meta.json` 的目录 → 打开「LoopX 控制台」。导入是复制语义，更新 = 删实例重新导入。
- **市场版（无 worker，页面内桥接）**：`market-v*` tag 产出 `loopx-console-market-*.zip`；
  牺牲流式进度与部分 CJK 显示，能否上官方市场仍在等 BitFun 侧评估
  （[docs/market-proposal.md](docs/market-proposal.md)）。目前以本地导入为准。

**第一次用**：顶栏「GitHub 设置」配凭据（一键 `gh auth login` 或贴 PAT，只存本机）→ 贴 issue
链接 → 确认入库 → 自动克隆目标仓库（或绑本地 checkout）→ 心跳接管：该修就修，loopx 喊停就
把卡片摆到「等你处理」。

## 怎么工作的

loopx 没有调度器，本应用持 setTimeout 链：每次心跳问 loopx「该不该跑」
（`quota should-run --runtime-profile outer_controller`），按 `scheduler_hint` 调下一次间隔；
执行交给 BitFun 宿主 Agent（`app.agent.run`）。输入框只认三种链接，其余一律拒绝且不建目标：
单 issue（`/issues/<n>` 或 `/pull/<n>`）、仓库主页、issues 列表（可带 `?q=`）——链接后可附一句
修复要求。完整契约见 [docs/product-spec.md](docs/product-spec.md)。

## 几个「怪脾气」

- **打开即暂停**：旧任务一律回暂停，点「继续」才恢复，绝不偷偷续跑。
- **关了就是真停**：心跳全停、进行中 turn 被 cancel，不留后台残留。
- **发布即 PR**：批准后应用自己 fork→push→建 PR，Agent 不自行 push；PR 统一带
  `[bitfun-loopx]`（GitHub 搜 `"bitfun-loopx" in:title` 清点产出）。

## 开发与发版

```bash
git tag v3.9.30 && git push origin v3.9.30                # 本地版 zip
git tag market-v0.3.30 && git push origin market-v0.3.30  # 市场版 zip
```

改完 `source/` 先跑 `node tools/build-market.cjs` 再提交；改名后产物前缀变 `bitfun-loopx-*`。

## 相关链接

[LoopX](https://github.com/huangruiteng/loopx) · [BitFun](https://github.com/GCWing/BitFun) ·
[docs/product-spec.md](docs/product-spec.md) · [docs/market-proposal.md](docs/market-proposal.md)
