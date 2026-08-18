// Inject a recovered host-agent session id (and optionally merge old log
// history) into an imported LoopX Console instance's storage.json.
//
// Usage: node tools/instance-inject-session.cjs <instanceDir> <goalId>
//        <sessionId> [storageBackupJson]
// Run ONLY while the MiniApp page is closed (no live worker writing storage).
const fs = require('fs');
const path = require('path');

const [instanceDir, goalId, sessionId, backupPath] = process.argv.slice(2);
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
if (!instanceDir || !goalId || !sessionId) fail('usage: <instanceDir> <goalId> <sessionId> [backupJson]');

const storagePath = path.join(instanceDir, 'storage.json');
if (!fs.existsSync(storagePath)) fail('storage.json missing: ' + storagePath);

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
    storage.logs[goalId] = [...oldLogs, ...newLogs].slice(-600);
    console.log(`logs merged: ${oldLogs.length} old + ${newLogs.length} new -> ${storage.logs[goalId].length}`);
  }
}
fs.writeFileSync(storagePath, JSON.stringify(storage), 'utf8');
JSON.parse(fs.readFileSync(storagePath, 'utf8'));
console.log('storage.json written (no BOM), valid JSON');
console.log('DONE');
