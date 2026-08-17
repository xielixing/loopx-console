// Reproduce resolveIntake timing for an issues-list URL (no project dir).
const w = require('../source/worker.js');
global.rpcEmit = () => {};

(async () => {
  const t = Date.now();
  try {
    const r = await Promise.race([
      w['loopx.resolveIntake']({ objective: 'https://github.com/anywhere-labs/deepseek-harness-desktop/issues' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('HANG 90s')), 90000)),
    ]);
    console.log('resolved in', Date.now() - t, 'ms:', JSON.stringify({
      ok: r.ok, code: r.code, kind: r.kind, autoClone: r.autoClone,
      issues: r.issues && r.issues.length, error: r.error,
    }));
  } catch (e) {
    console.log('FAILED/HANG:', e.message);
  }
})();
