// 构建：把 src/ 下的模块合并成一个可以直接双击打开的 play.html（不需要本地服务器）
// 用法：node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// 模块顺序：被依赖、且在顶层就要用到的模块放前面
const ORDER = ['config', 'core', 'ui', 'water', 'world', 'audio', 'notes', 'features', 'progress', 'codex', 'menu', 'hotbar', 'models', 'companion', 'overlays', 'input', 'main', 'level', 'title'];

// 所有模块会合并进同一个作用域：顶层重名会让 play.html 直接报错，这里提前拦下
{
  const seen = new Map(), dups = [];
  for (const name of ORDER) for (const line of read(`src/${name}.js`).split('\n')) {
    const m = line.match(/^(?:const|let|var|function|class)\s+(.*)/);
    if (!m) continue;
    let names;
    if (/^(function|class)/.test(line)) names = [m[1].match(/^[\w$]+/)[0]];
    else {
      let depth = 0, cur = ''; const parts = [];
      for (const ch of m[1]) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      names = parts.map(p => (p.trim().match(/^[\w$]+/) || [])[0]).filter(Boolean);
    }
    for (const n of names) { if (seen.has(n)) dups.push(`${n}（${seen.get(n)}.js 和 ${name}.js）`); else seen.set(n, name); }
  }
  if (dups.length) { console.error('构建失败：模块顶层变量重名 → ' + dups.join('、')); process.exit(1); }
}

const parts = ORDER.map(name => {
  const src = read(`src/${name}.js`)
    .replace(/^import[^\n]*\n/gm, '')          // 去掉 import 行
    .replace(/^export \{[^}]*\};?\n?/gm, '')   // 去掉 export 行
    .trim();
  return `// ======================= src/${name}.js =======================\n${src}`;
});

const index = read('index.html');
const css = read('style.css');
const importmap = index.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const body = index.match(/<body>\n([\s\S]*?)<script type="importmap">/)[1];

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>水中体素 Voxel Demo</title>
<!-- 自动生成的文件，请不要直接修改：改 src/ 后运行 node tools/build.mjs -->
<style>
${css}</style>
</head>
<body>
${body}${importmap}
<script type="module">
import * as THREE from 'three';

${parts.join('\n\n')}
</script>
</body>
</html>
`;
writeFileSync(join(root, 'play.html'), html);
console.log(`play.html 已生成（${(html.length / 1024).toFixed(1)} KB）`);
