import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Fable Frontier: NIGHTFALL — open-world horror FPS demo.
// Terrain, gun, particles and audio are procedural; ground textures are
// AI-generated (Higgsfield); dead trees are CC0 photoscans (Poly Haven);
// enemies are CC0 rigged skeletons (KayKit) that walk out of the fog.
// ---------------------------------------------------------------------------

const WORLD_SIZE = 600;
const WORLD_BOUND = 285;
const WATER_LEVEL = -6;
const EYE_HEIGHT = 1.7;
const GRAVITY = 22;

// ------------------------------------------------------------------ noise --
function hash2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  let f = 0, amp = 1, freq = 1, tot = 0;
  for (let i = 0; i < 4; i++) {
    f += noise2(x * freq, z * freq) * amp;
    tot += amp; amp *= 0.5; freq *= 2.1;
  }
  return f / tot;
}
function terrainHeight(x, z) {
  const h = (fbm(x * 0.008 + 13.7, z * 0.008 + 7.3) - 0.5) * 44
          + (fbm(x * 0.035 + 41.2, z * 0.035 + 3.9) - 0.5) * 6;
  const d = Math.hypot(x, z);
  return h * THREE.MathUtils.smoothstep(d, 18, 70);
}

// ------------------------------------------------------------------ scene --
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.shadowMap.enabled = !new URLSearchParams(location.search).has('noshadow');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('app').appendChild(renderer.domElement);

const NIGHT = new THREE.Color(0x05070c);
const scene = new THREE.Scene();
scene.background = NIGHT;
scene.fog = new THREE.Fog(0x06080d, 8, 95);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);

// moonlight — dim, cold, no shadows (the flashlight owns the shadows)
const hemi = new THREE.HemisphereLight(0x27334a, 0x0b0d10, 0.4);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x93a7cc, 0.4);
moon.position.set(-120, 160, -80);
scene.add(moon);

// moon disc + stars (unaffected by fog)
{
  const moonMesh = new THREE.Mesh(
    new THREE.CircleGeometry(14, 32),
    new THREE.MeshBasicMaterial({ color: 0xdde6f5, fog: false }));
  moonMesh.position.set(-260, 320, -180);
  moonMesh.lookAt(0, 0, 0);
  scene.add(moonMesh);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: 0x8fa3c8, transparent: true, opacity: 0.18, fog: false }));
  glow.position.copy(moonMesh.position).multiplyScalar(1.002);
  glow.lookAt(0, 0, 0);
  scene.add(glow);

  const starPos = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const az = Math.random() * Math.PI * 2;
    const el = Math.random() * Math.PI * 0.45 + 0.08;
    starPos[i * 3] = Math.cos(el) * Math.cos(az) * 800;
    starPos[i * 3 + 1] = Math.sin(el) * 800;
    starPos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * 800;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcdd8ee, size: 1.6, sizeAttenuation: false, fog: false,
    transparent: true, opacity: 0.75,
  })));
}

// flashlight
const flashlight = new THREE.SpotLight(0xffe9c2, 380, 65, 0.46, 0.45, 1.9);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.4;
flashlight.shadow.camera.far = 65;
flashlight.shadow.bias = -0.004;
flashlight.position.set(0.1, -0.05, 0);
camera.add(flashlight, flashlight.target);
flashlight.target.position.set(0, -0.06, -1);

// ---- AI-generated PBR textures (Higgsfield, post-processed to seamless) ----
const texLoader = new THREE.TextureLoader();
const ANISO = new URLSearchParams(location.search).has('noaniso')
  ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy());
function loadTex(file, repeat, srgb = true) {
  const t = texLoader.load(`assets/textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {
  grassBC: loadTex('grass_basecolor.jpg', [110, 110]),
  grassN: loadTex('grass_normal.jpg', [110, 110], false),
  rockBC: loadTex('rock_basecolor.jpg'),
  rockN: loadTex('rock_normal.jpg', null, false),
  sandBC: loadTex('sand_basecolor.jpg'),
  sandN: loadTex('sand_normal.jpg', null, false),
  concreteBC: loadTex('concrete_basecolor.jpg'),
  concreteN: loadTex('concrete_normal.jpg', null, false),
  metalBC: loadTex('metal_basecolor.jpg'),
  metalN: loadTex('metal_normal.jpg', null, false),
  waterN: loadTex('sand_normal.jpg', [50, 50], false),
};

// --------------------------------------------------------------- terrain --
const SEG = 150;
const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 4);   // grass / rock / sand / snow
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const e = 1.5;
    const slope = Math.abs(terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e)
                + Math.abs(terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    const sandW = y < WATER_LEVEL + 2.5 ? THREE.MathUtils.smoothstep(WATER_LEVEL + 2.5 - y, 0, 2.5) : 0;
    const rockW = THREE.MathUtils.smoothstep(slope, 0.4, 0.85) * (1 - sandW);
    const snowW = y > 13 ? THREE.MathUtils.smoothstep(y, 13, 19) * (1 - rockW * 0.4) : 0;
    const grassW = Math.max(0, 1 - sandW - rockW - snowW);
    splat[i * 4] = grassW; splat[i * 4 + 1] = rockW;
    splat[i * 4 + 2] = sandW; splat[i * 4 + 3] = snowW;
    const v = 0.8 + 0.2 * noise2(x * 0.05 + 5.1, z * 0.05 + 9.4);
    colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v * 0.98;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  terrainGeo.computeVertexNormals();
}
const terrainMat = new THREE.MeshStandardMaterial({
  map: TEX.grassBC, normalMap: TEX.grassN, vertexColors: true,
  roughness: 0.95, metalness: 0,
});
terrainMat.normalScale.set(0.9, 0.9);
terrainMat.onBeforeCompile = (shader) => {
  shader.uniforms.rockMap = { value: TEX.rockBC };
  shader.uniforms.rockNormalMap = { value: TEX.rockN };
  shader.uniforms.sandMap = { value: TEX.sandBC };
  shader.uniforms.sandNormalMap = { value: TEX.sandN };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform sampler2D rockMap;
uniform sampler2D rockNormalMap;
uniform sampler2D sandMap;
uniform sampler2D sandNormalMap;
varying vec4 vSplat;
vec4 splatW;`)
    .replace('#include <map_fragment>', `
splatW = vSplat / max(vSplat.x + vSplat.y + vSplat.z + vSplat.w, 1e-4);
vec4 texMix = texture2D(map, vMapUv) * splatW.x
            + texture2D(rockMap, vMapUv * 0.35) * splatW.y
            + texture2D(sandMap, vMapUv * 0.6) * splatW.z
            + vec4(0.85, 0.87, 0.92, 1.0) * splatW.w;
diffuseColor *= texMix;`)
    .replace('#include <normal_fragment_maps>', `
vec3 mapN = ( texture2D(normalMap, vNormalMapUv).xyz * (splatW.x + splatW.w)
            + texture2D(rockNormalMap, vNormalMapUv * 0.35).xyz * splatW.y
            + texture2D(sandNormalMap, vNormalMapUv * 0.6).xyz * splatW.z ) * 2.0 - 1.0;
mapN.xy *= normalScale;
normal = normalize( tbn * mapN );`);
};
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

// black still water
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE * 1.4, WORLD_SIZE * 1.4),
  new THREE.MeshStandardMaterial({
    color: 0x0a1420, transparent: true, opacity: 0.88,
    roughness: 0.1, metalness: 0.55,
    normalMap: TEX.waterN, normalScale: new THREE.Vector2(0.25, 0.25),
  }));
water.rotation.x = -Math.PI / 2;
water.position.y = WATER_LEVEL;
scene.add(water);

// ----------------------------------------------------------------- props --
function scatter(count, minDist, test) {
  const spots = [];
  let guard = 0;
  while (spots.length < count && guard++ < count * 40) {
    const x = (Math.random() * 2 - 1) * (WORLD_SIZE / 2 - 20);
    const z = (Math.random() * 2 - 1) * (WORLD_SIZE / 2 - 20);
    if (Math.hypot(x, z) < minDist) continue;
    const y = terrainHeight(x, z);
    if (test && !test(x, y, z)) continue;
    spots.push({ x, y, z });
  }
  return spots;
}
function slopeAt(x, z) {
  const e = 1.5;
  return Math.abs(terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e)
       + Math.abs(terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
}

// rocks
{
  const spots = scatter(90, 24, (x, y) => y > WATER_LEVEL + 0.5);
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ map: TEX.rockBC, normalMap: TEX.rockN, roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, spots.length);
  rocks.castShadow = rocks.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  spots.forEach((p, i) => {
    q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
    s.set(0.6 + Math.random() * 2.2, 0.5 + Math.random() * 1.2, 0.6 + Math.random() * 2.2);
    m.compose(new THREE.Vector3(p.x, p.y + 0.1, p.z), q, s);
    rocks.setMatrixAt(i, m);
  });
  scene.add(rocks);
}

// abandoned outpost near spawn
const BUILDING_DEFS = [
  [28, 6, -34, 10, 5, 8], [40, 6, -26, 7, 8, 7], [33, 6, -18, 6, 4, 12],
  [-42, 6, 20, 9, 6, 9], [-34, 6, 30, 6, 10, 6],
];
{
  const concrete = new THREE.MeshStandardMaterial({ map: TEX.concreteBC, normalMap: TEX.concreteN, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ map: TEX.metalBC, normalMap: TEX.metalN, color: 0x8a8d92, roughness: 0.8 });
  const scaleBoxUV = (geo, w, h, d) => {
    const uv = geo.attributes.uv;
    const s = Math.max(w, d) / 3.5, t = Math.max(h, 3) / 3.5;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * t);
    return geo;
  };
  const outpost = new THREE.Group();
  for (const [x, , z, w, h, d] of BUILDING_DEFS) {
    const y = terrainHeight(x, z);
    const box = new THREE.Mesh(scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d), concrete);
    box.position.set(x, y + h / 2 - 0.3, z);
    box.castShadow = box.receiveShadow = true;
    outpost.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), dark);
    roof.position.set(x, y + h - 0.1, z);
    roof.castShadow = true;
    outpost.add(roof);
  }
  const ty = terrainHeight(0, -52);
  const legGeo = new THREE.CylinderGeometry(0.25, 0.3, 12, 6);
  for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(lx, ty + 6, -52 + lz);
    leg.castShadow = true;
    outpost.add(leg);
  }
  const cabin = new THREE.Mesh(scaleBoxUV(new THREE.BoxGeometry(5, 3, 5), 5, 3, 5), concrete);
  cabin.position.set(0, ty + 13.5, -52);
  cabin.castShadow = true;
  outpost.add(cabin);
  scene.add(outpost);
}

// -------------------------------------------------- asset loading (GLTF) --
const gltfLoader = new GLTFLoader();
function loadGLTF(url) {
  return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject));
}

const treeSpots = [];

// dead-tree forest from Poly Haven photoscans, instanced per submesh
async function plantForest() {
  // clustered inside the playable core so the fog line always has silhouettes
  const CORE = 175;
  const species = [
    { url: 'assets/models/quiver_tree_02.glb', count: 70, h: [4, 7.5] },      // standing dead trees
    { url: 'assets/models/dead_quiver_trunk.glb', count: 55, h: [2.5, 4.5] }, // bare snags
    { url: 'assets/models/dead_tree_trunk.glb', count: 30, h: [1.8, 2.8] },   // fallen logs
  ];
  const up = new THREE.Vector3(0, 1, 0);
  for (const sp of species) {
    const gltf = await loadGLTF(sp.url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    const baseH = Math.max(bbox.max.y - bbox.min.y, 0.001);
    const meshes = [];
    root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const spots = scatter(sp.count, 24,
      (x, y, z) => Math.hypot(x, z) < CORE && y > WATER_LEVEL + 1.2 && y < 13 && slopeAt(x, z) < 0.6);
    for (const p of spots) treeSpots.push(p);
    const spotMats = spots.map((p) => {
      const sc = THREE.MathUtils.lerp(sp.h[0], sp.h[1], Math.random()) / baseH;
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(p.x, p.y - 0.1 - bbox.min.y * sc, p.z),
        new THREE.Quaternion().setFromAxisAngle(up, Math.random() * Math.PI * 2),
        new THREE.Vector3(sc, sc, sc));
      return m;
    });
    for (const mesh of meshes) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, spotMats.length);
      inst.castShadow = inst.receiveShadow = true;
      const m = new THREE.Matrix4();
      spotMats.forEach((sm, i) => {
        m.multiplyMatrices(sm, mesh.matrixWorld);
        inst.setMatrixAt(i, m);
      });
      scene.add(inst);
    }
  }
}

// skeleton prototypes (KayKit, CC0) — cloned per enemy
const protos = {};
async function loadSkeletons() {
  // AI-generated analog-horror puppets (Higgsfield/Meshy image-to-3D, rigged
  // with an in-place stagger clip)
  const defs = [
    { key: 'hound', url: 'assets/models/creature_hound.glb', hp: 3, speed: 4.0, damage: 16, scale: 2.3 },
    { key: 'widow', url: 'assets/models/creature_widow.glb', hp: 6, speed: 3.1, damage: 26, scale: 2.05 },
    { key: 'crawler', url: 'assets/models/creature_crawler.glb', hp: 2, speed: 5.3, damage: 12, scale: 1.5 },
    { key: 'grinner', url: 'assets/models/creature_grinner.glb', hp: 4, speed: 3.6, damage: 20, scale: 2.0 },
    { key: 'stalker', url: 'assets/models/creature_stalker.glb', hp: 14, speed: 2.3, damage: 40, scale: 4.3, boss: true },
  ];
  for (const d of defs) {
    const gltf = await loadGLTF(d.url);
    gltf.scene.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    protos[d.key] = {
      ...d, scene: gltf.scene, clips: gltf.animations,
      height: bbox.max.y - bbox.min.y,
      footOff: -bbox.min.y,
    };
  }
}
function pickClip(clips, patterns) {
  for (const p of patterns) {
    const c = clips.find((cl) => p.test(cl.name));
    if (c) return c;
  }
  return null;
}

// -------------------------------------------------------------- particles --
const MAX_PARTICLES = 600;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
const pMat = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, depthWrite: false });
const pPoints = new THREE.Points(pGeo, pMat);
pPoints.frustumCulled = false;
scene.add(pPoints);
const particles = [];
function spawnBurst(pos, color, count, speed, life = 0.7) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) break;
    particles.push({
      pos: pos.clone(),
      vel: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8)),
      life: life * (0.5 + Math.random() * 0.5),
      color,
    });
  }
}
function updateParticles(dt) {
  const pos = pGeo.attributes.position, col = pGeo.attributes.color;
  let n = 0;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vel.y -= GRAVITY * 0.5 * dt;
    p.pos.addScaledVector(p.vel, dt);
    pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
    col.setXYZ(n, p.color.r, p.color.g, p.color.b);
    n++;
  }
  pGeo.setDrawRange(0, n);
  pos.needsUpdate = true; col.needsUpdate = true;
}

// ------------------------------------------------------------------ audio --
const audio = { ctx: null, ambient: false };
function initAudio() {
  if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  startAmbient();
  startBGM();
}
// AI-generated horror theme (Higgsfield sonilo_music), looped under the ambience
let bgmStarted = false;
async function startBGM() {
  if (bgmStarted || !audio.ctx) return;
  bgmStarted = true;
  try {
    const res = await fetch('assets/audio/nightfall_theme.m4a');
    if (!res.ok) return;
    const buf = await audio.ctx.decodeAudioData(await res.arrayBuffer());
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = audio.ctx.createGain();
    gain.gain.value = 0.28;
    src.connect(gain).connect(audio.ctx.destination);
    src.start();
  } catch (e) { /* BGM is optional — play on without it */ }
}
function startAmbient() {
  if (audio.ambient || !audio.ctx) return;
  audio.ambient = true;
  const ctx = audio.ctx;
  // low haunted drone: two detuned sines through a dark lowpass
  const master = ctx.createGain();
  master.gain.value = 0.055;
  master.connect(ctx.destination);
  for (const f of [54, 55.4, 108.5]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = f > 100 ? 0.25 : 1;
    osc.connect(g).connect(master);
    osc.start();
  }
  // wind: looped noise through a slowly wandering bandpass
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 1.6;
  const wg = ctx.createGain();
  wg.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 140;
  lfo.connect(lfoG).connect(bp.frequency);
  src.connect(bp).connect(wg).connect(ctx.destination);
  src.start(); lfo.start();
}
function playNoise(duration, freq, gainVal, sweepTo) {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}
function playTone(freq, duration, gainVal, type = 'square', sweepTo) {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + duration);
}
const sfx = {
  shoot: () => { playNoise(0.14, 2400, 0.5, 300); playTone(160, 0.08, 0.15, 'sawtooth'); },
  hit: () => { playNoise(0.08, 3200, 0.3); playTone(700, 0.05, 0.12, 'triangle'); },
  kill: () => { playNoise(0.45, 1400, 0.5, 150); playTone(90, 0.4, 0.2, 'sawtooth', 40); },
  hurt: () => { playTone(110, 0.25, 0.35, 'sawtooth', 55); playNoise(0.2, 500, 0.3); },
  reload: () => playTone(500, 0.1, 0.12, 'triangle'),
  groan: () => playTone(70 + Math.random() * 30, 0.9, 0.12, 'sawtooth', 45),
  scream: () => { playTone(900 + Math.random() * 300, 0.9, 0.18, 'sawtooth', 180); playNoise(0.5, 3000, 0.15, 500); },
  alarm: () => { playTone(660, 0.28, 0.25, 'square'); setTimeout(() => playTone(520, 0.28, 0.25, 'square'), 300); setTimeout(() => playTone(660, 0.28, 0.25, 'square'), 600); },
  attack: () => playNoise(0.18, 900, 0.3, 250),
  jump: () => playTone(300, 0.08, 0.08, 'triangle'),
  heartbeat: () => { playTone(48, 0.12, 0.5, 'sine'); setTimeout(() => playTone(44, 0.1, 0.35, 'sine'), 180); },
};

// -------------------------------------------------------------------- gun --
const gun = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({
    map: TEX.metalBC, normalMap: TEX.metalN,
    color: 0xb8bdc4, roughness: 0.5, metalness: 0.4,
    emissive: 0x2a2e35, emissiveIntensity: 0.25,
  });
  const accent = new THREE.MeshStandardMaterial({ color: 0xc75b32, roughness: 0.4, metalness: 0.3, emissive: 0x4a1f10 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), metal);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.42);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), metal);
  grip.position.set(0, -0.13, 0.12);
  grip.rotation.x = 0.3;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), accent);
  mag.position.set(0, -0.12, -0.06);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.1), accent);
  sight.position.set(0, 0.09, -0.1);
  gun.add(body, barrel, grip, mag, sight);
  gun.scale.setScalar(0.55);
  gun.position.set(0.24, -0.2, -0.5);
  camera.add(gun);
}
const muzzleFlash = new THREE.PointLight(0xffc266, 0, 14, 1.6);
muzzleFlash.position.set(0.26, -0.2, -1.0);
camera.add(muzzleFlash);
scene.add(camera);

// tracers
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true });
function spawnTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat.clone());
  line.userData.life = 0.07;
  scene.add(line);
  tracers.push(line);
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.userData.life -= dt;
    t.material.opacity = Math.max(t.userData.life / 0.07, 0);
    if (t.userData.life <= 0) {
      scene.remove(t);
      t.geometry.dispose(); t.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- enemies --
const enemies = [];
const enemyHitboxes = [];
const hitboxMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const hitboxGeo = new THREE.BoxGeometry(0.9, 1.75, 0.9);
const eyeGeoShared = new THREE.SphereGeometry(0.05, 8, 8);
const eyeMatShared = new THREE.MeshBasicMaterial({ color: 0xff2010 });

function pickEnemyType() {
  const w = state.wave;
  const stalkerUp = enemies.some((e) => e.type === 'stalker' && e.state !== 'dying');
  const table = [
    ['hound', 40],
    ['crawler', 22],
    ['grinner', 12 + w * 2],
    ['widow', 10 + w * 3],
    ['stalker', stalkerUp ? 0 : Math.min(3 + w * 2, 12)],   // one giant at a time
  ].filter(([k]) => protos[k]);
  const tot = table.reduce((s, [, x]) => s + x, 0);
  let r = Math.random() * tot;
  for (const [k, x] of table) { r -= x; if (r <= 0) return k; }
  return table[0][0];
}
function spawnEnemy(nearPos) {
  const keys = Object.keys(protos);
  if (!keys.length) return;
  const type = pickEnemyType();
  const proto = protos[type] || protos[keys[0]];
  const angle = Math.random() * Math.PI * 2;
  const dist = 38 + Math.random() * 32;
  const x = THREE.MathUtils.clamp(nearPos.x + Math.cos(angle) * dist, -WORLD_BOUND, WORLD_BOUND);
  const z = THREE.MathUtils.clamp(nearPos.z + Math.sin(angle) * dist, -WORLD_BOUND, WORLD_BOUND);

  const obj = SkeletonUtils.clone(proto.scene);
  const sc = proto.scale / Math.max(proto.height, 0.001);
  obj.scale.setScalar(sc);
  obj.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      // sickly grave-dirt recolor
      o.material = o.material.clone();
      if (o.material.color) o.material.color.setHex(0x8e937d);
      o.material.roughness = 1;
    }
  });
  // a faint red glow in the face — the only warm light on them
  const H = proto.height;
  const eyeGlow = new THREE.PointLight(0xff2015, proto.boss ? 4.5 : 2.0, proto.boss ? 9 : 5, 1.8);
  eyeGlow.position.set(0, -proto.footOff + H * 0.86, H * 0.1);
  obj.add(eyeGlow);
  const footY = proto.footOff * sc;   // world offset from obj origin to feet-on-ground
  const burial = proto.boss ? 4.4 : 2.4;
  obj.position.set(x, terrainHeight(x, z) + footY - burial, z);   // starts buried — rises from the grave

  const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
  const wf = Math.max(1, proto.scale / 2.3);   // beefier hitbox for the giant
  hitbox.scale.set(wf / sc, proto.scale / 1.75 / sc, wf / sc);
  hitbox.position.y = -proto.footOff + (proto.scale / 2) / sc;
  obj.add(hitbox);

  const mixer = new THREE.AnimationMixer(obj);
  const clips = proto.clips;
  const walkClip = pickClip(clips, [/^Walking_A/i, /walk/i, /stagger/i, /mummy/i, /^Running_A/i, /run/i])
    || clips[0] || null;
  const attackClip = pickClip(clips, [/1H_Melee_Attack_Chop/i, /Melee_Attack/i, /attack/i, /punch/i]);
  const deathClip = pickClip(clips, [/Death_A(?!_Pose)/i, /death(?!.*pose)/i]);
  const actions = {
    walk: walkClip ? mixer.clipAction(walkClip) : null,
    attack: attackClip ? mixer.clipAction(attackClip) : null,
    death: deathClip ? mixer.clipAction(deathClip) : null,
  };
  if (actions.walk) {
    actions.walk.timeScale = 0.9 + Math.random() * 0.35;
    actions.walk.play();
  }
  if (actions.attack) {
    actions.attack.setLoop(THREE.LoopOnce);
    actions.attack.clampWhenFinished = true;
  }
  if (actions.death) {
    actions.death.setLoop(THREE.LoopOnce);
    actions.death.clampWhenFinished = true;
  }
  scene.add(obj);
  spawnBurst(new THREE.Vector3(x, terrainHeight(x, z) + 0.3, z), new THREE.Color(0x4a3a28), 18, 3, 0.8);
  const enemy = {
    obj, hitbox, mixer, actions, footY,
    type,
    hp: proto.hp,
    speed: proto.speed * (0.9 + Math.random() * 0.25),
    damage: proto.damage,
    state: 'chase',
    attackTimer: 0,
    dieTimer: 0,
    groanTimer: 2 + Math.random() * 8,
    rise: proto.boss ? 2.6 : 1.4,    // seconds spent clawing out of the ground
    riseDur: proto.boss ? 2.6 : 1.4,
    burial,
    range: proto.boss ? 3.4 : 2.0,
    lungeCd: proto.boss ? 1e9 : 4 + Math.random() * 5,  // the giant never runs — it doesn't need to
    lunging: 0,
  };
  hitbox.userData.enemy = enemy;
  enemies.push(enemy);
  enemyHitboxes.push(hitbox);
}
function killEnemy(enemy) {
  enemy.state = 'dying';
  enemy.dieTimer = 1.6;
  if (enemy.actions.walk) enemy.actions.walk.fadeOut(0.15);
  if (enemy.actions.attack) enemy.actions.attack.fadeOut(0.15);
  if (enemy.actions.death) enemy.actions.death.reset().fadeIn(0.1).play();
  else enemy.topple = true;   // unanimated rigs keel over in code
  const p = enemy.obj.position.clone();
  p.y += 1;
  spawnBurst(p, new THREE.Color(0xd8d2c2), 30, 7, 0.9);
  sfx.kill();
  const i = enemyHitboxes.indexOf(enemy.hitbox);
  if (i !== -1) enemyHitboxes.splice(i, 1);
  state.kills++;
  document.getElementById('kills').textContent = state.kills;
  const wave = 1 + Math.floor(state.kills / 6);
  if (wave !== state.wave) {
    state.wave = wave;
    document.getElementById('wave').textContent = wave;
  }
  state.respawnQueue.push(state.time + 2.5);
  if (state.kills % 6 === 0 && state.maxEnemies < 14) {
    state.maxEnemies++;
    state.respawnQueue.push(state.time + 1);
  }
}
function removeEnemy(enemy) {
  scene.remove(enemy.obj);
  const i = enemies.indexOf(enemy);
  if (i !== -1) enemies.splice(i, 1);
  const j = enemyHitboxes.indexOf(enemy.hitbox);
  if (j !== -1) enemyHitboxes.splice(j, 1);
}

// ---------------------------------------------------------------- mission --
// escape-room style: the generator needs a 4-digit code. Three digits hide in
// the recovered records; the last one must be OBSERVED in the world (the
// watchtower stands on four legs).
function loreLines(code) {
  return [
    `기록 #1 — 놈들이 밤마다 땅에서 기어 나온다. 발전기 코드 첫째 자리는 ${code[0]}. 잊지 마라.`,
    `기록 #2 — 김 박사가 사라졌다. 코드 둘째 자리는 ${code[1]}. 놈들은 빛을 싫어한다.`,
    `기록 #3 — 코드 셋째 자리는 ${code[2]}. 제발… 소리를 내지 마라. 놈들이 듣는다.`,
    '기록 #4 — 마지막 자리는 적지 않겠다. 감시탑을 받치고 있는 다리의 개수를 세어라.',
    '기록 #5 — 우리는 너무 늦었다. 코드를 입력하고… 부디 새벽을 보길.',
  ];
}
const GEN_POS = new THREE.Vector3(0, terrainHeight(2.8, -48.5), -48.5);
const mission = {
  phase: 'collect',      // collect -> generator -> defend -> won
  relics: [],
  collected: 0,
  total: 5,
  code: [1, 1, 1, 4],
  lore: [],
  defendT: 90,
  loreTimer: 0,
};

const relicBeamMat = new THREE.MeshBasicMaterial({
  color: 0xffb35c, transparent: true, opacity: 0.14,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
});
function makeRelic(x, z) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5, metalness: 0.6 }));
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  screen.position.set(0, 0.02, 0.065);
  const light = new THREE.PointLight(0xffab50, 5, 9, 1.7);
  light.position.y = 0.6;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 26, 10, 1, true), relicBeamMat);
  beam.position.y = 13;
  g.add(box, screen, light, beam);
  g.position.set(x, terrainHeight(x, z) + 0.55, z);
  g.userData.baseY = g.position.y;
  g.userData.beam = beam;
  // the waypoint only marks an approximate search area, not the exact spot
  const oa = Math.random() * Math.PI * 2;
  const od = 12 + Math.random() * 14;
  g.userData.wpOffset = new THREE.Vector3(Math.cos(oa) * od, 0, Math.sin(oa) * od);
  scene.add(g);
  return g;
}
function setupMission() {
  for (const r of mission.relics) scene.remove(r);
  mission.relics = [];
  mission.phase = 'collect';
  mission.collected = 0;
  mission.defendT = 90;
  mission.code = [
    1 + Math.floor(Math.random() * 9),
    1 + Math.floor(Math.random() * 9),
    1 + Math.floor(Math.random() * 9),
    4,   // the watchtower's legs — count them
  ];
  mission.lore = loreLines(mission.code);
  const spots = scatter(mission.total, 45,
    (x, y, z) => Math.hypot(x, z) < 165 && y > WATER_LEVEL + 1.5 && slopeAt(x, z) < 0.6);
  while (spots.length < mission.total) spots.push({ x: 60 + spots.length * 15, z: 60 });
  spots.forEach((p, i) => {
    const r = makeRelic(p.x, p.z);
    r.userData.loreId = i;
    mission.relics.push(r);
  });
  genLamp.material.color.setHex(0xff2818);
  genLight.color.setHex(0xff3020);
  kpClose();
  setObjective('기록 회수', `기록장치를 찾아 발전기 <b>접근 코드</b>를 알아내라 — <b>0 / ${mission.total}</b><br><small style="opacity:.7">마커는 대략적인 탐색 구역이다</small>`);
}

// generator console at the watchtower base
const genConsole = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 1.3, 0.7),
  new THREE.MeshStandardMaterial({ map: TEX.metalBC, normalMap: TEX.metalN, color: 0x9aa0aa, roughness: 0.6, metalness: 0.6 }));
genConsole.position.copy(GEN_POS).add(new THREE.Vector3(0, 0.65, 0));
genConsole.castShadow = true;
scene.add(genConsole);
const genLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 10),
  new THREE.MeshBasicMaterial({ color: 0xff2818 }));
genLamp.position.copy(GEN_POS).add(new THREE.Vector3(0, 1.42, 0));
scene.add(genLamp);
const genLight = new THREE.PointLight(0xff3020, 3, 10, 1.7);
genLight.position.copy(genLamp.position).add(new THREE.Vector3(0, 0.4, 0));
scene.add(genLight);

// ---------------------------------------------------------------- minimap --
const worldMap = document.createElement('canvas');
worldMap.width = worldMap.height = 256;
{
  const ctx = worldMap.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const wx = (px / 255) * WORLD_SIZE - WORLD_SIZE / 2;
      const wz = (py / 255) * WORLD_SIZE - WORLD_SIZE / 2;
      const y = terrainHeight(wx, wz);
      let r, g, b;
      if (y < WATER_LEVEL) { r = 16; g = 30; b = 52; }
      else if (y < WATER_LEVEL + 2.5) { r = 92; g = 82; b = 56; }
      else if (y > 13) { r = 116; g = 124; b = 130; }
      else {
        const t = THREE.MathUtils.clamp((y + 6) / 24, 0, 1);
        r = 28 + 26 * t; g = 46 + 30 * t; b = 26 + 18 * t;
      }
      const i = (py * 256 + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
function bakeMapStatics() {
  const ctx = worldMap.getContext('2d');
  const s = 256 / WORLD_SIZE;
  ctx.fillStyle = '#161d12';
  for (const t of treeSpots) ctx.fillRect((t.x + 300) * s - 1, (t.z + 300) * s - 1, 2, 2);
  ctx.fillStyle = '#71747a';
  for (const [x, , z, w, , d] of BUILDING_DEFS) {
    ctx.fillRect((x + 300 - w / 2) * s, (z + 300 - d / 2) * s, Math.max(w * s, 2), Math.max(d * s, 2));
  }
  ctx.fillRect((300 - 3) * s, (-52 + 300 - 3) * s, 6 * s + 1, 6 * s + 1);   // watchtower
}
function drawMinimap() {
  const cv = ui.minimap;
  if (!cv) return;
  const mm = cv.getContext('2d');
  const S = 150, R = 85;                    // view radius in meters
  const pxm = S / (2 * R), ws = 256 / WORLD_SIZE;
  const cx = camera.position.x, cz = camera.position.z;
  mm.clearRect(0, 0, S, S);
  mm.save();
  mm.beginPath();
  mm.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  mm.clip();
  const sw = 2 * R * ws;
  mm.drawImage(worldMap, (cx + 300) * ws - sw / 2, (cz + 300) * ws - sw / 2, sw, sw, 0, 0, S, S);
  const toMap = (x, z) => [(x - cx) * pxm + S / 2, (z - cz) * pxm + S / 2];
  if (mission.phase === 'collect') {
    mm.strokeStyle = 'rgba(255,170,80,.85)';
    mm.fillStyle = 'rgba(255,170,80,.14)';
    for (const r of mission.relics) {
      const o = r.userData.wpOffset;
      const [mx, my] = toMap(r.position.x + o.x, r.position.z + o.z);
      mm.beginPath();
      mm.arc(mx, my, 27 * pxm, 0, Math.PI * 2);
      mm.fill(); mm.stroke();
    }
  }
  {
    const [gx, gy] = toMap(GEN_POS.x, GEN_POS.z);
    mm.fillStyle = (mission.phase === 'defend' || mission.phase === 'won') ? '#43e06a' : '#ff5a3a';
    mm.fillRect(gx - 2.5, gy - 2.5, 5, 5);
  }
  mm.fillStyle = '#ff3626';
  for (const e of enemies) {
    if (e.state === 'dying') continue;
    const ex0 = e.obj.position.x, ez0 = e.obj.position.z;
    if (Math.hypot(ex0 - cx, ez0 - cz) > R) continue;
    const [ex, ey] = toMap(ex0, ez0);
    mm.beginPath();
    mm.arc(ex, ey, 2.3, 0, Math.PI * 2);
    mm.fill();
  }
  // player arrow (map is north-up; arrow rotates with view)
  mm.translate(S / 2, S / 2);
  mm.rotate(-state.yaw);
  mm.fillStyle = '#ffe9c2';
  mm.beginPath();
  mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(0, 3); mm.lineTo(-5, 6);
  mm.closePath(); mm.fill();
  mm.restore();
  mm.strokeStyle = 'rgba(255,255,255,.3)';
  mm.beginPath();
  mm.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  mm.stroke();
  mm.fillStyle = 'rgba(255,255,255,.75)';
  mm.font = '10px sans-serif';
  mm.textAlign = 'center';
  mm.fillText('N', S / 2, 12);
}

function setObjective(title, descHTML) {
  document.getElementById('obj-title').textContent = 'MISSION — ' + title;
  document.getElementById('obj-desc').innerHTML = descHTML;
}
function showLore(text) {
  const el = document.getElementById('lore');
  el.textContent = text;
  el.style.opacity = '1';
  mission.loreTimer = 5;
}

// ------------------------------------------------------------------ state --
const state = {
  playing: false,
  dead: false,
  won: false,
  interactLatch: false,
  touchInteract: false,
  defendSpawnT: 0,
  time: 0,
  hp: 100,
  lastDamage: -99,
  kills: 0,
  wave: 1,
  maxEnemies: 6,
  respawnQueue: [],
  mag: 30,
  magSize: 30,
  reloading: 0,
  fireCooldown: 0,
  recoil: 0,
  yaw: 0,
  pitch: 0,
  vel: new THREE.Vector3(),
  vy: 0,
  grounded: true,
  mouseDown: false,
  heartbeatTimer: 0,
};
const keys = {};
camera.position.set(0, terrainHeight(0, 8) + EYE_HEIGHT, 8);

const ui = {
  overlay: document.getElementById('overlay'),
  playBtn: document.getElementById('play-btn'),
  deathStats: document.getElementById('death-stats'),
  hpFill: document.getElementById('hpbar-fill'),
  mag: document.getElementById('mag'),
  hitmarker: document.getElementById('hitmarker'),
  vignette: document.getElementById('vignette'),
  waypoint: document.getElementById('waypoint'),
  wpDist: document.querySelector('#waypoint .wp-dist'),
  iPrompt: document.getElementById('interact-prompt'),
  iText: document.getElementById('interact-text'),
  iBar: document.getElementById('interact-bar'),
  iFill: document.getElementById('interact-fill'),
  lore: document.getElementById('lore'),
  btnInteract: document.getElementById('btn-interact'),
  minimap: document.getElementById('minimap'),
};
// keypad buttons — mouse click (pointer is released while the keypad is open)
// and direct touch (bypasses the global look/stick touch handlers)
document.querySelectorAll('.kp-btn').forEach((b) => {
  const press = () => {
    if (b.dataset.k === 'close') kpClose();
    else kpInput(b.dataset.k);
  };
  b.addEventListener('click', press);
  b.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    e.preventDefault();
    press();
  }, { passive: false });
});

function resetGame() {
  for (const e of [...enemies]) removeEnemy(e);
  Object.assign(state, {
    dead: false, won: false, hp: 100, kills: 0, wave: 1, maxEnemies: 6,
    mag: 30, reloading: 0, fireCooldown: 0, recoil: 0,
    yaw: 0, pitch: 0, vy: 0, lastDamage: -99, defendSpawnT: 0,
  });
  state.respawnQueue.length = 0;
  camera.position.set(0, terrainHeight(0, 8) + EYE_HEIGHT, 8);
  document.getElementById('kills').textContent = '0';
  document.getElementById('wave').textContent = '1';
  ui.deathStats.style.display = 'none';
  setupMission();
  for (let i = 0; i < state.maxEnemies; i++) spawnEnemy(camera.position);
}

function collectRelic(relic) {
  scene.remove(relic);
  mission.relics.splice(mission.relics.indexOf(relic), 1);
  mission.collected++;
  playTone(880, 0.15, 0.2, 'sine', 1320);
  playTone(440, 0.3, 0.12, 'triangle');
  showLore(mission.lore[relic.userData.loreId]);
  // the night deepens with every recovered record
  state.maxEnemies = Math.min(6 + mission.collected, 12);
  state.respawnQueue.push(state.time + 1);
  if (mission.collected >= mission.total) {
    mission.phase = 'generator';
    setObjective('접근 코드', '감시탑 발전기에 <b>4자리 코드</b>를 입력하라<br><small style="opacity:.7">힌트는 회수한 기록에 있다</small>');
  } else {
    setObjective('기록 회수', `기록장치를 찾아 발전기 <b>접근 코드</b>를 알아내라 — <b>${mission.collected} / ${mission.total}</b><br><small style="opacity:.7">마커는 대략적인 탐색 구역이다</small>`);
  }
}

// ----- generator keypad (escape-room lock) -----
const keypad = { open: false, buf: '' };
function kpRender(flash) {
  const disp = document.getElementById('kp-display');
  disp.textContent = (keypad.buf + '····'.slice(keypad.buf.length)).split('').join(' ');
  disp.style.color = flash === 'bad' ? '#ff5544' : flash === 'good' ? '#66ff88' : '#ffd9a0';
}
function kpOpen() {
  if (keypad.open || mission.phase !== 'generator') return;
  keypad.open = true;
  keypad.buf = '';
  kpRender();
  document.getElementById('keypad').style.display = 'flex';
  // free the mouse so the on-screen buttons are clickable (desktop)
  if (document.pointerLockElement) {
    keypad.relock = true;
    document.exitPointerLock();
  }
}
function kpClose() {
  const wasOpen = keypad.open;
  keypad.open = false;
  const el = document.getElementById('keypad');
  if (el) el.style.display = 'none';
  if (wasOpen && keypad.relock) {
    keypad.relock = false;
    // may be ignored outside a user gesture — the canvas click fallback re-locks
    if (!document.pointerLockElement && state.playing) {
      try { renderer.domElement.requestPointerLock(); } catch (e) { /* fallback below */ }
    }
  }
}
function kpInput(ch) {
  if (!keypad.open) return;
  if (ch === 'back') keypad.buf = keypad.buf.slice(0, -1);
  else if (/^[0-9]$/.test(ch) && keypad.buf.length < 4) keypad.buf += ch;
  kpRender();
  if (keypad.buf.length === 4) {
    if (keypad.buf === mission.code.join('')) {
      kpRender('good');
      playTone(660, 0.2, 0.2, 'triangle', 990);
      setTimeout(() => { kpClose(); startDefend(); }, 450);
    } else {
      kpRender('bad');
      sfx.alarm();
      showLore('오답 — 경보가 골짜기에 울려 퍼진다. 놈들이 몰려온다!');
      for (let i = 0; i < 2; i++) spawnEnemy(camera.position);
      setTimeout(() => { keypad.buf = ''; kpRender(); }, 700);
    }
  }
}
function startDefend() {
  mission.phase = 'defend';
  genLamp.material.color.setHex(0x3aff55);
  genLight.color.setHex(0x35e050);
  playTone(60, 1.2, 0.3, 'sawtooth', 120);
  playTone(240, 0.6, 0.15, 'square', 480);
  showLore('발전기 가동 — 송신 시작. 새벽까지 그들이 몰려온다.');
  state.maxEnemies = 15;
  for (let i = 0; i < 5; i++) spawnEnemy(camera.position);
}
function winGame() {
  mission.phase = 'won';
  state.won = true;
  playTone(523, 0.4, 0.2, 'triangle');
  setTimeout(() => playTone(659, 0.4, 0.2, 'triangle'), 250);
  setTimeout(() => playTone(784, 0.8, 0.25, 'triangle'), 500);
  ui.deathStats.style.display = 'block';
  ui.deathStats.style.color = '#a8e8a0';
  ui.deathStats.textContent = `새벽이 밝았다 — 구조 신호 송신 완료. 처치 ${state.kills} · 기록 ${mission.total}/${mission.total}`;
  setObjective('완료', '생존 성공 — 구조대가 오고 있다');
  if (IS_TOUCH || !document.pointerLockElement) pauseToMenu();
  else document.exitPointerLock();
}

// ------------------------------------------------------------------ input --
function pauseToMenu() {
  state.playing = false;
  state.mouseDown = false;
  ui.overlay.classList.remove('hidden');
  ui.playBtn.textContent = (state.dead || state.won) ? 'REDEPLOY' : 'RESUME';
}
ui.playBtn.addEventListener('click', () => {
  initAudio();
  if (state.dead || state.won || enemies.length === 0) resetGame();
  if (IS_TOUCH) {
    state.playing = true;
    ui.overlay.classList.add('hidden');
  } else {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (IS_TOUCH) return;
  // the keypad intentionally releases the mouse — keep playing, no pause menu
  if (keypad.open) {
    state.playing = true;
    state.mouseDown = false;
    return;
  }
  state.playing = document.pointerLockElement === renderer.domElement;
  ui.overlay.classList.toggle('hidden', state.playing);
  if (!state.playing) {
    ui.playBtn.textContent = (state.dead || state.won) ? 'REDEPLOY' : 'RESUME';
    state.mouseDown = false;
  }
});
// re-lock the mouse after the keypad released it
renderer.domElement.addEventListener('mousedown', () => {
  if (!IS_TOUCH && state.playing && !keypad.open && !document.pointerLockElement) {
    renderer.domElement.requestPointerLock();
  }
});

// ---- touch controls: left = virtual stick, right = look, buttons = actions
const touch = { moveId: null, origin: [0, 0], vec: [0, 0], lookId: null, last: [0, 0] };
if (IS_TOUCH) {
  const stickBase = document.getElementById('stick-base');
  const nub = document.getElementById('stick-nub');
  const R = 48;
  const onStart = (e) => {
    if (!state.playing) return;
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('.tbtn, #keypad')) continue;
      if (t.clientX < innerWidth * 0.45 && touch.moveId === null) {
        touch.moveId = t.identifier;
        touch.origin = [t.clientX, t.clientY];
        touch.vec = [0, 0];
        stickBase.style.display = 'block';
        stickBase.style.left = `${t.clientX}px`;
        stickBase.style.top = `${t.clientY}px`;
      } else if (touch.lookId === null) {
        touch.lookId = t.identifier;
        touch.last = [t.clientX, t.clientY];
      }
    }
    e.preventDefault();
  };
  const onMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.moveId) {
        let dx = t.clientX - touch.origin[0], dy = t.clientY - touch.origin[1];
        const len = Math.hypot(dx, dy);
        if (len > R) { dx *= R / len; dy *= R / len; }
        touch.vec = [dx / R, dy / R];
        nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (t.identifier === touch.lookId) {
        state.yaw -= (t.clientX - touch.last[0]) * 0.0045;
        state.pitch -= (t.clientY - touch.last[1]) * 0.0045;
        state.pitch = THREE.MathUtils.clamp(state.pitch, -1.45, 1.45);
        touch.last = [t.clientX, t.clientY];
      }
    }
    e.preventDefault();
  };
  const onEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.moveId) {
        touch.moveId = null;
        touch.vec = [0, 0];
        stickBase.style.display = 'none';
        nub.style.transform = 'translate(-50%, -50%)';
      } else if (t.identifier === touch.lookId) {
        touch.lookId = null;
      }
    }
  };
  document.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('touchcancel', onEnd);

  const bind = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); down(); }, { passive: false });
    if (up) el.addEventListener('touchend', (e) => { e.stopPropagation(); up(); });
  };
  bind('btn-fire', () => { state.mouseDown = true; }, () => { state.mouseDown = false; });
  bind('btn-jump', () => { keys.Space = true; }, () => { keys.Space = false; });
  bind('btn-reload', () => {
    if (state.playing && state.reloading <= 0 && state.mag < state.magSize) {
      state.reloading = 1.4;
      sfx.reload();
    }
  });
  bind('btn-pause', () => pauseToMenu());
  bind('btn-interact', () => { state.touchInteract = true; }, () => { state.touchInteract = false; });
}
document.addEventListener('mousemove', (e) => {
  if (!state.playing) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch -= e.movementY * 0.0022;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -1.45, 1.45);
});
document.addEventListener('mousedown', (e) => { if (state.playing && e.button === 0 && !keypad.open) state.mouseDown = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) state.mouseDown = false; });
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (keypad.open) {
    const m = e.code.match(/^(?:Digit|Numpad)([0-9])$/);
    if (m) kpInput(m[1]);
    else if (e.code === 'Backspace') { e.preventDefault(); kpInput('back'); }
    else if (e.code === 'Escape') kpClose();
    return;
  }
  if (e.code === 'KeyR' && state.playing && state.reloading <= 0 && state.mag < state.magSize) {
    state.reloading = 1.4;
    sfx.reload();
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --------------------------------------------------------------- shooting --
const raycaster = new THREE.Raycaster();
const _muzzleWorld = new THREE.Vector3();
function shoot() {
  state.mag--;
  state.fireCooldown = 0.115;
  state.recoil = Math.min(state.recoil + 0.35, 1);
  ui.mag.textContent = state.mag;
  sfx.shoot();
  muzzleFlash.intensity = 60;

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const moving = state.vel.lengthSq() > 1;
  if (moving) {
    raycaster.ray.direction.x += (Math.random() - 0.5) * 0.012;
    raycaster.ray.direction.y += (Math.random() - 0.5) * 0.012;
    raycaster.ray.direction.normalize();
  }
  gun.getWorldPosition(_muzzleWorld);
  const hits = raycaster.intersectObjects([...enemyHitboxes, terrain], false);
  let end;
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;
    const enemy = hit.object.userData.enemy;
    if (enemy && enemy.state !== 'dying') {
      enemy.hp--;
      ui.hitmarker.style.opacity = '1';
      setTimeout(() => (ui.hitmarker.style.opacity = '0'), 90);
      sfx.hit();
      spawnBurst(hit.point, new THREE.Color(0xe8e2d2), 10, 5, 0.45);
      if (enemy.hp <= 0) killEnemy(enemy);
    } else {
      spawnBurst(hit.point, new THREE.Color(0x8a8070), 6, 3, 0.5);
    }
  } else {
    end = raycaster.ray.direction.clone().multiplyScalar(300).add(raycaster.ray.origin);
  }
  spawnTracer(_muzzleWorld, end);
}

function damagePlayer(amount) {
  if (state.dead) return;
  state.hp -= amount;
  state.lastDamage = state.time;
  sfx.hurt();
  ui.vignette.style.opacity = '1';
  setTimeout(() => { if (state.hp > 0) ui.vignette.style.opacity = '0'; }, 250);
  if (state.hp <= 0) {
    state.hp = 0;
    state.dead = true;
    ui.deathStats.style.display = 'block';
    ui.deathStats.style.color = '#ff9a88';
    ui.deathStats.textContent = `그들에게 잡혔습니다 — 처치 ${state.kills} · 기록 ${mission.collected}/${mission.total}`;
    if (IS_TOUCH || !document.pointerLockElement) pauseToMenu();
    else document.exitPointerLock();
  }
}

// ------------------------------------------------------------------- loop --
const clock = new THREE.Clock();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();

function update(dt) {
  state.time += dt;

  // --- movement
  camera.rotation.set(0, 0, 0);
  camera.rotateY(state.yaw);
  camera.rotateX(state.pitch);

  _fwd.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  _right.set(_fwd.z, 0, -_fwd.x).negate();
  _move.set(0, 0, 0);
  let stickMag = 0;
  if (state.playing && !state.dead) {
    if (keys.KeyW) _move.add(_fwd);
    if (keys.KeyS) _move.sub(_fwd);
    if (keys.KeyD) _move.add(_right);
    if (keys.KeyA) _move.sub(_right);
    if (IS_TOUCH && (touch.vec[0] || touch.vec[1])) {
      _move.addScaledVector(_fwd, -touch.vec[1]);
      _move.addScaledVector(_right, touch.vec[0]);
      stickMag = Math.min(Math.hypot(touch.vec[0], touch.vec[1]), 1);
    }
  }
  const inWater = camera.position.y - EYE_HEIGHT < WATER_LEVEL + 0.3;
  const sprinting = keys.ShiftLeft || keys.ShiftRight || stickMag > 0.92;
  let speed = (sprinting ? 11.5 : 7) * (inWater ? 0.55 : 1);
  if (stickMag > 0) speed *= Math.max(stickMag, 0.35);
  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(speed);
  state.vel.lerp(_move, 1 - Math.exp(-12 * dt));

  const groundY = terrainHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;
  if (state.grounded && keys.Space && state.playing && !state.dead) {
    state.vy = 8.5;
    state.grounded = false;
    sfx.jump();
  }
  state.vy -= GRAVITY * dt;
  camera.position.x += state.vel.x * dt;
  camera.position.z += state.vel.z * dt;
  camera.position.y += state.vy * dt;
  if (camera.position.y <= groundY) {
    camera.position.y = groundY;
    state.vy = 0;
    state.grounded = true;
  } else {
    state.grounded = false;
  }
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -WORLD_BOUND, WORLD_BOUND);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -WORLD_BOUND, WORLD_BOUND);

  // head bob + recoil
  const bob = Math.sin(state.time * 10) * 0.012 * Math.min(state.vel.length() / 7, 1) * (state.grounded ? 1 : 0);
  state.recoil = Math.max(0, state.recoil - dt * 4);
  gun.position.set(0.24, -0.2 + bob, -0.5 + state.recoil * 0.09);
  gun.rotation.x = state.recoil * 0.14;
  muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - dt * 700);

  // flashlight sway follows the bob slightly
  flashlight.target.position.set(bob * 2, -0.06 + bob, -1);

  // --- shooting
  state.fireCooldown -= dt;
  if (state.reloading > 0) {
    state.reloading -= dt;
    ui.mag.innerHTML = '<span class="reloading">RELOADING</span>';
    if (state.reloading <= 0) {
      state.mag = state.magSize;
      ui.mag.textContent = state.mag;
    }
  } else if (state.mouseDown && state.playing && !state.dead && state.fireCooldown <= 0) {
    if (state.mag > 0) shoot();
    else { state.reloading = 1.4; sfx.reload(); }
  }

  // --- health regen + heartbeat
  if (!state.dead && state.hp < 100 && state.time - state.lastDamage > 4) {
    state.hp = Math.min(100, state.hp + 10 * dt);
    if (state.time - state.lastDamage > 4.5) ui.vignette.style.opacity = '0';
  }
  ui.hpFill.style.width = `${state.hp}%`;
  if (!state.dead && state.hp < 40 && state.playing) {
    state.heartbeatTimer -= dt;
    if (state.heartbeatTimer <= 0) {
      state.heartbeatTimer = 0.55 + (state.hp / 40) * 0.6;
      sfx.heartbeat();
    }
  }

  // --- enemies
  if (!state.dead) {
    for (let i = state.respawnQueue.length - 1; i >= 0; i--) {
      if (state.time >= state.respawnQueue[i] && enemies.length < state.maxEnemies) {
        state.respawnQueue.splice(i, 1);
        spawnEnemy(camera.position);
      }
    }
  }
  for (const e of [...enemies]) {
    e.mixer.update(dt);
    if (e.state === 'dying') {
      e.dieTimer -= dt;
      if (e.topple) e.obj.rotation.x = Math.max(e.obj.rotation.x - dt * 1.4, -1.5);
      if (e.dieTimer <= 0) {
        e.obj.position.y -= dt * 0.7;   // sink back into the earth
        if (e.dieTimer < -2) removeEnemy(e);
      }
      continue;
    }
    const p = e.obj.position;
    _toPlayer.copy(camera.position).sub(p);
    _toPlayer.y = 0;
    const dist = _toPlayer.length();

    // clawing out of the ground
    if (e.rise > 0) {
      e.rise -= dt;
      p.y = terrainHeight(p.x, p.z) + e.footY - e.burial * Math.max(e.rise, 0) / e.riseDur;
      if (Math.random() < dt * 6) {
        spawnBurst(new THREE.Vector3(p.x, terrainHeight(p.x, p.z) + 0.2, p.z),
          new THREE.Color(0x4a3a28), 4, 2.5, 0.6);
      }
      e.obj.lookAt(camera.position.x, p.y, camera.position.z);
      continue;
    }

    e.groanTimer -= dt;
    if (e.groanTimer <= 0 && dist < 40) {
      e.groanTimer = 5 + Math.random() * 9;
      sfx.groan();
    }

    if (e.state === 'attack') {
      e.attackTimer -= dt;
      if (e.attackTimer <= 0.45 && !e.didDamage) {
        e.didDamage = true;
        if (dist < e.range + 0.9 && state.playing && !state.dead) damagePlayer(e.damage);
      }
      if (e.attackTimer <= 0) {
        e.state = 'chase';
        if (e.actions.walk) e.actions.walk.reset().fadeIn(0.15).play();
      }
    } else if (dist < e.range && !state.dead && state.playing) {
      e.state = 'attack';
      e.attackTimer = 0.95;
      e.didDamage = false;
      sfx.attack();
      if (e.actions.walk) e.actions.walk.fadeOut(0.1);
      if (e.actions.attack) e.actions.attack.reset().fadeIn(0.08).play();
    } else if (dist < 120 && dist > e.range * 0.8 && !state.dead) {
      // shrieking rush: brief burst of unnatural speed
      let mul = 1;
      if (e.lunging > 0) {
        e.lunging -= dt;
        mul = 2.6;
        if (e.lunging <= 0 && e.actions.walk) e.actions.walk.timeScale = 1;
      } else {
        e.lungeCd -= dt;
        if (e.lungeCd <= 0 && dist < 28 && dist > 6 && state.playing) {
          e.lungeCd = 5 + Math.random() * 6;
          e.lunging = 1.2;
          sfx.scream();
          if (e.actions.walk) e.actions.walk.timeScale = 2.4;
        }
      }
      _toPlayer.normalize();
      p.x += _toPlayer.x * e.speed * mul * dt;
      p.z += _toPlayer.z * e.speed * mul * dt;
    }
    p.y = terrainHeight(p.x, p.z) + e.footY;
    e.obj.lookAt(camera.position.x, p.y, camera.position.z);
  }

  // --- mission
  let wpTarget = null, wpLift = 1.6, interact = null;
  for (let i = 0; i < mission.relics.length; i++) {
    const r = mission.relics[i];
    r.rotation.y += dt * 0.8;
    r.position.y = r.userData.baseY + Math.sin(state.time * 2 + i * 1.7) * 0.1;
  }
  if (mission.loreTimer > 0) {
    mission.loreTimer -= dt;
    if (mission.loreTimer <= 0) ui.lore.style.opacity = '0';
  }
  if (state.playing && !state.dead && !state.won) {
    if (mission.phase === 'collect') {
      let nearest = null, nd = 1e9;
      for (const r of mission.relics) {
        const d = r.position.distanceTo(camera.position);
        r.userData.beam.visible = d < 45;   // the light pillar only shows up close
        if (d < nd) { nd = d; nearest = r; }
      }
      if (nearest) {
        // far away: point at the search area, not the record itself
        wpTarget = nd > 45
          ? nearest.position.clone().add(nearest.userData.wpOffset)
          : nearest.position;
        if (nd < 3.2) interact = { label: '기록 회수', relic: nearest };
      }
    } else if (mission.phase === 'generator') {
      wpTarget = genLamp.position;
      wpLift = 0.8;
      if (camera.position.distanceTo(genConsole.position) < 3.6 && !keypad.open) {
        interact = { label: '접근 코드 입력', keypadOpen: true };
      }
    } else if (mission.phase === 'defend') {
      mission.defendT -= dt;
      setObjective('생존', `구조 신호 송신 중 — <b>${Math.max(0, Math.ceil(mission.defendT))}초</b>만 버텨라`);
      state.defendSpawnT -= dt;
      if (state.defendSpawnT <= 0) {
        state.defendSpawnT = 3.2;
        if (enemies.length < state.maxEnemies) spawnEnemy(camera.position);
      }
      if (mission.defendT <= 0) winGame();
    }
  }

  const wantInteract = (keys.KeyE || state.touchInteract) && state.playing && !state.dead;
  if (interact) {
    ui.iPrompt.style.display = 'block';
    ui.iText.innerHTML = IS_TOUCH ? interact.label : `<kbd>E</kbd>${interact.label}`;
    if (IS_TOUCH) ui.btnInteract.style.display = 'block';
    if (wantInteract && !state.interactLatch) {
      state.interactLatch = true;
      if (interact.relic) collectRelic(interact.relic);
      else if (interact.keypadOpen) kpOpen();
    }
  } else {
    ui.iPrompt.style.display = 'none';
    if (IS_TOUCH) ui.btnInteract.style.display = 'none';
  }
  if (!wantInteract) state.interactLatch = false;
  if (keypad.open && (mission.phase !== 'generator'
      || camera.position.distanceTo(genConsole.position) > 6)) kpClose();

  drawMinimap();

  // waypoint marker projected to the screen (clamped to edges when off-view)
  if (wpTarget && state.playing && !state.dead && !state.won) {
    camera.updateMatrixWorld();
    const v = wpTarget.clone();
    v.y += wpLift;
    const dist = Math.round(v.distanceTo(camera.position));
    v.project(camera);
    let sx = (v.x * 0.5 + 0.5) * innerWidth;
    let sy = (-v.y * 0.5 + 0.5) * innerHeight;
    if (v.z > 1) { sx = innerWidth - sx; sy = innerHeight - 70; }
    sx = THREE.MathUtils.clamp(sx, 44, innerWidth - 44);
    sy = THREE.MathUtils.clamp(sy, 70, innerHeight - 110);
    ui.waypoint.style.display = 'block';
    ui.waypoint.style.left = `${sx}px`;
    ui.waypoint.style.top = `${sy}px`;
    ui.wpDist.textContent = `${dist}m`;
  } else {
    ui.waypoint.style.display = 'none';
  }

  updateParticles(dt);
  updateTracers(dt);

  water.position.y = WATER_LEVEL + Math.sin(state.time * 0.8) * 0.06;
  TEX.waterN.offset.set(state.time * 0.006, state.time * 0.004);
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
});

// ------------------------------------------------------------- bootstrap --
Promise.all([plantForest(), loadSkeletons()])
  .then(() => {
    bakeMapStatics();
    setupMission();
    for (let i = 0; i < state.maxEnemies; i++) spawnEnemy(camera.position);
    ui.playBtn.disabled = false;
    ui.playBtn.textContent = 'ENTER THE DARK';
  })
  .catch((err) => {
    console.error('asset load failed', err);
    ui.playBtn.disabled = false;
    ui.playBtn.textContent = 'ENTER THE DARK';
  });

// debug handle for automated tests
window.__game = { scene, camera, renderer, terrain, state, enemies, protos, flashlight, __keys: keys, spawnEnemy };
window.__mission = mission;
mission.genPos = GEN_POS;
mission.kpInput = kpInput;
mission.kpOpen = kpOpen;
mission.keypad = keypad;
