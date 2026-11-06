import * as THREE from 'three';
import { GROW_MAX, WATER_Y, WHITE } from './config.js';
import { clock, scene } from './core.js';
import { updateHud } from './ui.js';
import { addRipple, makeUnderwater, updateFogField } from './water.js';
import { sfx } from './audio.js';
import { noteQueue, queueEcho } from './notes.js';
import { resetFeatures, updateFeatures } from './features.js';
import { bubbles, flashes } from './overlays.js';
import { growthReward } from './progress.js';
import { notice } from './companion.js';
import { onPlaced } from './level.js';

// ================= 数据 =================
// 所有方块共用一套整数格子坐标；每个“物块”(body) 是一组相连的方块，作为独立刚体漂浮
const voxels = [];                 // 按放置顺序，供撤销使用
const grid = new Map();            // "x,y,z" -> voxel {x,y,z,s,sv,born,merged,inst,col,body,lastPlay}
const key = (x, y, z) => x + ',' + y + ',' + z;
const NB = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const S = (x, y, z) => grid.has(key(x, y, z));
const bodies = new Set();

const FACES = [
  { n: [ 1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [ 0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] }, { n: [ 0,-1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [ 0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [ 0, 0,-1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORNERS = [[-1,-1],[1,-1],[1,1],[-1,1]];
const AO_LEVEL = [0.42, 0.62, 0.82, 1.0];

const solidMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true });
makeUnderwater(solidMat);
const growMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
makeUnderwater(growMat);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

// ================= 物块（刚体） =================
function createBody() {
  const b = {
    group: new THREE.Group(), content: new THREE.Group(), voxels: new Set(),
    com: new THREE.Vector3(), smooth: new THREE.Vector3(),
    tilt: new THREE.Vector3(), spin: new THREE.Vector3(), heave: 0, heaveV: 0, ph: Math.random() * 6.28,
    mesh: new THREE.Mesh(new THREE.BufferGeometry(), solidMat),
    grow: new THREE.InstancedMesh(boxGeo, growMat, GROW_MAX), dirty: true,
  };
  for (let i = 0; i < GROW_MAX; i++) b.grow.setColorAt(i, WHITE);
  b.grow.count = 0; b.grow.frustumCulled = false;
  b.mesh.userData.body = b.grow.userData.body = b;
  b.group.add(b.content); b.content.add(b.mesh, b.grow);
  scene.add(b.group); bodies.add(b);
  return b;
}
function destroyBody(b) {
  scene.remove(b.group); b.mesh.geometry.dispose(); b.grow.dispose(); bodies.delete(b);
}
function updateCom(b) {
  b.com.set(0, 0, 0);
  for (const v of b.voxels) { b.com.x += v.x; b.com.y += v.y; b.com.z += v.z; }
  if (b.voxels.size) b.com.divideScalar(b.voxels.size);
}
function toWorld(v, out) { return v.body.content.localToWorld(out.set(v.x, v.y, v.z)); }
const tmpT = new THREE.Matrix4();
function voxelMatrix(v, out, dy = 0) { return out.multiplyMatrices(v.body.content.matrixWorld, tmpT.makeTranslation(v.x, v.y + dy, v.z)); }

// 只生成暴露在外的面，带体素 AO，按方块颜色着色
function rebuildBody(b) {
  const P = [], N = [], C = [], I = [];
  const solid = (x, y, z) => { const v = grid.get(key(x, y, z)); return !!(v && v.merged && v.body === b); };
  for (const vx of b.voxels) {
    if (!vx.merged) continue;
    const { x, y, z } = vx, c = vx.col || WHITE;
    for (const f of FACES) {
      const [nx, ny, nz] = f.n;
      if (solid(x + nx, y + ny, z + nz)) continue;
      const base = P.length / 3, ao = [];
      for (const [su, sv] of CORNERS) {
        const ux = f.u[0] * su, uy = f.u[1] * su, uz = f.u[2] * su;
        const wx = f.v[0] * sv, wy = f.v[1] * sv, wz = f.v[2] * sv;
        P.push(x + (nx + ux + wx) * 0.5, y + (ny + uy + wy) * 0.5, z + (nz + uz + wz) * 0.5);
        N.push(nx, ny, nz);
        const s1 = solid(x + nx + ux, y + ny + uy, z + nz + uz), s2 = solid(x + nx + wx, y + ny + wy, z + nz + wz);
        const cc = solid(x + nx + ux + wx, y + ny + uy + wy, z + nz + uz + wz);
        const a = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
        ao.push(a);
        const k = AO_LEVEL[a];
        C.push(k * c.r, k * c.g, k * c.b);
      }
      if (ao[0] + ao[2] >= ao[1] + ao[3]) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else I.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  b.mesh.geometry.dispose();
  b.mesh.geometry = g;
  b.dirty = false;
}

function mergeInto(b, o) {
  if (o.anchored) b.anchored = true;
  for (const v of o.voxels) { v.body = b; b.voxels.add(v); }
  destroyBody(o);
  updateCom(b); b.dirty = true;
}

// 拆除后检查连通性：断开的部分各自成为新的物块，继承原来的姿态
function splitBody(b) {
  if (!b.voxels.size) { destroyBody(b); return; }
  const left = new Set(b.voxels), comps = [];
  while (left.size) {
    const start = left.values().next().value, comp = [start], st = [start];
    left.delete(start);
    while (st.length) {
      const v = st.pop();
      for (const [dx, dy, dz] of NB) {
        const n = grid.get(key(v.x + dx, v.y + dy, v.z + dz));
        if (n && left.has(n)) { left.delete(n); comp.push(n); st.push(n); }
      }
    }
    comps.push(comp);
  }
  comps.sort((a, c) => c.length - a.length);
  for (let i = 1; i < comps.length; i++) {
    const nb = createBody();
    nb.tilt.copy(b.tilt); nb.spin.copy(b.spin); nb.heave = b.heave; nb.ph = b.ph;
    for (const v of comps[i]) { b.voxels.delete(v); v.body = nb; nb.voxels.add(v); }
    updateCom(nb);
    nb.smooth.set(nb.com.x, b.smooth.y, nb.com.z);   // 高度从原来的位置开始，再慢慢浮到新平衡
    nb.spin.x += (Math.random() - 0.5) * 0.4; nb.spin.z += (Math.random() - 0.5) * 0.4;
  }
  updateCom(b); b.dirty = true;
}

function impulse(b, v) {
  const n = b.voxels.size, k = 0.55 / (1 + n * 0.12);
  if (b.anchored) { b.heaveV -= 0.15 / (1 + n * 0.08); return; }   // 固定的岛：只轻轻一沉
  b.spin.x += (v.z - b.com.z) * k;
  b.spin.z += -(v.x - b.com.x) * k;
  b.spin.y += (Math.random() - 0.5) * k * 0.6;
  b.heaveV -= 1.2 / (1 + n * 0.08);
}

// ================= 放置 / 拆除 =================
const tmpW = new THREE.Vector3();
function addVoxel(x, y, z, inst = null, opts = {}) {
  if (S(x, y, z)) return null;
  const touching = new Set();
  for (const [dx, dy, dz] of NB) { const n = grid.get(key(x + dx, y + dy, z + dz)); if (n) touching.add(n.body); }
  let b;
  if (touching.size) {
    b = [...touching].sort((a, c) => (c.anchored ? 1e6 : 0) + c.voxels.size - (a.anchored ? 1e6 : 0) - a.voxels.size)[0];   // 优先并入固定的岛
    for (const o of touching) if (o !== b) mergeInto(b, o);     // 连接两个物块 → 合并
  } else b = opts.body || createBody();
  const v = { x, y, z, s: 0, sv: 0, born: clock.elapsedTime, merged: false, inst, col: null, body: b, lastPlay: -9 };
  // 遗迹（关卡预置的地形）：直接出现、不可拆除、灰色；所在物块固定不摇晃。hidden：还藏在雾里，不参与雾的计算
  if (opts.relic) { v.relic = true; v.baseCol = opts.col || null; v.col = v.baseCol; v.merged = true; v.s = 1; b.anchored = true; }
  if (opts.hidden) v.hidden = true;
  grid.set(key(x, y, z), v); voxels.push(v); b.voxels.add(v);
  updateCom(b);
  if (b.voxels.size === 1) { b.smooth.copy(b.com); b.group.position.set(b.com.x, 0, b.com.z); b.content.position.copy(b.com).negate(); b.group.updateMatrixWorld(true); }
  if (!opts.silent) {
    impulse(b, v);
    toWorld(v, tmpW);
    addRipple(tmpW.x, tmpW.z, 0.05 + 0.13 * Math.exp(-Math.abs(tmpW.y - WATER_Y) * 0.35));
    sfx.place(v, tmpW);
    notice(tmpW.x, tmpW.z);
  }
  updateFeatures(!opts.silent, key(x, y, z));
  if (!opts.silent) { queueEcho(v); growthReward(voxels.filter(v => !v.relic).length); onPlaced(v); }
  updateBounds(); updateHud();
  return v;
}

function removeVoxel(v) {
  if (v.relic) return;                 // 遗迹不可拆除
  const i = voxels.indexOf(v);
  if (i < 0) return;
  toWorld(v, tmpW);
  voxels.splice(i, 1);
  grid.delete(key(v.x, v.y, v.z));
  const b = v.body;
  b.voxels.delete(v);
  b.heaveV += 0.6 / (1 + b.voxels.size * 0.08);
  splitBody(b);
  addRipple(tmpW.x, tmpW.z, 0.06);
  sfx.undo();
  updateFeatures(false); updateBounds(); updateHud();
}
function removeLast() { const v = voxels.findLast(v => !v.relic); if (v) removeVoxel(v); }

function resetAll() {
  for (const b of [...bodies]) destroyBody(b);
  voxels.length = 0; grid.clear();
  noteQueue.length = 0; bubbles.length = 0; flashes.length = 0; resetFeatures();
  addRipple(view.x, view.z, 0.15);
  sfx.undo();
  updateFeatures(false); updateBounds(); updateHud();
}

// 全局范围：相机目标与距离
const view = new THREE.Vector3(), viewTarget = new THREE.Vector3();
let spanR = 0;
function updateBounds() {
  updateFogField(voxels.filter(v => !v.hidden).map(v => [v.x, v.z]));
  if (!voxels.length) { viewTarget.set(0, 0, 0); spanR = 0; return; }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of voxels) {
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  viewTarget.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  spanR = Math.max(Math.hypot(x1 - x0, z1 - z0) / 2, (y1 - y0) / 2);
}

// 音高：高度决定音阶级数，x+z 奇偶再错开两级；整体限制在中音区
function noteStep(v) {
  return Math.max(0, Math.min(11, 5 + v.y + (((v.x + v.z) % 2 + 2) % 2) * 2));
}

export { voxels, grid, key, NB, S, bodies, FACES, CORNERS, AO_LEVEL, solidMat, growMat, boxGeo, createBody, destroyBody, updateCom, toWorld, tmpT, voxelMatrix, rebuildBody, mergeInto, splitBody, impulse, tmpW, addVoxel, removeVoxel, removeLast, resetAll, view, viewTarget, spanR, updateBounds, noteStep };
