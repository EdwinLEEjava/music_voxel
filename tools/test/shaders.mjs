// 着色器编译测试：node tools/test/shaders.mjs —— 把水面着色器（和注入方块材质的水下 / 雾片段）在无头 Chrome 的 WebGL2 里真编译一次
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const w = readFileSync(join(root, 'src/water.js'), 'utf8');
const tpl = (src, start) => { const i = src.indexOf('`', src.indexOf(start)); return src.slice(i + 1, src.indexOf('`', i + 1)); };
const ev = s => Function('RIPPLE_N', 'WAVE_GLSL', 'HASH_GLSL', 'return `' + s + '`;');
const WAVE = ev(tpl(w, 'const WAVE_GLSL'))(8), HASH = ev(tpl(w, 'const HASH_GLSL'))(8), wm = w.slice(w.indexOf('const waterMat'));
const mu = w.slice(w.indexOf('function makeUnderwater'));
const head = eval(mu.match(/'#include <common>', ('#include <common>\\nvarying vec3 vWP;\\n[^']*')/)[1]).replace('#include <common>', '');
const bi = mu.indexOf('`', mu.indexOf("'#include <fog_fragment>'"));
const S = {
  water: [ev(tpl(wm, 'vertexShader'))(8, WAVE, HASH), ev(tpl(wm, 'fragmentShader'))(8, WAVE, HASH)],
  block: ['out vec3 vWP; void main(){ vWP = position; gl_Position = vec4(position,1.0); }',
    head + '\n' + WAVE + '\nvoid main(){ gl_FragColor = vec4(1.0);\n' + mu.slice(bi + 1, mu.indexOf('`', bi + 1)).replace('#include <fog_fragment>', '') + '\n}'],
};
let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
const b = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage();
const r = await pg.evaluate(S => {
  const gl = document.createElement('canvas').getContext('webgl2'), res = {};
  const pre = '#version 300 es\nprecision highp float;\nprecision highp int;\n#define texture2D texture\nuniform mat4 modelMatrix, viewMatrix, projectionMatrix;\nuniform vec3 cameraPosition;\n';
  for (const [n, [v, f]] of Object.entries(S)) {
    const p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, pre + 'in vec3 position;\nin vec2 uv;\n#define varying out\n' + v], [gl.FRAGMENT_SHADER, pre + 'out vec4 fc;\n#define gl_FragColor fc\n#define varying in\n' + f]]) {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) res[n + (t === gl.VERTEX_SHADER ? ' 顶点' : ' 片元')] = gl.getShaderInfoLog(s);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    res[n] = gl.getProgramParameter(p, gl.LINK_STATUS) ? '通过' : gl.getProgramInfoLog(p);
  }
  return res;
}, S);
console.log(r); await b.close();
process.exit(Object.values(r).every(v => v === '通过') ? 0 : 1);
