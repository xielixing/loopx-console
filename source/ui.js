// LoopX Console — UI + host heartbeat.
// The heartbeat is a single setTimeout chain armed to the earliest per-goal
// due time; each poll's interval is dictated by loopx's scheduler_hint
// (recommended interval, unchanged-poll backoff, max clamp, reset_token).
// Rendering is fingerprint-throttled: unchanged decisions repaint nothing but
// the 1s countdown, and re-renders are deferred while a card input has focus.

const app = window.app;

const I18N = {
  'zh-CN': {
    title: 'LoopX 控制台',
    globalRegistry: '全局 Registry',
    refresh: '刷新目标列表',
    settings: '设置',
    retry: '重试',
    notFoundTitle: '未检测到 loopx CLI',
    notFoundHint: '请先安装 loopx（对源码 checkout 执行 pip install -e），或在设置中指定调用命令 / 源码目录，然后点击重试。',
    projectBtnHint: '选择任务对应的本地仓库目录（新任务会在这里初始化 .loopx 状态）；不选则读全局 Registry（~/.codex/loopx/registry.global.json）',
    logTitle: '心跳与执行日志',
    monitor: '监控',
    agent: 'Agent',
    agentFree: '手动输入 agent id…',
    runOnce: '执行一次',
    cancelRun: '取消运行',
    lastRun: (code, s) => `上次运行 exit=${code} · ${s}s`,
    lastRunCancelled: '上次运行已取消',
    resume: '已暂停 · 点击恢复',
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
    presenceLive: '心跳运行中',
    presencePaused: '心跳已暂停',
    presenceIdle: '心跳未启动',
    presenceNoCli: 'loopx 不可用',
    hbNext: (t) => `下次心跳 ${t}`,
    hbChecking: '正在检查…',
    runCancelled: '运行已取消',
    groupBacklog: '待处理',
    groupReady: '待执行',
    groupActive: '进行中',
    groupReview: '等你处理',
    hiddenStates: '隐藏状态',
    groupDone: '已完成',
    detailOverview: '当前动作',
    detailStatus: '状态',
    detailState: '阶段',
    detailControls: '执行设置',
    detailAgent: 'Agent',
    detailHeartbeat: '心跳',
    detailLastRun: '最近执行',
    detailSchedule: '下次轮询',
    heroTitle: '粘贴链接，自动修复 GitHub Issues',
    heroHint: '一个 Issue 链接修复单个问题；仓库或 Issues 列表链接会列出全部 open issues 供你勾选，然后由 BitFun Agent 逐个修复。需要你审批时会在这里提醒你。',
    taskPlaceholder: '粘贴 GitHub Issue / 仓库 / Issues 列表链接，可附加修复要求',
    taskGoalUnsupported: '请粘贴 GitHub Issue、仓库或 Issues 列表链接（自由目标暂未开放）',
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
    globalRegistry: 'Global registry',
    refresh: 'Refresh goals',
    settings: 'Settings',
    retry: 'Retry',
    notFoundTitle: 'loopx CLI not found',
    notFoundHint: 'Install loopx first (pip install -e on a source checkout), or set the invocation command / source directory in Settings, then retry.',
    projectBtnHint: 'Pick the local repository directory for your tasks (new tasks initialize .loopx state there); without one, the console reads the global registry (~/.codex/loopx/registry.global.json)',
    logTitle: 'Heartbeat & execution log',
    monitor: 'Monitor',
    agent: 'Agent',
    agentFree: 'Type agent id…',
    runOnce: 'Run once',
    cancelRun: 'Cancel run',
    lastRun: (code, s) => `last run exit=${code} · ${s}s`,
    lastRunCancelled: 'last run cancelled',
    resume: 'Paused · click to resume',
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
    presenceLive: 'Heartbeat live',
    presencePaused: 'Heartbeat paused',
    presenceIdle: 'Heartbeat idle',
    presenceNoCli: 'loopx unavailable',
    hbNext: (t) => `next tick in ${t}`,
    hbChecking: 'checking now…',
    runCancelled: 'run cancelled',
    groupBacklog: 'Backlog',
    groupReady: 'Ready',
    groupActive: 'In progress',
    groupReview: 'Needs you',
    hiddenStates: 'Hidden states',
    groupDone: 'Done',
    detailOverview: 'Current action',
    detailStatus: 'Status',
    detailState: 'Stage',
    detailControls: 'Execution settings',
    detailAgent: 'Agent',
    detailHeartbeat: 'Heartbeat',
    detailLastRun: 'Last run',
    detailSchedule: 'Next poll',
    heroTitle: 'Paste a link, auto-fix GitHub issues',
    heroHint: 'One issue link fixes a single issue; a repository or issues-list link enumerates all open issues for you to pick, then the BitFun agent fixes them one by one. You are alerted here whenever your approval is needed.',
    taskPlaceholder: 'Paste a GitHub issue / repository / issues-list link, optionally with fix instructions',
    taskGoalUnsupported: 'Paste a GitHub issue, repository, or issues-list link (free-form goals are not open yet)',
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
    defaultAgentId: 'bitfun-agent', autoRunByGoal: {},
  },
  detect: null,
  goals: new Map(), // goalId -> G
  agentSessionByGoal: new Map(), // goalId -> host agent sessionId (context reuse)
  timer: null,
  countdownTimer: null,
  paused: false,
  renderPending: false,
  activeGoalId: null,
  intakeDraft: null,
  pendingIntake: null, // resolveIntake result awaiting sheet confirmation
  archiveOpen: new Set(),
  logs: [],
};

function newGoalState(goalId, info) {
  return {
    goalId,
    objective: info.objective || null,
    agents: info.agents || [],
    agentId: S.config.agentByGoal[goalId] || (info.agents && info.agents[0]) || '',
    state: info.state || null,
    waitingOn: info.waitingOn ?? null,
    monitoring: S.config.monitorByGoal[goalId] !== false,
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
function log(msg, isErr = false) {
  const time = new Date().toTimeString().slice(0, 8);
  S.logs.push({ time, msg, isErr });
  if (S.logs.length > 500) S.logs.splice(0, S.logs.length - 500);
  const body = document.getElementById('log-body');
  const div = document.createElement('div');
  div.className = 'log-line' + (isErr ? ' log-line--err' : '');
  const ts = document.createElement('span');
  ts.className = 't';
  ts.textContent = time;
  div.appendChild(ts);
  div.appendChild(document.createTextNode(msg));
  body.appendChild(div);
  while (body.children.length > 500) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
  const count = document.getElementById('log-count');
  count.textContent = String(S.logs.length);
  count.hidden = S.logs.length === 0;
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
  renderGoal(g);
  try {
    const res = await app.call('loopx.shouldRun', {
      argvPrefix: S.config.argvPrefix,
      projectDir: S.config.projectDir,
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
      log(`[${g.goalId}] decision changed (${res.state ?? '?'}/${res.shouldRun}) → interval ${g.intervalMin}m`);
    } else {
      g.unchangedCount += 1;
      g.intervalMin = Math.min(g.intervalMin * backoff, maxIv);
      const limit = sched.unchangedPollLimit;
      if (limit != null && g.unchangedCount >= limit && sched.afterLimit === 'stop_tick_loop') {
        g.stopped = true;
        log(`[${g.goalId}] unchanged ×${g.unchangedCount} ≥ limit → tick loop stopped`);
      } else {
        log(`[${g.goalId}] unchanged ×${g.unchangedCount} → backoff to ${g.intervalMin.toFixed(1)}m`);
      }
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
      renderGoal(g);
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
      projectDir: S.config.projectDir,
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
      projectDir: S.config.projectDir,
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
    && !!S.config.projectDir && !!g.agentId;
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

// The board mirrors an issue tracker, but attention comes first: the review
// column ("needs you") is pinned leftmost, then the automatic flow columns.
const PRIMARY_GROUPS = ['review', 'active', 'ready', 'backlog'];
const ARCHIVE_GROUPS = ['done', 'paused', 'error'];
const GROUP_I18N_KEY = {
  backlog: 'groupBacklog', ready: 'groupReady', active: 'groupActive', review: 'groupReview',
  done: 'groupDone', paused: 'groupPaused', error: 'groupError',
};

function isTerminal(g) {
  const state = String(g.last?.state || g.state || '').toLowerCase();
  return /(^|_)(terminal|completed|complete|done|cancelled|canceled|duplicate|merged|closed)(_|$)/.test(state)
    || state.includes('no_followup');
}

function goalGroup(g) {
  if (g.running) return 'active';
  if (isTerminal(g)) return 'done';
  if (g.errorCount > 0) return 'error';
  if (g.stopped) return 'paused';
  if (isGated(g)) return 'review';
  if (g.last?.shouldRun === true) return 'ready';
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
  return g.objective || g.last?.recommendedAction || g.last?.reason || g.lastError
    || g.last?.state || g.state || g.goalId;
}

function activityText(line) {
  const text = String(line || '')
    .replace(/^\s*(?:\[[^\]]+\]\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function activityLineElement(entry) {
  const row = document.createElement('div');
  row.className = 'activity-stream__line' + (entry.isErr ? ' activity-stream__line--err' : '');
  const time = document.createElement('span');
  time.className = 'activity-stream__time';
  time.textContent = entry.time;
  const text = document.createElement('span');
  text.textContent = entry.line;
  row.append(time, text);
  return row;
}

function recordGoalActivity(g, line, isErr = false) {
  const summary = activityText(line);
  if (!summary) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const entry = { time: new Date().toTimeString().slice(0, 8), line: summary, isErr };
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
    const dlg = document.getElementById('dlg-goal');
    if (dlg.open && S.activeGoalId === g.goalId) renderGoalDetails(g);
  }
}

function buildIntakeCard(draft) {
  const el = document.createElement('div');
  el.className = 'goal goal--pending';
  const head = document.createElement('div');
  head.className = 'goal__head';
  const dot = document.createElement('span');
  dot.className = 'dot dot--ready';
  const id = document.createElement('span');
  id.className = 'goal__id';
  id.textContent = t('taskPendingLabel');
  head.append(dot, id);
  const narration = document.createElement('div');
  narration.className = 'goal__reason';
  narration.textContent = draft.objective;
  const activity = document.createElement('div');
  activity.className = 'goal__activity goal__activity--live';
  const pulse = document.createElement('span');
  pulse.className = 'goal__activity-dot';
  const text = document.createElement('span');
  text.className = 'goal__activity-text';
  text.textContent = draft.stage;
  activity.append(pulse, text);
  el.append(head, narration, activity);
  return el;
}

function buildGoalCard(g, compact = false) {
  const group = goalGroup(g);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'goal' + (compact ? ' goal--terminal' : '') + (group === 'review' ? ' goal--gated' : '');
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
  if (g.last?.recommendedAction && g.last?.reason) narration.title = g.last.reason;
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
  const dlg = document.getElementById('dlg-goal');
  if (!dlg.open || S.activeGoalId !== g.goalId) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const active = document.activeElement;
  if (active && dlg.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;

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
  const detailReason = g.objective
    ? (g.last?.recommendedAction || g.last?.reason)
    : (g.last?.recommendedAction && g.last?.reason ? g.last.reason : null);
  if (detailReason && detailReason !== goalNarration(g)) {
    const reason = document.createElement('div');
    reason.className = 'detail__reason';
    reason.textContent = detailReason;
    overview.appendChild(reason);
  }
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
        none.textContent = t('waitingOn', (g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn) || '—');
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
  const waiting = g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn;
  appendDetailRow(grid, t('detailState'), waiting ? `${g.last?.state ?? g.state ?? '—'} · ${t('waitingOn', waiting)}` : (g.last?.state ?? g.state));
  appendDetailRow(grid, t('detailAgent'), g.agentId);
  appendDetailRow(grid, t('detailHeartbeat'), g.monitoring ? t('presenceLive') : t('presenceIdle'));
  appendDetailRow(grid, t('detailSchedule'), goalMetaText(g), g.errorCount ? 'countdown--err' : '', g.goalId);
  if (g.lastRun) {
    appendDetailRow(grid, t('detailLastRun'), g.lastRun.cancelled
      ? t('lastRunCancelled')
      : t('lastRun', g.lastRun.exitCode, Math.round((g.lastRun.durationMs || 0) / 1000)),
    !g.lastRun.ok && !g.lastRun.cancelled ? 'goal__lastrun--err' : '');
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
  body.appendChild(controls);

  const actions = document.createElement('div');
  actions.className = 'detail__actions';
  if (g.stopped) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn btn--primary';
    resume.textContent = t('resume');
    resume.onclick = () => pollNow(g);
    actions.appendChild(resume);
  }
  const run = document.createElement('button');
  run.type = 'button';
  run.className = g.running ? 'btn btn--danger' : 'btn btn--primary';
  run.textContent = g.running ? t('cancelRun') : t('runOnce');
  run.onclick = () => g.running ? cancelGoalRun(g, run) : executeRunOnce(g);
  actions.appendChild(run);
  const raw = document.createElement('button');
  raw.type = 'button';
  raw.className = 'btn';
  raw.textContent = t('raw');
  raw.disabled = !g.last;
  raw.onclick = () => showRawJson(g);
  actions.appendChild(raw);
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

function openGoalDetails(g) {
  S.activeGoalId = g.goalId;
  const dlg = document.getElementById('dlg-goal');
  if (!dlg.open) dlg.showModal();
  renderGoalDetails(g);
}

// Fingerprint of everything the goal list displays except per-second
// countdown text (the countdown loop patches those spans in place).
function displayFingerprint() {
  const parts = [
    String(S.goals.size), app.locale,
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

function renderAllGoals(force = false) {
  const list = document.getElementById('goal-list');
  const active = document.activeElement;
  if (!force && active && list.contains(active)
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

  const empty = document.getElementById('goals-empty');
  for (const child of [...list.children]) {
    if (child.id !== 'goals-empty') child.remove();
  }
  const hasVisibleTasks = S.goals.size > 0 || !!S.intakeDraft;
  empty.hidden = hasVisibleTasks;
  // Hero mode: with nothing on the board, the app IS the input box — the
  // layout collapses so the composer sits centered right under the pitch.
  document.getElementById('app').classList.toggle('lx--hero', !hasVisibleTasks);
  if (!hasVisibleTasks) {
    updateHeaderStatus();
    return;
  }
  const buckets = new Map([...PRIMARY_GROUPS, ...ARCHIVE_GROUPS].map((k) => [k, []]));
  for (const g of S.goals.values()) buckets.get(goalGroup(g)).push(g);
  for (const key of PRIMARY_GROUPS) {
    const goals = buckets.get(key);
    const pendingCount = key === 'ready' && S.intakeDraft ? 1 : 0;
    const col = document.createElement('div');
    col.className = `col col--${key}`;

    const head = document.createElement('div');
    head.className = 'col__head';
    const dot = document.createElement('span');
    dot.className = `dot dot--${key}`;
    head.appendChild(dot);
    const title = document.createElement('span');
    title.className = 'col__title';
    title.textContent = t(GROUP_I18N_KEY[key]);
    head.appendChild(title);
    const count = document.createElement('span');
    count.className = 'col__count';
    count.textContent = String(goals.length);
    head.appendChild(count);
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'col__body';
    if (goals.length === 0 && pendingCount === 0) {
      const none = document.createElement('div');
      none.className = 'col__empty';
      none.textContent = t('colEmpty');
      body.appendChild(none);
    }
    if (key === 'ready' && S.intakeDraft) body.appendChild(buildIntakeCard(S.intakeDraft));
    for (const g of goals) body.appendChild(buildGoalCard(g));
    col.appendChild(body);
    list.appendChild(col);
  }
  const archive = document.createElement('aside');
  archive.className = 'archive';
  const archiveHead = document.createElement('div');
  archiveHead.className = 'archive__head';
  const archiveTitle = document.createElement('span');
  archiveTitle.textContent = t('hiddenStates');
  const archiveTotal = document.createElement('span');
  archiveTotal.className = 'archive__count';
  archiveTotal.textContent = String(ARCHIVE_GROUPS.reduce((sum, key) => sum + buckets.get(key).length, 0));
  archiveHead.append(archiveTitle, archiveTotal);
  archive.appendChild(archiveHead);
  const archiveBody = document.createElement('div');
  archiveBody.className = 'archive__body';
  for (const key of ARCHIVE_GROUPS) {
    const goals = buckets.get(key);
    if (goals.length === 0) continue;
    const group = document.createElement('section');
    group.className = 'archive__group' + (S.archiveOpen.has(key) ? ' is-open' : '');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'archive__row';
    const chevron = document.createElement('span');
    chevron.className = 'archive__chevron';
    chevron.textContent = '⌄';
    const dot = document.createElement('span');
    dot.className = `dot dot--${key}`;
    const label = document.createElement('span');
    label.textContent = t(GROUP_I18N_KEY[key]);
    const count = document.createElement('span');
    count.className = 'archive__count';
    count.textContent = String(goals.length);
    row.append(chevron, dot, label, count);
    row.onclick = () => {
      if (S.archiveOpen.has(key)) S.archiveOpen.delete(key); else S.archiveOpen.add(key);
      group.classList.toggle('is-open', S.archiveOpen.has(key));
    };
    const cards = document.createElement('div');
    cards.className = 'archive__cards';
    for (const g of goals) cards.appendChild(buildGoalCard(g, true));
    group.append(row, cards);
    archiveBody.appendChild(group);
  }
  archive.appendChild(archiveBody);
  list.appendChild(archive);
  if (S.activeGoalId) {
    const activeGoal = S.goals.get(S.activeGoalId);
    if (activeGoal) renderGoalDetails(activeGoal);
  }
  updateHeaderStatus();
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
  if (!S.config.projectDir) { log(t('needProject'), true); return; }
  if (!g.agentId) { log(`[${g.goalId}] ${t('needAgent')}`, true); return; }
  g.running = true;
  g.runStartedAt = Date.now();
  g.activityLines = [];
  g.currentActivity = '';
  recordGoalActivity(g, t('activityStarting'));
  renderGoal(g);
  log(`[${g.goalId}] turn started (agent=${g.agentId})`);
  try {
    const composed = await app.call('loopx.turnPrompt', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: S.config.projectDir,
      goalId: g.goalId,
      agentId: g.agentId,
    });
    if (!composed.ok) throw new Error(composed.error || 'turn prompt failed');
    const run = await app.agent.run(composed.prompt, {
      sessionName: `LoopX · ${g.goalId}`,
      sessionId: S.agentSessionByGoal.get(g.goalId) || undefined,
      enableTools: true,
    });
    S.agentSessionByGoal.set(g.goalId, run.sessionId);
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (isLiveGoal(g) && g.running) {
        recordGoalActivity(g, t('activityRunning', fmtCountdown(Date.now() - startedAt)));
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
  renderGoal(g);
  pollNow(g, { force: true }); // fresh decision even while hidden; auto-run re-fires from the poll
}

function goalForAgentSession(sessionId) {
  for (const [goalId, run] of agentRuns) {
    if (run.sessionId === sessionId) return S.goals.get(goalId);
  }
  return null;
}

// Compact progress narration from the agent event stream: tool calls and
// turn boundaries, not raw text chunks.
app.agent.onEvent((e) => {
  const g = goalForAgentSession(e.sessionId);
  if (!g) return;
  if (e.sourceEvent === 'tool-event') {
    const name = e.toolName || e.tool_name || e.name;
    if (name && e.phase !== 'completed') recordGoalActivity(g, String(name));
  } else if (e.sourceEvent === 'dialog-turn-completed') {
    finishRun(g, { ok: true });
  } else if (e.sourceEvent === 'dialog-turn-failed') {
    finishRun(g, { ok: false, error: String(e.error || e.message || 'turn failed') });
  } else if (e.sourceEvent === 'dialog-turn-cancelled') {
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
      argvPrefix: S.config.argvPrefix, projectDir: S.config.projectDir,
    });
    const fresh = new Set();
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
    }
    for (const goalId of [...S.goals.keys()]) {
      if (!fresh.has(goalId)) S.goals.delete(goalId);
    }
    renderAllGoals(true);
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
function updateProjectLabel() {
  const label = document.getElementById('project-label');
  label.textContent = S.config.projectDir || t('globalRegistry');
  label.removeAttribute('data-i18n');
  if (!S.config.projectDir) label.setAttribute('data-i18n', 'globalRegistry');
}

document.getElementById('btn-project').addEventListener('click', async () => {
  try {
    const picked = await app.dialog.open({ directory: true });
    const dir = Array.isArray(picked) ? picked[0] : picked;
    if (!dir) return;
    S.config.projectDir = dir;
    await saveConfig();
    updateProjectLabel();
    S.goals.clear();
    renderAllGoals(true);
    await refreshGoals();
  } catch (err) {
    log(`dialog error: ${err.message || err}`, true);
  }
});

document.getElementById('btn-refresh').addEventListener('click', refreshGoals);
document.getElementById('btn-retry-detect').addEventListener('click', async () => {
  if (await detect()) refreshGoals();
});

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('set-prefix').value = S.config.argvPrefix ? JSON.stringify(S.config.argvPrefix) : '';
  document.getElementById('set-srcdir').value = S.config.srcDir || '';
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
    await saveConfig();
    if (await detect()) refreshGoals();
  };
  dlg.showModal();
});

document.getElementById('btn-logs').addEventListener('click', () => {
  document.getElementById('dlg-logs').showModal();
});
document.getElementById('btn-close-logs').addEventListener('click', () => {
  document.getElementById('dlg-logs').close();
});
document.getElementById('btn-close-goal').addEventListener('click', () => {
  document.getElementById('dlg-goal').close();
});
document.getElementById('dlg-goal').addEventListener('close', () => {
  S.activeGoalId = null;
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
// Mirror of the worker's URL classification, for the composer badge and the
// "supported input" gate. Empty string = no GitHub link found (unsupported).
function taskInputKind(text) {
  const urls = String(text || '').match(/https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi) || [];
  let issues = 0;
  let lists = 0;
  let repos = 0;
  for (const url of urls) {
    try {
      const segments = new URL(url.replace(/[),.;:\]}]+$/g, '')).pathname.split('/').filter(Boolean);
      const type = (segments[2] || '').toLowerCase();
      if (/^(issues|pull)$/.test(type) && /^\d+$/.test(segments[3] || '')) issues += 1;
      else if (type === 'issues' && segments.length === 3) lists += 1;
      else if (segments.length >= 2) repos += 1;
    } catch (_) {}
  }
  if (lists || (repos && !issues)) return t('taskIssuesList');
  if (issues > 1) return t('taskIssues', issues);
  if (issues === 1) return t('taskIssue');
  return '';
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
  const guidable = [...S.goals.values()].filter((g) => !isTerminal(g));

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
    modeSelect.value = '';
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
  S.intakeDraft = { objective, stage: guideGoalId ? t('taskCreating') : t('stageBootstrap') };
  setComposerBusy(true, t('taskCreating'));
  renderAllGoals(true);
  app.call('loopx.taskIntake', {
    argvPrefix: S.config.argvPrefix,
    srcDir: S.config.srcDir || null,
    projectDir: S.config.projectDir,
    objective,
    agentId,
    mode: guideGoalId ? 'guide' : 'new',
    goalId: guideGoalId,
    issues: issues.length ? issues : null,
  }).then((res) => {
    if (res && res.ok === false) {
      // Synchronous refusal (repo checks) — no done event will follow.
      S.intakeDraft = null;
      renderAllGoals(true);
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
    renderAllGoals(true);
    setComposerBusy(false, '');
    setTaskFeedback(String(err.message || err), 'error');
    log(`task intake error: ${err.message || err}`, true);
  });
}

app.on('worker:taskIntake:progress', (d) => {
  if (!S.intakeDraft) return;
  const stages = {
    expand: t('stageExpand'),
    bootstrap: t('stageBootstrap'),
    register: t('stageRegister'),
    plan: t('stagePlan'),
    todos: d.total ? t('stageTodos', d.current || 0, d.total) : t('taskCreating'),
    refresh: t('stageRefresh'),
  };
  S.intakeDraft.stage = stages[d.stage] || t('taskCreating');
  setTaskFeedback(S.intakeDraft.stage);
  renderAllGoals(true);
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
    renderAllGoals(true);
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
  await refreshGoals();
  S.intakeDraft = null;
  const goal = S.goals.get(result.goalId);
  if (goal) {
    if (result.mode === 'new') {
      goal.agentId = S.config.agentByGoal[result.goalId] || goal.agentId;
      goal.autoRun = true;
      goal.autoFailCount = 0;
    }
    renderAllGoals(true);
    // refreshGoals already polled the goal; a should_run=true decision fires
    // the first turn through maybeAutoRun — one launch path, no races.
    pollNow(goal, { force: true });
  } else {
    renderAllGoals(true);
  }
});

async function createTaskFromInput() {
  const input = document.getElementById('task-input');
  const objective = input.value.trim();
  if (!objective) { input.focus(); return; }
  // Issue-fix is the one polished scenario; free-form goals wait until they
  // can bind to specific loopx capabilities.
  if (!taskInputKind(objective)) {
    setTaskFeedback(t('taskGoalUnsupported'), 'error');
    return;
  }
  if (!S.config.projectDir) {
    setTaskFeedback(t('taskNeedProject'), 'error');
    return;
  }
  if (!resolveDefaultAgent()) {
    setTaskFeedback(t('taskNeedAgent'), 'error');
    return;
  }
  setComposerBusy(true, t('taskResolving'));
  let resolved;
  try {
    resolved = await app.call('loopx.resolveIntake', {
      projectDir: S.config.projectDir,
      objective,
    });
  } catch (err) {
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
  // A plain goal with nothing else running has neither — create directly.
  const guidable = [...S.goals.values()].filter((g) => !isTerminal(g));
  if (resolved.issues.length < 2 && guidable.length === 0) {
    startTaskIntake({ resolved, objective, selected: new Set(resolved.issues.map((i) => i.url)) }, null);
    return;
  }
  openIntakeSheet(resolved, objective);
}

document.getElementById('task-input').addEventListener('input', () => {
  updateTaskKind();
  setTaskFeedback('');
});
document.getElementById('task-input').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    createTaskFromInput();
  }
});
document.getElementById('btn-create-task').addEventListener('click', createTaskFromInput);


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
  updateProjectLabel();
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
  await loadConfig();
  applyI18n();
  startCountdownLoop();
  updateHeaderStatus();
  if (await detect()) await refreshGoals();
})();
