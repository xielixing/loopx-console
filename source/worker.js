// LoopX Console MiniApp — Worker (Node.js/Bun).
// Wraps the loopx CLI (`loopx --format json …`). The host heartbeat lives in
// ui.js; this worker is stateless per call except for the cached invocation
// prefix and the per-goal run-once in-flight registry.

const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// Invocation candidates, probed in order. `python -m loopx` does NOT work
// (loopx has no __main__.py) — the module form must target loopx.cli.
// A source checkout (srcDir, set in the UI settings) is the last resort,
// injected via PYTHONPATH.
function candidatePrefixes(srcDir) {
  const list = [
    { argv: ['loopx'] },
    { argv: ['python', '-m', 'loopx.cli'] },
    { argv: ['py', '-3', '-m', 'loopx.cli'] },
  ];
  if (srcDir && fs.existsSync(path.join(srcDir, 'loopx', 'cli.py'))) {
    list.push({ argv: ['python', '-m', 'loopx.cli'], env: { PYTHONPATH: srcDir } });
    list.push({ argv: ['py', '-3', '-m', 'loopx.cli'], env: { PYTHONPATH: srcDir } });
  }
  return list;
}

const DEFAULT_TIMEOUT_MS = 60000;

let cachedPrefix = null; // { argv, env }

// loopx is a Python CLI; on zh-CN Windows its stdout defaults to GBK, which
// breaks both JSON.parse and any non-ASCII reason strings. Force UTF-8, and
// prepend (never clobber) PYTHONPATH from a source-checkout overlay.
function buildEnv(envOverlay) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  if (envOverlay) {
    for (const [key, value] of Object.entries(envOverlay)) {
      if (key === 'PYTHONPATH' && env.PYTHONPATH) {
        env.PYTHONPATH = value + path.delimiter + env.PYTHONPATH;
      } else {
        env[key] = value;
      }
    }
  }
  return env;
}

// child.kill() only terminates the direct child; on Windows the interesting
// work (python → codex …) lives in grandchildren. Kill the whole tree.
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      tk.on('error', () => child.kill());
    } catch (_) {
      child.kill();
    }
  } else {
    child.kill();
  }
}

function makeLineSplitter(onLine) {
  let buf = '';
  return {
    push(text) {
      buf += text;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush() {
      if (buf.trim()) onLine(buf.trim());
      buf = '';
    },
  };
}

// onStderrLine streams progress (loopx logs to stderr while running; in
// --format json mode stdout carries exactly one JSON document at exit, so
// streaming stdout lines would only replay the final payload as noise).
function spawnLoopx(prefix, args, { timeoutMs = DEFAULT_TIMEOUT_MS, onStderrLine = null, onSpawned = null } = {}) {
  const argv = Array.isArray(prefix) ? prefix : prefix.argv;
  const envOverlay = Array.isArray(prefix) ? null : prefix.env;
  return new Promise((resolve, reject) => {
    const [cmd, ...prefixArgs] = argv;
    const child = spawn(cmd, [...prefixArgs, ...args], {
      shell: false,
      windowsHide: true,
      env: buildEnv(envOverlay),
    });
    if (onSpawned) onSpawned(child);
    let stdout = '';
    let stderr = '';
    // setEncoding routes chunks through a StringDecoder, so multibyte UTF-8
    // sequences split across 64KB pipe chunks decode correctly (quota status
    // payloads run to hundreds of KB with CJK text).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const errSplitter = onStderrLine ? makeLineSplitter(onStderrLine) : null;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      reject(new Error(`loopx timed out after ${timeoutMs}ms: ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (errSplitter) errSplitter.push(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (errSplitter) errSplitter.flush();
      resolve({ code, stdout, stderr });
    });
  });
}

// loopx prints one JSON document on stdout in --format json mode; tolerate
// noise before the document and (best-effort) after it.
function parseJsonPayload(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      return JSON.parse(text.slice(start));
    } catch (_) {}
    const end = text.lastIndexOf('}');
    if (end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {}
    }
  }
  return null;
}

// A prefix from the UI may be a plain argv array (settings input) or a
// {argv, env} object persisted from a previous detect.
function normalizePrefix(p) {
  if (!p) return null;
  if (Array.isArray(p)) return p.length > 0 ? { argv: p } : null;
  if (typeof p === 'object' && Array.isArray(p.argv) && p.argv.length > 0) return p;
  return null;
}

async function resolvePrefix(argvPrefix, srcDir = null) {
  const normalized = normalizePrefix(argvPrefix);
  if (normalized) return normalized;
  if (cachedPrefix) return cachedPrefix;
  const detected = await detectLoopx(null, srcDir);
  if (!detected.found) {
    throw new Error(
      'loopx CLI not found. Install it (pip install -e <checkout>), '
      + 'or set the invocation command or source directory in Settings.'
    );
  }
  return normalizePrefix(detected.argvPrefix) || { argv: detected.argvPrefix };
}

function registryArgs(projectDir) {
  if (!projectDir) return []; // loopx falls back to its global registry
  return ['--registry', path.join(projectDir, '.loopx', 'registry.json')];
}

async function runJson(argvPrefix, projectDir, args, opts = {}) {
  const prefix = await resolvePrefix(argvPrefix, opts.srcDir || null);
  let result;
  try {
    result = await spawnLoopx(prefix, ['--format', 'json', ...registryArgs(projectDir), ...args], opts);
  } catch (err) {
    // A cached prefix can go stale (venv removed, PATH change): drop it so
    // the next call re-probes instead of failing forever.
    if (err && err.code === 'ENOENT' && prefix === cachedPrefix) cachedPrefix = null;
    throw err;
  }
  const payload = parseJsonPayload(result.stdout);
  return { result, payload, prefix };
}

async function detectLoopx(customPrefix, srcDir = null) {
  const custom = normalizePrefix(customPrefix);
  const candidates = custom ? [custom, ...candidatePrefixes(srcDir)] : candidatePrefixes(srcDir);
  const probes = [];
  for (const prefix of candidates) {
    try {
      const { code, stdout, stderr } = await spawnLoopx(prefix, ['--version'], { timeoutMs: 15000 });
      const version = (stdout + stderr).trim().split(/\r?\n/)[0] || '';
      const label = prefix.env ? [...prefix.argv, `(PYTHONPATH=${prefix.env.PYTHONPATH})`] : prefix.argv;
      probes.push({ argvPrefix: label, ok: code === 0, version });
      if (code === 0) {
        cachedPrefix = prefix;
        return { found: true, argvPrefix: prefix, version, probes };
      }
    } catch (err) {
      probes.push({ argvPrefix: prefix.argv, ok: false, error: String(err.message || err) });
    }
  }
  return { found: false, argvPrefix: null, version: null, probes };
}

function resolveRegistryPath(projectDir) {
  if (projectDir) return path.join(projectDir, '.loopx', 'registry.json');
  // Mirror the CLI: LOOPX_REGISTRY wins only if the file exists; otherwise
  // loopx itself falls back to the global registry.
  if (process.env.LOOPX_REGISTRY && fs.existsSync(process.env.LOOPX_REGISTRY)) {
    return process.env.LOOPX_REGISTRY;
  }
  return path.join(os.homedir(), '.codex', 'loopx', 'registry.global.json');
}

function readRegistry(projectDir) {
  const registryPath = resolveRegistryPath(projectDir);
  try {
    return { registryPath, registry: JSON.parse(fs.readFileSync(registryPath, 'utf8')) };
  } catch (_) {
    return { registryPath, registry: null };
  }
}

function normalizeScheduler(schedulerHint) {
  if (!schedulerHint || typeof schedulerHint !== 'object') return null;
  // Hot path: reset token + codex_app fallback. Cold path
  // (--include-scheduler-detail): the local_scheduler block the heartbeat
  // actually wants.
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

// Turn execution is delegated to the HOST's own agent (app.agent.run in the
// UI): loopx generates the per-turn task body via heartbeat-prompt, and this
// preamble binds it to the selected local checkout. No external CLI host
// (codex etc.) is involved — the user configures nothing.
function turnPreamble({ projectDir, goalId, agentId }) {
  const registry = path.join(projectDir, '.loopx', 'registry.json');
  return [
    `You are the execution agent for LoopX goal "${goalId}" (agent_id: ${agentId}).`,
    `Repository checkout: ${projectDir}`,
    `LoopX registry: ${registry} — always pass --registry "${registry}" to loopx commands.`,
    'The loopx CLI is available on PATH (fallback: python -m loopx.cli).',
    'Rules: work only inside the repository checkout; never force-kill processes you did not start;',
    'record progress through loopx (todo complete / evidence) before finishing the turn.',
    '',
  ].join('\n');
}

function githubReferences(text) {
  const refs = [];
  const seen = new Set();
  const pattern = /https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const rawUrl = match[0].replace(/[),.;:\]}]+$/g, '');
    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) { continue; }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) continue;
    // GitHub owner/repo is case-insensitive; canonicalize to lowercase so
    // dedup sets, repo-binding guards, and task_repository labels all agree.
    const owner = segments[0].toLowerCase();
    const repoName = segments[1].replace(/\.git$/i, '').toLowerCase();
    if (!owner || !repoName) continue;
    const type = (segments[2] || '').toLowerCase();
    const number = /^(issues|pull)$/.test(type) && /^\d+$/.test(segments[3] || '')
      ? Number(segments[3])
      : null;
    // Exactly owner/repo/issues is the whole open-issue list — a distinct
    // intake kind (batch fix). /issues/new, /issues/assigned etc. are not a
    // list; they degrade to a plain repository reference. A ?q= filtered list
    // still counts: the confirmation sheet lets the user re-select anyway.
    const isIssuesList = type === 'issues' && number === null && segments.length === 3;
    const kind = number
      ? (type === 'issues' ? 'issue' : 'pr')
      : (isIssuesList ? 'issues-list' : 'repository');
    const repo = `${owner}/${repoName}`;
    const url = number
      ? `https://github.com/${repo}/${type}/${number}`
      : (isIssuesList ? `https://github.com/${repo}/issues` : `https://github.com/${repo}`);
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({
      url,
      repo,
      kind,
      number,
    });
  }
  return refs;
}

function normalizeGithubRemote(value) {
  const text = String(value || '').trim();
  const match = text.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function projectGithubRepository(projectDir) {
  if (!projectDir) return null;
  try {
    const config = fs.readFileSync(path.join(projectDir, '.git', 'config'), 'utf8');
    const origin = config.match(/\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/i);
    if (origin) return normalizeGithubRemote(origin[1]);
    const anyRemote = config.match(/\n\s*url\s*=\s*([^\r\n]+)/i);
    return anyRemote ? normalizeGithubRemote(anyRemote[1]) : null;
  } catch (_) {
    return null;
  }
}

function uniqueGoalId(projectDir, objective, refs) {
  const { registry } = readRegistry(projectDir);
  const existing = new Set(((registry && registry.goals) || [])
    .map((goal) => goal.goal_id || goal.id)
    .filter(Boolean));
  const issueRefs = refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr');
  const listRef = refs.find((ref) => ref.kind === 'issues-list');
  let base;
  if (listRef) {
    base = `${listRef.repo.split('/')[1]}-issues`;
  } else if (issueRefs.length === 1) {
    const repo = issueRefs[0].repo.split('/')[1];
    base = `${repo}-issue-${issueRefs[0].number}`;
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
  let goalId = base;
  let suffix = 2;
  while (existing.has(goalId)) goalId = `${base}-${suffix++}`;
  return goalId;
}

function readGoalObjective(projectDir, goal) {
  const stateFile = goal && goal.state_file;
  if (!stateFile) return null;
  const root = projectDir || goal.repo;
  if (!root) return null;
  try {
    const content = fs.readFileSync(path.resolve(root, stateFile), 'utf8');
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

async function planIssueIntake({ argvPrefix, srcDir, projectDir, url }) {
  const planArgsBase = ['issue-fix', 'workflow-plan', '--url', String(url).trim()];
  if (projectDir) planArgsBase.push('--repo-path', projectDir);
  let result, payload;
  ({ result, payload } = await runJson(argvPrefix, projectDir, [
    ...planArgsBase, '--fetch-metadata', '--fetch-timeout-seconds', '20',
  ], { srcDir, timeoutMs: 90000 }));
  let fetchedMetadata = true;
  const planEmpty = (value) => !value || value.ok === false
    || !(value.ordered_loopx_todo_writeback_preview || []).length;
  if (planEmpty(payload)) {
    fetchedMetadata = false;
    ({ result, payload } = await runJson(argvPrefix, projectDir, planArgsBase, {
      srcDir, timeoutMs: 90000,
    }));
  }
  if (!payload) {
    return { ok: false, error: result.stderr.trim() || 'loopx returned no JSON payload', raw: null };
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
    ok: result.code === 0 && payload.ok !== false,
    fetchedMetadata,
    issueSignal: payload.issue_signal ?? null,
    branchPlan: payload.branch_plan ?? null,
    feasibilityRoutes: payload.feasibility_checkpoint_plan?.routes ?? null,
    todosPreview: preview,
    raw: payload,
  };
}

async function writePlannedTodos({ argvPrefix, srcDir, projectDir, goalId, agentId, intake }) {
  const preview = intake.todosPreview || [];
  if (!preview.length) return { ...intake, ok: false, error: 'workflow-plan produced no writable todos' };
  // Lowercase to match githubReferences' canonical repo labels — a goal must
  // not accumulate two case-variant task_repository identities.
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
      const response = await runJson(argvPrefix, projectDir, args, { srcDir });
      const ok = response.result.code === 0 && response.payload?.ok !== false;
      written.push({
        actionKind: todo.actionKind,
        ok,
        todoId: response.payload?.todo_id ?? null,
        error: ok ? null : (response.payload?.error || response.result.stderr.slice(0, 200) || 'todo add failed'),
      });
    } catch (err) {
      written.push({ actionKind: todo.actionKind, ok: false, todoId: null, error: String(err.message || err) });
    }
  }
  return { ...intake, written, ok: intake.ok && written.every((entry) => entry.ok) };
}

// ── GitHub issue enumeration (batch-fix intake) ───────────
// loopx itself has no repo-wide issue listing (issue-fix workflow-plan takes
// exactly one --url), so the console enumerates open issues via the anonymous
// GitHub REST API. Public repos only; unauthenticated quota is 60 req/hour.
function githubApiGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: apiPath,
      headers: {
        'User-Agent': 'BitFun-LoopX-Console',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 20000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 403 || res.statusCode === 429) {
          reject(new Error(res.headers['x-ratelimit-remaining'] === '0'
            ? 'GitHub API rate limit exceeded (anonymous quota is 60 requests/hour); retry later'
            : `GitHub API refused the request (HTTP ${res.statusCode})`));
          return;
        }
        if (res.statusCode === 404) {
          reject(new Error(`GitHub repository not found (or private): ${apiPath.split('?')[0]}`));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API HTTP ${res.statusCode} for ${apiPath.split('?')[0]}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`GitHub API returned invalid JSON: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('GitHub API request timed out')); });
    req.on('error', reject);
  });
}

async function fetchOpenIssues(repo) {
  const issues = [];
  // /repos/…/issues interleaves PRs (every PR is an issue) — filter them out,
  // otherwise a busy repo's fix loop would keep "fixing" its own PRs.
  for (let page = 1; page <= 3; page += 1) {
    const batch = await githubApiGet(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
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
  // Page 3 came back full — more issues/PRs likely exist beyond the cap.
  return { issues, truncated: true };
}

module.exports = {
  async 'loopx.detect'({ argvPrefix = null, srcDir = null } = {}) {
    return detectLoopx(argvPrefix, srcDir);
  },

  async 'loopx.doctor'({ argvPrefix = null, projectDir = null } = {}) {
    const { result, payload } = await runJson(argvPrefix, projectDir, ['doctor']);
    return { ok: result.code === 0, payload, stderr: result.stderr };
  },

  // "Paste an issue URL" glue: preview via `issue-fix workflow-plan
  // --fetch-metadata`, then (execute=true) materialize the ordered todo
  // preview into a goal with plain `loopx todo add` calls. Uses only
  // shipped loopx CLI surface — no loopx-side changes.
  async 'loopx.issueIntake'({
    argvPrefix = null,
    srcDir = null,
    projectDir = null,
    url,
    goalId = null,
    execute = false,
  } = {}) {
    if (!url || !/^https:\/\/github\.com\//.test(String(url).trim())) {
      throw new Error('loopx.issueIntake: url must be a public https://github.com/ issue or PR link');
    }
    const intake = await planIssueIntake({ argvPrefix, srcDir, projectDir, url });
    if (!execute) return intake;
    if (!goalId) throw new Error('loopx.issueIntake: goalId is required to write todos');
    return writePlannedTodos({ argvPrefix, srcDir, projectDir, goalId, agentId: null, intake });
  },

  // Product-level task intake. This adapts natural-language goals, repository
  // URLs, and one or more Issue/PR URLs onto LoopX's public CLI without
  // changing LoopX itself.
  //
  // Fast read-only classification for the composer: parses the input, expands
  // an owner/repo/issues list URL into concrete open issues (GitHub REST,
  // anonymous), and runs the repo-binding checks — so the UI can show a
  // precise confirmation sheet before anything is written.
  async 'loopx.resolveIntake'({ projectDir = null, objective } = {}) {
    const text = String(objective || '').trim();
    if (!text) throw new Error('loopx.resolveIntake: objective is required');
    const refs = githubReferences(text);
    const issueRefs = refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr');
    const listRefs = refs.filter((ref) => ref.kind === 'issues-list');
    const requestedRepos = [...new Set(refs.map((ref) => ref.repo))];
    const projectRepo = projectGithubRepository(projectDir);
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
    // A GitHub-targeted task against a project dir we cannot identify (no
    // .git/config or non-GitHub remote) would silently run fixes in the wrong
    // tree. Surface it as its own blocking code.
    if (requestedRepos.length === 1 && !projectRepo) {
      return {
        ok: false,
        code: 'repository_unverified',
        requestedRepo: requestedRepos[0],
        projectRepo: null,
      };
    }
    let issues = issueRefs.filter((ref) => ref.kind === 'issue').map((ref) => ({
      number: ref.number, title: `#${ref.number}`, url: ref.url, fromList: false,
    }));
    let kind = issueRefs.length ? (issueRefs.length > 1 ? 'issues' : 'issue')
      : (refs.length ? 'repository' : 'goal');
    let truncated = false;
    // Both an explicit issues-list URL and a bare repository URL mean "the
    // repo's open issues" — one link, one behavior, the sheet re-selects.
    const repoRefs = refs.filter((ref) => ref.kind === 'repository');
    const expandRepo = listRefs.length ? listRefs[0].repo
      : (repoRefs.length && !issueRefs.length ? repoRefs[0].repo : null);
    if (expandRepo) {
      kind = 'issues-list';
      const fetched = await fetchOpenIssues(expandRepo);
      truncated = fetched.truncated;
      const seen = new Set(issues.map((issue) => issue.url));
      for (const issue of fetched.issues) {
        if (!seen.has(issue.url)) issues.push({ ...issue, fromList: true });
      }
    }
    return {
      ok: true,
      kind,
      repo: (refs[0] && refs[0].repo) || projectRepo || null,
      projectRepo,
      issues,
      truncated,
      prCount: issueRefs.filter((ref) => ref.kind === 'pr').length,
    };
  },

  // List a goal's todos (zero-write projection). Used to surface open
  // user-lane gates on the board.
  async 'loopx.listTodos'({ argvPrefix = null, projectDir = null, goalId, role = null, status = null } = {}) {
    if (!goalId) throw new Error('loopx.listTodos: goalId is required');
    const { result, payload } = await runJson(argvPrefix, projectDir, ['todo', 'list', '--goal-id', goalId]);
    let todos = (payload && payload.todos) || [];
    if (role) todos = todos.filter((todo) => todo.role === role);
    if (status) todos = todos.filter((todo) => todo.status === status);
    return { ok: result.code === 0, todos, error: result.code === 0 ? null : result.stderr.slice(0, 300) };
  },

  // Complete (approve) one todo by id — the console's gate-approval action.
  // user_gate todos hard-require --decision-outcome (approve/reject/cancel);
  // the CLI rejects the flag on other task classes, so pass it conditionally.
  async 'loopx.completeTodo'({
    argvPrefix = null, srcDir = null, projectDir = null,
    goalId, todoId, note = null, decisionOutcome = null,
  } = {}) {
    if (!goalId || !todoId) throw new Error('loopx.completeTodo: goalId and todoId are required');
    const args = ['todo', 'complete', '--goal-id', goalId, '--todo-id', todoId];
    if (decisionOutcome) args.push('--decision-outcome', decisionOutcome);
    if (note) args.push('--note', note);
    const { result, payload } = await runJson(argvPrefix, projectDir, args, { srcDir });
    const ok = result.code === 0 && payload?.ok !== false;
    return { ok, payload, error: ok ? null : (payload?.error || result.stderr.slice(0, 300) || 'todo complete failed') };
  },

  // Creates (mode 'new') or steers (mode 'guide') a goal. Returns immediately
  // and reports through taskIntake:progress / taskIntake:done events — a batch
  // of issues takes minutes and must not queue behind the RPC mutex.
  async 'loopx.taskIntake'({
    argvPrefix = null,
    srcDir = null,
    projectDir = null,
    objective,
    agentId,
    mode = 'new',
    goalId = null,
    issues = null, // [{url, number, title}] — pre-confirmed selection from the UI
  } = {}) {
    const text = String(objective || '').trim();
    if (!projectDir) throw new Error('loopx.taskIntake: a local project directory is required');
    if (!text) throw new Error('loopx.taskIntake: objective is required');
    if (text.length > 4000) throw new Error('loopx.taskIntake: objective is too long (max 4000 characters)');
    if (!agentId) throw new Error('loopx.taskIntake: agentId is required');
    if (mode === 'guide' && !goalId) throw new Error('loopx.taskIntake: mode "guide" requires goalId');

    const refs = githubReferences(text);
    const listRefs = refs.filter((ref) => ref.kind === 'issues-list');
    const requestedRepos = [...new Set(refs.map((ref) => ref.repo))];
    const projectRepo = projectGithubRepository(projectDir);
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
    if (requestedRepos.length === 1 && !projectRepo) {
      return {
        ok: false,
        code: 'repository_unverified',
        error: `The selected directory is not a recognizable checkout of ${requestedRepos[0]} (no GitHub remote found).`,
        requestedRepo: requestedRepos[0],
        projectRepo: null,
      };
    }

    const repoLabel = requestedRepos[0] || projectRepo || null;
    let issueList = Array.isArray(issues) && issues.length
      ? issues.filter((issue) => issue && issue.url)
      : refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr')
        .map((ref) => ({ url: ref.url, number: ref.number, title: `#${ref.number}` }));

    const targetGoalId = mode === 'guide' ? goalId : uniqueGoalId(projectDir, text, refs);
    const intakeKind = listRefs.length ? 'issues-list'
      : (issueList.length > 1 ? 'issues' : (issueList.length === 1 ? 'issue' : (refs.length ? 'repository' : 'goal')));
    const emit = (stage, extra = {}) => {
      global.rpcEmit('taskIntake:progress', { goalId: targetGoalId, mode, stage, ...extra });
    };

    (async () => {
      const written = [];
      const issueResults = [];
      let failure = null;
      // Which stage failed matters: after bootstrap+register succeed the goal
      // EXISTS, and reporting 'bootstrap_failed' would invite a retry that
      // mints a duplicate goal. Track creation separately from later stages.
      let goalCreated = mode === 'guide'; // guide targets an existing goal
      let failedStage = 'bootstrap';
      try {
        // issues-list / repository URL reaching intake without a UI-confirmed
        // selection (standalone callers): expand it here.
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
          const bootstrap = await runJson(argvPrefix, projectDir, [
            'bootstrap', '--project', projectDir, '--goal-id', targetGoalId,
            '--objective', text,
            '--adapter-kind', 'read_only_project_map_v0',
            '--adapter-status', 'connected-read-only',
            '--no-onboarding-scan', '--codex-app-heartbeat', 'ask',
          ], { srcDir, timeoutMs: 90000 });
          if (bootstrap.result.code !== 0 || bootstrap.payload?.ok === false) {
            throw new Error(bootstrap.payload?.error || bootstrap.result.stderr.trim() || 'loopx bootstrap failed');
          }
        }

        // Registration runs for BOTH modes: todo add --claimed-by rejects
        // agents not registered on the target goal, and in guide mode nothing
        // guarantees the chosen agent is registered there. It is idempotent.
        emit('register');
        failedStage = 'register';
        const registration = await runJson(argvPrefix, projectDir, [
          'register-agent', '--goal-id', targetGoalId, '--agent-id', agentId, '--execute',
        ], { srcDir, timeoutMs: 60000 });
        if (registration.result.code !== 0 || registration.payload?.ok === false) {
          throw new Error(registration.payload?.error || registration.result.stderr.trim() || 'agent registration failed');
        }
        goalCreated = true;

        if (issueList.length === 1) {
          // Single issue: the full workflow-plan path yields ordered,
          // classed todos (branch plan, validation, PR readiness).
          emit('plan', { current: 1, total: 1, detail: issueList[0].url });
          failedStage = 'plan';
          const intake = await planIssueIntake({ argvPrefix, srcDir, projectDir, url: issueList[0].url });
          const result = intake.ok
            ? await writePlannedTodos({ argvPrefix, srcDir, projectDir, goalId: targetGoalId, agentId, intake })
            : intake;
          issueResults.push({ url: issueList[0].url, ...result });
          written.push(...(result.written || []));
        } else if (issueList.length > 1) {
          // Batch: one intake todo per issue. Per-issue workflow-plan happens
          // inside the agent's own turns — planning N issues up front would
          // take minutes and burn the anonymous GitHub quota.
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
              const response = await runJson(argvPrefix, projectDir, args, { srcDir, timeoutMs: 60000 });
              const ok = response.result.code === 0 && response.payload?.ok !== false;
              written.push({
                ok,
                todoId: response.payload?.todo_id ?? null,
                actionKind: 'fix_issue',
                url: issue.url,
                error: ok ? null : (response.payload?.error || response.result.stderr.slice(0, 200) || 'todo add failed'),
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
          const todo = await runJson(argvPrefix, projectDir, args, { srcDir, timeoutMs: 60000 });
          const ok = todo.result.code === 0 && todo.payload?.ok !== false;
          written.push({
            ok,
            todoId: todo.payload?.todo_id ?? null,
            actionKind: 'deliver_user_goal',
            error: ok ? null : (todo.payload?.error || todo.result.stderr.trim() || 'todo add failed'),
          });
        }

        emit('refresh');
        failedStage = 'refresh';
        // Best-effort: the goal and todos already exist; a refresh hiccup
        // must not be reported as a failed creation.
        try {
          await runJson(argvPrefix, projectDir, [
            'refresh-state', '--goal-id', targetGoalId, '--project', projectDir,
          ], { srcDir, timeoutMs: 60000 });
        } catch (_) {}
      } catch (err) {
        failure = String(err.message || err);
      }
      const ok = !failure && written.length > 0 && written.every((entry) => entry.ok)
        && issueResults.every((entry) => entry.ok);
      const okWritten = written.filter((entry) => entry.ok).length;
      global.rpcEmit('taskIntake:done', {
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
        written,
        issueResults,
        error: failure || (ok ? null : (written.find((entry) => !entry.ok)?.error
          || issueResults.find((entry) => !entry.ok)?.error
          || 'task intake did not produce runnable todos')),
      });
    })();
    return { started: true, goalId: targetGoalId, mode, intakeKind, issueCount: issueList.length };
  },

  async 'loopx.listGoals'({ argvPrefix = null, projectDir = null } = {}) {
    const { registryPath, registry } = readRegistry(projectDir);
    const agentsByGoal = {};
    const objectivesByGoal = {};
    const registryGoals = (registry && registry.goals) || [];
    for (const goal of registryGoals) {
      const goalId = goal.goal_id || goal.id;
      if (!goalId) continue;
      const coordination = goal.coordination || {};
      agentsByGoal[goalId] = (coordination.registered_agents || [])
        .map((a) => (typeof a === 'string' ? a : a.agent_id || a.id))
        .filter(Boolean);
      objectivesByGoal[goalId] = readGoalObjective(projectDir, goal);
    }

    const { result, payload } = await runJson(argvPrefix, projectDir, ['quota', 'status']);
    const goals = [];
    const seen = new Set();
    const groups = (payload && payload.groups) || payload || {};
    const pushGoal = (goalId, state, extra = {}) => {
      if (!goalId || seen.has(goalId)) return;
      seen.add(goalId);
      goals.push({
        goalId,
        state: state || null,
        agents: agentsByGoal[goalId] || [],
        objective: objectivesByGoal[goalId] || null,
        ...extra,
      });
    };
    // quota status groups goals by state; shapes vary by schema version, so
    // walk any {state: [goal…]} mapping and any flat goals list defensively.
    if (groups && typeof groups === 'object') {
      for (const [state, entries] of Object.entries(groups)) {
        if (!Array.isArray(entries)) continue;
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
    }
    for (const goalId of Object.keys(agentsByGoal)) pushGoal(goalId, null);
    return { ok: result.code === 0, registryPath, goals, raw: payload };
  },

  async 'loopx.status'({ argvPrefix = null, projectDir = null, goalId = null, agentId = null } = {}) {
    const args = ['status'];
    if (goalId) args.push('--goal-id', goalId);
    if (agentId) args.push('--agent-id', agentId);
    const { result, payload } = await runJson(argvPrefix, projectDir, args);
    return { ok: result.code === 0, payload, stderr: result.stderr };
  },

  async 'loopx.shouldRun'({ argvPrefix = null, projectDir = null, goalId, agentId } = {}) {
    if (!goalId) throw new Error('loopx.shouldRun: goalId is required');
    const args = [
      'quota', 'should-run',
      '--goal-id', goalId,
      '--runtime-profile', 'outer_controller',
      '--include-scheduler-detail',
    ];
    if (agentId) args.push('--agent-id', agentId);
    const { result, payload } = await runJson(argvPrefix, projectDir, args);
    if (!payload) {
      return { ok: false, error: result.stderr.trim() || 'loopx returned no JSON payload', raw: null };
    }
    return {
      ok: result.code === 0,
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

  // Builds the complete prompt for one execution turn: loopx's own
  // heartbeat-prompt task body (state machine contract, todo discipline,
  // capability scopes) prefixed with the repo/registry binding preamble.
  // The UI feeds this to the HOST's agent (app.agent.run) — BitFun itself is
  // the execution engine; no external CLI host or user configuration.
  async 'loopx.turnPrompt'({
    argvPrefix = null, srcDir = null, projectDir = null, goalId, agentId,
  } = {}) {
    if (!goalId || !agentId) throw new Error('loopx.turnPrompt: goalId and agentId are required');
    if (!projectDir) throw new Error('loopx.turnPrompt: projectDir is required');
    const { result, payload } = await runJson(argvPrefix, projectDir, [
      'heartbeat-prompt', '--goal-id', goalId, '--agent-id', agentId,
      '--runtime-profile', 'outer_controller', '--compact',
    ], { srcDir, timeoutMs: 60000 });
    const body = payload && typeof payload.task_body === 'string' ? payload.task_body : null;
    if (result.code !== 0 || payload?.ok === false || !body) {
      return {
        ok: false,
        error: payload?.error || result.stderr.trim() || 'heartbeat-prompt produced no task body',
      };
    }
    return { ok: true, prompt: turnPreamble({ projectDir, goalId, agentId }) + body };
  },
};
