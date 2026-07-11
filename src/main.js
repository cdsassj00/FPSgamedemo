import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// ---------------------------------------------------------------------------
// Fable Frontier — self-contained open-world FPS demo.
// Everything (terrain, props, enemies, gun, particles, audio) is generated
// procedurally at load time; no external assets are fetched at runtime.
// ---------------------------------------------------------------------------

const WORLD_SIZE = 600;          // terrain plane edge length
const WORLD_BOUND = 285;         // playable radius clamp
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
  // flatten the spawn area so the player starts on level ground
  const d = Math.hypot(x, z);
  return h * THREE.MathUtils.smoothstep(d, 18, 70);
}

// ------------------------------------------------------------------ scene --
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = !new URLSearchParams(location.search).has('noshadow');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd3de, 120, 460);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);

// sky + sun
const sky = new Sky();
sky.scale.setScalar(2000);
scene.add(sky);
const sunDir = new THREE.Vector3().setFromSphericalCoords(
  1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(65));
sky.material.uniforms.sunPosition.value.copy(sunDir);
sky.material.uniforms.turbidity.value = 6;
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.004;

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5d7a55, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// --------------------------------------------------------------- terrain --
const SEG = 150;
const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x5f8c45), dry = new THREE.Color(0x8f9c56);
  const rock = new THREE.Color(0x77746c), sand = new THREE.Color(0xb5a878);
  const snow = new THREE.Color(0xe8ecec), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const e = 1.5;
    const slope = Math.abs(terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e)
                + Math.abs(terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    tmp.copy(grass).lerp(dry, (noise2(x * 0.06, z * 0.06) * 0.6 + noise2(x * 0.013, z * 0.013) * 0.4) * 0.55);
    if (y < WATER_LEVEL + 2.5) tmp.lerp(sand, THREE.MathUtils.smoothstep(WATER_LEVEL + 2.5 - y, 0, 2.5));
    tmp.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.45, 0.9));
    if (y > 13) tmp.lerp(snow, THREE.MathUtils.smoothstep(y, 13, 19));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}
// tiled grayscale noise so nearby ground has visible grain
const detailTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 212 + Math.floor(Math.random() * 34);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(180, 180);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const terrain = new THREE.Mesh(terrainGeo,
  new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, roughness: 0.95, metalness: 0 }));
terrain.receiveShadow = true;
scene.add(terrain);

// water
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE * 1.4, WORLD_SIZE * 1.4),
  new THREE.MeshStandardMaterial({
    color: 0x2b6f9e, transparent: true, opacity: 0.78,
    roughness: 0.15, metalness: 0.4,
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

// trees (instanced trunk + canopy)
{
  const spots = scatter(220, 26, (x, y, z) => y > WATER_LEVEL + 2 && y < 12 && slopeAt(x, z) < 0.55);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const leafGeo = new THREE.ConeGeometry(1.7, 4.6, 7);
  leafGeo.translate(0, 4.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4429, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a7034, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
  trunks.castShadow = leaves.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((p, i) => {
    const sc = 0.75 + Math.random() * 0.9;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    s.setScalar(sc);
    m.compose(new THREE.Vector3(p.x, p.y - 0.15, p.z), q, s);
    trunks.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
  });
  scene.add(trunks, leaves);
}

// rocks
{
  const spots = scatter(90, 24, (x, y) => y > WATER_LEVEL + 0.5);
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a877e, roughness: 1, flatShading: true });
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
{
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9b9689, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c3f45, roughness: 0.8 });
  const outpost = new THREE.Group();
  const buildings = [
    [28, 6, -34, 10, 5, 8], [40, 6, -26, 7, 8, 7], [33, 6, -18, 6, 4, 12],
    [-42, 6, 20, 9, 6, 9], [-34, 6, 30, 6, 10, 6],
  ];
  for (const [x, , z, w, h, d] of buildings) {
    const y = terrainHeight(x, z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concrete);
    box.position.set(x, y + h / 2 - 0.3, z);
    box.castShadow = box.receiveShadow = true;
    outpost.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), dark);
    roof.position.set(x, y + h - 0.1, z);
    roof.castShadow = true;
    outpost.add(roof);
  }
  // watchtower
  const ty = terrainHeight(0, -52);
  const legGeo = new THREE.CylinderGeometry(0.25, 0.3, 12, 6);
  for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(lx, ty + 6, -52 + lz);
    leg.castShadow = true;
    outpost.add(leg);
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), concrete);
  cabin.position.set(0, ty + 13.5, -52);
  cabin.castShadow = true;
  outpost.add(cabin);
  scene.add(outpost);
}

// -------------------------------------------------------------- particles --
const MAX_PARTICLES = 600;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
const pMat = new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, depthWrite: false });
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
const audio = { ctx: null };
function initAudio() {
  if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
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
function playTone(freq, duration, gainVal, type = 'square') {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + duration);
}
const sfx = {
  shoot: () => { playNoise(0.14, 2400, 0.5, 300); playTone(160, 0.08, 0.15, 'sawtooth'); },
  hit: () => playTone(880, 0.07, 0.2),
  kill: () => { playNoise(0.5, 1200, 0.6, 120); playTone(220, 0.25, 0.2, 'sawtooth'); },
  hurt: () => playTone(120, 0.2, 0.3, 'sawtooth'),
  reload: () => playTone(500, 0.1, 0.12, 'triangle'),
  enemyShot: () => { playNoise(0.1, 900, 0.2, 200); playTone(340, 0.1, 0.1, 'sawtooth'); },
  jump: () => playTone(300, 0.08, 0.08, 'triangle'),
};

// -------------------------------------------------------------------- gun --
const gun = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({
    color: 0x565d66, roughness: 0.5, metalness: 0.4,
    emissive: 0x3a3f47, emissiveIntensity: 0.55,
  });
  const accent = new THREE.MeshStandardMaterial({ color: 0x71d68a, roughness: 0.4, metalness: 0.3, emissive: 0x1f4a2a });
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
const muzzleFlash = new THREE.PointLight(0xffc266, 0, 6);
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
const enemyBodies = [];   // meshes for raycasting
const droneGeo = new THREE.OctahedronGeometry(0.65, 0);
const droneMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.4, metalness: 0.8, flatShading: true });
const eyeGeo = new THREE.SphereGeometry(0.18, 12, 12);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2.5 });
const ringGeo = new THREE.TorusGeometry(0.85, 0.05, 8, 24);
const ringMat = new THREE.MeshStandardMaterial({ color: 0x8a919e, roughness: 0.5, metalness: 0.7 });

function spawnEnemy(nearPos) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 60 + Math.random() * 70;
  const x = THREE.MathUtils.clamp(nearPos.x + Math.cos(angle) * dist, -WORLD_BOUND, WORLD_BOUND);
  const z = THREE.MathUtils.clamp(nearPos.z + Math.sin(angle) * dist, -WORLD_BOUND, WORLD_BOUND);
  const group = new THREE.Group();
  const body = new THREE.Mesh(droneGeo, droneMat.clone());
  body.castShadow = true;
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.set(0, 0, 0.5);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(body, eye, ring);
  group.position.set(x, terrainHeight(x, z) + 3.2, z);
  scene.add(group);
  const enemy = {
    group, body, ring,
    hp: 3,
    fireTimer: 1 + Math.random() * 2,
    bobPhase: Math.random() * Math.PI * 2,
    flashTimer: 0,
  };
  body.userData.enemy = enemy;
  enemies.push(enemy);
  enemyBodies.push(body);
}
function killEnemy(enemy) {
  spawnBurst(enemy.group.position, new THREE.Color(0xffa030), 40, 9, 0.9);
  spawnBurst(enemy.group.position, new THREE.Color(0x555c66), 25, 6, 1.1);
  scene.remove(enemy.group);
  enemies.splice(enemies.indexOf(enemy), 1);
  enemyBodies.splice(enemyBodies.indexOf(enemy.body), 1);
  sfx.kill();
  state.kills++;
  document.getElementById('kills').textContent = state.kills;
  const wave = 1 + Math.floor(state.kills / 6);
  if (wave !== state.wave) {
    state.wave = wave;
    document.getElementById('wave').textContent = wave;
  }
  state.respawnQueue.push(state.time + 2.5);
  if (state.kills % 6 === 0 && state.maxEnemies < 16) {
    state.maxEnemies++;
    state.respawnQueue.push(state.time + 1);
  }
}

// enemy projectiles
const bolts = [];
const boltGeo = new THREE.SphereGeometry(0.14, 8, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: 0xff5522 });
function fireBolt(from, target) {
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.position.copy(from);
  const dir = target.clone().sub(from).normalize();
  // slight inaccuracy so the player can dodge
  dir.x += (Math.random() - 0.5) * 0.06;
  dir.y += (Math.random() - 0.5) * 0.04;
  dir.z += (Math.random() - 0.5) * 0.06;
  bolt.userData = { vel: dir.normalize().multiplyScalar(26), life: 4 };
  scene.add(bolt);
  bolts.push(bolt);
  sfx.enemyShot();
}

// ------------------------------------------------------------------ state --
const state = {
  playing: false,
  dead: false,
  time: 0,
  hp: 100,
  lastDamage: -99,
  kills: 0,
  wave: 1,
  maxEnemies: 7,
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
};

function resetGame() {
  for (const e of enemies) scene.remove(e.group);
  enemies.length = 0; enemyBodies.length = 0;
  for (const b of bolts) scene.remove(b);
  bolts.length = 0;
  Object.assign(state, {
    dead: false, hp: 100, kills: 0, wave: 1, maxEnemies: 7,
    mag: 30, reloading: 0, fireCooldown: 0, recoil: 0,
    yaw: 0, pitch: 0, vy: 0, lastDamage: -99,
  });
  state.respawnQueue.length = 0;
  camera.position.set(0, terrainHeight(0, 8) + EYE_HEIGHT, 8);
  document.getElementById('kills').textContent = '0';
  document.getElementById('wave').textContent = '1';
  for (let i = 0; i < state.maxEnemies; i++) spawnEnemy(camera.position);
}

// ------------------------------------------------------------------ input --
ui.playBtn.addEventListener('click', () => {
  initAudio();
  if (state.dead || enemies.length === 0) resetGame();
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  state.playing = document.pointerLockElement === renderer.domElement;
  ui.overlay.classList.toggle('hidden', state.playing);
  if (!state.playing) {
    ui.playBtn.textContent = state.dead ? 'REDEPLOY' : 'RESUME';
    state.mouseDown = false;
  }
});
document.addEventListener('mousemove', (e) => {
  if (!state.playing) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch -= e.movementY * 0.0022;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -1.45, 1.45);
});
document.addEventListener('mousedown', (e) => { if (state.playing && e.button === 0) state.mouseDown = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) state.mouseDown = false; });
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
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
  muzzleFlash.intensity = 14;

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  // slight spread when moving
  const moving = state.vel.lengthSq() > 1;
  if (moving) {
    raycaster.ray.direction.x += (Math.random() - 0.5) * 0.012;
    raycaster.ray.direction.y += (Math.random() - 0.5) * 0.012;
    raycaster.ray.direction.normalize();
  }
  gun.getWorldPosition(_muzzleWorld);
  const hits = raycaster.intersectObjects([...enemyBodies, terrain], false);
  let end;
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;
    const enemy = hit.object.userData.enemy;
    if (enemy) {
      enemy.hp--;
      enemy.flashTimer = 0.1;
      ui.hitmarker.style.opacity = '1';
      setTimeout(() => (ui.hitmarker.style.opacity = '0'), 90);
      sfx.hit();
      spawnBurst(hit.point, new THREE.Color(0xffcf60), 8, 5, 0.4);
      if (enemy.hp <= 0) killEnemy(enemy);
    } else {
      spawnBurst(hit.point, new THREE.Color(0x9c8f70), 6, 3, 0.5);
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
  setTimeout(() => { if (state.hp > 0) ui.vignette.style.opacity = '0'; }, 200);
  if (state.hp <= 0) {
    state.hp = 0;
    state.dead = true;
    ui.deathStats.style.display = 'block';
    ui.deathStats.textContent = `전사했습니다 — 처치 ${state.kills} · 웨이브 ${state.wave}`;
    document.exitPointerLock();
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
  if (state.playing && !state.dead) {
    if (keys.KeyW) _move.add(_fwd);
    if (keys.KeyS) _move.sub(_fwd);
    if (keys.KeyD) _move.add(_right);
    if (keys.KeyA) _move.sub(_right);
  }
  const inWater = camera.position.y - EYE_HEIGHT < WATER_LEVEL + 0.3;
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 11.5 : 7) * (inWater ? 0.55 : 1);
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

  // head bob + recoil on the gun
  const bob = Math.sin(state.time * 10) * 0.012 * Math.min(state.vel.length() / 7, 1) * (state.grounded ? 1 : 0);
  state.recoil = Math.max(0, state.recoil - dt * 4);
  gun.position.set(0.24, -0.2 + bob, -0.5 + state.recoil * 0.09);
  gun.rotation.x = state.recoil * 0.14;
  muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - dt * 160);

  // sun shadow follows the player
  sun.position.copy(camera.position).addScaledVector(sunDir, 180);
  sun.target.position.copy(camera.position);

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

  // --- health regen
  if (!state.dead && state.hp < 100 && state.time - state.lastDamage > 4) {
    state.hp = Math.min(100, state.hp + 12 * dt);
    if (state.time - state.lastDamage > 4.5) ui.vignette.style.opacity = '0';
  }
  ui.hpFill.style.width = `${state.hp}%`;

  // --- enemies
  if (!state.dead) {
    for (let i = state.respawnQueue.length - 1; i >= 0; i--) {
      if (state.time >= state.respawnQueue[i] && enemies.length < state.maxEnemies) {
        state.respawnQueue.splice(i, 1);
        spawnEnemy(camera.position);
      }
    }
  }
  for (const e of enemies) {
    const p = e.group.position;
    _toPlayer.copy(camera.position).sub(p);
    _toPlayer.y = 0;
    const dist = _toPlayer.length();
    e.bobPhase += dt * 2;
    const targetY = terrainHeight(p.x, p.z) + 3.2 + Math.sin(e.bobPhase) * 0.35;
    p.y += (targetY - p.y) * Math.min(1, dt * 3);
    if (dist < 80 && dist > 11 && !state.dead) {
      _toPlayer.normalize();
      p.x += _toPlayer.x * 5.5 * dt;
      p.z += _toPlayer.z * 5.5 * dt;
    }
    e.group.lookAt(camera.position.x, p.y, camera.position.z);
    e.ring.rotation.z += dt * 2.5;
    if (e.flashTimer > 0) {
      e.flashTimer -= dt;
      e.body.material.emissive.setHex(0xff4020);
      e.body.material.emissiveIntensity = 1.5;
    } else {
      e.body.material.emissiveIntensity = 0;
    }
    e.fireTimer -= dt;
    if (e.fireTimer <= 0 && dist < 50 && state.playing && !state.dead) {
      e.fireTimer = 1.6 + Math.random() * 1.2;
      const from = p.clone();
      from.y += 0.2;
      fireBolt(from, camera.position);
    }
  }

  // --- enemy bolts
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.userData.life -= dt;
    b.position.addScaledVector(b.userData.vel, dt);
    const groundHit = b.position.y < terrainHeight(b.position.x, b.position.z);
    const playerHit = b.position.distanceTo(camera.position) < 1.1;
    if (playerHit) damagePlayer(11);
    if (b.userData.life <= 0 || groundHit || playerHit) {
      if (groundHit) spawnBurst(b.position, new THREE.Color(0xff7040), 6, 3, 0.4);
      scene.remove(b);
      bolts.splice(i, 1);
    }
  }

  updateParticles(dt);
  updateTracers(dt);

  // gentle water shimmer
  water.position.y = WATER_LEVEL + Math.sin(state.time * 0.8) * 0.08;
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
});

// populate the world behind the menu so the title screen shows the map
for (let i = 0; i < state.maxEnemies; i++) spawnEnemy(camera.position);

// debug handle for automated tests
window.__game = { scene, camera, renderer, terrain, state, sun, hemi };
