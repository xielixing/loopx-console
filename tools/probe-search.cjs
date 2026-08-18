const https = require('https');
function get(path) {
  return new Promise((resolve) => {
    https.get(
      { host: 'api.github.com', path, headers: { 'User-Agent': 'BitFun-LoopX-Console', Accept: 'application/vnd.github+json' } },
      (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => {
          let j = null;
          try { j = JSON.parse(d); } catch (_) {}
          resolve({ status: r.statusCode, total: j && j.total_count, msg: j && j.message, incomplete: j && j.incomplete_results });
        });
      },
    ).on('error', (e) => resolve({ status: 0, msg: String(e) }));
  });
}
(async () => {
  const Q = encodeURIComponent;
  console.log('A) PR title search:          ', await get(`/search/issues?q=${Q('"bitfun-loopx" in:title is:pr')}`));
  console.log('B) PR merged search:         ', await get(`/search/issues?q=${Q('"bitfun-loopx" in:title is:pr is:merged')}`));
  console.log('C) commit trailer (claude):  ', await get(`/search/commits?q=${Q('"Co-authored-by: claude"')}`));
  console.log('D) commit trailer (loopx):   ', await get(`/search/commits?q=${Q('"Co-authored-by: bitfun-loopx"')}`));
})();
