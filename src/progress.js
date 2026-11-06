import * as THREE from 'three';
import { INST, SEED_SHAPES, TYPE_INST } from './config.js';
import { camera, clock, renderer, scene, sun } from './core.js';
import { toast } from './ui.js';
import { U, addRipple, waterMat } from './water.js';
import { addVoxel, grid, spanR, tmpW, toWorld, viewTarget, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { instances, worldOf } from './features.js';
import { flashes } from './overlays.js';

// ================= 解锁：色彩进度 + 远处出现乐器组件 =================
const discovered = new Set(), TOTAL_TYPES = 7;
let colorful = 0;
// ———— 从黑夜到黎明：每发现一种建筑，世界往前走一个阶段 ————
// bg：天空与雾  lo / hi：海面暗部 / 亮部  gl：月光（日光）
// 只沿着一条和谐的渐变走（参考纪念碑谷），不引入额外的色相
const c = h => new THREE.Color(h);
const STAGES = [
  { name: '黑白',   bg: c(0x000000), lo: c(0x090909), hi: c(0x161616), gl: c(0xffffff) },
  { name: '深夜',   bg: c(0x05101e), lo: c(0x031019), hi: c(0x0a2533), gl: c(0xe6eeff) },
  { name: '靛蓝',   bg: c(0x0c1030), lo: c(0x070a22), hi: c(0x151c42), gl: c(0xdcdcff) },
  { name: '淡紫',   bg: c(0x21173d), lo: c(0x100a24), hi: c(0x2a1e48), gl: c(0xeedcff) },
  { name: '玫瑰',   bg: c(0x3d2146), lo: c(0x1c0c22), hi: c(0x45253f), gl: c(0xffd6e4) },
  { name: '桃色',   bg: c(0x6b394c), lo: c(0x2a1220), hi: c(0x603446), gl: c(0xffd8bf) },
  { name: '霞光',   bg: c(0xa15a52), lo: c(0x3b1a22), hi: c(0x7f4a4a), gl: c(0xffe0a6) },
  { name: '日出',   bg: c(0xe0a274), lo: c(0x4c2a2a), hi: c(0xa86c58), gl: c(0xfff1c8) },
];
let stageA = STAGES[0], stageB = STAGES[0];
const bgNow = new THREE.Color(), WHITE_SUN = new THREE.Color(1, 1, 1);
function setStageUniforms() {
  const u = waterMat.uniforms;
  u.uLoA.value.copy(stageA.lo); u.uLoB.value.copy(stageB.lo);
  u.uHiA.value.copy(stageA.hi); u.uHiB.value.copy(stageB.hi);
  u.uGlA.value.copy(stageA.gl); u.uGlB.value.copy(stageB.gl);
}
const BLOOM_SPEED = 9;             // 色彩冲击波扩散速度（格/秒）
let colPrev = 0, bloomX = 0, bloomZ = 0, bloomT = -99, bloomV = BLOOM_SPEED;
const order = [];                 // 发现顺序，结局按这个顺序奏响
let finaleT = -1;

// x, z：建筑所在的世界坐标，冲击波从这里荡开
function discover(type, x = viewTarget.x, z = viewTarget.z) {
  if (discovered.has(type)) return;
  colPrev = colorful;
  discovered.add(type);
  order.push(type);
  colorful = Math.min(1, discovered.size / TOTAL_TYPES * 1.25);
  bloomX = x; bloomZ = z; bloomT = U.uTime.value; bloomV = BLOOM_SPEED;
  const u = waterMat.uniforms;
  u.uColPrev.value = colPrev;
  u.uBloom.value.set(x, z, bloomT, BLOOM_SPEED);
  u.uBloomAmp.value = 1;
  addRipple(x, z, 0.35);
  // 第 1~6 种各推进一个阶段；第 7 种的“日出”留给结局的大光环
  if (discovered.size < TOTAL_TYPES) { stageA = stageB; stageB = STAGES[discovered.size]; }
  else stageA = stageB;
  setStageUniforms();
  u.uBloomCol.value.copy(stageB.gl);   // 光环是新阶段的光的颜色
  setTimeout(() => spawnSeed(TYPE_INST[type]), 1600);
  if (discovered.size < TOTAL_TYPES) setTimeout(() => toast(`${stageB.name} · ${discovered.size}/${TOTAL_TYPES}`), 4200);
  else setTimeout(finale, 2800);
}
// ———— 结局：七种建筑全部发现 ————
// 1) 从结构中心荡开一圈又大又慢的白色光环  2) 每种建筑按发现顺序亮起、奏出自己的乐器音（一段上行的旋律）
// 3) 全部方块从中心向外依次闪亮 + 收尾和弦  4) 月光、星光达到顶峰，之后停在略亮的“苏醒”状态
const FINALE_STEPS = [4, 5, 6, 7, 8, 9, 10];
function finale() {
  const cx = viewTarget.x, cz = viewTarget.z, t = U.uTime.value;
  finaleT = t;
  const u = waterMat.uniforms;
  u.uColPrev.value = colorful;
  u.uBloom.value.set(cx, cz, t, 5);
  u.uBloomAmp.value = 2.2;
  // 日出：最后一个阶段随这圈大光环铺开
  stageA = stageB; stageB = STAGES[STAGES.length - 1]; setStageUniforms();
  u.uBloomCol.value.copy(stageB.gl);
  bloomX = cx; bloomZ = cz; bloomT = t; bloomV = 5;
  addRipple(cx, cz, 0.45);
  sfx.chord(0);
  order.forEach((type, i) => setTimeout(() => {
    const ins = [...instances.values()].find(o => o.type === type);
    if (!ins) return;
    const now = clock.elapsedTime;
    ins.cells.forEach((k, j) => { const v = grid.get(k); if (v) flashes.push({ v, t0: now + j * 0.03 }); });
    const v0 = grid.get(ins.cells[0]);
    sfx.instNote(TYPE_INST[type], FINALE_STEPS[i], v0 ? panOf(toWorld(v0, tmpW)) : 0);
  }, 1400 + i * 520));
  const tEnd = 1400 + order.length * 520 + 300;
  setTimeout(() => {
    const now = clock.elapsedTime;
    for (const v of voxels) flashes.push({ v, t0: now + Math.hypot(v.x - cx, v.z - cz) / 8 });
    sfx.chord(0);
    addRipple(cx, cz, 0.3);
    toast('日 出');
  }, tEnd);
}
// 结局的亮度包络：1.5 秒升到顶峰，再用 6 秒左右落到 0.35 并保持
function finaleLevel(t) {
  if (finaleT < 0 || t < finaleT) return 0;
  const a = t - finaleT;
  return a < 1.5 ? a / 1.5 : 0.35 + 0.65 * Math.exp(-(a - 1.5) / 2.5);
}

// 在虚空中找一块空地，生成一个小小的乐器组件
function spawnSeed(inst) {
  if (!voxels.length) return;
  let pos = null;
  for (let tries = 0; tries < 30 && !pos; tries++) {
    const ang = Math.random() * Math.PI * 2, d = spanR + 7 + Math.random() * 5;
    const x = Math.round(viewTarget.x + Math.cos(ang) * d), z = Math.round(viewTarget.z + Math.sin(ang) * d);
    if (voxels.every(v => Math.hypot(v.x - x, v.z - z) > 4)) pos = { x, z };
  }
  if (!pos) return;
  const shape = SEED_SHAPES[(Math.random() * SEED_SHAPES.length) | 0];
  let b = null;
  for (const [dx, dy, dz] of shape) { const v = addVoxel(pos.x + dx, dy, pos.z + dz, inst, { silent: true, body: b }); if (v) b = v.body; }
  if (!b) return;
  b.group.updateMatrixWorld(true);
  worldOf(pos.x, 0, pos.z);
  addRipple(tmpW.x, tmpW.z, 0.28);
  sfx.instNote(inst, 6, panOf(tmpW), true);
  setTimeout(() => sfx.instNote(inst, 8, panOf(tmpW), true), 260);
  toast(`远处出现了 · ${INST[inst].name}`);
  b.spin.x += 0.3; b.heaveV -= 1;
}
function updateColorful(dt) {
  waterMat.uniforms.uColorful.value = colorful;
  U.uFinale.value = finaleLevel(U.uTime.value);
  // 结局：雾跟着光环被推远（略慢于光环），推开后保持晴朗
  if (finaleT >= 0) { const a = Math.max(0, U.uTime.value - finaleT); U.uFogPush.value = 30 * (1 - Math.exp(-a * 5 * 0.8 / 30)); }
  // 天空与雾：等冲击波扫到镜头附近时跟着变色
  const dCam = Math.hypot(camera.position.x - bloomX, camera.position.z - bloomZ);
  const k = THREE.MathUtils.smoothstep((U.uTime.value - bloomT) * bloomV, dCam * 0.3, dCam * 1.1);
  U.uProg.value = colPrev + (colorful - colPrev) * k;
  bgNow.lerpColors(stageA.bg, stageB.bg, k);
  sun.color.lerpColors(WHITE_SUN, stageA.gl.clone().lerp(stageB.gl, k), 0.6);   // 方块也被这一阶段的光照着
  renderer.setClearColor(bgNow, 1);
  U.uFogCol.value.copy(bgNow);
}

export { STAGES, discovered, TOTAL_TYPES, colorful, bgNow, discover, spawnSeed, updateColorful };

setStageUniforms();
