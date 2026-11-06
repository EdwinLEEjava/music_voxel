import * as THREE from 'three';
import { clock, camera } from './core.js';
import { hintEl, toast } from './ui.js';
import { U, addRipple } from './water.js';
import { S, addVoxel, grid, key, resetAll, tmpW, toWorld, updateBounds, voxels } from './world.js';
import { sfx } from './audio.js';
import { REACT, setLevelState } from './features.js';
import { discover, markProgress } from './progress.js';

// ================= 关卡 =================
// 第一关：灯塔
// 雾散开 → 小岛、房子、港湾、未完成的塔 → 提示在塔顶 → 补 2 格点亮灯塔
// → 灯光驱散雾，第二座岛出现 → 独立补 3 格 → 两座灯塔都亮起，找回第一种颜色
// 关卡只检查“塔顶上方连续叠了几格”，其他搭建只会发声，不会触发任何东西

const C = h => new THREE.Color(h);
const GREY = {                      // 遗迹的灰色：和玩家的白色方块区分开
  rock: C(0x5c6066), ground: C(0x7d8187), house: C(0xc9cbce), roof: C(0x8e9196),
  harbor: C(0x6e7176), tower: C(0xa9acb1),
};
const LIGHT_R = 19, LIGHT_SEC = 4.5;   // 灯塔点亮后，光在雾里撑开的半径（格）和用时

// 一座岛：圆形的地面 + 水下的岩基
function islandCells(cx, cz, r2Top, r2Base) {
  const out = [];
  const R = Math.ceil(Math.sqrt(r2Top));
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d = x * x + z * z;
    if (d <= r2Base) out.push([cx + x, -1, cz + z, GREY.rock]);
    if (d <= r2Top) out.push([cx + x, 0, cz + z, GREY.ground]);
  }
  return out;
}
const ISLANDS = [
  { // 第一座：房子、伸出去的港湾、只差 2 格的塔
    cells: () => [
      ...islandCells(0, 0, 7, 4),
      ...[[-1, 0], [0, 0], [-1, 1], [0, 1]].flatMap(([x, z]) => [[x, 1, z, GREY.house], [x, 2, z, GREY.house], [x, 3, z, GREY.roof]]),
      [1, 0, 3, GREY.harbor], [1, 0, 4, GREY.harbor], [1, 0, 5, GREY.harbor], [1, 0, 6, GREY.harbor], [1, 1, 6, GREY.harbor],
      [2, 1, -1, GREY.tower], [2, 2, -1, GREY.tower], [2, 3, -1, GREY.tower],
    ],
    tower: { x: 2, z: -1, bottom: 1, top: 3, need: 2 },
  },
  { // 第二座：类似的小岛，塔更矮，要独立补 3 格
    cells: () => [
      ...islandCells(-13, -9, 5, 2),
      [-14, 1, -8, GREY.house], [-14, 2, -8, GREY.house], [-14, 3, -8, GREY.roof],
      [-13, 0, -6, GREY.harbor], [-13, 0, -5, GREY.harbor],
      [-12, 1, -10, GREY.tower], [-12, 2, -10, GREY.tower],
    ],
    tower: { x: -12, z: -10, bottom: 1, top: 2, need: 3 },
  },
];

let stage = 0;                       // 0：补第一座塔  1：补第二座塔  2：本关完成
let lit = [], lights = [], revealAt = null;

function build(i, hidden) {
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
  stage = 0; lit = []; lights = []; revealAt = null;
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

export { startLevel, restartLevel, onPlaced, updateLevel };
