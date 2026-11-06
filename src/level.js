import * as THREE from 'three';
import { clock, camera, scene } from './core.js';
import { hintEl, toast } from './ui.js';
import { U, addRipple, makeUnderwater } from './water.js';
import { S, addVoxel, grid, key, resetAll, tmpW, toWorld, updateBounds, voxels } from './world.js';
import { sfx } from './audio.js';
import { REACT, setLevelState } from './features.js';
import { discover, markProgress } from './progress.js';
import { glows } from './overlays.js';

// ================= 关卡 =================
// 第一关：灯塔
// 雾散开 → 小岛、房子、港湾、未完成的塔 → 提示在塔顶 → 补 2 格点亮灯塔
// → 灯光驱散雾，第二座岛出现 → 独立补 3 格 → 两座灯塔都亮起，找回第一种颜色
// 关卡只检查“塔顶上方连续叠了几格”，其他搭建只会发声，不会触发任何东西

const C = h => new THREE.Color(h);
// ———— 视觉语言：材质说明“这是谁的东西”，明暗说明“先看哪里”，光说明“该做什么” ————
// 自然地形最暗、不规整；人造的房子港湾是中灰、规整；未完成的塔和玩家方块同为白色（白色 = 玩家的材料），
// 用白 / 浅灰条纹表明它是灯塔，是全场最亮的东西
const MAT = {
  rock: C(0x3c3f44), rock2: C(0x46494e), ground: C(0x53575c),
  house: C(0x8f9296), roof: C(0x63666b), harbor: C(0x6e7175),
  stripeA: C(0xf4f4f4), stripeB: C(0xc9cacc),
};
const LIGHT_R = 19, LIGHT_SEC = 4.5;   // 灯塔点亮后，光在雾里撑开的半径（格）和用时

const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
// 一座岩石岛：边缘缺几块、零星有凸起的岩石，形状不规整；keep 里的格子保证是平地（房子、港湾、塔脚）
function islandCells(cx, cz, r2Top, r2Base, keep = []) {
  const out = [], R = Math.ceil(Math.sqrt(r2Top)), kept = new Set(keep.map(([x, z]) => x + ',' + z));
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d = x * x + z * z, h = hash(cx + x, cz + z), k = kept.has((cx + x) + ',' + (cz + z));
    if (d <= r2Base) out.push([cx + x, -1, cz + z, h < 0.5 ? MAT.rock : MAT.rock2]);
    if (d > r2Top || (!k && d > r2Top - 3 && h < 0.3)) continue;          // 边缘缺几块
    out.push([cx + x, 0, cz + z, MAT.ground]);
    if (!k && d >= r2Top - 3 && h > 0.82) out.push([cx + x, 1, cz + z, MAT.rock2]);   // 零星的岩石
  }
  return out;
}
const stripes = (x, z, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push([x, y, z, y % 2 ? MAT.stripeB : MAT.stripeA]); return out; };
const ISLANDS = [
  { // 第一座：房子（亮着一扇窗）、伸出去的港湾、岬角上只差 2 格的塔
    cells: () => [
      ...islandCells(0, 0, 8, 5, [[-1, 0], [0, 0], [-1, 1], [0, 1], [1, 2], [1, 1], [2, -1], [3, -1]]),
      [3, 0, -1, MAT.rock2], [3, 0, -2, MAT.rock], [4, 0, -2, MAT.rock], [3, -1, -2, MAT.rock], [4, -1, -2, MAT.rock],
      ...[[-1, 0], [0, 0], [-1, 1], [0, 1]].flatMap(([x, z]) => [[x, 1, z, MAT.house], [x, 2, z, MAT.house], [x, 3, z, MAT.roof]]),
      [1, 0, 3, MAT.harbor], [1, 0, 4, MAT.harbor], [1, 0, 5, MAT.harbor], [1, 0, 6, MAT.harbor], [1, 1, 6, MAT.harbor],
      ...stripes(4, -2, 1, 3),
    ],
    glows: [{ x: 4, y: 3, z: -2, kind: 'ember' }],
    tower: { x: 4, z: -2, bottom: 1, top: 3, need: 2 },
  },
  { // 第二座：类似的小岛，塔更矮，要独立补 3 格
    cells: () => [
      ...islandCells(-13, -9, 5, 2, [[-14, -8], [-12, -10]]),
      [-11, 0, -11, MAT.rock], [-12, 0, -11, MAT.rock2], [-11, -1, -11, MAT.rock],
      [-14, 1, -8, MAT.house], [-14, 2, -8, MAT.house], [-14, 3, -8, MAT.roof],
      [-13, 0, -6, MAT.harbor], [-13, 0, -5, MAT.harbor],
      ...stripes(-11, -11, 1, 2),
    ],
    glows: [{ x: -11, y: 2, z: -11, kind: 'ember' }],
    tower: { x: -11, z: -11, bottom: 1, top: 2, need: 3 },
  },
];

// ———— 小船（灰色）：困在港湾外的黑暗里，第一座灯塔点亮后慢慢驶回港湾 ————
const boatMat = new THREE.MeshStandardMaterial({ color: 0x7b7e83, roughness: 0.7 });
makeUnderwater(boatMat);
const boat = new THREE.Group();
{
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 1.4), boatMat);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.45), boatMat); cabin.position.set(0, 0.3, 0.25);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), boatMat); mast.position.set(0, 0.6, -0.25);
  boat.add(hull, cabin, mast);
}
boat.renderOrder = 5; boat.visible = false;
scene.add(boat);
const BOAT_FROM = { x: 3.4, z: 11.5 }, BOAT_TO = { x: 2.2, z: 5.2 }, BOAT_SEC = 8;
let boatT0 = -1;

let stage = 0;                       // 0：补第一座塔  1：补第二座塔  2：本关完成
let lit = [], lights = [], revealAt = null;

function build(i, hidden) {
  glows.push(...ISLANDS[i].glows);
  for (const [x, y, z, col] of ISLANDS[i].cells()) addVoxel(x, y, z, null, { relic: true, col, silent: true, hidden });
}
// 塔顶上方连续叠了几格
function stacked(tw) { let n = 0; while (S(tw.x, tw.top + n + 1, tw.z)) n++; return n; }
function towerData(tw) { const top = tw.top + stacked(tw); return { x: tw.x, z: tw.z, bottom: tw.bottom, top, h: top - tw.bottom + 1 }; }

// 卡住时的“差一点”提示：当前那座塔顶的下一格
function refresh() {
  const tw = stage < 2 ? ISLANDS[stage].tower : null, hints = [];
  if (tw) {
    const n = stacked(tw), base = grid.get(key(tw.x, tw.top + n, tw.z));
    if (base) hints.push({ x: tw.x, y: tw.top + n + 1, z: tw.z, body: base.body, w: 1 });
  }
  setLevelState(lit.map(towerData), hints);
}

function lightTower(i) {
  const tw = ISLANDS[i].tower;
  lit.push(tw);
  const e = glows.findIndex(g => g.kind === 'ember' && g.x === tw.x && g.z === tw.z);
  if (e >= 0) glows.splice(e, 1);
  refresh();
  REACT.tower(towerData(tw));                 // 塔身闪亮、钟声、涟漪
  const top = grid.get(key(tw.x, towerData(tw).top, tw.z));
  if (top) toWorld(top, tmpW); else tmpW.set(tw.x, 0, tw.z);
  lights.push({ i: lights.length, x: tmpW.x, z: tmpW.z, t0: clock.elapsedTime });
  markProgress();
}

function onPlaced() {
  if (stage >= 2) return;
  const tw = ISLANDS[stage].tower;
  if (stacked(tw) >= tw.need) {
    const i = stage;
    stage++;                         // 先进入下一阶段，提示才会指向下一座塔（或消失）
    lightTower(i);
    if (stage === 1) {
      setTimeout(() => { boatT0 = clock.elapsedTime; }, 1500);   // 小船看到灯光，开始回港
      // 第二座岛藏在雾里，等灯光扫到才出现
      build(1, true);
      const b = ISLANDS[1].tower;
      revealAt = Math.hypot(b.x - lights[0].x, b.z - lights[0].z) - 4;
    } else {
      // 本关完成：找回第一种颜色
      const b = lights[1];
      setTimeout(() => discover('tower', b.x, b.z, { seed: false, toast: false }), 1500);
      setTimeout(() => toast('找回了第一种颜色'), 3500);
    }
    return;
  }
  refresh();
}

function updateLevel(t) {
  // 小船：平时在原地轻轻起伏，回港时沿直线慢慢驶近
  if (boat.visible) {
    const a = boatT0 < 0 ? 0 : Math.min(1, (t - boatT0) / BOAT_SEC), e = a * a * (3 - 2 * a);
    const x = BOAT_FROM.x + (BOAT_TO.x - BOAT_FROM.x) * e, z = BOAT_FROM.z + (BOAT_TO.z - BOAT_FROM.z) * e;
    boat.position.set(x, 0.05 + Math.sin(t * 0.9) * 0.06, z);
    boat.rotation.set(Math.sin(t * 0.7) * 0.05, Math.atan2(BOAT_TO.x - BOAT_FROM.x, BOAT_TO.z - BOAT_FROM.z), Math.sin(t * 0.9 + 1) * 0.06);
  }
  // 灯光在雾里慢慢撑开
  for (const L of lights) {
    const a = Math.min(1, (t - L.t0) / LIGHT_SEC), r = LIGHT_R * (1 - Math.pow(1 - a, 3));
    U.uLights.value[L.i].set(L.x, L.z, r, 0);
    if (L.i === 0 && revealAt !== null && r >= revealAt) {
      revealAt = null;
      for (const v of voxels) v.hidden = false;
      updateBounds();
      const b = ISLANDS[1].tower;
      addRipple(b.x, b.z, 0.2);
      sfx.whoosh(3);
      refresh();
    }
  }
  // 开局的“点击鼠标左键”提示，贴在第一座塔顶上方
  if (stage === 0 && hintEl.style.opacity !== '0') {
    const tw = ISLANDS[0].tower, v = grid.get(key(tw.x, tw.top, tw.z));
    if (v) {
      const p = new THREE.Vector3(v.x, v.y + 1.6, v.z);
      v.body.content.localToWorld(p);
      p.project(camera);
      hintEl.style.left = ((p.x + 1) / 2 * innerWidth) + 'px';
      hintEl.style.top = ((1 - p.y) / 2 * innerHeight) + 'px';
      hintEl.style.transform = 'translate(-50%, -100%)';
    }
  }
}

function startLevel() {
  stage = 0; lit = []; lights = []; revealAt = null; boatT0 = -1;
  glows.length = 0; boat.visible = true;
  for (const l of U.uLights.value) l.set(0, 0, -99, 0);
  build(0, false);
  refresh();
  updateBounds();
}
// R：重新开始本关（不再播开场）
function restartLevel() {
  resetAll();
  startLevel();
}

// 开场时雾最先散开的地方：第一座塔
function focusPoint() { const tw = ISLANDS[0].tower; return { x: tw.x, z: tw.z }; }

export { focusPoint, startLevel, restartLevel, onPlaced, updateLevel };
