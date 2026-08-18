// One-shot recovery for an imported LoopX Console instance:
// 1. Swap the embedded ui.js in compiled.html from the imported version to
//    the current source/ui.js (CRLF, byte-exact verbatim embed).
// 2. Point the goal's persisted host-agent session id at the pre-crash
//    session (the host restores it from disk, so the agent continues with
//    its full prior context instead of starting from scratch).
// 3. Merge the pre-crash persisted log history from a storage backup.
//
// Usage: node tools/instance-recover-session.cjs <instanceDir> <goalId>
//        <sessionId> <storageBackupJson>
// Run ONLY while the MiniApp page is closed (no live worker writing storage).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const [instanceDir, goalId, sessionId, backupPath] = process.argv.slice(2);
const repo = path.resolve(__dirname, '..');
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
if (!instanceDir || !goalId || !sessionId) fail('usage: <instanceDir> <goalId> <sessionId> [backupJson]');

const htmlPath = path.join(instanceDir, 'compiled.html');
const storagePath = path.join(instanceDir, 'storage.json');
if (!fs.existsSync(htmlPath)) fail('compiled.html missing: ' + htmlPath);
if (!fs.existsSync(storagePath)) fail('storage.json missing: ' + storagePath);

// ── 1. compiled.html: swap the embedded ui.js ─────────────────────────
const html = fs.readFileSync(htmlPath, 'utf8');
const newUiLf = fs.readFileSync(path.join(repo, 'source', 'ui.js'), 'utf8');
const newUi = newUiLf.replace(/\n/g, '\r\n');
// Locate the embedded copy: it starts at the line containing the ui.js
// version banner comment; find both unique end markers instead of guessing
// the full old text (the import may embed any older revision).
const startMarker = '// LoopX Console';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) fail('embedded ui.js start marker not found');
const endMarker = '// ── boot ──';
const endIdx = html.indexOf(endMarker, startIdx);
if (endIdx === -1) fail('embedded ui.js end marker not found');
// The embedded text ends with the boot IIFE; take everything through its end.
const bootEndMarker = '(async function boot() {';
const bootEndIdx = html.indexOf(bootEndMarker, endIdx);
if (bootEndIdx === -1) fail('boot marker not found');
// Find the end of the embedded ui.js: the script close tag right after the
// boot IIFE's end. The ui.js source ends with '})();' + newline.
const tailIdx = html.indexOf('})();', bootEndIdx);
if (tailIdx === -1) fail('boot tail not found');
const oldEnd = tailIdx + '})();'.length;
const oldUi = html.slice(startIdx, oldEnd);
const newUiRegion = newUi.trimEnd();
if (!oldUi.includes('function executeRunOnce')) fail('embedded text does not look like ui.js');
if (oldUi.includes('agentSessionIdFor')) fail('embedded ui.js already patched');
const patchedHtml = html.slice(0, startIdx) + newUiRegion + html.slice(oldEnd);
fs.writeFileSync(htmlPath, patchedHtml, 'utf8');
console.log('compiled.html patched:', oldUi.length, '->', newUiRegion.length, 'chars');

// Sanity: the swapped text must parse as JS.
new (require('vm').Script)(newUiRegion.replace(/\r\n/g, '\n'), { filename: 'ui.js' });
console.log('embedded ui.js parses as script: ok');

// ── 2. storage.json: recovered session id + merged logs ───────────────
const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
storage.config = storage.config || {};
storage.config.agentSessionByGoal = storage.config.agentSessionByGoal || {};
const prev = storage.config.agentSessionByGoal[goalId];
storage.config.agentSessionByGoal[goalId] = sessionId;
console.log(`agentSessionByGoal[${goalId}]: ${prev || '(none)'} -> ${sessionId}`);

if (backupPath && fs.existsSync(backupPath)) {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const oldLogs = (backup.logs && backup.logs[goalId]) || [];
  const newLogs = (storage.logs && storage.logs[goalId]) || [];
  if (oldLogs.length) {
    storage.logs = storage.logs || {};
    // Chronological merge: old first, then new; cap what we persist.
    storage.logs[goalId] = [...oldLogs, ...newLogs].slice(-600);
    console.log(`logs merged: ${oldLogs.length} old + ${newLogs.length} new -> ${storage.logs[goalId].length}`);
  }
}
fs.writeFileSync(storagePath, JSON.stringify(storage), 'utf8');
console.log('storage.json written (no BOM)');

// Verify both files parse cleanly after the write.
JSON.parse(fs.readFileSync(storagePath, 'utf8'));
const check = fs.readFileSync(htmlPath, 'utf8');
if (!check.includes('function agentSessionIdFor')) fail('patched compiled.html verification failed');
console.log('verify: compiled.html contains agentSessionIdFor, storage.json valid JSON');
console.log('DONE');
