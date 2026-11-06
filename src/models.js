import * as THREE from 'three';
import { makeUnderwater } from './water.js';

// ================= 小体素模型：房子、船、灯 =================
// 在比游戏方块更细的网格里“填方块”，只生成露在外面的面，按格子着色，合并成一个网格，
// 让所有道具都和游戏的方块是同一种体素风格。模型都是灰色，带水下与雾的效果
const MC = h => new THREE.Color(h);
const MODEL_FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

// 体素画板：box() 填格子、del() 挖掉，build() 生成网格
class VoxelSketch {
  constructor() { this.cells = new Map(); }
  box(x0, y0, z0, x1, y1, z1, col) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.cells.set(x + ',' + y + ',' + z, col);
    return this;
  }
  del(x0, y0, z0, x1, y1, z1) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.cells.delete(x + ',' + y + ',' + z);
    return this;
  }
  // s：一个小格子的边长（游戏方块 = 1）；ox / oy / oz：小格子坐标里的原点
  geometry(s, ox = 0, oy = 0, oz = 0) {
    const P = [], N = [], Cl = [], I = [];
    for (const [k, col] of this.cells) {
      const [x, y, z] = k.split(',').map(Number);
      for (const f of MODEL_FACES) {
        if (this.cells.has((x + f.n[0]) + ',' + (y + f.n[1]) + ',' + (z + f.n[2]))) continue;
        const base = P.length / 3;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          P.push((x - ox + (f.n[0] + f.u[0] * su + f.v[0] * sv) * 0.5) * s,
                 (y - oy + (f.n[1] + f.u[1] * su + f.v[1] * sv) * 0.5) * s,
                 (z - oz + (f.n[2] + f.u[2] * su + f.v[2] * sv) * 0.5) * s);
          N.push(...f.n); Cl.push(col.r, col.g, col.b);
        }
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cl, 3));
    g.setIndex(I);
    return g;
  }
}
const modelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 });
makeUnderwater(modelMat);
const mesh = g => new THREE.Mesh(g, modelMat);

// 房子：w × d 个方块大小，墙高 h 个方块；台阶状的坡屋顶、烟囱、凹进去的门和窗
const HOUSE = { wall: MC(0x8f9296), roof: MC(0x63666b), dark: MC(0x3f4247), chimney: MC(0x55585d) };
function voxelHouse({ w, d, h }) {
  const R = 8, W = w * R, D = d * R, H = Math.round(h * R), sk = new VoxelSketch();
  sk.box(0, 0, 0, W - 1, H - 1, D - 1, HOUSE.wall);
  // 门（前面 +z）与窗（右面 +x）：挖进去一格，里面是深色
  const dx = Math.floor(W / 2) - 1;
  sk.del(dx, 0, D - 1, dx + 2, 4, D - 1).box(dx, 0, D - 2, dx + 2, 4, D - 2, HOUSE.dark);
  const wz = Math.floor(D / 2) - 1, wy = Math.floor(H * 0.55) - 1;
  sk.del(W - 1, wy, wz, W - 1, wy + 2, wz + 2).box(W - 2, wy, wz, W - 2, wy + 2, wz + 2, HOUSE.dark);
  // 坡屋顶：沿 x 方向的屋脊，每升一层两边各收进一格，四周出檐一格
  for (let k = 0; ; k++) {
    const z0 = -1 + k, z1 = D - k;
    if (z0 > z1) break;
    sk.box(-1, H + k, z0, W, H + k, z1, HOUSE.roof);
  }
  // 烟囱
  const cx = Math.floor(W * 0.7), cz = Math.floor(D * 0.25);
  sk.box(cx, H, cz, cx + 1, H + Math.ceil(D / 2) + 2, cz + 1, HOUSE.chimney);
  return mesh(sk.geometry(1 / R, (W - 1) / 2, -0.5, (D - 1) / 2));   // 底面贴地，水平居中
}

// 船：分层的船身、一圈船舷（看得出是空心的）、船舱、桅杆；船头朝 +z
const BOAT = { hull: MC(0x6a6d72), rim: MC(0x8a8d91), deck: MC(0x55585d), cabin: MC(0x9a9da2), roof: MC(0x63666b), mast: MC(0x5d6065) };
function voxelBoat() {
  const sk = new VoxelSketch();
  sk.box(1, 0, 1, 3, 0, 10, BOAT.hull);                 // 船底
  sk.box(0, 1, 0, 4, 1, 11, BOAT.hull);                 // 船身
  sk.box(2, 1, 12, 2, 1, 12, BOAT.hull);                // 船头尖
  sk.box(0, 2, 0, 4, 2, 11, BOAT.rim).del(1, 2, 1, 3, 2, 10);   // 船舷
  sk.box(1, 1, 1, 3, 1, 10, BOAT.deck);                 // 甲板
  sk.box(1, 2, 2, 3, 4, 5, BOAT.cabin);                 // 船舱
  sk.box(0, 5, 1, 4, 5, 6, BOAT.roof);
  sk.box(2, 2, 8, 2, 10, 8, BOAT.mast);                 // 桅杆
  return mesh(sk.geometry(1 / 8, 2, 1.5, 6));
}

// 灯：底座、四根立柱、灯罩（单独一块，点亮时换成发光材质）、顶盖；占一个方块，中心在格子中心
const LAMP = { frame: MC(0x5d6065), glass: MC(0x9a9da2) };
function voxelLamp() {
  const R = 10, frame = new VoxelSketch(), glass = new VoxelSketch();
  frame.box(2, 0, 2, 7, 0, 7, LAMP.frame);                                // 底座
  for (const [x, z] of [[2, 2], [7, 2], [2, 7], [7, 7]]) frame.box(x, 1, z, x, 4, z, LAMP.frame);   // 立柱
  frame.box(2, 5, 2, 7, 5, 7, LAMP.frame).box(3, 6, 3, 6, 6, 6, LAMP.frame).box(4, 7, 4, 5, 7, 5, LAMP.frame);   // 顶盖
  glass.box(3, 1, 3, 6, 4, 6, LAMP.glass);                                // 灯罩
  const g = new THREE.Group(), gm = mesh(glass.geometry(1 / R, 4.5, 4.5, 4.5));
  g.add(mesh(frame.geometry(1 / R, 4.5, 4.5, 4.5)), gm);
  g.userData.glass = gm;
  return g;
}

export { VoxelSketch, voxelHouse, voxelBoat, voxelLamp };
