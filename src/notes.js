import { ECHO_GAP, NOTE_WINDOW, NOTE_WINDOW_MAX, VOXEL_COOLDOWN, WATER_Y, WAVE_SPEED } from './config.js';
import { clock } from './core.js';
import { addRipple } from './water.js';
import { NB, grid, key, noteStep, tmpW, toWorld, voxels } from './world.js';
import { panOf, sfx } from './audio.js';
import { echoCols } from './features.js';
import { flashes } from './overlays.js';
import { notice } from './companion.js';

// ================= 发声队列：放置回响 & 水波 =================
const noteQueue = [];              // {at, v, vol, wave}
const recentNotes = [];
let lastTap = -9, waveId = 0;

function queueEcho(src) {
  const t0 = clock.elapsedTime + 0.12, seen = new Set([key(src.x, src.y, src.z)]);
  let frontier = [src], depth = 0, count = 0;
  while (frontier.length && depth < 3 && count < 6) {
    depth++;
    const next = [];
    for (const v of frontier) for (const [dx, dy, dz] of NB) {
      const k = key(v.x + dx, v.y + dy, v.z + dz);
      if (seen.has(k)) continue;
      seen.add(k);
      const nb = grid.get(k);
      if (nb) next.push(nb);
    }
    next.sort(() => Math.random() - 0.5);
    for (const nb of next) {
      if (count >= 6) break;
      noteQueue.push({ at: t0 + count * ECHO_GAP, v: nb, vol: 0.55 * Math.pow(0.6, depth - 1) });
      count++;
    }
    frontier = next;
  }
}

function waterTap(wx, wz) {
  const t0 = clock.elapsedTime;
  if (t0 - lastTap < 0.25) return;                       // 防止连点
  lastTap = t0;
  for (const e of noteQueue) if (e.wave) e.vol *= 0.35;  // 新水波来了，旧水波剩下的音减弱
  addRipple(wx, wz, 0.22);
  notice(wx, wz);
  sfx.tap(panOf(tmpW.set(wx, 0, wz)));
  const id = ++waveId;
  for (const v of voxels) {
    toWorld(v, tmpW);
    noteQueue.push({ at: t0 + Math.hypot(tmpW.x - wx, tmpW.z - wz) / WAVE_SPEED, v, vol: 1, wave: id });
  }
}

function processQueue(t) {
  while (recentNotes.length && t - recentNotes[0] > NOTE_WINDOW) recentNotes.shift();
  if (!noteQueue.length) return;
  const due = [];
  for (let i = noteQueue.length - 1; i >= 0; i--) if (noteQueue[i].at <= t) { due.push(noteQueue[i]); noteQueue.splice(i, 1); }
  if (!due.length) return;
  const seen = new Set(), notes = [];
  let echo = false;
  for (const e of due) {
    const v = e.v;
    if (grid.get(key(v.x, v.y, v.z)) !== v) continue;          // 已被拆除
    if (t - v.lastPlay < VOXEL_COOLDOWN || e.vol < 0.05) continue;
    v.lastPlay = t;
    flashes.push({ v, t0: t });
    const st = noteStep(v), inst = v.inst || 'tone';
    if (seen.has(st + inst) || notes.length >= 4 || recentNotes.length + notes.length >= NOTE_WINDOW_MAX) continue;
    seen.add(st + inst);
    toWorld(v, tmpW);
    notes.push({ step: st, pan: panOf(tmpW), uw: tmpW.y < WATER_Y - 0.3, vol: e.vol, inst });
    if (echoCols.has(v.x)) echo = true;
  }
  for (const _ of notes) recentNotes.push(t);
  sfx.play(notes, echo);
}

export { noteQueue, recentNotes, lastTap, waveId, queueEcho, waterTap, processQueue };
