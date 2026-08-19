# bitfun-loopx —— BitFun 上的 LoopX 小程序

**贴一个 GitHub Issue 链接进来，它替你熬夜修；修到该发 PR 了，才把你叫起来拍板。**

底层驱动的是 [LoopX](https://github.com/huangruiteng/loopx)——一个给长任务 Agent「记账」的控制面
CLI：目标、待办、门禁、额度，它记得门儿清，但它自己不设闹钟、也不动手干活。本应用就是给它补上这两样：
**心跳当闹钟，BitFun 宿主 Agent 当手**，你只负责在它拿不定主意的时候拍板。

> 非官方出品：bitfun-loopx 是第三方封装，与 LoopX 项目没有隶属、认证或背书关系。名称用法与合规细节见
> [与 LoopX 的关系](#与-loopx-的关系)。

## 现在能做什么，接下来接什么

当前只开放一个场景：**自动修 GitHub Issue**。LoopX 的能力面比这大得多，下表按 LoopX 仓库
（`docs/capabilities/` 与 CLI 入口）逐项对照：

| LoopX 能力 | 解决什么 | 入口（LoopX 侧） | 本应用 |
|---|---|---|---|
| 目标生命周期 + 人工门禁 | 长任务状态不丢；要人拍板的决定不沉进聊天记录 | `loopx status` / `start-goal` / `todo` | ✅ 看板、审批卡、issue 进度胶囊全靠它 |
| 心跳调度（quota） | 每轮先问「该不该跑」，省钱也防跑偏 | `loopx quota should-run` | ✅ 本应用的心跳核心 |
| Issue / PR 自动修复 | 把 issue 变成可解释的修复 + 受控 PR | `loopx issue-fix` | ✅ 唯一开放场景（主打） |
| 发布即 PR | 修复收尾：fork → 推分支 → 建 PR | 门禁 `external_pr_creation` | ✅ 批准后由本应用自己执行，PR 统一带 `[bitfun-loopx]` 前缀 |
| 定时报告 | 周期性项目报告（触发评估 + 合成） | `loopx periodic-report compose-run` | ⬜ |
| 内容运营 | 内容采集 → 选题 → 草稿 → 发布门禁 | `loopx content-ops` | ⬜ |
| 价值连接器 | 接外部公开数据源（先从 GitHub 元数据探测起步） | `loopx value-connectors` | ⬜ |
| 探索图谱 | 长调查记录成 node/edge/finding 图 | `loopx explore` | ⬜ |
| 自动研究 | 一个开放问题拉起多 Agent 研究 | `loopx auto-research` | ⬜ |
| ML 实验 | 假设 → 执行 → 评估的循环 | `loopx ml-experiment` | ⬜ |
| 基准评测 | 跑分、出账、发布评估 | `loopx benchmark` | ⬜ |
| 实验性上下文学习 | 按项目配置的 Reward Memory | `loopx configure-goal --reward-memory-*` | ⬜ |
| 飞书看板投射 | 把目标/门禁投到飞书多维表格 | `loopx lark-kanban` | ⬜ |
| 多智能体并行路由 | 多 Agent 认领待办不打架 | `loopx todo claim` / `multi_agent` | ⬜（现在只有 BitFun 宿主一个 Agent） |

✅ = 已接入；⬜ = LoopX 那边现成、本应用还没接。⬜ 的行就是后续的接入候选，优先级随需求定。

## 与 LoopX 的关系

**怎么依赖的**：不是 fork，不包含 LoopX 一行源码，也不是代码库依赖。运行时就是
`spawn(['loopx', '--format', 'json', ...])` 调你机器上装好的 CLI，把它吐的 JSON 当唯一接口面——
所以 LoopX 改语义会破坏本应用，**不修改 loopx**，只在需要时读它的源码确认参数。

获取优先级（没装过也能用）：

1. 本机已装 loopx CLI → 直接用（PATH 或绝对路径都行）。
2. 没装 → 应用里一键拉源码到 `~/.bitfun/loopx-console/vendor/loopx`（固定 pin `v0.2.13`，
   见 `source/worker.js` 的 `LOOPX_VENDOR_REF`），`python -m loopx.cli` + PYTHONPATH 直跑，
   不用 pip、不用全局安装。loopx 零运行时依赖，只要有 **Python ≥ 3.11** 和 **git**。
3. 连 Python/git 都没有 → 横幅点名缺什么，并给
   `pip install git+https://github.com/huangruiteng/loopx.git` 兜底（市场版无 vendor 路径，只有这条，
   得你自己在终端里跑——市场规则禁止页面内调 pip/python）。

**合规**：

- LoopX 是 [MIT License](https://github.com/huangruiteng/loopx/blob/main/LICENSE)
  （Copyright (c) 2026 LoopX contributors）。本仓库**不分发 LoopX 源码**（vendor 是运行时拉取到
  用户机器上），不触发 MIT 的再分发通知义务。
- 名称按 LoopX 的 [TRADEMARKS.md](https://github.com/huangruiteng/loopx/blob/main/TRADEMARKS.md)
  走**描述性使用**：主名以 BitFun 打头（bitfun-loopx），说清「与 LoopX 协同工作」，不声称官方、
  认证或背书；PR 前缀 `[bitfun-loopx]` 同源。
- 预留：`packaging/loopx_launcher.py` 是未来 PyInstaller 捆绑 loopx 二进制的实验入口——真到随包
  分发那天，必须把 LoopX 的 MIT LICENSE 与版权声明一并放进包里。

> 改名进行中：品牌叫 **bitfun-loopx**，代码仓目前仍在 `xielixing/loopx-console`，应用显示名暂仍为
> 「LoopX 控制台」，clone 地址与 Release 产物名以实际为准（见[发版](#发版)）。

## 装进 BitFun

**前提**：装好 [BitFun](https://github.com/GCWing/BitFun)；loopx CLI 可用（或愿意让应用首次打开时
一键拉取，见上）；本地完整版还需要 **Bun 或 Node**（BitFun 的 worker 运行时），git 顺手装上。

### 方式一：本地导入（默认，功能全）

1. 从 [Releases](https://github.com/xielixing/loopx-console/releases) 下载 `loopx-console-*.zip`
   解压，或直接 clone 本仓库。
2. 打开 BitFun → 小应用画廊 → **从文件夹导入**。
3. 选包含 `meta.json` 的那一层目录（仓库根目录）。
4. 导入即编译，画廊里打开 **LoopX 控制台**。

> 导入是复制语义：BitFun 把当时目录内容拷进自己的数据目录，之后仓库改动不会自动同步——
> 更新 = 删掉实例重新导入。

### 方式二：市场版（无 Node worker，页面内桥接）

推 `market-v*` tag 会产出 `loopx-console-market-*.zip`。市场版把 loopx 桥接整个挪进页面
（`market/lx-module.js`），只用宿主白名单原语（`shell.exec` 的 `loopx`/`git`、`fs`、`net.fetch`），
复用同一份 UI。代价：克隆进度没有流式（只能显示「正在克隆…」）、部分环境 CJK 可能乱码、shell
默认 30s 超时。能否上官方市场仍在等 BitFun 市场侧评估，方案见
[docs/market-proposal.md](docs/market-proposal.md)；在那之前，本地导入就是正路。

### 第一次用

1. 顶栏「GitHub 设置」配好凭据：一键 `gh auth login`（缺 gh 会经 winget 装），或贴 fine-grained
   PAT——只存本机应用存储，不写进 git config。
2. 输入框贴 issue 链接 → 确认单核对 → 入库。
3. 没选本地项目目录就自动克隆目标仓库（带进度，重复任务复用缓存）；选了本地 checkout 则直接绑定。
4. 心跳接管：该 Agent 跑就让 Agent 跑；loopx 喊停（比如要批准发 PR）就把卡片摆到「等你处理」。

## 怎么工作的

loopx 没有调度器。本应用持有一个 setTimeout 链：每次心跳问 loopx「现在该不该跑」
（`quota should-run --runtime-profile outer_controller --include-scheduler-detail`），按返回的
`scheduler_hint` 调下一次唤醒间隔——忙的时候盯得勤，闲的时候少烦 loopx。执行交给 BitFun 宿主
Agent（`app.agent.run`），任务体由 `heartbeat-prompt --compact` 生成。两个针对 loopx 习性的处理：
心跳 `--scan-root` 指向专用小目录（绕开它默认对源码树做 public-boundary 扫描、冷缓存 60s+ 的坑），
以及给 `quota` / `heartbeat-prompt` 上 180s 超时。

输入框只认三种链接，其余一律拒绝且不创建任何目标：

- `https://github.com/<owner>/<repo>/issues/<n>`（或 `/pull/<n>`）→ 单 issue 修复
- `https://github.com/<owner>/<repo>` → 展开全部 open issues 供勾选
- `https://github.com/<owner>/<repo>/issues`（可带 `?q=`）→ 同上

链接后可附一句修复要求。自由文本目标、非 GitHub 链接、GitHub 其它页面会被明确拒绝并告知原因。
完整契约（分类规则、错误码、创建流程）见 [docs/product-spec.md](docs/product-spec.md)。

## 几个设计上的「怪脾气」

- **打开即暂停**：每次打开控制台，既有任务一律回到暂停（自动执行已关），点卡片「继续」才恢复。
  开应用绝不偷偷续跑上次的任务。
- **关了就是真停**：控制台关闭时，心跳定时器全停、进行中的宿主 Agent turn 被 cancel。界面上
  「没有在运行」就是真的没有在运行，不留后台残留。
- **批准即放行**：你在门禁卡上批准后，任务自动恢复执行，不用再点「继续」。
- **发布即 PR**：发 PR 类门禁批准后，应用自己执行 fork → 推分支 → REST 建 PR，Agent 不自行 push。
  PR 标题统一带 `[bitfun-loopx]`，GitHub 搜 `"bitfun-loopx" in:title` 就能清点本工具的全部产出。

## 目录结构

| 路径 | 职责 |
|---|---|
| `source/` | 本地完整版：`ui.js`（心跳状态机、看板、输入、审批、i18n）+ `worker.js`（loopx CLI 封装）+ 页面 |
| `market/` | 市场版：`meta.json`（`node.enabled=false`）+ 空 `worker.js` + `lx-module.js`（页面内桥接），由 `tools/build-market.cjs` 从 `source/` 生成 |
| `docs/` | 产品规格、市场投稿提案、宿主提案 |
| `tests/` | 契约测试（输入分类、自动克隆守卫等） |
| `.github/workflows/` | `release.yml`（`v*` → 本地版 zip）、`market-release.yml`（`market-v*` → 市场版 zip） |

改完 `source/` 记得先跑 `node tools/build-market.cjs` 再提交（市场版产物要一起提交）。

## 发版

```bash
git tag v3.9.30 && git push origin v3.9.30                      # 本地版 → loopx-console-v3.9.30.zip
git tag market-v0.3.30 && git push origin market-v0.3.30        # 市场版 → loopx-console-market-v0.3.30.zip
```

推 tag 即打 Release。改名完成后，产物名前缀会跟着变成 `bitfun-loopx-*`。

## 独立冒烟测试（不启动 BitFun）

```bash
node -e "global.rpcEmit=()=>{}; const w=require('./source/worker.js'); (async()=>{ console.log(await w['loopx.detect']({})); const g=await w['loopx.listGoals']({}); console.log(g.registryPath, g.goals.length); if(g.goals[0]) console.log(await w['loopx.shouldRun']({goalId:g.goals[0].goalId})); })()"
```

这段脚本的最后一个表达式会真实跑一次 `quota should-run`——也就是心跳的主命令，确认 flag、编码与
`scheduler_hint` 解析端到端可用。

## 相关链接

- [LoopX](https://github.com/huangruiteng/loopx)——被接进来的控制面 CLI
- [BitFun](https://github.com/GCWing/BitFun)——宿主应用
- [docs/product-spec.md](docs/product-spec.md)——完整产品规格
- [docs/market-proposal.md](docs/market-proposal.md)——市场版投稿方案
