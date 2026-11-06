import { sfx } from './audio.js';
import { uiState } from './ui.js';

// ================= 物品栏：底部的六边形格子 =================
// 方块：无限；灯：有数量（第一关开局 0 盏）。按 1 / 2 或点击选择，左键用选中的物品
const inv = { sel: 'block', lamp: 0 };
const ITEMS = [
  { id: 'block', key: '1', name: '方块', icon: '<svg viewBox="0 0 24 24"><path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5"/></svg>' },
  { id: 'lamp', key: '2', name: '灯', icon: '<svg viewBox="0 0 24 24"><path d="M7 19h10M8.5 19v-2h7v2M9 17V9h6v8M8 9h8M10 9V7.5h4V9M12 7.5V5.5"/></svg>' },
];

const hotEl = document.createElement('div');
hotEl.id = 'hotbar';
hotEl.innerHTML = ITEMS.map(it => `<button class="hot" data-item="${it.id}" title="${it.name}"><span class="hot-key">${it.key}</span>
  <span class="hot-hex"><span class="hot-in">${it.icon}</span></span><span class="hot-n" data-n="${it.id}"></span></button>`).join('');
document.body.appendChild(hotEl);

function renderHotbar() {
  for (const b of hotEl.querySelectorAll('.hot')) {
    const id = b.dataset.item, n = id === 'block' ? Infinity : inv[id];
    b.classList.toggle('on', inv.sel === id);
    b.classList.toggle('empty', n === 0);
    b.querySelector('.hot-n').textContent = n === Infinity ? '∞' : n;
  }
}
function select(id) {
  if (inv.sel === id) return;
  inv.sel = id; sfx.init(); sfx.ui(); renderHotbar();
}
// 数量变化（拾起 / 用掉 / 关卡给出）
function addItem(id, n) { inv[id] = Math.max(0, inv[id] + n); renderHotbar(); }
function setItems(counts) { Object.assign(inv, counts); inv.sel = 'block'; renderHotbar(); }

hotEl.addEventListener('click', e => { const b = e.target.closest('[data-item]'); if (b) { select(b.dataset.item); b.blur(); } });
addEventListener('keydown', e => {
  if (uiState.open) return;
  const it = ITEMS.find(i => i.key === e.key);
  if (it) select(it.id);
});
renderHotbar();

export { inv, addItem, setItems, renderHotbar };
