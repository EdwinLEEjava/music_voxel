import { INST, PAL, TOWER_MIN } from './config.js';
import { clock } from './core.js';
import { toast } from './ui.js';
import { addRipple } from './water.js';
import { S, bodies, grid, key, tmpW, toWorld, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { discover } from './progress.js';
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
  for (const r of runs) if (r.h >= TOWER_MIN && relY(r.x, r.top, r.z) >= 2) {
    const k = r.x + ',' + r.z, o = out.get(k);
    if (!o || r.h > o.h) out.set(k, r);
  }
  return out;
}
// 深锚：水下竖直 5 格以上
function detectAnchors(runs) {
  const out = new Map();
  for (const r of runs) if (r.h >= 5 && relY(r.x, r.bottom, r.z) <= -4 && relY(r.x, r.top, r.z) <= 1) out.set(r.x + ',' + r.z + ':' + r.bottom, r);
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
    if (len >= 8) out.set(`${ax}:${v.x},${v.y},${v.z}`, { x: v.x, y: v.y, z: v.z, ax, az, len });
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
    if (n >= 4) out.set(`${ax},${az}:${v.x},${v.y},${v.z}`, { x: v.x, y: v.y, z: v.z, ax, az, n });
  }
  return out;
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
  discover(type);
}

function applyColors() {
  for (const v of voxels) v.col = null;
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
  for (const an of features.anchors.values()) {
    for (let y = an.bottom; y <= an.top; y++) paint(an.x, y, an.z, PAL.anchor);
    paint(an.x, an.bottom, an.z, PAL.anchorTip);
  }
  for (const tw of features.towers.values()) {
    for (let y = tw.bottom; y < tw.top; y++) paint(tw.x, y, tw.z, Math.floor((tw.top - y - 1) / 2) % 2 ? PAL.towerWhite : PAL.towerRed);
    paint(tw.x, tw.top, tw.z, PAL.lamp);
  }
  for (const v of voxels) if (v.inst) v.col = INST[v.inst].col;   // 乐器方块保持自己的颜色
}

// ———— 方块归属 ————
// 一个方块一旦属于某种建筑，就只能被同类建筑共用（例如两座拱门共用一根柱子），
// 不能再算进其他类别。建筑在它的方块全部存在时一直保留归属，拆掉其中任意一块才会释放。
const PRIORITY = ['anchor', 'tower', 'arch', 'ring', 'stair', 'bridge', 'platform'];   // 同一次放置同时成立时，先到先得的顺序
const PLURAL = { tower: 'towers', ring: 'rings', arch: 'arches', bridge: 'bridges', platform: 'platforms', anchor: 'anchors', stair: 'stairs' };
const instances = new Map();   // "类型|key" -> { type, fk, data, cells: [格子key] }

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

function updateFeatures(allowFx) {
  const runs = columnRuns();
  const C = { ring: detectRings(), arch: detectArches(), bridge: detectBridges(), platform: detectPlatforms(), stair: detectStairs() };
  // 1) 方块被拆掉的建筑失效，释放归属
  for (const [id, ins] of instances) if (ins.cells.some(c => !grid.has(c))) instances.delete(id);
  const claim = new Map();
  for (const ins of instances.values()) for (const c of ins.cells) claim.set(c, ins.type);
  const allowed = (type, cells) => cells.every(c => { const o = claim.get(c); return !o || o === type; });

  // 2) 按优先级接纳本次识别到的建筑；占用了其他类别方块的候选直接忽略
  const fresh = [], detected = new Set();
  // 竖直的柱子（灯塔 / 深锚）只用没被其他类别占用的那一段来判断
  const freeRuns = type => {
    const out = [];
    for (const r of runs) {
      let start = null;
      for (let y = r.bottom; y <= r.top + 1; y++) {
        const o = y <= r.top ? claim.get(key(r.x, y, r.z)) : 'END';
        const free = !o || o === type;
        if (free && start === null) start = y;
        if (!free && start !== null) { out.push({ x: r.x, z: r.z, bottom: start, top: y - 1, h: y - start }); start = null; }
      }
    }
    return out;
  };
  for (const type of PRIORITY) for (const [fk, data] of (type === 'tower' ? detectTowers(freeRuns('tower')) : type === 'anchor' ? detectAnchors(freeRuns('anchor')) : C[type])) {
    const id = type + '|' + fk, cells = cellsOf(type, data);
    if (!cells.length || !allowed(type, cells)) continue;
    detected.add(id);
    const old = instances.get(id);
    if (old) {
      if (type === 'ring') { data.timer = old.data.timer; data.popT = old.data.popT; }
      if (type === 'tower' && data.h > old.data.h) fresh.push(old);   // 灯塔长高：再响一次
      old.data = data; old.cells = cells;
    } else {
      const ins = { type, fk, data, cells };
      instances.set(id, ins); fresh.push(ins);
    }
    for (const c of cells) claim.set(c, type);
  }
  // 3) 没再被识别到、但被同类新建筑覆盖的旧建筑（如环被扩大、长桥向前延伸）移除
  for (const [id, ins] of instances) {
    if (detected.has(id)) continue;
    const covered = [...instances.values()].some(o => o !== ins && o.type === ins.type && detected.has(o.type + '|' + o.fk) && o.cells.some(c => ins.cells.includes(c)));
    if (covered) instances.delete(id);
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
  applyColors();
  for (const b of bodies) b.dirty = true;
  echoCols = new Set();
  for (const a of F.arches.values()) { if (a.ax) for (let i = 0; i <= a.k; i++) echoCols.add(a.x + i); else echoCols.add(a.x); }
}

function resetFeatures() { instances.clear(); }

export { instances, cellsOf, resetFeatures, PRIORITY, features, echoCols, relY, columnRuns, detectTowers, detectAnchors, detectRings, detectArches, detectBridges, detectPlatforms, detectStairs, flashCell, worldOf, REACT, lastFx, cooled, react, applyColors, updateFeatures };
