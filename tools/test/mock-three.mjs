// 生成一个假的 three.js（tools/test/.out/three-mock.js），让游戏逻辑能在没有网络、没有 WebGL 的无头浏览器里跑
// Vector3 / Vector2 / Color 是真实实现（重心、距离、颜色要用真实数值）；其余所有类都是“吞掉一切调用”的 Proxy
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const names = new Set();
for (const f of readdirSync(join(root, 'src'))) for (const m of readFileSync(join(root, 'src', f), 'utf8').matchAll(/THREE\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
for (const n of ['Vector3', 'Vector2', 'Color', 'WebGLRenderer']) names.delete(n);
const out = `
const handler = {
  get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'then') return undefined; if (!(p in t)) t[p] = mk(); return t[p]; },
  set(t, p, v) { t[p] = v; return true; }, apply() { return mk(); }, construct() { return mk(); },
};
function mk() { return new Proxy(function () {}, handler); }
const fb = o => new Proxy(o, { get(t, p) { if (p in t || typeof p === 'symbol') return t[p]; return mk(); } });
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return fb(this); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setScalar(s) { return this.set(s, s, s); }
  copy(v) { this.x = +v.x || 0; this.y = +v.y || 0; this.z = +v.z || 0; return this; } clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; } divideScalar(s) { return this.multiplyScalar(1 / s); }
  negate() { return this.multiplyScalar(-1); } length() { return Math.hypot(this.x, this.y, this.z); } normalize() { return this.divideScalar(this.length() || 1); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); } applyMatrix4() { return this; }
}
export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; return fb(this); } set(x, y) { this.x = x; this.y = y; return this; } }
export class Color { constructor(h = 0xffffff) { if (typeof h === 'number') { this.r = (h >> 16 & 255) / 255; this.g = (h >> 8 & 255) / 255; this.b = (h & 255) / 255; } else this.r = this.g = this.b = 1; return fb(this); } }
export function WebGLRenderer() { const m = mk(); m.domElement = document.createElement('canvas'); return m; }
${[...names].sort().map(n => `export const ${n} = mk();`).join('\n')}
`;
mkdirSync(join(root, 'tools/test/.out'), { recursive: true });
writeFileSync(join(root, 'tools/test/.out/three-mock.js'), out);
// 两个测试页面：模块版（可以 import 单个模块调用内部函数）和构建版 play.html
const CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^"]+\/build\/three\.module\.js/;
writeFileSync(join(root, 'tools/test/.out/modules.html'), readFileSync(join(root, 'index.html'), 'utf8').replace(CDN, '/tools/test/.out/three-mock.js').replace('src/main.js', '/src/main.js').replace('style.css', '/style.css'));
writeFileSync(join(root, 'tools/test/.out/play.html'), readFileSync(join(root, 'play.html'), 'utf8').replace(CDN, '/tools/test/.out/three-mock.js'));
console.log(`three-mock.js：${names.size} 个占位类`);
