import * as THREE from 'three';
import { RIPPLE_N, WATER_SIZE, WATER_Y } from './config.js';
import { scene } from './core.js';

// ================= 水：共享的波浪函数（水面与方块共用，保证水线一致） =================
const U = {
  uTime: { value: 0 },
  uWaterY: { value: WATER_Y },
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

// —— 水面 ——
const waterMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    ...U,
    uFade: { value: 30 },
    uColorful: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
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
    uniform float uFade;
    uniform vec3 uGlint;
    uniform vec3 uKey;
    uniform float uColorful;
    uniform vec2 uCenter;
    varying vec3 vWP;
    void main() {
      vec3 N = normalize(cross(dFdx(vWP), dFdy(vWP)));
      if (N.y < 0.0) N = -N;
      vec3 V = normalize(cameraPosition - vWP);

      // 低角度主光：让微小的坡度差也能拉开面与面之间的明暗
      float lamb = dot(N, uKey);
      float shade = clamp((lamb - 0.42) * 1.8 + 0.5, 0.0, 1.0);
      // 世界的“色彩度”：从黑白慢慢过渡到深蓝青的夜海
      vec3 lo = mix(vec3(0.035), vec3(0.010, 0.040, 0.068), uColorful);
      vec3 hi = mix(vec3(0.085), vec3(0.030, 0.120, 0.165), uColorful);
      vec3 col = mix(lo, hi, shade);

      // 整面闪光：朝向“月光”的那些三角面整块亮起
      float s = max(dot(reflect(-uGlint, N), V), 0.0);
      col += mix(vec3(1.0), vec3(1.0, 0.88, 0.68), uColorful) * (pow(s, 16.0) * 0.16 + pow(s, 4.0) * 0.03);

      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      col += fres * 0.05;

      float fade = 1.0 - smoothstep(uFade * 0.35, uFade, length(vWP.xz - uCenter));
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
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\n' + WAVE_GLSL)
      .replace('#include <fog_fragment>', `
        float depth = (uWaterY + waterH(vWP.xz)) - vWP.y;
        if (depth > 0.0) {
          float k = exp(-depth * 0.22);
          float c = caustic(vWP.xz + vWP.y * 0.3);
          gl_FragColor.rgb = gl_FragColor.rgb * (0.35 + 0.65 * k) + c * 0.45 * k;
        }
        gl_FragColor.rgb += (1.0 - smoothstep(0.0, 0.04, abs(depth))) * 0.45;
        #include <fog_fragment>`);
  };
}

export { U, ripIdx, addRipple, WAVE_GLSL, waterMat, waterGeo, water, makeUnderwater };
