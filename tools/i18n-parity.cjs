// i18n parity check: zh-CN and en-US tables in source/ui.js must carry
// identical keys.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'source', 'ui.js'), 'utf8');
const start = src.indexOf('const I18N = {');
const end = src.indexOf('\nfunction t(');
if (start < 0 || end < 0) { console.log('could not locate I18N block'); process.exit(1); }
const objSrc = src.slice(start + 'const I18N = '.length, end).trim().replace(/;$/, '');
const I18N = eval('(' + objSrc + ')');
const locales = Object.keys(I18N).sort();
const zh = Object.keys(I18N['zh-CN']).sort();
const en = Object.keys(I18N['en-US']).sort();
const onlyZh = zh.filter((k) => !en.includes(k));
const onlyEn = en.filter((k) => !zh.includes(k));
console.log('locales:', locales.join(', '));
console.log('zh only:', onlyZh.length ? onlyZh.join(', ') : '(none)');
console.log('en only:', onlyEn.length ? onlyEn.join(', ') : '(none)');
process.exit(onlyZh.length || onlyEn.length ? 1 : 0);
