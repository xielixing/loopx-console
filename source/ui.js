// LoopX Console — UI + host heartbeat.
// The heartbeat is a single setTimeout chain armed to the earliest per-goal
// due time; each poll's interval is dictated by loopx's scheduler_hint
// (recommended interval, unchanged-poll backoff, max clamp, reset_token).
// Rendering is fingerprint-throttled: unchanged decisions repaint nothing but
// the 1s countdown, and re-renders are deferred while a card input has focus.

const app = window.app;

// Boot timeline: timestamps every startup step and the first renders so the
// "extra flash" on import can be attributed to a step (or to the host).
const BOOT_T0 = performance.now();
let BOOT_RENDER_COUNT = 0;
const bootMs = () => Math.round(performance.now() - BOOT_T0);
const themeProbe = () => String(getComputedStyle(document.documentElement).getPropertyValue('--bitfun-bg')).trim() || '(none)';

// Theme gate release (double failsafe for the inline script in index.html —
// some compilers relocate inline scripts, so the main bundle guarantees the
// page can never stay hidden): reveal when the host appearance vars are in,
// when the appearanceChange event arrives, or on a deadline.
const releaseThemeGate = () => { document.documentElement.style.visibility = 'visible'; };
if (themeProbe() !== '(none)') releaseThemeGate();
app.onAppearanceChange((payload) => {
  dbgUi('theme:applied', `t=${bootMs()}ms mode=${payload && payload.mode}`);
  releaseThemeGate();
});
setTimeout(releaseThemeGate, 800);

const I18N = {
  'zh-CN': {
    title: 'LoopX 控制台',
    refresh: '刷新目标列表',
    settings: '设置',
    retry: '重试',
    notFoundTitle: '未检测到 loopx CLI',
    notFoundHint: '请先安装 loopx：在系统终端执行 pip install git+https://github.com/huangruiteng/loopx.git（需要 Python 与 git），或点击重试。',
    logTitle: '心跳与执行日志',
    logFilterAll: '全部',
    logFilterErrors: '仅错误',
    monitor: '心跳监控（自动轮询）',
    agent: 'Agent',
    agentFree: '手动输入 agent id…',
    runOnce: '执行一次',
    resumeTask: '继续任务',
    resumeTaskHint: '继续该任务：恢复心跳监控与自动执行',
    stopTask: '中止任务',
    stopTaskHint: '中止该任务：取消本次运行、关闭心跳监控与自动执行',
    deleteTask: '删除任务',
    deleteTaskHint: '删除该任务：归档运行记录并移除注册表条目（注册表会先备份）',
    taskStopped: (id) => `任务 ${id} 已中止：心跳与自动执行已关闭`,
    taskResumed: (id) => `任务 ${id} 已继续：心跳与自动执行已重新开启`,
    taskDeleted: (id) => `任务 ${id} 已删除`,
    deleteTaskFailed: '删除失败',
    stopConfirmTitle: '中止这个任务？',
    stopConfirmText: (id) => `将取消「${id}」正在进行的运行，并关闭它的心跳监控与自动执行。任务会移入「已停表」，随时可以继续。`,
    confirmStop: '确认中止',
    stoppedState: '已停止 · 心跳与自动执行已关闭',
    deleteConfirmTitle: '删除这个任务？',
    deleteConfirmText: (id) => `将归档「${id}」的运行记录并从注册表移除（注册表文件会先备份）。看板将不再显示该任务。`,
    confirmDelete: '确认删除',
    nextPoll: (t) => `下次轮询 ${t}`,
    intervalMath: (iv, base, mult, n, cap) => `间隔 ${iv}m（基准 ${base}m ×${mult}^${n}，上限 ${cap}m）`,
    intervalPlain: (iv) => `间隔 ${iv}m`,
    retryIn: (n, t) => `↻ 轮询失败 ×${n} · ${t} 后重试`,
    waitingOn: (w) => `等待：${w}`,
    cancel: '取消',
    save: '保存',
    settingsNote: '仅当自动探测失败时才需要配置。',
    setPrefix: 'loopx 调用命令（JSON 数组，留空自动探测）',
    setSrcDir: 'loopx 源码目录（可选，探测失败时作为 PYTHONPATH 兜底）',
    needProject: '执行 run-once 需要先选择项目目录',
    needAgent: '该目标没有已注册的 agent，请先填写 agent id',
    detected: (v) => `已检测到 loopx：${v}`,
    copy: '复制',
    close: '关闭',
    raw: 'JSON',
    groupPaused: '已停表',
    groupError: '异常',
    colEmpty: '暂无',
    loadingGoals: '正在读取任务…',
    presenceLive: '心跳运行中',
    presencePaused: '心跳已暂停',
    presenceIdle: '心跳未启动',
    presenceNoCli: 'loopx 不可用',
    hbNext: (t) => `下次心跳 ${t}`,
    hbChecking: '正在检查…',
    runCancelled: '运行已取消',
    groupBacklog: '待处理',
    groupActive: '进行中',
    groupReview: '等你处理',
    colSubReview: '阻塞 · 需要你批准后继续',
    colSubActive: 'Agent 正在执行',
    detailEmptyHint: '点选「进行中」的条目查看任务详情与实时日志',
    groupDone: '已完成',
    detailOverview: '当前动作',
    detailStatus: '状态',
    detailControls: '执行设置',
    detailSchedule: '下次轮询',
    taskPlaceholder: '粘贴 GitHub Issue / 仓库 / Issues 列表链接，可附加修复要求；任务运行时可直接输入文字向 Agent 插话',
    taskGoalUnsupported: '请粘贴 GitHub Issue、PR、仓库首页或 Issues 列表链接（自由目标暂未开放）',
    taskUnsupportedPath: (u) => `不支持的 GitHub 链接：${u}。请粘贴 Issue、PR、仓库首页或 Issues 列表链接`,
    guidanceNoRunning: '没有正在运行的任务。粘贴 Issue 链接创建新任务，或等任务开始运行后再输入指令。',
    guidancePickOne: '有多个任务正在运行：请先在「进行中」点选目标任务，再发送指令。',
    guidanceSending: '正在发送指令…',
    guidanceSent: (id) => `指令已发送给任务 ${id}，Agent 将在下一步读取`,
    guidanceLine: (t) => `你：${t}`,
    taskCreate: '创建任务',
    taskCreating: '正在创建任务…',
    taskResolving: '正在识别任务类型…',
    taskPendingLabel: '正在创建',
    taskStageStarting: '任务已创建，正在启动 Agent',
    taskStarted: (id) => `任务 ${id} 已创建并开始执行`,
    stageExpand: '正在获取 issue 列表…',
    stageBootstrap: '正在创建 LoopX 任务…',
    stageRegister: '正在注册 Agent…',
    stagePlan: '正在解析 Issue 修复计划…',
    stageTodos: (c, t) => `正在写入 todos ${c}/${t}…`,
    stageRefresh: '正在刷新状态…',
    intakeTitleIssue: '确认修复这个 Issue',
    intakeTitleIssues: (n) => `确认修复 ${n} 个 Issues`,
    intakeTitleList: '选择要修复的 Issues',
    intakeTitleGoal: '确认新任务',
    intakeSummaryList: (repo, n) => `${repo} 现有 ${n} 个 open issues，默认全选。任务会逐个修复选中的 issue。`,
    intakeSummaryIssues: (repo) => `以下 issues 将写入同一个任务（${repo}），由 Agent 逐个修复。`,
    intakeSummaryGoal: '当前已有任务在进行中——选择新建，或把这段话作为引导写入现有任务。',
    intakeSelectAll: '全选',
    intakeSelectedCount: (n, m) => `已选 ${n}/${m}`,
    intakeTargetLabel: '写入到',
    intakeModeNew: '新建任务',
    intakeModeGuide: '引导现有任务',
    intakeConfirmNew: '创建任务',
    intakeConfirmIssues: (n) => `开始修复 ${n} 个 Issues`,
    intakeConfirmGuide: '写入现有任务',
    intakeNoneSelected: '至少选择一个 Issue',
    intakeNoIssues: '该仓库没有 open issues',
    guideStarted: (id) => `已写入引导，任务 ${id} 将按新指示继续`,
    gateCount: (n) => `等你处理 ${n} 项`,
    gateSectionTitle: '等你处理',
    gateLoading: '正在读取待审批事项…',
    approve: '批准 / 完成',
    approveTitle: '确认这项操作？',
    approveNote: '备注（可选，写入 todo 完成记录）',
    approveConfirm: '确认批准',
    approveDone: '已批准，任务将继续推进',
    approveFailed: (e) => `批准失败：${e}`,
    notifGateTitle: 'LoopX 需要你审批',
    notifGateBody: (id, n) => `${id} 有 ${n} 项等你处理`,
    autoRunLabel: '自动连续执行',
    autoRunNext: '自动执行下一轮',
    autoRunDisabled: (id) => `${id} 连续失败，已暂停自动执行`,
    activityTitle: '实时活动',
    activityStarting: '正在启动 Agent…',
    activitySentPrompt: (n) => `▶ 已向 Agent 发送指令（${n} 字符，点击展开）`,
    activityRunning: (elapsed) => `Agent 正在执行 · 已用时 ${elapsed}`,
    activityCommitted: 'LoopX 已提交本次执行结果',
    activityValidationPassed: '独立校验已通过',
    activityValidationFailed: '独立校验未通过',
    activityStateUpdated: '目标状态已更新',
    activityCompleted: '执行已完成',
    activityCompletedValidated: '执行已完成 · 校验通过',
    activityFailed: '执行失败',
    taskGoal: '普通目标',
    taskRepository: 'GitHub 仓库',
    taskIssue: 'GitHub Issue',
    taskIssues: (n) => `${n} 个 Issue`,
    taskIssuesList: '整仓 Issues',
    taskNeedProject: '请先选择这个任务对应的本地项目目录。',
    taskRepoNotFound: (repo) => `GitHub 上找不到仓库：${repo}。请检查链接拼写。`,
    taskRepoLookupFailed: '无法访问 GitHub 校验仓库，请稍后重试。',
    stageClone: '正在克隆仓库…',
    stageClonePercent: (p) => `正在克隆仓库… ${p}%`,
    intakeCloneNote: (repo) => `将自动克隆 ${repo} 到小应用数据目录并开始修复（无需本地 checkout）。`,
    intakeReuseNote: (repo) => `已找到 ${repo} 的本地 checkout，无需重新克隆。`,
    taskCloneOtherRepo: (expected, actual) => `本地目录绑定的是 ${actual}；将把 ${expected} 克隆到独立目录处理。`,
    composerModelTitle: '新任务执行模型',
    openRepoDir: '打开仓库目录',
    otherTasksTitle: '本机其它 loopx 任务',
    otherTasksHint: '非本控制台创建，默认不监控。接管后进入看板并开始心跳轮询。',
    adopt: '接管',
    adoptedLabel: '已接管',
    adoptFailed: (e) => `接管失败：${e}`,
    setModel: '执行模型（长程任务的默认值；每个任务可在详情里单独覆盖）',
    modelAuto: '自动（跟随 BitFun 策略）',
    modelPrimaryTag: '主模型',
    modelFollowGlobal: '跟随全局默认',
    detailModel: '执行模型',
    modelChanged: (m) => `执行模型已切换为 ${m}`,
    settingsProjectDir: '本地项目目录（可选 · 高级：修复你自己的 checkout，而不是自动克隆）',
    projectDirNone: '未设置（默认自动克隆到小应用数据目录）',
    chooseProjectDir: '选择',
    clearProjectDir: '清除',
    taskNeedAgent: '请先在设置中配置新任务默认 Agent。',
    taskCreated: (id) => `任务 ${id} 已创建`,
    taskRepoMismatch: (expected, actual) => `链接指向 ${expected}，当前项目是 ${actual}。请切换到正确的本地 checkout。`,
    taskMultipleRepos: '一个任务只能绑定一个本地仓库，请把不同仓库的链接拆成多个任务。',
    taskRepoUnverified: (repo) => `选择的目录不是 ${repo} 的本地 checkout（未找到 GitHub remote）。请先选择正确的仓库目录。`,
    taskPartial: (id, n, e) => `任务 ${id} 已创建，但只写入了 ${n} 个 todos：${e}`,
    intakeTruncated: (n) => `（仅显示前 ${n} 个，列表未取全）`,
  },
  'en-US': {
    title: 'LoopX Console',
    refresh: 'Refresh goals',
    settings: 'Settings',
    retry: 'Retry',
    notFoundTitle: 'loopx CLI not found',
    notFoundHint: 'Install loopx first: run pip install git+https://github.com/huangruiteng/loopx.git in your own terminal (requires Python and git), or retry.',
    logTitle: 'Heartbeat & execution log',
    logFilterAll: 'All',
    logFilterErrors: 'Errors only',
    monitor: 'Heartbeat monitoring (auto-poll)',
    agent: 'Agent',
    agentFree: 'Type agent id…',
    runOnce: 'Run once',
    resumeTask: 'Resume task',
    resumeTaskHint: 'Resume this task: restore heartbeat and auto-run',
    stopTask: 'Abort task',
    stopTaskHint: 'Abort this task: cancel the current run, disable heartbeat and auto-run',
    deleteTask: 'Delete task',
    deleteTaskHint: 'Delete this task: archive its runtime and remove the registry entry (the registry is backed up first)',
    taskStopped: (id) => `Task ${id} aborted: heartbeat and auto-run disabled`,
    taskResumed: (id) => `Task ${id} resumed: heartbeat and auto-run re-enabled`,
    taskDeleted: (id) => `Task ${id} deleted`,
    deleteTaskFailed: 'Delete failed',
    stopConfirmTitle: 'Abort this task?',
    stopConfirmText: (id) => `This cancels the running turn of "${id}", switches off its heartbeat monitoring and auto-run. The task moves to "Stopped" and can be resumed anytime.`,
    confirmStop: 'Abort it',
    stoppedState: 'Stopped · heartbeat and auto-run are off',
    deleteConfirmTitle: 'Delete this task?',
    deleteConfirmText: (id) => `This archives the runtime records of "${id}" and removes it from the registry (the registry file is backed up first). The task will no longer appear on the board.`,
    confirmDelete: 'Delete it',
    nextPoll: (t) => `next poll in ${t}`,
    intervalMath: (iv, base, mult, n, cap) => `every ${iv}m (base ${base}m ×${mult}^${n}, cap ${cap}m)`,
    intervalPlain: (iv) => `every ${iv}m`,
    retryIn: (n, t) => `↻ poll failed ×${n} · retry in ${t}`,
    waitingOn: (w) => `waiting on: ${w}`,
    cancel: 'Cancel',
    save: 'Save',
    settingsNote: 'Only needed when auto-detection fails.',
    setPrefix: 'loopx invocation (JSON array, empty = auto-detect)',
    setSrcDir: 'loopx source checkout (optional PYTHONPATH fallback)',
    needProject: 'Run-once requires a project directory',
    needAgent: 'This goal has no registered agent — type an agent id first',
    detected: (v) => `loopx detected: ${v}`,
    copy: 'Copy',
    close: 'Close',
    raw: 'JSON',
    groupPaused: 'Stopped',
    groupError: 'Errors',
    colEmpty: 'Nothing here',
    loadingGoals: 'Loading tasks…',
    presenceLive: 'Heartbeat live',
    presencePaused: 'Heartbeat paused',
    presenceIdle: 'Heartbeat idle',
    presenceNoCli: 'loopx unavailable',
    hbNext: (t) => `next tick in ${t}`,
    hbChecking: 'checking now…',
    runCancelled: 'run cancelled',
    groupBacklog: 'Queued',
    groupActive: 'In progress',
    groupReview: 'Needs you',
    colSubReview: 'Blocking · continues after your approval',
    colSubActive: 'The agent is working',
    detailEmptyHint: 'Select an entry in "In progress" to see its details and live log',
    groupDone: 'Done',
    detailOverview: 'Current action',
    detailStatus: 'Status',
    detailControls: 'Execution settings',
    detailSchedule: 'Next poll',
    taskPlaceholder: 'Paste a GitHub issue / repository / issues-list link, optionally with fix instructions; while a task runs, type free text to guide the agent',
    taskGoalUnsupported: 'Paste a GitHub issue, pull request, repository home, or issues-list link (free-form goals are not open yet)',
    taskUnsupportedPath: (u) => `Unsupported GitHub link: ${u}. Paste an issue, a pull request, the repository home, or its issues list.`,
    guidanceNoRunning: 'No task is running. Paste an issue link to create one, or wait until a task runs to send instructions.',
    guidancePickOne: 'Several tasks are running: select the target in "In progress" first, then send the instruction.',
    guidanceSending: 'Sending instruction…',
    guidanceSent: (id) => `Instruction sent to task ${id} — the agent reads it on its next step`,
    guidanceLine: (t) => `You: ${t}`,
    taskCreate: 'Create task',
    taskCreating: 'Creating task…',
    taskResolving: 'Detecting task type…',
    taskPendingLabel: 'Creating',
    taskStageStarting: 'Task created, starting the Agent',
    taskStarted: (id) => `Task ${id} created and started`,
    stageExpand: 'Fetching the issue list…',
    stageBootstrap: 'Creating the LoopX task…',
    stageRegister: 'Registering the Agent…',
    stagePlan: 'Planning the issue fix…',
    stageTodos: (c, t) => `Writing todos ${c}/${t}…`,
    stageRefresh: 'Refreshing state…',
    intakeTitleIssue: 'Fix this issue?',
    intakeTitleIssues: (n) => `Fix ${n} issues?`,
    intakeTitleList: 'Select issues to fix',
    intakeTitleGoal: 'Confirm new task',
    intakeSummaryList: (repo, n) => `${repo} has ${n} open issues — all selected by default. The task fixes the selected issues one by one.`,
    intakeSummaryIssues: (repo) => `These issues go into one task (${repo}); the agent fixes them one by one.`,
    intakeSummaryGoal: 'Tasks are already running — create a new one, or write this as guidance into an existing task.',
    intakeSelectAll: 'Select all',
    intakeSelectedCount: (n, m) => `${n}/${m} selected`,
    intakeTargetLabel: 'Write into',
    intakeModeNew: 'New task',
    intakeModeGuide: 'Guide an existing task',
    intakeConfirmNew: 'Create task',
    intakeConfirmIssues: (n) => `Start fixing ${n} issues`,
    intakeConfirmGuide: 'Write into existing task',
    intakeNoneSelected: 'Select at least one issue',
    intakeNoIssues: 'This repository has no open issues',
    guideStarted: (id) => `Guidance written — task ${id} will follow the new instructions`,
    gateCount: (n) => `${n} item${n > 1 ? 's' : ''} need you`,
    gateSectionTitle: 'Needs your decision',
    gateLoading: 'Loading pending approvals…',
    approve: 'Approve / complete',
    approveTitle: 'Confirm this action?',
    approveNote: 'Note (optional, recorded on the todo)',
    approveConfirm: 'Approve',
    approveDone: 'Approved — the task will continue',
    approveFailed: (e) => `Approval failed: ${e}`,
    notifGateTitle: 'LoopX needs your approval',
    notifGateBody: (id, n) => `${id} has ${n} item${n > 1 ? 's' : ''} waiting for you`,
    autoRunLabel: 'Auto-run turns',
    autoRunNext: 'Auto-running the next turn',
    autoRunDisabled: (id) => `${id} failed repeatedly — auto-run paused`,
    activityTitle: 'Live activity',
    activityStarting: 'Starting the Agent…',
    activitySentPrompt: (n) => `▶ Instructions sent to the agent (${n} chars, click to expand)`,
    activityRunning: (elapsed) => `Agent is working · ${elapsed} elapsed`,
    activityCommitted: 'LoopX committed this run',
    activityValidationPassed: 'Independent validation passed',
    activityValidationFailed: 'Independent validation failed',
    activityStateUpdated: 'Goal state updated',
    activityCompleted: 'Run completed',
    activityCompletedValidated: 'Run completed · validation passed',
    activityFailed: 'Run failed',
    taskGoal: 'Goal',
    taskRepository: 'GitHub repository',
    taskIssue: 'GitHub Issue',
    taskIssues: (n) => `${n} Issues`,
    taskIssuesList: 'All repo issues',
    taskNeedProject: 'Select the local project directory for this task first.',
    taskRepoNotFound: (repo) => `GitHub repository not found: ${repo}. Check the link spelling.`,
    taskRepoLookupFailed: 'Could not verify the repository on GitHub; try again later.',
    stageClone: 'Cloning repository…',
    stageClonePercent: (p) => `Cloning repository… ${p}%`,
    intakeCloneNote: (repo) => `${repo} will be cloned into the MiniApp data directory (no local checkout needed).`,
    intakeReuseNote: (repo) => `Found the local checkout of ${repo} — no re-cloning.`,
    taskCloneOtherRepo: (expected, actual) => `The local checkout is bound to ${actual}; ${expected} will be cloned into its own directory instead.`,
    composerModelTitle: 'Execution model for new tasks',
    openRepoDir: 'Open repository folder',
    otherTasksTitle: 'Other local loopx goals',
    otherTasksHint: 'Created by other loopx hosts; not monitored until adopted.',
    adopt: 'Adopt',
    adoptedLabel: 'Adopted',
    adoptFailed: (e) => `Adopt failed: ${e}`,
    setModel: 'Execution model (global default for long-running tasks; each task can override it in its details)',
    modelAuto: 'Auto (follow BitFun policy)',
    modelPrimaryTag: 'primary',
    modelFollowGlobal: 'Follow global default',
    detailModel: 'Execution model',
    modelChanged: (m) => `Execution model switched to ${m}`,
    settingsProjectDir: 'Local project directory (optional · advanced: fix your own checkout instead of auto-cloning)',
    projectDirNone: 'Not set (repositories are auto-cloned into the MiniApp data directory)',
    chooseProjectDir: 'Choose',
    clearProjectDir: 'Clear',
    taskNeedAgent: 'Configure the default Agent for new tasks in Settings first.',
    taskCreated: (id) => `Task ${id} created`,
    taskRepoMismatch: (expected, actual) => `The link targets ${expected}, but the current project is ${actual}. Select the matching local checkout.`,
    taskMultipleRepos: 'One task can bind only one local repository. Split links from different repositories into separate tasks.',
    taskRepoUnverified: (repo) => `The selected directory is not a checkout of ${repo} (no GitHub remote found). Pick the repository directory first.`,
    taskPartial: (id, n, e) => `Task ${id} was created, but only ${n} todos were written: ${e}`,
    intakeTruncated: (n) => `(showing the first ${n} — the list is incomplete)`,
  },
};

function t(key, ...args) {
  const table = {};
  for (const [loc, entries] of Object.entries(I18N)) table[loc] = entries[key];
  const v = app.t(table, I18N['en-US'][key]);
  return typeof v === 'function' ? v(...args) : v;
}

// ── state ─────────────────────────────────────────────────
const DEFAULT_INTERVAL_MIN = 1;
const ERROR_BACKOFF_CAP_MIN = 30;

const S = {
  config: {
    projectDir: null, argvPrefix: null, srcDir: '', agentByGoal: {}, monitorByGoal: {},
    projectByGoal: {}, ownedGoals: {}, defaultAgentId: 'bitfun-agent', autoRunByGoal: {},
    defaultModel: 'auto', modelByGoal: {},
    // Explicit user stops: stoppedByGoal persists the parked state across
    // restarts; autoRunBeforeStop remembers the auto-run setting to restore.
    stoppedByGoal: {}, autoRunBeforeStop: {},
  },
  detect: null,
  goals: new Map(), // goalId -> G
  bootLoading: true, // initial goals refresh in flight
  agentSessionByGoal: new Map(), // goalId -> host agent sessionId (context reuse)
  timer: null,
  countdownTimer: null,
  paused: false,
  renderPending: false,
  activeGoalId: null,
  intakeDraft: null,
  pendingIntake: null, // resolveIntake result awaiting sheet confirmation
  moreOpen: new Set(),
  logs: [],
};

// Direction C: a goal created by auto-clone binds to its own clone directory;
// goals bound to the user's selected checkout use the global setting.
function goalProjectDir(goalId) {
  return S.config.projectByGoal[goalId] || S.config.projectDir || null;
}

// v3.2: the board only manages goals this console created (bfx- prefix or an
// explicit adoption record). Goals created by other loopx hosts on this
// machine are shown separately and stay unmonitored until adopted.
function isOwnedGoal(goalId) {
  if (!goalId) return false;
  if (String(goalId).startsWith('bfx-')) return true;
  if (S.config.ownedGoals && S.config.ownedGoals[goalId]) return true;
  return false;
}

// All registries the board should aggregate: the selected checkout plus every
// clone directory recorded for created goals.
function projectRegistryDirs() {
  const dirs = [];
  if (S.config.projectDir) dirs.push(S.config.projectDir);
  for (const dir of Object.values(S.config.projectByGoal || {})) {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

// ── execution model selection ───────────────────────────────
// Long-running fixes let the user pick the host agent model per goal, with a
// global default in Settings. Values: 'auto' (follow the host policy) or a
// concrete model config id from the host's model list. The abstract
// 'primary'/'fast' slot labels are NOT shown: the host marks its primary
// model (isDefault) in the catalog, and listing slots next to the concrete
// models they resolve to just duplicates one model under several labels.
S.modelCatalog = [];
function modelForGoal(goalId) {
  return S.config.modelByGoal[goalId] || S.config.defaultModel || 'auto';
}

function fillModelSelect(select, currentValue, includeFollowGlobal) {
  select.replaceChildren();
  if (includeFollowGlobal) {
    const follow = document.createElement('option');
    follow.value = '';
    follow.textContent = t('modelFollowGlobal');
    select.appendChild(follow);
  }
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = t('modelAuto');
  auto.selected = currentValue === 'auto';
  select.appendChild(auto);
  // Legacy slot values ('primary'/'fast') migrate onto the host's primary
  // model id so a persisted config never dangles after the label cleanup.
  const primaryModel = (S.modelCatalog || []).find((m) => m && m.isDefault);
  let effective = currentValue;
  if (effective === 'primary' || effective === 'fast') {
    effective = primaryModel ? primaryModel.id : 'auto';
  }
  for (const model of S.modelCatalog || []) {
    if (!model || !model.id) continue;
    const option = document.createElement('option');
    option.value = model.id;
    const tag = model.isDefault === true ? ` · ${t('modelPrimaryTag')}` : '';
    option.textContent = `${model.name || model.id}${tag}`;
    option.selected = effective === model.id;
    select.appendChild(option);
  }
}

// The composer carries a compact copy of the model default (right where the
// user submits); Settings keeps the full row. Both stay in sync.
function syncComposerModel() {
  fillModelSelect(document.getElementById('composer-model'), S.config.defaultModel || 'auto', false);
}

function newGoalState(goalId, info) {
  return {
    goalId,
    objective: info.objective || null,
    agents: info.agents || [],
    agentId: S.config.agentByGoal[goalId] || (info.agents && info.agents[0]) || '',
    state: info.state || null,
    waitingOn: info.waitingOn ?? null,
    // v3.2: only owned goals poll by default; other-host goals stay quiet
    // until the user adopts them. An explicit user stop overrides ownership.
    monitoring: isOwnedGoal(goalId)
      ? (S.config.monitorByGoal[goalId] !== false && S.config.stoppedByGoal[goalId] !== true)
      : S.config.monitorByGoal[goalId] === true,
    userStopped: S.config.stoppedByGoal[goalId] === true,
    autoRun: S.config.autoRunByGoal[goalId] === true,
    autoFailCount: 0,
    intervalMin: DEFAULT_INTERVAL_MIN,
    nextDueAt: 0,
    unchangedCount: 0,
    errorCount: 0,
    lastError: null,
    lastResetToken: null,
    lastDecisionKey: null,
    hint: null,          // { base, mult, cap } for the interval-math line
    stopped: false,
    polling: false,
    repollQueued: false,
    running: false,
    runStartedAt: 0,
    lastRun: null,       // { exitCode, durationMs, status, ok, cancelled }
    last: null,          // normalized shouldRun result
    userTodos: null,     // open user-lane todos (gate approvals), null = not loaded
    userTodosAt: 0,
    userTodosLoading: false,
    wasGated: false,
    activityLines: [],
    currentActivity: '',
  };
}

// ── logging ───────────────────────────────────────────────
// ── debug trace (UI side) ──────────────────────────────────
// Written to <appdata>/debug-ui.log through the host fs bridge so host logs
// are not required for diagnosis.
const DEBUG_UI = [];
let DEBUG_UI_BUSY = false;
async function dbgUi(tag, detail) {
  const line = `${new Date().toISOString()} ${tag} ${detail || ''}`;
  DEBUG_UI.push(line);
  if (DEBUG_UI.length > 200) DEBUG_UI.shift();
  if (DEBUG_UI_BUSY || typeof app === 'undefined' || !app.appDataDir || !app.fs) return;
  DEBUG_UI_BUSY = true;
  try {
    await app.fs.writeFile(`${app.appDataDir}/debug-ui.log`, DEBUG_UI.join('\n'));
  } catch (_) {
    // The trace must never break the flow.
  } finally {
    DEBUG_UI_BUSY = false;
  }
}

// ── logging ───────────────────────────────────────────────
// The global log is a diagnostic surface, not a chat feed: the toolbar badge
// counts only errors, and the drawer defaults to an errors-only view so steady
// heartbeat chatter never greets the user as a growing number.
let logFilter = 'errors';

function renderLogBody() {
  const body = document.getElementById('log-body');
  body.replaceChildren();
  const lines = logFilter === 'errors' ? S.logs.filter((entry) => entry.isErr) : S.logs;
  for (const entry of lines) {
    const div = document.createElement('div');
    div.className = 'log-line' + (entry.isErr ? ' log-line--err' : '');
    const ts = document.createElement('span');
    ts.className = 't';
    ts.textContent = entry.time;
    div.appendChild(ts);
    div.appendChild(document.createTextNode(entry.msg));
    body.appendChild(div);
  }
  body.scrollTop = body.scrollHeight;
}

function log(msg, isErr = false) {
  const time = new Date().toTimeString().slice(0, 8);
  S.logs.push({ time, msg, isErr });
  if (S.logs.length > 500) S.logs.splice(0, S.logs.length - 500);
  const errors = S.logs.filter((entry) => entry.isErr).length;
  const count = document.getElementById('log-count');
  if (errors > 0) {
    count.textContent = String(errors);
    count.hidden = false;
  } else {
    count.hidden = true;
  }
  renderLogBody();
}

// ── config persistence ────────────────────────────────────
async function loadConfig() {
  try {
    const stored = await app.storage.get('config');
    if (stored && typeof stored === 'object') Object.assign(S.config, stored);
  } catch (_) {}
  // Execution moved to the host agent; drop persisted external-host settings.
  delete S.config.host;
  delete S.config.codexBin;
  delete S.config.hostCommandJson;
  delete S.config.validationCommandJson;
  delete S.config.timeoutSeconds;
  if (!S.config.defaultAgentId) {
    S.config.defaultAgentId = Object.values(S.config.agentByGoal || {}).find(Boolean) || 'bitfun-agent';
  }
}
async function saveConfig() {
  try { await app.storage.set('config', S.config); } catch (_) {}
}

// ── heartbeat scheduling ──────────────────────────────────
function rearmTimer() {
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  if (S.paused) return;
  let earliest = Infinity;
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && !g.polling && g.nextDueAt < earliest) earliest = g.nextDueAt;
  }
  if (earliest === Infinity) return;
  const delay = Math.max(0, earliest - Date.now());
  S.timer = setTimeout(onTimerFire, Math.min(delay, 2147000000));
}

function onTimerFire() {
  S.timer = null;
  const now = Date.now();
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && !g.polling && g.nextDueAt <= now) pollGoal(g);
  }
  rearmTimer();
}

function valueAtPath(obj, path) {
  return path.split('.').reduce((c, p) => (c && typeof c === 'object' ? c[p] : undefined), obj);
}

// Prefer the contract's unchanged_identity_keys over home-grown fields:
// free-text `reason` embeds live quota fractions and would defeat backoff.
function decisionKey(res) {
  const keys = res.scheduler?.unchangedIdentityKeys;
  if (keys && keys.length && res.raw) {
    return keys.map((k) => String(valueAtPath(res.raw, k))).join('|');
  }
  return [res.shouldRun, res.state, res.effectiveAction].map(String).join('|');
}

function applyPollError(g, message) {
  g.errorCount += 1;
  g.lastError = message;
  g.intervalMin = Math.min(Math.pow(2, g.errorCount), ERROR_BACKOFF_CAP_MIN);
  log(`[${g.goalId}] poll failed ×${g.errorCount}: ${message}`, true);
}

async function pollGoal(g) {
  if (g.polling) return;
  g.polling = true;
  requestRender();
  try {
    const res = await app.call('loopx.shouldRun', {
      argvPrefix: S.config.argvPrefix,
      projectDir: goalProjectDir(g.goalId),
      goalId: g.goalId,
      agentId: g.agentId || undefined,
    });
    if (res.raw) g.last = res; // keep partial payloads visible (reason, state)
    if (res.ok === false || res.error) {
      // CLI-level failure (bad exit / no JSON) is an error, not a decision.
      applyPollError(g, res.error || res.reason || 'loopx exited non-zero');
      return;
    }
    g.errorCount = 0;
    g.lastError = null;
    // shouldRun is authoritative for the gate: a cleared waiting_on (null)
    // must un-gate the goal rather than stick to the stale listGoals value.
    g.waitingOn = res.waitingOn ?? null;
    const sched = res.scheduler || {};
    const recommended = Number(sched.recommendedIntervalMinutes) || DEFAULT_INTERVAL_MIN;
    const maxIv = Number(sched.maxIntervalMinutes) || Math.max(recommended, 60);
    const backoff = Number(sched.backoffMultiplier) || 2;
    g.hint = { base: recommended, mult: backoff, cap: maxIv };
    const token = sched.resetToken || null;
    const key = decisionKey(res);

    if (token !== g.lastResetToken) {
      // loopx-side goal mutation → reset cadence to the fresh recommendation
      g.lastResetToken = token;
      g.intervalMin = recommended;
      g.unchangedCount = 0;
      g.stopped = false;
      log(`[${g.goalId}] reset_token changed → interval ${g.intervalMin}m`);
    } else if (key !== g.lastDecisionKey) {
      g.intervalMin = recommended;
      g.unchangedCount = 0;
      const reasonBrief = String(res.reason || '').slice(0, 160);
      log(`[${g.goalId}] decision changed (${res.state ?? '?'}/${res.shouldRun}) → interval ${g.intervalMin}m${reasonBrief ? ` · ${reasonBrief}` : ''}`);
    } else {
      g.unchangedCount += 1;
      g.intervalMin = Math.min(g.intervalMin * backoff, maxIv);
      const limit = sched.unchangedPollLimit;
      if (limit != null && g.unchangedCount >= limit && sched.afterLimit === 'stop_tick_loop') {
        g.stopped = true;
        log(`[${g.goalId}] unchanged ×${g.unchangedCount} ≥ limit → tick loop stopped`);
      }
      // Steady-state backoff steps are visible on the card's interval math
      // (intervalMath); logging every tick would flood the diagnostic log.
    }
    g.lastDecisionKey = key;
    g.intervalMin = Math.min(Math.max(g.intervalMin, recommended), maxIv);
  } catch (err) {
    applyPollError(g, String(err.message || err));
  } finally {
    g.nextDueAt = Date.now() + g.intervalMin * 60000;
    g.polling = false;
    // The goal may have been dropped/replaced mid-poll (project switch,
    // refreshGoals): an orphaned closure must not notify or launch anything.
    if (isLiveGoal(g)) {
      syncGateState(g);
      requestRender();
      rearmTimer();
      maybeAutoRun(g);
      if (g.repollQueued) {
        g.repollQueued = false;
        pollNow(g);
      }
    }
  }
}

function pollNow(g, { force = false } = {}) {
  if (g.polling) {
    // A poll is in flight; queue exactly one follow-up instead of silently
    // dropping the request (matters after run-once completes).
    g.repollQueued = true;
    return;
  }
  g.nextDueAt = 0;
  g.stopped = false;
  // force bypasses the visibility pause: a finished run must still get its
  // decision poll (which chains the next auto-run turn and fires gate
  // notifications) while the window is hidden — the exact moment the batch
  // and the "needs your approval" notification matter most.
  if (S.paused && !force) return; // due immediately once the heartbeat resumes
  pollGoal(g).then(rearmTimer);
}

// ── user gates (approvals) ────────────────────────────────
// A gated goal's concrete asks live in its user-lane todos. Load them lazily
// when a goal enters the review group, cache for 60s, and raise attention
// (system notification) exactly on the not-gated → gated edge.
async function refreshUserTodos(g, force = false) {
  if (g.userTodosLoading) return;
  if (!force && g.userTodos && Date.now() - g.userTodosAt < 60000) return;
  g.userTodosLoading = true;
  try {
    const res = await app.call('loopx.listTodos', {
      argvPrefix: S.config.argvPrefix,
      projectDir: goalProjectDir(g.goalId),
      goalId: g.goalId,
      role: 'user',
      status: 'open',
    });
    g.userTodos = res.ok ? res.todos : [];
    g.userTodosAt = Date.now();
  } catch (err) {
    log(`[${g.goalId}] listTodos error: ${err.message || err}`, true);
    if (!g.userTodos) g.userTodos = [];
  } finally {
    g.userTodosLoading = false;
    renderGoal(g);
  }
}

function notifyGate(g) {
  const count = (g.userTodos && g.userTodos.length) || 0;
  const ask = count && (g.userTodos[0].title || g.userTodos[0].text);
  const body = ask || t('notifGateBody', g.goalId, count || 1);
  try {
    if (app.notifications?.system) {
      app.notifications.system(t('notifGateTitle'), body);
    }
  } catch (_) {}
  log(`[${g.goalId}] ${t('notifGateBody', g.goalId, count || 1)}`, false);
}

function syncGateState(g) {
  const gated = isGated(g);
  if (gated) {
    if (!g.wasGated) {
      // Load the concrete asks first so the notification names the first one
      // instead of a generic "1 item".
      refreshUserTodos(g, true).then(() => { if (isLiveGoal(g)) notifyGate(g); });
    } else {
      refreshUserTodos(g);
    }
  } else {
    g.userTodos = null;
  }
  g.wasGated = gated;
}

async function approveTodo(g, todo, note, button) {
  if (button) button.disabled = true;
  try {
    const res = await app.call('loopx.completeTodo', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: goalProjectDir(g.goalId),
      goalId: g.goalId,
      todoId: todo.todo_id,
      note: note || null,
      // user_gate todos hard-require a decision outcome; other classes
      // reject the flag, so send it only where the CLI demands it.
      decisionOutcome: todo.task_class === 'user_gate' ? 'approve' : null,
    });
    if (!res.ok) throw new Error(res.error || 'todo complete failed');
    log(`[${g.goalId}] ${t('approveDone')} (${todo.todo_id})`);
    await refreshUserTodos(g, true);
    pollNow(g, { force: true }); // approval may clear the gate — re-decide immediately
    return true;
  } catch (err) {
    log(`[${g.goalId}] ${t('approveFailed', err.message || err)}`, true);
    if (button) button.disabled = false;
    return false;
  }
}

// ── auto-run ──────────────────────────────────────────────
// Composer-created tasks run continuously: whenever loopx says should_run and
// no gate is open, fire the next turn without asking. Three consecutive
// failures trip the breaker so a broken setup can't loop forever.
const AUTO_RUN_FAIL_LIMIT = 3;

// A goal object becomes an orphan when refreshGoals/project-switch replaces
// or drops it; async callbacks holding the old reference must go quiet.
function isLiveGoal(g) {
  return S.goals.get(g.goalId) === g;
}

function canAutoRun(g) {
  return g.autoRun && !g.running && isLiveGoal(g) && !isGated(g)
    // Only a FRESH successful decision may launch a turn — a failed poll
    // leaves g.last stale (or ok:false) and must never fire on it.
    && g.errorCount === 0 && g.last?.ok !== false
    && g.last?.shouldRun === true && g.autoFailCount < AUTO_RUN_FAIL_LIMIT
    && !!goalProjectDir(g.goalId) && !!g.agentId;
}

function maybeAutoRun(g) {
  if (!canAutoRun(g)) return;
  log(`[${g.goalId}] ${t('autoRunNext')}`);
  executeRunOnce(g).catch((err) => {
    log(`[${g.goalId}] auto-run error: ${err.message || err}`, true);
    g.running = false;
    renderGoal(g);
  });
}

function setAutoRun(g, enabled) {
  g.autoRun = enabled;
  g.autoFailCount = 0;
  S.config.autoRunByGoal[g.goalId] = enabled;
  saveConfig();
  if (enabled) maybeAutoRun(g);
}

// ── stop / resume task ────────────────────────────────────
// "停止任务" is a FULL stop, not a single-turn cancel: the in-flight run is
// cancelled, the loopx heartbeat (auto-poll) for this goal is switched off,
// auto-run is switched off, and the parked state persists across restarts.
// "取消运行" (cancelGoalRun) remains turn-scoped: it kills only the current
// run and prevents an immediate relaunch; polling continues.
async function stopGoalTask(g) {
  if (g.running) cancelGoalRun(g, null);
  S.config.autoRunBeforeStop[g.goalId] = g.autoRun === true;
  if (g.autoRun) setAutoRun(g, false);
  g.monitoring = false;
  S.config.monitorByGoal[g.goalId] = false;
  g.userStopped = true;
  S.config.stoppedByGoal[g.goalId] = true;
  await saveConfig();
  rearmTimer();
  log(t('taskStopped', g.goalId));
  recordGoalActivity(g, t('taskStopped', g.goalId));
  renderGoalDetails(g);
  renderAllGoals(true);
}

async function resumeGoalTask(g) {
  delete S.config.stoppedByGoal[g.goalId];
  g.userStopped = false;
  g.monitoring = true;
  S.config.monitorByGoal[g.goalId] = true;
  if (S.config.autoRunBeforeStop[g.goalId] === true) {
    g.autoRun = true;
    S.config.autoRunByGoal[g.goalId] = true;
  } else if (S.config.autoRunBeforeStop[g.goalId] === false) {
    g.autoRun = false;
    S.config.autoRunByGoal[g.goalId] = false;
  }
  delete S.config.autoRunBeforeStop[g.goalId];
  await saveConfig();
  log(t('taskResumed', g.goalId));
  recordGoalActivity(g, t('taskResumed', g.goalId));
  renderGoalDetails(g);
  pollNow(g); // immediate fresh decision; auto-run may launch from it
  renderAllGoals(true);
}

// ── pause / resume (lifecycle + visibility) ───────────────
function pauseHeartbeat() {
  if (S.paused) return;
  S.paused = true;
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  updateHeaderStatus();
}

function resumeHeartbeat() {
  if (!S.paused) return;
  S.paused = false;
  const now = Date.now();
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && g.nextDueAt <= now) pollGoal(g);
  }
  rearmTimer();
  updateHeaderStatus();
}

// ── rendering ─────────────────────────────────────────────
function isGated(g) {
  // After a successful poll, its waiting_on is authoritative (may be null);
  // before one, fall back to the listGoals snapshot. waiting_on=controller is
  // NOT a user gate: this console runs as scheduler_owner=outer_controller,
  // i.e. it IS the controller — auto-run should take that turn, not park the
  // goal in "needs you" with nothing approvable.
  const w = g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn;
  if (w === 'user') return true;
  const s = String(g.last?.state || g.state || '').toLowerCase();
  return /gate|user_action|operator/.test(s);
}

// The board mirrors an issue tracker, but attention comes first: ONLY the two
// things that deserve a column exist — work that needs the human (blocking)
// and work that is running. Queued goals are intentionally invisible (they
// surface the moment they run or need approval); terminal/stopped/error and
// other-host goals collapse into the quiet "more" chips footer.
const PRIMARY_GROUPS = ['review', 'active'];
const ARCHIVE_GROUPS = ['done', 'paused', 'error'];
const GROUP_I18N_KEY = {
  backlog: 'groupBacklog', active: 'groupActive', review: 'groupReview',
  done: 'groupDone', paused: 'groupPaused', error: 'groupError',
};
const GROUP_SUB_KEY = {
  review: 'colSubReview', active: 'colSubActive',
};

function isTerminal(g) {
  const state = String(g.last?.state || g.state || '').toLowerCase();
  return /(^|_)(terminal|completed|complete|done|cancelled|canceled|duplicate|merged|closed)(_|$)/.test(state)
    || state.includes('no_followup');
}

function goalGroup(g) {
  if (isTerminal(g)) return 'done';
  if (g.userStopped) return 'paused';
  if (g.errorCount > 0) return 'error';
  if (g.stopped) return 'paused';
  // A human gate outranks a running turn: an approval request must surface in
  // "needs you" the moment it opens, not hide behind "in progress".
  if (isGated(g)) return 'review';
  if (g.running) return 'active';
  return 'backlog';
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtInterval(iv) {
  return iv.toFixed(iv < 10 ? 1 : 0);
}

// Scheduler legibility: expose the interval arithmetic instead of a bare
// number, so "why hasn't it polled" is answerable from the card.
function goalMetaText(g) {
  const now = Date.now();
  if (g.polling) return '…';
  if (g.errorCount > 0) return t('retryIn', g.errorCount, fmtCountdown(g.nextDueAt - now));
  const cd = t('nextPoll', fmtCountdown(g.nextDueAt - now));
  if (g.hint && g.unchangedCount > 0) {
    return `${cd} · ${t('intervalMath', fmtInterval(g.intervalMin), fmtInterval(g.hint.base), g.hint.mult, g.unchangedCount, fmtInterval(g.hint.cap))}`;
  }
  return `${cd} · ${t('intervalPlain', fmtInterval(g.intervalMin))}`;
}

function showRawJson(g) {
  document.getElementById('raw-title').textContent = `${g.goalId} · ${t('raw')}`;
  document.getElementById('raw-body').textContent = g.last?.raw
    ? JSON.stringify(g.last.raw, null, 2)
    : JSON.stringify(g.last ?? {}, null, 2);
  document.getElementById('dlg-raw').showModal();
}

function renderGoal(_g) {
  renderAllGoals();
}

function goalNarration(g) {
  // Scheduler guidance (recommended_action / reason, e.g. "run a bounded
  // vision-gap replan…") is loopx-internal jargon — never surface it. The
  // board speaks in objectives, errors, and states; the raw reason stays in
  // the diagnostics log.
  return g.objective || g.lastError || g.last?.state || g.state || g.goalId || '';
}

// waiting_on values are loopx identifiers ('user', 'controller', …); translate
// the one that means the user instead of leaking raw ids into the UI.
function waitingLabel(w) {
  if (!w) return null;
  return String(w).toLowerCase() === 'user' ? t('groupReview') : String(w);
}

function activityText(line) {
  const text = String(line || '')
    .replace(/^\s*(?:\[[^\]]+\]\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function activityDisplayText(entry) {
  return entry.count > 1 ? `${entry.line} ×${entry.count}` : entry.line;
}

function activityLineElement(entry) {
  const row = document.createElement('div');
  row.className = 'activity-stream__line'
    + (entry.isErr ? ' activity-stream__line--err' : '')
    + (entry.kind ? ` activity-stream__line--${entry.kind}` : '');
  const time = document.createElement('span');
  time.className = 'activity-stream__time';
  time.textContent = entry.time;
  row.appendChild(time);
  if (entry.kind === 'prompt' && entry.raw) {
    // The instructions sent to the agent: collapsed by default, expandable.
    const details = document.createElement('details');
    details.className = 'activity-prompt';
    const summary = document.createElement('summary');
    summary.textContent = activityDisplayText(entry);
    const pre = document.createElement('pre');
    pre.textContent = entry.raw;
    details.append(summary, pre);
    row.appendChild(details);
  } else {
    const text = document.createElement('span');
    text.className = 'activity-stream__text';
    text.textContent = activityDisplayText(entry);
    row.appendChild(text);
  }
  return row;
}

function recordGoalActivity(g, line, isErr = false, kind = null, raw = null) {
  const summary = kind === 'agent' ? String(line).trim() : activityText(line);
  if (!summary) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const now = new Date().toTimeString().slice(0, 8);
  // Collapse back-to-back repeats (tool streams spam the same verb) into one
  // line with a multiplier instead of a wall of identical rows.
  const last = g.activityLines[g.activityLines.length - 1];
  if (last && !last.isErr && !isErr && !last.isTick && !last.kind && !kind
      && last.line === summary) {
    last.count = (last.count || 1) + 1;
    last.time = now;
    const stream = document.querySelector(`.activity-stream[data-goal="${CSS.escape(g.goalId)}"]`);
    if (stream && stream.lastElementChild) {
      const textEl = stream.lastElementChild.querySelector('.activity-stream__text');
      if (textEl) textEl.textContent = activityDisplayText(last);
      const timeEl = stream.lastElementChild.querySelector('.activity-stream__time');
      if (timeEl) timeEl.textContent = now;
    }
    g.currentActivity = summary;
    return;
  }
  const entry = { time: now, line: summary, isErr, count: 1, kind, raw };
  g.activityLines.push(entry);
  if (g.activityLines.length > 240) g.activityLines.splice(0, g.activityLines.length - 240);
  g.currentActivity = summary;

  const cardText = document.querySelector(`.goal__activity-text[data-goal="${CSS.escape(g.goalId)}"]`);
  if (cardText) cardText.textContent = summary;

  const stream = document.querySelector(`.activity-stream[data-goal="${CSS.escape(g.goalId)}"]`);
  if (stream) {
    const followTail = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 32;
    stream.appendChild(activityLineElement(entry));
    while (stream.children.length > 240) stream.removeChild(stream.firstChild);
    if (followTail) stream.scrollTop = stream.scrollHeight;
  } else {
    const panel = document.getElementById('goal-detail-panel');
    if (!panel.hidden && S.activeGoalId === g.goalId) renderGoalDetails(g);
  }
}

// The once-per-10s running clock is one LINE that updates in place, not a new
// row every tick — the stream stays readable while the card text stays live.
function setGoalActivityTick(g, text) {
  const summary = activityText(text);
  if (!summary) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const now = new Date().toTimeString().slice(0, 8);
  g.currentActivity = summary;
  const cardText = document.querySelector(`.goal__activity-text[data-goal="${CSS.escape(g.goalId)}"]`);
  if (cardText) cardText.textContent = summary;
  const last = g.activityLines[g.activityLines.length - 1];
  const stream = document.querySelector(`.activity-stream[data-goal="${CSS.escape(g.goalId)}"]`);
  if (last && last.isTick) {
    last.line = summary;
    last.time = now;
    if (stream && stream.lastElementChild) {
      const textEl = stream.lastElementChild.querySelector('.activity-stream__text');
      if (textEl) textEl.textContent = summary;
      const timeEl = stream.lastElementChild.querySelector('.activity-stream__time');
      if (timeEl) timeEl.textContent = now;
    }
    return;
  }
  const entry = { time: now, line: summary, isErr: false, count: 1, isTick: true };
  g.activityLines.push(entry);
  if (g.activityLines.length > 240) g.activityLines.splice(0, g.activityLines.length - 240);
  if (stream) {
    stream.appendChild(activityLineElement(entry));
    if (stream.scrollHeight - stream.scrollTop - stream.clientHeight < 32) {
      stream.scrollTop = stream.scrollHeight;
    }
  } else {
    const panel = document.getElementById('goal-detail-panel');
    if (!panel.hidden && S.activeGoalId === g.goalId) renderGoalDetails(g);
  }
}

// Intake draft as a pending directory row in the 进行中 rail; its stage line
// is patched in place by the taskIntake progress events.
function buildIntakeRow(draft) {
  const el = document.createElement('div');
  el.className = 'run-item run-item--pending';
  const dot = document.createElement('span');
  dot.className = 'dot dot--active';
  const meta = document.createElement('span');
  meta.className = 'run-item__meta';
  const id = document.createElement('span');
  id.className = 'run-item__id';
  id.textContent = t('taskPendingLabel');
  const text = document.createElement('span');
  text.className = 'run-item__text';
  text.textContent = draft.objective;
  meta.append(id, text);
  const stage = document.createElement('span');
  stage.className = 'goal__activity-text';
  stage.textContent = draft.stage;
  el.append(dot, meta, stage);
  return el;
}

// The 进行中 rail is a directory: one compact row per running goal. Clicking
// a row selects it and streams its log into the panel beside the rail.
function buildRunItem(g) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'run-item' + (S.activeGoalId === g.goalId ? ' is-selected' : '');
  el.setAttribute('aria-label', g.goalId);
  el.onclick = () => openGoalDetails(g);
  const dot = document.createElement('span');
  dot.className = 'dot dot--active';
  const meta = document.createElement('span');
  meta.className = 'run-item__meta';
  const id = document.createElement('span');
  id.className = 'run-item__id';
  id.textContent = g.goalId;
  const text = document.createElement('span');
  text.className = 'run-item__text';
  text.textContent = goalNarration(g);
  meta.append(id, text);
  el.append(dot, meta);
  return el;
}

// v3.2: goals created by other loopx hosts on this machine. Listed in a
// collapsed section; each row offers one-click adoption (register agent +
// start heartbeat). Execution turns still require a known project directory.
async function adoptGoal(g, btn) {
  if (btn) btn.disabled = true;
  const agentId = g.agents[0] || resolveDefaultAgent();
  try {
    const res = await app.call('loopx.adoptGoal', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: goalProjectDir(g.goalId) || S.config.projectDir,
      goalId: g.goalId,
      agentId,
    });
    if (!res.ok) throw new Error(res.error || 'adopt failed');
    S.config.ownedGoals[g.goalId] = true;
    S.config.agentByGoal[g.goalId] = agentId;
    S.config.monitorByGoal[g.goalId] = true;
    await saveConfig();
    g.agentId = agentId;
    g.monitoring = true;
    log(`[${g.goalId}] ${t('adoptedLabel')}`);
    renderAllGoals(true);
    pollNow(g);
  } catch (err) {
    log(`[${g.goalId}] ${t('adoptFailed', err.message || err)}`, true);
    if (btn) btn.disabled = false;
    renderAllGoals(true);
  }
}

function buildOtherGoalsRows(goals) {
  const body = document.createElement('div');
  body.className = 'board-more__rows';
  const hint = document.createElement('p');
  hint.className = 'board-more__hint';
  hint.textContent = t('otherTasksHint');
  body.appendChild(hint);
  for (const g of goals) {
    const row = document.createElement('div');
    row.className = 'other-tasks__row';
    const meta = document.createElement('div');
    meta.className = 'other-tasks__meta';
    const id = document.createElement('span');
    id.className = 'other-tasks__id';
    id.textContent = g.goalId;
    id.title = g.goalId;
    const narration = document.createElement('span');
    narration.className = 'other-tasks__text';
    narration.textContent = goalNarration(g);
    narration.title = goalNarration(g);
    meta.append(id, narration);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--small';
    btn.textContent = t('adopt');
    btn.onclick = () => adoptGoal(g, btn);
    row.append(meta, btn);
    body.appendChild(row);
  }
  return body;
}

function buildGoalCard(g, compact = false) {
  const group = goalGroup(g);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'goal' + (compact ? ' goal--terminal' : '')
    + (group === 'review' ? ' goal--gated' : '')
    + (S.activeGoalId === g.goalId ? ' is-selected' : '');
  el.id = `goal-${g.goalId}`;
  el.setAttribute('aria-label', g.goalId);
  el.onclick = () => openGoalDetails(g);

  const head = document.createElement('div');
  head.className = 'goal__head';
  const dot = document.createElement('span');
  dot.className = `dot dot--${group}`;
  head.appendChild(dot);
  const id = document.createElement('span');
  id.className = 'goal__id';
  id.textContent = g.goalId;
  head.appendChild(id);
  if (group === 'review') {
    const badge = document.createElement('span');
    badge.className = 'goal__gate-badge';
    // Real count once loaded; no phantom "1" while the todo list is pending.
    const n = g.userTodos ? g.userTodos.length : 0;
    badge.textContent = n > 0 ? t('gateCount', n) : t('groupReview');
    head.appendChild(badge);
  }
  el.appendChild(head);

  const narration = document.createElement('div');
  narration.className = 'goal__reason' + (g.lastError ? ' goal__reason--err' : '');
  narration.textContent = goalNarration(g);
  narration.title = goalNarration(g); // full text on hover, no scheduler jargon
  el.appendChild(narration);

  // A gated card leads with the concrete ask, not the generic narration.
  if (group === 'review' && g.userTodos && g.userTodos.length) {
    const ask = document.createElement('div');
    ask.className = 'goal__gate-ask';
    ask.textContent = g.userTodos[0].title || g.userTodos[0].text || '';
    el.appendChild(ask);
  }

  if (g.running || g.currentActivity) {
    const activity = document.createElement('div');
    activity.className = 'goal__activity' + (g.running ? ' goal__activity--live' : '');
    const pulse = document.createElement('span');
    pulse.className = 'goal__activity-dot';
    const text = document.createElement('span');
    text.className = 'goal__activity-text';
    text.dataset.goal = g.goalId;
    text.textContent = g.currentActivity || t('activityStarting');
    activity.append(pulse, text);
    el.appendChild(activity);
  }

  const meta = document.createElement('div');
  meta.className = 'goal__meta';
  if (g.agentId) {
    const agent = document.createElement('span');
    agent.textContent = g.agentId;
    meta.appendChild(agent);
  }
  if (meta.children.length) el.appendChild(meta);
  return el;
}

function appendDetailRow(grid, key, value, className = '', goalId = null) {
  const k = document.createElement('div');
  k.className = 'detail__key';
  k.textContent = key;
  const v = document.createElement('div');
  v.className = `detail__value ${className}`.trim();
  v.textContent = value || '—';
  // Rows tagged with a goal id are live countdowns: the 1s loop repaints
  // them in place without a full drawer re-render.
  if (goalId) {
    v.classList.add('countdown');
    v.dataset.goal = goalId;
  }
  grid.append(k, v);
}

function renderGoalDetails(g) {
  const panel = document.getElementById('goal-detail-panel');
  if (panel.hidden || S.activeGoalId !== g.goalId) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const active = document.activeElement;
  if (active && panel.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;

  const group = goalGroup(g);
  document.getElementById('goal-detail-kicker').textContent = t(GROUP_I18N_KEY[group]);
  document.getElementById('goal-detail-title').textContent = g.goalId;
  const body = document.getElementById('goal-detail-body');
  body.replaceChildren();

  const overview = document.createElement('section');
  overview.className = 'detail__section';
  const overviewLabel = document.createElement('div');
  overviewLabel.className = 'detail__label';
  overviewLabel.textContent = t('detailOverview');
  const action = document.createElement('div');
  action.className = 'detail__action' + (g.lastError ? ' goal__reason--err' : '');
  action.textContent = goalNarration(g);
  overview.append(overviewLabel, action);
  body.appendChild(overview);

  // Pending approvals first — the drawer's whole point when a gate is open.
  if (isGated(g)) {
    const gates = document.createElement('section');
    gates.className = 'detail__section detail__section--gate';
    const gatesLabel = document.createElement('div');
    gatesLabel.className = 'detail__label detail__label--gate';
    gatesLabel.textContent = t('gateSectionTitle');
    gates.appendChild(gatesLabel);
    if (g.userTodos === null) {
      const loading = document.createElement('div');
      loading.className = 'detail__reason';
      loading.textContent = t('gateLoading');
      gates.appendChild(loading);
      refreshUserTodos(g);
    } else {
      for (const todo of g.userTodos) {
        const item = document.createElement('div');
        item.className = 'gate-item';
        const text = document.createElement('div');
        text.className = 'gate-item__text';
        text.textContent = todo.title || todo.text || todo.todo_id;
        const approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.className = 'btn btn--approve';
        approveBtn.textContent = t('approve');
        approveBtn.onclick = () => openApproveDialog(g, todo);
        item.append(text, approveBtn);
        gates.appendChild(item);
      }
      if (!g.userTodos.length) {
        const none = document.createElement('div');
        none.className = 'detail__reason';
        const gateWait = (g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn) || null;
        none.textContent = gateWait
          ? (waitingLabel(gateWait) === t('groupReview') ? t('groupReview') : t('waitingOn', waitingLabel(gateWait)))
          : '—';
        gates.appendChild(none);
        // A gate with no approvable todo would otherwise be a dead end —
        // offer the one action that can move it: run a turn.
        if (!g.running) {
          const runNext = document.createElement('button');
          runNext.type = 'button';
          runNext.className = 'btn btn--primary';
          runNext.textContent = t('runOnce');
          runNext.onclick = () => executeRunOnce(g);
          gates.appendChild(runNext);
        }
      }
    }
    body.appendChild(gates);
  }

  if (g.running || g.activityLines.length) {
    const activity = document.createElement('section');
    activity.className = 'detail__section';
    const activityLabel = document.createElement('div');
    activityLabel.className = 'detail__label';
    activityLabel.textContent = t('activityTitle');
    const stream = document.createElement('div');
    stream.className = 'activity-stream';
    stream.dataset.goal = g.goalId;
    for (const entry of g.activityLines) stream.appendChild(activityLineElement(entry));
    activity.append(activityLabel, stream);
    body.appendChild(activity);
    requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
  }

  const status = document.createElement('section');
  status.className = 'detail__section';
  const statusLabel = document.createElement('div');
  statusLabel.className = 'detail__label';
  statusLabel.textContent = t('detailStatus');
  const grid = document.createElement('div');
  grid.className = 'detail__grid';
  if (g.userStopped) {
    // A stopped task explains itself: one clear row instead of scheduler
    // noise (its heartbeat and schedule are off by definition).
    appendDetailRow(grid, t('detailStatus'), t('stoppedState'));
  } else {
    const waiting = g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn;
    appendDetailRow(grid, t('detailStatus'), waiting
      ? `${g.last?.state ?? g.state ?? '—'} · ${waitingLabel(waiting)}`
      : (g.last?.state ?? g.state ?? '—'));
    appendDetailRow(grid, t('detailSchedule'), goalMetaText(g), g.errorCount ? 'countdown--err' : '', g.goalId);
  }
  status.append(statusLabel, grid);
  body.appendChild(status);

  const controls = document.createElement('section');
  controls.className = 'detail__section detail__controls';
  const controlsLabel = document.createElement('div');
  controlsLabel.className = 'detail__label';
  controlsLabel.textContent = t('detailControls');
  controls.appendChild(controlsLabel);
  const agentField = document.createElement('label');
  agentField.className = 'field';
  const agentLabel = document.createElement('span');
  agentLabel.textContent = t('agent');
  agentField.appendChild(agentLabel);
  if (g.agents.length) {
    const select = document.createElement('select');
    const options = g.agentId && !g.agents.includes(g.agentId) ? [...g.agents, g.agentId] : g.agents;
    for (const agentId of options) {
      const option = document.createElement('option');
      option.value = agentId;
      option.textContent = agentId;
      option.selected = agentId === g.agentId;
      select.appendChild(option);
    }
    select.onchange = () => {
      g.agentId = select.value;
      S.config.agentByGoal[g.goalId] = g.agentId;
      saveConfig();
      renderAllGoals(true);
    };
    agentField.appendChild(select);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('agentFree');
    input.value = g.agentId;
    input.onchange = () => {
      g.agentId = input.value.trim();
      S.config.agentByGoal[g.goalId] = g.agentId;
      saveConfig();
      renderAllGoals(true);
    };
    agentField.appendChild(input);
  }
  controls.appendChild(agentField);
  const modelField = document.createElement('label');
  modelField.className = 'field';
  const modelLabel = document.createElement('span');
  modelLabel.textContent = t('detailModel');
  modelField.appendChild(modelLabel);
  const modelSelect = document.createElement('select');
  fillModelSelect(modelSelect, S.config.modelByGoal[g.goalId] || '', true);
  modelSelect.onchange = () => {
    S.config.modelByGoal[g.goalId] = modelSelect.value;
    saveConfig();
    log(`[${g.goalId}] ${t('modelChanged', modelForGoal(g.goalId))}`, false);
    renderGoalDetails(g);
  };
  modelField.appendChild(modelSelect);
  controls.appendChild(modelField);
  // A user-stopped task is parked as a whole: heartbeat and auto-run are
  // managed by 停止/恢复, so the per-switch toggles hide until resumed.
  if (!g.userStopped) {
    const monitor = document.createElement('label');
    monitor.className = 'detail__toggle';
    monitor.appendChild(document.createTextNode(t('monitor')));
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = g.monitoring;
    checkbox.onchange = () => {
      g.monitoring = checkbox.checked;
      S.config.monitorByGoal[g.goalId] = checkbox.checked;
      saveConfig();
      if (checkbox.checked) pollNow(g); else rearmTimer();
      renderAllGoals(true);
    };
    monitor.appendChild(checkbox);
    controls.appendChild(monitor);
    const autoRunToggle = document.createElement('label');
    autoRunToggle.className = 'detail__toggle';
    autoRunToggle.appendChild(document.createTextNode(t('autoRunLabel')));
    const autoRunBox = document.createElement('input');
    autoRunBox.type = 'checkbox';
    autoRunBox.checked = g.autoRun;
    autoRunBox.onchange = () => {
      setAutoRun(g, autoRunBox.checked);
      renderAllGoals(true);
    };
    autoRunToggle.appendChild(autoRunBox);
    controls.appendChild(autoRunToggle);
  }
  const goalDir = goalProjectDir(g.goalId);
  if (goalDir) {
    const dirRow = document.createElement('div');
    dirRow.className = 'detail__repodir';
    const dirText = document.createElement('span');
    dirText.className = 'detail__repodir-path';
    dirText.textContent = goalDir;
    dirText.title = goalDir;
    const dirButton = document.createElement('button');
    dirButton.type = 'button';
    dirButton.className = 'btn btn--small detail__repodir-btn';
    const folderIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    folderIcon.setAttribute('width', '13');
    folderIcon.setAttribute('height', '13');
    folderIcon.setAttribute('viewBox', '0 0 16 16');
    folderIcon.setAttribute('fill', 'none');
    folderIcon.setAttribute('stroke', 'currentColor');
    folderIcon.setAttribute('stroke-width', '1.5');
    folderIcon.setAttribute('stroke-linecap', 'round');
    folderIcon.setAttribute('stroke-linejoin', 'round');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.8h5A1.5 1.5 0 0 1 14 6.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z');
    folderIcon.appendChild(pathEl);
    const dirLabel = document.createElement('span');
    dirLabel.textContent = t('openRepoDir');
    dirButton.append(folderIcon, dirLabel);
    dirButton.onclick = () => {
      try { app.system.revealInFolder(goalDir); } catch (err) {
        log(`reveal failed: ${err.message || err}`, true);
      }
    };
    dirRow.append(dirText, dirButton);
    controls.appendChild(dirRow);
  }
  body.appendChild(controls);

  const actions = document.createElement('div');
  actions.className = 'detail__actions';
  if (g.userStopped || g.stopped) {
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'btn btn--primary';
    resumeBtn.textContent = t('resumeTask');
    resumeBtn.title = t('resumeTaskHint');
    resumeBtn.onclick = () => g.userStopped ? resumeGoalTask(g) : pollNow(g);
    actions.appendChild(resumeBtn);
  } else {
    const abort = document.createElement('button');
    abort.type = 'button';
    abort.className = 'btn btn--danger';
    abort.textContent = t('stopTask');
    abort.title = t('stopTaskHint');
    abort.onclick = () => openStopConfirm(g);
    actions.appendChild(abort);
  }
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--danger';
  del.textContent = t('deleteTask');
  del.title = t('deleteTaskHint');
  del.onclick = () => openDeleteConfirm(g);
  actions.appendChild(del);
  body.appendChild(actions);
}

// Gate approval confirmation: full todo text + optional note, one deliberate
// click. The dialog is the only writer of todo complete from the UI.
function openApproveDialog(g, todo) {
  const dlg = document.getElementById('dlg-approve');
  document.getElementById('approve-text').textContent = todo.text || todo.title || todo.todo_id;
  const noteInput = document.getElementById('approve-note');
  noteInput.value = '';
  dlg.returnValue = 'cancel';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'approve') return;
    approveTodo(g, todo, noteInput.value.trim(), null);
  };
  dlg.showModal();
}

// Stopping is a deliberate, whole-task action: explain what it does before
// doing it, so the task never "vanishes" as a surprise.
function openStopConfirm(g) {
  const dlg = document.getElementById('dlg-stop');
  document.getElementById('stop-title').textContent = t('stopConfirmTitle');
  document.getElementById('stop-text').textContent = t('stopConfirmText', g.goalId);
  dlg.querySelector('button[value="confirm"]').textContent = t('confirmStop');
  dlg.returnValue = 'cancel';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'confirm') return;
    stopGoalTask(g);
  };
  dlg.showModal();
}

function openDeleteConfirm(g) {
  const dlg = document.getElementById('dlg-stop');
  document.getElementById('stop-title').textContent = t('deleteConfirmTitle');
  document.getElementById('stop-text').textContent = t('deleteConfirmText', g.goalId);
  dlg.querySelector('button[value="confirm"]').textContent = t('confirmDelete');
  dlg.returnValue = 'cancel';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'confirm') return;
    deleteGoalTask(g);
  };
  dlg.showModal();
}

// Delete a task: archive its runtime and drop it from the registry (the
// worker keeps a backup of the registry file). Irreversible from the board.
async function deleteGoalTask(g) {
  try {
    const res = await app.call('loopx.deleteGoal', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: goalProjectDir(g.goalId),
      goalId: g.goalId,
    });
    if (!res.ok) throw new Error(res.error || 'delete failed');
    log(`[${g.goalId}] ${t('taskDeleted', g.goalId)}`);
    if (res.warning) log(`[${g.goalId}] ${res.warning}`, true);
    for (const map of [
      S.config.ownedGoals, S.config.monitorByGoal, S.config.agentByGoal,
      S.config.autoRunByGoal, S.config.modelByGoal, S.config.projectByGoal,
      S.config.stoppedByGoal, S.config.autoRunBeforeStop,
    ]) {
      if (map) delete map[g.goalId];
    }
    await saveConfig();
    S.activeGoalId = null;
    document.getElementById('goal-detail-panel').hidden = true;
    await refreshGoals();
    renderAllGoals(true);
  } catch (err) {
    const message = String(err && err.message || err);
    log(`[${g.goalId}] delete failed: ${message}`, true);
    recordGoalActivity(g, `${t('deleteTaskFailed')}: ${message}`, true);
  }
}

function openGoalDetails(g) {
  S.activeGoalId = g.goalId;
  document.getElementById('goal-detail-panel').hidden = false;
  renderGoalDetails(g);
  renderAllGoals(true); // mark the selected card
}

document.getElementById('btn-close-goal').addEventListener('click', () => {
  S.activeGoalId = null;
  document.getElementById('goal-detail-panel').hidden = true;
  renderAllGoals(true);
});

// Fingerprint of everything the goal list displays except per-second
// countdown text (the countdown loop patches those spans in place).
function displayFingerprint() {
  const parts = [
    String(S.goals.size), app.locale,
    S.bootLoading ? 'loading' : 'ready',
    S.intakeDraft ? `${S.intakeDraft.objective}|${S.intakeDraft.stage}` : '',
  ];
  for (const g of S.goals.values()) {
    parts.push([
      g.goalId, goalGroup(g), g.polling, g.running, g.stopped, g.monitoring,
      g.autoRun, g.autoFailCount,
      g.errorCount, g.unchangedCount, g.intervalMin.toFixed(2),
      g.agents.join(','), g.agentId,
      g.objective ?? '',
      g.last ? decisionKey(g.last) : '',
      g.last?.reason ?? '', g.last?.recommendedAction ?? '',
      g.last?.state ?? g.state ?? '', g.last?.waitingOn ?? g.waitingOn ?? '',
      g.lastError ?? '', g.currentActivity ?? '',
      g.userTodos ? `${g.userTodos.length}|${g.userTodos.map((td) => td.todo_id).join(',')}` : '-',
      g.lastRun ? `${g.lastRun.exitCode}|${g.lastRun.cancelled}|${g.lastRun.durationMs}` : '',
    ].join(''));
  }
  return parts.join('');
}

let lastFingerprint = '';

// Rapid bursts of state changes (task-intake progress, goal refresh, first
// poll) would each rebuild the whole board; coalesce them into one repaint
// per animation frame so the board doesn't flash through intermediate DOMs.
let renderQueued = false;
let renderQueuedForce = false;
function requestRender(force = false) {
  if (force) renderQueuedForce = true;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const flushForce = renderQueuedForce;
    renderQueuedForce = false;
    renderAllGoals(flushForce);
  });
}

function renderAllGoals(force = false) {
  if (BOOT_RENDER_COUNT < 12) {
    BOOT_RENDER_COUNT += 1;
    dbgUi('render', `#${BOOT_RENDER_COUNT} t=${bootMs()}ms force=${force} theme=${themeProbe()}`);
  }
  const workspace = document.getElementById('workspace-root');
  const active = document.activeElement;
  if (!force && active && workspace.contains(active)
      && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) {
    // Never yank the DOM out from under the user's cursor; re-render on blur.
    S.renderPending = true;
    return;
  }
  const fp = displayFingerprint();
  if (!force && fp === lastFingerprint) {
    updateHeaderStatus();
    return;
  }
  lastFingerprint = fp;

  // v3.2: the board shows only goals this console owns; other-host goals are
  // listed separately and stay unmonitored until adopted.
  const owned = [];
  const other = [];
  for (const g of S.goals.values()) (isOwnedGoal(g.goalId) ? owned : other).push(g);
  const buckets = new Map([...PRIMARY_GROUPS, 'backlog', ...ARCHIVE_GROUPS].map((k) => [k, []]));
  for (const g of owned) buckets.get(goalGroup(g)).push(g);

  // ── 等你处理: a standalone decision column ────────────────
  const reviewGoals = buckets.get('review');
  document.getElementById('review-zone-title').textContent = t(GROUP_I18N_KEY.review);
  document.getElementById('review-zone-count').textContent = String(reviewGoals.length);
  document.getElementById('review-zone-sub').textContent = t(GROUP_SUB_KEY.review);
  const reviewList = document.getElementById('review-list');
  reviewList.replaceChildren();
  if (reviewGoals.length === 0) {
    const none = document.createElement('div');
    none.className = 'zone-empty' + (S.bootLoading ? ' zone-empty--loading' : '');
    none.textContent = S.bootLoading ? t('loadingGoals') : t('colEmpty');
    reviewList.appendChild(none);
  }
  for (const g of reviewGoals) reviewList.appendChild(buildGoalCard(g));

  // ── 进行中 + log panel: ONE unit; the rail is its directory ──
  const activeGoals = buckets.get('active');
  const pendingCount = S.intakeDraft ? 1 : 0;
  document.getElementById('active-zone-title').textContent = t(GROUP_I18N_KEY.active);
  document.getElementById('active-zone-count').textContent = String(activeGoals.length + pendingCount);
  document.getElementById('active-zone-sub').textContent = t(GROUP_SUB_KEY.active);
  const activeList = document.getElementById('active-list');
  activeList.replaceChildren();
  if (S.intakeDraft) activeList.appendChild(buildIntakeRow(S.intakeDraft));
  if (activeGoals.length === 0 && pendingCount === 0) {
    const none = document.createElement('div');
    none.className = 'zone-empty' + (S.bootLoading ? ' zone-empty--loading' : '');
    none.textContent = S.bootLoading ? t('loadingGoals') : t('colEmpty');
    activeList.appendChild(none);
  }
  for (const g of activeGoals) activeList.appendChild(buildRunItem(g));

  // Terminal/stopped/error goals and other-host goals hide behind quiet chips
  // at the bottom of the review zone.
  const moreGroups = [];
  for (const key of ARCHIVE_GROUPS) {
    if (buckets.get(key).length > 0) moreGroups.push({ key, goals: buckets.get(key) });
  }
  if (other.length > 0) moreGroups.push({ key: 'other', goals: other });
  const moreArea = document.getElementById('more-area');
  moreArea.replaceChildren();
  if (moreGroups.length > 0) moreArea.appendChild(buildMoreFooter(moreGroups));

  // Master-detail: the selected goal's panel rides inside the run unit.
  const panel = document.getElementById('goal-detail-panel');
  const emptyHint = document.getElementById('detail-empty');
  if (S.activeGoalId) {
    const activeGoal = S.goals.get(S.activeGoalId);
    if (activeGoal) {
      panel.hidden = false;
      emptyHint.hidden = true;
      renderGoalDetails(activeGoal);
    } else {
      S.activeGoalId = null;
      panel.hidden = true;
      emptyHint.hidden = false;
    }
  } else {
    panel.hidden = true;
    emptyHint.hidden = false;
  }
  updateHeaderStatus();
}

// One chip per hidden group; clicking toggles that group's compact cards.
function buildMoreFooter(groups) {
  const footer = document.createElement('footer');
  footer.className = 'board-more';
  const chips = document.createElement('div');
  chips.className = 'board-more__chips';
  for (const group of groups) {
    const open = S.moreOpen.has(group.key);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'board-more__chip' + (open ? ' is-open' : '');
    const dot = document.createElement('span');
    dot.className = `dot dot--${group.key === 'other' ? 'backlog' : group.key}`;
    const label = document.createElement('span');
    label.textContent = group.key === 'other' ? t('otherTasksTitle') : t(GROUP_I18N_KEY[group.key]);
    const count = document.createElement('b');
    count.textContent = String(group.goals.length);
    chip.append(dot, label, count);
    chip.onclick = () => {
      if (S.moreOpen.has(group.key)) S.moreOpen.delete(group.key); else S.moreOpen.add(group.key);
      renderAllGoals(true);
    };
    chips.appendChild(chip);
  }
  footer.appendChild(chips);
  for (const group of groups) {
    if (!S.moreOpen.has(group.key)) continue;
    const panel = document.createElement('div');
    panel.className = 'board-more__panel';
    if (group.key === 'other') {
      panel.appendChild(buildOtherGoalsRows(group.goals));
    } else {
      for (const g of group.goals) panel.appendChild(buildGoalCard(g, true));
    }
    footer.appendChild(panel);
  }
  return footer;
}

// Header presence badge + global next-tick countdown: the single bit that
// matters most for a console that owns the timer — is it armed right now?
function updateHeaderStatus() {
  const presence = document.getElementById('hb-presence');
  const text = document.getElementById('hb-presence-text');
  const next = document.getElementById('hb-next');
  let mode = 'live';
  if (S.detect && !S.detect.found) mode = 'nocli';
  else if (S.paused) mode = 'paused';
  else {
    let armed = false;
    for (const g of S.goals.values()) {
      if (g.monitoring && !g.stopped) { armed = true; break; }
    }
    if (!armed) mode = 'idle';
  }
  presence.className = `presence presence--${mode}`;
  text.textContent = t({ live: 'presenceLive', paused: 'presencePaused', idle: 'presenceIdle', nocli: 'presenceNoCli' }[mode]);

  let anyPolling = false;
  let earliest = Infinity;
  for (const g of S.goals.values()) {
    if (g.polling) anyPolling = true;
    if (g.monitoring && !g.stopped && !g.polling && g.nextDueAt < earliest) earliest = g.nextDueAt;
  }
  if (anyPolling) next.textContent = t('hbChecking');
  else if (mode === 'live' && earliest !== Infinity) next.textContent = t('hbNext', fmtCountdown(earliest - Date.now()));
  else next.textContent = '';
}

// countdown repaint only — no CLI calls, no DOM rebuild
function startCountdownLoop() {
  if (S.countdownTimer) clearInterval(S.countdownTimer);
  S.countdownTimer = setInterval(() => {
    for (const g of S.goals.values()) {
      const countdowns = document.querySelectorAll(`.countdown[data-goal="${CSS.escape(g.goalId)}"]`);
      for (const cd of countdowns) cd.textContent = goalMetaText(g);
    }
    updateHeaderStatus();
  }, 1000);
}

// ── turn execution (host agent) ───────────────────────────
// Turns run on BitFun's own agent (app.agent.run): the worker composes the
// prompt (loopx heartbeat-prompt + repo binding), the host executes it in a
// hidden session, agent:event streams progress. No external CLI host and no
// user-facing execution settings. One agent session per goal is reused so
// follow-up turns keep context.
const agentRuns = new Map(); // goalId -> { sessionId, turnId, startedAt, tick }

async function executeRunOnce(g) {
  // Auto-run and the manual confirm dialog can race; whoever arrives second
  // must not reset the live run's state or activity stream.
  if (g.running || !isLiveGoal(g)) return;
  if (!goalProjectDir(g.goalId)) { log(t('needProject'), true); return; }
  if (!g.agentId) { log(`[${g.goalId}] ${t('needAgent')}`, true); return; }
  g.running = true;
  g.runStartedAt = Date.now();
  g.activityLines = [];
  g.agentTextBuffer = '';
  g.currentActivity = '';
  recordGoalActivity(g, t('activityStarting'));
  renderGoal(g);
  log(`[${g.goalId}] turn started (agent=${g.agentId})`);
  try {
    const composed = await app.call('loopx.turnPrompt', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: goalProjectDir(g.goalId),
      goalId: g.goalId,
      agentId: g.agentId,
    });
    if (!composed.ok) throw new Error(composed.error || 'turn prompt failed');
    // The log shows what was sent to the agent — collapsed, expandable.
    recordGoalActivity(g, t('activitySentPrompt', composed.prompt.length), false, 'prompt', composed.prompt);
    const run = await app.agent.run(composed.prompt, {
      sessionName: `LoopX · ${g.goalId}`,
      sessionId: S.agentSessionByGoal.get(g.goalId) || undefined,
      enableTools: true,
      model: modelForGoal(g.goalId),
    });
    S.agentSessionByGoal.set(g.goalId, run.sessionId);
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (isLiveGoal(g) && g.running) {
        setGoalActivityTick(g, t('activityRunning', fmtCountdown(Date.now() - startedAt)));
      }
    }, 10000);
    agentRuns.set(g.goalId, { sessionId: run.sessionId, turnId: run.turnId, startedAt, tick });
  } catch (err) {
    const message = String(err?.message || err);
    // A dead session id (host restarted) is retried once on a fresh session.
    if (S.agentSessionByGoal.has(g.goalId) && /session/i.test(message)) {
      S.agentSessionByGoal.delete(g.goalId);
      g.running = false;
      return executeRunOnce(g);
    }
    log(`[${g.goalId}] turn error: ${message}`, true);
    g.running = false;
    recordGoalActivity(g, message, true);
    renderGoal(g);
    finishRun(g, { ok: false, error: message });
  }
}

async function cancelGoalRun(g, button) {
  const run = agentRuns.get(g.goalId);
  if (!run) return;
  if (button) button.disabled = true;
  try {
    await app.agent.cancel(run.sessionId, run.turnId);
  } catch (err) {
    log(`[${g.goalId}] cancel error: ${err.message || err}`, true);
    if (button) button.disabled = false;
  }
}

// Terminal handling shared by completion/failure/cancel events.
function finishRun(g, { ok, cancelled = false, error = null }) {
  const run = agentRuns.get(g.goalId);
  if (run) clearInterval(run.tick);
  agentRuns.delete(g.goalId);
  g.running = false;
  g.lastRun = {
    exitCode: ok ? 0 : 1,
    durationMs: run ? Date.now() - run.startedAt : 0,
    status: cancelled ? 'cancelled' : (ok ? 'completed' : 'failed'),
    ok,
    cancelled,
  };
  if (cancelled) {
    // A manual cancel is an explicit "stop": disable the continuous loop
    // instead of immediately relaunching what the user just killed.
    if (g.autoRun) setAutoRun(g, false);
    log(`[${g.goalId}] ${t('runCancelled')}`);
    recordGoalActivity(g, t('runCancelled'));
  } else if (ok) {
    g.autoFailCount = 0;
    log(`[${g.goalId}] turn completed`);
    recordGoalActivity(g, t('activityCompleted'));
  } else {
    if (g.autoRun) {
      g.autoFailCount += 1;
      if (g.autoFailCount >= AUTO_RUN_FAIL_LIMIT) {
        // Trip the breaker VISIBLY: flip the toggle off so the drawer shows
        // reality and re-enabling it is the documented recovery path.
        g.autoRun = false;
        S.config.autoRunByGoal[g.goalId] = false;
        saveConfig();
        log(t('autoRunDisabled', g.goalId), true);
        try {
          if (app.notifications?.system) app.notifications.system(t('title'), t('autoRunDisabled', g.goalId));
        } catch (_) {}
      }
    }
    log(`[${g.goalId}] turn failed: ${error || '?'}`, true);
    recordGoalActivity(g, error || t('activityFailed'), true);
  }
  requestRender();
  pollNow(g, { force: true }); // fresh decision even while hidden; auto-run re-fires from the poll
}

function goalForAgentSession(sessionId) {
  for (const [goalId, run] of agentRuns) {
    if (run.sessionId === sessionId) return S.goals.get(goalId);
  }
  return null;
}

// Compact progress narration from the agent event stream: the instructions
// sent to the agent, its streamed text, tool calls with brief args, and turn
// boundaries. Pure read/observe tools (Read, Grep, Glob, …) are the agent's
// eyes, not progress — skip them; repeats of the same verb collapse into one
// "×N" line via recordGoalActivity.
const QUIET_AGENT_TOOLS = new Set([
  'read', 'grep', 'glob', 'ls', 'list', 'find', 'cat', 'search',
  'web_search', 'websearch', 'fetch', 'mcp',
]);

// The agent's streamed text is accumulated and cut into paragraph-sized
// lines, so the log reads like the agent talking instead of token spam.
function streamAgentText(g, text) {
  if (!isLiveGoal(g) || !text) return;
  if (typeof g.agentTextBuffer !== 'string') g.agentTextBuffer = '';
  g.agentTextBuffer += text;
  const cut = (buf) => {
    const nl = buf.indexOf('\n');
    if (nl >= 0) return nl;
    return buf.length >= 160 ? 160 : -1;
  };
  let idx;
  while ((idx = cut(g.agentTextBuffer)) >= 0) {
    const segment = g.agentTextBuffer.slice(0, idx).trim();
    g.agentTextBuffer = g.agentTextBuffer.slice(idx + 1);
    if (segment) recordGoalActivity(g, segment, false, 'agent');
  }
}

function flushAgentText(g) {
  if (!isLiveGoal(g)) return;
  if (typeof g.agentTextBuffer === 'string' && g.agentTextBuffer.trim()) {
    recordGoalActivity(g, g.agentTextBuffer.trim(), false, 'agent');
  }
  g.agentTextBuffer = '';
}

// Tool-event params stream in partial JSON fragments. Accumulate them per
// tool call and parse the running buffer; never surface raw fragments (they
// slice one command into garbage like "bfx" / "-d" / "eepseek-h").
const toolParamsBuf = new Map(); // toolId -> accumulated raw params text
const toolLinesRecorded = new Map(); // toolId -> true (one line per tool call)

function toolBriefFromText(text, final) {
  const t = String(text || '').trim();
  if (!t) return '';
  try {
    const p = JSON.parse(t);
    if (!p || typeof p !== 'object') return '';
    if (Array.isArray(p)) {
      // A single-element array mid-stream is just the first argv fragment —
      // wait for the rest unless this is the final event.
      if (!final && p.length < 2) return '';
      return p.map(String).join(' ').slice(0, 120);
    }
    const brief = p.command || p.cmd || p.file_path || p.filePath || p.path
      || p.query || p.pattern || p.url || p.target_file
      || (Array.isArray(p.args) ? p.args.map(String).join(' ') : '')
      || (Array.isArray(p.arguments) ? p.arguments.map(String).join(' ') : '')
      || '';
    return String(brief).slice(0, 120);
  } catch (_) {
    // Partial buffer. Never guess mid-stream (that produced garbage like
    // "loop" or "bfx"); only make a best effort on the final event.
    if (!final) return '';
    const cmdMatch = t.match(/"(?:cmd|command)"\s*:\s*"([^"]*)/);
    if (cmdMatch && cmdMatch[1]) return cmdMatch[1].replace(/\\(.)/g, '$1').slice(0, 120);
    const argsMatch = t.match(/"(?:args|arguments)"\s*:\s*\[\s*"([^"]*)/);
    if (argsMatch && argsMatch[1]) return argsMatch[1].replace(/\\(.)/g, '$1').slice(0, 120);
    return '';
  }
}

function toolBrief(e, te, final) {
  const raw = te.params ?? e.params;
  if (raw == null) return '';
  const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (!te.tool_id) return toolBriefFromText(rawText, final);
  const buf = (toolParamsBuf.get(te.tool_id) || '') + rawText;
  if (buf.length > 6000) toolParamsBuf.set(te.tool_id, buf.slice(-3000));
  else toolParamsBuf.set(te.tool_id, buf);
  return toolBriefFromText(buf, final);
}

function pruneToolMaps() {
  if (toolLinesRecorded.size <= 300) return;
  const keys = [...toolLinesRecorded.keys()].slice(0, 150);
  for (const key of keys) {
    toolLinesRecorded.delete(key);
    toolParamsBuf.delete(key);
  }
}

app.agent.onEvent((e) => {
  const g = goalForAgentSession(e.sessionId);
  if (!g) return;
  if (e.sourceEvent === 'tool-event') {
    // New bridge nests the tool payload under `toolEvent` (event_type +
    // tool_name/tool_id fields); the legacy flat shape stays as a fallback.
    const te = e.toolEvent || {};
    const name = te.effectiveToolName || te.effective_tool_name
      || te.toolName || te.tool_name || e.toolName || e.tool_name || e.name;
    const phase = te.event_type || te.phase || e.phase;
    const done = phase === 'Completed' || phase === 'completed';
    if (name && !QUIET_AGENT_TOOLS.has(String(name).toLowerCase())) {
      const brief = toolBrief(e, te, done);
      if (te.tool_id) {
        // One line per tool call. If params have not streamed enough yet to
        // name the command, wait — a bare name with garbage fragments is
        // worse than a line that arrives one event later. A completed call
        // with nothing parseable falls back to the bare name.
        if (toolLinesRecorded.has(te.tool_id)) return;
        if (!brief && !done) return;
        toolLinesRecorded.set(te.tool_id, true);
        pruneToolMaps();
        recordGoalActivity(g, brief ? `${name}：${brief}` : String(name));
      } else {
        recordGoalActivity(g, brief ? `${name}：${brief}` : String(name));
      }
    }
  } else if (e.sourceEvent === 'text-chunk') {
    // contentType 'thinking' is the agent's private reasoning — skip it.
    if (e.contentType !== 'thinking' && typeof e.text === 'string') {
      streamAgentText(g, e.text);
    }
  } else if (e.sourceEvent === 'dialog-turn-completed') {
    flushAgentText(g);
    finishRun(g, { ok: true });
  } else if (e.sourceEvent === 'dialog-turn-failed') {
    flushAgentText(g);
    finishRun(g, { ok: false, error: String(e.error || e.message || 'turn failed') });
  } else if (e.sourceEvent === 'dialog-turn-cancelled') {
    flushAgentText(g);
    finishRun(g, { ok: false, cancelled: true });
  }
});

// ── bootstrap / detection / goals ─────────────────────────
function prefixLabel(p) {
  if (!p) return '';
  if (Array.isArray(p)) return p.join(' ');
  const base = (p.argv || []).join(' ');
  return p.env && p.env.PYTHONPATH ? `${base} (PYTHONPATH=${p.env.PYTHONPATH})` : base;
}

async function detect() {
  const banner = document.getElementById('banner-nodetect');
  try {
    S.detect = await app.call('loopx.detect', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
    });
  } catch (err) {
    S.detect = { found: false, probes: [{ error: String(err.message || err) }] };
  }
  updateHeaderStatus();
  if (S.detect.found) {
    banner.hidden = true;
    // Persist the working prefix — and heal a stale one: detect probes the
    // persisted prefix first, so if the winner differs, the persisted one is
    // broken (e.g. venv removed) and every poll would fail while the banner
    // says "detected".
    const detectedJson = JSON.stringify(S.detect.argvPrefix);
    if (!S.config.argvPrefix || JSON.stringify(S.config.argvPrefix) !== detectedJson) {
      S.config.argvPrefix = S.detect.argvPrefix;
      saveConfig();
    }
    log(t('detected', `${prefixLabel(S.detect.argvPrefix)} (${S.detect.version || '?'})`));
    return true;
  }
  banner.hidden = false;
  const detail = document.getElementById('probe-detail');
  detail.hidden = false;
  detail.textContent = (S.detect.probes || [])
    .map((p) => `${(p.argvPrefix || []).join(' ')} → ${p.ok ? p.version : p.error || 'failed'}`)
    .join('\n');
  return false;
}

async function refreshGoals() {
  try {
    const res = await app.call('loopx.listGoals', {
      argvPrefix: S.config.argvPrefix,
      projectDir: S.config.projectDir,
      projectDirs: projectRegistryDirs(),
    });
    const fresh = new Set();
    let bindingChanged = false;
    for (const info of res.goals || []) {
      fresh.add(info.goalId);
      const existing = S.goals.get(info.goalId);
      if (existing) {
        existing.state = info.state ?? existing.state;
        existing.waitingOn = info.waitingOn ?? existing.waitingOn;
        existing.agents = info.agents?.length ? info.agents : existing.agents;
        existing.objective = info.objective ?? existing.objective;
      } else {
        S.goals.set(info.goalId, newGoalState(info.goalId, info));
      }
      // listGoals reports which project directory each goal lives in (clone
      // cache discovery after a fresh import): bind it so polls/turns know
      // the checkout without a re-clone.
      if (info.projectDir && S.config.projectByGoal[info.goalId] !== info.projectDir) {
        S.config.projectByGoal[info.goalId] = info.projectDir;
        bindingChanged = true;
      }
    }
    for (const goalId of [...S.goals.keys()]) {
      if (!fresh.has(goalId)) S.goals.delete(goalId);
    }
    if (bindingChanged) await saveConfig();
    requestRender(true);
    for (const g of S.goals.values()) {
      if (g.monitoring && g.nextDueAt === 0) pollGoal(g);
    }
    rearmTimer();
    log(`goals refreshed: ${S.goals.size} (registry: ${res.registryPath})`);
  } catch (err) {
    log(`listGoals error: ${err.message || err}`, true);
  }
}

// ── toolbar / settings wiring ─────────────────────────────
function updateProjectValue() {
  const el = document.getElementById('set-project-value');
  if (S.config.projectDir) {
    el.textContent = S.config.projectDir;
    el.removeAttribute('data-i18n');
  } else {
    el.textContent = '';
    el.setAttribute('data-i18n', 'projectDirNone');
    applyI18n();
  }
}

async function pickProjectDir() {
  try {
    const picked = await app.dialog.open({ directory: true });
    const dir = Array.isArray(picked) ? picked[0] : picked;
    if (!dir) return;
    S.config.projectDir = dir;
    await saveConfig();
    updateProjectValue();
    S.goals.clear();
    renderAllGoals(true);
    await refreshGoals();
  } catch (err) {
    log(`dialog error: ${err.message || err}`, true);
  }
}

document.getElementById('btn-pick-project').addEventListener('click', pickProjectDir);
document.getElementById('btn-clear-project').addEventListener('click', async () => {
  S.config.projectDir = null;
  await saveConfig();
  updateProjectValue();
  S.goals.clear();
  renderAllGoals(true);
  await refreshGoals();
});

document.getElementById('btn-refresh').addEventListener('click', refreshGoals);
document.getElementById('btn-retry-detect').addEventListener('click', async () => {
  if (await detect()) refreshGoals();
});

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('set-prefix').value = S.config.argvPrefix ? JSON.stringify(S.config.argvPrefix) : '';
  document.getElementById('set-srcdir').value = S.config.srcDir || '';
  fillModelSelect(document.getElementById('set-model'), S.config.defaultModel || 'auto', false);
  updateProjectValue();
  const dlg = document.getElementById('dlg-settings');
  dlg.returnValue = 'cancel'; // avoid stale 'save' from a previous open
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'save') return;
    const prefixText = document.getElementById('set-prefix').value.trim();
    if (prefixText) {
      try {
        const parsed = JSON.parse(prefixText);
        const isArgvArray = Array.isArray(parsed) && parsed.every((x) => typeof x === 'string');
        const isPrefixObj = parsed && typeof parsed === 'object' && Array.isArray(parsed.argv);
        if (isArgvArray || isPrefixObj) S.config.argvPrefix = parsed;
      } catch (_) { log('invalid argvPrefix JSON, ignored', true); }
    } else {
      S.config.argvPrefix = null;
    }
    S.config.srcDir = document.getElementById('set-srcdir').value.trim();
    S.config.defaultModel = document.getElementById('set-model').value || 'auto';
    await saveConfig();
    syncComposerModel();
    if (await detect()) refreshGoals();
  };
  dlg.showModal();
});

document.getElementById('btn-logs').addEventListener('click', () => {
  renderLogBody();
  document.getElementById('dlg-logs').showModal();
});
function setLogFilter(filter) {
  logFilter = filter;
  document.getElementById('log-filter-all').classList.toggle('is-active', filter === 'all');
  document.getElementById('log-filter-errors').classList.toggle('is-active', filter === 'errors');
  renderLogBody();
}
document.getElementById('log-filter-all').addEventListener('click', () => setLogFilter('all'));
document.getElementById('log-filter-errors').addEventListener('click', () => setLogFilter('errors'));
document.getElementById('btn-close-logs').addEventListener('click', () => {
  document.getElementById('dlg-logs').close();
});

document.getElementById('btn-copy-raw').addEventListener('click', async (e) => {
  const text = document.getElementById('raw-body').textContent;
  try {
    if (app.clipboard?.writeText) await app.clipboard.writeText(text);
    else await navigator.clipboard.writeText(text);
    e.target.textContent = '✓';
    setTimeout(() => { e.target.textContent = t('copy'); }, 1200);
  } catch (err) {
    log(`copy failed: ${err.message || err}`, true);
  }
});

// ── task intake ───────────────────────────────────────────
// Flow: input → loopx.resolveIntake (read-only classify + expand issues-list)
// → confirmation sheet (issue checklist; new-vs-guide when goals exist)
// → loopx.taskIntake (event-driven) → auto-run takes over.
// Strict intake grammar (docs/product-spec.md): the only supported links are
// a single issue/PR, the issues list, and the repository home. Anything else
// is rejected with a specific message instead of being treated as the repo.
function taskInputKind(text) {
  const urls = String(text || '').match(/https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi) || [];
  let issues = 0;
  let lists = 0;
  let repos = 0;
  for (const url of urls) {
    try {
      const segments = new URL(url.replace(/[),.;:\]}]+$/g, '')).pathname.split('/').filter(Boolean);
      const type = (segments[2] || '').toLowerCase();
      if (segments.length === 2) repos += 1;
      else if (type === 'issues' && segments.length === 3) lists += 1;
      else if (/^(issues|pull)$/.test(type) && segments.length === 4 && /^\d+$/.test(segments[3] || '')) issues += 1;
    } catch (_) {}
  }
  if (lists || (repos && !issues)) return t('taskIssuesList');
  if (issues > 1) return t('taskIssues', issues);
  if (issues === 1) return t('taskIssue');
  return '';
}

// First github.com URL in the text that does NOT fit the supported grammar
// (used to explain rejections precisely); null when none.
function firstUnsupportedGithubUrl(text) {
  const urls = String(text || '').match(/https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi) || [];
  for (const url of urls) {
    try {
      const segments = new URL(url.replace(/[),.;:\]}]+$/g, '')).pathname.split('/').filter(Boolean);
      const type = (segments[2] || '').toLowerCase();
      const supported = segments.length === 2
        || (type === 'issues' && segments.length === 3)
        || (/^(issues|pull)$/.test(type) && segments.length === 4 && /^\d+$/.test(segments[3] || ''));
      if (!supported) return url;
    } catch (_) {}
  }
  return null;
}

function setTaskFeedback(message, mode = '') {
  const feedback = document.getElementById('task-feedback');
  feedback.textContent = message || '';
  feedback.hidden = !message;
  feedback.className = `composer__feedback${mode ? ` composer__feedback--${mode}` : ''}`;
}

function updateTaskKind() {
  const input = document.getElementById('task-input');
  const kind = taskInputKind(input.value);
  const badge = document.getElementById('task-kind');
  badge.textContent = kind;
  badge.hidden = !kind;
}

function resolveDefaultAgent() {
  if (S.config.defaultAgentId) return S.config.defaultAgentId;
  for (const goal of S.goals.values()) {
    if (goal.agentId) return goal.agentId;
    if (goal.agents.length) return goal.agents[0];
  }
  return Object.values(S.config.agentByGoal || {}).find(Boolean) || '';
}

function setComposerBusy(busy, message = '') {
  document.getElementById('task-input').disabled = busy;
  document.getElementById('btn-create-task').disabled = busy;
  setTaskFeedback(message, busy ? '' : undefined);
}

// The confirmation sheet is the one deliberate stop before anything is
// written: it shows exactly which issues become todos and where they land.
function openIntakeSheet(resolved, objective) {
  S.pendingIntake = { resolved, objective, selected: new Set(resolved.issues.map((i) => i.url)) };
  const dlg = document.getElementById('dlg-intake');
  const isList = resolved.kind === 'issues-list';
  const hasIssues = resolved.issues.length > 0;
  // Guide targets: goals bound to the same checkout. A fresh auto-clone for a
  // new repository has nothing to guide into — never offer cross-repo guides.
  const boundDir = resolved.reuseDir
    || (!resolved.bypassCheckout ? S.config.projectDir : null)
    || null;
  const guidable = [...S.goals.values()].filter((g) =>
    !isTerminal(g) && boundDir && goalProjectDir(g.goalId) === boundDir);

  document.getElementById('intake-title').textContent = isList
    ? t('intakeTitleList')
    : (resolved.issues.length > 1 ? t('intakeTitleIssues', resolved.issues.length)
      : (resolved.issues.length === 1 ? t('intakeTitleIssue') : t('intakeTitleGoal')));

  const summary = document.getElementById('intake-summary');
  if (isList) {
    summary.textContent = t('intakeSummaryList', resolved.repo || '?', resolved.issues.length)
      + (resolved.truncated ? ` ${t('intakeTruncated', resolved.issues.length)}` : '');
  } else if (resolved.issues.length > 1) summary.textContent = t('intakeSummaryIssues', resolved.repo || '?');
  else if (guidable.length && !hasIssues) summary.textContent = t('intakeSummaryGoal');
  else summary.textContent = objective;
  if (resolved.autoClone) {
    summary.textContent += `\n${t('intakeCloneNote', resolved.repo || '?')}`;
  } else if (resolved.reuseDir) {
    summary.textContent += `\n${t('intakeReuseNote', resolved.repo || '?')}`;
  }
  if (resolved.fellBackFromCheckout) {
    summary.textContent += `\n${t('taskCloneOtherRepo', resolved.repo || '?', resolved.fellBackFromCheckout)}`;
  }

  // issue checklist (only for multi/list intake; single issue needs no picking)
  const listEl = document.getElementById('intake-issues');
  listEl.replaceChildren();
  listEl.hidden = !hasIssues || resolved.issues.length < 2;
  const bar = document.getElementById('intake-selectbar');
  bar.hidden = listEl.hidden;
  document.getElementById('intake-select-all').checked = true;
  if (!listEl.hidden) {
    for (const issue of resolved.issues) {
      const row = document.createElement('label');
      row.className = 'intake-issue';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.onchange = () => {
        if (cb.checked) S.pendingIntake.selected.add(issue.url);
        else S.pendingIntake.selected.delete(issue.url);
        updateIntakeCount();
      };
      const num = document.createElement('span');
      num.className = 'intake-issue__num';
      num.textContent = `#${issue.number}`;
      const title = document.createElement('span');
      title.className = 'intake-issue__title';
      title.textContent = issue.title === `#${issue.number}` ? issue.url : issue.title;
      title.title = issue.url;
      row.append(cb, num, title);
      listEl.appendChild(row);
    }
  }

  // target: new task vs guide an existing one
  const modeRow = document.getElementById('intake-mode');
  const modeSelect = document.getElementById('intake-goal-select');
  modeRow.hidden = guidable.length === 0;
  if (!modeRow.hidden) {
    modeSelect.replaceChildren();
    const optNew = document.createElement('option');
    optNew.value = '';
    optNew.textContent = t('intakeModeNew');
    modeSelect.appendChild(optNew);
    for (const g of guidable) {
      const opt = document.createElement('option');
      opt.value = g.goalId;
      opt.textContent = `${t('intakeModeGuide')}: ${g.goalId}`;
      modeSelect.appendChild(opt);
    }
    // Appending a follow-up issue to the repo's running task is the common
    // intent — default single issues to the first same-repo goal; batch
    // intake still defaults to a fresh task.
    modeSelect.value = resolved.issues.length === 1 ? guidable[0].goalId : '';
    modeSelect.onchange = updateIntakeCount;
  }

  updateIntakeCount();
  dlg.returnValue = 'cancel';
  dlg.onclose = () => {
    const pending = S.pendingIntake;
    S.pendingIntake = null;
    if (dlg.returnValue !== 'confirm' || !pending) {
      setComposerBusy(false, '');
      return;
    }
    const guideGoalId = modeRow.hidden ? '' : modeSelect.value;
    startTaskIntake(pending, guideGoalId || null);
  };
  dlg.showModal();
}

function updateIntakeCount() {
  const pending = S.pendingIntake;
  if (!pending) return;
  const total = pending.resolved.issues.length;
  const selected = total ? pending.resolved.issues.filter((i) => pending.selected.has(i.url)).length : 0;
  const countEl = document.getElementById('intake-count');
  countEl.textContent = total >= 2 ? t('intakeSelectedCount', selected, total) : '';
  const confirm = document.getElementById('btn-intake-confirm');
  const modeRow = document.getElementById('intake-mode');
  const guiding = !modeRow.hidden && document.getElementById('intake-goal-select').value !== '';
  if (guiding) {
    confirm.textContent = t('intakeConfirmGuide');
    confirm.disabled = total >= 2 && selected === 0;
  } else if (total >= 2) {
    confirm.textContent = t('intakeConfirmIssues', selected);
    confirm.disabled = selected === 0;
  } else {
    confirm.textContent = t('intakeConfirmNew');
    confirm.disabled = false;
  }
}

document.getElementById('intake-select-all').addEventListener('change', (e) => {
  const pending = S.pendingIntake;
  if (!pending) return;
  pending.selected = e.target.checked ? new Set(pending.resolved.issues.map((i) => i.url)) : new Set();
  document.querySelectorAll('#intake-issues input[type="checkbox"]').forEach((cb) => { cb.checked = e.target.checked; });
  updateIntakeCount();
});

function startTaskIntake(pending, guideGoalId) {
  const { resolved, objective } = pending;
  const issues = resolved.issues.filter((i) => pending.selected.has(i.url))
    .map((i) => ({ url: i.url, number: i.number, title: i.title }));
  // Guidance todos are claimed by the target goal's own agent, not the
  // new-task default — a mismatch would leave them unclaimable.
  const agentId = guideGoalId
    ? (S.goals.get(guideGoalId)?.agentId || resolveDefaultAgent())
    : resolveDefaultAgent();
  // Binding order: the guided goal's own checkout, then a reuse directory the
  // resolver matched to this repository, then the global setting. Auto-clone
  // only fires when none of those exists.
  const projectDir = guideGoalId
    ? goalProjectDir(guideGoalId)
    : (resolved.reuseDir || (!resolved.bypassCheckout ? S.config.projectDir : null));
  S.intakeDraft = { objective, stage: guideGoalId ? t('taskCreating') : t('stageBootstrap') };
  setComposerBusy(true, t('taskCreating'));
  renderAllGoals(true);
  app.call('loopx.taskIntake', {
    argvPrefix: S.config.argvPrefix,
    srcDir: S.config.srcDir || null,
    projectDir,
    objective,
    agentId,
    mode: guideGoalId ? 'guide' : 'new',
    goalId: guideGoalId,
    autoClone: !guideGoalId && !projectDir && Boolean(resolved.autoClone),
    issues: issues.length ? issues : null,
  }).then((res) => {
    if (res && res.ok === false) {
      // Synchronous refusal (repo checks) — no done event will follow.
      S.intakeDraft = null;
      requestRender(true);
      setComposerBusy(false, '');
      const message = res.code === 'repository_mismatch'
        ? t('taskRepoMismatch', res.requestedRepo, res.projectRepo || '?')
        : (res.code === 'multiple_repositories' ? t('taskMultipleRepos') : (res.error || 'task intake failed'));
      setTaskFeedback(message, 'error');
      return;
    }
    if (!res || !res.started) throw new Error('task intake did not start');
    // progress + completion arrive on worker:taskIntake:* events
  }).catch((err) => {
    S.intakeDraft = null;
    requestRender(true);
    setComposerBusy(false, '');
    setTaskFeedback(String(err.message || err), 'error');
    log(`task intake error: ${err.message || err}`, true);
  });
}

app.on('worker:taskIntake:progress', (d) => {
  if (!S.intakeDraft) return;
  const stages = {
    expand: t('stageExpand'),
    clone: d.percent != null ? t('stageClonePercent', d.percent) : t('stageClone'),
    bootstrap: t('stageBootstrap'),
    register: t('stageRegister'),
    plan: t('stagePlan'),
    todos: d.total ? t('stageTodos', d.current || 0, d.total) : t('taskCreating'),
    refresh: t('stageRefresh'),
  };
  S.intakeDraft.stage = stages[d.stage] || t('taskCreating');
  setTaskFeedback(S.intakeDraft.stage);
  // Patch the pending rail row's stage line in place — a full board rebuild
  // per progress event (clone percent streams) is exactly the flicker we
  // remove.
  const live = document.querySelector('.run-item--pending .goal__activity-text');
  if (live) live.textContent = S.intakeDraft.stage;
});

app.on('worker:taskIntake:done', async (result) => {
  const input = document.getElementById('task-input');
  // A goal that got created is a goal we manage — even if some todos failed.
  // Treating partial failure as total would hide the goal, leave auto-run
  // off, and invite a retry that mints a duplicate (uniqueGoalId suffixes).
  if (!result.ok && !result.created) {
    let message = result.error || 'task creation failed';
    if (result.code === 'repository_mismatch') {
      message = t('taskRepoMismatch', result.requestedRepo, result.projectRepo || '?');
    } else if (result.code === 'multiple_repositories') {
      message = t('taskMultipleRepos');
    } else if (result.code === 'repository_unverified') {
      message = t('taskRepoUnverified', result.requestedRepo || '?');
    }
    S.intakeDraft = null;
    requestRender(true);
    setComposerBusy(false, '');
    setTaskFeedback(message, 'error');
    log(`task intake: ${message}`, true);
    return;
  }
  if (result.mode === 'new') {
    const agentId = resolveDefaultAgent();
    S.config.defaultAgentId = agentId;
    S.config.agentByGoal[result.goalId] = agentId;
    S.config.monitorByGoal[result.goalId] = true;
    S.config.autoRunByGoal[result.goalId] = true;
    S.config.ownedGoals[result.goalId] = true;
    if (result.projectDir) S.config.projectByGoal[result.goalId] = result.projectDir;
    await saveConfig();
  }
  input.value = '';
  updateTaskKind();
  setComposerBusy(false, '');
  if (!result.ok) {
    // Goal exists but some todos failed — adopt it, say so honestly.
    setTaskFeedback(t('taskPartial', result.goalId, result.writtenOk ?? 0, result.error || ''), 'error');
    log(`[${result.goalId}] task intake partial: ${result.error}`, true);
  } else if (result.mode === 'guide') {
    setTaskFeedback(t('guideStarted', result.goalId), 'ok');
    log(`[${result.goalId}] guidance written (${result.written.length} todos)`);
  } else {
    setTaskFeedback(t('taskStarted', result.goalId), 'ok');
    log(`[${result.goalId}] task created (${result.intakeKind}, ${result.written.length} todos)`);
  }
  if (S.intakeDraft) S.intakeDraft.stage = t('taskStageStarting');
  S.intakeDraft = null;
  await refreshGoals();
  const goal = S.goals.get(result.goalId);
  if (goal) {
    if (result.mode === 'new') {
      goal.agentId = S.config.agentByGoal[result.goalId] || goal.agentId;
      goal.autoRun = true;
      goal.autoFailCount = 0;
    }
    requestRender(true);
    // refreshGoals already polled the goal; a should_run=true decision fires
    // the first turn through maybeAutoRun — one launch path, no races.
    pollNow(goal, { force: true });
  } else {
    requestRender(true);
  }
});

async function createTaskFromInput() {
  const input = document.getElementById('task-input');
  const objective = input.value.trim();
  if (!objective) { input.focus(); return; }
  dbgUi('createTask:start', `text=${objective.slice(0, 120)}`);
  // Issue-fix is the one polished creation scenario; free text is NOT a
  // goal type — while a task is running, it becomes mid-task guidance.
  if (!taskInputKind(objective)) {
    const bad = firstUnsupportedGithubUrl(objective);
    if (bad) {
      dbgUi('createTask:unsupported', bad);
      setTaskFeedback(t('taskUnsupportedPath', bad), 'error');
      return;
    }
    const target = guidanceTargetGoal();
    if (!target) {
      const runningCount = [...S.goals.values()].filter((g) => g.running).length;
      dbgUi('createTask:guidanceRejected', `running=${runningCount}`);
      setTaskFeedback(runningCount > 1 ? t('guidancePickOne') : t('guidanceNoRunning'), 'error');
      return;
    }
    startGuidance(target, objective);
    return;
  }
  if (!resolveDefaultAgent()) {
    setTaskFeedback(t('taskNeedAgent'), 'error');
    return;
  }
  setComposerBusy(true, t('taskResolving'));
  dbgUi('createTask:callingResolve', `projectDir=${S.config.projectDir || '(none)'}`);
  let resolved;
  try {
    resolved = await app.call('loopx.resolveIntake', {
      projectDir: S.config.projectDir,
      projectDirs: projectRegistryDirs(),
      objective,
    });
    // The bound checkout is a different repository than the link: fall back
    // to the clone-directory path (auto-clone or reuse) so one console can
    // work across repositories without touching Settings.
    if (!resolved.ok && resolved.code === 'repository_mismatch') {
      const boundRepo = resolved.projectRepo;
      dbgUi('createTask:mismatchFallback', `${resolved.requestedRepo} vs ${boundRepo}`);
      resolved = await app.call('loopx.resolveIntake', {
        projectDir: null,
        projectDirs: Object.values(S.config.projectByGoal || {}).filter(Boolean),
        objective,
      });
      if (resolved.ok && resolved.repo && boundRepo) {
        // The global checkout must not leak back into binding for THIS repo:
        // bypassCheckout marks the fallback so reuse/clone decisions ignore it.
        resolved.fellBackFromCheckout = boundRepo;
        resolved.bypassCheckout = true;
        log(`repo switch: new task targets ${resolved.repo} (checkout was ${boundRepo})`);
      }
    }
    dbgUi('createTask:resolved', JSON.stringify({ ok: resolved.ok, code: resolved.code, kind: resolved.kind, reuseDir: resolved.reuseDir || null, autoClone: resolved.autoClone, issues: resolved.issues && resolved.issues.length }));
  } catch (err) {
    dbgUi('createTask:resolveError', String(err && err.message || err));
    setComposerBusy(false, '');
    setTaskFeedback(String(err.message || err), 'error');
    return;
  }
  if (!resolved.ok) {
    setComposerBusy(false, '');
    if (resolved.code === 'repository_mismatch') {
      setTaskFeedback(t('taskRepoMismatch', resolved.requestedRepo, resolved.projectRepo || '?'), 'error');
    } else if (resolved.code === 'multiple_repositories') {
      setTaskFeedback(t('taskMultipleRepos'), 'error');
    } else if (resolved.code === 'repository_unverified') {
      setTaskFeedback(t('taskRepoUnverified', resolved.requestedRepo || '?'), 'error');
    } else if (resolved.code === 'repository_not_found') {
      setTaskFeedback(t('taskRepoNotFound', resolved.requestedRepo || '?'), 'error');
    } else if (resolved.code === 'repository_lookup_failed') {
      setTaskFeedback(t('taskRepoLookupFailed'), 'error');
    } else if (resolved.code === 'unsupported_github_path') {
      setTaskFeedback(t('taskUnsupportedPath', resolved.url || '?'), 'error');
    } else if (resolved.code === 'unsupported_input') {
      setTaskFeedback(t('taskGoalUnsupported'), 'error');
    } else {
      setTaskFeedback(resolved.error || 'intake failed', 'error');
    }
    return;
  }
  if (resolved.kind === 'issues-list' && resolved.issues.length === 0) {
    setComposerBusy(false, '');
    setTaskFeedback(t('intakeNoIssues'), 'error');
    return;
  }
  setTaskFeedback('');
  // The sheet exists for real decisions: which issues, and new-vs-guide.
  // Guide targets are limited to goals bound to the SAME checkout, so a
  // follow-up issue appends to its own repo's task and never cross-pollinates.
  const boundDir = resolved.reuseDir
    || (!resolved.bypassCheckout ? S.config.projectDir : null)
    || null;
  const guidable = [...S.goals.values()].filter((g) =>
    !isTerminal(g) && boundDir && goalProjectDir(g.goalId) === boundDir);
  if (resolved.issues.length < 2 && guidable.length === 0) {
    startTaskIntake({ resolved, objective, selected: new Set(resolved.issues.map((i) => i.url)) }, null);
    return;
  }
  openIntakeSheet(resolved, objective);
}

// Free text targets a RUNNING task as guidance. Prefer the selected goal,
// otherwise a single running goal; multiple running goals need a pick first.
function guidanceTargetGoal() {
  if (S.activeGoalId) {
    const selected = S.goals.get(S.activeGoalId);
    if (selected && selected.running) return selected;
  }
  const running = [...S.goals.values()].filter((g) => g.running);
  return running.length === 1 ? running[0] : null;
}

async function startGuidance(g, text) {
  const input = document.getElementById('task-input');
  setComposerBusy(true, t('guidanceSending'));
  dbgUi('guidance:start', `goal=${g.goalId}`);
  try {
    const res = await app.call('loopx.guideGoal', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: goalProjectDir(g.goalId),
      goalId: g.goalId,
      agentId: g.agentId || null,
      text,
    });
    if (!res.ok) throw new Error(res.error || 'guidance failed');
    input.value = '';
    updateTaskKind();
    setComposerBusy(false, '');
    setTaskFeedback(t('guidanceSent', g.goalId), 'ok');
    recordGoalActivity(g, t('guidanceLine', text), false, 'agent');
    log(`[${g.goalId}] guidance sent (${text.length} chars)`);
    dbgUi('guidance:done', `goal=${g.goalId} todoId=${res.todoId || ''}`);
    pollNow(g, { force: true }); // fresh decision; auto-run picks the message up
  } catch (err) {
    const message = String(err && err.message || err);
    dbgUi('guidance:error', message);
    setComposerBusy(false, '');
    setTaskFeedback(message, 'error');
    log(`guidance error: ${message}`, true);
  }
}

document.getElementById('task-input').addEventListener('input', () => {
  updateTaskKind();
  setTaskFeedback('');
});
document.getElementById('task-input').addEventListener('keydown', (event) => {
  // Enter submits; Shift+Enter inserts a newline (default browser behavior).
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  createTaskFromInput();
});
document.getElementById('btn-create-task').addEventListener('click', createTaskFromInput);
document.getElementById('composer-model').addEventListener('change', async () => {
  S.config.defaultModel = document.getElementById('composer-model').value || 'auto';
  fillModelSelect(document.getElementById('set-model'), S.config.defaultModel, false);
  await saveConfig();
  log(t('modelChanged', S.config.defaultModel));
});


// Dialog cancel buttons are type=button (a submit-type Cancel placed first
// becomes the form's default button, so Enter in any dialog input would
// silently cancel). Close explicitly instead.
document.querySelectorAll('dialog .dlg-cancel').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dlg = btn.closest('dialog');
    dlg.returnValue = 'cancel';
    dlg.close('cancel');
  });
});

// ── i18n ──────────────────────────────────────────────────
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const value = t(key);
    if (typeof value !== 'string') return;
    if (el.getAttribute('data-i18n-attr') === 'title') el.title = value;
    else el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const value = t(el.getAttribute('data-i18n-title'));
    if (typeof value === 'string') el.title = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const value = t(el.getAttribute('data-i18n-placeholder'));
    if (typeof value === 'string') el.placeholder = value;
  });
  updateTaskKind();
  // Dynamic text the static pass just clobbered: the intake sheet's
  // count-driven confirm label.
  if (S.pendingIntake) updateIntakeCount();
}

app.onLocaleChange((locale) => {
  if (typeof locale === 'string') document.documentElement.setAttribute('lang', locale);
  applyI18n();
  renderAllGoals(true);
});

// ── lifecycle ─────────────────────────────────────────────
// The host documents onActivate/onDeactivate but does not emit them yet;
// keep the hooks (harmless, future-proof) and add two real signals:
// visibilitychange for window minimise, IntersectionObserver for the
// scene-tab display:none toggle (SceneViewport hides inactive tabs via CSS).
app.onDeactivate(pauseHeartbeat);
app.onActivate(resumeHeartbeat);
let intersecting = true;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseHeartbeat();
  else if (intersecting) resumeHeartbeat();
});
const visObserver = new IntersectionObserver((entries) => {
  intersecting = entries[entries.length - 1].isIntersecting;
  if (!intersecting) pauseHeartbeat();
  else if (!document.hidden) resumeHeartbeat();
});
visObserver.observe(document.body);

window.addEventListener('beforeunload', () => {
  if (S.timer) clearTimeout(S.timer);
  if (S.countdownTimer) clearInterval(S.countdownTimer);
});

// ── boot ──────────────────────────────────────────────────
(async function boot() {
  dbgUi('boot:start', `t=${bootMs()}ms readyState=${document.readyState} theme=${themeProbe()}`);
  await loadConfig();
  dbgUi('boot:configLoaded', `t=${bootMs()}ms projectDir=${S.config.projectDir || '(none)'} theme=${themeProbe()}`);
  try {
    const catalog = await app.ai.getModels();
    if (Array.isArray(catalog)) S.modelCatalog = catalog;
    dbgUi('boot:models', `t=${bootMs()}ms catalog=${S.modelCatalog.length}`);
  } catch (err) {
    dbgUi('boot:modelsError', String(err && err.message || err));
  }
  fillModelSelect(document.getElementById('set-model'), S.config.defaultModel || 'auto', false);
  syncComposerModel();
  applyI18n();
  dbgUi('boot:i18nApplied', `t=${bootMs()}ms`);
  startCountdownLoop();
  updateHeaderStatus();
  // Detect (banner + prefix persistence) and goal loading run in parallel:
  // listGoals resolves the invocation prefix on its own, so the board no
  // longer waits ~1.4s behind the CLI probe before showing goals.
  const detectedPromise = detect();
  const goalsPromise = refreshGoals();
  const detected = await detectedPromise;
  dbgUi('boot:detected', `t=${bootMs()}ms found=${detected} theme=${themeProbe()}`);
  await goalsPromise;
  S.bootLoading = false;
  const paints = performance.getEntriesByType('paint')
    .map((p) => `${p.name}@${Math.round(p.startTime)}ms`).join(' ') || '(no paint entries)';
  dbgUi('boot:done', `t=${bootMs()}ms goals=${S.goals.size} theme=${themeProbe()} paint=${paints}`);
  requestRender(true);
})();
