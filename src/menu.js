import { sfx } from './audio.js';
import { toggleCodex } from './codex.js';
import { uiState } from './ui.js';

// ================= 游戏界面：底部工具栏（图鉴 / 音效 / 设置）+ 设置面板 =================
// 工具栏每个按钮：上面是按键，下面是图标。设置面板：操作 / 重置游戏 / 退出游戏
const ICON = {
  codex: '<svg viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9"/></svg>',
};

const bar = document.createElement('div');
bar.id = 'bar';
bar.innerHTML = [
  ['codex', 'B', ICON.codex, '图鉴'],
  ['sound', 'M', ICON.soundOn, '音效'],
  ['settings', 'Esc', ICON.settings, '设置'],
].map(([act, k, icon, name]) => `<button class="bar-btn" data-act="${act}" title="${name}"><span class="bar-key">${k}</span><span class="bar-icon">${icon}</span></button>`).join('');
document.body.appendChild(bar);
const soundIcon = bar.querySelector('[data-act="sound"] .bar-icon');

// ———— 设置面板 ————
const CONTROLS = [
  ['鼠标左键', '放置方块'],
  ['鼠标右键', '拆除方块'],
  ['左键拖动 / WASD / 方向键', '移动视野'],
  ['滚轮 / 双指', '缩放'],
  ['点击远处水面 / 空格', '敲水，让水波奏响结构'],
  ['Z', '撤销上一个方块'],
  ['R', '清空所有方块'],
  ['C', '视野回到结构中心'],
  ['B', '图鉴'],
  ['M', '音效开 / 关'],
  ['Esc', '设置'],
];
const TABS = {
  controls: {
    name: '操作',
    html: () => `<div class="set-h">操作</div><table class="set-keys">${CONTROLS.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('')}</table>`,
  },
  reset: {
    name: '重置游戏',
    html: () => `<div class="set-h">重置游戏</div><p>清空所有方块和已发现的建筑，世界回到最初的黑白。</p><button class="set-act" data-do="reset">重置</button>`,
  },
  quit: {
    name: '退出游戏',
    html: () => `<div class="set-h">退出游戏</div><p>离开这片海。</p><button class="set-act" data-do="quit">退出</button>`,
  },
};
const panel = document.createElement('div');
panel.id = 'settings';
document.body.appendChild(panel);
let tab = 'controls';
function renderSettings() {
  panel.innerHTML = `<div class="set-box"><div class="set-tabs">${Object.entries(TABS).map(([id, t]) =>
    `<button class="set-tab${id === tab ? ' on' : ''}" data-tab="${id}">${t.name}</button>`).join('')}</div>
    <div class="set-body">${TABS[tab].html()}</div></div><div class="set-foot">Esc 返回游戏</div>`;
}
function toggleSettings(force) {
  uiState.settings = force ?? !uiState.settings;
  if (uiState.settings) { tab = 'controls'; renderSettings(); toggleCodex(false); }
  panel.classList.toggle('open', uiState.settings);
}

// 退出：浏览器只允许脚本关闭它自己打开的窗口，关不掉时盖一层黑幕
const quitEl = document.createElement('div');
quitEl.id = 'quit';
quitEl.innerHTML = '<div>已退出</div><div class="quit-sub">可以关闭这个页面 · 点击任意处回到游戏</div>';
document.body.appendChild(quitEl);
quitEl.addEventListener('pointerdown', () => quitEl.classList.remove('open'));
function quitGame() { window.close(); quitEl.classList.add('open'); }

panel.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'), d = e.target.closest('[data-do]');
  if (t) { tab = t.dataset.tab; renderSettings(); }
  else if (d && d.dataset.do === 'reset') location.reload();
  else if (d && d.dataset.do === 'quit') { toggleSettings(false); quitGame(); }
  else if (e.target === panel) toggleSettings(false);
});

function toggleSound() {
  sfx.init();
  soundIcon.innerHTML = sfx.toggle() ? ICON.soundOn : ICON.soundOff;
}

bar.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'codex') { toggleSettings(false); toggleCodex(); }
  if (b.dataset.act === 'sound') toggleSound();
  if (b.dataset.act === 'settings') toggleSettings();
  b.blur();
});

addEventListener('keydown', e => {
  if (uiState.title) return;           // 开始页面时不响应
  const k = e.key.toLowerCase();
  if (k === 'escape') { if (uiState.codex) toggleCodex(false); else toggleSettings(); }
  else if (k === 'b' && !uiState.settings) toggleCodex();
  else if (k === 'm') toggleSound();
});

export { quitGame, toggleSettings, toggleSound };
