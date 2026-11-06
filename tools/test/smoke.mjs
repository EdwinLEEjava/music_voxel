// 冒烟测试：node tools/test/smoke.mjs
// 1) 生成假的 three.js  2) 起一个不缓存的静态服务器  3) 无头 Chrome 跑：开始页面 → 第一关完整流程 → 构建版 play.html
// 注意：假 three 里时钟不会走、没有画面，所以只能测逻辑和报错，不能测动画和观感
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
execFileSync(process.execPath, [join(root, 'tools/test/mock-three.mjs')], { stdio: 'inherit' });
let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try { const p = join(root, decodeURIComponent(req.url.split('?')[0])), body = await readFile(p); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'text/plain', 'cache-control': 'no-store' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
let failed = 0;
async function run(name, url, fn) {
  const pg = await browser.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]?.trim()));
  await pg.goto(base + url); await pg.waitForTimeout(500);
  const out = await fn(pg);
  if (errs.length) failed++;
  console.log(`\n== ${name} ==\n${out}\n报错：${errs.length ? errs.join('\n      ') : '无'}`);
  await pg.close();
}
await run('第一关流程（模块版）', '/tools/test/.out/modules.html', async pg => {
  await pg.click('[data-go="start"]'); await pg.waitForTimeout(1200);
  return pg.evaluate(async () => {
    const W = await import('/src/world.js'), L = await import('/src/level.js'), H = await import('/src/hotbar.js'), F = await import('/src/features.js');
    const o = [], st = s => o.push(`${s}：灯=${H.inv.lamp} 点亮=${F.features.towers.size}`);
    st('开局');
    W.addVoxel(4, 4, -2); W.addVoxel(4, 5, -2); st('塔顶补 2 格');
    L.reveal(1); H.addItem('lamp', 1);
    o.push('地面放灯 ' + L.placeLamp({ x: -13, y: 1, z: -9 })); st('照不到');
    H.addItem('lamp', 1); W.addVoxel(-17, 2, -8); W.addVoxel(-17, 3, -8);
    o.push('码头柱顶放灯 ' + L.placeLamp({ x: -17, y: 4, z: -8 })); st('第二条船');
    L.restartLevel(); o.push('R 重开后方块数 ' + W.voxels.filter(v => !v.relic).length);
    return o.join('\n');
  });
});
await run('构建版 play.html', '/tools/test/.out/play.html', async pg => {
  await pg.click('[data-go="start"]'); await pg.waitForTimeout(9000);   // 假时钟不走，等 8 秒保险解锁
  await pg.mouse.click(100, 70); await pg.waitForTimeout(300);
  return 'HUD 方块数 ' + await pg.evaluate(() => document.getElementById('count').textContent);
});
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
