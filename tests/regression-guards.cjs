// Regression guards for the pure helpers behind the human-facing rules
// (regression list, AGENTS.md §5). The functions live inside source/ui.js
// and source/worker.js (not exported), so they are extracted by anchored
// regexes; each extraction failure is a loud FAIL — moving a helper must
// update this test, which is exactly the point.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const uiSrc = fs.readFileSync(path.join(ROOT, 'source', 'ui.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(ROOT, 'source', 'worker.js'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`ok   ${name}`); } else { failures += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

function extractFunction(src, name) {
  const clean = String(name).replace(/^function\s+/, '');
  const anchor = `function ${clean}`;
  const start = src.indexOf(anchor);
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  return src.slice(start, i);
}

// ── extractGateSummary: parse the labeled 3 lines out of a reasoning wall ──
{
  const chunk = extractFunction(uiSrc, 'function extractGateSummary');
  check('extractGateSummary exists in ui.js', !!chunk);
  if (chunk) {
    const fn = new Function('const GATE_SUMMARY_LABELS = [/^背景[:：]/, /^已完成[:：]/, /^需要你[:：]/]; ' + chunk + '; return extractGateSummary;')();
    const wall = [
      'The user wants a concise 3-line summary. Let me draft.',
      '背景：#318',
      '已完成：推送修复分支并创建 PR',
      '需要你：作为 owner 审批 publish',
    ].join('\n');
    const out = fn(wall);
    check('wall → exactly 3 labeled lines', out && out.split('\n').length === 3 && /^背景[:：]/.test(out));
    check('reasoning never leaks', !out || !/Let me draft|The user wants/.test(out));
    check('out-of-order labels rejected', fn('需要你：x\n背景：y\n已完成：z') === null);
  }
}

// ── gate summary restore path cleans legacy reasoning walls ──
check('restore self-heals via cleanGateSummary', uiSrc.includes('cleanGateSummary(String(v.text))'));

// ── bodyHasImages: conservative image detection (worker) ──
{
  const chunk = extractFunction(workerSrc, 'function bodyHasImages');
  check('bodyHasImages exists in worker.js', !!chunk);
  if (chunk) {
    const fn = new Function(`${chunk}; return bodyHasImages;`)();
    check('markdown image detected', fn('截图如下：![err](https://user-images.githubusercontent.com/a.png)') === true);
    check('<img> tag detected', fn('hello <img width="1280" src="https://github.com/user-attachments/assets/x" />') === true);
    check('attachment URL detected', fn('see https://user-attachments.githubusercontent.com/assets/1.png') === true);
    check('plain text is clean', fn('纯文字描述，没有图片') === false);
    check('empty body is clean', fn('') === false);
  }
}

// ── proxyUrlFrom: multi-protocol WinINET parsing ──
{
  const chunk = extractFunction(workerSrc, 'function proxyUrlFrom');
  check('proxyUrlFrom exists in worker.js', !!chunk);
  if (chunk) {
    const fn = new Function(`${chunk}; return proxyUrlFrom;`)();
    check('multi-protocol → first entry', fn('http=127.0.0.1:7897;https=127.0.0.1:7897') === 'http://127.0.0.1:7897');
    check('bare host:port normalized', fn('127.0.0.1:7890') === 'http://127.0.0.1:7890');
    check('null for empty', fn('') === null);
  }
}

// ── PR composition contract: branch-only commits + file list, no raw issue body ──
check('PR template never quotes issue body', !workerSrc.includes("'## 问题详情'"));
check('PR uses merge-base..HEAD for commits', workerSrc.includes("['merge-base', ref, 'HEAD']"));
check('PR lists 涉及文件 section', workerSrc.includes('## 涉及文件'));
check('PR body has Fixes binding', workerSrc.includes('Fixes #${issueNumber}'));

// ── loopx vendor version pin ──
check('vendor pinned to v0.2.13', /LOOPX_VENDOR_REF\s*=\s*'v0\.2\.13'/.test(workerSrc));

// ── gate rules: blocking-only display, approval auto-resume, dedup of info todos ──
check('review column renders blocking only', uiSrc.includes("todos.filter((td) => gateTodoInfo(td).isBlocking)"));
check('approval auto-resumes task', uiSrc.includes("t('approveResumed')"));
check('approval waits out in-flight reload', uiSrc.includes('while (g.userTodosLoading)'));

// ── image-guard wiring ──
check('intake sheet vision warning wired', uiSrc.includes("t('intakeVisionWarn', imageCount)"));
check('image rows get 🖼 marker', uiSrc.includes("badge.textContent = '🖼'"));

// ── deleteGoal also removes archived-goals dirs (dropdown refresh) ──
check('deleteGoal cleans archived-goals', workerSrc.includes("path.join(os.homedir(), '.codex', 'loopx', 'archived-goals')"));

if (failures > 0) {
  console.log(`\n${failures} guard(s) FAILED`);
  process.exit(1);
}
console.log('\nALL PASS');
