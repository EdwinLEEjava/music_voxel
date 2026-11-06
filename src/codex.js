import { PAL } from './config.js';
import { discovered } from './progress.js';
import { uiState } from './ui.js';
import { sfx } from './audio.js';

// ================= 图鉴：按 B 打开 / 关闭 =================
// 每种建筑一个像素剪影：没发现时是暗色剪影，发现后换成这种建筑的配色
// 剪影用字符画：每个字符一格；'.' 空、'~' 水面线，其余字母对应下面的颜色
const ENTRIES = [
  { type: 'tower', name: '灯塔', art: ['..L..', '..r..', '..w..', '..r..', '~~w~~', '..r..'] },
  { type: 'ring', name: '环', art: ['.....', '.ccc.', '.c.c.', '.ccc.', '.....'] },
  { type: 'arch', name: '拱门', art: ['bbkbb', 's...s', 's...s', 's...s'] },
  { type: 'bridge', name: '长桥', art: ['.......', '.......', 'ggggggg', '.......'] },
  { type: 'platform', name: '浮台', art: ['.....', '.ppp.', '.ppp.', '.ppp.', '.....'] },
  { type: 'anchor', name: '深锚', art: ['..a..', '~~a~~', '..a..', '..a..', '..a..', '..t..'] },
  { type: 'stair', name: '阶梯', art: ['...h', '..hh', '.hhh', 'hhhh'] },
];
const COLS = {
  L: PAL.lamp, r: PAL.towerRed, w: PAL.towerWhite, c: PAL.ring, b: PAL.archBeam, k: PAL.keystone, s: PAL.archStone,
  g: PAL.bridge, p: PAL.platform, a: PAL.anchor, t: PAL.anchorTip, h: PAL.stair,
};
const DARK = '#26272a', WATER = 'rgba(255,255,255,.28)';
// 黑白风格：已发现的建筑按原配色的明暗显示成灰度
const grey = col => { const l = Math.round(90 + 165 * (0.3 * col.r + 0.59 * col.g + 0.11 * col.b)); return `rgb(${l},${l},${l})`; };

const el = document.createElement('div');
el.id = 'codex';
document.body.appendChild(el);

function svgOf(art, lit) {
  const W = Math.max(...art.map(r => r.length)), H = art.length, S = 10;
  let s = `<svg viewBox="-2 -2 ${W * S + 4} ${H * S + 4}" width="${W * S + 4}" height="${H * S + 4}">`;
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    if (ch === '~') { s += `<rect x="${x * S}" y="${y * S + S / 2 - 1}" width="${S}" height="2" fill="${WATER}"/>`; return; }
    const fill = lit ? grey(COLS[ch]) : DARK;
    s += `<rect x="${x * S + 0.5}" y="${y * S + 0.5}" width="${S - 1}" height="${S - 1}" rx="1" fill="${fill}"/>`;
  }));
  // 水面线画在方块上层，表示“这一格在水面上”
  art.forEach((row, y) => { if (row.includes('~')) s += `<rect x="0" y="${y * S + S / 2 - 1}" width="${W * S}" height="2" fill="${WATER}"/>`; });
  return s + '</svg>';
}

function render() {
  el.innerHTML = `<div class="codex-title">图鉴 · ${discovered.size}/${ENTRIES.length}</div><div class="codex-grid">` +
    ENTRIES.map(e => {
      const lit = discovered.has(e.type);
      return `<div class="codex-card${lit ? ' lit' : ''}"><div class="codex-art">${svgOf(e.art, lit)}</div><div class="codex-name">${e.name}</div></div>`;
    }).join('') + '</div><div class="codex-foot">B / Esc 关闭</div>';
}

// 打开 / 关闭（按键由 menu.js 统一处理）
function toggleCodex(force) {
  const was = uiState.codex;
  uiState.codex = force ?? !uiState.codex;
  if (was !== uiState.codex) { sfx.init(); sfx.ui(uiState.codex ? 'open' : 'close'); }
  if (uiState.codex) render();
  el.classList.toggle('open', uiState.codex);
}
// 发现新建筑时，如果图鉴开着就刷新
function refreshCodex() { if (uiState.codex) render(); }
// 点击图鉴外的空白处关闭
el.addEventListener('pointerdown', e => { if (e.target === el) toggleCodex(false); });

export { toggleCodex, refreshCodex };
