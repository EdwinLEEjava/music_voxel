import * as THREE from 'three';
import { clock, camera, scene } from './core.js';
import { hintEl, toast, uiState } from './ui.js';
import { U, addRipple, makeUnderwater } from './water.js';
import { S, addVoxel, blocked, grid, key, resetAll, tmpW, toWorld, updateBounds, voxels } from './world.js';
import { sfx } from './audio.js';
import { REACT, setLevelState } from './features.js';
import { discover, markProgress } from './progress.js';
import { glows } from './overlays.js';

// ================= 关卡 =================
// 第一关：灯塔
// 雾散开 → 小岛、房子、港湾、未完成的塔（塔顶放着一盏熄灭的灯），远处一条小船头上闪着问号
// → 在塔顶放方块，灯被顶上去 → 灯离水面够高（LAMP_LIT_Y）就亮 → 灯光驱散雾，第二座岛和它的船出现
// → 独立把第二盏灯顶到同样高度 → 两座灯塔都亮，两条船回港，找回第一种颜色
// 规则只有一条，而且在哪里都一样：灯够高就会亮。其他搭建只会发声，不会触发任何东西

const C = h => new THREE.Color(h);
// ———— 视觉语言：材质说明“这是谁的东西”，明暗说明“先看哪里”，灯和余烬说明“该做什么” ————
// 自然地形最暗、不规整；人造的房子港湾是中灰、规整；未完成的塔和玩家方块同为白色（白色 = 玩家的材料）
const MAT = {
  rock: C(0x3c3f44), rock2: C(0x46494e), ground: C(0x53575c),
  house: C(0x8f9296), roof: C(0x63666b), harbor: C(0x6e7175), dark: C(0x45484d),
  stripeA: C(0xf4f4f4), stripeB: C(0xc9cacc),
};
const LAMP_LIT_Y = 6;                  // 灯离水面这么高（格）就能照到远处 → 点亮
const LIGHT_R = 19, LIGHT_SEC = 4.5;   // 灯塔点亮后，光在雾里撑开的半径（格）和用时
const BOAT_CLEAR = 2.6, BOAT_SEC = 9;  // 小船周围散开的雾（格）；回港用时（秒）

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
const footprint = (x0, z0, w, d) => { const out = []; for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x0 + i, z0 + j]); return out; };

const ISLANDS = [
  { // 第一座：房子、向左伸出去的港湾、岬角上的塔（灯在 4，要顶到 6：补 2 格）
    cells: () => [
      ...islandCells(0, 0, 8, 5, [...footprint(-1, 0, 2, 2), [-2, 2], [3, -1]]),
      [3, 0, -1, MAT.rock2], [3, 0, -2, MAT.rock], [4, 0, -2, MAT.rock], [3, -1, -2, MAT.rock], [4, -1, -2, MAT.rock],
      [-3, 0, 2, MAT.harbor], [-4, 0, 2, MAT.harbor], [-5, 0, 2, MAT.harbor], [-6, 0, 2, MAT.harbor], [-6, 1, 2, MAT.harbor],
      ...stripes(4, -2, 1, 3),
    ],
    house: { x0: -1, z0: 0, w: 2, d: 2, h: 1.7 },
    tower: { x: 4, z: -2, bottom: 1, top: 3 },
    boat: { from: { x: -9.5, z: 6 }, to: { x: -5, z: 3.25 } },
  },
  { // 第二座：类似的小岛，塔更矮（灯在 3，要顶到 6：补 3 格），没有提示
    cells: () => [
      ...islandCells(-13, -9, 5, 2, [[-14, -8], [-15, -8]]),
      [-11, 0, -11, MAT.rock], [-12, 0, -11, MAT.rock2], [-11, -1, -11, MAT.rock],
      [-16, 0, -8, MAT.harbor], [-17, 0, -8, MAT.harbor], [-17, 1, -8, MAT.harbor],
      ...stripes(-11, -11, 1, 2),
    ],
    house: { x0: -14, z0: -8, w: 1, d: 1, h: 1.4 },
    tower: { x: -11, z: -11, bottom: 1, top: 2 },
    boat: { from: { x: -21, z: -4 }, to: { x: -16.5, z: -6.75 } },
  },
];

// ———— 模型：灯、房子、小船（都是灰色，挂在所在物块上，随岛一起浮动） ————
const greyMat = hex => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75 }); makeUnderwater(m); return m; };
const M = { frame: greyMat(0x5d6065), glass: greyMat(0x9a9da2), house: greyMat(0x8f9296), roof: greyMat(0x63666b), dark: greyMat(0x45484d), boat: greyMat(0x7b7e83) };
const litGlass = new THREE.MeshBasicMaterial({ color: 0xffd34d });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };

// 灯：底座 + 灯罩 + 顶盖，占一格
function makeLamp() {
  const g = new THREE.Group(), glass = box(0.36, 0.4, 0.36, M.glass, 0, -0.14, 0);
  g.add(box(0.56, 0.12, 0.56, M.frame, 0, -0.44, 0), glass, box(0.5, 0.1, 0.5, M.frame, 0, 0.11, 0), box(0.12, 0.12, 0.12, M.frame, 0, 0.22, 0));
  g.userData.glass = glass;
  return g;
}
// 房子：方形墙身 + 坡屋顶 + 烟囱 + 门和窗
function makeHouse({ w, d, h }) {
  const g = new THREE.Group();
  g.add(box(w, h, d, M.house, 0, h / 2, 0));
  const tri = new THREE.Shape();
  tri.moveTo(-d / 2 - 0.15, 0); tri.lineTo(d / 2 + 0.15, 0); tri.lineTo(0, 0.55 + d * 0.2); tri.lineTo(-d / 2 - 0.15, 0);
  const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: w + 0.3, bevelEnabled: false }).translate(0, 0, -(w + 0.3) / 2).rotateY(Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, M.roof); roof.position.y = h;
  g.add(roof);
  g.add(box(0.2, 0.5, 0.2, M.roof, w * 0.25, h + 0.45, -d * 0.2));          // 烟囱
  g.add(box(0.32, 0.6, 0.04, M.dark, 0, 0.3, d / 2 + 0.01));                 // 门
  g.add(box(0.04, 0.3, 0.3, M.dark, w / 2 + 0.01, h * 0.6, 0));              // 窗
  return g;
}
function makeBoat() {
  const g = new THREE.Group();
  g.add(box(0.55, 0.3, 1.4, M.boat), box(0.4, 0.32, 0.45, M.boat, 0, 0.3, 0.25), box(0.06, 0.9, 0.06, M.boat, 0, 0.6, -0.25));
  g.renderOrder = 5;
  scene.add(g);
  return g;
}
// 小船头上闪烁的问号
function makeQuestion() {
  const el = document.createElement('div');
  el.className = 'boat-q'; el.textContent = '?';
  document.body.appendChild(el);
  return el;
}

// ———— 每座岛的运行状态 ————
// { built, hidden, lamp, house, boat, q, lampY(显示用，平滑), lit, boatT0 }
let isles = [], stage = 0, lights = [], revealAt = null;
const v3 = new THREE.Vector3();

function build(i, hidden) {
  const def = ISLANDS[i], s = isles[i];
  for (const [x, y, z, col] of def.cells()) addVoxel(x, y, z, null, { relic: true, col, silent: true, hidden });
  // 房子所在的格子不能放方块（模型占着）
  const hs = def.house;
  for (const [x, z] of footprint(hs.x0, hs.z0, hs.w, hs.d)) for (let y = 1; y <= 3; y++) blocked.add(key(x, y, z));
  s.built = true; s.hidden = hidden;
  s.lampY = def.tower.top + 1;
  s.lamp.visible = s.house.visible = s.boat.visible = !hidden;
}
// 灯所在的高度 = 塔这一列最上面的方块 + 1
function columnTop(tw) { let y = tw.top; while (S(tw.x, y + 1, tw.z)) y++; return y; }
const lampCell = i => columnTop(ISLANDS[i].tower) + 1;
function towerData(i) { const tw = ISLANDS[i].tower, top = lampCell(i); return { x: tw.x, z: tw.z, bottom: tw.bottom, top, h: top - tw.bottom + 1 }; }

// 卡住时的“差一点”提示：当前那盏灯所在的格子（再往这里放一格，灯就会被顶上去）
function refresh() {
  const hints = [];
  if (stage < 2 && !isles[stage].hidden) {
    const tw = ISLANDS[stage].tower, top = grid.get(key(tw.x, columnTop(tw), tw.z));
    if (top) hints.push({ x: tw.x, y: lampCell(stage), z: tw.z, body: top.body, w: 1 });
  }
  setLevelState(isles.filter(s => s.lit).map(s => towerData(s.i)), hints);
}

function lightTower(i) {
  const s = isles[i];
  s.lit = true;
  s.lamp.userData.glass.material = litGlass;
  refresh();
  REACT.tower(towerData(i));                       // 塔身闪亮、钟声、涟漪
  const tw = ISLANDS[i].tower, top = grid.get(key(tw.x, columnTop(tw), tw.z));
  if (top) toWorld(top, tmpW); else tmpW.set(tw.x, 0, tw.z);
  lights.push({ i, x: tmpW.x, z: tmpW.z, t0: clock.elapsedTime });
  setTimeout(() => { s.boatT0 = clock.elapsedTime; }, 1500);   // 小船看到灯光，开始回港
  markProgress();
}

function onPlaced() {
  if (stage >= 2 || !isles.length) return;
  if (lampCell(stage) >= LAMP_LIT_Y) {
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

function toScreen(p, el) {
  p.project(camera);
  el.style.left = ((p.x + 1) / 2 * innerWidth) + 'px';
  el.style.top = ((1 - p.y) / 2 * innerHeight) + 'px';
}

function updateLevel(t, dt) {
  // 灯光在雾里慢慢撑开（0、1 号光）
  for (const L of lights) {
    const a = Math.min(1, (t - L.t0) / LIGHT_SEC), r = LIGHT_R * (1 - Math.pow(1 - a, 3));
    U.uLights.value[L.i].set(L.x, L.z, r, 0);
    if (L.i === 0 && revealAt !== null && r >= revealAt) {
      revealAt = null;
      for (const v of voxels) v.hidden = false;
      isles[1].hidden = false;
      isles[1].lamp.visible = isles[1].house.visible = isles[1].boat.visible = true;
      updateBounds();
      const b = ISLANDS[1].tower;
      addRipple(b.x, b.z, 0.2);
      sfx.whoosh(3);
      refresh();
    }
  }
  glows.length = 0;
  isles.forEach((s, i) => {
    if (!s.built) return;
    const def = ISLANDS[i], tw = def.tower, top = grid.get(key(tw.x, columnTop(tw), tw.z));
    // 灯：挂在塔顶方块所在的物块上，被顶起时平滑上升
    if (top) {
      if (s.lamp.parent !== top.body.content) top.body.content.add(s.lamp);
      s.lampY += (lampCell(i) - s.lampY) * (1 - Math.exp(-dt * 10));
      s.lamp.position.set(tw.x, s.lampY, tw.z);
      if (!s.lit) glows.push({ kind: 'ember', x: tw.x, y: s.lampY, z: tw.z, body: top.body, hidden: s.hidden });
    }
    // 房子：挂在脚下那块地所在的物块上
    const hs = def.house, ground = grid.get(key(hs.x0, 0, hs.z0));
    if (ground && s.house.parent !== ground.body.content) ground.body.content.add(s.house);
    s.house.position.set(hs.x0 + (hs.w - 1) / 2, 0.5, hs.z0 + (hs.d - 1) / 2);
    // 小船：等在远处的雾里（周围的雾散开一小片），灯塔亮后驶回港湾
    const a = s.boatT0 < 0 ? 0 : Math.min(1, (t - s.boatT0) / BOAT_SEC), e = a * a * (3 - 2 * a), b = def.boat;
    const x = b.from.x + (b.to.x - b.from.x) * e, z = b.from.z + (b.to.z - b.from.z) * e;
    s.boat.position.set(x, 0.05 + Math.sin(t * 0.9 + i) * 0.06, z);
    s.boat.rotation.set(Math.sin(t * 0.7 + i) * 0.05, Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z), Math.sin(t * 0.9 + 1 + i) * 0.06);
    U.uLights.value[4 + i].set(x, z, s.hidden ? -99 : BOAT_CLEAR, 0);
    // 问号：灯塔亮之前一直闪
    const showQ = !s.hidden && !s.lit && !uiState.title;
    s.q.style.display = showQ ? 'block' : 'none';
    if (showQ) toScreen(v3.set(x, 1.6, z), s.q);
  });
  // 开局的“点击鼠标左键”提示，贴在第一盏灯的上方
  if (stage === 0 && hintEl.style.opacity !== '0' && isles.length && isles[0].built) {
    isles[0].lamp.getWorldPosition(v3); v3.y += 1.1;
    toScreen(v3, hintEl);
    hintEl.style.transform = 'translate(-50%, -100%)';
  }
}

function clearIsles() {
  for (const s of isles) { s.lamp.removeFromParent(); s.house.removeFromParent(); s.boat.removeFromParent(); s.q.remove(); }
  isles = ISLANDS.map((def, i) => ({ i, built: false, hidden: true, lit: false, boatT0: -1, lampY: def.tower.top + 1,
    lamp: makeLamp(), house: makeHouse(def.house), boat: makeBoat(), q: makeQuestion() }));
  for (const s of isles) s.boat.visible = false;
}
function startLevel() {
  stage = 0; lights = []; revealAt = null;
  blocked.clear();
  for (const l of U.uLights.value) l.set(0, 0, -99, 0);
  clearIsles();
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
