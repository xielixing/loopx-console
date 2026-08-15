# LoopX Console (BitFun MiniApp)

**把 [LoopX](https://github.com/huangruiteng/loopx) 接入 BitFun 的控制台小程序**：
宿主心跳驱动、自适应轮询间隔、GitHub issue 录入、BitFun 宿主 Agent 执行 turn、
显眼的 gate 审批。

> 本仓库与 BitFun 完全独立：**不修改任何 BitFun 代码**。BitFun 通过
> 「从文件夹导入」把本仓库当作一个自包含的第三方 MiniApp 安装进去。

## 架构一句话

loopx 本身没有调度器——由本小程序持有定时器，每次心跳询问 loopx
"现在该不该跑"（`quota should-run --runtime-profile outer_controller
--include-scheduler-detail`），并按返回的 `scheduler_hint` 调整下一次唤醒
间隔。执行由 BitFun 宿主 Agent 完成（`app.agent.run`），worker 用
`heartbeat-prompt --compact` 生成任务体。

## 输入契约（唯一开放场景：持续修复 GitHub Issue）

输入框只接受三种链接，**其它输入一律拒绝且不创建任何 goal**：

- `https://github.com/<owner>/<repo>/issues/<n>`（或 `/pull/<n>`）→ 单问题修复
- `https://github.com/<owner>/<repo>` → 展开全部 open issues 供勾选
- `https://github.com/<owner>/<repo>/issues`（可带 `?q=`）→ 同上

链接后可附加修复要求文本。自由目标、非 GitHub 链接、GitHub 其它页面
（/pulls、/releases、/tree/… 等）都会被明确拒绝并提示原因。
完整契约（分类规则、错误码、创建流程、双层强制）见
[docs/product-spec.md](docs/product-spec.md)。

## 前置条件

1. **loopx CLI 可用**（loopx 未发布到 PyPI）：

   ```bash
   git clone https://github.com/huangruiteng/loopx.git
   cd loopx && pip install -e .
   loopx --version   # 输出 loopx x.y.z 即成功
   ```

   worker 会按序探测 `loopx` → `python -m loopx.cli` → `py -3 -m loopx.cli`，
   也可在小程序设置里填 loopx 源码目录走 `PYTHONPATH` 兜底。
2. **Bun 或 Node.js**（BitFun worker 运行时）。
3. 至少一个 loopx registry：全局 `~/.codex/loopx/registry.global.json`，
   或项目下的 `.loopx/registry.json`（在工具栏选择项目目录）。

## 安装（BitFun 从文件夹导入）

1. 下载最新 Release 的 `loopx-console-*.zip` 并解压，或直接 clone 本仓库。
2. BitFun → 小应用画廊 → 「从文件夹导入」。
3. 选择包含 `meta.json` 的那层目录（本仓库根目录）。
4. 导入即编译；画廊打开 "LoopX 控制台" 即可。

> 导入是**复制语义**：BitFun 会把当时目录内容拷进自己的数据目录。
> 之后本仓库的改动不会自动同步，更新时重新导入即可。

## 目录结构

| 路径 | 职责 |
|---|---|
| `source/ui.js` | 心跳状态机（单 setTimeout 链）、看板渲染、输入框 intake（GitHub issue/仓库/列表 → 确认单）、宿主 Agent turn 执行（`app.agent.run` + `agent:event`）、auto-run 熔断、gate 审批、i18n |
| `source/worker.js` | loopx CLI 封装（`child_process.spawn`，非 shell）：探测、`quota status`/`should-run`、GitHub open issues 匿名枚举、taskIntake、turnPrompt、todo list/complete |
| `source/index.html` / `style.css` | 看板骨架与主题（`--bitfun-*` 令牌，明暗自适应） |
| `meta.json` | 权限：shell(loopx/python/py)、fs 读 home、net(api.github.com)、node worker、系统通知、agent（宿主执行） |
| `packaging/loopx_launcher.py` | PyInstaller 入口（预留：将来若 BitFun 支持运行时随包分发时使用） |

两个针对 loopx 运行特性的处理（都是 MiniApp 内容，不涉及 BitFun 代码）：

- **心跳扫描根**：loopx `quota` 命令默认对 loopx 源码 checkout 做 public-boundary
  扫描（冷缓存下 60s+），worker 把 `--scan-root` 指向一个专用小目录，心跳
  秒级返回。
- **超时**：`quota status/should-run` 与 `heartbeat-prompt` 使用 180s 超时
  （`meta.json` 的 node worker 超时为 330s）。

## 发版

推 `v*` tag 即可：GitHub Actions 会把仓库打成 `loopx-console-<tag>.zip`
（含 `meta.json`、`package.json`、`README.md`、`source/`）并作为 Release 资产。
用户下载解压后从文件夹导入。

```bash
git tag v3.0.1 && git push origin v3.0.1
```

## 独立冒烟测试（脱离 BitFun）

```bash
cd <本目录>
node -e "global.rpcEmit=()=>{}; const w=require('./source/worker.js'); (async()=>{ console.log(await w['loopx.detect']({})); const g=await w['loopx.listGoals']({}); console.log(g.registryPath, g.goals.length); if(g.goals[0]) console.log(await w['loopx.shouldRun']({goalId:g.goals[0].goalId})); })()"
```

最后一行会真实跑一次 `quota should-run`，确认 flag、编码与 `scheduler_hint`
解析端到端可用（这正是心跳的主命令）。

## 与官方市场的兼容性说明

BitFun 官方 MiniApp 市场（`market.openbitfun.com`）对第三方包有严格安全约束：
禁止 Node worker、禁止 shell 解释器、agent 工具仅白名单（只读网络工具）。
本小程序的"宿主 agent 修 issue + worker 驱动 loopx"模型与这些约束不兼容，
因此**当前版本以本地导入方式分发**。若要上市场，需要重构为无 worker +
`shell.exec` argv 模式，并接受执行能力收窄——那是一个独立的改造目标。
