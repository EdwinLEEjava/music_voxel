import * as THREE from 'three';
import { WATER_Y } from './config.js';
import { clock, scene } from './core.js';
import { addRipple, makeUnderwater } from './water.js';
import { spanR, viewTarget, voxels } from './world.js';
import { panOf, sfx } from './audio.js';

// ================= 陪伴者：一条在水面下游动的小鱼 =================
// 平时绕着结构慢慢转圈；玩家放置方块或敲水时游过去看看，到了冒个泡，再回去转圈
const mat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, emissive: 0x6a7c90, emissiveIntensity: 0.5, roughness: 0.5 });
makeUnderwater(mat);
const fish = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.22), mat);
const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, 0.17), mat);
head.position.x = 0.3;
const tailPivot = new THREE.Group();
tailPivot.position.x = -0.25;
const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.04), mat);
tail.position.x = -0.1;
tailPivot.add(tail);
fish.add(body, head, tailPivot);
fish.scale.setScalar(0.85);
fish.renderOrder = 5;          // 先于水面绘制，看起来在水下
fish.visible = false;
scene.add(fish);

const pos = new THREE.Vector3(3, WATER_Y - 0.4, 3), vel = new THREE.Vector3();
let heading = 0, orbitA = 0, visit = null, visitUntil = 0, greeted = true;
const SPEED = 1.1, VISIT_SPEED = 2.4;

// 玩家在 (x, z) 有动作：游过去看看
function notice(x, z) {
  visit = new THREE.Vector3(x, 0, z);
  visitUntil = clock.elapsedTime + 5;
  greeted = false;
}

function updateCompanion(t, dt) {
  if (!voxels.length) { fish.visible = false; return; }
  if (!fish.visible) { pos.set(viewTarget.x + spanR + 3, WATER_Y - 0.4, viewTarget.z); fish.visible = true; }

  // 目标：要么是玩家刚动过的地方，要么是绕结构的圆上一点
  let target, speed;
  if (visit && t < visitUntil) { target = visit; speed = VISIT_SPEED; }
  else {
    visit = null;
    orbitA += dt * 0.18;
    const r = spanR + 2.5 + Math.sin(t * 0.3) * 0.8;
    target = new THREE.Vector3(viewTarget.x + Math.cos(orbitA) * r, 0, viewTarget.z + Math.sin(orbitA) * r);
    speed = SPEED;
  }
  const to = new THREE.Vector3(target.x - pos.x, 0, target.z - pos.z), dist = to.length();
  // 到了玩家放置的地方：冒个泡、轻响一声，然后回去转圈
  if (visit && dist < 0.9 && !greeted) {
    greeted = true; visitUntil = t + 1.2;
    addRipple(pos.x, pos.z, 0.06);
    sfx.tiny(panOf(pos));
  }
  const want = dist > 0.05 ? Math.atan2(-to.z, to.x) : heading;
  let dh = want - heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  heading += dh * Math.min(1, dt * 3);
  const v = speed * Math.min(1, dist / 1.5);
  vel.set(Math.cos(heading) * v, 0, -Math.sin(heading) * v);
  pos.addScaledVector(vel, dt);
  pos.y = WATER_Y - 0.4 + Math.sin(t * 1.3) * 0.08;

  fish.position.copy(pos);
  fish.rotation.set(0, heading, Math.sin(t * 1.3) * 0.08);
  tailPivot.rotation.y = Math.sin(t * (6 + v * 4)) * 0.5;   // 游得越快，尾巴摆得越快
}

export { fish, notice, updateCompanion };
