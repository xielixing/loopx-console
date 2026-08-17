// Deterministic CDP probe: open a page in headless Edge and evaluate live.
// Usage: node tools/cdp-probe.mjs <file-url-or-path> [waitMs]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const target = process.argv[2];
const waitMs = Number(process.argv[3] || 6000);
const port = 9223 + Math.floor(Math.random() * 200);

const edge = spawn(
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, '--user-data-dir=' + (process.env.TEMP || '/tmp') + `\\lx-cdp-${port}`,
    '--window-size=1280,900', target,
  ],
  { stdio: 'ignore' },
);

let ws;
try {
  // Wait for the page target to appear.
  let targetInfo = null;
  for (let i = 0; i < 60 && !targetInfo; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      targetInfo = list.find((t) => t.type === 'page');
    } catch (_) { /* not up yet */ }
    if (!targetInfo) await sleep(250);
  }
  if (!targetInfo) throw new Error('no CDP page target');

  ws = new WebSocket(targetInfo.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __exception: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(waitMs);

  const report = await evalJs(`(() => {
    const r = (el) => { if (!el) return 'null'; const b = el.getBoundingClientRect(); return 'w' + b.width.toFixed(1) + 'x' + b.height.toFixed(1) + '@(' + b.x.toFixed(1) + ',' + b.y.toFixed(1) + ')'; };
    const sel = document.getElementById('composer-target');
    const model = document.getElementById('composer-model');
    const out = [];
    out.push('readyState=' + document.readyState + ' innerW=' + innerWidth);
    out.push('patchDone=' + window.__patchDone + ' errs=' + (window.__errs ? window.__errs.length : 'none'));
    if (window.__errs) window.__errs.forEach((e, i) => out.push('err[' + i + '] ' + String(e).slice(0, 400)));
    out.push('zoneTitle=' + JSON.stringify((document.getElementById('review-zone-title') || {}).textContent || ''));
    out.push('target rect=' + r(sel) + ' chip=' + r(sel && sel.closest('.composer__target')) + ' visible=' + !!(sel && sel.offsetParent) + ' opts=' + (sel ? sel.options.length : -1) + ' value=' + (sel ? JSON.stringify(sel.value) : '-'));
    if (sel) for (const o of sel.options) out.push('target opt: ' + JSON.stringify(o.value) + ' / ' + JSON.stringify(o.textContent));
    out.push('model rect=' + r(model) + ' opts=' + (model ? model.options.length : -1) + ' value=' + (model ? JSON.stringify(model.value) : '-'));
    if (model) for (const o of model.options) out.push('model opt: ' + JSON.stringify(o.value) + ' / ' + JSON.stringify(o.textContent));
    const review = document.getElementById('review-list'); const active = document.getElementById('active-list');
    out.push('review children=' + (review ? review.children.length : -1) + ' active children=' + (active ? active.children.length : -1));
    if (review && review.children.length) out.push('review[0]=' + review.children[0].className + ' text=' + JSON.stringify(review.children[0].textContent.slice(0, 60)));
    return out.join('\\n');
  })()`);
  console.log(report);
} finally {
  try { ws && ws.close(); } catch (_) {}
  edge.kill();
}
