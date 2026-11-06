import { clock } from './core.js';
import { uiState } from './ui.js';
import { U } from './water.js';
import { addVoxel } from './world.js';
import { sfx } from './audio.js';
import { quitGame } from './menu.js';
import { startIntro } from './main.js';

// ================= 开始页面 =================
// 开始前：世界整个藏在雾里，只显示游戏名和两个文字按钮
// 点“开始游戏”：页面淡出 → 镜头从远处拉近 → 中心出现第一个白色方块 → 雾从方块周围散开到平时的范围
const GAME_NAME = '水中体素';
const FOG_HIDDEN = -7;            // 雾推到负数：整片海都藏在雾里
const FOG_OPEN_SEC = 3.5;         // 雾散开所用的时间

document.body.classList.add('title');
U.uFogPush.value = FOG_HIDDEN;
const titleEl = document.createElement('div');
titleEl.id = 'title';
titleEl.innerHTML = `<div class="title-name">${GAME_NAME}</div>
  <button class="title-btn" data-go="start">开始游戏</button>
  <button class="title-btn" data-go="quit">退出游戏</button>`;
document.body.appendChild(titleEl);

let openT = -1;
function fogOpen() {
  const a = Math.min(1, (clock.elapsedTime - openT) / FOG_OPEN_SEC);
  U.uFogPush.value = FOG_HIDDEN * (1 - a * a * (3 - 2 * a));   // 平滑地从“全雾”退到 0
  if (a < 1) requestAnimationFrame(fogOpen);
}

function startGame() {
  sfx.init();
  titleEl.classList.add('gone');
  startIntro();
  setTimeout(() => {
    addVoxel(0, 0, 0);                           // 第一个白色方块
    openT = clock.elapsedTime; fogOpen();
  }, 700);
  setTimeout(() => { uiState.title = false; document.body.classList.remove('title'); titleEl.remove(); }, 3200);
}

titleEl.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (!b || titleEl.classList.contains('gone')) return;
  if (b.dataset.go === 'start') startGame();
  else quitGame();
});
