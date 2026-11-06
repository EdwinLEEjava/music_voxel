import { voxels } from './world.js';

// ================= 界面文字：提示、计数 =================
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text; toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = 0), 2200);
}
const hintEl = document.getElementById('hint'), countEl = document.getElementById('count');
// 界面是否打开（图鉴 / 设置）：打开时不响应游戏按键
const uiState = { title: true, codex: false, settings: false, get open() { return this.title || this.codex || this.settings; } };
function updateHud() { countEl.textContent = voxels.filter(v => !v.relic).length; }   // 只数玩家自己放的方块

export { toastEl, toastTimer, toast, hintEl, countEl, uiState, updateHud };
