// Classification contract test for the strict intake grammar.
const fs = require('fs');
const Module = require('module');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'source', 'worker.js'), 'utf8')
  + '\nmodule.exports.__test = { githubReferences };';

const mod = new Module('worker-under-test', null);
mod.filename = path.join(__dirname, '..', 'source', 'worker.js');
mod.paths = Module._nodeModulePaths(path.dirname(mod.filename));
mod._compile(src, mod.filename);
const { githubReferences } = mod.exports.__test;

const cases = [
  ['single issue', 'https://github.com/ow/re/issues/3', ['issue']],
  ['single pr', 'https://github.com/ow/re/pull/3', ['pr']],
  ['repo home', 'https://github.com/ow/re', ['repository']],
  ['repo home trailing slash', 'https://github.com/ow/re/', ['repository']],
  ['issues list', 'https://github.com/ow/re/issues', ['issues-list']],
  ['issues list with query', 'https://github.com/ow/re/issues?q=is:open', ['issues-list']],
  ['link with instructions', 'please fix https://github.com/ow/re/issues/3 thanks', ['issue']],
  ['two issues same repo', 'https://github.com/ow/re/issues/1 and https://github.com/ow/re/issues/2', ['issue', 'issue']],
  ['settings page rejected', 'https://github.com/ow/re/settings', []],
  ['pulls list rejected', 'https://github.com/ow/re/pulls', []],
  ['release page rejected', 'https://github.com/ow/re/releases/tag/v1', []],
  ['tree path rejected', 'https://github.com/ow/re/tree/main', []],
  ['new issue page rejected', 'https://github.com/ow/re/issues/new', []],
  ['org page rejected', 'https://github.com/ow', []],
  ['free text rejected', 'fix everything please', []],
  ['non-github rejected', 'https://gitlab.com/ow/re/issues/3', []],
];

let failed = 0;
for (const [label, input, expectedKinds] of cases) {
  const { refs, unsupported } = githubReferences(input);
  const kinds = refs.map((r) => r.kind);
  // Rejected inputs must produce no supported refs. Unsupported-path URLs are
  // reported in `unsupported`; inputs without any GitHub link are simply empty
  // and surface as `unsupported_input` in resolveIntake/taskIntake.
  const ok = JSON.stringify(kinds) === JSON.stringify(expectedKinds)
    && kinds.length === 0 ? true
    : (JSON.stringify(kinds) === JSON.stringify(expectedKinds) && unsupported.length === 0);
  if (!ok) {
    failed += 1;
    console.log(`FAIL ${label}: kinds=${JSON.stringify(kinds)} unsupported=${JSON.stringify(unsupported.map((u) => u.url))}`);
  } else {
    console.log(`ok   ${label}`);
  }
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
