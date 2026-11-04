// Chùa Live — âm thanh: nhạc nền, giọng giảng, giọng cảm ơn (ưu tiên, ngắt lời giảng)
(function () {
  const A = {};
  let cfg = null, musicList = [], sermons = [];
  const music = new Audio(); music.preload = 'auto';
  const sermonEl = new Audio();
  const thanksEl = new Audio();
  const sfx = {};
  let musicIdx = 0, musicStarted = false;

  // ---------- Nhạc nền ----------
  function playlist() {
    const ids = (cfg.music.playlist && cfg.music.playlist.length) ? cfg.music.playlist : musicList.map(m => m.id);
    return ids.map(id => musicList.find(m => m.id === id)).filter(Boolean);
  }
  function playMusic(next) {
    const pl = playlist();
    if (!cfg.music.enabled || !pl.length) { music.pause(); return; }
    if (next) musicIdx = cfg.music.shuffle ? Math.floor(Math.random() * pl.length) : (musicIdx + 1) % pl.length;
    musicIdx %= pl.length;
    const m = pl[musicIdx];
    if (music.dataset.id !== m.id) { music.src = m.url; music.dataset.id = m.id; }
    music.loop = pl.length === 1;
    music.play().catch(() => {});
    musicStarted = true;
  }
  music.addEventListener('ended', () => playMusic(true));
  let duck = 0; // 0..1
  function musicVolume() { const v = cfg.music.volume, d = cfg.music.duckVolume; return Math.max(0, Math.min(1, v + (Math.min(v, d) - v) * duck)); }
  setInterval(() => { // làm mượt ducking
    if (!cfg) return;
    const target = thanksBusy ? 1 : 0;
    duck += (target - duck) * 0.2;
    music.volume = musicVolume();
  }, 50);

  // ---------- SFX ----------
  A.sfx = function (name) {
    if (!cfg || !cfg.sfx[name === 'chuong' ? 'bell' : 'chime']) return;
    const a = new Audio(sfx[name]); a.volume = cfg.sfx.volume; a.play().catch(() => {});
  };

  // ---------- TTS ----------
  const blobCache = new Map();
  // chữ ký cài đặt giọng: đổi bộ đọc/giọng VieNeu thì không dùng lại âm thanh cũ (tránh lẫn giọng)
  function voiceSig() { const v = (cfg && cfg.vieneu) || {}; return [cfg && cfg.voice.engine, v.voice, v.thanksVoice, v.sermonRef, v.thanksRef].join('~'); }
  let lastSig = null;
  async function getVoiceURL(text, voice, rate, pitch) {
    const key = voiceSig() + '|' + voice + '|' + rate + '|' + pitch + '|' + text;
    if (blobCache.has(key)) return blobCache.get(key);
    const p = (async () => {
      const r = await window.api.tts(text, { voice, rate, pitch });
      if (!r || r.error) throw new Error(r ? r.error : 'TTS lỗi');
      const isWav = r[0] === 0x52 && r[1] === 0x49 && r[2] === 0x46 && r[3] === 0x46; // 'RIFF'
      return URL.createObjectURL(new Blob([r], { type: isWav ? 'audio/wav' : 'audio/mpeg' }));
    })();
    blobCache.set(key, p);
    p.catch(() => blobCache.delete(key));
    if (blobCache.size > 120) { const k = blobCache.keys().next().value; blobCache.get(k).then(u => URL.revokeObjectURL(u)).catch(() => {}); blobCache.delete(k); }
    return p;
  }
  let viVoice = null;
  function pickSysVoice() { const vs = speechSynthesis.getVoices(); viVoice = vs.find(v => /^vi/i.test(v.lang)) || null; }
  if (window.speechSynthesis) { pickSysVoice(); speechSynthesis.onvoiceschanged = pickSysVoice; }
  // Phát 1 câu: trả về Promise kết thúc khi đọc xong. el: Audio element
  function speakWith(el, text, voice, rate, pitch, volume, ctl) {
    return new Promise(async resolve => {
      ctl.cancel = () => { el.pause(); resolve('cancel'); };
      let url = null;
      try { url = cfg.voice.engine === 'system' || cfg.voice.engine === 'off' ? null : await getVoiceURL(text, voice, rate, pitch); } catch (e) { url = null; }
      if (ctl.cancelled) return resolve('cancel');
      if (url) {
        clearInterval(el._fadeIv); el.src = url; el.volume = Math.min(1, volume); el.currentTime = 0;
        el.onended = () => resolve('end'); el.onerror = () => resolve('err');
        ctl.audio = el;
        el.play().catch(() => resolve('err'));
      } else if (window.speechSynthesis && viVoice && cfg.voice.engine === 'system') { // chỉ dùng giọng Windows khi chọn đúng bộ đọc đó, tránh lẫn giọng
        const u = new SpeechSynthesisUtterance(text); u.voice = viVoice; u.lang = viVoice.lang; u.rate = 1 + rate / 100; u.volume = volume;
        u.onend = () => resolve('end'); u.onerror = () => resolve('err');
        ctl.synth = true; speechSynthesis.speak(u);
      } else {
        if (!A._warned || Date.now() - A._warned > 60000) { A._warned = Date.now(); window.api.log(cfg.voice.engine === 'off' ? 'Giọng đọc đang tắt' : 'Không tạo được giọng đọc (mạng chặn giọng Microsoft/Google và máy không có giọng tiếng Việt) — chỉ hiện chữ. Vào tab Giọng & nhạc → Kiểm tra giọng.', 'warn'); }
        ctl.timer = setTimeout(() => resolve('end'), Math.max(2500, text.length * 75)); // không có giọng: chạy theo thời gian
        ctl.silent = true;
      }
    });
  }

  // ---------- Lời giảng ----------
  const S = { sec: 0, line: -1, playing: false, paused: false, ctl: null, gapTimer: null, stopped: true };
  A.onSermon = null; // callback(sectionIdx, lineIdx)
  function sermonOrder() { return sermons; }
  function nextSermonLine() {
    if (!sermons.length) return null;
    let { sec, line } = S; line++;
    if (!sermons[sec] || line >= sermons[sec].lines.length) { sec = cfg.voice.shuffleSections ? Math.floor(Math.random() * sermons.length) : (sec + 1) % sermons.length; line = 0; }
    return { sec, line, newSection: sec !== S.sec || S.line === -1 };
  }
  function prefetch(n) {
    if (!n || cfg.voice.engine === 'off') return;
    const t = sermons[n.sec] && sermons[n.sec].lines[n.line];
    if (t) getVoiceURL(t, cfg.voice.voice, cfg.voice.rate, cfg.voice.pitch).catch(() => {});
  }
  async function sermonStep() {
    S.gapTimer = null;
    if (S.stopped || !cfg.voice.sermonEnabled) { S.playing = false; return; }
    if (thanksBusy) { S.paused = true; return; }
    const n = nextSermonLine(); if (!n) return;
    const isNewSec = n.sec !== S.sec;
    S.sec = n.sec; S.line = n.line;
    const text = sermons[S.sec].lines[S.line];
    A.onSermon && A.onSermon(S.sec, S.line);
    prefetch(nextSermonLine());
    S.playing = true;
    const ctl = S.ctl = {};
    const r = await speakWith(sermonEl, text, cfg.voice.voice, cfg.voice.rate, cfg.voice.pitch, cfg.voice.sermonVolume, ctl);
    if (S.ctl !== ctl) return;
    S.ctl = null; S.playing = false;
    if (r === 'cancel') return;
    const lastOfSec = S.line >= sermons[S.sec].lines.length - 1;
    const gap = (lastOfSec ? cfg.voice.sectionGap : cfg.voice.sermonGap) * 1000;
    if (thanksBusy) { S.paused = true; return; }
    S.gapTimer = setTimeout(sermonStep, gap);
  }
  // giảm/tăng âm lượng mượt
  function fadeVol(el, to, ms) {
    return new Promise(res => {
      const from = el.volume, t0 = performance.now();
      clearInterval(el._fadeIv);
      if (ms <= 0) { el.volume = Math.max(0, Math.min(1, to)); return res(); }
      el._fadeIv = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        el.volume = Math.max(0, Math.min(1, from + (to - from) * (k * k * (3 - 2 * k))));
        if (k >= 1) { clearInterval(el._fadeIv); res(); }
      }, 30);
    });
  }
  async function pauseSermon() {
    const fadeMs = (cfg.voice.duckFade ?? 0.9) * 1000;
    if (S.gapTimer) { clearTimeout(S.gapTimer); S.gapTimer = null; S.paused = true; S.resumeMode = 'next'; return; }
    if (S.ctl) {
      const a0 = S.ctl.audio, ctl0 = S.ctl;
      if ((a0 && !a0.ended && !a0.paused) || ctl0.synth || ctl0.silent) { // đang giảng dở câu -> đợi nói hết câu rồi mới chào / cảm ơn
        const t0 = Date.now(), maxMs = (cfg.voice.sentenceWaitMax ?? 25) * 1000;
        await new Promise(r => { const iv = setInterval(() => { if (S.ctl !== ctl0 || Date.now() - t0 > maxMs) { clearInterval(iv); r(); } }, 40); });
        if (S.ctl !== ctl0) { S.paused = true; S.resumeMode = 'next'; if (S.gapTimer) { clearTimeout(S.gapTimer); S.gapTimer = null; } return; }
      }
      S.paused = true;
      const a = S.ctl.audio;
      if (a && !a.ended && !a.paused) { S.resumeMode = 'audio'; await fadeVol(a, 0, fadeMs); if (S.paused) a.pause(); }
      else if (a && !a.ended) { S.resumeMode = 'audio'; a.pause(); }
      else if (S.ctl.synth) { speechSynthesis.cancel(); S.resumeMode = 'repeat'; }
      else if (S.ctl.silent) { clearTimeout(S.ctl.timer); S.resumeMode = 'repeat'; }
      else { S.ctl.cancelled = true; S.resumeMode = 'repeat'; S.ctl.cancel && S.ctl.cancel(); } // đang tải giọng -> huỷ, đọc lại câu sau
    }
  }
  function resumeSermon() {
    if (!S.paused) { if (!S.playing && !S.gapTimer && !S.stopped) sermonStep(); return; }
    S.paused = false;
    if (S.resumeMode === 'audio' && S.ctl && S.ctl.audio) {
      const a = S.ctl.audio; a.volume = 0; a.play().catch(() => {}); fadeVol(a, Math.min(1, cfg.voice.sermonVolume), 700); return;
    }
    if (S.resumeMode === 'repeat') { S.line = Math.max(-1, S.line - 1); S.ctl && S.ctl.cancel && S.ctl.cancel(); S.ctl = null; }
    S.playing = false; sermonStep();
  }
  A.startSermon = function () { S.stopped = false; if (!S.playing && !S.gapTimer && !S.paused) sermonStep(); };
  A.stopSermon = function () { S.stopped = true; if (S.gapTimer) clearTimeout(S.gapTimer); S.gapTimer = null; if (S.ctl) { const c = S.ctl; S.ctl = null; c.cancel && c.cancel(); } S.playing = false; S.paused = false; speechSynthesis && speechSynthesis.cancel(); };
  A.jumpSection = function (i) { A.stopSermon(); S.sec = i; S.line = -1; A.startSermon(); };
  A.sermonState = () => ({ sec: S.sec, line: S.line, playing: S.playing, paused: S.paused });

  // ---------- Giọng cảm ơn (ưu tiên) ----------
  const queue = []; let thanksBusy = false; let resumeTimer = null; let curThanks = null;
  A.say = function (text, opts = {}) {
    if (!text) return Promise.resolve();
    if (opts.low && (queue.length > 1 || thanksBusy)) return Promise.resolve();
    if (!opts.low) { // lời cảm ơn donate: bỏ các câu trả lời bình luận đang chờ / đang đọc
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].opts.low) queue.splice(i, 1)[0].res();
      if (curThanks && curThanks.low) { const c = curThanks; c.cancelled = true; c.cancel && c.cancel(); }
    }
    return new Promise(res => { queue.push({ text, opts, res }); pump(); });
  };
  A.prefetchThanks = t => getVoiceURL(t, cfg.voice.thanksVoice || cfg.voice.voice, cfg.voice.thanksRate || 0, 0).catch(() => {});
  async function pump() {
    if (thanksBusy || !queue.length) return;
    clearTimeout(resumeTimer);
    thanksBusy = true;
    await pauseSermon();
    while (queue.length) {
      const it = queue.shift();
      if (cfg.voice.engine === 'off') { it.res(); continue; }
      const ctl = { low: !!it.opts.low }; curThanks = ctl;
      try { it.opts.onStart && it.opts.onStart(); } catch {}
      await speakWith(thanksEl, it.text, cfg.voice.thanksVoice || cfg.voice.voice, cfg.voice.thanksRate || 0, 0, cfg.voice.thanksVolume, ctl);
      it.res();
    }
    thanksBusy = false;
    resumeTimer = setTimeout(() => { if (!thanksBusy) resumeSermon(); }, (cfg.voice.resumeDelay || 1) * 1000);
  }
  // ngắt ngay lời cảm ơn đang đọc (nhường cho người donate kế tiếp)
  A.cutThanks = function () {
    while (queue.length) queue.shift().res();
    const c = curThanks; curThanks = null;
    if (c) { if (c.synth) speechSynthesis.cancel(); if (c.silent) clearTimeout(c.timer); c.cancelled = true; c.cancel && c.cancel(); }
  };
  A.speaking = () => thanksBusy;
  A.queueLength = () => queue.length;

  A.setup = function (c, mlist, serm, assetsBase) {
    cfg = c; musicList = mlist; sermons = serm;
    sfx.chuong = assetsBase + 'audio/chuong.ogg'; sfx.chime = assetsBase + 'audio/chime.ogg';
    playMusic(false);
  };
  A.update = function (c, mlist, serm) {
    const sigBefore = voiceSig();
    const musicChanged = mlist && JSON.stringify(mlist.map(m => m.id)) !== JSON.stringify(musicList.map(m => m.id));
    cfg = c; if (mlist) musicList = mlist;
    if (voiceSig() !== sigBefore) { blobCache.forEach(p => p.then(u => URL.revokeObjectURL(u)).catch(() => {})); blobCache.clear(); }
    if (serm) { const changed = JSON.stringify(serm) !== JSON.stringify(sermons); sermons = serm; if (changed && S.sec >= sermons.length) { S.sec = 0; S.line = -1; } }
    if (musicChanged || !musicStarted || (cfg.music.enabled === music.paused)) playMusic(false);
    if (!cfg.music.enabled) music.pause();
    if (!cfg.voice.sermonEnabled) A.stopSermon(); else A.startSermon();
  };
  A.nextMusic = () => playMusic(true);
  window.AudioMgr = A;
})();
