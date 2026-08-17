# LoopX Console 产品规格（输入契约）

版本：v1.2（方向 C：自动克隆 + 同仓库复用） · 适用：loopx-console 全部发布形态（源码导入分发）。

## 1. 产品定位

LoopX Console 是**「GitHub Issue 持续修复」控制台**，而不是通用目标管理台。

- 唯一开放的用户场景：把 GitHub Issue 交给 BitFun 宿主 Agent 持续修复
  （创建 goal → 心跳调度 → turn 执行 → gate 审批 → 直至全部 todo 完成）。
- 其它目标类型（自由目标、非修复类任务）**明确关闭**：不创建任何 goal，
  并给出具体原因。它们将来只能通过绑定具体 loopx capability 开放，且需要
  独立的产品评审。

## 1.1 仓库获取策略（方向 C）

任务绑定的本地仓库目录按以下顺序解析：

1. **同仓库复用（默认优先）**：已记录的项目/克隆目录（`projectByGoal`）里
   存在该仓库的 checkout 时直接复用（`reuseDir`），不再重复克隆；确认单
   展示「无需重新克隆」。单个 issue 默认「追加」到该仓库进行中的任务
   （guide 模式），也可以新建任务。
2. **自动克隆（默认）**：没有可复用的 checkout 时，目标仓库被克隆到**稳定的
   用户级缓存**（`~/.bitfun/loopx-console/repos/<owner>-<repo>`），goal 绑定
   该克隆；克隆有进度显示（接收对象百分比），已完成仓库走缓存。该目录不在
   小应用实例内——删除/重新导入小应用后缓存仍在，同一仓库的后续任务直接
   复用（不再重新克隆）。GitHub 校验失败（仓库不存在/网络错误）在确认单
   之前就拒绝。
3. **本地 checkout（高级选项）**：设置里选择项目目录后，任务优先绑定该
   目录；链接指向**其它仓库**时不再硬拒绝——控制台自动回退到 1/2
   （复用或克隆独立目录）并提示，本地 checkout 绑定保持不变。

- 目标目录按 goal 记录（`projectByGoal`），心跳/turn/审批命令各自使用
  所属 goal 的目录；看板聚合所有注册表（全局 + 每个项目/克隆目录）。
- 克隆在**完整克隆**（非浅克隆）——修复类 agent 需要完整历史；缓存命中时
  直接复用。未来可加"浅克隆"选项。

## 2. 输入契约（严格白名单）

支持以下三种 GitHub 链接形态；链接之后可以附加一段修复要求文本
（作为任务前言写入 objective）：

| 形态 | 语法 | 行为 |
|---|---|---|
| 单个 Issue | `https://github.com/<owner>/<repo>/issues/<n>` | 走完整 `issue-fix workflow-plan`，生成有序 todos |
| 单个 PR | `https://github.com/<owner>/<repo>/pull/<n>` | 同 Issue（GitHub API 视 PR 为 issue） |
| 仓库首页 | `https://github.com/<owner>/<repo>`（仅根路径；尾 `/` 与 query 忽略） | 展开全部 open issues → 确认单勾选 → 批量修复 |
| Issues 列表 | `https://github.com/<owner>/<repo>/issues`（可带 `?q=` 过滤） | 同上 |

拒绝（**不创建任何 goal**，返回结构化错误码）：

| 输入 | 错误码 |
|---|---|
| 自由文本、非 github.com 链接、空输入 | `unsupported_input` |
| github.com 的其它路径（org 首页、`/settings`、`/pulls`、`/releases`、`/tree/…`、`/issues/new`、`/wiki`、commit、search、对比页等） | `unsupported_github_path`（附带被拒 URL） |
| 一个任务里出现多个不同仓库 | `multiple_repositories` |
| 目标仓库 ≠ 所选本地 checkout 的 GitHub remote | `repository_mismatch`（UI 层回退到复用/自动克隆流程，见 §1.1） |
| 所选目录不是该仓库的本地 checkout（无 GitHub remote） | `repository_unverified` |
| GitHub 上不存在该仓库 | `repository_not_found` |
| GitHub 校验请求失败（网络/限流） | `repository_lookup_failed` |
| 仓库/列表展开后没有 open issues | 前端提示（`intakeNoIssues`），不创建 |

## 3. 创建流程

1. 输入 → 客户端即时分类（输入框 badge：Issue / N 个 Issue / 整仓 Issues）。
2. 提交 → `loopx.resolveIntake`（只读：分类 + 展开 issues 列表 + 仓库绑定校验；
   未选 checkout 时校验 GitHub 仓库存在性并标记 `autoClone`；已记录的
   项目目录命中同仓库时返回 `reuseDir`）。
3. 确认单（唯一刻意停顿）：多 issue 勾选（默认全选、截断标注）；存在**同仓库**
   进行中任务时可选「新建任务」或「引导现有任务」（单个 issue 默认引导/追加）；
   复用模式下展示「无需重新克隆」说明。
4. `loopx.taskIntake`（事件驱动）：`clone`（自动克隆时，带百分比进度）→
   bootstrap → register → plan/todos → refresh → 完成。
5. 完成后记录 goal 的仓库目录（`projectByGoal`），看板与心跳使用它；
   auto-run 接管。

## 3.1 停止 / 恢复语义

- **停止任务**（任务抽屉内）＝完整停止：取消进行中的 turn、关闭该目标的
  loopx 心跳监控（不再轮询）、关闭自动执行；状态持久化（`stoppedByGoal`），
  重启小应用后仍保持停止。恢复时还原此前的心跳与自动执行设置，并立即做
  一次轮询。
- **取消运行**＝只停止当前这一次 turn：取消后自动执行关闭（避免立刻重跑），
  心跳轮询继续，可手动再次执行。
- loopx 调度策略触发的「已停表」（unchanged ≥ limit → `stop_tick_loop`）
  是另一套机制：按 loopx 的 reset_token 变化自动恢复，抽屉内的「已暂停 ·
  点击恢复」只做一次立即轮询。

## 3.2 中途插话（人类干预）

任务运行期间，输入框支持自由文字：文字会被写入该任务的 **user-lane todo**
（`--role user --task-class user_action --bound-agent <agent>`，不是
user_gate——这是给 Agent 的指令，不是阻塞决策），loopx 将其作为该 agent
lane 的 post-response continuation 投递，Agent 下一步就会读到。

- 目标选择：优先当前在详情面板选中的任务；否则若只有一个任务在运行则
  直接发送；多个任务运行中时提示先点选目标任务。
- 发送后立即做一次轮询（force），自动执行会在下一步消费这条指令；
  活动流里记录「你：…」原文。

## 4. 双层强制

- **客户端**（ui.js）：`taskInputKind` / `firstUnsupportedGithubUrl` 即时反馈，
  不满足契约时提交被本地拦截，附带具体错误与示例。
- **Worker**（worker.js）：`githubReferences` 严格分类 + `resolveIntake` /
  `taskIntake` 双重守卫。独立调用者（绕过 UI）同样被拦。

两处实现共享同一份语法定义（本文件 §2），修改契约时必须同步两处与本文档。

## 5. 明确不做（Closed）

- 自由形式目标（等待绑定具体 loopx capability 后单独评审）
- 非 GitHub 仓库（GitLab/Gitee 等）
- org/用户主页、搜索、release、commit、diff、wiki 等页面链接
- 在应用内新建/编辑 issue（用户去 GitHub 建，回来贴链接）

## 6. 未来候选（不承诺）

- GitHub token → 自动提 PR（敏感凭证，独立设计：加密存储、权限声明、撤销）
- 浅克隆选项（大仓库加速）
- 按 capability 绑定的其它目标类型（需 loopx 侧能力 + 独立评审）
- 市场版（无 worker + `shell.exec` argv 重构，执行能力收窄）
- 运行时随包分发（loopx CLI 二进制捆绑）
