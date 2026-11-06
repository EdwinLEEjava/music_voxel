import * as THREE from 'three';
import { INST, SEED_SHAPES, TYPE_INST } from './config.js';
import { camera, clock, renderer, scene } from './core.js';
import { toast } from './ui.js';
import { U, addRipple, waterMat } from './water.js';
import { addVoxel, spanR, tmpW, viewTarget, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { worldOf } from './features.js';

// ================= 解锁：色彩进度 + 远处出现乐器组件 =================
const discovered = new Set(), TOTAL_TYPES = 7;
let colorful = 0;
const BG_MONO = new THREE.Color(0x000000), BG_COLOR = new THREE.Color(0x06101f), bgNow = new THREE.Color();
const BLOOM_SPEED = 9;             // 色彩冲击波扩散速度（格/秒）
let colPrev = 0, bloomX = 0, bloomZ = 0, bloomT = -99;

// ———— 视觉层：每发现一种建筑，世界多出一层新东西（颜色取自那种建筑的乐器） ————
// 第 1 层：远方辉光。镜头俯视看不到真正的地平线，所以垫一张全屏背景，越靠画面上方（越远）越亮
const layers = [];                 // 第 i 层 → { col, on(0~1 当前强度) }
const skyMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { uBg: { value: new THREE.Color() }, uGlowCol: { value: new THREE.Color() }, uGlow: { value: 0 }, uTime: U.uTime },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uBg, uGlowCol; uniform float uGlow, uTime;
    varying vec2 vUv;
    void main() {
      float h = smoothstep(0.25, 1.0, vUv.y);
      float breathe = 0.9 + 0.1 * sin(uTime * 0.4 + vUv.x * 2.0);
      vec3 col = uBg + uGlowCol * uGlow * (h * h * 0.32 + h * 0.06) * breathe;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
sky.frustumCulled = false; sky.renderOrder = -100;
scene.add(sky);
// x, z：建筑所在的世界坐标，冲击波从这里荡开
function discover(type, x = viewTarget.x, z = viewTarget.z) {
  if (discovered.has(type)) return;
  colPrev = colorful;
  discovered.add(type);
  colorful = Math.min(1, discovered.size / TOTAL_TYPES * 1.25);
  bloomX = x; bloomZ = z; bloomT = U.uTime.value;
  const u = waterMat.uniforms;
  u.uColPrev.value = colPrev;
  u.uBloom.value.set(x, z, bloomT, BLOOM_SPEED);
  u.uBloomCol.value.copy(INST[TYPE_INST[type]].col);
  addRipple(x, z, 0.35);
  layers.push({ col: INST[TYPE_INST[type]].col.clone(), on: 0 });
  setTimeout(() => spawnSeed(TYPE_INST[type]), 1600);
  setTimeout(() => toast(`世界多了一分颜色 · ${discovered.size}/${TOTAL_TYPES}`), 4200);
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
  // 天空与雾：等冲击波扫到镜头附近时跟着变色
  const dCam = Math.hypot(camera.position.x - bloomX, camera.position.z - bloomZ);
  const k = THREE.MathUtils.smoothstep((U.uTime.value - bloomT) * BLOOM_SPEED, dCam * 0.3, dCam * 1.1);
  bgNow.lerpColors(BG_MONO, BG_COLOR, colPrev + (colorful - colPrev) * k);
  renderer.setClearColor(bgNow, 1);
  for (let i = 0; i < layers.length; i++) layers[i].on = i < layers.length - 1 ? 1 : k;   // 最新一层跟着冲击波亮起
  skyMat.uniforms.uBg.value.copy(bgNow);
  const L1 = layers[0];
  skyMat.uniforms.uGlow.value = L1 ? L1.on : 0;
  if (L1) skyMat.uniforms.uGlowCol.value.copy(L1.col);
  scene.fog.color.copy(bgNow);
}

export { layers, sky, discovered, TOTAL_TYPES, colorful, BG_MONO, BG_COLOR, bgNow, discover, spawnSeed, updateColorful };
