// 构建：把 src/ 下的模块合并成一个可以直接双击打开的 play.html（不需要本地服务器）
// 用法：node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// 模块顺序：被依赖、且在顶层就要用到的模块放前面
const ORDER = ['config', 'core', 'ui', 'water', 'world', 'audio', 'notes', 'features', 'progress', 'codex', 'companion', 'overlays', 'input', 'main'];

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
