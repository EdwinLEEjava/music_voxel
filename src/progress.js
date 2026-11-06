import * as THREE from 'three';
import { INST, SEED_SHAPES, TYPE_INST } from './config.js';
import { renderer, scene } from './core.js';
import { toast } from './ui.js';
import { addRipple, waterMat } from './water.js';
import { addVoxel, spanR, tmpW, viewTarget, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { worldOf } from './features.js';

// ================= 解锁：色彩进度 + 远处出现乐器组件 =================
const discovered = new Set(), TOTAL_TYPES = 7;
let colorful = 0;
const BG_MONO = new THREE.Color(0x000000), BG_COLOR = new THREE.Color(0x06101f), bgNow = new THREE.Color();
function discover(type) {
  if (discovered.has(type)) return;
  discovered.add(type);
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
  colorful += (Math.min(1, discovered.size / TOTAL_TYPES * 1.25) - colorful) * (1 - Math.exp(-dt * 0.6));
  waterMat.uniforms.uColorful.value = colorful;
  bgNow.lerpColors(BG_MONO, BG_COLOR, colorful);
  renderer.setClearColor(bgNow, 1);
  scene.fog.color.copy(bgNow);
}

export { discovered, TOTAL_TYPES, colorful, BG_MONO, BG_COLOR, bgNow, discover, spawnSeed, updateColorful };
