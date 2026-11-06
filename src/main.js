import * as THREE from 'three';
import { GROW_MAX, INST, TAP_FAR, WATER_SIZE, WHITE } from './config.js';
import { VIEW_DIR, camera, clock, renderer, scene } from './core.js';
import { U, waterMat } from './water.js';
import { bodies, rebuildBody, spanR, tmpT, view, viewTarget, voxels } from './world.js';
import { processQueue } from './notes.js';
import './codex.js';
import { updateCompanion } from './companion.js';
import { updateColorful } from './progress.js';
import { m4, pos, q, sc, updateOverlays } from './overlays.js';
import { ghost, ghostEdges, lastPickDist, pan, pickCell, pointer, pointers, updatePan, zoom } from './input.js';

// ================= 主循环 =================
const euler = new THREE.Euler(), tmpV = new THREE.Vector3();
let camDist = 8;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  U.uTime.value = t;
  const n = voxels.length;

  // 每个物块：浮力扶正 + 水的阻尼 + 暗流；重心平滑跟随
  for (const b of bodies) {
    const mass = 1 + b.voxels.size * 0.05, cur = 0.05 / Math.sqrt(mass), { tilt, spin } = b;
    spin.x += (-1.6 * tilt.x - 1.4 * spin.x + cur * Math.sin(t * 0.31 + b.ph)) * dt;
    spin.z += (-1.6 * tilt.z - 1.4 * spin.z + cur * Math.sin(t * 0.23 + 1.7 + b.ph)) * dt;
    spin.y += (-0.25 * tilt.y - 1.4 * spin.y + cur * 0.8 * Math.sin(t * 0.13 + 0.5 + b.ph)) * dt;
    tilt.addScaledVector(spin, dt);
    tilt.x = THREE.MathUtils.clamp(tilt.x, -0.6, 0.6); tilt.z = THREE.MathUtils.clamp(tilt.z, -0.6, 0.6);
    b.heaveV += (-2.0 * b.heave - 1.6 * b.heaveV) * dt;
    b.heave += b.heaveV * dt;
    b.smooth.lerp(b.com, 1 - Math.exp(-dt * 2));
    b.group.position.set(b.smooth.x, b.heave + Math.sin(t * 0.5 + b.ph) * 0.22, b.smooth.z);
    b.group.quaternion.setFromEuler(euler.set(tilt.x, tilt.y, tilt.z));
    b.content.position.copy(b.smooth).negate();

    // 新方块：弹出 + 沉入，落定后并入网格
    let gi = 0;
    for (const v of b.voxels) {
      if (v.merged) continue;
      v.sv += ((1 - v.s) * 140 - v.sv * 11) * dt;
      v.s += v.sv * dt;
      const age = t - v.born;
      if (age > 0.6) { v.merged = true; b.dirty = true; continue; }
      if (gi >= GROW_MAX) continue;
      pos.set(v.x, v.y + Math.exp(-age * 6) * 0.5, v.z);
      b.grow.setColorAt(gi, v.col || (v.inst ? INST[v.inst].col : WHITE));
      b.grow.setMatrixAt(gi++, m4.compose(pos, q, sc.setScalar(Math.max(v.s, 0.0001))));
    }
    b.grow.count = gi;
    b.grow.instanceMatrix.needsUpdate = true;
    if (b.grow.instanceColor) b.grow.instanceColor.needsUpdate = true;
    if (b.dirty) rebuildBody(b);
  }

  // 相机：方向固定，跟随所有物块的中心，距离随范围变大
  updatePan(dt);
  view.lerp(tmpV.copy(viewTarget).add(pan), 1 - Math.exp(-dt * 1.5));
  const fit = 7 + spanR * 2.6 + Math.sqrt(n) * 0.35;
  camDist += (fit * zoom - camDist) * (1 - Math.exp(-dt * 2.5));
  camera.position.copy(VIEW_DIR).multiplyScalar(camDist).add(view);
  camera.lookAt(view);

  scene.updateMatrixWorld();
  processQueue(t);
  updateOverlays(t, dt);
  updateCompanion(t, dt);
  updateColorful(dt);

  // 悬停预览
  let target = null;
  if (!n) target = { x: 0, y: 0, z: 0, from: null };
  else if (pointer.has && pointers.size === 0) target = pickCell(pointer.x, pointer.y);
  if (target && n && lastPickDist >= TAP_FAR) target = null;
  if (target) {
    if (target.from) { ghost.matrix.multiplyMatrices(target.from.body.content.matrixWorld, tmpT.makeTranslation(target.x, target.y, target.z)); }
    else ghost.matrix.makeTranslation(0, 0, 0);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3), ic = target.from && target.from.inst ? INST[target.from.inst].col : WHITE;
    ghost.material.color.copy(ic); ghostEdges.material.color.copy(ic);
    ghost.material.opacity = 0.06 + pulse * 0.08;
    ghostEdges.material.opacity = 0.3 + pulse * 0.35;
    ghost.visible = true;
  } else ghost.visible = false;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { euler, camDist, frame };
