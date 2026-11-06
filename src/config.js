import * as THREE from 'three';

// ================= 可调参数（集中在这里修改） =================

const WATER_Y = 0.15;
const RIPPLE_N = 8;
const WATER_SIZE = 240;
const GROW_MAX = 64;
const TOWER_MIN = 4;              // 灯塔最少格数
// 各类建筑的门槛（调低一些，让玩家更早获得第一次发现）
const NEED = { anchor: 4, anchorDepth: -3, bridge: 6, stair: 3 };
const MILESTONES = [10, 25, 50, 100, 200, 400];   // 结构长到这些方块数时，海给一次回应
const WAVE_SPEED = 2.2;            // 与涟漪扩散速度一致
const ECHO_GAP = 0.3;              // 回响中相邻两个音的间隔
const VOXEL_COOLDOWN = 0.4;        // 同一方块两次发声的最短间隔
const NOTE_WINDOW = 0.15, NOTE_WINDOW_MAX = 5;   // 每 0.15 秒最多 5 个音
const TAP_FAR = 2.2;                 // 点击处离结构超过这个距离 → 敲水
const ZMIN = 0.35, ZMAX = 3;
const WHITE = new THREE.Color(1, 1, 1);
const PAL = {
  towerRed: new THREE.Color(0xc8402f), towerWhite: new THREE.Color(0xf2efe8), lamp: new THREE.Color(0xffd34d),
  ring: new THREE.Color(0x5aa9c9),
  archStone: new THREE.Color(0xbfae92), archBeam: new THREE.Color(0x8c5c3c), keystone: new THREE.Color(0xd9b45a),
  bridge: new THREE.Color(0xa0714a), platform: new THREE.Color(0xdccca4),
  anchor: new THREE.Color(0x4a5868), anchorTip: new THREE.Color(0x2a3038), stair: new THREE.Color(0x9fb59a),
};
const INST = {
  bell:    { col: new THREE.Color(0xf2c14e), name: '管钟' },
  glass:   { col: new THREE.Color(0x7fd6e8), name: '钢片琴' },
  pluck:   { col: new THREE.Color(0xe08a5a), name: '吉他' },
  marimba: { col: new THREE.Color(0xd2a86e), name: '马林巴' },
  pad:     { col: new THREE.Color(0xc3b2e6), name: '弦乐' },
  bass:    { col: new THREE.Color(0x4f7fd0), name: '贝斯' },
  harp:    { col: new THREE.Color(0xa6d98f), name: '竖琴' },
};
const INST_TINT = 0.35;              // 乐器方块组成建筑时，混入乐器颜色的比例（0 = 纯建筑配色，1 = 纯乐器颜色）
const TYPE_INST = { tower: 'bell', ring: 'glass', arch: 'pluck', bridge: 'marimba', platform: 'pad', anchor: 'bass', stair: 'harp' };
const SEED_SHAPES = [
  [[0,0,0],[1,0,0],[0,0,1]], [[0,0,0],[1,0,0],[0,1,0]], [[0,0,0],[0,0,1],[0,1,0],[0,1,1]], [[0,0,0],[1,0,0],[2,0,0]],
];

export { NEED, MILESTONES, WATER_Y, RIPPLE_N, WATER_SIZE, GROW_MAX, TOWER_MIN, WAVE_SPEED, ECHO_GAP, VOXEL_COOLDOWN, NOTE_WINDOW, NOTE_WINDOW_MAX, TAP_FAR, ZMIN, ZMAX, WHITE, PAL, INST, INST_TINT, TYPE_INST, SEED_SHAPES };
