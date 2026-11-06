import * as THREE from 'three';
import { INST, SEED_SHAPES, TYPE_INST } from './config.js';
import { camera, clock, renderer, scene } from './core.js';
import { toast } from './ui.js';
import { P, PAL_GLSL, U, addRipple, waterMat } from './water.js';
import { addVoxel, spanR, tmpW, viewTarget, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { worldOf } from './features.js';

// ================= 解锁：色彩进度 + 远处出现乐器组件 =================
const discovered = new Set(), TOTAL_TYPES = 7;
let colorful = 0;
const BG_MONO = new THREE.Color(0x000000), BG_COLOR = new THREE.Color(0x06101f), bgNow = new THREE.Color();
const BLOOM_SPEED = 9;             // 色彩冲击波扩散速度（格/秒）
let colPrev = 0, bloomX = 0, bloomZ = 0, bloomT = -99;

// ———— 视觉层：每发现一种建筑，世界多出一层新东西 ————
// 1 远方辉光  2 海面主色调  3 星空与星光倒影  4 彩色月光  5 浪尖荧光  6 彩色涟漪  （7 结局，另做）
// 所有层的颜色都来自“调色板”：已发现建筑的乐器颜色，每多发现一种，所有层都会多一种颜色
const layers = [];                 // 第 i 层 → { on(0~1 当前强度) }
// 镜头俯视看不到真正的地平线，所以垫一张全屏背景：越靠画面上方（越远）越亮
const skyMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { ...P, uBg: { value: new THREE.Color() }, uSkyK: { value: 0 }, uTime: U.uTime },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: /* glsl */`
    ${PAL_GLSL}
    uniform vec3 uBg; uniform float uSkyK, uTime;
    varying vec2 vUv;
    float lay(int i) { return uLay[i] * (float(i) == uNewest ? uSkyK : 1.0); }
    void main() {
      float h = smoothstep(0.25, 1.0, vUv.y);
      // 第 1 层：辉光沿画面横向排开所有已发现的颜色，缓慢漂移；颜色越多越亮
      vec3 g = palAt(vUv.x * 0.6 + uTime * 0.008);
      float strength = 0.6 + 0.4 * uPalN / 7.0;
      float breathe = 0.9 + 0.1 * sin(uTime * 0.4 + vUv.x * 3.0);
      vec3 col = uBg + g * lay(0) * strength * (h * h * 0.32 + h * 0.06) * breathe;
      // 第 3 层：星空
      vec2 cell = floor(gl_FragCoord.xy / 3.0);
      float star = step(0.996, hashP(cell)) * (0.5 + 0.5 * sin(uTime * (1.0 + hashP(cell + 5.0) * 2.0) + hashP(cell + 9.0) * 6.28));
      col += mix(vec3(1.0), palAt(hashP(cell + 2.0)), 0.4) * star * smoothstep(0.35, 0.9, vUv.y) * 0.5 * lay(2);
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
  const n = discovered.size;
  P.uPal.value[n - 1].copy(INST[TYPE_INST[type]].col);
  P.uPalN.value = n;
  P.uPalAvg.value.setRGB(0, 0, 0);
  for (let i = 0; i < n; i++) P.uPalAvg.value.add(P.uPal.value[i]);
  P.uPalAvg.value.multiplyScalar(1 / n);
  if (layers.length < 6) { layers.push({ on: 0 }); P.uNewest.value = layers.length - 1; }
  else P.uNewest.value = -1;                     // 第 7 种：结局，另做
  layers.forEach((l, i) => (P.uLay.value[i] = 1));
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
  for (let i = 0; i < layers.length; i++) layers[i].on = i === P.uNewest.value ? k : 1;
  skyMat.uniforms.uBg.value.copy(bgNow);
  skyMat.uniforms.uSkyK.value = k;               // 天空上的新一层，等冲击波到了镜头附近才亮
  scene.fog.color.copy(bgNow);
}

export { layers, sky, discovered, TOTAL_TYPES, colorful, BG_MONO, BG_COLOR, bgNow, discover, spawnSeed, updateColorful };
