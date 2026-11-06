import { INST, INST_TINT, NEED, PAL, TOWER_MIN } from './config.js';
import { clock } from './core.js';
import { toast } from './ui.js';
import { addRipple } from './water.js';
import { S, bodies, grid, key, tmpW, toWorld, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { discover, discovered } from './progress.js';
import { flashes, spawnBubble } from './overlays.js';

// ================= 特殊建筑 =================
let features = { towers: new Map(), rings: new Map(), arches: new Map(), bridges: new Map(), platforms: new Map(), anchors: new Map(), stairs: new Map() };
let echoCols = new Set();
const relY = (x, y, z) => { const v = grid.get(key(x, y, z)); return v ? y - v.body.com.y : 0; };   // 相对所在物块重心的高度

function columnRuns() {
  const cols = new Map();
  for (const v of voxels) { const k = v.x + ',' + v.z; if (!cols.has(k)) cols.set(k, []); cols.get(k).push(v.y); }
  const runs = [];
  for (const [k, ys] of cols) {
    ys.sort((a, b) => a - b);
    const [x, z] = k.split(',').map(Number);
    let start = ys[0];
    for (let i = 1; i <= ys.length; i++) {
      if (i < ys.length && ys[i] === ys[i - 1] + 1) continue;
      runs.push({ x, z, bottom: start, top: ys[i - 1], h: ys[i - 1] - start + 1 });
      if (i < ys.length) start = ys[i];
    }
  }
  return runs;
}
// 灯塔：竖直 5 格以上且塔顶高出水面
function detectTowers(runs) {
  const out = new Map();
  for (const r of runs) if (r.h >= TOWER_MIN && relY(r.x, r.top, r.z) >= 1.5) {
    const k = r.x + ',' + r.z, o = out.get(k);
    if (!o || r.h > o.h) out.set(k, r);
  }
  return out;
}
// 深锚：水下竖直 5 格以上
// 只看柱子在水下的那一段，所以一根贯穿水面的长柱可以同时是深锚（水下）和灯塔（整根）
function detectAnchors(runs) {
  const out = new Map();
  for (const r of runs) {
    let top = r.top;
    while (top >= r.bottom && relY(r.x, top, r.z) > 1) top--;
    const h = top - r.bottom + 1;
    if (h >= NEED.anchor && relY(r.x, r.bottom, r.z) <= NEED.anchorDepth) out.set(r.x + ',' + r.z + ':' + r.bottom, { ...r, top, h });
  }
  return out;
}
// 环：同层围合，洪水填充找被围住的空格
function detectRings() {
  const layers = new Map(), out = new Map(), D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const v of voxels) { if (!layers.has(v.y)) layers.set(v.y, []); layers.get(v.y).push(v); }
  for (const [y, vs] of layers) {
    if (vs.length < 8) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const v of vs) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); }
    x0--; x1++; z0--; z1++;
    const D = z1 - z0 + 1, idx = (x, z) => (x - x0) * D + (z - z0);
    const outside = new Uint8Array((x1 - x0 + 1) * D), seen = new Uint8Array(outside.length);
    const st = [[x0, z0]]; outside[0] = 1;
    while (st.length) {
      const [x, z] = st.pop();
      for (const [dx, dz] of D4) {
        const nx = x + dx, nz = z + dz;
        if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue;
        const i = idx(nx, nz);
        if (outside[i] || S(nx, y, nz)) continue;
        outside[i] = 1; st.push([nx, nz]);
      }
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const i = idx(x, z);
      if (outside[i] || seen[i] || S(x, y, z)) continue;
      const cells = [], q2 = [[x, z]]; seen[i] = 1;
      while (q2.length) {
        const [cx, cz] = q2.pop(); cells.push([cx, cz]);
        for (const [dx, dz] of D4) {
          const nx = cx + dx, nz = cz + dz, j = idx(nx, nz);
          if (seen[j] || outside[j] || S(nx, y, nz)) continue;
          seen[j] = 1; q2.push([nx, nz]);
        }
      }
      let wall = null;
      for (const [dx, dz] of D4) { wall = wall || grid.get(key(cells[0][0] + dx, y, cells[0][1] + dz)); }
      const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length, cz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
      out.set(`${y}:${x},${z}:${cells.length}`, { y, cells, cx, cz, wall, timer: 0, popT: Math.random() });
    }
  }
  return out;
}
// 拱门：两根 ≥2 格的柱子 + 横梁，下方 ≥1 格宽、2 格高的洞
function detectArches() {
  const out = new Map();
  for (const v of voxels) {
    const { x, y, z } = v;
    if (!S(x, y + 1, z) || !S(x, y - 1, z)) continue;
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      for (let k = 1; k <= 7; k++) {
        const cx = x + ax * k, cz = z + az * k;
        if (!S(cx, y + 1, cz)) break;
        if (S(cx, y, cz)) { if (k >= 2 && S(cx, y - 1, cz)) out.set(`${ax}:${x},${y},${z}:${k}`, { x, y, z, ax, az, k }); break; }
        if (S(cx, y - 1, cz)) break;
      }
    }
  }
  return out;
}
// 长桥：同层直线 ≥8 格
function detectBridges() {
  const out = new Map();
  for (const v of voxels) for (const [ax, az] of [[1, 0], [0, 1]]) {
    if (S(v.x - ax, v.y, v.z - az)) continue;
    let len = 1;
    while (S(v.x + ax * len, v.y, v.z + az * len)) len++;
    if (len >= NEED.bridge) out.set(`${ax}:${v.x},${v.y},${v.z}`, { x: v.x, y: v.y, z: v.z, ax, az, len });
  }
  return out;
}
// 浮台：3×3 实心且上方空
function detectPlatforms() {
  const out = new Map();
  for (const v of voxels) {
    let ok = true;
    for (let i = 0; i < 3 && ok; i++) for (let j = 0; j < 3 && ok; j++) if (!S(v.x + i, v.y, v.z + j) || S(v.x + i, v.y + 1, v.z + j)) ok = false;
    if (ok) out.set(key(v.x, v.y, v.z), { x: v.x, y: v.y, z: v.z });
  }
  return out;
}
// 阶梯：每级前进 1 格、升高 1 格，连续 ≥4 级
function detectStairs() {
  const out = new Map();
  for (const v of voxels) for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (S(v.x - ax, v.y - 1, v.z - az)) continue;
    let n = 1;
    while (S(v.x + ax * n, v.y + n, v.z + az * n)) n++;
    if (n >= NEED.stair) out.set(`${ax},${az}:${v.x},${v.y},${v.z}`, { x: v.x, y: v.y, z: v.z, ax, az, n });
  }
  return out;
}

// ———— “差一点”提示：还没发现的建筑，结构离它只差一两步时，标出下一格该放在哪里 ————
let hints = [];                    // [{ x, y, z, body, w }]，w 越大越接近完成
function detectHints(runs) {
  const out = [], want = t => !discovered.has(t);
  const push = (x, y, z, from, w) => { if (!S(x, y, z) && from) out.push({ x, y, z, body: from.body, w }); };
  for (const r of runs) {
    const top = grid.get(key(r.x, r.top, r.z)), bot = grid.get(key(r.x, r.bottom, r.z));
    if (want('tower') && r.h >= TOWER_MIN - 2 && r.h < TOWER_MIN + 2 && relY(r.x, r.top, r.z) >= 0) push(r.x, r.top + 1, r.z, top, r.h / TOWER_MIN);
    if (want('anchor') && r.h >= NEED.anchor - 2 && relY(r.x, r.bottom, r.z) <= 0) push(r.x, r.bottom - 1, r.z, bot, r.h / NEED.anchor);
  }
  for (const v of voxels) {
    if (want('bridge')) for (const [ax, az] of [[1, 0], [0, 1]]) {
      if (S(v.x - ax, v.y, v.z - az)) continue;
      let len = 1; while (S(v.x + ax * len, v.y, v.z + az * len)) len++;
      if (len >= NEED.bridge - 2 && len < NEED.bridge) push(v.x + ax * len, v.y, v.z + az * len, grid.get(key(v.x + ax * (len - 1), v.y, v.z + az * (len - 1))), len / NEED.bridge);
    }
    if (want('stair')) for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (S(v.x - ax, v.y - 1, v.z - az)) continue;
      let n = 1; while (S(v.x + ax * n, v.y + n, v.z + az * n)) n++;
      if (n === NEED.stair - 1) push(v.x + ax * n, v.y + n, v.z + az * n, grid.get(key(v.x + ax * (n - 1), v.y + n - 1, v.z + az * (n - 1))), 0.7);
    }
    if (want('platform')) {
      let filled = 0, miss = null;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (S(v.x + i, v.y, v.z + j)) filled++; else if (!miss) miss = [v.x + i, v.z + j]; }
      if (filled >= 7 && filled < 9 && miss) push(miss[0], v.y, miss[1], v, filled / 9);
    }
  }
  // 去重、按接近程度排序，最多提示 4 处，避免满屏都是
  const seen = new Set();
  return out.sort((a, b) => b.w - a.w).filter(h => { const k = key(h.x, h.y, h.z); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
}

function flashCell(x, y, z, delay = 0) { const v = grid.get(key(x, y, z)); if (v) flashes.push({ v, t0: clock.elapsedTime + delay }); }
function worldOf(x, y, z) { const v = grid.get(key(x, y, z)); return v ? toWorld(v, tmpW) : tmpW.set(x, 0, z); }

const REACT = {
  tower(tw) {
    worldOf(tw.x, tw.top, tw.z);
    sfx.bell(Math.min(9, 2 + tw.h), panOf(tmpW)); addRipple(tmpW.x, tmpW.z, 0.3);
    for (let y = tw.bottom; y <= tw.top; y++) flashCell(tw.x, y, tw.z, (tw.top - y) * 0.04);
    return '灯塔';
  },
  ring(r) {
    worldOf(Math.round(r.cx), r.y, Math.round(r.cz));
    if (r.wall) { toWorld(r.wall, tmpW); }
    sfx.spring(panOf(tmpW)); addRipple(tmpW.x, tmpW.z, 0.25);
    for (let i = 0; i < 40; i++) spawnBubble(r, 0.3 + Math.random() * 1.2);
    return '环';
  },
  arch(a) {
    worldOf(a.x, a.y + 1, a.z); sfx.chime(panOf(tmpW));
    for (let i = 0; i <= a.k; i++) flashCell(a.x + a.ax * i, a.y + 1, a.z + a.az * i, i * 0.05);
    return '拱门';
  },
  bridge(b) {
    for (let i = 0; i < b.len; i++) flashCell(b.x + b.ax * i, b.y, b.z + b.az * i, i * 0.06);
    worldOf(b.x, b.y, b.z); sfx.arp(Math.min(9, b.len), panOf(tmpW)); addRipple(tmpW.x, tmpW.z, 0.2);
    return '长桥';
  },
  platform(pl) {
    worldOf(pl.x + 1, pl.y, pl.z + 1); sfx.chord(panOf(tmpW)); addRipple(tmpW.x, tmpW.z, 0.25);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) flashCell(pl.x + i, pl.y, pl.z + j, (i + j) * 0.05);
    return '浮台';
  },
  anchor(an) {
    worldOf(an.x, an.bottom, an.z); sfx.whale(panOf(tmpW)); addRipple(tmpW.x, tmpW.z, 0.15);
    for (let y = an.top; y >= an.bottom; y--) flashCell(an.x, y, an.z, (an.top - y) * 0.08);
    return '深锚';
  },
  stair(st) {
    for (let i = 0; i < st.n; i++) flashCell(st.x + st.ax * i, st.y + i, st.z + st.az * i, i * 0.13);
    worldOf(st.x, st.y, st.z); sfx.scale(Math.min(9, st.n + 2), panOf(tmpW));
    return '阶梯';
  },
};
const lastFx = {};
function cooled(type, sec) {
  const t = clock.elapsedTime;
  if (lastFx[type] && t - lastFx[type] < sec) return false;
  lastFx[type] = t; return true;
}
function react(type, f) {
  toast('发现 · ' + REACT[type](f));
  discover(type, tmpW.x, tmpW.z);   // REACT 把建筑位置留在 tmpW 里
}

function applyColors() {
  for (const v of voxels) v.col = v.baseCol || null;
  const paint = (x, y, z, c) => { const v = grid.get(key(x, y, z)); if (v) v.col = c; };
  for (const pl of features.platforms.values()) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) paint(pl.x + i, pl.y, pl.z + j, PAL.platform);
  for (const b of features.bridges.values()) for (let i = 0; i < b.len; i++) paint(b.x + b.ax * i, b.y, b.z + b.az * i, PAL.bridge);
  for (const r of features.rings.values()) for (const [cx, cz] of r.cells) for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) paint(cx + dx, r.y, cz + dz, PAL.ring);
  for (const a of features.arches.values()) {
    for (const off of [0, a.k]) for (let dy = -1; dy <= 0; dy++) paint(a.x + a.ax * off, a.y + dy, a.z + a.az * off, PAL.archStone);
    for (let i = 0; i <= a.k; i++) paint(a.x + a.ax * i, a.y + 1, a.z + a.az * i, PAL.archBeam);
    const m = Math.round(a.k / 2);
    paint(a.x + a.ax * m, a.y + 1, a.z + a.az * m, PAL.keystone);
  }
  for (const st of features.stairs.values()) for (let i = 0; i < st.n; i++) paint(st.x + st.ax * i, st.y + i, st.z + st.az * i, PAL.stair);
  for (const tw of features.towers.values()) {
    for (let y = tw.bottom; y < tw.top; y++) paint(tw.x, y, tw.z, Math.floor((tw.top - y - 1) / 2) % 2 ? PAL.towerWhite : PAL.towerRed);
    paint(tw.x, tw.top, tw.z, PAL.lamp);
  }
  for (const an of features.anchors.values()) {
    for (let y = an.bottom; y <= an.top; y++) paint(an.x, y, an.z, PAL.anchor);
    paint(an.x, an.bottom, an.z, PAL.anchorTip);
  }
  // 乐器方块：不属于建筑时用乐器颜色；属于建筑时以建筑配色为主、混入一点乐器颜色
  for (const v of voxels) {
    if (!v.inst) continue;
    const ic = INST[v.inst].col;
    v.col = v.col ? (v.col === PAL.lamp ? v.col : blend(v.col, ic)) : ic;
  }
}

const blendCache = new Map();
function blend(building, inst) {
  const k = building.getHexString() + inst.getHexString();
  if (!blendCache.has(k)) blendCache.set(k, building.clone().lerp(inst, INST_TINT));
  return blendCache.get(k);
}

// ———— 方块归属 ————
// 同一时间一个方块只属于一个建筑。新造的建筑会替换掉和它重叠的旧建筑
// （例如先造灯塔、再补横梁成拱门 → 灯塔被拱门替换）。
// 只有包含“刚放下的那个方块”的建筑才能替换别人，所以被替换的旧建筑不会在之后又抢回来。
// 建筑在它的方块全部存在时一直保留，拆掉其中任意一块才会释放。
const PRIORITY = ['anchor', 'tower', 'arch', 'ring', 'stair', 'bridge', 'platform'];   // 同一次放置同时成立多个时，先到先得的顺序
const PLURAL = { tower: 'towers', ring: 'rings', arch: 'arches', bridge: 'bridges', platform: 'platforms', anchor: 'anchors', stair: 'stairs' };
const instances = new Map();       // "类型|key" -> { type, fk, data, cells: [格子key] }

// 每种建筑占用了哪些方块
function cellsOf(type, d) {
  const out = [];
  const add = (x, y, z) => { if (S(x, y, z)) out.push(key(x, y, z)); };
  if (type === 'tower' || type === 'anchor') for (let y = d.bottom; y <= d.top; y++) add(d.x, y, d.z);
  else if (type === 'ring') {
    const seen = new Set();
    for (const [cx, cz] of d.cells) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = key(cx + dx, d.y, cz + dz);
      if (!seen.has(k) && grid.has(k)) { seen.add(k); out.push(k); }
    }
  } else if (type === 'arch') {
    for (const off of [0, d.k]) for (let dy = -1; dy <= 0; dy++) add(d.x + d.ax * off, d.y + dy, d.z + d.az * off);
    for (let i = 0; i <= d.k; i++) add(d.x + d.ax * i, d.y + 1, d.z + d.az * i);
  } else if (type === 'bridge') for (let i = 0; i < d.len; i++) add(d.x + d.ax * i, d.y, d.z + d.az * i);
  else if (type === 'platform') for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) add(d.x + i, d.y, d.z + j);
  else if (type === 'stair') for (let i = 0; i < d.n; i++) add(d.x + d.ax * i, d.y + i, d.z + d.az * i);
  return out;
}

// placed：刚放下的方块的格子 key（拆除、重置时为 null）
// 关卡模式：不再按形状识别建筑，只显示关卡给出的灯塔与提示
let shapeMode = false, levelTowers = [], levelHints = [];
function setLevelState(towers, hintList) { levelTowers = towers; levelHints = hintList; updateFeatures(false); }
function updateFeatures(allowFx, placed = null) {
  if (!shapeMode) {
    instances.clear();
    const F = {};
    for (const t of PRIORITY) F[PLURAL[t]] = new Map();
    levelTowers.forEach((tw, i) => F.towers.set('level' + i, tw));
    features = F; hints = levelHints; echoCols = new Set();
    applyColors();
    for (const b of bodies) b.dirty = true;
    return;
  }
  const runs = columnRuns();
  const C = { tower: detectTowers(runs), anchor: detectAnchors(runs), ring: detectRings(), arch: detectArches(),
    bridge: detectBridges(), platform: detectPlatforms(), stair: detectStairs() };
  // 1) 方块被拆掉的建筑失效，释放归属
  for (const [id, ins] of instances) if (ins.cells.some(c => !grid.has(c))) instances.delete(id);
  const claim = new Map();           // 格子 key -> 建筑 id
  for (const [id, ins] of instances) for (const c of ins.cells) claim.set(c, id);
  const evict = id => { const ins = instances.get(id); if (!ins) return; for (const c of ins.cells) if (claim.get(c) === id) claim.delete(c); instances.delete(id); };

  // 2) 按优先级处理本次识别到的建筑
  const fresh = [], made = new Set();   // made：这次新出现、或包含刚放下方块的建筑，同一次里不会再被别的候选替换
  for (const type of PRIORITY) for (const [fk, data] of C[type]) {
    const id = type + '|' + fk, cells = cellsOf(type, data);
    if (!cells.length) continue;
    const others = new Set(cells.map(c => claim.get(c)).filter(o => o && o !== id));
    if (others.size) {
      // 和别的建筑重叠：只有包含刚放下的方块、且对方不是这次刚接纳的，才能替换
      if (!placed || !cells.includes(placed) || [...others].some(o => made.has(o))) continue;
      for (const o of others) evict(o);
    }
    const old = instances.get(id);
    if (old) {
      if (type === 'ring') { data.timer = old.data.timer; data.popT = old.data.popT; }
      if (type === 'tower' && data.h > old.data.h) fresh.push(old);   // 灯塔长高：再响一次
      for (const c of old.cells) if (claim.get(c) === id) claim.delete(c);
      old.data = data; old.cells = cells;
    } else {
      const ins = { type, fk, data, cells };
      instances.set(id, ins); fresh.push(ins);
    }
    for (const c of cells) claim.set(c, id);
    if (!old || (placed && cells.includes(placed))) made.add(id);
  }

  // 4) 新建筑的发现反应
  if (allowFx) {
    const once = new Set();
    for (const ins of fresh) {
      if (!instances.has(ins.type + '|' + ins.fk)) continue;
      if (['tower', 'ring', 'arch'].includes(ins.type)) react(ins.type, ins.data);
      else if (!once.has(ins.type) && cooled(ins.type, ins.type === 'platform' ? 4 : 2.5)) { once.add(ins.type); react(ins.type, ins.data); }
    }
  }

  // 5) 汇总成按类别的表，供上色、覆盖层、回声使用
  const F = {};
  for (const t of PRIORITY) F[PLURAL[t]] = new Map();
  for (const ins of instances.values()) F[PLURAL[ins.type]].set(ins.fk, ins.data);
  features = F;
  hints = detectHints(runs);
  applyColors();
  for (const b of bodies) b.dirty = true;
  echoCols = new Set();
  for (const a of F.arches.values()) { if (a.ax) for (let i = 0; i <= a.k; i++) echoCols.add(a.x + i); else echoCols.add(a.x); }
}

function resetFeatures() { instances.clear(); }

export { setLevelState, hints, instances, cellsOf, resetFeatures, PRIORITY, features, echoCols, relY, columnRuns, detectTowers, detectAnchors, detectRings, detectArches, detectBridges, detectPlatforms, detectStairs, flashCell, worldOf, REACT, lastFx, cooled, react, applyColors, updateFeatures };
