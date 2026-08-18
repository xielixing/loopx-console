// LoopX Console — MARKET edition runtime (no Node worker).
//
// BitFun marketplace packages cannot run a Node/Bun worker, so the whole
// loopx bridge is re-implemented here, in the page, on top of the host
// framework primitives (app.shell.exec argv arrays, app.fs.*, app.net.fetch).
// The UI bundle (source/ui.js) is appended verbatim after this module and
// keeps calling `app.call('loopx.*', …)` — we monkey-patch app.call to route
// those methods here, and we re-dispatch the worker:taskIntake:* events the
// UI listens to.
//
// Contract notes (host side, verified against BitFun source):
//   - shell.exec({args:[…], timeout, cwd}) -> {stdout, stderr, exit_code};
//     non-zero exits reject with the stderr message.
//   - fs.readFile -> string; fs.readdir -> [{name,path,isDirectory}];
//     fs.stat -> {size,isDirectory,isFile}; fs.mkdir(path,{recursive}).
//   - net.fetch(url,{method,headers}) -> {status, headers, body}.
//   - Market shell.exec forbids interpreters/shells (python/pip/node/…):
//     only the loopx console-script exe and git are usable, so detection
//     probes just `loopx`, and bootstrap installs happen in the user's own
//     terminal (see the not-found banner instructions).

(function () {
  const app = window.app;

  // ── small path helpers (platform-agnostic string ops) ──────────────
  const SEP = /[\\/]+/;
  const joinP = (...parts) => parts.filter(Boolean).join('/').replace(SEP, '/');
  const dirnameP = (p) => {
    const trimmed = String(p || '').replace(/[\\/]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return idx <= 0 ? trimmed : trimmed.slice(0, idx);
  };

  // The compiled bridge exposes the user's workspace dir; derive stable
  // per-user paths from it (survives MiniApp deletion/re-import).
  const wsRoot = typeof app.workspaceDir === 'string' ? app.workspaceDir : '';
  const homeDir = dirnameP(dirnameP(dirnameP(wsRoot))) || '~';
  const cloneCacheRoot = joinP(homeDir, '.bitfun', 'loopx-console', 'repos');
  const globalRegistryPath = joinP(homeDir, '.codex', 'loopx', 'registry.global.json');
  const scanRoot = joinP(app.appDataDir, '.loopx-scan-root');

  // ── host primitive wrappers ────────────────────────────────────────
  const shellExec = (args, timeoutMs) => app.shell.exec({ args, timeout: timeoutMs || 30000 });

  async function tryStat(p) {
    try { return await app.fs.stat(p); } catch (_) { return null; }
  }
  async function existsDir(p) {
    const st = await tryStat(p);
    return !!(st && st.isDirectory);
  }
  async function readText(p) {
    const value = await app.fs.readFile(p);
    return typeof value === 'string' ? value : String(value || '');
  }

  function ensureScanRoot() {
    app.fs.mkdir(scanRoot, { recursive: true }).catch(() => {});
    return scanRoot;
  }

  // ── loopx invocation ───────────────────────────────────────────────
  // Non-zero exits REJECT from the host with stderr in the message; mirror
  // the worker's {code, stdout, stderr, payload} shape for the UI.
  function parseJsonPayload(stdout) {
    const text = String(stdout || '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) {}
    const start = text.indexOf('{');
    if (start >= 0) {
      try { return JSON.parse(text.slice(start)); } catch (_) {}
      const end = text.lastIndexOf('}');
      if (end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
      }
    }
    return null;
  }

  function registryArgs(projectDir) {
    if (!projectDir) return []; // loopx falls back to its global registry
    return ['--registry', joinP(projectDir, '.loopx', 'registry.json')];
  }

  async function runLoopx(projectDir, args, timeoutMs) {
    try {
      const out = await shellExec(['loopx', '--format', 'json', ...registryArgs(projectDir), ...args], timeoutMs);
      return { code: out.exit_code ?? 0, stdout: out.stdout || '', stderr: out.stderr || '', payload: parseJsonPayload(out.stdout) };
    } catch (err) {
      return { code: -1, stdout: '', stderr: String((err && err.message) || err), payload: null };
    }
  }

  // ── registry / goal state helpers ──────────────────────────────────
  async function readRegistry(projectDir) {
    const registryPath = projectDir ? joinP(projectDir, '.loopx', 'registry.json') : globalRegistryPath;
    try {
      return { registryPath, registry: JSON.parse(await readText(registryPath)) };
    } catch (_) {
      return { registryPath, registry: null };
    }
  }

  function normalizeScheduler(schedulerHint) {
    if (!schedulerHint || typeof schedulerHint !== 'object') return null;
    const cold = schedulerHint.cold_path_detail && schedulerHint.cold_path_detail.local_scheduler;
    const codexApp = schedulerHint.codex_app || {};
    const local = cold || {};
    const resetPolicy = schedulerHint.reset_policy || {};
    const unchangedPoll = schedulerHint.unchanged_poll || {};
    const limits = unchangedPoll.limits || {};
    const afterLimits = unchangedPoll.after_limits || {};
    return {
      recommendedIntervalMinutes:
        local.recommended_interval_minutes ?? codexApp.recommended_interval_minutes ?? null,
      maxIntervalMinutes: local.max_interval_minutes ?? codexApp.max_interval_minutes ?? null,
      backoffMultiplier: local.unchanged_poll_backoff_multiplier ?? null,
      unchangedPollLimit: local.unchanged_poll_limit ?? limits.local_scheduler ?? null,
      afterLimit: local.after_limit ?? afterLimits.local_scheduler ?? null,
      exampleProgression: local.example_progression_minutes ?? null,
      resetToken: resetPolicy.reset_token ?? null,
      cadenceClass: schedulerHint.cadence_class ?? null,
      action: schedulerHint.action ?? null,
      unchangedIdentityKeys: Array.isArray(schedulerHint.unchanged_identity_keys)
        ? schedulerHint.unchanged_identity_keys
        : null,
      source: cold ? 'local_scheduler' : 'codex_app_fallback',
    };
  }

  function turnPreamble({ projectDir, goalId, agentId }) {
    const registry = joinP(projectDir, '.loopx', 'registry.json');
    return [
      `你是 LoopX 目标 "${goalId}" 的执行 agent（agent_id: ${agentId}）。`,
      `仓库目录：${projectDir}`,
      `LoopX 注册表：${registry} —— 调用 loopx 命令时始终带上 --registry "${registry}"。`,
      'loopx CLI 已安装并位于 PATH（备用方式：python -m loopx.cli）；每轮最多执行一次 "loopx --version"、"where loopx" 之类的探测。',
      '环境说明：命令在 PowerShell 中运行，不是 bash。loopx 示例命令里以 --turn-instance-id "${LOOPX_TURN:?}" 结尾的写法是 bash 语法 —— 不要照抄；--turn-instance-id 是可选参数，直接省略。',
      '规则：只在仓库目录内工作；不要强杀不是你启动的进程；',
      '在结束本轮前，通过 loopx（todo complete / 证据记录）记录进度。',
      '如果 loopx 命令失败，先读错误信息再修正调用方式 —— 同一命令不要盲目重试超过两次。',
      '工作语言：所有面向用户的说明、总结与回复请使用中文。',
      '',
    ].join('\n');
  }

  // Strict intake grammar (identical to the worker edition).
  function githubReferences(text) {
    const refs = [];
    const unsupported = [];
    const seen = new Set();
    const pattern = /https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi;
    for (const match of String(text || '').matchAll(pattern)) {
      const rawUrl = match[0].replace(/[),.;:\]}]+$/g, '');
      let parsed;
      try { parsed = new URL(rawUrl); } catch (_) { continue; }
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 2) {
        unsupported.push({ url: rawUrl, reason: 'not_a_repository' });
        continue;
      }
      const owner = segments[0].toLowerCase();
      const repoName = segments[1].replace(/\.git$/i, '').toLowerCase();
      if (!owner || !repoName) continue;
      const type = (segments[2] || '').toLowerCase();
      const isIssueItem = /^(issues|pull)$/.test(type)
        && segments.length === 4
        && /^\d+$/.test(segments[3] || '');
      const isIssuesList = type === 'issues' && segments.length === 3;
      const isRepoRoot = segments.length === 2;
      const repo = `${owner}/${repoName}`;
      let kind = null;
      let url = null;
      let number = null;
      if (isIssueItem) {
        kind = type === 'issues' ? 'issue' : 'pr';
        number = Number(segments[3]);
        url = `https://github.com/${repo}/${type}/${number}`;
      } else if (isIssuesList) {
        kind = 'issues-list';
        url = `https://github.com/${repo}/issues`;
      } else if (isRepoRoot) {
        kind = 'repository';
        url = `https://github.com/${repo}`;
      } else {
        unsupported.push({
          url: `https://github.com/${repo}/${segments.slice(2).join('/')}`,
          reason: 'unsupported_path',
        });
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      refs.push({ url, repo, kind, number });
    }
    return { refs, unsupported };
  }

  function normalizeGithubRemote(value) {
    const text = String(value || '').trim();
    const match = text.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
    return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
  }

  async function projectGithubRepository(projectDir) {
    if (!projectDir) return null;
    try {
      const config = await readText(joinP(projectDir, '.git', 'config'));
      const origin = config.match(/\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/i);
      if (origin) return normalizeGithubRemote(origin[1]);
      const anyRemote = config.match(/\n\s*url\s*=\s*([^\r\n]+)/i);
      return anyRemote ? normalizeGithubRemote(anyRemote[1]) : null;
    } catch (_) {
      return null;
    }
  }

  async function uniqueGoalId(projectDir, objective, refs) {
    // loopx enforces GLOBAL uniqueness of goal ids: union the project and
    // global registry ids so a stale global route never collides.
    const existing = new Set();
    for (const dir of [projectDir, null]) {
      const { registry } = await readRegistry(dir);
      for (const goal of (registry && registry.goals) || []) {
        const id = goal.goal_id || goal.id;
        if (id) existing.add(id);
      }
    }
    const issueRefs = refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr');
    const listRef = refs.find((ref) => ref.kind === 'issues-list');
    let base;
    if (listRef) {
      base = `${listRef.repo.split('/')[1]}-issues`;
    } else if (issueRefs.length === 1) {
      base = `${issueRefs[0].repo.split('/')[1]}-issue-${issueRefs[0].number}`;
    } else if (issueRefs.length > 1) {
      base = `${issueRefs[0].repo.split('/')[1]}-issues`;
    } else {
      base = String(objective)
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42);
    }
    if (!base) {
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      base = `task-${stamp}`;
    }
    base = `bfx-${base}`;
    let goalId = base;
    let suffix = 2;
    while (existing.has(goalId)) goalId = `${base}-${suffix++}`;
    return goalId;
  }

  async function readGoalObjective(projectDir, goal) {
    const stateFile = goal && goal.state_file;
    if (!stateFile) return null;
    const root = projectDir || goal.repo;
    if (!root) return null;
    try {
      const content = await readText(joinP(root, stateFile));
      const yaml = content.match(/^objective:\s*(.+)$/m);
      if (yaml) {
        const raw = yaml[1].trim();
        if (raw.startsWith('"')) {
          try { return JSON.parse(raw); } catch (_) {}
        }
        return raw.replace(/^['"]|['"]$/g, '');
      }
      const section = content.match(/## Objective\s+([\s\S]*?)(?:\n## |$)/);
      return section ? section[1].trim() : null;
    } catch (_) {
      return null;
    }
  }

  // ── GitHub REST (host net.fetch, allow-listed hosts) ───────────────
  async function repoExistsOnGithub(repo) {
    try {
      const res = await app.net.fetch(`https://api.github.com/repos/${repo}`, {
        headers: { 'User-Agent': 'BitFun-LoopX-Console', Accept: 'application/vnd.github+json' },
      });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      return true; // rate limits / server errors: let the clone attempt decide
    } catch (_) {
      throw new Error(`repository lookup failed: ${_ && _.message ? _.message : _}`);
    }
  }

  async function fetchOpenIssues(repo) {
    const issues = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await app.net.fetch(
        `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`,
        {
          headers: {
            'User-Agent': 'BitFun-LoopX-Console',
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers && res.headers['x-ratelimit-remaining'];
        throw new Error(remaining === '0'
          ? 'GitHub API rate limit exceeded (anonymous quota is 60 requests/hour); retry later'
          : `GitHub API refused the request (HTTP ${res.status})`);
      }
      if (res.status === 404) {
        throw new Error(`GitHub repository not found (or private): ${repo}`);
      }
      if (res.status !== 200) {
        throw new Error(`GitHub API HTTP ${res.status} for ${repo} issues page ${page}`);
      }
      let batch;
      try { batch = JSON.parse(res.body || '[]'); } catch (err) {
        throw new Error(`GitHub API returned invalid JSON: ${err.message}`);
      }
      if (!Array.isArray(batch)) break;
      for (const item of batch) {
        if (!item || item.pull_request || !item.number) continue;
        issues.push({
          number: item.number,
          title: item.title || `#${item.number}`,
          url: `https://github.com/${repo}/issues/${item.number}`,
          labels: (item.labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean),
          comments: item.comments ?? 0,
          updatedAt: item.updated_at || null,
        });
      }
      if (batch.length < 100) return { issues, truncated: false };
    }
    return { issues, truncated: true };
  }

  // ── auto-clone (stable per-user cache, identical layout to the worker
  //    edition so both editions share the same checkouts) ─────────────
  function cloneTargetDir(repo) {
    const safe = repo.replace(/[^A-Za-z0-9._-]/g, '-');
    return joinP(cloneCacheRoot, safe);
  }

  async function cloneRepository(repo, emit) {
    const target = cloneTargetDir(repo);
    if (await existsDir(joinP(target, '.git'))) {
      emit({ detail: 'cached' });
      return target;
    }
    await app.fs.mkdir(dirnameP(target), { recursive: true });
    const url = `https://github.com/${repo}.git`;
    emit({ detail: 'start', url });
    await shellExec(['git', 'clone', '--progress', url, target], 600000);
    return target;
  }

  async function planIssueIntake({ projectDir, url }) {
    const planArgsBase = ['issue-fix', 'workflow-plan', '--url', String(url).trim()];
    if (projectDir) planArgsBase.push('--repo-path', projectDir);
    let run = await runLoopx(projectDir, [
      ...planArgsBase, '--fetch-metadata', '--fetch-timeout-seconds', '20',
    ], 90000);
    let payload = run.payload;
    let fetchedMetadata = true;
    const planEmpty = (value) => !value || value.ok === false
      || !(value.ordered_loopx_todo_writeback_preview || []).length;
    if (planEmpty(payload)) {
      fetchedMetadata = false;
      run = await runLoopx(projectDir, planArgsBase, 90000);
      payload = run.payload;
    }
    if (!payload) {
      return { ok: false, error: run.stderr.trim() || 'loopx returned no JSON payload', raw: null };
    }
    const preview = (payload.ordered_loopx_todo_writeback_preview || [])
      .filter((entry) => entry && entry.task_class && entry.text)
      .map((entry) => ({
        order: entry.planner_order ?? null,
        role: entry.role || 'agent',
        priority: entry.priority ?? null,
        taskClass: entry.task_class,
        actionKind: entry.action_kind ?? null,
        text: entry.text,
      }));
    return {
      ok: run.code === 0 && payload.ok !== false,
      fetchedMetadata,
      issueSignal: payload.issue_signal ?? null,
      branchPlan: payload.branch_plan ?? null,
      feasibilityRoutes: payload.feasibility_checkpoint_plan?.routes ?? null,
      todosPreview: preview,
      raw: payload,
    };
  }

  async function writePlannedTodos({ projectDir, goalId, agentId, intake }) {
    const preview = intake.todosPreview || [];
    if (!preview.length) return { ...intake, ok: false, error: 'workflow-plan produced no writable todos' };
    const repoLabel = (intake.issueSignal?.repo || '').toLowerCase() || null;
    const written = [];
    for (const todo of preview) {
      const args = [
        'todo', 'add', '--goal-id', goalId, '--role', todo.role,
        '--task-class', todo.taskClass, '--text', todo.text,
      ];
      if (todo.actionKind) args.push('--action-kind', todo.actionKind);
      if (repoLabel) args.push('--task-repository', `git:github.com/${repoLabel}`);
      if (todo.role === 'agent' && agentId) args.push('--claimed-by', agentId);
      try {
        const response = await runLoopx(projectDir, args, 60000);
        const ok = response.code === 0 && response.payload?.ok !== false;
        // Plan-level user gates were implicitly approved by the intake
        // confirmation — complete them immediately so the task auto-runs.
        if (ok && todo.role === 'user' && response.payload?.todo_id) {
          const completeArgs = [
            'todo', 'complete', '--goal-id', goalId,
            '--todo-id', response.payload.todo_id,
            '--note', 'approved by task intake confirmation',
          ];
          if (todo.taskClass === 'user_gate') completeArgs.push('--decision-outcome', 'approve');
          try {
            await runLoopx(projectDir, completeArgs, 60000);
          } catch (_) {}
        }
        written.push({
          actionKind: todo.actionKind,
          ok,
          todoId: response.payload?.todo_id ?? null,
          error: ok ? null : (response.payload?.error || response.stderr.slice(0, 200) || 'todo add failed'),
        });
      } catch (err) {
        written.push({ actionKind: todo.actionKind, ok: false, todoId: null, error: String(err.message || err) });
      }
    }
    return { ...intake, written, ok: intake.ok && written.every((entry) => entry.ok) };
  }

  // ── local event redispatch (worker:taskIntake:* → UI handlers) ─────
  function emitLocal(event, data) {
    const handlers = (app._eventHandlers && app._eventHandlers[event]) || [];
    for (const handler of handlers) {
      try { handler(data); } catch (_) {}
    }
  }

  // Token-authenticated GitHub REST request through the host's net bridge
  // (api.github.com is allow-listed). allow404 resolves null instead of
  // rejecting, used by the fork existence probe.
  const ghApi = async (token, apiPath, method = 'GET', jsonBody = null, allow404 = false) => {
    const res = await app.net.fetch(`https://api.github.com${apiPath}`, {
      method,
      headers: {
        'User-Agent': 'BitFun-LoopX-Console',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(jsonBody !== null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(jsonBody !== null ? { body: JSON.stringify(jsonBody) } : {}),
    });
    if (allow404 && res.status === 404) return null;
    if (res.status === 401) throw new Error('GitHub token is invalid or expired');
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub API refused the request (rate limit or scope problem)');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GitHub API HTTP ${res.status} for ${method} ${apiPath}`);
    }
    try { return JSON.parse(res.body); } catch (_) { return {}; }
  };

  // ── the loopx.* method table ───────────────────────────────────────
  const Lx = {
    async 'loopx.detect'({ argvPrefix = null, srcDir = null } = {}) {
      const probes = [];
      // Market shells forbid python/py: only the loopx console script.
      const candidates = [['loopx']];
      if (Array.isArray(argvPrefix) && argvPrefix.length) candidates.unshift(argvPrefix);
      // Absolute fallbacks for a restricted worker PATH (pip console-script
      // lives under %LOCALAPPDATA%\Programs\Python\<ver>\Scripts).
      try {
        const pyRoot = joinP(homeDir, 'AppData', 'Local', 'Programs', 'Python');
        const entries = await app.fs.readdir(pyRoot);
        for (const entry of (Array.isArray(entries) ? entries : [])) {
          if (entry && entry.isDirectory === true && /^Python\d+$/.test(entry.name)) {
            candidates.push([joinP(pyRoot, entry.name, 'Scripts', 'loopx.exe')]);
          }
        }
      } catch (_) {}
      let found = null;
      for (const prefix of candidates) {
        try {
          const out = await shellExec([...prefix, '--version'], 8000);
          const version = ((out.stdout || '') + (out.stderr || '')).trim().split(/\r?\n/)[0] || '';
          probes.push({ argvPrefix: prefix, ok: true, version });
          found = { argvPrefix: prefix, version };
          break;
        } catch (err) {
          probes.push({ argvPrefix: prefix, ok: false, error: String((err && err.message) || err) });
        }
      }
      return found
        ? { found: true, argvPrefix: found.argvPrefix, version: found.version, probes }
        : { found: false, argvPrefix: null, version: null, probes };
    },

    async 'loopx.installLoopx'() {
      // The marketplace shell allowlist forbids interpreters (pip/python),
      // so the one-click install cannot run here. The banner command must be
      // executed in the user's own terminal.
      return {
        ok: false,
        error: 'market sandbox forbids pip — run: pip install git+https://github.com/huangruiteng/loopx.git in your own terminal',
      };
    },

    async 'loopx.doctor'({ projectDir = null } = {}) {
      const { code, payload, stderr } = await runLoopx(projectDir, ['doctor'], 60000);
      return { ok: code === 0, payload, stderr };
    },

    async 'loopx.adoptGoal'({ projectDir = null, goalId, agentId } = {}) {
      if (!goalId) throw new Error('loopx.adoptGoal: goalId is required');
      if (!agentId) return { ok: true, goalId, registered: false, error: null };
      const { code, payload, stderr } = await runLoopx(projectDir, [
        'register-agent', '--goal-id', goalId, '--agent-id', agentId, '--execute',
      ], 60000);
      const ok = code === 0 && payload?.ok !== false;
      return {
        ok,
        goalId,
        registered: ok,
        error: ok ? null : (payload?.error || stderr.slice(0, 300) || 'agent registration failed'),
      };
    },

    async 'loopx.guideGoal'({ projectDir = null, goalId, agentId = null, text } = {}) {
      if (!goalId) throw new Error('loopx.guideGoal: goalId is required');
      const message = String(text || '').trim();
      if (!message) throw new Error('loopx.guideGoal: text is required');
      if (message.length > 2000) throw new Error('loopx.guideGoal: text is too long (max 2000 characters)');
      const args = [
        'todo', 'add', '--goal-id', goalId,
        '--role', 'user', '--task-class', 'user_action', '--text', message,
      ];
      if (agentId) args.push('--bound-agent', agentId);
      const { code, payload, stderr } = await runLoopx(projectDir, args, 60000);
      const ok = code === 0 && payload?.ok !== false;
      return {
        ok,
        goalId,
        todoId: payload?.todo_id ?? null,
        error: ok ? null : (payload?.error || stderr.slice(0, 300) || 'todo add failed'),
      };
    },

    async 'loopx.resolveIntake'({ projectDir = null, projectDirs = null, objective } = {}) {
      const text = String(objective || '').trim();
      if (!text) throw new Error('loopx.resolveIntake: objective is required');
      const { refs, unsupported } = githubReferences(text);
      if (unsupported.length) {
        return {
          ok: false,
          code: 'unsupported_github_path',
          url: unsupported[0].url,
          error: `Unsupported GitHub link: ${unsupported[0].url}. Paste an issue, a pull request, the repository home, or its issues list.`,
        };
      }
      if (!refs.length) {
        return {
          ok: false,
          code: 'unsupported_input',
          error: 'Paste a GitHub issue, pull request, repository, or issues-list link.',
        };
      }
      const issueRefs = refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr');
      const listRefs = refs.filter((ref) => ref.kind === 'issues-list');
      const requestedRepos = [...new Set(refs.map((ref) => ref.repo))];
      const projectRepo = await projectGithubRepository(projectDir);
      if (requestedRepos.length > 1) {
        return { ok: false, code: 'multiple_repositories', requestedRepos, projectRepo };
      }
      if (requestedRepos.length === 1 && projectRepo && requestedRepos[0] !== projectRepo) {
        return {
          ok: false,
          code: 'repository_mismatch',
          requestedRepo: requestedRepos[0],
          projectRepo,
        };
      }
      if (requestedRepos.length === 1 && !projectRepo && projectDir) {
        return {
          ok: false,
          code: 'repository_unverified',
          requestedRepo: requestedRepos[0],
          projectRepo: null,
        };
      }
      let reuseDir = null;
      if (requestedRepos.length === 1 && !projectDir) {
        const searchDirs = Array.isArray(projectDirs)
          ? projectDirs.filter((dir) => typeof dir === 'string' && dir)
          : [];
        // The stable clone cache is searched too, so a fresh MiniApp import
        // (empty config) reuses the cached checkout immediately.
        try {
          const entries = await app.fs.readdir(cloneCacheRoot);
          for (const entry of Array.isArray(entries) ? entries : []) {
            if (entry && entry.isDirectory === true) searchDirs.push(entry.path);
          }
        } catch (_) {}
        for (const dir of searchDirs) {
          if (await projectGithubRepository(dir) === requestedRepos[0]) {
            reuseDir = dir;
            break;
          }
        }
      }
      let autoClone = false;
      if (requestedRepos.length === 1 && !projectDir && !reuseDir) {
        let exists = true;
        try {
          exists = await repoExistsOnGithub(requestedRepos[0]);
        } catch (err) {
          return {
            ok: false,
            code: 'repository_lookup_failed',
            requestedRepo: requestedRepos[0],
            error: `Could not verify ${requestedRepos[0]} on GitHub: ${err.message}`,
          };
        }
        if (!exists) {
          return {
            ok: false,
            code: 'repository_not_found',
            requestedRepo: requestedRepos[0],
            error: `GitHub repository not found: ${requestedRepos[0]}`,
          };
        }
        autoClone = true;
      }
      let issues = issueRefs.filter((ref) => ref.kind === 'issue').map((ref) => ({
        number: ref.number, title: `#${ref.number}`, url: ref.url, fromList: false,
      }));
      let kind = issueRefs.length ? (issueRefs.length > 1 ? 'issues' : 'issue') : 'repository';
      let truncated = false;
      const repoRefs = refs.filter((ref) => ref.kind === 'repository');
      const expandRepo = listRefs.length ? listRefs[0].repo
        : (repoRefs.length && !issueRefs.length ? repoRefs[0].repo : null);
      if (expandRepo) {
        kind = 'issues-list';
        const fetched = await fetchOpenIssues(expandRepo);
        truncated = fetched.truncated;
        const seenSet = new Set(issues.map((issue) => issue.url));
        for (const issue of fetched.issues) {
          if (!seenSet.has(issue.url)) issues.push({ ...issue, fromList: true });
        }
      }
      return {
        ok: true,
        kind,
        repo: (refs[0] && refs[0].repo) || projectRepo || null,
        projectRepo,
        reuseDir,
        issues,
        truncated,
        prCount: issueRefs.filter((ref) => ref.kind === 'pr').length,
        autoClone,
      };
    },

    async 'loopx.deleteGoal'({ projectDir = null, goalId } = {}) {
      if (!goalId) throw new Error('loopx.deleteGoal: goalId is required');
      const archive = await runLoopx(projectDir, [
        'archive-runtime', '--goal-id', goalId, '--allow-registered', '--execute',
      ], 120000);
      const archived = archive.code === 0 && archive.payload?.ok !== false;
      if (!archived) {
        return {
          ok: false,
          goalId,
          archived: false,
          registryRemoved: false,
          error: archive.payload?.error || archive.stderr.trim() || 'archive-runtime failed',
        };
      }
      // Best-effort registry entry removal. The market sandbox allows fs
      // writes only under {appdata}, so cached-clone registries under ~
      // usually cannot be rewritten — degrade honestly.
      let registryRemoved = false;
      try {
        const registryPath = projectDir
          ? joinP(projectDir, '.loopx', 'registry.json')
          : globalRegistryPath;
        const registry = JSON.parse(await readText(registryPath));
        if (Array.isArray(registry.goals)) {
          const before = registry.goals.length;
          registry.goals = registry.goals.filter((goal) => (goal.goal_id || goal.id) !== goalId);
          if (registry.goals.length < before) {
            registry.updated_at = new Date().toISOString();
            await app.fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
            registryRemoved = true;
          }
        }
      } catch (_) {}
      // Also drop the global route (loopx keeps one per goal; a leftover
      // collides with the next bootstrap reusing the same base id).
      try {
        const greg = JSON.parse(await readText(globalRegistryPath));
        if (Array.isArray(greg.goals)) {
          const before = greg.goals.length;
          greg.goals = greg.goals.filter((goal) => (goal.goal_id || goal.id) !== goalId);
          if (greg.goals.length < before) {
            greg.updated_at = new Date().toISOString();
            await app.fs.writeFile(globalRegistryPath, JSON.stringify(greg, null, 2));
          }
        }
      } catch (_) {}
      return {
        ok: true,
        goalId,
        archived,
        registryRemoved,
        archivePath: archive.payload?.archive_path ?? null,
        warning: registryRemoved ? null : 'runtime archived, but the registry entry could not be removed',
      };
    },

    async 'loopx.listTodos'({ projectDir = null, goalId, role = null, status = null } = {}) {
      if (!goalId) throw new Error('loopx.listTodos: goalId is required');
      const { code, payload, stderr } = await runLoopx(projectDir, ['todo', 'list', '--goal-id', goalId], 60000);
      let todos = (payload && payload.todos) || [];
      if (role) todos = todos.filter((todo) => todo.role === role);
      if (status) todos = todos.filter((todo) => todo.status === status);
      return { ok: code === 0, todos, error: code === 0 ? null : stderr.slice(0, 300) };
    },

    async 'loopx.completeTodo'({
      projectDir = null, goalId, todoId, note = null, decisionOutcome = null,
    } = {}) {
      if (!goalId || !todoId) throw new Error('loopx.completeTodo: goalId and todoId are required');
      const args = ['todo', 'complete', '--goal-id', goalId, '--todo-id', todoId];
      if (decisionOutcome) args.push('--decision-outcome', decisionOutcome);
      if (note) args.push('--note', note);
      const { code, payload, stderr } = await runLoopx(projectDir, args, 60000);
      const ok = code === 0 && payload?.ok !== false;
      return { ok, payload, error: ok ? null : (payload?.error || stderr.slice(0, 300) || 'todo complete failed') };
    },

    async 'loopx.githubUser'({ token = null } = {}) {
      if (!token) throw new Error('loopx.githubUser: token is required');
      const user = await ghApi(token, '/user');
      return { ok: true, login: user && user.login ? user.login : null };
    },

    // Publish the current fix branch as a PR through the user's fork. Same
    // protocol as the worker edition; git rides the host shell (argv-only,
    // git is allow-listed), REST rides app.net.fetch.
    async 'loopx.publishPr'({
      projectDir = null, goalId = null, token = null, title = '', body = '', branch: requestedBranch = null,
    } = {}) {
      if (!projectDir) throw new Error('loopx.publishPr: projectDir is required');
      if (!token) throw new Error('loopx.publishPr: token is required');
      const runGit = (args, timeoutMs = 60000) => app.shell.exec({
        args: ['git', ...args], timeout: timeoutMs, cwd: projectDir,
      });
      let r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
      if (r.exit_code !== 0) throw new Error(`git rev-parse failed: ${r.stderr.trim().slice(0, 200)}`);
      let branch = String(r.stdout || '').trim();
      if (!branch || branch === 'HEAD') throw new Error('publishPr: the checkout is in detached HEAD state');
      // Prefer the branch named by the gate item; keep HEAD when unknown.
      if (requestedBranch && requestedBranch !== branch) {
        const check = await runGit(['rev-parse', '--verify', `refs/heads/${requestedBranch}`], 20000);
        if (check.exit_code === 0) branch = requestedBranch;
      }
      r = await runGit(['remote', 'get-url', 'origin']);
      const repoMatch = String(r.stdout || '').match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
      if (!repoMatch) throw new Error(`publishPr: cannot parse repository from origin "${String(r.stdout).trim()}"`);
      const owner = repoMatch[1];
      const repo = repoMatch[2].replace(/\.git$/i, '');
      const user = await ghApi(token, '/user');
      const login = String((user && user.login) || '').trim();
      if (!login) throw new Error('publishPr: GitHub token did not resolve a login');

      let fork = await ghApi(token, `/repos/${login}/${repo}`, 'GET', null, true);
      if (!fork) {
        await ghApi(token, `/repos/${owner}/${repo}/forks`, 'POST', {});
        for (let i = 0; i < 30 && !fork; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          fork = await ghApi(token, `/repos/${login}/${repo}`, 'GET', null, true);
        }
        if (!fork) throw new Error('publishPr: the fork did not become ready within 2 minutes');
      }

      const pushUrl = `https://x-access-token:${token}@github.com/${login}/${repo}.git`;
      r = await runGit(['push', pushUrl, `HEAD:refs/heads/${branch}`], 300000);
      if (r.exit_code !== 0) {
        throw new Error(String(r.stderr || '').split(token).join('***').trim().slice(0, 300) || 'git push failed');
      }

      const upstream = await ghApi(token, `/repos/${owner}/${repo}`);
      const base = (upstream && upstream.default_branch) || 'main';
      let pr;
      try {
        pr = await ghApi(token, `/repos/${owner}/${repo}/pulls`, 'POST', {
          title, head: `${login}:${branch}`, base, body,
        });
      } catch (err) {
        const existing = await ghApi(token, `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${login}:${branch}`)}`);
        const found = Array.isArray(existing) && existing[0];
        if (!found) throw err;
        pr = found;
      }
      const prUrl = pr && pr.html_url ? pr.html_url : '';
      if (!prUrl) throw new Error('publishPr: GitHub did not return a PR url');
      return {
        ok: true,
        prUrl,
        prNumber: pr.number ?? null,
        branch,
        forkUrl: (fork && fork.html_url) || `https://github.com/${login}/${repo}`,
      };
    },

    async 'loopx.taskIntake'({
      projectDir = null,
      objective,
      agentId,
      mode = 'new',
      goalId = null,
      autoClone = false,
      issues = null,
    } = {}) {
      const text = String(objective || '').trim();
      if (!projectDir && !autoClone) throw new Error('loopx.taskIntake: a local project directory is required (or enable autoClone)');
      if (!text) throw new Error('loopx.taskIntake: objective is required');
      if (text.length > 4000) throw new Error('loopx.taskIntake: objective is too long (max 4000 characters)');
      if (!agentId) throw new Error('loopx.taskIntake: agentId is required');
      if (mode === 'guide' && !goalId) throw new Error('loopx.taskIntake: mode "guide" requires goalId');

      const { refs, unsupported } = githubReferences(text);
      if (unsupported.length) {
        return {
          ok: false,
          code: 'unsupported_github_path',
          url: unsupported[0].url,
          error: `Unsupported GitHub link: ${unsupported[0].url}. Paste an issue, a pull request, the repository home, or its issues list.`,
        };
      }
      if (!refs.length) {
        return {
          ok: false,
          code: 'unsupported_input',
          error: 'Paste a GitHub issue, pull request, repository, or issues-list link.',
        };
      }
      const listRefs = refs.filter((ref) => ref.kind === 'issues-list');
      const requestedRepos = [...new Set(refs.map((ref) => ref.repo))];
      const projectRepo = await projectGithubRepository(projectDir);
      if (requestedRepos.length > 1) {
        return {
          ok: false,
          code: 'multiple_repositories',
          error: 'One LoopX goal must target a single local repository. Split links from different repositories into separate tasks.',
          requestedRepos,
        };
      }
      if (requestedRepos.length === 1 && projectRepo && requestedRepos[0] !== projectRepo) {
        return {
          ok: false,
          code: 'repository_mismatch',
          error: `The selected checkout is ${projectRepo}, but the task targets ${requestedRepos[0]}.`,
          requestedRepo: requestedRepos[0],
          projectRepo,
        };
      }
      if (requestedRepos.length === 1 && !projectRepo && projectDir) {
        return {
          ok: false,
          code: 'repository_unverified',
          error: `The selected directory is not a recognizable checkout of ${requestedRepos[0]} (no GitHub remote found).`,
          requestedRepo: requestedRepos[0],
          projectRepo: null,
        };
      }
      if (requestedRepos.length === 1 && !projectDir && !autoClone) {
        return {
          ok: false,
          code: 'project_required',
          error: `No local project directory is selected for ${requestedRepos[0]}; enable auto-clone or select a checkout.`,
          requestedRepo: requestedRepos[0],
        };
      }

      const repoLabel = requestedRepos[0] || projectRepo || null;
      let issueList = Array.isArray(issues) && issues.length
        ? issues.filter((issue) => issue && issue.url)
        : refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr')
          .map((ref) => ({ url: ref.url, number: ref.number, title: `#${ref.number}` }));

      const targetGoalId = mode === 'guide' ? goalId : await uniqueGoalId(projectDir, text, refs);
      const intakeKind = listRefs.length ? 'issues-list'
        : (issueList.length > 1 ? 'issues' : (issueList.length === 1 ? 'issue' : (refs.length ? 'repository' : 'goal')));
      const emit = (stage, extra = {}) => {
        emitLocal('worker:taskIntake:progress', { goalId: targetGoalId, mode, stage, ...extra });
      };

      (async () => {
        const written = [];
        const issueResults = [];
        let failure = null;
        let goalCreated = mode === 'guide';
        let failedStage = 'bootstrap';
        let workingDir = projectDir;
        try {
          if (!workingDir && autoClone && requestedRepos.length === 1) {
            emit('clone', { detail: 'start' });
            failedStage = 'clone';
            workingDir = await cloneRepository(requestedRepos[0], (extra) => emit('clone', extra));
          }
          const expandRepo = listRefs.length ? listRefs[0].repo
            : (!issueList.length && refs.some((ref) => ref.kind === 'repository') ? repoLabel : null);
          if (expandRepo && !issueList.length) {
            emit('expand');
            failedStage = 'expand';
            const fetched = await fetchOpenIssues(expandRepo);
            issueList = fetched.issues.map((issue) => ({ url: issue.url, number: issue.number, title: issue.title }));
          }

          if (mode === 'new') {
            emit('bootstrap');
            failedStage = 'bootstrap';
            const bootstrap = await runLoopx(workingDir, [
              'bootstrap', '--project', workingDir, '--goal-id', targetGoalId,
              '--objective', text,
              '--adapter-kind', 'read_only_project_map_v0',
              '--adapter-status', 'connected-read-only',
              '--no-onboarding-scan', '--codex-app-heartbeat', 'ask',
              // The intake confirmation is the user's consent to fix this
              // repository: pre-grant the "write" scope so the agent can
              // edit code without a mid-run gate (publish/PR stays gated).
              '--write-scope', 'write',
            ], 90000);
            if (bootstrap.code !== 0 || bootstrap.payload?.ok === false) {
              throw new Error(bootstrap.payload?.error || bootstrap.stderr.trim() || 'loopx bootstrap failed');
            }
          }

          emit('register');
          failedStage = 'register';
          const registration = await runLoopx(workingDir, [
            'register-agent', '--goal-id', targetGoalId, '--agent-id', agentId, '--execute',
          ], 60000);
          if (registration.code !== 0 || registration.payload?.ok === false) {
            throw new Error(registration.payload?.error || registration.stderr.trim() || 'agent registration failed');
          }
          goalCreated = true;

          if (issueList.length === 1) {
            emit('plan', { current: 1, total: 1, detail: issueList[0].url });
            failedStage = 'plan';
            const intake = await planIssueIntake({ projectDir: workingDir, url: issueList[0].url });
            const result = intake.ok
              ? await writePlannedTodos({ projectDir: workingDir, goalId: targetGoalId, agentId, intake })
              : intake;
            issueResults.push({ url: issueList[0].url, ...result });
            written.push(...(result.written || []));
          } else if (issueList.length > 1) {
            failedStage = 'todos';
            for (let i = 0; i < issueList.length; i += 1) {
              const issue = issueList[i];
              emit('todos', { current: i + 1, total: issueList.length, detail: issue.url });
              const label = issue.title && issue.title !== `#${issue.number}`
                ? `Fix GitHub issue #${issue.number}: ${issue.title}`
                : `Fix GitHub issue #${issue.number}`;
              const args = [
                'todo', 'add', '--goal-id', targetGoalId, '--role', 'agent',
                '--task-class', 'advancement_task', '--action-kind', 'fix_issue',
                '--claimed-by', agentId, '--text', `[P1] ${label} (${issue.url})`,
              ];
              if (repoLabel) args.push('--task-repository', `git:github.com/${repoLabel}`);
              try {
                const response = await runLoopx(workingDir, args, 60000);
                const ok = response.code === 0 && response.payload?.ok !== false;
                written.push({
                  ok,
                  todoId: response.payload?.todo_id ?? null,
                  actionKind: 'fix_issue',
                  url: issue.url,
                  error: ok ? null : (response.payload?.error || response.stderr.slice(0, 200) || 'todo add failed'),
                });
              } catch (err) {
                written.push({ ok: false, todoId: null, actionKind: 'fix_issue', url: issue.url, error: String(err.message || err) });
              }
            }
          } else {
            emit('todos', { current: 1, total: 1 });
            failedStage = 'todos';
            const args = [
              'todo', 'add', '--goal-id', targetGoalId, '--role', 'agent',
              '--task-class', 'advancement_task', '--action-kind', 'deliver_user_goal',
              '--claimed-by', agentId, '--text', `[P0] ${text}`,
            ];
            if (repoLabel) args.push('--task-repository', `git:github.com/${repoLabel}`);
            const todo = await runLoopx(workingDir, args, 60000);
            const ok = todo.code === 0 && todo.payload?.ok !== false;
            written.push({
              ok,
              todoId: todo.payload?.todo_id ?? null,
              actionKind: 'deliver_user_goal',
              error: ok ? null : (todo.payload?.error || todo.stderr.trim() || 'todo add failed'),
            });
          }

          emit('refresh');
          failedStage = 'refresh';
          try {
            await runLoopx(workingDir, [
              'refresh-state', '--goal-id', targetGoalId, '--project', workingDir,
            ], 60000);
          } catch (_) {}
        } catch (err) {
          failure = String(err.message || err);
        }
        const ok = !failure && written.length > 0 && written.every((entry) => entry.ok)
          && issueResults.every((entry) => entry.ok);
        const okWritten = written.filter((entry) => entry.ok).length;
        emitLocal('worker:taskIntake:done', {
          ok,
          code: ok ? 'created'
            : (failure ? `${failedStage}_failed` : (okWritten > 0 ? 'todos_partial' : 'todo_write_failed')),
          created: goalCreated,
          mode,
          goalId: targetGoalId,
          objective: text,
          intakeKind,
          issueCount: issueList.length,
          writtenOk: okWritten,
          repository: repoLabel,
          projectDir: workingDir,
          written,
          issueResults,
          error: failure || (ok ? null : (written.find((entry) => !entry.ok)?.error
            || issueResults.find((entry) => !entry.ok)?.error
            || 'task intake did not produce runnable todos')),
        });
      })();
      return { started: true, goalId: targetGoalId, mode, intakeKind, issueCount: issueList.length };
    },

    async 'loopx.listGoals'({ projectDir = null, projectDirs = null } = {}) {
      const cacheRepos = [];
      try {
        const entries = await app.fs.readdir(cloneCacheRoot);
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (!entry || entry.isDirectory !== true) continue;
          if (await existsDir(joinP(entry.path, '.loopx'))) cacheRepos.push(entry.path);
        }
      } catch (_) {}
      const dirs = [projectDir, ...(Array.isArray(projectDirs) ? projectDirs : []), ...cacheRepos]
        .filter((dir) => typeof dir === 'string' && dir);
      const uniqueDirs = [...new Set(dirs)];
      const targets = [];
      for (const dir of uniqueDirs) {
        if (await existsDir(joinP(dir, '.loopx'))) targets.push(dir);
      }
      if (targets.length === 0) targets.push(null);

      const agentsByGoal = {};
      const objectivesByGoal = {};
      const dirByGoal = {};
      for (const dir of targets) {
        const { registry } = await readRegistry(dir);
        for (const goal of (registry && registry.goals) || []) {
          const goalId = goal.goal_id || goal.id;
          if (!goalId) continue;
          const coordination = goal.coordination || {};
          agentsByGoal[goalId] = (coordination.registered_agents || [])
            .map((a) => (typeof a === 'string' ? a : a.agent_id || a.id))
            .filter(Boolean);
          objectivesByGoal[goalId] = await readGoalObjective(dir, goal);
          if (dir) dirByGoal[goalId] = dir;
        }
      }

      let lastOk = true;
      const groups = {};
      for (const dir of targets) {
        const args = ['quota', 'status', '--scan-root', ensureScanRoot()];
        const { code, payload } = await runLoopx(dir, args, 90000);
        if (code !== 0) {
          lastOk = false;
          continue;
        }
        const source = (payload && payload.groups) || payload || {};
        if (source && typeof source === 'object') {
          for (const [state, entries] of Object.entries(source)) {
            if (!Array.isArray(entries)) continue;
            if (!groups[state]) groups[state] = [];
            groups[state].push(...entries);
          }
        }
      }
      const goals = [];
      const seen = new Set();
      const pushGoal = (goalId, state, extra = {}) => {
        if (!goalId || seen.has(goalId)) return;
        seen.add(goalId);
        goals.push({
          goalId,
          state: state || null,
          agents: agentsByGoal[goalId] || [],
          objective: objectivesByGoal[goalId] || null,
          projectDir: dirByGoal[goalId] || null,
          ...extra,
        });
      };
      for (const [state, entries] of Object.entries(groups)) {
        for (const entry of entries) {
          if (typeof entry === 'string') pushGoal(entry, state);
          else if (entry && typeof entry === 'object') {
            pushGoal(entry.goal_id || entry.id, entry.state || state, {
              waitingOn: entry.waiting_on ?? null,
              status: entry.status ?? null,
            });
          }
        }
      }
      for (const goalId of Object.keys(agentsByGoal)) pushGoal(goalId, null);
      const registryPath = targets.length === 1
        ? (targets[0] ? joinP(targets[0], '.loopx', 'registry.json') : globalRegistryPath)
        : (targets[0] ? joinP(targets[0], '.loopx', 'registry.json') : null);
      return { ok: lastOk, registryPath, goals, raw: { groups } };
    },

    async 'loopx.status'({ projectDir = null, goalId = null, agentId = null } = {}) {
      const args = ['status'];
      if (goalId) args.push('--goal-id', goalId);
      if (agentId) args.push('--agent-id', agentId);
      const { code, payload, stderr } = await runLoopx(projectDir, args, 60000);
      return { ok: code === 0, payload, stderr };
    },

    async 'loopx.shouldRun'({ projectDir = null, goalId, agentId } = {}) {
      if (!goalId) throw new Error('loopx.shouldRun: goalId is required');
      const args = [
        'quota', 'should-run',
        '--goal-id', goalId,
        '--runtime-profile', 'outer_controller',
        '--include-scheduler-detail',
        '--scan-root', ensureScanRoot(),
      ];
      if (agentId) args.push('--agent-id', agentId);
      const { code, payload, stderr } = await runLoopx(projectDir, args, 90000);
      if (!payload) {
        return { ok: false, error: stderr.trim() || 'loopx returned no JSON payload', raw: null };
      }
      return {
        ok: code === 0,
        shouldRun: payload.should_run ?? null,
        decision: payload.decision ?? null,
        state: payload.state ?? null,
        effectiveAction: payload.effective_action ?? null,
        reason: payload.reason ?? null,
        recommendedAction: payload.recommended_action ?? null,
        waitingOn: payload.waiting_on ?? null,
        scheduler: normalizeScheduler(payload.scheduler_hint),
        raw: payload,
      };
    },

    async 'loopx.turnPrompt'({ projectDir = null, goalId, agentId } = {}) {
      if (!goalId || !agentId) throw new Error('loopx.turnPrompt: goalId and agentId are required');
      if (!projectDir) throw new Error('loopx.turnPrompt: projectDir is required');
      const { code, payload, stderr } = await runLoopx(projectDir, [
        'heartbeat-prompt', '--goal-id', goalId, '--agent-id', agentId,
        '--runtime-profile', 'outer_controller', '--compact',
      ], 180000);
      const body = payload && typeof payload.task_body === 'string' ? payload.task_body : null;
      if (code !== 0 || payload?.ok === false || !body) {
        return {
          ok: false,
          error: payload?.error || stderr.trim() || 'heartbeat-prompt produced no task body',
        };
      }
      return { ok: true, prompt: turnPreamble({ projectDir, goalId, agentId }) + body };
    },
  };

  // ── monkey-patch app.call: loopx.* stays in-page, everything else ──
  //    (ai.*, agent.*, storage.*, …) goes to the host bridge unchanged.
  const originalCall = app.call.bind(app);
  app.call = async function (method, params) {
    if (typeof method === 'string' && method.startsWith('loopx.') && Lx[method]) {
      return Lx[method](params || {});
    }
    return originalCall(method, params);
  };
})();
