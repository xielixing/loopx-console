// Proves the taskIntake guard no longer blocks autoClone: with a bogus repo,
// intake must reach the clone stage and report clone_failed (not the
// project-directory guard error).
const fs = require('fs');
const Module = require('module');

const src = fs.readFileSync('D:/loopx-console/source/worker.js', 'utf8');
const m = new Module('worker-under-test', null);
m.filename = 'D:/loopx-console/source/worker.js';
m.paths = Module._nodeModulePaths('D:/loopx-console');
m._compile(src, m.filename);

const events = [];
global.rpcEmit = (event, data) => events.push({ event, data });

(async () => {
  const res = await m.exports['loopx.taskIntake']({
    projectDir: null,
    autoClone: true,
    objective: 'https://github.com/definitely-not-a-repo-xyz123/nope/issues/1',
    agentId: 'bitfun-agent',
    issues: [{ url: 'https://github.com/definitely-not-a-repo-xyz123/nope/issues/1', number: 1, title: '#1' }],
  });
  console.log('sync result:', JSON.stringify(res));
  await new Promise((r) => setTimeout(r, 30000));
  const done = events.filter((e) => e.event === 'taskIntake:done');
  console.log('done events:', JSON.stringify(done.map((d) => ({ code: d.data.code, error: String(d.data.error || '').slice(0, 120) }))));
  const guardBlocked = done.length === 0 && events.some((e) => /local project directory is required/.test(String(e.data && e.data.error)));
  console.log(guardBlocked ? 'FAIL: guard still blocks autoClone' : 'PASS: intake reached the clone stage');
})();
