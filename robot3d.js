/* 3D replay of logged whole-body motion. The browser does the forward kinematics from the logged pelvis pose and
   joint angles (data/motion/*.bin), on the decimated G1 model (data/robot/). Loaded only when the section is near view. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const root = document.getElementById('demo-3d');
const $ = s => root.querySelector(s);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const getBin = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); });
const VAR = { frozen: '--arm-frozen', richer: '--arm-richer', A2: '--arm-richer', fixed_i0: '--arm-fixed', search: '--arm-search', vocab: '--arm-vocab' };
const ORDER = { frozen: 0, richer: 1, fixed_i0: 2, search: 3, A2: 0, vocab: 1 };
const NOTE = {
  b1w07: 'Two ordered goals. Only the hand-written rules finish; the others run out of selections.',
  b1w13: 'Two ordered goals. Three planners finish; the learned generation-0 rules do not.',
  c2w01: 'With the two calibrated long options the robot finishes; with the base options it runs out of selections.',
  c2w06: 'Same comparison on another world: the long options cover the distance in fewer selections.'
};

let renderer, scene, camera, controls, robotDoc, robotParts, meta, world = null, t = 0, T = 1, playing = false, last = 0, follow = true, focus = 0, visible = false, started = false;
const cache = {};

function setupScene() {
  const canvas = $('#r3-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, .05, 80); camera.up.set(0, 0, 1); camera.position.set(-2.2, -3.2, 2.0);
  controls = new OrbitControls(camera, canvas); controls.target.set(0, 0, .7); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.minDistance = .8; controls.maxDistance = 16;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, -4, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .5, far: 20 }); scene.add(sun, sun.target); scene.userData.sun = sun;
  const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(canvas); resize(); theme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { theme(); if (world) buildWorld(world); });
}
function theme() { scene.background = new THREE.Color(cssVar('--stage') || '#ffffff'); }

async function loadRobot() {
  const [doc, buf] = await Promise.all([getJSON('data/robot/robot.json'), getBin('data/robot/robot.bin')]);
  robotDoc = doc; robotDoc.chain.forEach(j => { j.Am = new THREE.Matrix4().set(...j.A); j.Bm = new THREE.Matrix4().set(...j.B); });
  robotParts = doc.parts.map(p => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.offset, p.vertices * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, p.index_offset, p.triangles * 3), 1)); g.computeVertexNormals();
    return { body: p.body, color: doc.colors[p.color], geometry: g };
  });
}

/* One robot: an Object3D per body, positioned by forward kinematics each frame. */
function makeRobot(armColor) {
  const group = new THREE.Group(), bodies = robotDoc.bodies.map(() => { const o = new THREE.Object3D(); o.matrixAutoUpdate = false; group.add(o); return o; });
  const tint = new THREE.Color(armColor), mats = {};
  robotParts.forEach(p => {
    const key = p.color.join(','), light = p.color[0] > .6;
    if (!mats[key]) { const c = new THREE.Color().setRGB(p.color[0], p.color[1], p.color[2], THREE.SRGBColorSpace); if (light) c.lerp(tint, .55); mats[key] = new THREE.MeshStandardMaterial({ color: c, roughness: .55, metalness: .1, flatShading: true, side: THREE.DoubleSide }); }
    const m = new THREE.Mesh(p.geometry, mats[key]); m.castShadow = true; bodies[p.body].add(m);
  });
  return { group, bodies, T: robotDoc.bodies.map(() => new THREE.Matrix4()), motion: new THREE.Matrix4(), tmp: new THREE.Matrix4() };
}
const AX = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function pose(r, a, k, out) {
  const n = a.frames, s = meta.stride, f = Math.min(Math.max(k, 0), n - 1), i = Math.min(Math.floor(f), n - 2), u = n > 1 ? f - i : 0, A = a.data, o = i * s, p = (i + 1) * s;
  const lerp = c => A[o + c] + (A[p + c] - A[o + c]) * u;
  qa.set(A[o + 4], A[o + 5], A[o + 6], A[o + 3]); qb.set(A[p + 4], A[p + 5], A[p + 6], A[p + 3]); qa.normalize(); qb.normalize(); qa.slerp(qb, u);
  const pelvis = robotDoc.bodies.indexOf('pelvis');
  r.T[pelvis].compose(new THREE.Vector3(lerp(0) / 1000, lerp(1) / 1000, lerp(2) / 1000), qa, new THREE.Vector3(1, 1, 1));
  for (const j of robotDoc.chain) {
    const q = j.angle >= 0 ? lerp(7 + j.angle) / 10000 * j.sign : 0;
    if (j.kind === 'revolute') r.motion.makeRotationAxis(AX[j.axis], q); else if (j.kind === 'prismatic') { r.motion.identity(); r.motion.elements[12 + 'XYZ'.indexOf(j.axis)] = q; } else r.motion.identity();
    r.T[j.child].copy(r.T[j.parent]).multiply(j.Am).multiply(r.motion).multiply(j.Bm);
  }
  r.bodies.forEach((b, i) => { b.matrix.copy(r.T[i]); b.matrixWorldNeedsUpdate = true; });
  if (out) { out.x = lerp(0) / 1000; out.y = lerp(1) / 1000; out.z = lerp(2) / 1000; }
}

function buildWorld(w) {
  if (w.root) scene.remove(w.root); const g = new THREE.Group(); w.root = g;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: cssVar('--stage') || '#ffffff', roughness: 1 })); floor.receiveShadow = true; g.add(floor);
  const grid = new THREE.GridHelper(8, 8, cssVar('--obst-line'), cssVar('--grid')); grid.rotation.x = Math.PI / 2; grid.position.z = .001; g.add(grid);
  const boxMat = new THREE.MeshStandardMaterial({ color: cssVar('--obst'), roughness: .9 });
  for (const b of meta.boxes[w.id]) { const m = new THREE.Mesh(new THREE.BoxGeometry(b[2], b[3], b[4]), boxMat); m.position.set(b[0], b[1], b[4] / 2); m.castShadow = m.receiveShadow = true; g.add(m); }
  w.goalMeshes = w.goals.map(q => { const m = new THREE.Mesh(new THREE.CircleGeometry(q[2], 40), new THREE.MeshBasicMaterial({ color: cssVar('--goal'), transparent: true, opacity: .35 })); m.position.set(q[0], q[1], .004); g.add(m); return m; });
  w.arms.forEach(a => {
    const color = cssVar(VAR[a.arm]); if (!a.robot) a.robot = makeRobot(color);
    g.add(a.robot.group); a.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color })); a.trailPts = new Float32Array(a.x.length * 3);
    for (let i = 0; i < a.x.length; i++) { a.trailPts[3 * i] = a.x[i] / 100; a.trailPts[3 * i + 1] = a.y[i] / 100; a.trailPts[3 * i + 2] = .01; }
    a.trail.geometry.setAttribute('position', new THREE.BufferAttribute(a.trailPts, 3)); g.add(a.trail);
  });
  scene.add(g);
}

async function loadWorld(id) {
  if (!cache[id]) cache[id] = (async () => {
    const w = await getJSON(`data/replays/${id}.json`); w.arms.sort((a, b) => ORDER[a.arm] - ORDER[b.arm]);
    await Promise.all(w.arms.map(async a => { const buf = await getBin(`data/motion/${a.run}.bin`); a.data = new Int16Array(buf); a.frames = a.data.length / meta.stride; a.end = (a.frames - 1) / meta.rate_hz; a.show = true; }));
    return w;
  })();
  const w = await cache[id]; if ($('#r3-world').value !== id) return;
  if (world && world.root) scene.remove(world.root);
  world = w; T = Math.max(...w.arms.map(a => a.end)); t = 0; $('#r3-seek').max = T.toFixed(1); focus = Math.max(0, w.arms.findIndex(a => a.passed));
  buildWorld(w); buildPanel(); placeCamera(); frame(true);
}
function buildPanel() {
  const box = $('#r3-arms'); box.textContent = ''; $('#r3-note').textContent = NOTE[world.id] || '';
  world.arms.forEach((a, i) => {
    const row = document.createElement('div'); row.className = 'arm3';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = a.show; cb.setAttribute('aria-label', 'Show ' + a.label);
    cb.addEventListener('change', () => { a.show = cb.checked; a.robot.group.visible = a.trail.visible = a.show; frame(true); });
    const name = document.createElement('button'); name.type = 'button'; name.className = 'arm3-name'; name.setAttribute('aria-pressed', String(i === focus)); name.title = 'Follow this robot';
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = `var(${VAR[a.arm]})`;
    const badge = document.createElement('span'); badge.className = 'badge ' + (a.passed ? 'pass' : 'fail'); badge.textContent = a.passed ? `passed ${a.time.toFixed(0)} s` : 'failed';
    name.append(sw, document.createTextNode(a.label + ' '), badge);
    name.addEventListener('click', () => { focus = i; follow = true; $('#r3-follow').setAttribute('aria-pressed', 'true'); $$('.arm3-name').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); placeCamera(); frame(true); });
    a.status = document.createElement('div'); a.status.className = 'meta'; row.append(cb, name, a.status); box.appendChild(row);
  });
}
const $$ = s => Array.from(root.querySelectorAll(s));
const here = { x: 0, y: 0, z: .8 };
function placeCamera() {
  const a = world.arms[focus]; pose(a.robot, a, t * meta.rate_hz, here);
  if (follow) { const off = new THREE.Vector3(-2.4, -3.3, 2.0); controls.target.set(here.x, here.y, .7); camera.position.copy(controls.target).add(off); }
  else { controls.target.set(0, 0, 0); camera.position.set(-5.5, -7.5, 8); }
  controls.update();
}
function frame(force) {
  if (!world) return; const k = t * meta.rate_hz, sun = scene.userData.sun;
  world.arms.forEach((a, i) => {
    a.robot.group.visible = a.trail.visible = a.show; if (!a.show) return;
    pose(a.robot, a, Math.min(k, a.frames - 1), i === focus ? here : null);
    const n = Math.max(0, Math.min(a.x.length, Math.floor((Math.min(t, a.end) - a.t0) / a.dt) + 1)); a.trail.geometry.setDrawRange(0, n);
    let s = 0; while (s < a.sel.length && a.sel[s][0] <= t) s++;
    a.status.textContent = t >= a.end ? (a.passed ? 'done' : 'stopped') : s ? `selection ${s}: ${a.sel[s - 1][1]}` : 'standing, warm-up';
  });
  if (!world.arms[focus].show) { const j = world.arms.findIndex(a => a.show); if (j >= 0) focus = j; }
  if (follow) { const f = world.arms[focus]; pose(f.robot, f, Math.min(k, f.frames - 1), here); const dx = here.x - controls.target.x, dy = here.y - controls.target.y; controls.target.x += dx; controls.target.y += dy; camera.position.x += dx; camera.position.y += dy; }
  sun.position.set(controls.target.x + 3, controls.target.y - 4, 7); sun.target.position.set(controls.target.x, controls.target.y, 0);
  const done = world.arms.filter(a => a.show).map(a => a.visits.map(v => v[1] <= t));
  world.goalMeshes.forEach((m, gi) => { m.material.opacity = done.some(d => d[gi]) ? .8 : .3; });
  $('#r3-seek').value = t; $('#r3-time').textContent = `${t.toFixed(1)} / ${T.toFixed(0)} s`;
  controls.update(); renderer.render(scene, camera);
}
function loop(now) {
  if (playing) { t += (now - last) / 1000 * Number($('#r3-speed').value); if (t >= T) { t = T; playing = false; $('#r3-play').textContent = 'Replay'; } }
  last = now; frame(); if (visible) requestAnimationFrame(loop);
}
function play() { if (t >= T) t = 0; playing = true; started = true; $('#r3-play').textContent = 'Pause'; }
function pause() { playing = false; $('#r3-play').textContent = t >= T ? 'Replay' : 'Play'; }

async function boot() {
  try {
    const probe = document.createElement('canvas'); if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');
    meta = await getJSON('data/motion/index.json'); setupScene(); await loadRobot();
    const sel = $('#r3-world');
    meta.worlds.forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = { b1w07: 'b1w07 · feedback rules, 4 planners', b1w13: 'b1w13 · feedback rules, 4 planners', c2w01: 'c2w01 · long options vs base', c2w06: 'c2w06 · long options vs base' }[id] || id; sel.appendChild(o); });
    sel.addEventListener('change', () => { pause(); loadWorld(sel.value).then(() => { if (started && !reduced) play(); }); });
    $('#r3-play').addEventListener('click', () => playing ? pause() : play());
    $('#r3-seek').addEventListener('input', e => { pause(); t = Number(e.target.value); $('#r3-play').textContent = 'Play'; frame(true); });
    $('#r3-follow').addEventListener('click', e => { follow = !follow; e.currentTarget.setAttribute('aria-pressed', String(follow)); placeCamera(); frame(true); });
    $('#r3-loading').remove(); await loadWorld(sel.value);
    new IntersectionObserver(es => { const v = es.some(e => e.isIntersecting); if (v && !visible) { visible = true; last = performance.now(); requestAnimationFrame(loop); if (!started && !reduced) play(); } visible = v; }, { threshold: .25 }).observe(root);
    window.__robot3d = { get t() { return t; }, seek(v) { t = v; frame(true); }, world: () => world, renderer };
  } catch (err) {
    const l = $('#r3-loading'); if (l) l.textContent = 'The 3D view could not start here (' + err.message + '). The 2D replay below shows the same attempts.'; console.error(err);
  }
}
const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); boot(); } }, { rootMargin: '600px' });
io.observe(root);
