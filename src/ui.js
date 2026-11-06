import { voxels } from './world.js';

// ================= 界面文字：提示、计数 =================
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text; toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = 0), 2200);
}
const hintEl = document.getElementById('hint'), countEl = document.getElementById('count'), sndEl = document.getElementById('snd');
function updateHud() { countEl.textContent = voxels.length; }

export { toastEl, toastTimer, toast, hintEl, countEl, sndEl, updateHud };
