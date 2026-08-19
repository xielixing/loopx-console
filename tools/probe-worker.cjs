// Reproduce the host's JS worker spawn path exactly:
//   node worker_host.js '<policy_json>'  (cwd = instance dir)
// then send one JSON-RPC request on stdin and print stderr/stdout.
// Usage: node tools/probe-worker.cjs <instanceDir> [method] [paramsJson]
const { spawn } = require('child_process');
const path = require('path');

const instanceDir = process.argv[2];
const method = process.argv[3] || 'loopx.detect';
const params = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const workerHost = 'D:\\BitFun\\src\\apps\\desktop\\resources\\worker_host.js';
const policy = '{}';

const child = spawn(process.execPath, [workerHost, policy], {
  cwd: instanceDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d; console.log('[worker stdout]', String(d).trim()); });
child.stderr.on('data', (d) => { err += d; console.log('[worker stderr]', String(d).trim()); });
child.on('error', (e) => { console.log('[spawn error]', e.message); process.exit(2); });

setTimeout(() => {
  child.stdin.write(JSON.stringify({ id: 't1', method, params }) + '\n');
}, 800);

setTimeout(() => {
  console.log('=== done ===');
  child.kill();
  process.exit(0);
}, 15000);
