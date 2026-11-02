// Chùa Live — màn hình 9:16: nhân vật leo bậc thang lên chùa
'use strict';
const W = 720, H = 1280;
const canvas = document.getElementById('scene');
let ctx = canvas.getContext('2d');
const mainCtx = ctx;
const isPixel = () => !cfg || !cfg.style || cfg.style.pixel !== false;
const video = document.getElementById('bg');
const ui = document.getElementById('ui');

let cfg = null, content = null, assetsBase = '', charList = [], frameList = [], musicList = [];
let packs = {};            // id -> {json, img:{file:{full,half,quarter}}, ready}
let chars = [];            // nhân vật đang hiển thị
let floats = [];           // chữ chúc phúc bay lên
let particles = [];
const byUser = new Map();  // userId -> char
const recentJoin = new Map(); // userId -> time
const joinQueue = [];
const donorQueue = [];
let donorBusy = false;
let now = 0, lastSpawn = 0, lastIdle = 0;
let scale = 1, dpr = 1, offX = 0, offY = 0;
const cam = { x: W / 2, y: H / 2, z: 1, anim: null };

// ---------------- Hình học bậc thang (toạ độ theo video 720x1280) ----------------
// [y, tâm x, nửa bề rộng mặt bậc đi được]
// Hình học bậc thang [y, tâm x, nửa bề rộng mặt bậc]: 'image' = 3 ảnh nền mới, 'video' = video cũ
const GEO = {
  image: { stairs: [[1330, 360, 312], [1200, 360, 300], [1120, 360, 285], [1040, 360, 255], [960, 360, 195], [880, 360, 152], [800, 360, 105], [760, 360, 80], [720, 360, 55], [700, 360, 42], [690, 360, 36]], start: 1205, emerge: 1335, door: 738, cloudTop: 1120 },
  video: { stairs: [[1300, 368, 300], [1180, 368, 278], [1100, 367, 255], [960, 368, 220], [880, 369, 172], [800, 372, 124], [720, 372, 80], [660, 372, 50], [640, 372, 39]], start: 1165, emerge: 1300, door: 690, cloudTop: 1060 },
};
let STAIRS = GEO.image.stairs, START_Y = GEO.image.start, EMERGE_Y = GEO.image.emerge, DOOR_Y = GEO.image.door, CLOUD_TOP = GEO.image.cloudTop;
function stairAt(y) {
  if (y >= STAIRS[0][0]) return { c: STAIRS[0][1], hw: STAIRS[0][2] };
  for (let i = 0; i < STAIRS.length - 1; i++) {
    const a = STAIRS[i], b = STAIRS[i + 1];
    if (y <= a[0] && y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0]); return { c: a[1] + (b[1] - a[1]) * t, hw: a[2] + (b[2] - a[2]) * t }; }
  }
  const l = STAIRS[STAIRS.length - 1]; return { c: l[1], hw: l[2] };
}
const BASE_HW = 270;
function charHeightAt(y) { return stairAt(y).hw * 0.64 * (cfg ? cfg.scene.charScale : 1); }
let STEP_K = 0.1; // dy mỗi bước = STEP_K * hw
function computeStepK() {
  const G = GEO[cfg.scene.stairs] || GEO.image;
  STAIRS = G.stairs; START_Y = G.start; EMERGE_Y = G.emerge; CLOUD_TOP = G.cloudTop;
  const vy = cfg.scene.vanishY; DOOR_Y = (!vy || vy === 690) ? G.door : Math.max(G.stairs[G.stairs.length - 1][0], Math.min(950, vy));
  let I = 0; for (let y = DOOR_Y; y < START_Y; y += 1) I += 1 / stairAt(y).hw;
  const s = cfg.scene;
  const cycle = s.stepsPerBow * s.stepSeconds + s.bowSeconds;
  const steps = Math.max(6, (s.climbSeconds / cycle) * s.stepsPerBow);
  STEP_K = I / steps;
}

// ---------------- Tải nhân vật ----------------
function loadImg(src) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
// ---------- 8-bit: thu nhỏ, giảm màu, viền đen 1 pixel ----------
function pixelateCanvas(img, tw, th, opts = {}) {
  const pad = opts.outline === false ? 0 : 1;
  tw = Math.max(1, Math.round(tw)); th = Math.max(1, Math.round(th));
  const c = document.createElement('canvas'); c.width = tw + pad * 2; c.height = th + pad * 2;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, pad, pad, tw, th);
  const id = x.getImageData(0, 0, c.width, c.height), d = id.data, W2 = c.width, H2 = c.height;
  const lv = opts.levels || 6, st = 255 / (lv - 1);
  const sat = opts.saturate ?? 1.25;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < (opts.alphaCut ?? 110)) { d[i + 3] = 0; continue; }
    d[i + 3] = 255;
    let r = d[i], g = d[i + 1], b = d[i + 2]; const m = (r + g + b) / 3;
    r = m + (r - m) * sat; g = m + (g - m) * sat; b = m + (b - m) * sat; // tăng độ rực kiểu 8-bit
    d[i] = Math.round(Math.max(0, Math.min(255, r)) / st) * st; d[i + 1] = Math.round(Math.max(0, Math.min(255, g)) / st) * st; d[i + 2] = Math.round(Math.max(0, Math.min(255, b)) / st) * st;
  }
  if (pad) { // viền tối bên ngoài
    const op = new Uint8Array(W2 * H2); for (let i = 0; i < W2 * H2; i++) op[i] = d[i * 4 + 3] ? 1 : 0;
    const oc = opts.outlineColor || [36, 20, 44];
    for (let yy = 0; yy < H2; yy++) for (let xx = 0; xx < W2; xx++) {
      const i = yy * W2 + xx; if (op[i]) continue;
      if ((xx > 0 && op[i - 1]) || (xx < W2 - 1 && op[i + 1]) || (yy > 0 && op[i - W2]) || (yy < H2 - 1 && op[i + W2])) { d[i * 4] = oc[0]; d[i * 4 + 1] = oc[1]; d[i * 4 + 2] = oc[2]; d[i * 4 + 3] = 255; }
    }
  }
  x.putImageData(id, 0, 0);
  c.pad = pad; return c;
}
const pixUrlCache = new Map();
function pixelateURL(url, tw, opts = {}) { // trả về dataURL ảnh đã 8-bit (khung, avatar)
  const key = url + '|' + tw + '|' + JSON.stringify(opts);
  if (pixUrlCache.has(key)) return pixUrlCache.get(key);
  const p = new Promise(res => { const im = new Image(); im.onload = () => { try { const th = tw * im.height / im.width; res(pixelateCanvas(im, tw, th, opts).toDataURL()); } catch (e) { res(url); } }; im.onerror = () => res(url); im.src = url; });
  pixUrlCache.set(key, p); if (pixUrlCache.size > 200) pixUrlCache.delete(pixUrlCache.keys().next().value);
  return p;
}
function mipOrPix(img, json) {
  if (!isPixel()) return mip(img);
  const ref = json.refHeight || img.height; const sc = ((cfg.style && cfg.style.charPixels) || 64) / ref;
  const pc = pixelateCanvas(img, img.width * sc, img.height * sc, { levels: 7, saturate: 1.15 });
  return { full: pc, half: pc, quarter: pc, pix: true, padU: pc.pad / sc };
}
function mip(img) {
  const mk = f => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * f)); c.height = Math.max(1, Math.round(img.height * f)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height); return c; };
  const half = mk(0.5); const q = document.createElement('canvas'); q.width = Math.max(1, half.width >> 1); q.height = Math.max(1, half.height >> 1);
  const qx = q.getContext('2d'); qx.imageSmoothingQuality = 'high'; qx.drawImage(half, 0, 0, q.width, q.height);
  return { full: img, half, quarter: q };
}
async function loadPacks() {
  const want = charList.filter(c => !(cfg.characters.disabled || []).includes(c.id));
  const next = {};
  for (const c of want) {
    const key = c.id + '|' + (isPixel() ? 'px' + ((cfg.style && cfg.style.charPixels) || 64) : 'hd') + '|' + JSON.stringify(c.json.animations).length + '|' + Object.keys(c.json.frames || {}).length;
    if (packs[c.id] && packs[c.id].key === key) { next[c.id] = packs[c.id]; continue; }
    const p = { id: c.id, key, json: c.json, img: {}, ready: false };
    const files = new Set(); Object.values(c.json.animations).forEach(a => (a.frames || []).forEach(f => files.add(f)));
    await Promise.all([...files].map(async f => { const i = await loadImg(c.base + encodeURIComponent(f) + '?v=' + (c.json.rev || 0)); if (i) p.img[f] = mipOrPix(i, c.json); }));
    p.ready = Object.keys(p.img).length > 0;
    if (p.ready) next[c.id] = p;
  }
  packs = next;
}
function pickPack() {
  const ids = Object.keys(packs); if (!ids.length) return null;
  const w = ids.map(id => Math.max(0, (cfg.characters.weights || {})[id] ?? 1));
  let s = w.reduce((a, b) => a + b, 0); if (s <= 0) return packs[ids[0]];
  let r = Math.random() * s; for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r <= 0) return packs[ids[i]]; }
  return packs[ids[0]];
}
function animFrames(p, name) {
  const A = p.json.animations;
  const alias = { walk_up: ['walk_up', 'walk_back'], bow: ['bow', 'bow_front', 'walk_up'], kneel: ['kneel', 'bow'], prostrate: ['prostrate', 'kneel', 'bow'], walk_left: ['walk_left', 'walk_right', 'walk_up'], walk_right: ['walk_right', 'walk_left', 'walk_up'] }[name] || [name];
  for (const a of alias) if (A[a] && A[a].frames && A[a].frames.length) return { frames: A[a].frames, fps: A[a].fps || 4, flip: a !== name && (name === 'walk_right' && a === 'walk_left' || name === 'walk_left' && a === 'walk_right') ? !A[a].flip : !!A[a].flip };
  return { frames: [Object.keys(p.img)[0]], fps: 1, flip: false };
}

// ---------------- Nhân vật ----------------
let uid = 0;
function laneFree(y) {
  let best = 0, bestD = -1;
  for (let k = 0; k < 7; k++) {
    const u = (Math.random() * 2 - 1) * 0.72;
    let d = 9; for (const c of chars) { if (Math.abs(c.y - y) < 60) d = Math.min(d, Math.abs(c.u - u)); }
    if (d > bestD) { bestD = d; best = u; }
  }
  return best;
}
function spawn(opts = {}) {
  const p = pickPack(); if (!p) return null;
  const y = opts.y ?? EMERGE_Y;
  const c = {
    id: ++uid, pack: p, kind: opts.kind || 'idle', user: opts.user || null, name: opts.user ? opts.user.nickname : '',
    y, u: opts.u ?? laneFree(START_Y), mode: 'emerge', t: 0, step: 0, stepT: 0, sinceBow: 0,
    frame: animFrames(p, 'walk_up').frames[0], prev: null, xf: 1, flip: false, alpha: 0,
    born: now, nameUntil: opts.user ? now + cfg.scene.nameSeconds : 0, blessed: false,
    timeline: null, tlI: 0, tlT: 0, aura: 0, auraOn: false, pendingKneel: 0, side: null, removing: false,
  };
  chars.push(c);
  if (c.user) byUser.set(c.user.id, c);
  return c;
}
function setFrame(c, f, flip = false) {
  if (c.frame === f && c.flip === flip) return;
  c.prev = c.frame; c.prevFlip = c.flip; c.frame = f; c.flip = flip; c.xf = 0;
}
function startTimeline(c, list, then) { c.timeline = list; c.tlI = 0; c.tlT = 0; c.tlThen = then; c.mode = 'action'; applyTL(c); }
function applyTL(c) { const it = c.timeline[c.tlI]; if (!it) return; const a = animFrames(c.pack, it.anim); setFrame(c, a.frames[0], a.flip); if (it.on) it.on(c); }
function bowTimeline() { return [{ anim: 'bow', dur: cfg.scene.bowSeconds }]; }
function kneelTimeline(rounds) {
  const L = [{ anim: 'bow', dur: 0.45 }, { anim: 'kneel', dur: 0.9, on: c => { c.auraOn = true; AudioMgr.sfx('chuong'); } }];
  for (let i = 0; i < rounds; i++) L.push({ anim: 'prostrate', dur: 1.15, on: c => burst(c, 18) }, { anim: 'kneel', dur: 0.85 });
  L.push({ anim: 'bow', dur: 0.5, on: c => { c.auraOn = false; } });
  return L;
}
function kneel(c, rounds) {
  c.nameUntil = Math.max(c.nameUntil, now + cfg.scene.nameSeconds);
  if (c.mode === 'emerge' || c.y > START_Y) { c.pendingKneel = rounds; return; }
  if (c.mode === 'action' && c.timeline && c.timeline.some(t => t.anim === 'prostrate')) { // đang lạy -> lạy thêm
    const extra = []; for (let i = 0; i < rounds; i++) extra.push({ anim: 'prostrate', dur: 1.15, on: cc => burst(cc, 18) }, { anim: 'kneel', dur: 0.85 });
    c.timeline.splice(c.timeline.length - 1, 0, ...extra); return;
  }
  startTimeline(c, kneelTimeline(rounds), cc => { cc.mode = 'walk'; cc.sinceBow = 0; });
}
function vanish(c) { if (c.removing) return; c.removing = true; c.mode = 'vanish'; c.t = 0; burst(c, 26, true); }
function blessText(c) {
  if (c.blessed || !c.user) return; c.blessed = true;
  const list = (content.blessings && content.blessings.length) ? content.blessings : ['Chúc {name} bình an'];
  const txt = list[Math.floor(Math.random() * list.length)].replace(/\{name\}/g, c.name);
  const h = charHeightAt(c.y);
  let y = c.y - h - 18;
  for (let k = 0; k < 6 && floats.some(f => f.t < f.dur * 0.6 && Math.abs(f.y - y) < 32); k++) y -= 32;
  floats.push({ text: txt, x: charX(c), y, t: 0, dur: cfg.scene.blessingSeconds });
  if (floats.length > 6) floats.splice(0, floats.length - 6);
}
function charX(c) { const s = stairAt(c.y); return s.c + c.u * s.hw; }

function updateChar(c, dt) {
  c.t += dt; c.xf = Math.min(1, c.xf + dt / 0.22);
  if (c.auraOn) c.aura = Math.min(1, c.aura + dt / 0.6); else c.aura = Math.max(0, c.aura - dt / 1.2);
  if (c.auraOn && Math.random() < dt * 14) particles.push(auraParticle(c));
  const s = cfg.scene;
  // hết thời gian hiển thị tên
  if (c.user && !c.blessed && now > c.nameUntil && !c.auraOn && c.mode !== 'action') {
    blessText(c);
    if (s.hideWithName) vanish(c);
  }
  const stepDur = s.stepSeconds;
  const walkStep = () => {
    c.stepT += dt;
    const hw = stairAt(c.y).hw;
    c.y -= STEP_K * hw * dt / stepDur;
    if (c.stepT >= stepDur) {
      c.stepT -= stepDur; c.step++;
      const a = animFrames(c.pack, 'walk_up'); setFrame(c, a.frames[c.step % a.frames.length], a.flip); c.xf = 1;
      return true;
    }
    return false;
  };
  switch (c.mode) {
    case 'emerge': {
      c.alpha = Math.min(1, c.alpha + dt / 1.2);
      walkStep();
      if (c.y <= START_Y) { c.mode = 'walk'; c.sinceBow = 0; if (c.pendingKneel) { const r = c.pendingKneel; c.pendingKneel = 0; kneel(c, r); } }
      break;
    }
    case 'walk': {
      c.alpha = Math.min(1, c.alpha + dt / 0.5);
      if (walkStep()) {
        c.sinceBow++;
        if (c.y <= DOOR_Y + 2) { blessText(c); vanish(c); break; }
        if (c.sinceBow >= s.stepsPerBow) {
          c.sinceBow = 0;
          startTimeline(c, bowTimeline(), cc => { cc.mode = 'walk'; maybeSide(cc); });
        }
      }
      if (c.y <= DOOR_Y) { blessText(c); vanish(c); }
      break;
    }
    case 'side': {
      const sd = c.side; sd.t += dt;
      const a = animFrames(c.pack, sd.dir < 0 ? 'walk_left' : 'walk_right');
      const fi = Math.floor(sd.t * a.fps) % a.frames.length; setFrame(c, a.frames[fi], a.flip); c.xf = 1;
      const hw = stairAt(c.y).hw, h = charHeightAt(c.y);
      c.u += sd.dir * (h * 0.55) * dt / hw;
      c.y -= STEP_K * hw * dt / stepDur * 0.25;
      if ((sd.dir < 0 && c.u <= sd.target) || (sd.dir > 0 && c.u >= sd.target) || sd.t > 4) { c.mode = 'walk'; const w = animFrames(c.pack, 'walk_up'); setFrame(c, w.frames[0], w.flip); }
      break;
    }
    case 'action': {
      c.tlT += dt;
      const it = c.timeline[c.tlI];
      if (it && c.tlT >= it.dur) {
        c.tlT = 0; c.tlI++;
        if (c.tlI >= c.timeline.length) { const th = c.tlThen; c.timeline = null; const w = animFrames(c.pack, 'walk_up'); setFrame(c, w.frames[c.step % w.frames.length], w.flip); th && th(c); }
        else applyTL(c);
      }
      break;
    }
    case 'vanish': {
      c.alpha = Math.max(0, c.alpha - dt / 0.9);
      if (c.alpha <= 0) c.dead = true;
      break;
    }
  }
}
function maybeSide(c) {
  return; // đã bỏ trạng thái đi sang trái / phải
  if (Math.random() > cfg.scene.sideWalkChance || c.y < 760) return;
  let target = c.u + (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.35);
  if (target > 0.72 || target < -0.72) target = c.u - (target - c.u);
  target = Math.max(-0.72, Math.min(0.72, target));
  c.mode = 'side'; c.side = { dir: Math.sign(target - c.u) || 1, target, t: 0 };
}

// ---------------- Hạt & hiệu ứng ----------------
function auraParticle(c) {
  const h = charHeightAt(c.y), x = charX(c);
  const a = Math.random() * Math.PI * 2, r = h * (0.15 + Math.random() * 0.45);
  return { x: x + Math.cos(a) * r, y: c.y - h * 0.45 + Math.sin(a) * r * 0.6, vx: (Math.random() - .5) * 10, vy: -(20 + Math.random() * 40) * h / 120, life: 0, max: 1.4 + Math.random(), size: (1.5 + Math.random() * 2.5) * Math.max(0.6, h / 120), hue: 40 + Math.random() * 15 };
}
function burst(c, n, up) {
  const h = charHeightAt(c.y), x = charX(c);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (30 + Math.random() * 70) * h / 120;
    particles.push({ x, y: c.y - h * (up ? 0.6 : 0.3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - (up ? 40 : 15) * h / 120, life: 0, max: 0.9 + Math.random() * 0.8, size: (1.2 + Math.random() * 2.4) * Math.max(0.6, h / 120), hue: 42 + Math.random() * 12 });
  }
}
function updateParticles(dt) {
  for (const p of particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; }
  particles = particles.filter(p => p.life < p.max);
  if (particles.length > 1500) particles.splice(0, particles.length - 1500);
}

// ---------------- Vẽ ----------------
function pickLevel(fr, drawH) { const r = drawH / fr.full.height; return r < 0.3 ? fr.quarter : r < 0.6 ? fr.half : fr.full; }
function drawSprite(c, file, flip, alpha, h) {
  const fr = c.pack.img[file]; if (!fr) return;
  const meta = (c.pack.json.frames || {})[file] || { w: fr.full.width, h: fr.full.height, ax: fr.full.width / 2, ay: fr.full.height };
  const ref = c.pack.json.refHeight || fr.full.height;
  const k = h / ref; const dw = meta.w * k, dh = meta.h * k;
  const x = charX(c), y = c.y + (c.bob || 0);
  const img = pickLevel(fr, dh);
  ctx.globalAlpha = alpha;
  const pu = fr.padU || 0; // viền pixel bên ngoài khung
  const ox = (meta.ax + pu) * k, oy = (meta.ay + pu) * k, ww = (meta.w + pu * 2) * k, hh = (meta.h + pu * 2) * k;
  if (fr.pix) ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(img, -ox, y - oy, ww, hh); ctx.restore(); }
  else ctx.drawImage(img, x - ox, y - oy, ww, hh);
  if (fr.pix) ctx.imageSmoothingEnabled = true;
}
function drawAura(c, h) {
  if (c.aura <= 0.01) return;
  const x = charX(c), y = c.y - h * 0.42, I = c.aura * cfg.scene.auraIntensity;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const R = h * (1.35 + 0.12 * Math.sin(now * 3));
  let g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, `rgba(255,236,170,${0.55 * I})`); g.addColorStop(0.35, `rgba(255,190,80,${0.32 * I})`); g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  // tia hào quang
  const n = 16, len = h * 2.1;
  ctx.translate(x, y); ctx.rotate(now * 0.35);
  for (let i = 0; i < n; i++) {
    ctx.rotate(Math.PI * 2 / n);
    const L = len * (0.75 + 0.25 * Math.sin(now * 2 + i * 1.7));
    const gg = ctx.createLinearGradient(0, 0, 0, -L);
    gg.addColorStop(0, `rgba(255,225,140,${0.42 * I})`); gg.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(-h * 0.035, 0); ctx.lineTo(0, -L); ctx.lineTo(h * 0.035, 0); ctx.fill();
  }
  ctx.restore();
  // vòng sáng dưới chân
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const ry = h * 0.16, rx = h * 0.7 * (1 + 0.1 * Math.sin(now * 4));
  g = ctx.createRadialGradient(x, c.y, 0, x, c.y, rx);
  g.addColorStop(0, `rgba(255,220,130,${0.5 * I})`); g.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawAuraFront(c, h) {
  if (c.aura <= 0.01) return;
  const x = charX(c), y = c.y - h * 0.45, I = c.aura * cfg.scene.auraIntensity;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, h * 0.6);
  g.addColorStop(0, `rgba(255,230,160,${0.18 * I})`); g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, h * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function drawChar(c) {
  const h = charHeightAt(c.y);
  c.bob = (c.mode === 'walk' || c.mode === 'emerge') ? -Math.sin(Math.min(1, c.stepT / cfg.scene.stepSeconds) * Math.PI) * h * 0.012 : 0;
  if (!isPixel()) drawAura(c, h);
  if ((c.mode === 'walk' || c.mode === 'action') && !c.auraOn && c.y < DOOR_Y + 45) c.alpha = Math.min(c.alpha, 0.3 + 0.7 * Math.max(0, (c.y - DOOR_Y) / 45));
  if (c.prev && c.xf < 1) { drawSprite(c, c.prev, c.prevFlip, c.alpha * (1 - c.xf), h); drawSprite(c, c.frame, c.flip, c.alpha * c.xf, h); }
  else drawSprite(c, c.frame, c.flip, c.alpha, h);
  ctx.globalAlpha = 1;
  if (!isPixel()) drawAuraFront(c, h);
}
function drawName(c) {
  if (!c.user || !cfg.scene.showNames) return;
  const show = now < c.nameUntil || c.auraOn || (c.mode === 'action' && c.timeline && c.timeline.some(t => t.anim === 'prostrate'));
  if (!show || c.alpha < 0.05) return;
  const h = charHeightAt(c.y);
  const fs = Math.max(11, Math.min(26, cfg.scene.nameFontSize * (0.5 + 0.75 * h / (BASE_HW * 0.64))));
  const x = charX(c), y = c.y - h * (c.frame && /kneel|prostrate/.test(c.frame) ? 0.62 : 1.04) - 6;
  const fadeIn = Math.min(1, (now - c.born) / 0.8), fadeOut = c.auraOn ? 1 : Math.min(1, (c.nameUntil - now) / 0.6);
  ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut, c.alpha));
  const txt = c.name.length > 18 ? c.name.slice(0, 17) + '…' : c.name;
  const col = c.kind === 'donor' || c.auraOn ? '#ffe28a' : '#fff6e0';
  if (isPixel()) pixelText(txt, x, y, 16, col, '#2a1030');
  else {
    ctx.font = `700 ${fs}px 'Noto Serif', serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.28; ctx.strokeStyle = 'rgba(40,18,0,.9)'; ctx.strokeText(txt, x, y);
    ctx.fillStyle = col; ctx.fillText(txt, x, y);
  }
  ctx.globalAlpha = 1;
}
// chữ kiểu 8-bit: font pixel + viền vuông 4 hướng
function pixelText(txt, x, y, size, fill, outline) {
  ctx.font = `${Math.round(size)}px 'PixelVN', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const o = Math.max(1.5, size / 9);
  ctx.fillStyle = outline;
  for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) ctx.fillText(txt, x + dx, y + dy);
  ctx.fillStyle = fill; ctx.fillText(txt, x, y);
}
function drawFloats(dt) {
  for (const f of floats) {
    f.t += dt; const k = f.t / f.dur;
    const a = k < 0.15 ? k / 0.15 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
    const y = f.y - k * 70;
    ctx.globalAlpha = a; ctx.font = isPixel() ? `16px 'PixelVN'` : `700 25px 'Dancing Script', 'Noto Serif', serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(f.text).width / 2 + 10;
    if (isPixel()) { const xx = Math.max(tw, Math.min(W - tw, f.x)); pixelText(f.text, xx, y, 16, '#ffe48a', '#3a1400'); continue; }
    const x = Math.max(tw, Math.min(W - tw, f.x));
    ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(70,30,0,.85)'; ctx.strokeText(f.text, x, y);
    const g = ctx.createLinearGradient(0, y - 26, 0, y); g.addColorStop(0, '#fff6cf'); g.addColorStop(1, '#ffc65a');
    ctx.fillStyle = g; ctx.shadowColor = 'rgba(255,190,70,.9)'; ctx.shadowBlur = 12; ctx.fillText(f.text, x, y); ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  floats = floats.filter(f => f.t < f.dur);
}
function drawParticles() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const a = 1 - p.life / p.max;
    ctx.fillStyle = `hsla(${p.hue},100%,75%,${a})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + a * 0.6), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
// mây che phía dưới: vẽ lại phần mây của video lên trên nhân vật với dải trong suốt
// ---------------- Video nền: nhiều video, đổi ngẫu nhiên, chuyển cảnh mờ dần ----------------
// Mỗi video có bộ đệm khung hình riêng -> khi video tua vòng lặp/chờ dữ liệu vẫn vẽ khung gần nhất (không nháy đen)
const video2 = document.createElement('video');
video2.muted = true; video2.loop = true; video2.playsInline = true; video2.preload = 'auto'; video2.id = 'bg2';
video2.style.cssText = getComputedStyle(video).cssText; video2.className = video.className;
video.insertAdjacentElement('afterend', video2);
const BS = 1.2, BW = Math.round(W * BS), BH = Math.round(H * BS); // bộ đệm nền 864x1536 (đúng độ phân giải ảnh gốc)
function mkBuf() { const c = document.createElement('canvas'); c.width = BW; c.height = BH; return { c, x: c.getContext('2d'), ready: false, t: -1 }; }
const slots = [{ el: video, buf: mkBuf(), id: null }, { el: video2, buf: mkBuf(), id: null }];
let curSlot = 0, bgTrans = null, nextSwitchAt = 0, videoList = [];
const vbuf = document.createElement('canvas'); vbuf.width = BW; vbuf.height = BH; const vbx = vbuf.getContext('2d');
let vbufReady = false;
function grab(slot) {
  const v = slot.el, b = slot.buf;
  if (slot.img) { if (!b.ready && slot.img.complete && slot.img.naturalWidth) { b.x.clearRect(0, 0, BW, BH); b.x.imageSmoothingEnabled = !isPixel(); b.x.drawImage(slot.img, 0, 0, BW, BH); b.ready = true; } return b.ready; }
  if (v.readyState >= 2 && !v.seeking && v.videoWidth) {
    const t = v.currentTime;
    if (t !== b.t || !b.ready) { b.x.drawImage(v, 0, 0, BW, BH); b.t = t; b.ready = true; }
  }
  return b.ready;
}
function updateVideoBuffer() {
  const cur = slots[curSlot];
  const okCur = grab(cur);
  if (bgTrans) {
    const nx = slots[1 - curSlot]; const okNx = grab(nx);
    if (okNx && bgTrans.start == null) bgTrans.start = performance.now();
    const k = bgTrans.start == null ? 0 : Math.min(1, (performance.now() - bgTrans.start) / (bgTrans.dur * 1000));
    if (okCur) { vbx.globalAlpha = 1; vbx.drawImage(cur.buf.c, 0, 0); }
    if (okNx && k > 0) { vbx.globalAlpha = okCur ? k : 1; vbx.drawImage(nx.buf.c, 0, 0); vbx.globalAlpha = 1; }
    vbufReady = vbufReady || okCur || okNx;
    if (k >= 1) { // xong chuyển cảnh
      if (!cur.img) cur.el.pause(); curSlot = 1 - curSlot; bgTrans = null; scheduleBgSwitch();
    } else if (bgTrans && performance.now() - bgTrans.t0 > 15000) { bgTrans = null; } // video mới lỗi -> bỏ qua
  } else if (okCur) { vbx.drawImage(cur.buf.c, 0, 0); vbufReady = true; }
  return vbufReady;
}
function enabledVideos() { const dis = (cfg.backgrounds && cfg.backgrounds.disabled) || []; const l = videoList.filter(v => !dis.includes(v.id)); return l.length ? l : videoList.slice(0, 1); }
function scheduleBgSwitch() { const s = (cfg.backgrounds && cfg.backgrounds.switchSeconds) || 0; nextSwitchAt = s > 0 ? performance.now() + s * 1000 : Infinity; }
function startBg(v, slotIdx) {
  const sl = slots[slotIdx]; sl.id = v.id; sl.def = v; sl.buf.ready = false; sl.buf.t = -1;
  if (v.type === 'image') { sl.el.pause(); sl.el.removeAttribute('src'); sl.el.load(); sl.img = new Image(); sl.img.src = v.url; }
  else { sl.img = null; sl.el.src = v.url; sl.el.playbackRate = cfg.scene.videoRate || 1; sl.el.play().catch(() => {}); }
}
function switchBg(forceId) {
  if (bgTrans) return;
  const list = enabledVideos(); const curId = slots[curSlot].id;
  let pick = forceId ? list.find(v => v.id === forceId) : null;
  if (!pick) { const others = list.filter(v => v.id !== curId); if (!others.length) { scheduleBgSwitch(); return; } pick = others[Math.floor(Math.random() * others.length)]; }
  const ni = 1 - curSlot; startBg(pick, ni);
  bgTrans = { dur: Math.max(0.2, (cfg.backgrounds && cfg.backgrounds.fadeSeconds) || 2), start: null, t0: performance.now() };
}
function initBg() {
  const list = enabledVideos(); if (!list.length) return;
  const first = (cfg.backgrounds && cfg.backgrounds.random !== false) ? list[Math.floor(Math.random() * list.length)] : list[0];
  startBg(first, curSlot); scheduleBgSwitch();
}
setInterval(() => { if (cfg && !bgTrans && performance.now() >= nextSwitchAt) switchBg(); }, 500);
// ---------------- Hiệu ứng ánh sáng trên ảnh nền ----------------
let motes = [];
function bgWeights() { // [def, weight] của nền hiện tại và nền đang chuyển tới
  const out = []; const cur = slots[curSlot];
  let k = 0; if (bgTrans && bgTrans.start != null) k = Math.min(1, (performance.now() - bgTrans.start) / (bgTrans.dur * 1000));
  if (cur.def) out.push([cur.def, 1 - k]);
  if (bgTrans) { const nx = slots[1 - curSlot]; if (nx.def && k > 0) out.push([nx.def, k]); }
  return out;
}
function fxOn() { return !cfg.effects || cfg.effects.enabled !== false; }
function drawHalo(h, w, I) {
  const t = now;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // quầng sáng thở
  const R = h.r * (1 + 0.05 * Math.sin(t * 0.9));
  let g = ctx.createRadialGradient(h.x, h.y, R * 0.15, h.x, h.y, R * 1.25);
  g.addColorStop(0, `rgba(255,240,190,${0.07 * w * I})`); g.addColorStop(0.35, `rgba(255,220,140,${0.09 * w * I})`); g.addColorStop(0.7, `rgba(255,200,110,${0.06 * w * I})`); g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, R * 1.25, 0, Math.PI * 2); ctx.fill();
  // tia hào quang xoay chậm, 2 lớp ngược chiều
  for (const [n, sp, len, a0] of [[28, 0.05, 1.55, 0.11], [16, -0.03, 1.9, 0.07]]) {
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(t * sp);
    for (let i = 0; i < n; i++) {
      ctx.rotate(Math.PI * 2 / n);
      const L = h.r * len * (0.8 + 0.2 * Math.sin(t * 1.3 + i * 2.1));
      const gg = ctx.createLinearGradient(0, h.r * 0.35, 0, L);
      gg.addColorStop(0, `rgba(255,236,170,${a0 * w * I * (0.6 + 0.4 * Math.sin(t * 2 + i))})`); gg.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = gg; ctx.beginPath(); const wd = h.r * 0.035; ctx.moveTo(-wd, h.r * 0.35); ctx.lineTo(0, L); ctx.lineTo(wd, h.r * 0.35); ctx.fill();
    }
    ctx.restore();
  }
  // vòng sáng lan toả
  for (let k = 0; k < 2; k++) {
    const p = ((t * 0.18 + k * 0.5) % 1); const rr = h.r * (0.75 + p * 0.9);
    ctx.strokeStyle = `rgba(255,225,150,${0.22 * (1 - p) * w * I})`; ctx.lineWidth = 3 + 6 * (1 - p);
    ctx.beginPath(); ctx.arc(h.x, h.y, rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
function drawGlow(x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.4, `rgba(${col},${a * 0.45})`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function drawBgEffects() {
  if (!fxOn()) return;
  const I = (cfg.effects && cfg.effects.intensity) || 1;
  for (const [d, w] of bgWeights()) {
    if (w <= 0.01) continue;
    if (d.halo) drawHalo(d.halo, w, I);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    (d.glows || []).forEach((gl, i) => { const ph = gl.twinkle ? Math.max(0, Math.sin(now * 1.7 + i * 2.39)) : 0.6 + 0.4 * Math.sin(now * 2.2 + i); drawGlow(gl.x, gl.y, gl.r * (0.85 + 0.25 * ph), gl.c || '255,230,150', (gl.twinkle ? 0.35 : 0.55) * ph * w * I); });
    (d.lanterns || []).forEach((p, i) => { const f = 0.75 + 0.25 * Math.sin(now * 7 + i * 1.3) * Math.sin(now * 3.1 + i); const sc = Math.max(0.5, (p[1] - 650) / 350); drawGlow(p[0], p[1], 34 * sc * f, '255,190,90', 0.45 * w * I * f); });
    if (d.door) { const f = 0.8 + 0.2 * Math.sin(now * 1.5); drawGlow(d.door[0], d.door[1], 60 * f, '255,214,140', 0.5 * w * I); }
    ctx.restore();
  }
}
// đốm sáng lơ lửng lấp lánh
function newMote(init) {
  const top = Math.random() < 0.6; // nhiều đốm ở nửa trên quanh hình Phật
  return { x: Math.random() * W, y: init ? Math.random() * H : (top ? Math.random() * 700 : H + 10), vy: -(4 + Math.random() * 14), sw: 10 + Math.random() * 30, ph: Math.random() * 6.28, fr: 0.4 + Math.random() * 1.2,
    r: 0.8 + Math.random() * 2.4, life: 0, max: 6 + Math.random() * 10, star: Math.random() < 0.18, hue: 38 + Math.random() * 20, front: Math.random() < 0.3 };
}
function updateMotes(dt) {
  if (!fxOn()) { motes.length = 0; return; }
  const target = Math.round(((cfg.effects && cfg.effects.motes) ?? 110));
  while (motes.length < target) motes.push(newMote(motes.length < target * 0.9 && now < 2));
  if (motes.length > target) motes.length = target;
  for (let i = 0; i < motes.length; i++) { const m = motes[i]; m.life += dt; m.y += m.vy * dt; if (m.life > m.max || m.y < -20) motes[i] = newMote(false); }
}
function drawMotes(front) {
  if (!fxOn()) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    if (m.front !== front) continue;
    const fade = Math.min(1, m.life / 1.2, (m.max - m.life) / 1.5);
    const tw = 0.5 + 0.5 * Math.sin(now * m.fr * 4 + m.ph);
    const a = Math.max(0, fade * (0.35 + 0.65 * tw));
    const x = m.x + Math.sin(now * m.fr + m.ph) * m.sw * 0.3, y = m.y;
    const r = m.r * (front ? 1.4 : 1);
    drawGlow(x, y, r * 5, `255,${200 + (m.hue | 0)},150`, 0.35 * a);
    ctx.fillStyle = `rgba(255,250,225,${a})`; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
    if (m.star && tw > 0.6) { // tia lấp lánh hình chữ thập
      const L = r * 7 * tw; ctx.strokeStyle = `rgba(255,245,210,${a * 0.8})`; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
    }
  }
  ctx.restore();
}
const cloud = document.createElement('canvas'); cloud.width = W; cloud.height = 240; const cx2 = cloud.getContext('2d');
function drawCloudCover() {
  if (!vbufReady) return;
  cx2.globalCompositeOperation = 'source-over'; cx2.clearRect(0, 0, W, 240);
  cx2.imageSmoothingEnabled = !isPixel(); cx2.drawImage(vbuf, 0, CLOUD_TOP * BS, BW, 220 * BS, 0, 0, W, 220);
  cx2.globalCompositeOperation = 'destination-in';
  const g = cx2.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  cx2.fillStyle = g; cx2.fillRect(0, 0, W, 220);
  if (isPixel()) ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cloud, 0, 0, W, 220, 0, CLOUD_TOP, W, 220);
  ctx.imageSmoothingEnabled = true;
}

// ---------------- Camera ----------------
const easeSine = t => -(Math.cos(Math.PI * t) - 1) / 2; // mượt, không giật
const camClamp = (z, x, y) => { const hw = W / 2 / z, hh = H / 2 / z; return [Math.max(hw, Math.min(W - hw, x)), Math.max(hh, Math.min(H - hh, y))]; };
// opts: { Z, ease (giây zoom vào/ra), hold (giây giữ), auto }
function camFocus(c, opts = {}) {
  return new Promise(res => {
    const s = cfg.scene;
    const Z = Math.max(1, opts.Z ?? s.zoomScale);
    if (cam.anim && cam.anim.res) { const r = cam.anim.res; cam.anim.res = null; r(); } // nhường cho lượt zoom mới
    // bắt đầu từ trạng thái camera hiện tại -> không bị giật khi chuyển giữa 2 lượt zoom
    cam.anim = { t: 0, e: Math.max(0.2, opts.ease ?? s.zoomEase), hold: opts.hold ?? s.zoomHold, Z, c, res, auto: !!opts.auto, z0: cam.z, x0: cam.x, y0: cam.y };
  });
}
function updateCam(dt) {
  const a = cam.anim; if (!a) { cam.x = W / 2; cam.y = H / 2; cam.z = 1; return; }
  a.t += dt;
  if (a.c && !a.c.dead) { const h = charHeightAt(a.c.y); a.tx = charX(a.c); a.ty = a.c.y - h * 0.5; }
  if (a.tx == null) { a.tx = W / 2; a.ty = H / 2; }
  // mục tiêu được làm mượt để camera bám theo nhân vật nhẹ nhàng
  a.sx = a.sx == null ? a.tx : a.sx + (a.tx - a.sx) * Math.min(1, dt * 3);
  a.sy = a.sy == null ? a.ty : a.sy + (a.ty - a.sy) * Math.min(1, dt * 3);
  const [txC, tyC] = camClamp(a.Z, a.sx, a.sy);
  let z, x, y;
  if (a.t < a.e) { const k = easeSine(a.t / a.e); z = a.z0 + (a.Z - a.z0) * k; x = a.x0 + (txC - a.x0) * k; y = a.y0 + (tyC - a.y0) * k; }
  else if (a.t < a.e + a.hold) { z = a.Z; x = txC; y = tyC; }
  else if (a.t < a.e * 2 + a.hold) { const k = easeSine((a.t - a.e - a.hold) / a.e); z = a.Z + (1 - a.Z) * k; x = txC + (W / 2 - txC) * k; y = tyC + (H / 2 - tyC) * k; }
  else { cam.anim = null; cam.x = W / 2; cam.y = H / 2; cam.z = 1; a.res && a.res(); lastAutoZoomEnd = now; return; }
  cam.z = z; const [cx, cy] = camClamp(z, x, y); cam.x = cx; cam.y = cy;
}
// Tự động zoom ngẫu nhiên vào người đang đi (ưu tiên người xem thật)
let lastAutoZoomEnd = 0, lastAutoTarget = null;
function autoZoomTick() {
  const s = cfg.scene;
  if (!s.autoZoom || cam.anim || donorBusy || previewHold || editMode) return;
  if (now - lastAutoZoomEnd < (s.autoZoomInterval ?? 5)) return;
  const ok = c => !c.removing && !c.dead && c.alpha > 0.9 && c.y > DOOR_Y + 90 && c.y < START_Y && (c.mode === 'walk' || c.mode === 'action') && !c.auraOn;
  let pool = chars.filter(c => ok(c) && c.user && c !== lastAutoTarget);
  if (!pool.length) pool = chars.filter(c => ok(c) && c !== lastAutoTarget);
  if (!pool.length) { lastAutoZoomEnd = now - (s.autoZoomInterval ?? 5) + 1; return; }
  // ưu tiên người vào live gần đây nhất
  pool.sort((a, b) => (b.user ? 1 : 0) - (a.user ? 1 : 0) || b.born - a.born);
  const c = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
  lastAutoTarget = c;
  camFocus(c, { Z: s.autoZoomScale ?? 1.7, ease: s.autoZoomEase ?? 1.6, hold: s.autoZoomHold ?? 2, auto: true });
}

// ---------------- Vòng lặp ----------------
let lastT = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60;
let lastFrameAt = performance.now();
function frame(t) {
  lastFrameAt = performance.now();
  const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t; now += dt;
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (cfg && Object.keys(packs).length) tick(dt);
  render(dt);
  requestAnimationFrame(frame);
}
// nếu cửa sổ bị che/thu nhỏ khiến requestAnimationFrame dừng, vẫn chạy logic bằng bộ hẹn giờ
setInterval(() => { const t = performance.now(); if (t - lastFrameAt > 120) { const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t; now += dt; if (cfg && Object.keys(packs).length) tick(dt); } }, 33);
function tick(dt) {
  const s = cfg.scene;
  // sinh nhân vật cho người xem đang chờ (hàng chờ dài thì sinh nhanh hơn)
  const interval = s.spawnInterval / (1 + joinQueue.length / 8);
  if (joinQueue.length && now - lastSpawn >= interval) {
    let active = chars.filter(c => !c.removing);
    if (active.length >= s.maxCharacters) {
      // nhường chỗ: người tự do trước, rồi người xem đã hết thời gian hiện tên / đi lâu nhất
      const victim = active.find(c => c.kind === 'idle') || active.filter(c => c.kind === 'viewer' && !c.auraOn && c.mode !== 'action').sort((a, b) => a.born - b.born)[0];
      if (victim) { blessText(victim); vanish(victim); }
      active = chars.filter(c => !c.removing);
    }
    if (active.length < s.maxCharacters + 3) {
      const u = joinQueue.shift();
      if (!byUser.has(u.id) && spawn({ kind: 'viewer', user: u })) stats.spawned++;
      lastSpawn = now;
    }
  }
  // người đi chùa tự do
  const viewers = chars.filter(c => c.user && !c.removing).length;
  const idleTarget = viewers > 0 || joinQueue.length ? s.idleWhenViewers : s.idleCount;
  const idleNow = chars.filter(c => c.kind === 'idle' && !c.removing).length;
  if (idleNow < idleTarget && now - lastIdle >= s.idleSpawnSeconds * (0.7 + Math.random() * 0.6)) { spawn({ kind: 'idle' }); lastIdle = now; }
  autoZoomTick();
  for (const c of chars) updateChar(c, dt);
  for (const c of chars) if (c.dead && c.user && byUser.get(c.user.id) === c) byUser.delete(c.user.id);
  chars = chars.filter(c => !c.dead);
  updateParticles(dt);
}
function render(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!cfg) return;
  updateCam(dt);
  const k = scale * dpr;
  // khung ngang (16:9): hai bên lấp bằng video nền phóng to + làm mờ, cảnh 9:16 ở giữa
  const haveVideo = updateVideoBuffer();
  if ((offX > 2 || offY > 2) && haveVideo) {
    const cw = canvas.width, ch = canvas.height, s2 = Math.max(cw / W, ch / H);
    ctx.save(); ctx.filter = 'blur(' + Math.round(18 * dpr) + 'px) brightness(0.55) saturate(1.2)';
    ctx.drawImage(vbuf, (cw - W * s2) / 2, (ch - H * s2) / 2, W * s2, H * s2); ctx.restore();
  }
  ctx.setTransform(k * cam.z, 0, 0, k * cam.z, offX * dpr + k * (W / 2 - cam.x * cam.z), offY * dpr + k * (H / 2 - cam.y * cam.z));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const px = isPixel();
  if (px) ctx.imageSmoothingEnabled = false;
  if (haveVideo) ctx.drawImage(vbuf, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  updateMotes(dt);
  const sorted = chars.slice().sort((a, b) => a.y - b.y);
  if (px) {
    // 8-bit: hiệu ứng ánh sáng vẽ ở độ phân giải thấp rồi phóng to không làm mịn -> hạt vuông kiểu game cổ
    fxLayer(fxB, () => { drawBgEffects(); drawMotes(false); for (const c of sorted) drawAura(c, charHeightAt(c.y)); });
  } else { drawBgEffects(); drawMotes(false); }
  for (const c of sorted) drawChar(c);
  drawCloudCover();
  if (px) fxLayer(fxF, () => { for (const c of sorted) drawAuraFront(c, charHeightAt(c.y)); drawParticles(); drawMotes(true); });
  else { drawParticles(); drawMotes(true); }
  for (const c of sorted) drawName(c);
  drawFloats(dt);
  ctx.restore();
}
// lớp hiệu ứng độ phân giải thấp
function mkFx() { const c = document.createElement('canvas'); return { c, x: c.getContext('2d') }; }
const fxB = mkFx(), fxF = mkFx();
function fxLayer(L, draw) {
  const res = Math.max(120, (cfg.style && cfg.style.fxRes) || 240);
  const f = canvas.width / res; // mỗi "pixel" hiệu ứng = f pixel màn hình
  const w = Math.ceil(canvas.width / f), h = Math.ceil(canvas.height / f);
  if (L.c.width !== w || L.c.height !== h) { L.c.width = w; L.c.height = h; }
  const T = mainCtx.getTransform();
  L.x.setTransform(1, 0, 0, 1, 0, 0); L.x.globalCompositeOperation = 'source-over'; L.x.globalAlpha = 1; L.x.clearRect(0, 0, w, h);
  L.x.setTransform(T.a / f, T.b / f, T.c / f, T.d / f, T.e / f, T.f / f);
  ctx = L.x; try { draw(); } finally { ctx = mainCtx; }
  mainCtx.save(); mainCtx.setTransform(1, 0, 0, 1, 0, 0); mainCtx.imageSmoothingEnabled = false; mainCtx.globalCompositeOperation = 'lighter';
  mainCtx.drawImage(L.c, 0, 0, w * f, h * f); mainCtx.restore();
}
function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  scale = Math.min(w / W, h / H);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  // căn giữa nếu cửa sổ lệch tỉ lệ
  const ox = (w - W * scale) / 2, oy = (h - H * scale) / 2;
  canvas.style.left = '0'; canvas.style.top = '0';
  ui.style.transform = `translate(${ox}px,${oy}px) scale(${scale})`;
  offX = ox; offY = oy;
}

// ---------------- Sự kiện LIVE ----------------
function welcome(u) {
  if (!cfg.layout.welcome.show) return;
  const list = document.getElementById('welcomeList');
  const first = list.firstElementChild; if (first && first.dataset.id === u.id) return;
  const row = document.createElement('div'); row.className = 'wrow'; row.dataset.id = u.id;
  const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = (u.nickname || '?').trim().charAt(0).toUpperCase();
  row.appendChild(ph);
  const n = document.createElement('div'); n.className = 'wn'; n.innerHTML = '<b></b> vừa vào chùa'; n.querySelector('b').textContent = u.nickname; row.appendChild(n);
  list.prepend(row);
  while (list.children.length > (cfg.layout.welcome.max || 6)) list.lastElementChild.remove();
  if (u.avatar) window.api.avatar(u.avatars && u.avatars.length ? u.avatars : u.avatar).then(d => { if (!d) return; const im = document.createElement('img'); im.referrerPolicy = 'no-referrer'; im.onload = () => { if (ph.isConnected) ph.replaceWith(im); }; setPixSrc(im, d, 16, { outline: false, alphaCut: 0, levels: 6 }); });
}
const stats = { joins: 0, chats: 0, likes: 0, gifts: 0, spawned: 0, dropped: 0, noId: 0 };
function onJoin(u, src) {
  if (!u || !u.id) { stats.noId++; return; }
  if (!u || !u.id) return;
  const s = cfg.scene;
  const last = recentJoin.get(u.id);
  if (byUser.has(u.id)) { const c = byUser.get(u.id); if (!c.removing && src === 'join') { c.nameUntil = Math.max(c.nameUntil, now + 4); } return; }
  if (last && now - last < s.rejoinCooldown) return;
  recentJoin.set(u.id, now);
  if (recentJoin.size > 3000) recentJoin.delete(recentJoin.keys().next().value);
  if (src === 'join') welcome(u);
  if (joinQueue.find(q => q.id === u.id)) return;
  joinQueue.push(u);
  if (joinQueue.length > 300) { stats.dropped += joinQueue.length - 300; joinQueue.splice(0, joinQueue.length - 300); }
  if (src === 'join') { AudioMgr.sfx('chime'); if (cfg.voice.greetEnabled) AudioMgr.say(fill(cfg.voice.greetTemplate, { name: voiceName(u.nickname) }), { low: true }); }
}
function tierFor(coins) { const ts = (cfg.tiers || []).slice().sort((a, b) => a.min - b.min); let t = ts[0]; for (const x of ts) if (coins >= x.min) t = x; return t; }
function onGift(ev) {
  const u = ev.user; if (!u || !u.id) return;
  const coins = Math.max(1, ev.coins || 1);
  const tier = tierFor(coins); if (!tier || coins < tier.min) return;
  // gộp nếu người này đang chờ trong hàng
  const q = donorQueue.find(d => d.user.id === u.id);
  if (q) { q.coins += coins; q.gift = ev.giftName; q.repeat = (q.repeat || 1) + (ev.repeat || 1); q.tier = tierFor(q.coins); return; }
  let c = byUser.get(u.id);
  if (!c || c.removing) {
    const qi = joinQueue.findIndex(x => x.id === u.id); if (qi >= 0) joinQueue.splice(qi, 1);
    c = spawn({ kind: 'donor', user: u, y: 1240 });
    if (!c) return;
  }
  c.kind = 'donor';
  c.nameUntil = Math.max(c.nameUntil, now + cfg.scene.nameSeconds);
  donorQueue.push({ user: u, c, coins, gift: ev.giftName, repeat: ev.repeat || 1, tier });
  pumpDonors();
}
function cardVars(o) {
  return { name: o.user.nickname, tier: o.tier.label || '', gift: o.gift, coins: o.coins, fortuneName: o.fortune.name || '', level: o.tier.fortuneLevel || '', fortune: o.fortune.meaning || '', verse: (o.fortune.verse || []).join(', ') };
}
async function pumpDonors() {
  if (donorBusy || !donorQueue.length) return;
  donorBusy = true;
  try {
    const d = donorQueue.shift();
    const c = d.c; const tier = d.tier;
    const rounds = tier.kneelRounds ?? cfg.scene.kneelRounds;
    kneel(c, rounds);
    // chuẩn bị nội dung & giọng đọc ngay để không bị trễ
    const fortune = pickFortune();
    const gift = (d.repeat > 1 ? d.repeat + ' ' : '') + (d.gift || 'quà');
    const vars = cardVars({ user: d.user, tier, fortune, gift, coins: d.coins });
    vars.name = voiceName(d.user.nickname); vars.verse = (fortune.verse || []).join('. ');
    const voiceText = fill(cfg.voice.thanksTemplate, vars).replace(/\s+([.,])/g, '$1').replace(/\.{2,}/g, '.');
    AudioMgr.prefetchThanks(voiceText);
    const avP = d.user.avatar ? window.api.avatar(d.user.avatars && d.user.avatars.length ? d.user.avatars : d.user.avatar) : Promise.resolve(null);
    // chờ nhân vật quỳ xuống
    const t0 = now; await waitUntil(() => (c.mode === 'action' && c.auraOn) || c.dead || now - t0 > 6);
    if (!c.dead) await camFocus(c);
    const av = await avP;
    if ((cfg.layout.card.delay || 0) > 0) await sleep(cfg.layout.card.delay * 1000);
    if (!previewHold) showCard({ user: d.user, tier, fortune, gift, coins: d.coins, avatar: av });
    const voiceP = AudioMgr.say(voiceText);
    const secs = (tier.cardSeconds > 0 ? tier.cardSeconds : cfg.scene.cardSeconds);
    await Promise.all([voiceP, sleep(secs * 1000)]);
    const cardRect = previewHold ? null : cardAvatarRect();
    if (!previewHold) hideCard();
    addToGallery({ user: d.user, tier, avatar: av, from: cardRect });
    await sleep(700);
  } catch (e) { window.api.log('Lỗi donate: ' + e.message, 'error'); }
  donorBusy = false;
  pumpDonors();
}
// ---------------- Avatar donate treo hai bên Đức Phật ----------------
let gallery = []; // { uid, el, size, side, born }
let gallerySide = 0;
function cardAvatarRect() {
  const el = curCard && curCard.el && curCard.el.querySelector('.dc-frame'); if (!el) return null;
  const L = cfg.layout.card; const fw = el.offsetWidth, fh = el.offsetHeight;
  return { x: (L.x ?? 360) - fw / 2, y: L.y + (el.offsetTop || 0), w: fw, h: fh };
}
function tierSize(tier) {
  const G = cfg.gallery || {}; if (tier.gallerySize > 0) return tier.gallerySize;
  const ts = (cfg.tiers || []).slice().sort((a, b) => a.min - b.min); const i = Math.max(0, ts.findIndex(t => t.min === tier.min));
  return Math.round((G.baseSize || 72) * Math.pow(G.sizeGrow || 1.2, i));
}
function addToGallery(o) {
  const G = cfg.gallery || {}; if (G.enabled === false || !o.user) return;
  const fr = frameById(o.tier.frame); if (!fr) return;
  // người này đã treo -> thay bằng cái mới (lớn hơn nếu mức cao hơn)
  const old = gallery.find(g => g.uid === o.user.id); let prevSize = 0;
  if (old) { prevSize = old.size; removeGalleryItem(old, true); }
  const size = Math.max(prevSize, tierSize(o.tier));
  const el = document.createElement('div'); el.className = 'gitem';
  const fh = size * fr.h / fr.w, dd = fr.r * size * 2 * 1.06;
  el.innerHTML = `<div class="gbob" style="animation-delay:${(-Math.random() * 4).toFixed(2)}s"><div class="gframe" style="width:${size}px;height:${fh}px"><img class="av"><img class="fr"></div>${G.showName !== false ? '<div class="gname"></div>' : ''}</div>`;
  const av = el.querySelector('.av'); av.referrerPolicy = 'no-referrer';
  Object.assign(av.style, { width: dd + 'px', height: dd + 'px', left: (fr.cx * size - dd / 2) + 'px', top: (fr.cy * fh - dd / 2) + 'px' });
  av.onerror = () => { av.onerror = null; av.src = defaultAvatar(o.user.nickname); };
  setPixSrc(av, o.avatar || defaultAvatar(o.user.nickname), 28, { outline: false, alphaCut: 0, levels: 6 });
  setPixSrc(el.querySelector('.fr'), fr.url, 72, { levels: 6 });
  const nm = el.querySelector('.gname'); if (nm) { nm.textContent = o.user.nickname; nm.style.fontSize = Math.max(11, Math.round(size * 0.16)) + 'px'; nm.style.maxWidth = (size + 30) + 'px'; if (o.tier.color) nm.style.color = o.tier.color; }
  // điểm xuất phát: chỗ avatar trên thẻ chúc phúc
  const f = o.from || { x: W / 2 - size / 2, y: 300, w: size };
  el.style.left = f.x + 'px'; el.style.top = f.y + 'px'; el.style.transform = `scale(${(f.w / size).toFixed(3)})`;
  document.getElementById('gallery').appendChild(el);
  const item = { uid: o.user.id, el, size, h: fh + (nm ? Math.max(11, size * 0.16) * 1.5 : 0), born: now, side: -1 };
  // chọn bên ít chỗ đã dùng hơn
  const used = [0, 1].map(sd => gallery.filter(g => g.side === sd).reduce((a, g) => a + g.size * g.h, 0));
  item.side = used[0] === used[1] ? (gallerySide++ % 2) : (used[0] < used[1] ? 0 : 1);
  gallery.push(item);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('fly'); layoutGallery(); }));
}
function removeGalleryItem(g, instant) {
  gallery = gallery.filter(x => x !== g);
  if (instant) { g.el.remove(); return; }
  g.el.classList.add('gone');
  setTimeout(() => g.el.remove(), 1300);
}
function galleryAreas() {
  const G = cfg.gallery || {};
  return [G.left || { x: 6, y: 20, w: 210, h: 360 }, G.right || { x: 508, y: 236, w: 206, h: 390 }];
}
function layoutGallery() {
  const areas = galleryAreas(), gap = 8;
  for (let guard = 0; guard < 50; guard++) {
    let overflow = null;
    for (const sd of [0, 1]) {
      const A = areas[sd];
      const items = gallery.filter(g => g.side === sd).sort((a, b) => b.born - a.born); // mới nhất ở trên
      let x = 0, y = 0, rowH = 0;
      for (const g of items) {
        const w = g.size + 10, h = g.h + 6;
        if (x > 0 && x + w > A.w) { x = 0; y += rowH + gap; rowH = 0; }
        if (y + h > A.h && !(x === 0 && y === 0)) { overflow = overflow && overflow.born < g.born ? overflow : g; continue; }
        // căn giữa theo bề rộng khu vực khi chỉ có 1 cột
        g.tx = A.x + x; g.ty = A.y + y;
        x += w + gap; rowH = Math.max(rowH, h);
      }
    }
    if (!overflow) break;
    // hết chỗ -> người treo lâu nhất tan biến
    const oldest = gallery.filter(g => g.side === overflow.side).sort((a, b) => a.born - b.born)[0] || overflow;
    removeGalleryItem(oldest, false);
  }
  for (const g of gallery) { g.el.style.left = g.tx + 'px'; g.el.style.top = g.ty + 'px'; if (g.el.classList.contains('fly')) g.el.style.transform = 'scale(1)'; }
}
function pickFortune() { const f = content.fortunes || []; return f.length ? f[Math.floor(Math.random() * f.length)] : { name: 'Bình An', verse: [], meaning: 'Bình an may mắn' }; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitUntil(fn) { return new Promise(r => { const i = setInterval(() => { if (fn()) { clearInterval(i); r(); } }, 50); }); }
function fill(tpl, o) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => o[k] !== undefined ? o[k] : m); }
function voiceName(n) { const s = String(n || '').replace(/[^\p{L}\p{N}\s.,'-]/gu, ' ').replace(/\s+/g, ' ').trim(); return s || 'quý Phật tử'; }

// ---------------- Thẻ donate ----------------
let curCard = null;
function frameById(id) { return frameList.find(f => f.id === id) || frameList[0]; }
function setPixSrc(img, url, w, opts) { img.src = url; if (isPixel() && url) pixelateURL(url, w, opts).then(u => { if (img.src === url || img.dataset.orig === url) img.src = u; }); img.dataset.orig = url; }
function defaultAvatar(name) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 110, 10, 128, 128, 140); g.addColorStop(0, '#ffdf9a'); g.addColorStop(1, '#a8661c');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#5a2c00'; x.font = "700 120px 'Noto Serif'"; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText((name || '?').trim().charAt(0).toUpperCase(), 128, 136);
  return c.toDataURL();
}
function showCard(o, instant) {
  hideCard(true);
  const L = cfg.layout.card, F = cfg.layout.fortune || {};
  const V = cardVars(o);
  const fr = frameById(o.tier.frame);
  const layer = document.getElementById('cardLayer');
  const el = document.createElement('div'); el.className = 'dcard';
  el.style.top = L.y + 'px'; el.style.left = (L.x ?? 360) + 'px';
  const size = L.size || 360;
  const fw = size * (fr ? Math.max(1, fr.w / fr.h) : 1);
  el.innerHTML = `${L.showRays !== false ? '<div class="dc-glow"></div><div class="dc-rays"></div>' : ''}
    ${L.headText ? '<div class="dc-head"></div>' : ''}
    <div class="dc-frame" style="width:${fw}px"><img class="av"><img class="fr"></div>
    <div class="dc-info"><div class="dc-name"></div><div class="dc-tier"></div><div class="dc-gift"></div></div>`;
  const av = el.querySelector('.av'), fimg = el.querySelector('.fr');
  if (fr) {
    setPixSrc(fimg, fr.url, 150, { levels: 7 });
    const fh = fw * fr.h / fr.w, dd = fr.r * fw * 2 * 1.06;
    Object.assign(av.style, { width: dd + 'px', height: dd + 'px', left: (fr.cx * fw - dd / 2) + 'px', top: (fr.cy * fh - dd / 2) + 'px' });
  }
  av.referrerPolicy = 'no-referrer'; av.onerror = () => { av.onerror = null; av.src = defaultAvatar(o.user.nickname); };
  setPixSrc(av, o.avatar || defaultAvatar(o.user.nickname), 48, { outline: false, alphaCut: 0, levels: 6 });
  if (L.headText) el.querySelector('.dc-head').textContent = fill(L.headText, V);
  const nm = el.querySelector('.dc-name'); nm.textContent = o.user.nickname; nm.style.fontSize = (L.nameSize || 40) + 'px'; nm.style.display = L.showName === false ? 'none' : '';
  if (o.tier.color) nm.style.color = o.tier.color;
  const tr = el.querySelector('.dc-tier'); tr.textContent = fill(L.tierText ?? '✦ {tier} ✦', V); tr.style.display = L.showTier === false || !tr.textContent ? 'none' : '';
  const gf = el.querySelector('.dc-gift'); gf.textContent = fill(L.giftText ?? 'Cúng dường {gift} · {coins} xu', V); gf.style.display = L.showGift === false || !gf.textContent ? 'none' : '';
  if (L.showName === false && L.showTier === false && L.showGift === false) el.querySelector('.dc-info').style.display = 'none';
  layer.appendChild(el);
  // ô quẻ (vị trí, kích thước riêng)
  let fe = null;
  if (F.show !== false) {
    fe = document.createElement('div'); fe.className = 'dfortune';
    Object.assign(fe.style, { left: (F.x ?? 360) + 'px', top: (F.y ?? 725) + 'px', width: (F.w || 540) + 'px', transform: `translateX(-50%) scale(${F.scale || 1})` });
    fe.innerHTML = '<div class="dc-fortune"><div class="ft-title"><span class="ft-name"></span><span class="ft-level"></span></div><div class="ft-verse"></div><div class="ft-meaning"></div></div>';
    fe.firstChild.style.setProperty('--fop', F.opacity ?? 0.92);
    fe.querySelector('.ft-name').textContent = fill(F.titleText ?? 'Quẻ {fortuneName}', V);
    const lv = fe.querySelector('.ft-level'); lv.textContent = o.tier.fortuneLevel || 'Cát'; lv.style.display = F.showLevel === false ? 'none' : '';
    const vs = fe.querySelector('.ft-verse'); vs.innerHTML = (o.fortune.verse || []).map(v => escapeHtml(v)).join('<br>'); vs.style.display = F.showVerse === false ? 'none' : '';
    const mn = fe.querySelector('.ft-meaning'); mn.textContent = o.fortune.meaning || ''; mn.style.display = F.showMeaning === false ? 'none' : '';
    layer.appendChild(fe);
  }
  if (instant) { el.classList.add('show'); fe && fe.classList.add('show'); }
  else requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('show'); fe && fe.classList.add('show'); }));
  curCard = { el, fe };
  attachCardEdit(el.querySelector('.dc-frame'), 'card'); if (fe) attachCardEdit(fe, 'fortune');
}
function hideCard(instant) {
  const c = curCard; if (!c) return; curCard = null;
  for (const el of [c.el, c.fe]) { if (!el) continue; if (instant) el.remove(); else { el.classList.remove('show'); el.classList.add('hide'); setTimeout(() => el.remove(), 900); } }
}
// xem trước thẻ & kéo-thả chỉnh vị trí trong chế độ chỉnh bố cục
let previewHold = false, previewTier = 0;
const PREVIEW_FORTUNE = { name: 'Viên Mãn', verse: ['Trăng tròn soi bóng mặt hồ', 'Ước mơ thành tựu, cơ đồ vững tay'], meaning: 'Ước nguyện viên mãn, mọi điều tròn đầy' };
function showPreview() {
  const ts = (cfg.tiers || []); const tier = ts[Math.min(previewTier, ts.length - 1)] || { label: 'Tín chủ', fortuneLevel: 'Cát' };
  showCard({ user: { nickname: 'Phật tử Minh An' }, tier, fortune: (content.fortunes && content.fortunes[0]) || PREVIEW_FORTUNE, gift: 'Hoa sen', coins: tier.min || 1, avatar: null }, true);
}
function attachCardEdit(el, key) {
  el.addEventListener('mousedown', e => {
    if (!editMode) return; e.preventDefault(); e.stopPropagation();
    const o = cfg.layout[key]; const sx = e.clientX, sy = e.clientY, ox = o.x ?? 360, oy = o.y;
    const target = key === 'card' ? curCard.el : curCard.fe;
    let nx = ox, ny = oy;
    const mv = ev => { nx = ox + (ev.clientX - sx) / scale; ny = oy + (ev.clientY - sy) / scale; target.style.left = nx + 'px'; target.style.top = ny + 'px'; };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); window.api.patchConfig({ layout: { [key]: { x: Math.round(nx), y: Math.round(ny) } } }); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
  el.addEventListener('wheel', e => {
    if (!editMode) return; e.preventDefault();
    if (key === 'card') window.api.patchConfig({ layout: { card: { size: Math.max(120, Math.min(700, (cfg.layout.card.size || 360) + (e.deltaY < 0 ? 10 : -10))) } } });
    else window.api.patchConfig({ layout: { fortune: { scale: Math.round(Math.max(0.4, Math.min(2, (cfg.layout.fortune.scale || 1) + (e.deltaY < 0 ? 0.05 : -0.05))) * 100) / 100 } } });
  }, { passive: false });
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- Bảng lời giảng ----------------
let sermonsData = [];
function sermonSource() { return (cfg.content.custom && cfg.content.sermons) ? cfg.content.sermons : content.sermons; }
let renderedSec = -1;
function onSermonLine(sec, line) {
  const box = document.getElementById('sermonLines');
  const S = sermonsData[sec]; if (!S) return;
  if (renderedSec !== sec || !box.firstElementChild) {
    renderedSec = sec;
    document.getElementById('sermonTitle').textContent = S.title;
    box.innerHTML = '<div class="sermon-inner"></div>';
    const inner = box.firstElementChild;
    S.lines.forEach((t, i) => { const d = document.createElement('div'); d.className = 'sline'; d.textContent = t; inner.appendChild(d); });
  }
  const inner = box.firstElementChild;
  [...inner.children].forEach((d, i) => { d.className = 'sline' + (i < line ? ' read' : i === line ? ' cur' : ''); });
  const cur = inner.children[line];
  if (cur) { const off = cur.offsetTop - box.clientHeight * 0.3; inner.style.transform = `translateY(${-Math.max(0, off)}px)`; }
}

// ---------------- Bố cục ----------------
function applyLayout() {
  const L = cfg.layout;
  for (const k of ['sermon', 'welcome']) {
    const el = document.getElementById(k), o = L[k];
    Object.assign(el.style, { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', fontSize: o.font + 'px', display: o.show ? '' : 'none' });
    el.style.setProperty('--op', o.opacity);
    el.classList.toggle('blur', o.blur !== false && o.opacity > 0.02);
  }
  const tb = document.getElementById('titleBar');
  tb.textContent = L.title.text || ''; tb.style.top = L.title.y + 'px'; tb.style.display = L.title.show && L.title.text ? '' : 'none';
  slots.forEach(sl => sl.el.playbackRate = cfg.scene.videoRate || 1);
}
let editMode = false;
function setupEdit() {
  // [id phần tử, đọc cấu hình, ghi cấu hình]
  const items = [
    ['sermon', () => cfg.layout.sermon, o => ({ layout: { sermon: o } }), true],
    ['welcome', () => cfg.layout.welcome, o => ({ layout: { welcome: o } }), true],
    ['chat', () => cfg.layout.chat || {}, o => ({ layout: { chat: o } }), true],
    ['camwrap', () => cfg.camera || {}, o => ({ camera: { x: o.x, y: o.y } }), false],
  ];
  for (const [id, get, put, resizable] of items) {
    const el = document.getElementById(id); if (!el) continue;
    let drag = null;
    el.addEventListener('mousedown', e => {
      if (!editMode) return;
      const r = el.getBoundingClientRect();
      if (resizable && e.clientX > r.right - 18 && e.clientY > r.bottom - 18) { drag = { resize: true }; return; } // góc resize
      drag = { sx: e.clientX, sy: e.clientY, x: get().x ?? el.offsetLeft, y: get().y ?? el.offsetTop }; e.preventDefault();
    });
    window.addEventListener('mousemove', e => { if (!drag || drag.resize) return; const nx = drag.x + (e.clientX - drag.sx) / scale, ny = drag.y + (e.clientY - drag.sy) / scale; el.style.left = nx + 'px'; el.style.top = ny + 'px'; drag.nx = nx; drag.ny = ny; });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const o = { x: Math.round(drag.nx ?? get().x ?? el.offsetLeft), y: Math.round(drag.ny ?? get().y ?? el.offsetTop) };
      if (resizable) { o.w = Math.round(el.offsetWidth); o.h = Math.round(el.offsetHeight); }
      drag = null; window.api.patchConfig(put(o));
    });
    el.addEventListener('wheel', e => {
      if (!editMode) return;
      if (id === 'camwrap') { const sz = Math.max(80, Math.min(600, (cfg.camera.size || 200) + (e.deltaY < 0 ? 10 : -10))); window.api.patchConfig({ camera: { size: sz } }); return; }
      const f = Math.max(10, Math.min(40, (get().font || 16) + (e.deltaY < 0 ? 1 : -1))); window.api.patchConfig(put({ font: f }));
    });
  }
}

// ---------------- Khởi động ----------------
let lastSwitchSec = null;
async function applyAll(first) {
  document.body.classList.toggle('pixel', isPixel());
  try { window.LiveExtra && LiveExtra.apply(); } catch (e) { console.error(e); }
  const ss = cfg.backgrounds && cfg.backgrounds.switchSeconds; if (!first && ss !== lastSwitchSec && !bgTrans) scheduleBgSwitch(); lastSwitchSec = ss;
  computeStepK();
  applyLayout();
  sermonsData = sermonSource();
  content.blessings = (cfg.content.custom && cfg.content.blessings) ? cfg.content.blessings : content._blessings;
  content.fortunes = (cfg.content.custom && cfg.content.fortunes) ? cfg.content.fortunes : content._fortunes;
  if (first) AudioMgr.setup(cfg, musicList, sermonsData, assetsBase); else AudioMgr.update(cfg, musicList, sermonsData);
  if (renderedSec >= 0) { renderedSec = -1; const st = AudioMgr.sermonState(); if (st.line >= 0) onSermonLine(st.sec, st.line); }
}
async function main() {
  const d = await window.api.init();
  cfg = d.config; content = d.content; content._blessings = content.blessings; content._fortunes = content.fortunes;
  assetsBase = d.assets.base; charList = d.characters; frameList = d.frames; musicList = d.music;
  resize(); window.addEventListener('resize', resize);
  setupEdit();
  await loadPacks();
  AudioMgr.onSermon = onSermonLine;
  await applyAll(true);
  videoList = d.videos || []; initBg();
  if (cfg.voice.sermonEnabled) setTimeout(() => AudioMgr.startSermon(), 1500);
  window.api.on('config', async c => { const charsChanged = JSON.stringify(c.characters) !== JSON.stringify(cfg.characters); const styleChanged = JSON.stringify(c.style) !== JSON.stringify(cfg.style); cfg = c; if (styleChanged) slots.forEach(sl => { if (sl.img) sl.buf.ready = false; }); if (charsChanged || styleChanged) await loadPacks(); applyAll(false); if (previewHold) showPreview(); if (gallery.length) layoutGallery(); });
  window.api.on('assets', async a => { charList = a.characters; frameList = a.frames; musicList = a.music; if (a.videos) videoList = a.videos; await loadPacks(); applyAll(false); });
  window.api.on('tiktok-state', st => { try { window.LiveExtra && LiveExtra.onTikTok(st); } catch {} });
  window.api.on('live-event', ev => {
    try {
      try { window.LiveExtra && LiveExtra.onEvent(ev); } catch (e) { console.error(e); }
      stats[ev.type === 'join' ? 'joins' : ev.type === 'chat' ? 'chats' : ev.type === 'gift' ? 'gifts' : 'likes']++;
      if (ev.type === 'join') onJoin(ev.user, 'join');
      else if (ev.type === 'chat' && cfg.scene.joinOnChat) onJoin(ev.user, 'chat');
      else if ((ev.type === 'like' || ev.type === 'follow' || ev.type === 'share') && cfg.scene.joinOnLike) onJoin(ev.user, 'like');
      else if (ev.type === 'gift') onGift(ev);
    } catch (e) { window.api.log('Lỗi stage: ' + e.message, 'error'); }
  });
  window.api.on('stage-cmd', cmd => {
    if (cmd.type === 'edit') { editMode = !!cmd.on; document.body.classList.toggle('edit', editMode); }
    else if (cmd.type === 'clear') { chars.forEach(vanish); joinQueue.length = 0; }
    else if (cmd.type === 'sermon-jump') AudioMgr.jumpSection(cmd.index);
    else if (cmd.type === 'sermon-stop') AudioMgr.stopSermon();
    else if (cmd.type === 'sermon-start') AudioMgr.startSermon();
    else if (cmd.type === 'music-next') AudioMgr.nextMusic();
    else if (cmd.type === 'say') AudioMgr.say(cmd.text);
    else if (cmd.type === 'gallery-clear') { gallery.slice().forEach(g => removeGalleryItem(g, false)); }
    else if (cmd.type === 'bg-next') switchBg(cmd.id);
    else if (cmd.type === 'card-preview') { previewHold = !!cmd.hold; previewTier = cmd.tier || 0; if (previewHold) showPreview(); else hideCard(); }
    else if (cmd.type === 'zoom-test') { const c = chars.find(x => !x.removing); if (c) camFocus(c); }
  });
  setInterval(() => {
    window.api.report({ stats, onScreen: chars.length, viewers: chars.filter(c => c.user).length, queue: joinQueue.length, donorQueue: donorQueue.length + (donorBusy ? 1 : 0), fps, sermon: AudioMgr.sermonState(), speaking: AudioMgr.speaking(), packs: Object.keys(packs).length });
  }, 1000);
  requestAnimationFrame(frame);
}
main().catch(e => { console.error(e); window.api && window.api.log('Stage lỗi khởi động: ' + e.message, 'error'); });
