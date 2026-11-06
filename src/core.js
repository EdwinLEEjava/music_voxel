import * as THREE from 'three';

// ================= 场景 =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 20, 60);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
const VIEW_DIR = new THREE.Vector3(1, 0.85, 1.25).normalize();   // 固定视角方向

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
scene.add(new THREE.HemisphereLight(0xffffff, 0x111111, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 10, 6);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xffffff, 0.35);
rim.position.set(-6, -2, -5);
scene.add(rim);

const clock = new THREE.Clock();

export { renderer, scene, camera, VIEW_DIR, sun, rim, clock };
