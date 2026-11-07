import * as THREE from 'three';
import { clock, camera, scene } from './core.js';
import { hintEl, toast, uiState } from './ui.js';
import { U, addRipple } from './water.js';
import { S, addVoxel, blocked, framePoints, grid, key, resetAll, tmpW, toWorld, updateBounds, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { setLevelState } from './features.js';
import { markProgress } from './progress.js';
import { flashes, glows } from './overlays.js';
import { addItem, inv, setItems } from './hotbar.js';
import { voxelBoat, voxelHouse, voxelLamp } from './models.js';

// ================= 关卡 =================
// 第一关：灯塔
// 雾散开 → 小岛、房子、港湾、断了顶的塔（塔顶放着一盏熄灭的灯），远处雾里一条小船，头上闪着问号
// → 在塔顶放方块把灯顶高（或把灯收起来，放到自己搭的塔上）→ 灯照到船就点亮，船回港
// → 灯光驱散雾，第二座岛和它的船出现：这里没有塔，灯掉在海滩上，西边有岩脊挡着
// → 玩家自己选地方搭塔、放灯，照到第二条船 → 两条船都回港，找回第一种颜色
// 循环：听见（雾里船的钟声，带方位）→ 看见（熄灭的灯）→ 动手（搭高 / 搬灯）→ 规则（灯照到船）
//       → 回应（灯变暖黄 = 全场唯一的颜色、管钟一声、船回应一声、灯光推开雾）→ 船回港
// 规则只有一条，在哪里都一样：灯照得到船就会亮（灯越高照得越远，会被挡住）

const C = h => new THREE.Color(h);
// ———— 视觉语言：材质说明“这是谁的东西”，明暗说明“先看哪里”，灯和余烬说明“该做什么” ————
// 自然地形最暗、不规整；人造的房子港湾是中灰、规整；未完成的塔和玩家方块同为白色（白色 = 玩家的材料）
const MAT = {
  rock: C(0x3c3f44), rock2: C(0x46494e), ground: C(0x53575c),
  house: C(0x8f9296), roof: C(0x63666b), harbor: C(0x6e7175), dark: C(0x45484d),
  stripeA: C(0xf4f4f4), stripeB: C(0xc9cacc),
};
const LIGHT_R = 19, LIGHT_SEC = 4.5;   // 灯塔点亮后，光在雾里撑开的半径（格）和用时
const BOAT_CLEAR = 2.6, BOAT_SEC = 14; // 小船周围散开的雾（格）；回港用时（秒）。船离港湾约 15 格，中间隔着一段完整的雾

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
  { // 第一座：房子、向左伸出去的港湾、岬角上断了顶的塔，塔顶放着一盏灯
    cells: () => [
      ...islandCells(0, 0, 8, 5, [...footprint(-1, 0, 2, 2), [-2, 2], [3, -1]]),
      [3, 0, -1, MAT.rock2], [3, 0, -2, MAT.rock], [4, 0, -2, MAT.rock], [3, -1, -2, MAT.rock], [4, -1, -2, MAT.rock],
      [-3, 0, 2, MAT.harbor], [-4, 0, 2, MAT.harbor], [-5, 0, 2, MAT.harbor], [-6, 0, 2, MAT.harbor], [-6, 1, 2, MAT.harbor],
      ...stripes(4, -2, 1, 3),
    ],
    house: { x0: -1, z0: 0, w: 2, d: 2, h: 1.7 },
    lamp: { x: 4, y: 4, z: -2 },                   // 塔自带的灯
    boat: { from: { x: -20, z: 9 }, to: { x: -5, z: 3.25 } },
  },
  { // 第二座：没有塔，灯掉在海滩上；西边一道岩脊挡住低处看向船的视线
    cells: () => [
      ...islandCells(-13, -9, 5, 2, [[-14, -8], [-15, -10], [-15, -9], [-15, -8], [-12, -7]]),
      [-11, 0, -11, MAT.rock], [-12, 0, -11, MAT.rock2], [-11, -1, -11, MAT.rock],
      [-15, 1, -10, MAT.rock2], [-15, 1, -9, MAT.rock], [-15, 1, -8, MAT.rock2], [-15, 2, -10, MAT.rock], [-15, 2, -9, MAT.rock2],
      [-16, 0, -8, MAT.harbor], [-17, 0, -8, MAT.harbor], [-17, 1, -8, MAT.harbor],
    ],
    house: { x0: -14, z0: -8, w: 1, d: 1, h: 1.4 },
    lamp: { x: -12, y: 1, z: -7 },                 // 海滩上的灯
    boat: { from: { x: -32, z: -2 }, to: { x: -16.5, z: -6.75 } },
  },
];

// ———— 模型：灯、房子、小船都是小体素模型（见 models.js），灰色，挂在所在物块上随岛浮动 ————
const litGlass = new THREE.MeshBasicMaterial({ color: 0xffd34d });
const makeLamp = () => voxelLamp();
const makeHouse = def => voxelHouse(def);
function makeBoat() { const g = voxelBoat(); g.renderOrder = 5; scene.add(g); return g; }
// 小船头上闪烁的问号
function makeQuestion() {
  const el = document.createElement('div');
  el.className = 'boat-q'; el.textContent = '?';
  document.body.appendChild(el);
  return el;
}

// ———— 灯与船 ————
// 灯是一件物品：放在任意方块的顶面上；右键收回（已点亮的不能收回）；
// 它所在的格子被放了方块就会被顶上去，下面的方块被拆掉就会落下，落到底也没有支撑就回到物品栏
// 点亮条件：灯照得到一条等待中的船——射程 = 灯的高度 × REACH，中间不能被地形、房子或方块挡住
const REACH = 5;
let lamps = [], boats = [], houses = [], stage = 0, lights = [], revealAt = null, firstLamp = null;
const v3 = new THREE.Vector3();

function spawnLamp(x, y, z, hidden = false) {
  const l = { x, y, z, visY: y, lit: false, hidden, mesh: makeLamp() };
  lamps.push(l);
  return l;
}
const lampAt = (x, y, z) => lamps.find(l => l.x === x && l.y === y && l.z === z);
// 能不能把灯放在这一格：格子空着、下面是方块、不是房子
const lampOK = c => !!c && !S(c.x, c.y, c.z) && S(c.x, c.y - 1, c.z) && !blocked.has(key(c.x, c.y, c.z)) && !lampAt(c.x, c.y, c.z);

// 灯被顶起 / 落下
function settleLamps() {
  for (const l of [...lamps]) {
    while (S(l.x, l.y, l.z)) l.y++;
    while (l.y > -1 && !S(l.x, l.y - 1, l.z)) l.y--;
    if (l.y <= -1) { removeLamp(l); addItem('lamp', 1); }
  }
}
function removeLamp(l) { l.mesh.removeFromParent(); lamps.splice(lamps.indexOf(l), 1); }

// 灯能不能照到船：返回 { ok, cut }，cut 是视线在第几成处被挡住 / 超出射程（0~1）
function sight(x, y, z, b) {
  const bx = b.x, bz = b.z, by = 0.6, len = Math.hypot(bx - x, by - y, bz - z), reach = Math.max(0, y) * REACH;
  const flat = Math.hypot(bx - x, bz - z);
  let cut = flat > reach ? reach / flat : 1;
  const steps = Math.ceil(len * 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (t * len < 0.7) continue;                        // 跳过灯自己所在的格子
    const px = Math.round(x + (bx - x) * t), py = Math.round(y + (by - y) * t), pz = Math.round(z + (bz - z) * t);
    if (S(px, py, pz) || blocked.has(key(px, py, pz))) { cut = Math.min(cut, t); break; }
  }
  return { ok: cut >= 1, cut };
}
const waiting = () => boats.filter(b => !b.saved && !b.hidden);

function check() {
  settleLamps();
  for (const l of lamps) {
    if (l.lit || l.hidden) continue;
    const b = waiting().find(b => sight(l.x, l.y, l.z, b.cur).ok);
    if (b) lightLamp(l, b);
  }
  refresh();
}

function lampTower(l) { let y = l.y - 1; while (S(l.x, y - 1, l.z)) y--; const bottom = Math.max(1, y); return { x: l.x, z: l.z, bottom, top: l.y, h: l.y - bottom + 1, noPaint: true }; }

function lightLamp(l, b) {
  l.lit = true;
  l.mesh.userData.glass.material = litGlass;
  b.saved = true;
  const sup = grid.get(key(l.x, l.y - 1, l.z));
  if (sup) toWorld(sup, tmpW); else tmpW.set(l.x, 0, l.z);
  // 回应：塔身从上到下闪一遍、灯用管钟响一声，船隔着雾回应一声
  const tw = lampTower(l);
  for (let y = tw.top - 1; y >= tw.bottom; y--) { const v = grid.get(key(l.x, y, l.z)); if (v) flashes.push({ v, t0: clock.elapsedTime + (tw.top - y) * 0.05 }); }
  addRipple(tmpW.x, tmpW.z, 0.3);
  sfx.instNote('bell', 7, panOf(tmpW));
  const bw = { x: b.cur.x, y: 0, z: b.cur.z };
  setTimeout(() => sfx.boatBell(panOf(v3.set(bw.x, 0, bw.z)), false), 900);
  lights.push({ i: lights.length, x: tmpW.x, z: tmpW.z, t0: clock.elapsedTime });
  setTimeout(() => { b.t0 = clock.elapsedTime; }, 1500);   // 小船看到灯光，开始回港
  markProgress();
  if (b.i === 0) {
    stage = 1;
    // 第二座岛藏在雾里，等灯光扫到才出现
    build(1, true);
    const c = ISLANDS[1].lamp;
    revealAt = Math.hypot(c.x - tmpW.x, c.z - tmpW.z) - 4;
  } else if (boats.every(b => b.saved)) {
    stage = 2;
    setTimeout(() => toast('找回了第一种颜色'), 3000);   // 颜色只属于灯：世界保持黑白灰
  }
}

// 卡住时的“差一点”提示：只在第一座塔，指向那盏灯所在的格子（再往这里放一格，灯就会被顶上去）
function refresh() {
  const hints = [];
  if (stage === 0 && firstLamp && lamps.includes(firstLamp) && !firstLamp.lit) {
    const sup = grid.get(key(firstLamp.x, firstLamp.y - 1, firstLamp.z));
    if (sup) hints.push({ x: firstLamp.x, y: firstLamp.y, z: firstLamp.z, body: sup.body, w: 1 });
  }
  setLevelState(lamps.filter(l => l.lit).map(lampTower), hints);
}

function build(i, hidden) {
  const def = ISLANDS[i];
  for (const [x, y, z, col] of def.cells()) addVoxel(x, y, z, null, { relic: true, col, silent: true, hidden });
  const hs = def.house;
  for (const [x, z] of footprint(hs.x0, hs.z0, hs.w, hs.d)) for (let y = 1; y <= 3; y++) blocked.add(key(x, y, z));
  houses[i] = { def: hs, mesh: makeHouse(hs), hidden };
  const l = spawnLamp(def.lamp.x, def.lamp.y, def.lamp.z, hidden);
  if (i === 0) firstLamp = l;
  boats[i] = { i, def: def.boat, mesh: makeBoat(), q: makeQuestion(), saved: false, hidden, t0: -1, cur: { x: def.boat.from.x, z: def.boat.from.z } };
  if (!hidden) framePoints.push(def.boat.from);
}
function reveal(i) {
  for (const v of voxels) v.hidden = false;
  for (const l of lamps) l.hidden = false;
  houses[i].hidden = false; boats[i].hidden = false;
  framePoints.push(ISLANDS[i].boat.from);
  updateBounds();
  addRipple(ISLANDS[i].lamp.x, ISLANDS[i].lamp.z, 0.2);
  sfx.whoosh(3);
  check();
}

// ———— 玩家操作（input.js 调用） ————
function placeLamp(c) {
  if (inv.lamp <= 0 || !lampOK(c)) return false;
  spawnLamp(c.x, c.y, c.z);
  addItem('lamp', -1);
  sfx.place({ x: c.x, y: c.y, z: c.z }, v3.set(c.x, c.y, c.z));
  check();
  return true;
}
// 右键：点中一盏没点亮的灯就收回
function pickLamp(ray) {
  const hit = ray.intersectObjects(lamps.filter(l => !l.hidden).map(l => l.mesh), true)[0];
  if (!hit) return false;
  const l = lamps.find(l => hit.object === l.mesh || l.mesh.getObjectById(hit.object.id));
  if (!l || l.lit) return !!l;                            // 点亮的灯不能收回，但这次右键也不再拆方块
  removeLamp(l); addItem('lamp', 1); sfx.ui(); refresh();
  return true;
}

// ———— 拿着灯时的视线：从预览位置画到每条等待中的船；被挡住 / 射程不够的那一段变淡 ————
const lineMat = () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
const sightLines = [0, 1].map(() => { const near = new THREE.Line(new THREE.BufferGeometry(), lineMat()), far = new THREE.Line(new THREE.BufferGeometry(), lineMat());
  near.material.opacity = 0.55; far.material.opacity = 0.12; near.renderOrder = far.renderOrder = 19; near.frustumCulled = far.frustumCulled = false;
  scene.add(near, far); return { near, far }; });
function previewLamp(c) {
  const ws = c && lampOK(c) ? waiting() : [];
  sightLines.forEach((L, k) => {
    const b = ws[k];
    L.near.visible = L.far.visible = !!b;
    if (!b) return;
    const s = sight(c.x, c.y, c.z, b.cur), A = new THREE.Vector3(c.x, c.y, c.z), B = new THREE.Vector3(b.cur.x, 0.6, b.cur.z);
    const M = A.clone().lerp(B, s.cut);
    L.near.geometry.setFromPoints([A, M]);
    L.far.geometry.setFromPoints([M, B]);
    L.near.material.opacity = s.ok ? 0.75 : 0.45;
  });
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
    if (L.i === 0 && revealAt !== null && r >= revealAt) { revealAt = null; reveal(1); }
  }
  glows.length = 0;
  // 灯：挂在下面那格方块所在的物块上，被顶起时平滑上升；没点亮的冒灰色余烬
  for (const l of lamps) {
    const sup = grid.get(key(l.x, l.y - 1, l.z));
    l.mesh.visible = !l.hidden;
    if (!sup) continue;
    if (l.mesh.parent !== sup.body.content) sup.body.content.add(l.mesh);
    l.visY += (l.y - l.visY) * (1 - Math.exp(-dt * 10));
    l.mesh.position.set(l.x, l.visY, l.z);
    if (!l.lit) glows.push({ kind: 'ember', x: l.x, y: l.visY, z: l.z, body: sup.body, hidden: l.hidden });
  }
  // 房子：挂在脚下那块地所在的物块上
  for (const h of houses) {
    if (!h) continue;
    const ground = grid.get(key(h.def.x0, 0, h.def.z0));
    h.mesh.visible = !h.hidden;
    if (ground && h.mesh.parent !== ground.body.content) ground.body.content.add(h.mesh);
    h.mesh.position.set(h.def.x0 + (h.def.w - 1) / 2, 0.5, h.def.z0 + (h.def.d - 1) / 2);
  }
  // 小船：等在远处的雾里（周围的雾散开一小片），被灯照到后驶回港湾
  for (const b of boats) {
    if (!b) continue;
    const a = b.t0 < 0 ? 0 : Math.min(1, (t - b.t0) / BOAT_SEC), e = a * a * (3 - 2 * a), d = b.def;
    b.cur.x = d.from.x + (d.to.x - d.from.x) * e; b.cur.z = d.from.z + (d.to.z - d.from.z) * e;
    b.mesh.visible = !b.hidden;
    b.mesh.position.set(b.cur.x, 0.05 + Math.sin(t * 0.9 + b.i) * 0.06, b.cur.z);
    b.mesh.rotation.set(Math.sin(t * 0.7 + b.i) * 0.05, Math.atan2(d.to.x - d.from.x, d.to.z - d.from.z), Math.sin(t * 0.9 + 1 + b.i) * 0.06);
    U.uLights.value[4 + b.i].set(b.cur.x, b.cur.z, b.hidden ? -99 : BOAT_CLEAR, 0);
    const showQ = !b.hidden && !b.saved && !uiState.title;   // 问号：被照到之前一直闪
    if (showQ) {
      b.bell = (b.bell ?? 2) - dt;
      if (b.bell <= 0) { b.bell = 6 + Math.random() * 2; sfx.boatBell(panOf(v3.set(b.cur.x, 0, b.cur.z)), true); }
    }
    b.q.style.display = showQ ? 'block' : 'none';
    if (showQ) toScreen(v3.set(b.cur.x, 1.6, b.cur.z), b.q);
  }
  // 开局的“点击鼠标左键”提示，贴在第一盏灯的上方
  if (stage === 0 && hintEl.style.opacity !== '0' && firstLamp && lamps.includes(firstLamp)) {
    firstLamp.mesh.getWorldPosition(v3); v3.y += 1.1;
    toScreen(v3, hintEl);
    hintEl.style.transform = 'translate(-50%, -100%)';
  }
}

function startLevel() {
  for (const l of lamps) l.mesh.removeFromParent();
  for (const b of boats) if (b) { b.mesh.removeFromParent(); b.q.remove(); }
  for (const h of houses) if (h) h.mesh.removeFromParent();
  lamps = []; boats = []; houses = []; stage = 0; lights = []; revealAt = null; firstLamp = null;
  blocked.clear(); framePoints.length = 0;
  for (const l of U.uLights.value) l.set(0, 0, -99, 0);
  setItems({ lamp: 0 });                                  // 第一关开局没有灯
  build(0, false);
  refresh();
  updateBounds();
}
// R：重新开始本关（不再播开场）
function restartLevel() {
  resetAll();
  startLevel();
}
// 每次放置 / 拆除方块后：灯可能被顶起或落下，再看看能不能照到船
function onPlaced() { if (boats.length) check(); }
// 开场时雾最先散开的地方：第一盏灯
function focusPoint() { const l = ISLANDS[0].lamp; return { x: l.x, z: l.z }; }

export { reveal, focusPoint, startLevel, restartLevel, onPlaced, updateLevel, placeLamp, pickLamp, previewLamp, lampOK };
