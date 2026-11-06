import * as THREE from 'three';
import { TAP_FAR, WATER_Y, ZMAX, ZMIN } from './config.js';
import { VIEW_DIR, camera, renderer, scene } from './core.js';
import { hintEl, sndEl } from './ui.js';
import { NB, S, addVoxel, bodies, grid, key, removeLast, removeVoxel, resetAll, spanR, view, voxels } from './world.js';
import { sfx } from './audio.js';
import { waterTap } from './notes.js';

// ================= 放置预览 & 拾取 =================
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
const ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
ghost.add(ghostEdges);
ghost.matrixAutoUpdate = false; ghost.renderOrder = 20; ghost.visible = false;
scene.add(ghost);

const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), invM = new THREE.Matrix4();
const pointer = { x: 0, y: 0, has: false };
let lastPickDist = 0;
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);

function setRay(px, py) { ndc.set(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); }
function rayHit(px, py) {
  setRay(px, py);
  const meshes = [];
  for (const b of bodies) meshes.push(b.mesh, b.grow);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit || !hit.face) return null;
  const b = hit.object.userData.body;
  invM.copy(b.content.matrixWorld).invert();
  const p = hit.point.clone().applyMatrix4(invM), n = hit.face.normal;
  const v = grid.get(key(Math.round(p.x - n.x * 0.5), Math.round(p.y - n.y * 0.5), Math.round(p.z - n.z * 0.5)));
  return v ? { v, n } : null;
}
// 返回要放置的格子，以及它贴着的那个方块（用来继承音色）
function pickCell(px, py) {
  lastPickDist = 0;
  if (!voxels.length) return { x: 0, y: 0, z: 0, from: null };
  const h = rayHit(px, py);
  if (h) {
    const c = { x: h.v.x + Math.round(h.n.x), y: h.v.y + Math.round(h.n.y), z: h.v.z + Math.round(h.n.z), from: h.v };
    if (!S(c.x, c.y, c.z)) return c;
  }
  let best = null, bestD = Infinity;
  const p = new THREE.Vector3();
  for (const b of bodies) {
    invM.copy(b.content.matrixWorld).invert();
    const ray = raycaster.ray.clone().applyMatrix4(invM);
    for (const v of b.voxels) for (const [dx, dy, dz] of NB) {
      const x = v.x + dx, y = v.y + dy, z = v.z + dz;
      if (S(x, y, z)) continue;
      p.set(x, y, z);
      const d = ray.distanceSqToPoint(p) + p.clone().sub(ray.origin).dot(ray.direction) * 0.0004;
      if (d < bestD) { bestD = d; best = { x, y, z, from: v }; }
    }
  }
  lastPickDist = Math.sqrt(Math.max(0, bestD));
  return best;
}
function waterPoint(px, py) { setRay(px, py); return raycaster.ray.intersectPlane(waterPlane, new THREE.Vector3()); }

// ================= 输入 =================
let zoom = 1;
const pointers = new Map();
let down = null, pinchStart = 0, pinchZoom = 1;
const canvas = renderer.domElement;

canvas.addEventListener('pointerdown', e => {
  sfx.init();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), multi: false, button: e.button };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinchZoom = zoom;
    if (down) down.multi = true;
  }
});
canvas.addEventListener('pointermove', e => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.has = e.pointerType === 'mouse';
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinchStart > 0) {
    const [a, b] = [...pointers.values()];
    zoom = THREE.MathUtils.clamp(pinchZoom * pinchStart / Math.hypot(a.x - b.x, a.y - b.y), ZMIN, ZMAX);
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  const click = pointers.size === 0 && down && !down.multi && e.type === 'pointerup'
    && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && performance.now() - down.t < 600;
  if (click && down.button === 2) {
    const h = rayHit(e.clientX, e.clientY);
    if (h) removeVoxel(h.v);
  } else if (click) {
    const c = pickCell(e.clientX, e.clientY);
    if (c && lastPickDist < TAP_FAR) addVoxel(c.x, c.y, c.z, c.from ? c.from.inst : null);
    else if (voxels.length) { const wp = waterPoint(e.clientX, e.clientY); if (wp) waterTap(wp.x, wp.z); }
    hintEl.style.opacity = 0;
  }
  if (pointers.size === 0) down = null;
  if (pointers.size < 2) pinchStart = 0;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { pointer.has = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.0012), ZMIN, ZMAX); }, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  sfx.init();
  if (e.key === 'z' || e.key === 'Z') removeLast();
  if (e.key === 'r' || e.key === 'R') resetAll();
  if (e.key === ' ' && voxels.length) {
    e.preventDefault();
    const d = new THREE.Vector3(VIEW_DIR.x, 0, VIEW_DIR.z).normalize().multiplyScalar(spanR + 2.5);
    waterTap(view.x + d.x, view.z + d.z);
  }
  if (e.key === 'm' || e.key === 'M') sndEl.textContent = sfx.toggle() ? '声音开' : '声音关';
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

export { ghost, ghostEdges, raycaster, ndc, invM, pointer, lastPickDist, waterPlane, setRay, rayHit, pickCell, waterPoint, zoom, pointers, down, pinchStart, pinchZoom, canvas, endPointer };
