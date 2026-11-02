// Chùa Live — main process (được cập nhật nóng qua GitHub)
const { app, BrowserWindow, ipcMain, dialog, net, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const C = global.CHUA || { appDir: path.join(__dirname, '..'), appVer: '0.0.0', updatesRoot: path.join(app.getPath('userData'), 'updates'), cmpVer: () => 0, fromHot: false };
const APP = C.appDir;
const USER = app.getPath('userData');
const DIRS = {
  user: path.join(USER, 'user'),
  characters: path.join(USER, 'user', 'characters'),
  frames: path.join(USER, 'user', 'frames'),
  music: path.join(USER, 'user', 'music'),
  ttsCache: path.join(USER, 'tts-cache'),
};
Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));
fs.mkdirSync(C.updatesRoot, { recursive: true });

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2)); };
const fileURL = p => pathToFileURL(p).href;

// ---------------- Config ----------------
const CONFIG_PATH = path.join(USER, 'config.json');
const DEFAULTS = readJSON(path.join(APP, 'data', 'default-config.json'), {});
function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
let config = deepMerge(DEFAULTS, readJSON(CONFIG_PATH, {}));
// nâng cấp cấu hình cũ
const OLD_THANKS = 'A Di Đà Phật. Xin cảm ơn {name} đã gửi tặng {gift}. {name} rút được quẻ {level}: {fortune}. Nguyện cầu Tam Bảo gia hộ cho {name} thân tâm an lạc, vạn sự cát tường.';
if (config.update && (!config.update.repo || config.update.repo === 'koddrawer/chua-live-updates')) config.update.repo = DEFAULTS.update.repo;
if (config.voice && config.voice.thanksTemplate === OLD_THANKS) config.voice.thanksTemplate = DEFAULTS.voice.thanksTemplate;
// Nội dung văn bản mặc định (bài giảng, lời quẻ...) nằm trong data/*.json; nếu người dùng chưa sửa thì luôn lấy bản mới nhất từ cập nhật
function loadContent() {
  const d = path.join(APP, 'data');
  return {
    sermons: readJSON(path.join(d, 'sermons.json'), []),
    fortunes: readJSON(path.join(d, 'fortunes.json'), []),
    blessings: readJSON(path.join(d, 'blessings.json'), []),
    names: readJSON(path.join(d, 'test-names.json'), []),
  };
}
let saveTimer = null;
function saveConfig() { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJSON(CONFIG_PATH, config), 300); }
function patchConfig(patch) { config = deepMerge(config, patch); saveConfig(); broadcast('config', config); }
function setConfigKey(key, value) { // key dạng "a.b.c" — thay thế nguyên giá trị (dùng cho mảng)
  const parts = key.split('.'); let o = config;
  for (let i = 0; i < parts.length - 1; i++) { if (!isObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = value; saveConfig(); broadcast('config', config);
}

// ---------------- Windows ----------------
let panelWin = null, stageWin = null;
function broadcast(ch, data) { for (const w of [panelWin, stageWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, data); }
function toPanel(ch, data) { if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send(ch, data); }
function toStage(ch, data) { if (stageWin && !stageWin.isDestroyed()) stageWin.webContents.send(ch, data); }
function log(msg, level = 'info') { const line = { t: Date.now(), msg: String(msg), level }; console.log('[' + level + ']', msg); toPanel('log', line); }

const webPrefs = { preload: path.join(APP, 'core', 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' };

function createPanel() {
  const b = config.window.panel || {};
  panelWin = new BrowserWindow({ width: b.width || 1180, height: b.height || 820, x: b.x, y: b.y, minWidth: 900, minHeight: 600, title: 'Chùa Live — Bảng điều khiển', backgroundColor: '#14110d', webPreferences: webPrefs, autoHideMenuBar: true });
  panelWin.loadFile(path.join(APP, 'panel', 'index.html'));
  panelWin.on('close', () => { config.window.panel = panelWin.getBounds(); writeJSON(CONFIG_PATH, config); });
  panelWin.on('closed', () => { panelWin = null; app.quit(); });
}
function createStage() {
  if (stageWin && !stageWin.isDestroyed()) { stageWin.show(); stageWin.focus(); return; }
  const b = config.window.stage || {};
  stageWin = new BrowserWindow({
    width: b.width || 540, height: b.height || 960, x: b.x, y: b.y, useContentSize: true,
    title: 'Chùa Live — Màn hình LIVE 9:16', backgroundColor: '#000000', webPreferences: webPrefs, autoHideMenuBar: true,
    alwaysOnTop: !!config.window.stageOnTop, frame: config.window.stageFrame !== false,
  });
  stageWin.setAspectRatio(9 / 16);
  stageWin.loadFile(path.join(APP, 'stage', 'index.html'));
  const saveB = () => { if (stageWin && !stageWin.isDestroyed() && !stageWin.isFullScreen()) { const [w, h] = stageWin.getContentSize(); const [x, y] = stageWin.getPosition(); config.window.stage = { x, y, width: w, height: h }; saveConfig(); } };
  stageWin.on('resized', saveB); stageWin.on('moved', saveB);
  stageWin.on('closed', () => { stageWin = null; toPanel('stage-state', { open: false }); });
  toPanel('stage-state', { open: true });
}

// ---------------- Assets listing ----------------
function listCharacters() {
  const out = [];
  const scan = (root, source) => {
    if (!fs.existsSync(root)) return;
    for (const id of fs.readdirSync(root)) {
      const dir = path.join(root, id); const j = readJSON(path.join(dir, 'character.json'));
      if (j && j.animations) out.push({ id: source + ':' + id, folder: id, source, base: fileURL(dir) + '/', json: j });
    }
  };
  scan(path.join(APP, 'assets', 'characters'), 'bundled');
  scan(DIRS.characters, 'user');
  return out;
}
function listFrames() {
  const out = [];
  const b = readJSON(path.join(APP, 'assets', 'frames', 'frames.json'), []);
  b.forEach(f => out.push({ ...f, id: 'bundled:' + f.file, url: fileURL(path.join(APP, 'assets', 'frames', f.file)), source: 'bundled' }));
  const u = readJSON(path.join(DIRS.frames, 'frames.json'), []);
  u.forEach(f => out.push({ ...f, id: 'user:' + f.file, url: fileURL(path.join(DIRS.frames, f.file)), source: 'user' }));
  return out;
}
const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|aac|flac|opus|webm)$/i;
function listMusic() {
  const out = [];
  const bd = path.join(APP, 'assets', 'audio');
  for (const f of ['nhac_thien.ogg']) if (fs.existsSync(path.join(bd, f))) out.push({ id: 'bundled:' + f, name: 'Nhạc thiền (có sẵn)', url: fileURL(path.join(bd, f)), source: 'bundled' });
  for (const f of fs.readdirSync(DIRS.music)) if (AUDIO_EXT.test(f)) out.push({ id: 'user:' + f, name: f, url: fileURL(path.join(DIRS.music, f)), source: 'user' });
  return out;
}
function initData() {
  return {
    config, content: loadContent(), version: C.appVer, fromHot: C.fromHot, bundledVersion: C.bundledVer,
    characters: listCharacters(), frames: listFrames(), music: listMusic(),
    assets: { base: fileURL(path.join(APP, 'assets')) + '/' }, userDir: USER,
    tiktok: tiktokState(),
  };
}
function refreshAssets() { broadcast('assets', { characters: listCharacters(), frames: listFrames(), music: listMusic() }); }

// ---------------- TikTok LIVE ----------------
let tk = { conn: null, wanted: false, username: '', status: 'disconnected', roomId: null, viewers: 0, retryTimer: null, lib: null, err: '' };
function tiktokState() { return { status: tk.status, username: tk.username, roomId: tk.roomId, viewers: tk.viewers, err: tk.err }; }
function setTkStatus(s, err = '') { tk.status = s; tk.err = err; toPanel('tiktok-state', tiktokState()); toStage('tiktok-state', tiktokState()); }
function pickImg(img) { if (!img) return ''; const u = img.url || img.urlList || img.url_list; return Array.isArray(u) ? (u[0] || '') : (typeof u === 'string' ? u : ''); }
function normUser(u) {
  u = u || {};
  return {
    id: String(u.userId || u.uniqueId || u.id || ''),
    uniqueId: u.uniqueId || u.displayId || '',
    nickname: (u.nickname || u.uniqueId || 'Phật tử').trim(),
    avatar: pickImg(u.profilePictureMedium) || pickImg(u.profilePicture) || pickImg(u.profilePictureLarge) || u.profilePictureUrl || '',
  };
}
function emitLive(ev) { toStage('live-event', ev); toPanel('live-event', ev); }

async function tiktokConnect(username, opts = {}) {
  username = String(username || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/, '').replace(/\/.*$/, '');
  if (!username) throw new Error('Chưa nhập tên tài khoản TikTok');
  await tiktokDisconnect(false);
  tk.wanted = true; tk.username = username;
  patchConfig({ tiktok: { username } });
  if (!tk.lib) tk.lib = await import('tiktok-live-connector');
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = tk.lib;
  const options = { processInitialData: false, enableExtendedGiftInfo: true, fetchRoomInfoOnConnect: true };
  if (config.tiktok.signApiKey) options.signApiKey = config.tiktok.signApiKey;
  const conn = new TikTokLiveConnection(username, options);
  tk.conn = conn;
  setTkStatus('connecting');
  log('Đang kết nối tới @' + username + ' ...');

  const E = WebcastEvent || {};
  const on = (name, fn) => { try { conn.on(name, d => { try { fn(d); } catch (e) { log('Lỗi xử lý sự kiện ' + name + ': ' + e.message, 'error'); } }); } catch {} };
  on(E.MEMBER || 'member', d => emitLive({ type: 'join', user: normUser(d.user) }));
  on(E.CHAT || 'chat', d => emitLive({ type: 'chat', user: normUser(d.user), text: d.comment || '' }));
  on(E.FOLLOW || 'follow', d => emitLive({ type: 'follow', user: normUser(d.user) }));
  on(E.SHARE || 'share', d => emitLive({ type: 'share', user: normUser(d.user) }));
  on(E.LIKE || 'like', d => emitLive({ type: 'like', user: normUser(d.user), count: d.likeCount || 1, total: d.totalLikeCount || 0 }));
  on(E.ROOM_USER || 'roomUser', d => { tk.viewers = d.viewerCount || tk.viewers; toPanel('tiktok-state', tiktokState()); });
  on(E.GIFT || 'gift', d => {
    const g = d.giftDetails || {}; const ext = d.extendedGiftInfo || {};
    const giftType = g.giftType ?? ext.type;
    if (giftType === 1 && !d.repeatEnd) return; // đang combo — chờ kết thúc
    const per = Number(g.diamondCount || ext.diamond_count || ext.diamondCount || 0);
    const repeat = Math.max(1, Number(d.repeatCount || 1));
    emitLive({ type: 'gift', user: normUser(d.user), giftName: g.giftName || ext.name || 'quà', giftImage: pickImg(g.giftImage) || pickImg(ext.image), repeat, coins: per * repeat, perCoin: per });
  });
  on(E.STREAM_END || 'streamEnd', () => { log('Buổi LIVE đã kết thúc', 'warn'); setTkStatus('ended'); });
  on((ControlEvent && ControlEvent.DISCONNECTED) || 'disconnected', () => {
    if (tk.conn !== conn) return;
    setTkStatus('disconnected'); log('Mất kết nối TikTok', 'warn');
    if (tk.wanted) scheduleRetry();
  });
  on((ControlEvent && ControlEvent.ERROR) || 'error', e => log('TikTok lỗi: ' + (e?.info || e?.message || JSON.stringify(e)).slice(0, 300), 'error'));
  try {
    const state = await conn.connect();
    if (tk.conn !== conn) return;
    tk.roomId = state?.roomId || conn.roomId || null;
    setTkStatus('connected'); log('Đã kết nối LIVE @' + username + (tk.roomId ? ' (room ' + tk.roomId + ')' : ''), 'ok');
  } catch (e) {
    if (tk.conn !== conn) return;
    const msg = e?.message || String(e);
    setTkStatus('error', msg); log('Không kết nối được: ' + msg, 'error');
    if (tk.wanted) scheduleRetry();
  }
}
function scheduleRetry() {
  clearTimeout(tk.retryTimer);
  const s = Math.max(5, config.tiktok.retrySeconds || 15);
  log('Thử kết nối lại sau ' + s + ' giây...');
  tk.retryTimer = setTimeout(() => { if (tk.wanted) tiktokConnect(tk.username).catch(e => log(e.message, 'error')); }, s * 1000);
}
async function tiktokDisconnect(userAction = true) {
  clearTimeout(tk.retryTimer);
  if (userAction) tk.wanted = false;
  const c = tk.conn; tk.conn = null;
  if (c) { try { c.removeAllListeners && c.removeAllListeners(); await c.disconnect(); } catch {} }
  if (userAction) { setTkStatus('disconnected'); log('Đã ngắt kết nối'); }
}

// ---------------- TTS (Edge Neural voices, có cache) ----------------
let ttsLib = null;
async function ttsEdge(text, o = {}) {
  text = String(text || '').trim(); if (!text) return null;
  const voice = o.voice || config.voice.voice || 'vi-VN-HoaiMyNeural';
  const rate = o.rate ?? config.voice.rate ?? 0; const pitch = o.pitch ?? config.voice.pitch ?? 0;
  const key = crypto.createHash('sha1').update([voice, rate, pitch, text].join('|')).digest('hex');
  const file = path.join(DIRS.ttsCache, key + '.mp3');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (!ttsLib) ttsLib = require('msedge-tts');
  const { MsEdgeTTS, OUTPUT_FORMAT } = ttsLib;
  const t = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 30000 });
  await t.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { audioStream } = t.toStream(esc, { rate: (rate >= 0 ? '+' : '') + rate + '%', pitch: (pitch >= 0 ? '+' : '') + pitch + 'Hz' });
  const buf = await new Promise((res, rej) => {
    const parts = []; let done = false;
    const fin = () => { if (done) return; done = true; res(Buffer.concat(parts)); };
    audioStream.on('data', d => parts.push(d)); audioStream.on('end', fin); audioStream.on('close', fin); audioStream.on('error', e => { if (!done) { done = true; rej(e); } });
    setTimeout(() => { if (!done) { done = true; parts.length ? res(Buffer.concat(parts)) : rej(new Error('TTS timeout')); } }, 35000);
  });
  try { t.close && t.close(); } catch {}
  if (buf.length > 500) { fs.writeFileSync(file, buf); return buf; }
  throw new Error('TTS trả về rỗng');
}
// Giọng Google (dự phòng khi giọng Microsoft lỗi) — chia câu ≤ 190 ký tự, ghép MP3
function splitChunks(text, max = 190) {
  const parts = []; let cur = '';
  for (const tok of text.split(/(?<=[.!?;:,])\s+/)) {
    if ((cur + ' ' + tok).trim().length <= max) { cur = (cur + ' ' + tok).trim(); continue; }
    if (cur) parts.push(cur);
    if (tok.length <= max) cur = tok; else { let w = ''; for (const x of tok.split(/\s+/)) { if ((w + ' ' + x).trim().length > max) { parts.push(w); w = x; } else w = (w + ' ' + x).trim(); } cur = w; }
  }
  if (cur) parts.push(cur); return parts;
}
async function ttsGoogle(text, o = {}) {
  text = String(text || '').trim(); if (!text) return null;
  const key = crypto.createHash('sha1').update(['google', text].join('|')).digest('hex');
  const file = path.join(DIRS.ttsCache, key + '.mp3');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const bufs = [];
  for (const chunk of splitChunks(text)) {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&ttsspeed=1&q=' + encodeURIComponent(chunk);
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Referer: 'https://translate.google.com/' } });
    if (!r.ok) throw new Error('Google TTS HTTP ' + r.status);
    bufs.push(Buffer.from(await r.arrayBuffer()));
  }
  const buf = Buffer.concat(bufs);
  if (buf.length < 500) throw new Error('Google TTS trả về rỗng');
  fs.writeFileSync(file, buf); return buf;
}
const ttsErrAt = {};
function ttsErr(engine, e) { const now = Date.now(); if (!ttsErrAt[engine] || now - ttsErrAt[engine] > 60000) { ttsErrAt[engine] = now; log('Giọng ' + engine + ' lỗi: ' + (e && e.message || e), 'warn'); } }
async function tts(text, o = {}) {
  const engine = config.voice.engine || 'edge';
  if (engine === 'off' || engine === 'system') return null;
  if (engine === 'edge') {
    try { return await ttsEdge(text, o); } catch (e) { ttsErr('Microsoft', e); if (config.voice.fallbackGoogle === false) throw e; }
  }
  try { return await ttsGoogle(text, o); } catch (e) { ttsErr('Google', e); throw e; }
}
function ttsCacheSize() { try { return fs.readdirSync(DIRS.ttsCache).length; } catch { return 0; } }

// ---------------- Avatar ----------------
const avatarCache = new Map();
async function fetchAvatar(url) {
  if (!url) return null;
  if (avatarCache.has(url)) return avatarCache.get(url);
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const b = Buffer.from(await r.arrayBuffer());
    const d = 'data:' + ct + ';base64,' + b.toString('base64');
    avatarCache.set(url, d); if (avatarCache.size > 300) avatarCache.delete(avatarCache.keys().next().value);
    return d;
  } catch (e) { log('Không tải được avatar: ' + e.message, 'warn'); return null; }
}

// ---------------- Hot update qua GitHub ----------------
function ghHeaders(raw) {
  const h = { 'User-Agent': 'ChuaLive', 'Cache-Control': 'no-cache' };
  if (config.update.token) h.Authorization = 'Bearer ' + config.update.token;
  if (raw) h.Accept = 'application/vnd.github.raw';
  return h;
}
async function remoteVersion() {
  const { repo, branch } = config.update;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repo chưa đúng dạng owner/ten-repo');
  let url, headers;
  if (config.update.token) { url = `https://api.github.com/repos/${repo}/contents/app/version.json?ref=${encodeURIComponent(branch || 'main')}`; headers = ghHeaders(true); }
  else { url = `https://raw.githubusercontent.com/${repo}/${branch || 'main'}/app/version.json?t=${Date.now()}`; headers = ghHeaders(false); }
  const r = await net.fetch(url, { headers });
  if (!r.ok) throw new Error('Không đọc được app/version.json trên repo (HTTP ' + r.status + ')');
  return JSON.parse(await r.text());
}
async function checkUpdate() {
  const rv = await remoteVersion();
  const newer = C.cmpVer(rv.version, C.appVer) > 0;
  const res = { current: C.appVer, remote: rv.version, notes: rv.notes || '', newer };
  toPanel('update-state', res); return res;
}
async function applyUpdate() {
  const rv = await remoteVersion();
  if (C.cmpVer(rv.version, C.appVer) <= 0) return { ok: false, msg: 'Đang dùng bản mới nhất (' + C.appVer + ')' };
  const { repo, branch } = config.update;
  toPanel('update-progress', { msg: 'Đang tải bản ' + rv.version + ' ...' });
  const url = config.update.token ? `https://api.github.com/repos/${repo}/zipball/${encodeURIComponent(branch || 'main')}` : `https://codeload.github.com/${repo}/zip/refs/heads/${branch || 'main'}`;
  const r = await net.fetch(url, { headers: ghHeaders(false) });
  if (!r.ok) throw new Error('Tải zip thất bại (HTTP ' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  toPanel('update-progress', { msg: 'Đang giải nén ' + (buf.length / 1048576).toFixed(1) + ' MB ...' });
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buf);
  const dirName = 'app-' + rv.version.replace(/[^\w.-]/g, '') + '-' + Date.now();
  const dest = path.join(C.updatesRoot, dirName);
  let count = 0;
  for (const e of zip.getEntries()) {
    const m = e.entryName.match(/^[^/]+\/app\/(.+)$/);
    if (!m || e.isDirectory) continue;
    const rel = m[1]; if (rel.includes('..')) continue;
    const out = path.join(dest, rel); fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData()); count++;
  }
  if (!fs.existsSync(path.join(dest, 'core', 'main.js')) || !fs.existsSync(path.join(dest, 'version.json'))) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error('Gói cập nhật thiếu app/core/main.js hoặc app/version.json');
  }
  // Repo có thể bỏ qua thư mục assets nặng -> dùng lại assets của bản đang chạy
  for (const sub of ['assets/characters', 'assets/frames', 'assets/video', 'assets/audio', 'assets/fonts']) {
    const to = path.join(dest, sub), from = path.join(APP, sub);
    if (!fs.existsSync(to) && fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  }
  writeJSON(path.join(C.updatesRoot, 'current.json'), { dir: dirName, version: rv.version, at: new Date().toISOString() });
  // dọn bản cũ
  for (const d of fs.readdirSync(C.updatesRoot)) {
    if (d.startsWith('app-') && d !== dirName && path.join(C.updatesRoot, d) !== APP) { try { fs.rmSync(path.join(C.updatesRoot, d), { recursive: true, force: true }); } catch {} }
  }
  log('Đã cài bản ' + rv.version + ' (' + count + ' file). Khởi động lại...', 'ok');
  return { ok: true, version: rv.version, count };
}
function relaunch() { writeJSON(CONFIG_PATH, config); app.relaunch(); app.exit(0); }
async function startupUpdate() {
  if (!config.update.auto || !config.update.repo) return false;
  try {
    const res = await Promise.race([checkUpdate(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    if (res.newer && config.update.autoApply) { const a = await applyUpdate(); if (a.ok) { relaunch(); return true; } }
  } catch (e) { console.log('update check:', e.message); }
  return false;
}

// ---------------- IPC ----------------
ipcMain.handle('init', () => initData());
ipcMain.handle('config:patch', (_e, patch) => { patchConfig(patch); return config; });
ipcMain.handle('config:set', (_e, key, value) => { setConfigKey(key, value); return config; });
ipcMain.handle('config:reset', (_e, section) => { const v = section && section.split('.').reduce((a, k) => a == null ? a : a[k], DEFAULTS); if (v !== undefined) setConfigKey(section, JSON.parse(JSON.stringify(v))); return config; });
ipcMain.handle('content:default', () => loadContent());
ipcMain.handle('tiktok:connect', async (_e, u) => { await tiktokConnect(u); return tiktokState(); });
ipcMain.handle('tiktok:disconnect', async () => { await tiktokDisconnect(true); return tiktokState(); });
ipcMain.handle('tts', async (_e, text, o) => { try { return await tts(text, o); } catch (e) { return { error: e.message }; } });
ipcMain.handle('tts:test', async (_e, engine) => {
  const text = 'A Di Đà Phật, xin chào quý Phật tử.';
  try { const b = engine === 'google' ? await ttsGoogle(text + ' ') : await ttsEdge(text, {}); return { ok: true, bytes: b.length }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('tts:clear', () => { for (const f of fs.readdirSync(DIRS.ttsCache)) fs.rmSync(path.join(DIRS.ttsCache, f), { force: true }); return 0; });
ipcMain.handle('tts:count', () => ttsCacheSize());
ipcMain.handle('avatar', (_e, url) => fetchAvatar(url));
ipcMain.on('simulate', (_e, ev) => emitLive(ev));
ipcMain.on('stage:cmd', (_e, cmd) => toStage('stage-cmd', cmd));
ipcMain.on('stage:report', (_e, data) => toPanel('stage-report', data));
ipcMain.on('log', (_e, msg, level) => log(msg, level));
ipcMain.handle('stage:open', () => { createStage(); return true; });
ipcMain.handle('stage:close', () => { if (stageWin) stageWin.close(); return true; });
ipcMain.handle('stage:set', (_e, o) => {
  if (o.onTop !== undefined) { config.window.stageOnTop = !!o.onTop; saveConfig(); }
  if (o.frame !== undefined) { config.window.stageFrame = !!o.frame; saveConfig(); if (stageWin) { stageWin.close(); setTimeout(createStage, 300); } return true; }
  if (!stageWin) return false;
  if (o.onTop !== undefined) stageWin.setAlwaysOnTop(!!o.onTop);
  if (o.size) { stageWin.setFullScreen(false); stageWin.setContentSize(Math.round(o.size * 9 / 16), o.size); }
  if (o.fullscreen !== undefined) stageWin.setFullScreen(!!o.fullscreen);
  if (o.reload) stageWin.reload();
  return true;
});
ipcMain.handle('dialog:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(panelWin, { properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: opts.filters || [] });
  return r.canceled ? [] : r.filePaths.map(p => ({ path: p, url: fileURL(p), name: path.basename(p) }));
});
ipcMain.handle('file:dataurl', (_e, p) => { const ext = path.extname(p).slice(1).toLowerCase(); const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext; return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64'); });
ipcMain.handle('music:add', (_e, files) => { for (const f of files) fs.copyFileSync(f, path.join(DIRS.music, path.basename(f))); refreshAssets(); return listMusic(); });
ipcMain.handle('music:remove', (_e, id) => { const f = id.replace(/^user:/, ''); if (id.startsWith('user:')) fs.rmSync(path.join(DIRS.music, path.basename(f)), { force: true }); refreshAssets(); return listMusic(); });
ipcMain.handle('character:save', (_e, { folder, json, files, replace }) => {
  folder = String(folder || ('nv_' + Date.now())).replace(/[^\w-]/g, '_');
  const dir = path.join(DIRS.characters, folder);
  if (replace) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files || []) fs.writeFileSync(path.join(dir, path.basename(f.name)), Buffer.from(f.data.replace(/^data:[^,]+,/, ''), 'base64'));
  writeJSON(path.join(dir, 'character.json'), json);
  refreshAssets(); return 'user:' + folder;
});
ipcMain.handle('character:clone', (_e, id) => { // copy nhân vật có sẵn sang thư mục user để sửa/thêm hoạt ảnh
  const [src, folder] = id.split(':');
  const from = src === 'bundled' ? path.join(APP, 'assets', 'characters', folder) : path.join(DIRS.characters, folder);
  let nf = folder, i = 1; while (fs.existsSync(path.join(DIRS.characters, nf))) nf = folder + '_' + (i++);
  fs.cpSync(from, path.join(DIRS.characters, nf), { recursive: true });
  refreshAssets(); return 'user:' + nf;
});
ipcMain.handle('character:delete', (_e, id) => { if (!id.startsWith('user:')) return false; fs.rmSync(path.join(DIRS.characters, path.basename(id.slice(5))), { recursive: true, force: true }); refreshAssets(); return true; });
ipcMain.handle('frame:save', (_e, { name, data, meta }) => {
  const file = 'f_' + Date.now() + '.png';
  fs.writeFileSync(path.join(DIRS.frames, file), Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64'));
  const list = readJSON(path.join(DIRS.frames, 'frames.json'), []); list.push({ file, name, ...meta });
  writeJSON(path.join(DIRS.frames, 'frames.json'), list); refreshAssets(); return 'user:' + file;
});
ipcMain.handle('frame:delete', (_e, id) => {
  if (!id.startsWith('user:')) return false; const file = id.slice(5);
  const list = readJSON(path.join(DIRS.frames, 'frames.json'), []).filter(f => f.file !== file);
  writeJSON(path.join(DIRS.frames, 'frames.json'), list); fs.rmSync(path.join(DIRS.frames, path.basename(file)), { force: true }); refreshAssets(); return true;
});
ipcMain.handle('update:check', async () => { try { return await checkUpdate(); } catch (e) { return { error: e.message }; } });
ipcMain.handle('update:apply', async () => { try { const r = await applyUpdate(); if (r.ok) setTimeout(relaunch, 1200); return r; } catch (e) { return { error: e.message }; } });
ipcMain.handle('update:rollback', () => { fs.rmSync(path.join(C.updatesRoot, 'current.json'), { force: true }); setTimeout(relaunch, 500); return true; });
ipcMain.handle('open:userdir', () => shell.openPath(USER));
ipcMain.handle('app:relaunch', () => relaunch());

// ---------------- Start ----------------
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  if (await startupUpdate()) return;
  createPanel();
  if (config.window.openStageOnStart !== false) createStage();
  setInterval(() => { if (config.update.auto && config.update.repo) checkUpdate().catch(() => {}); }, 30 * 60 * 1000);
  if (config.tiktok.autoConnect && config.tiktok.username) setTimeout(() => tiktokConnect(config.tiktok.username).catch(e => log(e.message, 'error')), 1500);
});
app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', e => log('Lỗi: ' + (e && e.stack || e), 'error'));
process.on('unhandledRejection', e => log('Lỗi: ' + (e && e.message || e), 'error'));
