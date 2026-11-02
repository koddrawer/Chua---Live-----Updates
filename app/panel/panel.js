'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let cfg = null, D = null, lastJoined = null;
const STATES = [
  ['walk_up', 'Đi lên bậc thang (lưng)'], ['walk_down', 'Đi về phía trước (mặt)'],
  ['bow', 'Cúi chào Phật'], ['bow_front', 'Chắp tay vái (mặt)'], ['kneel', 'Quỳ'], ['prostrate', 'Vái lạy (quỳ cúi rạp)'], ['skip', '— bỏ khung này —'],
];
const VOICES = [['vi-VN-HoaiMyNeural', 'Hoài My (nữ, Việt)'], ['vi-VN-NamMinhNeural', 'Nam Minh (nam, Việt)']];

// ---------- tiện ích ----------
const get = (o, k) => k.split('.').reduce((a, p) => a == null ? a : a[p], o);
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function addLog(l) {
  const box = $('#log'); const d = document.createElement('div'); d.className = l.level || '';
  d.textContent = new Date(l.t || Date.now()).toLocaleTimeString() + '  ' + l.msg; box.appendChild(d);
  while (box.children.length > 500) box.firstChild.remove(); box.scrollTop = box.scrollHeight;
}
function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }

// ---------- tabs ----------
$$('#tabs button').forEach(b => b.onclick = () => { $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab)); });

// ---------- binding data-k ----------
function bindInputs() {
  $$('[data-k]').forEach(el => {
    const k = el.dataset.k;
    const handler = () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number' || el.type === 'range') { v = parseFloat(el.value); if (isNaN(v)) return; }
      else v = el.value;
      window.api.setConfig(k, v);
    };
    el.addEventListener(el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'password' || !el.type ? 'change' : 'input', handler);
    if (el.type === 'number') el.addEventListener('change', handler);
    if (el.type === 'range') { const sp = document.createElement('span'); sp.className = 'rv'; el.insertAdjacentElement('afterend', sp); el.addEventListener('input', () => sp.textContent = el.value); }
  });
}
function fillInputs() {
  $$('[data-k]').forEach(el => {
    if (document.activeElement === el) return;
    const v = get(cfg, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    if (el.type === 'range' && el.nextElementSibling && el.nextElementSibling.classList.contains('rv')) el.nextElementSibling.textContent = el.value;
  });
  $('#optTop').checked = !!cfg.window.stageOnTop; $('#optFrame').checked = cfg.window.stageFrame !== false;
  if (document.activeElement !== $('#tkUser')) $('#tkUser').value = cfg.tiktok.username || '';
}

// ---------- TikTok ----------
const ST = { connected: 'Đã kết nối', connecting: 'Đang kết nối…', disconnected: 'Chưa kết nối', error: 'Lỗi kết nối', ended: 'LIVE đã kết thúc' };
function showTk(s) {
  $('#tkDot').className = 'dot ' + s.status;
  $('#tkText').textContent = (ST[s.status] || s.status) + (s.username ? ' · @' + s.username : '') + (s.viewers ? ' · 👁 ' + s.viewers : '');
  $('#tkErr').textContent = s.err ? 'Lỗi: ' + s.err + ' — kiểm tra tài khoản đang LIVE và tên đúng.' : '';
}
$('#btnConnect').onclick = async () => { try { await window.api.connect($('#tkUser').value); } catch (e) { addLog({ msg: e.message, level: 'error' }); } };
$('#btnDisconnect').onclick = () => window.api.disconnect();

// ---------- Stage ----------
$('#btnStageOpen').onclick = () => window.api.openStage();
$('#btnStageClose').onclick = () => window.api.closeStage();
$$('[data-w]').forEach(b => b.onclick = () => window.api.stageSet({ w: +b.dataset.w, h: +b.dataset.h }));
let full = false; $('#btnFull').onclick = () => { full = !full; window.api.stageSet({ fullscreen: full }); };
$('#btnReload').onclick = () => window.api.stageSet({ reload: true });
$('#optTop').onchange = e => window.api.stageSet({ onTop: e.target.checked });
$('#optFrame').onchange = e => window.api.stageSet({ frame: e.target.checked });
$('#btnClear').onclick = () => window.api.stageCmd({ type: 'clear' });
$('#btnLogClear').onclick = () => { $('#log').innerHTML = ''; };
$('#editLayout').onchange = e => window.api.stageCmd({ type: 'edit', on: e.target.checked });

// ---------- Test ----------
function fakeUser(name) {
  const n = name || rnd(D.content.names || ['Phật tử']) + (Math.random() < 0.3 ? ' ' + Math.floor(Math.random() * 99) : '');
  return { id: 'test_' + Math.random().toString(36).slice(2, 9), uniqueId: n.toLowerCase().replace(/\s/g, ''), nickname: n, avatar: '' };
}
function simJoin(n) { for (let i = 0; i < n; i++) setTimeout(() => { const u = fakeUser(n === 1 ? $('#simName').value.trim() : ''); lastJoined = u; window.api.simulate({ type: 'join', user: u }); }, i * 250); }
$('#simJoin1').onclick = () => simJoin(1); $('#simJoin5').onclick = () => simJoin(5); $('#simJoin20').onclick = () => simJoin(20);
$('#simChat').onclick = () => { const u = fakeUser($('#simName').value.trim()); window.api.simulate({ type: 'chat', user: u, text: 'A Di Đà Phật' }); };
function simGift(coins, user) { const u = user || fakeUser($('#simName').value.trim()); window.api.simulate({ type: 'gift', user: u, giftName: coins >= 100 ? 'Sư tử' : coins >= 10 ? 'Hoa sen' : 'Hoa hồng', coins, repeat: 1 }); }
$('#simGift').onclick = () => simGift(Math.max(1, +$('#simCoins').value || 1));
$('#simGiftSame').onclick = () => simGift(Math.max(1, +$('#simCoins').value || 1), lastJoined || undefined);
function renderSimTiers() { $('#simTiers').innerHTML = ''; (cfg.tiers || []).forEach(t => { const b = document.createElement('button'); b.textContent = `Tặng ${t.min} xu (${t.label})`; b.onclick = () => simGift(t.min); $('#simTiers').appendChild(b); }); }
$('#btnSay').onclick = () => window.api.stageCmd({ type: 'say', text: $('#sayText').value });
$('#btnZoom').onclick = () => window.api.stageCmd({ type: 'zoom-test' });
$('#resetScene').onclick = () => { if (confirm('Khôi phục mặc định phần Cảnh?')) window.api.resetConfig('scene'); };
$('#resetLayout').onclick = () => { if (confirm('Khôi phục bố cục mặc định?')) window.api.resetConfig('layout'); };

// ---------- Nhân vật ----------
function renderChars() {
  const box = $('#charList'); box.innerHTML = '';
  for (const c of D.characters) {
    const disabled = (cfg.characters.disabled || []).includes(c.id);
    const el = document.createElement('div'); el.className = 'citem';
    const anims = c.json.animations;
    const thumbs = Object.entries(anims).filter(([k]) => k !== 'walk_left' && k !== 'walk_right').map(([k, a]) => (a.frames || []).slice(0, 4).map(f => `<figure><img src="${c.base + encodeURIComponent(f)}"${a.flip ? ' style="transform:scaleX(-1)"' : ''}><figcaption>${esc(k)}</figcaption></figure>`).join('')).join('');
    el.innerHTML = `<div class="meta"><b>${esc(c.json.name || c.folder)}</b><div class="muted small">${c.source === 'bundled' ? 'Có sẵn' : 'Tự thêm'} · ${Object.keys(c.json.frames || {}).length} khung</div>
      <label class="chk"><input type="checkbox" class="en" ${disabled ? '' : 'checked'}> Sử dụng</label>
      <label>Trọng số <input type="number" class="wt" min="0" step="0.5" value="${(cfg.characters.weights || {})[c.id] ?? 1}"></label>
      <div class="row wrap"><button class="mini add">+ Thêm/sửa hoạt ảnh</button>${c.source === 'user' ? '<button class="mini danger del">Xoá</button>' : ''}</div></div>
      <div class="thumbs">${thumbs}</div>`;
    el.querySelector('.en').onchange = e => { let d = (cfg.characters.disabled || []).filter(x => x !== c.id); if (!e.target.checked) d.push(c.id); window.api.setConfig('characters.disabled', d); };
    el.querySelector('.wt').onchange = e => window.api.setConfig('characters.weights', { ...(cfg.characters.weights || {}), [c.id]: +e.target.value });
    el.querySelector('.add').onclick = () => openSlicer(c);
    const del = el.querySelector('.del'); if (del) del.onclick = async () => { if (confirm('Xoá nhân vật ' + (c.json.name || c.folder) + '?')) await window.api.deleteCharacter(c.id); };
    box.appendChild(el);
  }
}
$('#btnImportSheet').onclick = () => openSlicer(null);
$('#btnOpenUser').onclick = () => window.api.openUserDir();

// Modal cắt sprite
function modal(title, html) { $('#mTitle').textContent = title; $('#mBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#mBody').innerHTML = ''; }
$('#mClose').onclick = closeModal;
async function openSlicer(existing) {
  const files = await window.api.openDialog({ filters: [{ name: 'Ảnh PNG', extensions: ['png', 'webp'] }], multi: true });
  if (!files.length) return;
  const imgs = await Promise.all(files.map(f => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = f.url; })));
  let frames = [];
  modal(existing ? 'Thêm hoạt ảnh cho ' + (existing.json.name || existing.folder) : 'Thêm nhân vật mới', `
    <div class="row wrap">
      ${existing ? '' : '<label style="width:260px">Tên nhân vật<input id="sName" value="' + esc(files[0].name.replace(/\.\w+$/, '')) + '"></label>'}
      <label>Cách cắt<select id="sMode"><option value="auto">Tự động (theo khoảng trống)</option><option value="std">Chuẩn: hàng trên 6 khung</option><option value="grid">Lưới hàng × cột</option><option value="single">Mỗi ảnh = 1 khung</option></select></label>
      <label>Hàng<input id="sRows" type="number" value="2" style="width:70px"></label><label>Cột<input id="sCols" type="number" value="6" style="width:70px"></label>
      <button id="sRedo">Cắt lại</button>
      ${existing ? '<label class="chk"><input type="checkbox" id="sReplace" checked> Thay thế hoạt ảnh cũ của trạng thái được gán</label>' : ''}
    </div>
    <div id="sFrames" class="sframes"></div>
    <div class="row" style="margin-top:14px"><canvas id="sPrev" class="prevcv" width="260" height="300"></canvas><div class="muted small" style="max-width:420px">Xem trước: đi lên → cúi chào → quỳ → vái lạy. Chọn trạng thái cho từng khung ở trên. Các khung cùng trạng thái chạy nối tiếp theo thứ tự.</div></div>
    <div class="row"><button id="sSave" class="primary">Lưu</button><span id="sMsg" class="muted"></span></div>`);
  const defaultStates = n => {
    if (n === 11) return ['skip', 'skip', 'skip', 'skip', 'walk_down', 'walk_down', 'walk_up', 'walk_up', 'bow', 'kneel', 'prostrate'];
    if (n === 12) return ['skip', 'skip', 'skip', 'skip', 'walk_down', 'walk_down', 'walk_up', 'walk_up', 'bow_front', 'bow', 'kneel', 'prostrate'];
    return Array(n).fill(existing ? 'skip' : 'walk_up');
  };
  const cut = () => {
    const mode = $('#sMode').value; frames = [];
    for (const img of imgs) {
      if (!img) continue;
      let fr;
      if (mode === 'grid') fr = Slicer.grid(img, +$('#sRows').value || 1, +$('#sCols').value || 1);
      else if (mode === 'single') fr = Slicer.grid(img, 1, 1);
      else fr = Slicer.detect(img, { expectTop: mode === 'std' ? 6 : 0 });
      frames.push(...fr);
    }
    const ds = defaultStates(frames.length); frames.forEach((f, i) => f.state = ds[i] || 'walk_up');
    const box = $('#sFrames'); box.innerHTML = '';
    frames.forEach((f, i) => {
      const d = document.createElement('div'); d.className = 'sframe';
      d.innerHTML = `<img src="${f.canvas.toDataURL()}"><div class="muted small">#${i + 1} · ${f.w}×${f.h}</div><select>${STATES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>`;
      const sel = d.querySelector('select'); sel.value = f.state; d.classList.toggle('skip', f.state === 'skip');
      sel.onchange = () => { f.state = sel.value; d.classList.toggle('skip', f.state === 'skip'); };
      box.appendChild(d);
    });
    $('#sMsg').textContent = 'Tìm thấy ' + frames.length + ' khung.';
  };
  $('#sRedo').onclick = cut; $('#sMode').onchange = cut;
  cut();
  // xem trước
  let pt = 0; const pc = $('#sPrev'), px = pc.getContext('2d');
  const prevTimer = setInterval(() => {
    if (!document.body.contains(pc)) return clearInterval(prevTimer);
    pt += 1 / 12; px.clearRect(0, 0, pc.width, pc.height);
    const by = s => frames.filter(f => f.state === s);
    const seq = [['walk_up', 3, 2], ['bow', 1.2, 1], ['kneel', 1, 1], ['prostrate', 1.2, 1], ['kneel', 0.8, 1]];
    const tot = seq.reduce((a, s) => a + s[1], 0); let t = pt % tot, cur = seq[0];
    for (const s of seq) { if (t < s[1]) { cur = s; break; } t -= s[1]; }
    const list = by(cur[0]).length ? by(cur[0]) : by('walk_up'); if (!list.length) return;
    const fps = cur[2];
    const f = list[Math.floor(t * fps) % list.length];
    const ref = Math.max(...(by('walk_up').length ? by('walk_up') : frames).map(x => x.h));
    const k = 270 / ref, dw = f.w * k, dh = f.h * k;
    const flip = false;
    px.save(); if (flip) { px.translate(pc.width, 0); px.scale(-1, 1); }
    px.drawImage(f.canvas, pc.width / 2 - dw / 2, 290 - dh, dw, dh); px.restore();
    px.fillStyle = '#f2c46d'; px.font = '12px sans-serif'; px.fillText(cur[0], 8, 16);
  }, 1000 / 12);
  $('#sSave').onclick = async () => {
    const used = frames.filter(f => f.state !== 'skip');
    if (!used.length) { $('#sMsg').textContent = 'Chưa gán khung nào.'; return; }
    $('#sMsg').textContent = 'Đang lưu…';
    const stamp = Date.now().toString(36);
    const filesOut = [], fmeta = {}, anim = {};
    used.forEach((f, i) => {
      const name = `${f.state}_${stamp}_${i}.png`;
      filesOut.push({ name, data: f.canvas.toDataURL('image/png') });
      const walk = /^walk/.test(f.state);
      fmeta[name] = { w: f.w, h: f.h, ax: Math.round(Slicer.anchor(f.canvas, walk) * 10) / 10, ay: f.h };
      (anim[f.state] = anim[f.state] || []).push(name);
    });
    const faceLeft = true, fps = 6;
    const animations = {};
    for (const [st, fr] of Object.entries(anim)) {
      if (st === 'walk_left') { animations.walk_left = { frames: fr, fps, flip: !faceLeft }; animations.walk_right = { frames: fr, fps, flip: faceLeft }; }
      else animations[st] = { frames: fr, fps: /^walk/.test(st) ? 3 : 1 };
    }
    let json, folder, replace = false;
    if (existing) {
      let target = existing;
      if (existing.source === 'bundled') { const nid = await window.api.cloneCharacter(existing.id); const d2 = await window.api.init(); target = d2.characters.find(c => c.id === nid); }
      json = JSON.parse(JSON.stringify(target.json)); folder = target.folder;
      json.frames = { ...(json.frames || {}), ...fmeta };
      const rep = $('#sReplace') && $('#sReplace').checked;
      for (const [k, a] of Object.entries(animations)) {
        if (!rep && json.animations[k]) json.animations[k].frames = [...json.animations[k].frames, ...a.frames]; else json.animations[k] = a;
      }
      json.rev = (json.rev || 0) + 1;
      if (existing.source === 'bundled') { await window.api.setConfig('characters.disabled', [...new Set([...(cfg.characters.disabled || []), existing.id])]); }
    } else {
      const backs = used.filter(f => f.state === 'walk_up');
      const refH = backs.length ? backs.reduce((a, f) => a + f.h, 0) / backs.length : Math.max(...used.map(f => f.h));
      json = { name: $('#sName').value.trim() || 'Nhân vật mới', refHeight: Math.round(refH), frames: fmeta, animations, rev: 1 };
      folder = 'nv_' + stamp; replace = true;
    }
    await window.api.saveCharacter({ folder, json, files: filesOut, replace });
    clearInterval(prevTimer); closeModal();
    addLog({ msg: 'Đã lưu nhân vật ' + json.name, level: 'ok' });
  };
}

// ---------- Donate tiers ----------
function frameOpts(sel) { return D.frames.map(f => `<option value="${esc(f.id)}" ${f.id === sel ? 'selected' : ''}>${esc(f.name || f.file)}</option>`).join(''); }
function renderTiers() {
  const box = $('#tierList'); box.innerHTML = '';
  const tiers = (cfg.tiers || []).slice();
  tiers.forEach((t, i) => {
    const fr = D.frames.find(f => f.id === t.frame);
    const el = document.createElement('div'); el.className = 'tier';
    el.innerHTML = `<label>Từ (xu)<input type="number" min="1" data-f="min" value="${t.min}"></label>
      <label>Danh hiệu<input data-f="label" value="${esc(t.label)}"></label>
      <label>Mức quẻ<input data-f="fortuneLevel" value="${esc(t.fortuneLevel || '')}"></label>
      <label>Số lần lạy<input type="number" min="0" data-f="kneelRounds" value="${t.kneelRounds ?? 3}"></label>
      <label>Màu tên<input type="color" data-f="color" value="${t.color || '#ffe28a'}"></label>
      <label>Hiện (giây)<input type="number" min="0" step="0.5" data-f="cardSeconds" value="${t.cardSeconds || 0}"></label>
      <label>Cỡ treo<input type="number" min="0" data-f="gallerySize" value="${t.gallerySize || 0}"></label>
      <label>Khung avatar<select data-f="frame">${frameOpts(t.frame)}</select></label>
      <img class="fprev" src="${fr ? fr.url : ''}">
      <div class="row"><button class="mini test">Thử</button><button class="mini danger del">Xoá</button></div>`;
    el.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
      const nt = (cfg.tiers || []).slice(); const f = inp.dataset.f;
      nt[i] = { ...nt[i], [f]: inp.type === 'number' ? +inp.value : inp.value };
      window.api.setConfig('tiers', nt);
    });
    el.querySelector('.del').onclick = () => { const nt = cfg.tiers.slice(); nt.splice(i, 1); window.api.setConfig('tiers', nt); };
    el.querySelector('.test').onclick = () => simGift(t.min);
    box.appendChild(el);
  });
  renderSimTiers();
  const hs = $('#cardHoldTier'); const hv = hs.value; hs.innerHTML = tiers.map((t, i) => `<option value="${i}">Mẫu: ${esc(t.label)} (${t.min} xu)</option>`).join(''); if (hv) hs.value = hv;
}
$('#btnAddTier').onclick = () => { const nt = (cfg.tiers || []).slice(); const last = nt[nt.length - 1]; nt.push({ min: last ? last.min * 2 : 1, label: 'Mức mới', frame: D.frames[0] && D.frames[0].id, fortuneLevel: 'Cát', kneelRounds: 3, color: '#ffe28a' }); window.api.setConfig('tiers', nt); };
function renderFrames() {
  const box = $('#frameList'); box.innerHTML = '';
  for (const f of D.frames) {
    const el = document.createElement('div'); el.className = 'fitem';
    el.innerHTML = `<img src="${f.url}"><div>${esc(f.name || f.file)}</div>${f.source === 'user' ? '<button class="mini danger">Xoá</button>' : '<div class="small">có sẵn</div>'}`;
    const b = el.querySelector('button'); if (b) b.onclick = () => { if (confirm('Xoá khung này?')) window.api.deleteFrame(f.id); };
    box.appendChild(el);
  }
}
$('#btnImportFrame').onclick = async () => {
  const files = await window.api.openDialog({ filters: [{ name: 'Ảnh PNG', extensions: ['png', 'webp'] }] });
  if (!files.length) return;
  const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = files[0].url; });
  const h = Slicer.detectHole(img);
  modal('Nhập khung avatar', `<div class="row" style="align-items:flex-start;gap:20px">
    <canvas id="fPrev" class="prevcv" width="360" height="360"></canvas>
    <div style="width:320px"><label>Tên khung<input id="fName" value="${esc(files[0].name.replace(/\.\w+$/, ''))}"></label>
    <p class="muted small">${h.auto ? 'Đã tự tìm vòng tròn đặt avatar.' : 'Không tự tìm được lỗ tròn (ảnh có nền?) — hãy chỉnh tay.'} Vòng xanh = vị trí avatar.</p>
    <label>Tâm X<input id="fCx" type="range" min="0" max="1" step="0.002" value="${h.cx}"></label>
    <label>Tâm Y<input id="fCy" type="range" min="0" max="1" step="0.002" value="${h.cy}"></label>
    <label>Bán kính<input id="fR" type="range" min="0.05" max="0.5" step="0.002" value="${h.r}"></label>
    <button id="fSave" class="primary">Lưu khung</button></div></div>`);
  const cv = $('#fPrev'), x = cv.getContext('2d');
  const draw = () => {
    x.clearRect(0, 0, 360, 360); const k = Math.min(360 / img.width, 360 / img.height), w = img.width * k, hh = img.height * k, ox = (360 - w) / 2, oy = (360 - hh) / 2;
    const cx = +$('#fCx').value, cy = +$('#fCy').value, r = +$('#fR').value;
    x.fillStyle = '#7a5520'; x.beginPath(); x.arc(ox + cx * w, oy + cy * hh, r * w, 0, 7); x.fill();
    x.drawImage(img, ox, oy, w, hh);
    x.strokeStyle = '#3cf'; x.lineWidth = 2; x.beginPath(); x.arc(ox + cx * w, oy + cy * hh, r * w, 0, 7); x.stroke();
  };
  ['#fCx', '#fCy', '#fR'].forEach(s => $(s).oninput = draw); draw();
  $('#fSave').onclick = async () => {
    const data = await window.api.fileDataURL(files[0].path);
    await window.api.saveFrame({ name: $('#fName').value, data, meta: { w: img.width, h: img.height, cx: +$('#fCx').value, cy: +$('#fCy').value, r: +$('#fR').value } });
    closeModal();
  };
};

const sendHold = () => window.api.stageCmd({ type: 'card-preview', hold: $('#cardHold').checked, tier: +$('#cardHoldTier').value || 0 });
$('#cardHold').onchange = sendHold; $('#cardHoldTier').onchange = sendHold;
$('#resetCard').onclick = async () => { if (!confirm('Khôi phục mặc định thẻ & ô quẻ?')) return; await window.api.resetConfig('layout.card'); await window.api.resetConfig('layout.fortune'); };

function renderVideos() {
  const box = $('#videoList'); if (!box) return; box.innerHTML = '';
  const dis = (cfg.backgrounds && cfg.backgrounds.disabled) || [];
  for (const v of D.videos || []) {
    const el = document.createElement('div'); el.className = 'mi';
    el.innerHTML = `<input type="checkbox" ${dis.includes(v.id) ? '' : 'checked'}><span>${esc(v.name)}</span><button class="mini now">phát ngay</button>${v.source === 'user' ? '<button class="mini danger del">xoá</button>' : ''}`;
    el.querySelector('input').onchange = e => { let d = ((cfg.backgrounds && cfg.backgrounds.disabled) || []).filter(x => x !== v.id); if (!e.target.checked) d.push(v.id); window.api.setConfig('backgrounds.disabled', d); };
    el.querySelector('.now').onclick = () => window.api.stageCmd({ type: 'bg-next', id: v.id });
    const del = el.querySelector('.del'); if (del) del.onclick = () => { if (confirm('Xoá video này?')) window.api.removeVideo(v.id); };
    box.appendChild(el);
  }
}
$('#btnAddVideo').onclick = async () => { const f = await window.api.openDialog({ multi: true, filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v'] }] }); if (f.length) await window.api.addVideo(f.map(x => x.path)); };
$('#btnNextBg').onclick = () => window.api.stageCmd({ type: 'bg-next' });

$('#btnGalleryClear').onclick = () => window.api.stageCmd({ type: 'gallery-clear' });

// ---------- Âm thanh ----------
$('#btnVoiceTest').onclick = async () => {
  const m = $('#voiceTestMsg'); m.textContent = 'Đang kiểm tra…'; m.className = 'small';
  const [ms, gg] = await Promise.all([window.api.ttsTest('edge'), window.api.ttsTest('google')]);
  const sys = (window.speechSynthesis && speechSynthesis.getVoices().filter(v => /^vi/i.test(v.lang)).map(v => v.name)) || [];
  m.innerHTML = `Microsoft: <b class="${ms.ok ? 'ok' : 'bad'}">${ms.ok ? 'OK' : esc(ms.error)}</b> · Google: <b class="${gg.ok ? 'ok' : 'bad'}">${gg.ok ? 'OK' : esc(gg.error)}</b> · Windows: <b class="${sys.length ? 'ok' : 'bad'}">${sys.length ? esc(sys.join(', ')) : 'không có giọng Việt'}</b>`;
  if (!ms.ok && gg.ok && cfg.voice.engine === 'edge' && cfg.voice.fallbackGoogle === false) m.innerHTML += ' — nên bật “tự chuyển sang Google”.';
};
$('#btnThanksTest').onclick = () => {
  const f = (D.content.fortunes || [])[0] || { name: 'Bình An', verse: [], meaning: '' }; const t = (cfg.tiers || [])[1] || {};
  const v = { name: 'Minh An', gift: 'Hoa sen', fortuneName: f.name, level: t.fortuneLevel || 'Đại Cát', verse: (f.verse || []).join('. '), fortune: f.meaning, coins: t.min || 10, tier: t.label || '' };
  const text = String(cfg.voice.thanksTemplate || '').replace(/\{(\w+)\}/g, (x, k) => v[k] ?? x);
  window.api.stageCmd({ type: 'say', text });
};
$('#btnThanksDefault').onclick = async () => { await window.api.resetConfig('voice.thanksTemplate'); };
function renderVoices() { $$('.voiceSel').forEach(s => { const v = get(cfg, s.dataset.k); s.innerHTML = VOICES.map(([k, n]) => `<option value="${k}">${n}</option>`).join(''); s.value = v; }); }
function renderMusic() {
  const box = $('#musicList'); box.innerHTML = '';
  const pl = cfg.music.playlist || [];
  for (const m of D.music) {
    const el = document.createElement('div'); el.className = 'mi';
    el.innerHTML = `<input type="checkbox" ${pl.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span>${m.source === 'user' ? '<button class="mini danger">xoá</button>' : ''}`;
    el.querySelector('input').onchange = e => { let p = (cfg.music.playlist || []).filter(x => x !== m.id); if (e.target.checked) p.push(m.id); window.api.setConfig('music.playlist', p); };
    const b = el.querySelector('button'); if (b) b.onclick = () => window.api.removeMusic(m.id);
    box.appendChild(el);
  }
}
$('#btnAddMusic').onclick = async () => {
  const f = await window.api.openDialog({ multi: true, filters: [{ name: 'Nhạc', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus'] }] });
  if (!f.length) return;
  await window.api.addMusic(f.map(x => x.path));
  const ids = f.map(x => 'user:' + x.name);
  window.api.setConfig('music.playlist', [...new Set([...(cfg.music.playlist || []), ...ids])]);
};
$('#btnNextMusic').onclick = () => window.api.stageCmd({ type: 'music-next' });
$('#btnTtsClear').onclick = async () => { await window.api.ttsClear(); $('#ttsCount').textContent = await window.api.ttsCount(); };

// ---------- Nội dung ----------
function sermonsToText(s) { return (s || []).map(x => '## ' + x.title + '\n' + x.lines.join('\n')).join('\n\n'); }
function textToSermons(t) {
  const out = []; let cur = null;
  for (const raw of t.split('\n')) { const l = raw.trim(); if (!l) continue; if (l.startsWith('##')) { cur = { title: l.replace(/^#+\s*/, ''), lines: [] }; out.push(cur); } else { if (!cur) { cur = { title: 'Lời Phật dạy', lines: [] }; out.push(cur); } cur.lines.push(l); } }
  return out.filter(x => x.lines.length);
}
function fortunesToText(f) { return (f || []).map(x => [x.name, ...(x.verse || []), x.meaning].join(' | ')).join('\n'); }
function textToFortunes(t) { return t.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(s => s.trim()); return { name: p[0] || 'Cát Tường', verse: p.slice(1, p.length - 1).filter(Boolean), meaning: p.length > 1 ? p[p.length - 1] : '' }; }); }
function loadContentEditors(useDefault) {
  const c = cfg.content, d = D.content;
  const custom = c.custom && !useDefault;
  $('#edSermons').value = sermonsToText(custom && c.sermons ? c.sermons : d.sermons);
  $('#edFortunes').value = fortunesToText(custom && c.fortunes ? c.fortunes : d.fortunes);
  $('#edBlessings').value = (custom && c.blessings ? c.blessings : d.blessings).join('\n');
  $('#useCustom').checked = !!c.custom;
  renderJump();
}
function renderJump() {
  const s = cfg.content.custom && cfg.content.sermons ? cfg.content.sermons : D.content.sermons;
  $('#sermonJump').innerHTML = '<span class="muted small">Chuyển tới bài:</span>';
  s.forEach((x, i) => { const b = document.createElement('button'); b.className = 'mini'; b.textContent = (i + 1) + '. ' + x.title; b.onclick = () => window.api.stageCmd({ type: 'sermon-jump', index: i }); $('#sermonJump').appendChild(b); });
}
$('#btnSaveContent').onclick = async () => {
  await window.api.setConfig('content', { custom: $('#useCustom').checked, sermons: textToSermons($('#edSermons').value), fortunes: textToFortunes($('#edFortunes').value), blessings: $('#edBlessings').value.split('\n').map(s => s.trim()).filter(Boolean) });
  addLog({ msg: 'Đã lưu nội dung lời giảng/quẻ', level: 'ok' }); renderJump();
};
$('#useCustom').onchange = e => window.api.setConfig('content.custom', e.target.checked);
$('#btnLoadDefault').onclick = () => loadContentEditors(true);

// ---------- Cập nhật ----------
$('#btnCheck').onclick = async () => { $('#updMsg').textContent = 'Đang kiểm tra…'; const r = await window.api.checkUpdate(); $('#updMsg').textContent = r.error ? 'Lỗi: ' + r.error : (r.newer ? `Có bản mới ${r.remote} (đang dùng ${r.current}). ${r.notes || ''}` : `Đang dùng bản mới nhất (${r.current}).`); };
$('#btnApply').onclick = async () => { $('#updMsg').textContent = 'Đang cập nhật…'; const r = await window.api.applyUpdate(); $('#updMsg').textContent = r.error ? 'Lỗi: ' + r.error : (r.ok ? 'Đã cài bản ' + r.version + ', đang khởi động lại…' : r.msg); };
$('#btnRollback').onclick = () => { if (confirm('Quay về phiên bản đi kèm bộ cài?')) window.api.rollback(); };

// ---------- Khởi động ----------
function renderAll() { renderVideos(); fillInputs(); renderChars(); renderTiers(); renderFrames(); renderVoices(); renderMusic(); }
(async function main() {
  D = await window.api.init(); cfg = D.config;
  $('#ver').textContent = 'v' + D.version + (D.fromHot ? ' (cập nhật)' : '');
  $('#verInfo').innerHTML = `Đang chạy: <b>v${esc(D.version)}</b>${D.fromHot ? ' — bản cập nhật nóng' : ''}<br>Bản đi kèm bộ cài: v${esc(D.bundledVersion)}<br><span class="muted small">Dữ liệu: ${esc(D.userDir)}</span>`;
  bindInputs(); renderAll(); loadContentEditors(false); showTk(D.tiktok);
  $('#ttsCount').textContent = await window.api.ttsCount();
  window.api.on('config', c => { const tiersChanged = JSON.stringify(c.tiers) !== JSON.stringify(cfg.tiers); const chChanged = JSON.stringify(c.characters) !== JSON.stringify(cfg.characters); const muChanged = JSON.stringify(c.music.playlist) !== JSON.stringify(cfg.music.playlist); const bgChanged = JSON.stringify(c.backgrounds) !== JSON.stringify(cfg.backgrounds); cfg = c; fillInputs(); if (tiersChanged) renderTiers(); if (chChanged) renderChars(); if (muChanged) renderMusic(); if (bgChanged) renderVideos(); });
  window.api.on('assets', a => { D.characters = a.characters; D.frames = a.frames; D.music = a.music; if (a.videos) { D.videos = a.videos; renderVideos(); } renderChars(); renderTiers(); renderFrames(); renderMusic(); });
  window.api.on('log', addLog);
  window.api.on('tiktok-state', showTk);
  window.api.on('update-state', r => { if (r.newer) $('#updMsg').textContent = `Có bản mới ${r.remote} — bấm “Cập nhật & khởi động lại”.`; });
  window.api.on('update-progress', p => { $('#updMsg').textContent = p.msg; });
  window.api.on('stage-state', s => { if (!s.open) $('#stats').textContent = 'Màn hình LIVE đang đóng'; });
  window.api.on('stage-report', r => { $('#stats').textContent = `Nhân vật: ${r.onScreen} (người xem ${r.viewers}) · chờ: ${r.queue} · donate chờ: ${r.donorQueue} · ${r.fps} fps${r.speaking ? ' · 🔊 đang cảm ơn' : ''}${r.stats ? ` · nhận: ${r.stats.joins} vào / ${r.stats.chats} bình luận / ${r.stats.likes} tim · đã đưa lên: ${r.stats.spawned}` : ''}`; });
  window.api.on('live-event', ev => {
    if (ev.type === 'join') lastJoined = ev.user;
    if (ev.type === 'gift') addLog({ msg: `🎁 ${ev.user.nickname} tặng ${ev.repeat > 1 ? ev.repeat + '× ' : ''}${ev.giftName} (${ev.coins} xu)`, level: 'ok' });
    else if (ev.type === 'join') addLog({ msg: `👋 ${ev.user.nickname} vào live`, level: 'ev' });
    else if (ev.type === 'chat') addLog({ msg: `💬 ${ev.user.nickname}: ${ev.text}`, level: 'ev' });
  });
})();
