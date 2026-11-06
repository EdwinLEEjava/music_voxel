import * as THREE from 'three';
import { RIPPLE_N, WATER_SIZE, WATER_Y } from './config.js';
import { scene } from './core.js';

// ================= 水：共享的波浪函数（水面与方块共用，保证水线一致） =================
const U = {
  uTime: { value: 0 },
  uWaterY: { value: WATER_Y },
  // 雾：按到结构中心的水平距离计算（不受镜头缩放影响），水面和方块共用
  uCenter: { value: new THREE.Vector2() },
  uFogNear: { value: 4 }, uFogFar: { value: 10 },
  uFogCol: { value: new THREE.Color(0, 0, 0) },
  uProg: { value: 0 },             // 世界被点亮的程度（0 开局 → 1 全部发现），跟着冲击波同步
  uRip: { value: Array.from({ length: RIPPLE_N }, () => new THREE.Vector4(0, 0, -99, 0)) }, // x, z, 开始时间, 强度
};
let ripIdx = 0;
function addRipple(x, z, amp) {
  U.uRip.value[ripIdx].set(x, z, U.uTime.value, amp);
  ripIdx = (ripIdx + 1) % RIPPLE_N;
}

const WAVE_GLSL = /* glsl */`
uniform float uTime;
uniform float uWaterY;
uniform vec4 uRip[${RIPPLE_N}];
// 平滑值噪声：用来打破规则正弦波的重复感
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
// 水面高度：两层缓慢漂移的噪声涌浪 + 几道方向、波长都不同的长波
float waveBase(vec2 p) {
  float t = uTime, h = 0.0;
  h += 0.16 * vnoise(p * 0.16 + vec2( t * 0.10,  t * 0.06));
  h += 0.07 * vnoise(p * 0.38 + vec2(-t * 0.17,  t * 0.13) + 7.3);
  h += 0.06 * sin(dot(p, vec2( 0.80, 0.60)) * 0.55 + t * 0.70);
  h += 0.04 * sin(dot(p, vec2(-0.45, 0.89)) * 0.83 + t * 0.95 + 1.7);
  h += 0.025 * sin(dot(p, vec2( 0.97,-0.24)) * 1.31 + t * 1.30 + 4.1);
  return h;
}
float ripples(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${RIPPLE_N}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 7.0 || r.w <= 0.0) continue;
    float d = length(p - r.xy);
    float front = age * 2.2;
    float df = d - front;
    float env = exp(-df * df * 0.18) * exp(-age * 0.55);
    h += r.w * 0.9 * env * sin(df * 2.4);   // 波长约 2.6 格，能被低多边形网格清晰表现
  }
  return h;
}
float waterH(vec2 p) { return waveBase(p) + ripples(p); }
float caustic(vec2 p) {
  float t = uTime * 0.8;
  vec2 q = p * 1.6;
  float c = sin(q.x + t + sin(q.y * 1.3 + t * 0.7))
          + sin(q.y * 1.1 - t * 0.9 + sin(q.x * 1.7 - t * 0.5))
          + sin((q.x + q.y) * 0.8 + t * 1.2);
  c = abs(c) / 3.0;
  return pow(1.0 - c, 6.0);
}
`;

const HASH_GLSL = /* glsl */`
float hashP(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
`;

// —— 水面 ——
const waterMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    ...U,
    uColorful: { value: 0 },
    uColPrev: { value: 0 },
    uBloom: { value: new THREE.Vector4(0, 0, -99, 0) },   // 色彩冲击波：x, z, 开始时间, 速度
    uBloomCol: { value: new THREE.Color(0.85, 0.9, 1.0) },   // 冲击波光环：统一的月白色
    uGlint: { value: new THREE.Vector3(-0.55, 0.47, -0.69).normalize() },
  },
  // 低多边形：顶点在 GPU 上按波浪抬升；片元里用屏幕导数求“三角面”法线，
  // 同一个三角形内法线恒定 → 每个面一个颜色，形成切面感
  vertexShader: /* glsl */`
    ${WAVE_GLSL}
    varying vec3 vWP;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      wp.y = uWaterY + waterH(wp.xz);
      vWP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    ${WAVE_GLSL}
    ${HASH_GLSL}
    uniform vec3 uGlint;
    uniform vec3 uKey;
    uniform float uColorful;
    uniform float uColPrev;
    uniform vec4 uBloom;
    uniform vec3 uBloomCol;
    uniform vec2 uCenter;
    uniform float uFogNear, uFogFar;
    varying vec3 vWP;
    void main() {
      vec3 N = normalize(cross(dFdx(vWP), dFdy(vWP)));
      if (N.y < 0.0) N = -N;
      vec3 V = normalize(cameraPosition - vWP);

      // 低角度主光：让微小的坡度差也能拉开面与面之间的明暗
      float lamb = dot(N, uKey);
      float shade = clamp((lamb - 0.42) * 1.8 + 0.5, 0.0, 1.0);
      // 世界的“色彩度”：从黑白慢慢过渡到深蓝青的夜海
      // 色彩冲击波：波前以内是新颜色，以外还是旧颜色；波前本身是一圈柔和的光环
      float bAge = uTime - uBloom.z;
      float bd = length(vWP.xz - uBloom.xy) - bAge * uBloom.w;
      float cf = mix(uColPrev, uColorful, smoothstep(1.5, -1.5, bd));
      vec3 lo = mix(vec3(0.035), vec3(0.010, 0.040, 0.068), cf);
      vec3 hi = mix(vec3(0.085), vec3(0.030, 0.120, 0.165), cf);
      vec3 col = mix(lo, hi, shade);

      // 整面闪光：朝向“月光”的那些三角面整块亮起
      float s = max(dot(reflect(-uGlint, N), V), 0.0);
      // 月夜渐明：越往后月光越亮
      col += mix(vec3(1.0), vec3(1.0, 0.88, 0.68), uColorful) * (pow(s, 16.0) * 0.16 + pow(s, 4.0) * 0.03) * (1.0 + 1.3 * cf);

      // 星光倒影：零星的三角面一闪一闪，纯白；随世界被点亮而出现（冲击波扫过才有）
      vec2 sc = floor(vWP.xz * 2.5);
      float st = step(mix(0.99, 0.962, cf), hashP(sc)) * pow(0.5 + 0.5 * sin(uTime * (1.5 + hashP(sc + 7.0) * 2.5) + hashP(sc + 3.0) * 6.28), 3.0);
      col += vec3(st * 0.22 * min(1.0, cf * 1.6));

      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      col += fres * 0.05;
      // 光环：前沿亮、后面拖一条渐暗的尾巴，随时间整体淡出
      if (bAge > 0.0 && bAge < 9.0) {
        float ring = bd > 0.0 ? exp(-bd * bd * 1.2) : exp(bd * 0.35);
        col += uBloomCol * ring * (0.28 + 0.25 * shade) * exp(-bAge * 0.35);
      }

      float fade = 1.0 - smoothstep(uFogNear, uFogFar, length(vWP.xz - uCenter));
      gl_FragColor = vec4(col, (0.82 + fres * 0.15) * fade);
    }`,
});
waterMat.uniforms.uKey = { value: new THREE.Vector3(-0.75, 0.55, -0.35).normalize() };

// 固定世界尺寸的网格（每格约 1 个方块宽），顶点随机错位 → 不规则三角面
const waterGeo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SIZE, WATER_SIZE).rotateX(-Math.PI / 2);
{
  const pa = waterGeo.attributes.position;
  const half = WATER_SIZE / 2 - 0.5;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i);
    if (Math.abs(x) >= half || Math.abs(z) >= half) continue;
    pa.setX(i, x + (Math.random() - 0.5) * 0.7);
    pa.setZ(i, z + (Math.random() - 0.5) * 0.7);
  }
}
const water = new THREE.Mesh(waterGeo, waterMat);
water.frustumCulled = false;
water.renderOrder = 10;
scene.add(water);

// —— 让方块知道自己在水下：越深越暗、带焦散光纹，水线处有一圈亮边 ——
function makeUnderwater(material) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWP = (modelMatrix * wp4).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform vec2 uCenter;\nuniform float uFogNear, uFogFar, uProg;\nuniform vec3 uFogCol;\n' + WAVE_GLSL)
      .replace('#include <fog_fragment>', `
        float depth = (uWaterY + waterH(vWP.xz)) - vWP.y;
        if (depth > 0.0) {
          // 月夜渐明：越往后水越通透，水下方块越清楚、焦散越明显
          float k = exp(-depth * mix(0.22, 0.10, uProg));
          float c = caustic(vWP.xz + vWP.y * 0.3);
          gl_FragColor.rgb = gl_FragColor.rgb * (0.35 + 0.65 * k) + c * mix(0.45, 0.7, uProg) * k;
        }
        gl_FragColor.rgb += (1.0 - smoothstep(0.0, 0.04, abs(depth))) * 0.45;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, smoothstep(uFogNear, uFogFar, length(vWP.xz - uCenter)));`);
  };
}

export { U, ripIdx, addRipple, WAVE_GLSL, waterMat, waterGeo, water, makeUnderwater };
