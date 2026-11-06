// Chùa Live — các thành phần thể hiện "đang LIVE thật": bình luận trực tiếp, đồng hồ, số người xem,
// giọng trả lời bình luận theo từ khoá, khung webcam người dẫn.
'use strict';
window.LiveExtra = (function () {
  const L = {};
  const ui = document.getElementById('ui');
  const chatEl = document.createElement('div'); chatEl.id = 'chat'; chatEl.className = 'board';
  chatEl.innerHTML = '<div class="board-title"><span class="lotus">💬</span><span>Bình luận trực tiếp</span></div><div class="chat-list"></div>';
  const infoEl = document.createElement('div'); infoEl.id = 'liveinfo';
  const camWrap = document.createElement('div'); camWrap.id = 'camwrap'; camWrap.innerHTML = '<video id="camvid" muted playsinline autoplay></video><div class="cam-label"></div>';
  ui.insertBefore(chatEl, document.getElementById('gallery'));
  ui.insertBefore(infoEl, document.getElementById('gallery'));
  ui.insertBefore(camWrap, document.getElementById('gallery'));
  const list = chatEl.querySelector('.chat-list');
  const camVid = camWrap.querySelector('video');
  let viewers = 0, likes = 0, joinsToday = 0, camStream = null, camDevice = null;
  const lastReplyUser = new Map(); let lastReplyAt = 0, lastReadAt = 0;

  const C = () => cfg;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

  // ---------- bình luận ----------
  function addChat(user, text, kind) {
    const lc = C().layout.chat || {}; if (lc.show === false) return;
    const row = document.createElement('div'); row.className = 'crow' + (kind ? ' ' + kind : '');
    const name = kind === 'reply' ? (en() ? '🔊 Temple' : '🔊 Chùa') : (user && user.nickname) || (en() ? 'Devotee' : 'Phật tử');
    row.innerHTML = `<span class="cn"></span><span class="ct"></span>`;
    row.querySelector('.cn').textContent = name + ':';
    row.querySelector('.ct').textContent = ' ' + text;
    list.appendChild(row);
    while (list.children.length > (lc.max || 6)) list.firstElementChild.remove();
  }

  // ---------- trả lời theo từ khoá ----------
  function parseReplies() {
    const src = (C().chatVoice && C().chatVoice.replies) || '';
    return src.split('\n').map(l => l.trim()).filter(l => l && l.includes('=>')).map(l => {
      const [k, r] = l.split('=>'); return { keys: k.split(/[,|]/).map(norm).filter(Boolean), reply: r.trim() };
    });
  }
  function onChat(ev) {
    const cv = C().chatVoice || {};
    addChat(ev.user, ev.text);
    if (!cv.enabled || !ev.text) return;
    const t = norm(ev.text), uid = ev.user && ev.user.id; const nowT = Date.now();
    const rule = parseReplies().find(r => r.keys.some(k => k && t.includes(k)));
    const userCd = (cv.userCooldown ?? 45) * 1000, globalCd = (cv.globalCooldown ?? 6) * 1000;
    if (rule) {
      if (nowT - lastReplyAt < globalCd || (uid && nowT - (lastReplyUser.get(uid) || 0) < userCd)) return;
      lastReplyAt = nowT; if (uid) lastReplyUser.set(uid, nowT);
      const text = fill(rule.reply, { name: voiceName(ev.user && ev.user.nickname), comment: ev.text });
      addChat(null, fill(rule.reply, { name: (ev.user && ev.user.nickname) || '', comment: ev.text }), 'reply');
      AudioMgr.say(text, { low: true });
    } else if (cv.readAll && nowT - lastReadAt > (cv.readGap ?? 8) * 1000) {
      const clean = String(ev.text).replace(/[^\p{L}\p{N}\s.,!?'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (clean.length < 2) return;
      lastReadAt = nowT;
      AudioMgr.say(fill(cv.readTemplate || '{name} nói: {comment}', { name: voiceName(ev.user && ev.user.nickname), comment: clean }), { low: true });
    }
  }

  // ---------- thanh thông tin trực tiếp ----------
  const DOW = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const en = () => C() && C().lang === 'en';
  function tickInfo() {
    const li = C() && C().layout.liveinfo; if (!li) return;
    if (li.show === false) { infoEl.style.display = 'none'; return; }
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    const parts = [];
    if (li.clock !== false) parts.push(`<span class="lv-dot"></span>LIVE · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    if (li.date !== false) parts.push(en() ? `${DOW_EN[d.getDay()]}, ${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}` : `${DOW[d.getDay()]}, ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`);
    if (li.viewers !== false && viewers) parts.push(en() ? `👁 ${viewers.toLocaleString('en-US')} watching` : `👁 ${viewers.toLocaleString('vi-VN')} đang xem`);
    if (li.likes !== false && likes) parts.push(`❤ ${likes.toLocaleString('vi-VN')}`);
    infoEl.innerHTML = parts.join('<span class="sep">•</span>');
  }
  setInterval(tickInfo, 500);

  // ---------- webcam người dẫn ----------
  async function applyCam() {
    const cc = C().camera || {};
    Object.assign(camWrap.style, { display: cc.enabled && camStream ? '' : 'none', left: (cc.x ?? 500) + 'px', top: (cc.y ?? 640) + 'px', width: (cc.size ?? 200) + 'px', height: Math.round((cc.size ?? 200) * (cc.shape === 'rect' ? 1.333 : 1)) + 'px' });
    camWrap.classList.toggle('rect', cc.shape === 'rect');
    camVid.style.transform = cc.mirror !== false ? 'scaleX(-1)' : '';
    camWrap.querySelector('.cam-label').textContent = cc.label || '';
    camWrap.querySelector('.cam-label').style.display = cc.label ? '' : 'none';
    if (!cc.enabled) { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; camDevice = null; } return; }
    if (camStream && camDevice === (cc.deviceId || '')) return;
    try {
      if (camStream) camStream.getTracks().forEach(t => t.stop());
      camStream = await navigator.mediaDevices.getUserMedia({ video: cc.deviceId ? { deviceId: { exact: cc.deviceId }, width: 640, height: 640 } : { width: 640, height: 640 }, audio: false });
      camDevice = cc.deviceId || ''; camVid.srcObject = camStream; camVid.play().catch(() => {}); camWrap.style.display = '';
    } catch (e) { camStream = null; camWrap.style.display = 'none'; if (!L._camWarned || Date.now() - L._camWarned > 60000) { L._camWarned = Date.now(); window.api.log('Không mở được webcam: ' + e.message + ' — kiểm tra webcam đã cắm và không bị app khác (LIVE Studio) chiếm.', 'warn'); } }
  }

  // ---------- bố cục ----------
  L.apply = function () {
    const lc = C().layout.chat || {};
    Object.assign(chatEl.style, { left: (lc.x ?? 10) + 'px', top: (lc.y ?? 700) + 'px', width: (lc.w ?? 250) + 'px', height: (lc.h ?? 200) + 'px', fontSize: (lc.font ?? 15) + 'px', display: lc.show === false ? 'none' : '' });
    chatEl.style.setProperty('--op', lc.opacity ?? 0.5);
    chatEl.classList.toggle('blur', lc.blur !== false && (lc.opacity ?? 0.5) > 0.02);
    const li = C().layout.liveinfo || {};
    Object.assign(infoEl.style, { top: (li.y ?? 1192) + 'px', fontSize: (li.font ?? 16) + 'px' });
    // tự đặt ngay trên dòng chữ dưới cùng (dòng chữ có thể nhiều dòng)
    const placeInfo = () => { const tb = document.getElementById('titleBar'); if (li.auto !== false && tb && tb.style.display !== 'none' && tb.offsetHeight) infoEl.style.top = Math.max(0, tb.offsetTop - infoEl.offsetHeight - 8) + 'px'; };
    placeInfo(); requestAnimationFrame(placeInfo); setTimeout(placeInfo, 300);
    tickInfo(); applyCam();
  };
  L.onEvent = function (ev) {
    if (ev.type === 'chat') onChat(ev);
    else if (ev.type === 'like' && ev.total) likes = Math.max(likes, ev.total);
    else if (ev.type === 'join') joinsToday++;
    else if (ev.type === 'gift' && ev.user) addChat(ev.user, en() ? `offered ${ev.repeat > 1 ? ev.repeat + ' ' : ''}${ev.giftName} 🎁` : `đã cúng dường ${ev.repeat > 1 ? ev.repeat + ' ' : ''}${ev.giftName} 🎁`, 'gift');
    else if (ev.type === 'follow' && ev.user) addChat(ev.user, en() ? 'followed the temple 🙏' : 'đã theo dõi chùa 🙏', 'gift');
  };
  L.onTikTok = function (s) { if (s && s.viewers) viewers = s.viewers; };
  L.chatEl = chatEl; L.camWrap = camWrap;
  return L;
})();
