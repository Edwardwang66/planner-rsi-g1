/* Interactive demos for the project page. No dependencies. Data: data/replays/*.json, data/options.json, data/regimes.json. */
(function () {
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const redraws = [];
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => redraws.forEach(f => f()));

/* ---------- arena: a top view in metres, y up ---------- */
class Arena {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.b = [-4, -4, 4, 4]; this.fit();
    if (window.ResizeObserver) new ResizeObserver(() => { this.fit(); if (this.onresize) this.onresize(); }).observe(canvas);
  }
  fit() {
    const w = this.c.getBoundingClientRect().width || 400; this.d = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(100, Math.round(w * this.d));
    if (this.c.width !== px) { this.c.width = px; this.c.height = px; }
    this.s = px / (this.b[2] - this.b[0]);
  }
  X(x) { return (x - this.b[0]) * this.s; }
  Y(y) { return (this.b[3] - y) * this.s; }
  toWorld(ev) {
    const r = this.c.getBoundingClientRect();
    return [this.b[0] + (ev.clientX - r.left) / r.width * (this.b[2] - this.b[0]), this.b[3] - (ev.clientY - r.top) / r.height * (this.b[3] - this.b[1])];
  }
  base(world, done) {
    const g = this.g, W = this.c.width, d = this.d;
    g.setLineDash([]); g.fillStyle = cssVar('--stage'); g.fillRect(0, 0, W, W);
    g.strokeStyle = cssVar('--grid'); g.lineWidth = d; g.beginPath();
    for (let v = this.b[0] + 1; v < this.b[2]; v++) { g.moveTo(this.X(v), 0); g.lineTo(this.X(v), W); g.moveTo(0, this.Y(v)); g.lineTo(W, this.Y(v)); }
    g.stroke();
    g.fillStyle = cssVar('--obst'); g.strokeStyle = cssVar('--obst-line'); g.lineWidth = d;
    for (const o of world.obstacles) {
      const x = this.X(o[0] - o[2] / 2), y = this.Y(o[1] + o[3] / 2), w = o[2] * this.s, h = o[3] * this.s;
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
    const muted = cssVar('--muted'); g.strokeStyle = muted; g.lineWidth = 1.5 * d; g.beginPath();
    const sx = this.X(0), sy = this.Y(0), a = 5 * d; g.moveTo(sx - a, sy); g.lineTo(sx + a, sy); g.moveTo(sx, sy - a); g.lineTo(sx, sy + a); g.stroke();
    const goal = cssVar('--goal'); g.font = `600 ${12 * d}px "Segoe UI",system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    world.goals.forEach((q, i) => {
      const x = this.X(q[0]), y = this.Y(q[1]), r = Math.max(q[2] * this.s, 6 * d);
      g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.globalAlpha = done && done[i] ? .85 : .18; g.fillStyle = goal; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = goal; g.lineWidth = 2 * d; g.stroke();
      if (world.goals.length > 1) { g.fillStyle = cssVar('--ink'); g.fillText(String(i + 1), x, y - r - 9 * d); }
    });
    g.fillStyle = muted; g.font = `${11 * d}px "Segoe UI",system-ui,sans-serif`; g.textAlign = 'right'; g.fillText('grid: 1 m', W - 8 * d, 12 * d);
  }
  line(pts, n, color, width, dash) {
    if (n < 2) return; const g = this.g; g.beginPath(); g.moveTo(this.X(pts[0]), this.Y(pts[1]));
    for (let i = 1; i < n; i++) g.lineTo(this.X(pts[2 * i]), this.Y(pts[2 * i + 1]));
    g.strokeStyle = color; g.lineWidth = width * this.d; g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash(dash ? dash.map(v => v * this.d) : []); g.stroke(); g.setLineDash([]);
  }
  robot(x, y, yaw, color) {
    const g = this.g, d = this.d, r = Math.max(.17 * this.s, 6 * d), cx = this.X(x), cy = this.Y(y);
    g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fillStyle = color; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = cssVar('--stage'); g.stroke();
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(yaw) * r * 1.7, cy - Math.sin(yaw) * r * 1.7); g.strokeStyle = color; g.lineWidth = 3 * d; g.lineCap = 'round'; g.stroke();
  }
}

/* ---------- 1. replay of logged attempts ---------- */
function replay(index) {
  const root = $('#demo-replay'); if (!root) return;
  const arena = new Arena($('#rp-canvas')), sel = $('#rp-world'), seek = $('#rp-seek'), playBtn = $('#rp-play'), timeOut = $('#rp-time'), lanes = $('#rp-lanes');
  const VAR = { frozen: '--arm-frozen', richer: '--arm-richer', A2: '--arm-richer', fixed_i0: '--arm-fixed', search: '--arm-search', vocab: '--arm-vocab' };
  const ORDER = { frozen: 0, richer: 1, fixed_i0: 2, search: 3, A2: 0, vocab: 1 };
  const FAMILY = { reach_region: '1 goal', ordered_two_visits: '2 ordered goals' };
  const WHY = { selection_cap: 'ran out of selections', clearance_stop_latched: 'held by the clearance guard', admission_clearance: 'held by the clearance guard' };
  const cache = {}; let group = 'fresh', world = null, t = 0, T = 1, playing = false, last = 0, started = false, playhead = null;

  function fill() {
    sel.textContent = '';
    index.filter(w => w.group === group).forEach(w => {
      const n = w.arms.filter(a => a.passed).length, o = el('option', null, `${w.id} · ${FAMILY[w.family] || w.family} · friction ${w.friction} · ${n} of ${w.arms.length} pass`);
      o.value = w.id; sel.appendChild(o);
    });
    const pick = group === 'fresh' ? index.find(w => w.group === group && w.arms.some(a => a.arm === 'richer' && a.passed) && w.arms.some(a => a.arm === 'frozen' && !a.passed))
      : index.find(w => w.group === group && w.arms.some(a => a.arm === 'vocab' && a.passed) && w.arms.some(a => a.arm === 'A2' && !a.passed));
    if (pick) sel.value = pick.id;
  }
  function load(id) {
    const p = cache[id] || (cache[id] = getJSON(`data/replays/${id}.json`).then(w => {
      w.arms.sort((a, b) => ORDER[a.arm] - ORDER[b.arm]);
      w.arms.forEach(a => {
        const n = a.x.length; a.pts = new Float32Array(2 * n);
        for (let i = 0; i < n; i++) { a.pts[2 * i] = a.x[i] / 100; a.pts[2 * i + 1] = a.y[i] / 100; }
        a.end = a.passed && a.time != null ? a.time : a.t0 + (n - 1) * a.dt; a.show = true;
      });
      return w;
    }));
    return p.then(w => { if (sel.value !== id) return; world = w; T = Math.max.apply(null, w.arms.map(a => a.end)); t = 0; seek.max = T.toFixed(1); build(); draw(); });
  }
  function build() {
    const box = $('#rp-arms'); box.textContent = ''; lanes.textContent = '';
    world.arms.forEach(a => {
      const row = el('label', 'arm'), cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.addEventListener('change', () => { a.show = cb.checked; draw(); });
      const name = el('span', 'name'), sw = el('span', 'sw'); sw.style.background = `var(${VAR[a.arm]})`;
      name.append(sw, document.createTextNode(a.label), el('span', 'badge ' + (a.passed ? 'pass' : 'fail'), a.passed ? 'passed' : 'failed'));
      const n = a.sel.length, meta = el('span', 'meta', a.passed ? `reached every goal in ${a.time.toFixed(1)} s with ${n} selections` : a.held === 'selection_cap' ? `used all ${n} selections without finishing` : `${WHY[a.held] || 'stopped'} after ${n} selection${n === 1 ? '' : 's'}`);
      a.now = el('span', 'meta'); meta.append(document.createElement('br'), a.now); row.append(cb, name, meta); box.appendChild(row);
      const lane = el('div', 'lane'); lane.title = a.label;
      a.sel.forEach(s => { const i = el('i'); i.style.left = (100 * s[0] / T) + '%'; i.style.background = `var(${VAR[a.arm]})`; lane.appendChild(i); });
      const b = el('b'); b.style.left = (100 * a.end / T) + '%'; b.style.background = `var(${VAR[a.arm]})`; lane.appendChild(b); lanes.appendChild(lane);
    });
    playhead = el('div', 'playhead'); lanes.appendChild(playhead);
    const groups = {}; world.arms.forEach(a => { const k = a.sel.map(s => s[1]).join(','); (groups[k] = groups[k] || []).push(a.label); });
    const same = Object.values(groups).filter(g => g.length > 1).map(g => g.join(' and '));
    $('#rp-note').textContent = same.length ? `Same options chosen, so the tracks coincide: ${same.join('; ')}.` : '';
  }
  function pose(a, time) {
    const n = a.x.length, k = Math.min(Math.max((time - a.t0) / a.dt, 0), n - 1), i = Math.min(Math.floor(k), n - 2 < 0 ? 0 : n - 2), f = n > 1 ? k - i : 0, j = Math.min(i + 1, n - 1);
    let dy = (a.yaw[j] - a.yaw[i]) / 100; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { x: (a.x[i] + (a.x[j] - a.x[i]) * f) / 100, y: (a.y[i] + (a.y[j] - a.y[i]) * f) / 100, yaw: a.yaw[i] / 100 + dy * f, n: i + 1 };
  }
  function draw() {
    if (!world) return; arena.base(world);
    for (const a of world.arms) {
      if (!a.show) continue; const c = cssVar(VAR[a.arm]), time = Math.min(t, a.end), p = pose(a, time);
      arena.line(a.pts, p.n, c, 2.5); arena.g.beginPath(); arena.g.moveTo(arena.X(a.pts[2 * p.n - 2]), arena.Y(a.pts[2 * p.n - 1])); arena.g.lineTo(arena.X(p.x), arena.Y(p.y));
      arena.g.strokeStyle = c; arena.g.lineWidth = 2.5 * arena.d; arena.g.stroke(); a.p = p;
    }
    for (const a of world.arms) if (a.show) arena.robot(a.p.x, a.p.y, a.p.yaw, cssVar(VAR[a.arm]));
    for (const a of world.arms) {
      let k = 0; while (k < a.sel.length && a.sel[k][0] <= t) k++;
      a.now.textContent = t >= a.end ? (a.passed ? 'done' : 'stopped') : k ? `selection ${k}: ${a.sel[k - 1][1]}` : 'standing, warm-up';
    }
    seek.value = t; timeOut.textContent = `${t.toFixed(1)} / ${T.toFixed(0)} s`; if (playhead) playhead.style.left = (100 * t / T) + '%';
  }
  function tick(now) {
    if (!playing) return; t += (now - last) / 1000 * Number($('#rp-speed').value); last = now;
    if (t >= T) { t = T; playing = false; playBtn.textContent = 'Replay'; }
    draw(); if (playing) requestAnimationFrame(tick);
  }
  function play() { if (!world) return; if (t >= T) t = 0; playing = true; started = true; playBtn.textContent = 'Pause'; last = performance.now(); requestAnimationFrame(tick); }
  function pause() { playing = false; playBtn.textContent = t >= T ? 'Replay' : 'Play'; }
  function choose() { const was = playing; pause(); load(sel.value).then(() => { if (was || started) play(); }); }

  playBtn.addEventListener('click', () => playing ? pause() : play());
  seek.addEventListener('input', () => { pause(); t = Number(seek.value); playBtn.textContent = 'Play'; draw(); });
  sel.addEventListener('change', choose);
  $('#rp-prev').addEventListener('click', () => { sel.selectedIndex = (sel.selectedIndex + sel.options.length - 1) % sel.options.length; choose(); });
  $('#rp-next').addEventListener('click', () => { sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length; choose(); });
  $$('[data-group]', root).forEach(b => b.addEventListener('click', () => {
    group = b.dataset.group; $$('[data-group]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); fill(); choose();
  }));
  arena.onresize = draw; redraws.push(draw); fill();
  load(sel.value).then(() => {
    if (reduced || !window.IntersectionObserver) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !started) { play(); io.disconnect(); } }, { threshold: .4 });
    io.observe(root);
  });
}

/* ---------- 2. playground: a simplified planner on measured executions ---------- */
function playground(options, index) {
  const root = $('#demo-play'); if (!root) return;
  const arena = new Arena($('#pg-canvas')), status = $('#pg-status'), BASE9 = ['reverse_left', 'reverse_right', 'reverse_straight', 'forward_left', 'forward_right', 'forward_left_0p5s', 'forward_right_0p5s', 'forward_left_1p0s', 'forward_right_1p0s'];
  const HARD = .25, HIT = .15, SOFT = .45, CELL = .1, N = 80, REACH = .17, TIME_CAP = 135;
  const unpack = a => { const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i] / 1000; return f; };
  const opts = options.map(o => ({ name: o.name, pulse: o.pulse_s, nom: unpack(o.nominal), dur: o.nominal_s, isNew: BASE9.indexOf(o.name) < 0,
    meas: { '1.2': o.measured['1.2'].map(m => ({ s: m.s, p: unpack(m.p) })), '0.3': o.measured['0.3'].map(m => ({ s: m.s, p: unpack(m.p) })) } }));
  const lib = new Set(BASE9);
  let world = { obstacles: [[1.5, .7, .7, 1.1], [-1.3, 1.9, 1.0, .6], [.5, -2.0, .9, .7], [-2.3, -.9, .6, 1.0]], goals: [[2.7, 1.7, .2], [-1.6, -2.5, .2]] };
  let fields = null, sim = null, anim = 0, busy = false, drag = null, runCount = 0;

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function inRect(x, y, m) {
    if (x < -4 + m || x > 4 - m || y < -4 + m || y > 4 - m) return true;
    for (const o of world.obstacles) if (Math.abs(x - o[0]) <= o[2] / 2 + m && Math.abs(y - o[1]) <= o[3] / 2 + m) return true;
    return false;
  }
  /* Route distance to a goal on a 0.1 m grid; cells near obstacles cost more, cells inside them are closed. */
  function field(goal) {
    const cost = new Float32Array(N * N).fill(Infinity), mult = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -4 + (i + .5) * CELL, y = -4 + (j + .5) * CELL; mult[j * N + i] = inRect(x, y, HARD - .05) ? 0 : inRect(x, y, SOFT) ? 4 : 1;
    }
    const heap = [], push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], lastItem = heap.pop(); if (heap.length) { heap[0] = lastItem; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const gi = Math.min(N - 1, Math.max(0, Math.floor((goal[0] + 4) / CELL))), gj = Math.min(N - 1, Math.max(0, Math.floor((goal[1] + 4) / CELL)));
    cost[gj * N + gi] = 0; push(0, gj * N + gi);
    while (heap.length) {
      const [c, k] = pop(); if (c > cost[k]) continue; const i = k % N, j = (k - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const q = b * N + a; if (!mult[q]) continue;
        const nc = c + CELL * (di && dj ? Math.SQRT2 : 1) * mult[q]; if (nc < cost[q]) { cost[q] = nc; push(nc, q); }
      }
    }
    return (x, y) => {
      const e = Math.hypot(x - goal[0], y - goal[1]); if (e < .6) return e;
      const fx = (x + 4) / CELL - .5, fy = (y + 4) / CELL - .5, i = Math.max(0, Math.min(N - 2, Math.floor(fx))), j = Math.max(0, Math.min(N - 2, Math.floor(fy))), u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
      let s = 0, w = 0; const add = (k, wt) => { if (isFinite(cost[k])) { s += cost[k] * wt; w += wt; } };
      add(j * N + i, (1 - u) * (1 - v)); add(j * N + i + 1, u * (1 - v)); add((j + 1) * N + i, (1 - u) * v); add((j + 1) * N + i + 1, u * v);
      return w > 1e-6 ? s / w : e + 20;
    };
  }
  function prepare() { fields = world.goals.map(field); }
  /* Follow a body-frame path from a pose. Returns the end pose, or null when the path touches an obstacle; `hit` reports entering the goal. */
  function follow(pose, path, margin, goal, out) {
    const c = Math.cos(pose[2]), s = Math.sin(pose[2]); let entered = false, x = pose[0], y = pose[1];
    for (let k = 0; k < path.length; k += 3) {
      x = pose[0] + c * path[k] - s * path[k + 1]; y = pose[1] + s * path[k] + c * path[k + 1];
      if (inRect(x, y, margin)) return null;
      if (goal && !entered && Math.hypot(x - goal[0], y - goal[1]) <= REACH) entered = true;
    }
    out[0] = x; out[1] = y; out[2] = pose[2] + path[path.length - 1]; out[3] = entered ? 1 : 0; out[4] = goal ? Math.hypot(x - goal[0], y - goal[1]) : 9; return out;
  }
  /* Three-step lookahead on the planner's belief (each option's nominal path). Returns an option, or null. */
  function plan(pose, gi, banned) {
    const goal = world.goals[gi], final = gi === world.goals.length - 1, f = fields[gi], cand = opts.filter(o => lib.has(o.name));
    const reached = e => final ? e[4] <= REACH : e[3] === 1; let best = null, bestScore = Infinity; const second = [];
    const m0 = inRect(pose[0], pose[1], HARD) ? HIT : HARD;   // already inside the planning margin: fall back to the contact margin
    for (const a of cand) {
      if (a.name === banned) continue; const ea = follow(pose, a.nom, m0, goal, new Float32Array(5)); if (!ea) continue;
      let score = reached(ea) ? -100 + .01 * a.dur : f(ea[0], ea[1]);
      if (score > -50) for (const b of cand) {
        const eb = follow(ea, b.nom, HARD, goal, new Float32Array(5)); if (!eb) continue;
        if (reached(eb)) { score = Math.min(score, -50 + .01 * (a.dur + b.dur)); continue; }
        const v = f(eb[0], eb[1]); score = Math.min(score, v + .002 * (a.dur + b.dur)); second.push([v, a, eb, a.dur + b.dur]);
      }
      a._score = score; if (score < bestScore) { bestScore = score; best = a; }
    }
    if (bestScore > -50) {
      second.sort((p, q) => p[0] - q[0]); const tmp = new Float32Array(5);
      for (let k = 0; k < Math.min(24, second.length); k++) {
        const [, a, eb, d] = second[k];
        for (const c of cand) {
          const ec = follow(eb, c.nom, HARD, goal, tmp); if (!ec) continue;
          const v = reached(ec) ? -25 + .01 * (d + c.dur) : f(ec[0], ec[1]) + .002 * (d + c.dur);
          if (v < a._score) { a._score = v; if (v < bestScore) { bestScore = v; best = a; } }
        }
      }
    }
    return best;
  }
  function start(seed) {
    return { pose: [0, 0, 0], gi: 0, n: 0, time: 2, banned: null, trail: [0, 0], rand: rng(seed), done: false, pass: false, why: '', exec: null, visited: world.goals.map(() => false) };
  }
  function select(s) {
    if (s.n >= Number($('#pg-cap').value)) return finish(s, false, 'selection cap reached');
    const o = plan(s.pose, s.gi, s.banned); if (!o) return finish(s, false, 'no option is clear of the obstacles');
    const pool = o.meas[$('#pg-friction').value], e = pool[Math.floor(s.rand() * pool.length)];
    s.n++; s.exec = { o, e, k: 0, origin: s.pose.slice(), c: Math.cos(s.pose[2]), s: Math.sin(s.pose[2]) };
  }
  function finish(s, pass, why) { s.done = true; s.pass = pass; s.why = why; s.exec = null; }
  /* Advance the running execution to sample `upto` (10 Hz). */
  function advance(s, upto) {
    const x = s.exec, p = x.e.p, last = p.length / 3 - 1, to = Math.min(upto, last);
    for (; x.k <= to; x.k++) {
      const k = 3 * x.k, wx = x.origin[0] + x.c * p[k] - x.s * p[k + 1], wy = x.origin[1] + x.s * p[k] + x.c * p[k + 1];
      s.pose = [wx, wy, x.origin[2] + p[k + 2]]; s.trail.push(wx, wy);
      if (inRect(wx, wy, HIT)) return finish(s, false, 'touched an obstacle');
      const g = world.goals[s.gi];
      if (s.gi < world.goals.length - 1 && Math.hypot(wx - g[0], wy - g[1]) <= g[2]) { s.visited[s.gi] = true; s.gi++; }
    }
    if (x.k > last) {
      s.time += x.e.s; const moved = Math.hypot(s.pose[0] - x.origin[0], s.pose[1] - x.origin[1]); s.banned = $('#pg-rule').checked && moved < .03 ? x.o.name : null; s.exec = null;
      const g = world.goals[s.gi];
      if (s.gi === world.goals.length - 1 && Math.hypot(s.pose[0] - g[0], s.pose[1] - g[1]) <= g[2]) { s.visited[s.gi] = true; return finish(s, true, ''); }
      if (s.time > TIME_CAP) return finish(s, false, 'time limit reached');
    }
  }
  function runToEnd(seed) { const s = start(seed); while (!s.done) { if (!s.exec) select(s); else advance(s, 1e9); } return s; }

  function draw() {
    arena.base(world, sim ? sim.visited : null); if (!sim) { arena.robot(0, 0, 0, cssVar('--accent')); return; }
    if (sim.exec) {
      const x = sim.exec, nom = x.o.nom, pts = new Float32Array(2 * nom.length / 3);
      for (let k = 0; k < nom.length / 3; k++) { pts[2 * k] = x.origin[0] + x.c * nom[3 * k] - x.s * nom[3 * k + 1]; pts[2 * k + 1] = x.origin[1] + x.s * nom[3 * k] + x.c * nom[3 * k + 1]; }
      arena.line(pts, pts.length / 2, cssVar('--muted'), 2, [5, 5]);
    }
    arena.line(sim.trail, sim.trail.length / 2, cssVar('--accent'), 2.5); arena.robot(sim.pose[0], sim.pose[1], sim.pose[2], cssVar('--accent'));
  }
  function say(s) {
    status.textContent = '';
    if (!s) { status.textContent = `${lib.size} options in the library. Press Run once.`; return; }
    if (!s.done) { status.textContent = s.exec ? `Selection ${s.n} of ${$('#pg-cap').value}: ${s.exec.o.name} · goal ${s.gi + 1} of ${world.goals.length} · dashed line: what the planner expects` : 'Planning…'; return; }
    const g = world.goals[s.gi], d = Math.hypot(s.pose[0] - g[0], s.pose[1] - g[1]);
    status.append(el('strong', s.pass ? 'pass' : 'fail', s.pass ? 'Passed' : 'Failed'), document.createTextNode(s.pass ? ` with ${s.n} selections in about ${Math.round(s.time)} s.` : `: ${s.why} after ${s.n} selections, ${d.toFixed(1)} m from goal ${s.gi + 1}.`));
  }
  function stop() { cancelAnimationFrame(anim); anim = 0; }
  function reset() { stop(); sim = null; fields = null; say(null); draw(); }
  function runOnce() {
    if (busy || !lib.size) return; stop(); prepare(); sim = start(1000 + (++runCount)); let t0 = 0, pause = 0;
    const speed = reduced ? 1e6 : 60;   // samples per second: six times real time
    const frame = now => {
      if (!sim || sim.done) { draw(); say(sim); return; }
      if (!sim.exec) { if (now < pause) { anim = requestAnimationFrame(frame); return; } select(sim); t0 = now; }
      if (sim.exec) { advance(sim, Math.floor((now - t0) / 1000 * speed)); if (!sim.exec) pause = now + 60; }
      draw(); say(sim); if (!sim.done) anim = requestAnimationFrame(frame); else say(sim);
    };
    anim = requestAnimationFrame(frame);
  }
  function runBatch() {
    if (busy || !lib.size) return; stop(); prepare(); busy = true; $('#pg-batch').disabled = true; $('#pg-run').disabled = true; let i = 0, pass = 0, lastSim = null; const total = 100;
    const chunk = () => {
      const until = performance.now() + 30;
      while (i < total && performance.now() < until) { lastSim = runToEnd(5000 + i); pass += lastSim.pass ? 1 : 0; i++; }
      status.textContent = `Running attempt ${i} of ${total}…`;
      if (i < total) { setTimeout(chunk, 0); return; }
      busy = false; $('#pg-batch').disabled = false; $('#pg-run').disabled = false; sim = lastSim; draw();
      status.textContent = ''; status.append(el('strong', null, `${pass} of ${total}`), document.createTextNode(' attempts passed in this world with these settings. The last one is drawn.'));
      const tr = el('tr'); [String(lib.size), $('#pg-cap').value, $('#pg-rule').checked ? 'on' : 'off', $('#pg-friction').value, `${pass} / ${total}`].forEach(v => tr.appendChild(el('td', null, v)));
      const body = $('#pg-log tbody'); body.insertBefore(tr, body.firstChild); while (body.children.length > 6) body.removeChild(body.lastChild);
    };
    setTimeout(chunk, 0);
  }
  function freeSpot(minStart, others) {
    for (let k = 0; k < 400; k++) {
      const x = -3.4 + 6.8 * Math.random(), y = -3.4 + 6.8 * Math.random();
      if (Math.hypot(x, y) < minStart || inRect(x, y, .5) || others.some(o => Math.hypot(x - o[0], y - o[1]) < 1.2)) continue; return [x, y, .2];
    }
    return [2.5, 2.5, .2];
  }
  function randomWorld() {
    const count = Number($('#pg-goals').value);
    for (let attempt = 0; attempt < 30; attempt++) {
      const obstacles = [], n = 3 + Math.floor(Math.random() * 4);
      while (obstacles.length < n) { const w = .5 + .7 * Math.random(), h = .5 + .7 * Math.random(), x = -3.3 + 6.6 * Math.random(), y = -3.3 + 6.6 * Math.random(); if (Math.abs(x) < w / 2 + .7 && Math.abs(y) < h / 2 + .7) continue; obstacles.push([x, y, w, h]); }
      world = { obstacles, goals: [] }; while (world.goals.length < count) world.goals.push(freeSpot(1.2, world.goals));
      prepare(); let from = [0, 0], ok = true; world.goals.forEach((g, i) => { if (fields[i](from[0], from[1]) > 30) ok = false; from = g; }); if (ok) break;
    }
    reset();
  }
  function setGoals(n) { while (world.goals.length > n) world.goals.pop(); while (world.goals.length < n) world.goals.push(freeSpot(1.2, world.goals)); reset(); }

  const grid = $('#pg-options');
  opts.forEach(o => {
    const lab = el('label', o.isNew ? 'new' : ''), cb = el('input'); cb.type = 'checkbox'; cb.checked = lib.has(o.name); cb.value = o.name; lab.title = `${o.name}: ${o.pulse} s pulse`;
    cb.addEventListener('change', () => { if (cb.checked) lib.add(o.name); else lib.delete(o.name); reset(); }); lab.append(cb, document.createTextNode(o.name)); grid.appendChild(lab);
  });
  $$('[data-preset]', root).forEach(b => b.addEventListener('click', () => {
    const want = b.dataset.preset === 'all' ? opts.map(o => o.name) : b.dataset.preset === 'live' ? BASE9.filter(n => n.indexOf('0p5s') < 0) : BASE9;
    lib.clear(); want.forEach(n => lib.add(n)); $$('input', grid).forEach(cb => { cb.checked = lib.has(cb.value); }); reset();
  }));
  index.forEach(w => { const o = el('option', null, `${w.id} (${w.goals} goal${w.goals > 1 ? 's' : ''}, ${w.obstacles} obstacles)`); o.value = w.id; $('#pg-load').appendChild(o); });
  $('#pg-load').addEventListener('change', e => { const id = e.target.value; if (!id) return; getJSON(`data/replays/${id}.json`).then(w => { world = { obstacles: w.obstacles.map(o => o.slice()), goals: w.goals.map(g => g.slice()) }; $('#pg-goals').value = String(world.goals.length); reset(); }); });
  $('#pg-run').addEventListener('click', runOnce); $('#pg-batch').addEventListener('click', runBatch); $('#pg-random').addEventListener('click', () => { $('#pg-load').value = ''; randomWorld(); });
  $('#pg-goals').addEventListener('change', e => setGoals(Number(e.target.value)));
  $('#pg-cap').addEventListener('input', e => { $('#pg-cap-out').textContent = e.target.value; reset(); });
  $('#pg-rule').addEventListener('change', reset); $('#pg-friction').addEventListener('change', reset);

  const canvas = arena.c;
  canvas.addEventListener('pointerdown', ev => {
    if (busy) return; const [x, y] = arena.toWorld(ev); let hit = null;
    world.goals.forEach((g, i) => { if (!hit && Math.hypot(x - g[0], y - g[1]) < .35) hit = { item: g, dx: x - g[0], dy: y - g[1] }; });
    if (!hit) for (let i = world.obstacles.length - 1; i >= 0 && !hit; i--) { const o = world.obstacles[i]; if (Math.abs(x - o[0]) <= o[2] / 2 + .05 && Math.abs(y - o[1]) <= o[3] / 2 + .05) hit = { item: o, dx: x - o[0], dy: y - o[1] }; }
    if (!hit) return; drag = hit; canvas.setPointerCapture(ev.pointerId); reset(); ev.preventDefault();
  });
  canvas.addEventListener('pointermove', ev => {
    const [x, y] = arena.toWorld(ev);
    if (!drag) { const over = world.goals.some(g => Math.hypot(x - g[0], y - g[1]) < .35) || world.obstacles.some(o => Math.abs(x - o[0]) <= o[2] / 2 && Math.abs(y - o[1]) <= o[3] / 2); canvas.style.cursor = over ? 'grab' : 'default'; return; }
    drag.item[0] = Math.max(-3.7, Math.min(3.7, x - drag.dx)); drag.item[1] = Math.max(-3.7, Math.min(3.7, y - drag.dy)); draw();
  });
  const drop = () => { drag = null; }; canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop);
  arena.onresize = draw; redraws.push(draw); reset();
  window.__playground = { runToEnd: seed => { prepare(); return runToEnd(seed); }, setWorld: w => { world = w; reset(); }, lib };
}

/* ---------- 3. regime explorer ---------- */
function regimes(data) {
  const root = $('#demo-regime'); if (!root) return;
  const A = $('#rg-a'), B = $('#rg-b'), svg = $('#rg-chart'), tip = $('#rg-tip'), stats = $('#rg-stats'), detail = $('#rg-detail'); let budget = 2, picked = -1;
  data.regimes.forEach(r => { [A, B].forEach(s => { const o = el('option', null, r.label); o.value = r.key; s.appendChild(o); }); });
  A.value = 'ref'; B.value = 'f03';
  const get = k => data.regimes.find(r => r.key === k), sb = r => 2 * r / (1 + r);
  const ranks = v => { const order = v.map((x, i) => i).sort((i, j) => v[j] - v[i] || i - j), out = new Array(v.length); order.forEach((i, r) => { out[i] = r; }); return out; };
  const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
  function draw() {
    const a = get(A.value), b = get(B.value), xs = a.values, ys = b.values, top = Math.max(.2, Math.ceil(Math.max.apply(null, xs.concat(ys)) * 10 + 1e-9) / 10), step = top > .6 ? .2 : .1;
    const L = 52, R = 14, Tm = 14, Bm = 46, W = 440 - L - R, H = 440 - Tm - Bm, X = v => L + v / top * W, Y = v => Tm + H - v / top * H;
    const order = xs.map((x, i) => i).sort((i, j) => xs[j] - xs[i] || i - j), carried = order.slice(0, budget), bestB = Math.max.apply(null, ys), kept = Math.max.apply(null, carried.map(i => ys[i]));
    svg.textContent = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.appendChild(svgEl('line', { class: 'gridl', x1: X(v), x2: X(v), y1: Tm, y2: Tm + H })); svg.appendChild(svgEl('line', { class: 'gridl', x1: L, x2: L + W, y1: Y(v), y2: Y(v) }));
      const tx = svgEl('text', { x: X(v), y: Tm + H + 16, 'text-anchor': 'middle' }); tx.textContent = v.toFixed(1); svg.appendChild(tx);
      const ty = svgEl('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }); ty.textContent = v.toFixed(1); svg.appendChild(ty);
    }
    svg.appendChild(svgEl('line', { class: 'axis', x1: L, x2: L + W, y1: Tm + H, y2: Tm + H })); svg.appendChild(svgEl('line', { class: 'axis', x1: L, x2: L, y1: Tm, y2: Tm + H }));
    svg.appendChild(svgEl('line', { class: 'ref', x1: X(0), y1: Y(0), x2: X(top), y2: Y(top) }));
    const short = s => s.length > 44 ? s.slice(0, 42) + '…' : s;
    const lx = svgEl('text', { x: L + W / 2, y: 434, 'text-anchor': 'middle' }); lx.textContent = 'Pass rate · ' + short(a.label); svg.appendChild(lx);
    const ly = svgEl('text', { x: 14, y: Tm + H / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${Tm + H / 2})` }); ly.textContent = 'Pass rate · ' + short(b.label); svg.appendChild(ly);
    const drawOrder = xs.map((x, i) => i).sort((i, j) => (carried.indexOf(i) >= 0) - (carried.indexOf(j) >= 0));
    drawOrder.forEach(i => {
      const c = svgEl('circle', { cx: X(xs[i]), cy: Y(ys[i]), r: 6.5, class: 'dot' + (carried.indexOf(i) >= 0 ? ' carried' : '') + (ys[i] === bestB ? ' best' : '') + (i === picked ? ' sel' : '') });
      c.addEventListener('mouseenter', () => { tip.style.display = 'block'; tip.textContent = `Library ${i + 1}: ${xs[i].toFixed(3)} → ${ys[i].toFixed(3)}`; const box = svg.getBoundingClientRect(), k = box.width / 440; tip.style.left = Math.min(box.width - 170, X(xs[i]) * k + 10) + 'px'; tip.style.top = Math.max(0, Y(ys[i]) * k - 34) + 'px'; });
      c.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      c.addEventListener('click', () => { picked = i; draw(); });
      svg.appendChild(c);
    });
    const rho = corr(ranks(xs), ranks(ys)), ceil = a.split_half && b.split_half && a.key !== b.key ? Math.sqrt(sb(a.split_half) * sb(b.split_half)) : null;
    stats.textContent = '';
    const stat = (v, k) => { const s = el('div', 'stat'); s.append(el('div', 'v', v), el('div', 'k', k)); stats.appendChild(s); };
    stat(rho.toFixed(2), 'rank correlation between the two conditions' + (ceil ? `; noise alone would cap it near ${ceil.toFixed(2)}` : ''));
    stat(bestB.toFixed(3), 'pass rate of the best library in the second condition');
    stat(kept.toFixed(3), `best pass rate among the ${budget} carried over`);
    stat((bestB - kept).toFixed(3), 'lost by relying on memory. One pass rate has a standard error of about 0.03.');
    detail.textContent = '';
    if (picked >= 0) {
      detail.append(document.createTextNode(`Library ${picked + 1}: ${xs[picked].toFixed(3)} in the first condition, ${ys[picked].toFixed(3)} in the second.`)); const chips = el('div', 'chips');
      data.libraries[picked].forEach(n => chips.appendChild(el('code', null, n))); detail.appendChild(chips);
    } else detail.textContent = 'Click a dot to see which options that library holds.';
  }
  A.addEventListener('change', draw); B.addEventListener('change', draw);
  $$('[data-budget]', root).forEach(b => b.addEventListener('click', () => { budget = Number(b.dataset.budget); $$('[data-budget]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  draw();
}

/* ---------- 4. power of the handoff gate ---------- */
function gate() {
  const root = $('#demo-gate'); if (!root) return;
  const nIn = $('#gt-n'), wIn = $('#gt-w'), lIn = $('#gt-l'), svg = $('#gt-chart'), stats = $('#gt-stats'), tip = $('#gt-tip'), MAX = 400, ALPHA = .05;
  const lf = [0]; for (let i = 1; i <= MAX; i++) lf.push(lf[i - 1] + Math.log(i));
  const pmf = (n, k, p) => p <= 0 ? (k === 0 ? 1 : 0) : p >= 1 ? (k === n ? 1 : 0) : Math.exp(lf[n] - lf[k] - lf[n - k] + k * Math.log(p) + (n - k) * Math.log(1 - p));
  const tail = (n, k, p) => { let s = 0; for (let i = Math.max(k, 0); i <= n; i++) s += pmf(n, i, p); return Math.min(1, s); };
  /* Smallest number of wins among d decided worlds for which the one-sided sign test gives p <= alpha. */
  const need = [];
  for (let d = 0; d <= MAX; d++) { let w = d + 1; for (let k = 0; k <= d; k++) if (tail(d, k, .5) <= ALPHA) { w = k; break; } need.push(w); }
  function power(n, pw, pl) {
    const q = pw + pl; if (q <= 0) return 0; const r = pw / q; let s = 0;
    for (let d = 1; d <= n; d++) { if (need[d] > d) continue; const pd = pmf(n, d, q); if (pd < 1e-12) continue; s += pd * tail(d, need[d], r); }
    return s;
  }
  function draw() {
    const n = Number(nIn.value), pw = Number(wIn.value) / 100, pl = Number(lIn.value) / 100;
    $('#gt-n-out').textContent = String(n); $('#gt-w-out').textContent = wIn.value + ' %'; $('#gt-l-out').textContent = lIn.value + ' %';
    const p = power(n, pw, pl); let n80 = null; for (let k = 5; k <= MAX; k++) if (power(k, pw, pl) >= .8) { n80 = k; break; }
    let w0 = null; for (let k = 0; k <= n; k++) if (tail(k, k, .5) <= ALPHA) { w0 = k; break; }
    stats.textContent = ''; const stat = (v, k) => { const s = el('div', 'stat'); s.append(el('div', 'v', v), el('div', 'k', k)); stats.appendChild(s); };
    stat(Math.round(100 * p) + ' %', 'chance that the gate passes in one round'); stat(n80 ? String(n80) : 'over ' + MAX, 'fresh worlds needed for an 80 % chance');
    stat(w0 == null ? 'none' : String(w0), 'wins needed when there are no losses'); stat((pw >= pl ? '+' : '−') + Math.abs(Math.round(100 * (pw - pl))) + ' pts', 'true difference in pass rate');
    const L = 44, R = 14, Tm = 12, Bm = 40, W = 440 - L - R, H = 300 - Tm - Bm, X = v => L + (v - 10) / 190 * W, Y = v => Tm + H - v * H; svg.textContent = '';
    for (let v = 0; v <= 1.001; v += .2) { svg.appendChild(svgEl('line', { class: 'gridl', x1: L, x2: L + W, y1: Y(v), y2: Y(v) })); const t = svgEl('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }); t.textContent = Math.round(100 * v) + ' %'; svg.appendChild(t); }
    [10, 50, 100, 150, 200].forEach(v => { const t = svgEl('text', { x: X(v), y: Tm + H + 16, 'text-anchor': 'middle' }); t.textContent = String(v); svg.appendChild(t); });
    svg.appendChild(svgEl('line', { class: 'axis', x1: L, x2: L + W, y1: Tm + H, y2: Tm + H })); svg.appendChild(svgEl('line', { class: 'ref', x1: L, x2: L + W, y1: Y(.8), y2: Y(.8) }));
    const lx = svgEl('text', { x: L + W / 2, y: 294, 'text-anchor': 'middle' }); lx.textContent = 'Fresh worlds per round'; svg.appendChild(lx);
    const curve = []; let dstr = ''; for (let k = 10; k <= 200; k += 2) { const v = power(k, pw, pl); curve.push([k, v]); dstr += (dstr ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(v).toFixed(1); }
    svg.appendChild(svgEl('path', { class: 'line', d: dstr })); svg.appendChild(svgEl('circle', { class: 'mark', cx: X(n), cy: Y(p), r: 6 }));
    svg.onmousemove = ev => { const box = svg.getBoundingClientRect(), k = box.width / 440, x = (ev.clientX - box.left) / k, v = Math.round(10 + (x - L) / W * 190); if (v < 10 || v > 200) { tip.style.display = 'none'; return; } tip.style.display = 'block'; tip.textContent = `${v} worlds: ${Math.round(100 * power(v, pw, pl))} %`; tip.style.left = Math.min(box.width - 130, X(v) * k + 10) + 'px'; tip.style.top = Math.max(0, Y(power(v, pw, pl)) * k - 34) + 'px'; };
    svg.onmouseleave = () => { tip.style.display = 'none'; };
  }
  [nIn, wIn, lIn].forEach(i => i.addEventListener('input', draw));
  $$('[data-gate]', root).forEach(b => b.addEventListener('click', () => { const v = b.dataset.gate.split(','); nIn.value = v[0]; wIn.value = v[1]; lIn.value = v[2]; draw(); }));
  draw(); window.__gatePower = power;
}

function fail(id, err) { const box = $(id); if (box) { box.textContent = 'This demo could not load its data.'; } if (window.console) console.error(err); }
function boot() {
  gate();
  const idx = getJSON('data/replays/index.json');
  idx.then(replay).catch(e => fail('#demo-replay', e));
  Promise.all([getJSON('data/options.json'), idx]).then(r => playground(r[0], r[1])).catch(e => fail('#demo-play', e));
  getJSON('data/regimes.json').then(regimes).catch(e => fail('#demo-regime', e));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
