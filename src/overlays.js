import * as THREE from 'three';
import { clock, scene } from './core.js';
import { bodies, grid, key, tmpW, toWorld, voxelMatrix } from './world.js';
import { panOf, sfx } from './audio.js';
import { features, hints } from './features.js';
import { stuckFor } from './progress.js';
import { HINT_DELAY } from './config.js';

// ================= 覆盖层：闪光 / 微光 / 气泡 / 灯塔光束（都跟随所在物块） =================
function overlayMesh(geo, max, order) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), max);
  for (let i = 0; i < max; i++) m.setColorAt(i, new THREE.Color(0, 0, 0));
  m.count = 0; m.frustumCulled = false; m.renderOrder = order;
  scene.add(m);
  return m;
}
const FLASH_MAX = 256, MARK_MAX = 128, BUB_MAX = 400;
const flashMesh = overlayMesh(new THREE.BoxGeometry(1.06, 1.06, 1.06), FLASH_MAX, 15);
const markMesh = overlayMesh(new THREE.BoxGeometry(1.08, 1.08, 1.08), MARK_MAX, 14);
// 塔顶的余烬：灰色微尘从塔顶慢慢飘起、摇摆、淡出（关卡往 glows 里放 { x, y, z, kind: 'ember' }）
const ASH_MAX = 80;
const ashMesh = overlayMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), ASH_MAX, 16);
const glows = [], ash = [];
const bubMesh = overlayMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), BUB_MAX, 17);
const hintMesh = overlayMesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), 8, 13);
const flashes = [], bubbles = [];
const alive = v => grid.get(key(v.x, v.y, v.z)) === v;

function spawnBubble(r, speed) {
  if (bubbles.length >= BUB_MAX || !r.wall) return;
  const c = r.cells[(Math.random() * r.cells.length) | 0];
  bubbles.push({ body: r.wall.body, x: c[0] + (Math.random() - 0.5) * 0.8, y: r.y - 0.45, z: c[1] + (Math.random() - 0.5) * 0.8,
    vy: speed || 0.6 + Math.random() * 0.8, ph: Math.random() * 6.28, t0: clock.elapsedTime, life: 2 + Math.random() * 1.5, s: 0.6 + Math.random() * 0.8 });
}

const beamGeo = new THREE.ConeGeometry(1.4, 9, 20, 1, true).translate(0, -4.5, 0).rotateZ(Math.PI / 2);
const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const beams = [];
const col = new THREE.Color(), m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();

function updateOverlays(t, dt) {
  // 闪光
  while (flashes.length && t - flashes[0].t0 > 0.8) flashes.shift();
  while (flashes.length > FLASH_MAX) flashes.shift();
  let fi = 0;
  for (const f of flashes) {
    if (!alive(f.v)) continue;
    const age = t - f.t0;
    flashMesh.setMatrixAt(fi, voxelMatrix(f.v, m4));
    flashMesh.setColorAt(fi++, col.setScalar(age < 0 ? 0 : 0.5 * Math.exp(-age * 5)));
  }
  flashMesh.count = fi;
  flashMesh.instanceMatrix.needsUpdate = true; flashMesh.instanceColor.needsUpdate = true;

  // 塔顶与拱梁的微光
  let mi = 0;
  const pulse = 0.09 + 0.05 * Math.sin(t * 2.2);
  for (const tw of features.towers.values()) {
    const v = grid.get(key(tw.x, tw.top, tw.z));
    if (!v || mi >= MARK_MAX) continue;
    markMesh.setMatrixAt(mi, voxelMatrix(v, m4));
    markMesh.setColorAt(mi++, col.setRGB(pulse * 2.2, pulse * 1.7, pulse * 0.5));
  }
  for (const a of features.arches.values()) for (let i = 1; i < a.k && mi < MARK_MAX; i++) {
    const v = grid.get(key(a.x + a.ax * i, a.y + 1, a.z + a.az * i));
    if (!v) continue;
    markMesh.setMatrixAt(mi, voxelMatrix(v, m4));
    markMesh.setColorAt(mi++, col.setScalar(pulse * 0.8));
  }
  markMesh.count = mi;
  // 余烬粒子：每处每秒冒出约 3 粒
  for (const g of glows) {
    const v = grid.get(key(g.x, g.y, g.z));
    if (!v || v.hidden || g.kind !== 'ember') continue;
    g.acc = (g.acc || 0) + dt * 3;
    while (g.acc > 1 && ash.length < ASH_MAX) {
      g.acc -= 1;
      ash.push({ body: v.body, x: g.x + (Math.random() - 0.5) * 0.5, y: g.y + 0.5, z: g.z + (Math.random() - 0.5) * 0.5,
        vy: 0.25 + Math.random() * 0.25, ph: Math.random() * 6.28, t0: t, life: 2.2 + Math.random() * 1.5 });
    }
  }
  for (let i = ash.length - 1; i >= 0; i--) if (t - ash[i].t0 > ash[i].life || !bodies.has(ash[i].body)) ash.splice(i, 1);
  ash.forEach((p, i) => {
    const age = t - p.t0, k = Math.min(1, age * 3) * (1 - age / p.life);
    p.y += p.vy * dt;
    pos.set(p.x + Math.sin(age * 1.7 + p.ph) * 0.15, p.y, p.z + Math.cos(age * 1.3 + p.ph) * 0.15);
    ashMesh.setMatrixAt(i, m4.multiplyMatrices(p.body.content.matrixWorld, m5.compose(pos, q, sc.setScalar(0.6 + 0.6 * (1 - age / p.life)))));
    ashMesh.setColorAt(i, col.setScalar(0.32 * k));
  });
  ashMesh.count = ash.length;
  ashMesh.instanceMatrix.needsUpdate = true; ashMesh.instanceColor.needsUpdate = true;
  markMesh.instanceMatrix.needsUpdate = true; markMesh.instanceColor.needsUpdate = true;

  // “差一点”提示：空格子上一个很淡、缓慢呼吸的方块
  // 只有长时间没有发现新建筑时才出现（HINT_DELAY 秒后用 5 秒淡入）
  let hi = 0;
  const hintK = THREE.MathUtils.smoothstep(stuckFor(t), HINT_DELAY, HINT_DELAY + 5);
  if (hintK > 0) for (const h of hints) {
    if (!bodies.has(h.body)) continue;
    hintMesh.setMatrixAt(hi, voxelMatrix(h, m4));
    hintMesh.setColorAt(hi++, col.setScalar(hintK * (0.05 + 0.06 * (0.5 + 0.5 * Math.sin(t * 2.4 + h.x + h.z)))));
  }
  hintMesh.count = hi;
  hintMesh.instanceMatrix.needsUpdate = true; hintMesh.instanceColor.needsUpdate = true;

  // 泉：持续冒泡 + 零星气泡声
  for (const r of features.rings.values()) {
    r.timer += dt;
    const interval = 0.35 / Math.sqrt(r.cells.length);
    while (r.timer > interval) { r.timer -= interval; spawnBubble(r); }
    r.popT -= dt;
    if (r.popT <= 0 && r.wall) { r.popT = 0.6 + Math.random() * 1.4; sfx.tiny(panOf(toWorld(r.wall, tmpW))); }
  }
  for (let i = bubbles.length - 1; i >= 0; i--) if (t - bubbles[i].t0 > bubbles[i].life || !bodies.has(bubbles[i].body)) bubbles.splice(i, 1);
  bubbles.forEach((b, i) => {
    const age = t - b.t0, k = Math.max(0, Math.min(1, age * 4) * (1 - age / b.life) * 0.7);
    b.y += b.vy * dt;
    pos.set(b.x + Math.sin(age * 5 + b.ph) * 0.06, b.y, b.z + Math.cos(age * 4 + b.ph) * 0.06);
    bubMesh.setMatrixAt(i, m4.multiplyMatrices(b.body.content.matrixWorld, m5.compose(pos, q, sc.setScalar(b.s))));
    bubMesh.setColorAt(i, col.setRGB(k * 0.6, k * 0.9, k));
  });
  bubMesh.count = bubbles.length;
  bubMesh.instanceMatrix.needsUpdate = true; bubMesh.instanceColor.needsUpdate = true;

  // 灯塔光束
  const list = [...features.towers.values()];
  while (beams.length < list.length) {
    const m = new THREE.Mesh(beamGeo, beamMat);
    m.matrixAutoUpdate = false; m.renderOrder = 18; m.frustumCulled = false;
    scene.add(m); beams.push(m);
  }
  beams.forEach((m, i) => {
    const tw = list[i], v = tw && grid.get(key(tw.x, tw.top, tw.z));
    m.visible = !!v;
    if (!v) return;
    m5.makeRotationY(t * 0.9 + i * 1.7).multiply(m4.makeRotationZ(-0.08));
    m.matrix.multiplyMatrices(voxelMatrix(v, m4, 0.1), m5);
  });
}

export { glows, overlayMesh, FLASH_MAX, MARK_MAX, BUB_MAX, flashMesh, markMesh, bubMesh, flashes, bubbles, alive, spawnBubble, beamGeo, beamMat, beams, col, m4, m5, q, sc, pos, updateOverlays };
