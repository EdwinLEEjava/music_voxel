import * as THREE from 'three';
import { clock, scene } from './core.js';
import { bodies, grid, key, tmpW, toWorld, voxelMatrix } from './world.js';
import { panOf, sfx } from './audio.js';
import { features } from './features.js';

// ================= 覆盖层：闪光 / 微光 / 气泡 / 灯塔光束（都跟随所在物块） =================
function overlayMesh(geo, max, order) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), max);
  for (let i = 0; i < max; i++) m.setColorAt(i, new THREE.Color(0, 0, 0));
  m.count = 0; m.frustumCulled = false; m.renderOrder = order;
  scene.add(m);
  return m;
}
const FLASH_MAX = 96, MARK_MAX = 128, BUB_MAX = 400;
const flashMesh = overlayMesh(new THREE.BoxGeometry(1.06, 1.06, 1.06), FLASH_MAX, 15);
const markMesh = overlayMesh(new THREE.BoxGeometry(1.08, 1.08, 1.08), MARK_MAX, 14);
const bubMesh = overlayMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), BUB_MAX, 17);
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
  markMesh.instanceMatrix.needsUpdate = true; markMesh.instanceColor.needsUpdate = true;

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

export { overlayMesh, FLASH_MAX, MARK_MAX, BUB_MAX, flashMesh, markMesh, bubMesh, flashes, bubbles, alive, spawnBubble, beamGeo, beamMat, beams, col, m4, m5, q, sc, pos, updateOverlays };
