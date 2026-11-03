// Chùa Live — main process (được cập nhật nóng qua GitHub)
const { app, BrowserWindow, ipcMain, dialog, net, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const C = global.CHUA || { appDir: path.join(__dirname, '..'), appVer: '0.0.0', updatesRoot: path.join(app.getPath('userData'), 'updates'), cmpVer: () => 0, fromHot: false };
const APP = C.appDir;
// Bản cập nhật nóng nằm trong AppData (không có node_modules) -> luôn nạp thư viện từ thư mục cài đặt
const ROOT = C.rootDir || path.join(__dirname, '..', '..');
const rootRequire = require('module').createRequire(path.join(ROOT, 'package.json'));
module.paths.unshift(path.join(ROOT, 'node_modules'));
function loadLib(name) { try { return rootRequire(name); } catch (e) { return require(name); } }
async function importLib(name) { try { return await import(pathToFileURL(rootRequire.resolve(name)).href); } catch (e) { return await import(name); } }
const USER = app.getPath('userData');
const DIRS = {
  user: path.join(USER, 'user'),
  characters: path.join(USER, 'user', 'characters'),
  frames: path.join(USER, 'user', 'frames'),
  music: path.join(USER, 'user', 'music'),
  videos: path.join(USER, 'user', 'videos'),
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

// ---------- Ghi lỗi crash & tự phục hồi ----------
const CRASH_LOG = path.join(USER, 'crash.log');
function crash(msg) { const line = new Date().toISOString() + '  ' + msg; try { fs.appendFileSync(CRASH_LOG, line + '\n'); } catch {} log(msg, 'error'); }
function guardWindow(win, name) {
  win.webContents.on('render-process-gone', (_e, d) => {
    const nowT = Date.now(); win._crashes = (win._crashes || []).filter(t => nowT - t < 60000); win._crashes.push(nowT);
    if (win._crashes.length > 3) { crash(`Cửa sổ ${name} lỗi liên tục — dừng tự tải lại. Hãy bật "Tắt tăng tốc đồ hoạ" (tab Kết nối LIVE) rồi mở lại app.`); return; }
    crash(`Cửa sổ ${name} bị lỗi (${d.reason}, code ${d.exitCode}) — tự tải lại`);
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 800);
  });
  win.webContents.on('unresponsive', () => crash(`Cửa sổ ${name} bị treo`));
}
let prevSession = [];
try {
  const L = fs.readFileSync(CRASH_LOG, 'utf8').trim().split('\n');
  const s = L.map(x => x.includes('(app khởi động)')).lastIndexOf(true);
  const sess = L.slice(s + 1);
  prevSession = sess.filter(x => !x.includes('(app đóng bình thường)'));
  if (s >= 0 && !sess.some(x => x.includes('(app đóng bình thường)'))) prevSession.push('Lần trước app tắt đột ngột (không đóng bình thường).');
  if (L.length > 400) fs.writeFileSync(CRASH_LOG, L.slice(-200).join('\n') + '\n');
} catch {}
try { fs.appendFileSync(CRASH_LOG, new Date().toISOString() + '  (app khởi động v' + C.appVer + ')\n'); } catch {}
if (config.window.disableGpu) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.on('child-process-gone', (_e, d) => crash(`Tiến trình ${d.type} dừng (${d.reason}, code ${d.exitCode})${d.type === 'GPU' ? ' — nếu lặp lại, bật "Tắt tăng tốc đồ hoạ" ở tab Kết nối LIVE' : ''}`));
function createPanel() {
  const b = config.window.panel || {};
  panelWin = new BrowserWindow({ width: b.width || 1180, height: b.height || 820, x: b.x, y: b.y, minWidth: 900, minHeight: 600, title: 'Chùa Live — Bảng điều khiển', backgroundColor: '#14110d', webPreferences: webPrefs, autoHideMenuBar: true });
  panelWin.loadFile(path.join(APP, 'panel', 'index.html'));
  guardWindow(panelWin, 'bảng điều khiển');
  panelWin.webContents.once('did-finish-load', () => {
    if (prevSession.length) log('Phiên trước có lỗi:\n' + prevSession.slice(-6).join('\n'), 'warn');
  });
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
  stageWin.setAspectRatio(config.window.aspect === '16:9' ? 16 / 9 : 9 / 16);
  stageWin.loadFile(path.join(APP, 'stage', 'index.html'));
  guardWindow(stageWin, 'màn hình LIVE');
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
function listVideos() { // ảnh / video nền
  const out = [];
  const bd = path.join(APP, 'assets', 'bg');
  readJSON(path.join(bd, 'backgrounds.json'), []).forEach(v => { if (fs.existsSync(path.join(bd, v.file))) out.push({ ...v, id: 'bundled:' + v.file, url: fileURL(path.join(bd, v.file)), source: 'bundled', type: 'image' }); });
  try { for (const f of fs.readdirSync(DIRS.videos)) { const isImg = /\.(png|jpe?g|webp)$/i.test(f), isVid = /\.(mp4|webm|mov|m4v)$/i.test(f); if (isImg || isVid) out.push({ id: 'user:' + f, name: f, url: fileURL(path.join(DIRS.videos, f)), source: 'user', type: isImg ? 'image' : 'video' }); } } catch {}
  return out;
}
function initData() {
  return {
    config, content: loadContent(), version: C.appVer, fromHot: C.fromHot, bundledVersion: C.bundledVer,
    characters: listCharacters(), frames: listFrames(), music: listMusic(), videos: listVideos(),
    assets: { base: fileURL(path.join(APP, 'assets')) + '/' }, userDir: USER,
    tiktok: tiktokState(),
  };
}
function refreshAssets() { broadcast('assets', { characters: listCharacters(), frames: listFrames(), music: listMusic(), videos: listVideos() }); }

// ---------------- TikTok LIVE ----------------
let tk = { conn: null, wanted: false, username: '', status: 'disconnected', roomId: null, viewers: 0, retryTimer: null, lib: null, err: '' };
function tiktokState() { return { status: tk.status, username: tk.username, roomId: tk.roomId, viewers: tk.viewers, err: tk.err }; }
function setTkStatus(s, err = '') { tk.status = s; tk.err = err; toPanel('tiktok-state', tiktokState()); toStage('tiktok-state', tiktokState()); }
function pickImg(img) { if (!img) return ''; const u = img.urlList || img.url_list || img.url || img.urls; return Array.isArray(u) ? (u.find(x => /^https?:/.test(x) && !/\.heic/i.test(x)) || u[0] || '') : (typeof u === 'string' ? u : ''); }
function imgList(img) { if (!img) return []; const u = img.urlList || img.url_list || img.url || img.urls; return (Array.isArray(u) ? u : (typeof u === 'string' ? [u] : [])).filter(x => /^https?:/.test(x)); }
function avatarList(u) {
  const all = [].concat(imgList(u.avatarMedium), imgList(u.avatarThumb), imgList(u.avatarLarge), imgList(u.profilePictureMedium), imgList(u.profilePicture), imgList(u.profilePictureLarge), u.profilePictureUrl ? [u.profilePictureUrl] : []);
  const uniq = [...new Set(all)];
  return uniq.filter(x => !/\.heic/i.test(x)).concat(uniq.filter(x => /\.heic/i.test(x))).slice(0, 6);
}
function normUser(u) {
  u = u || {};
  const uid = u.uniqueId || u.displayId || u.display_id || '';
  return {
    id: String(u.userId || u.id || uid || u.nickname || ''),
    uniqueId: uid,
    nickname: (u.nickname || uid || 'Phật tử').trim(),
    avatar: avatarList(u)[0] || '',
    avatars: avatarList(u),
  };
}
function emitLive(ev) { toStage('live-event', ev); toPanel('live-event', ev); }

async function tiktokConnect(username, opts = {}) {
  const raw = String(username || '').trim();
  username = raw.replace(/^https?:\/\/(www\.|m\.)?tiktok\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/\s+/g, '');
  if (!username) throw new Error('Chưa nhập tên tài khoản TikTok');
  if (/\s/.test(raw.replace(/^https?:\S+/, ''))) log('Tên TikTok không có khoảng trắng — đã dùng "@' + username + '". Hãy nhập đúng ID (tên sau dấu @ trên trang cá nhân), không phải tên hiển thị.', 'warn');
  await tiktokDisconnect(false);
  if (opts.manual) tk.fails = 0;
  tk.wanted = true; tk.username = username;
  patchConfig({ tiktok: { username } });
  if (!tk.lib) tk.lib = await importLib('tiktok-live-connector');
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = tk.lib;
  const options = { processInitialData: false, enableExtendedGiftInfo: false, fetchRoomInfoOnConnect: false };
  if (config.tiktok.signApiKey) options.signApiKey = config.tiktok.signApiKey;
  const conn = new TikTokLiveConnection(username, options);
  tk.conn = conn;
  setTkStatus('connecting');
  log('Đang kết nối tới @' + username + ' ...');

  const E = WebcastEvent || {};
  const on = (name, fn) => { try { conn.on(name, d => { try { fn(d); } catch (e) { log('Lỗi xử lý sự kiện ' + name + ': ' + e.message, 'error'); } }); } catch {} };
  on(E.MEMBER || 'member', d => emitLive({ type: 'join', user: normUser(d.user) }));
  on(E.CHAT || 'chat', d => emitLive({ type: 'chat', user: normUser(d.user), text: d.comment || d.content || '' }));
  on(E.FOLLOW || 'follow', d => emitLive({ type: 'follow', user: normUser(d.user) }));
  on(E.SHARE || 'share', d => emitLive({ type: 'share', user: normUser(d.user) }));
  on(E.LIKE || 'like', d => emitLive({ type: 'like', user: normUser(d.user), count: d.likeCount || d.count || 1, total: d.totalLikeCount || Number(d.total) || 0 }));
  on(E.ROOM_USER || 'roomUser', d => { tk.viewers = d.viewerCount || Number(d.total) || tk.viewers; toPanel('tiktok-state', tiktokState()); toStage('tiktok-state', tiktokState()); });
  on(E.GIFT || 'gift', d => {
    const g = d.gift || d.giftDetails || {}; const ext = d.extendedGiftInfo || {};
    const giftType = g.type ?? g.giftType ?? ext.type;
    if (giftType === 1 && !d.repeatEnd) return; // đang combo — chờ kết thúc
    const per = Number(g.diamondCount || g.diamond_count || ext.diamond_count || ext.diamondCount || 0);
    const repeat = Math.max(1, Number(d.repeatCount || d.comboCount || 1));
    emitLive({ type: 'gift', user: normUser(d.user), giftName: g.name || g.giftName || ext.name || 'quà', giftImage: pickImg(g.image) || pickImg(g.giftImage) || pickImg(g.icon), repeat, coins: per * repeat, perCoin: per });
  });
  on(E.STREAM_END || 'streamEnd', () => { log('Buổi LIVE đã kết thúc', 'warn'); setTkStatus('ended'); });
  on((ControlEvent && ControlEvent.DISCONNECTED) || 'disconnected', () => {
    if (tk.conn !== conn) return;
    setTkStatus('disconnected'); log('Mất kết nối TikTok', 'warn');
    if (tk.wanted) scheduleRetry();
  });
  on((ControlEvent && ControlEvent.ERROR) || 'error', e => log('TikTok lỗi: ' + (e?.info || e?.message || JSON.stringify(e)).slice(0, 300), 'error'));
  try {
    let rid = String(config.tiktok.roomId || '').trim();
    if (!rid) rid = await findRoomId(username);
    if (rid) log('Room ID: ' + rid);
    const state = await conn.connect(rid || undefined);
    if (tk.conn !== conn) return;
    tk.roomId = state?.roomId || conn.roomId || null;
    tk.fails = 0;
    setTkStatus('connected'); log('Đã kết nối LIVE @' + username + (tk.roomId ? ' (room ' + tk.roomId + ')' : ''), 'ok');
  } catch (e) {
    if (tk.conn !== conn) return;
    const msg = e?.message || String(e);
    const detail = [].concat(e?.errors || [], e?.cause || []).map(x => x?.message || String(x)).filter(Boolean).slice(0, 4);
    setTkStatus('error', msg); log('Không kết nối được: ' + msg + (detail.length ? '\n  • ' + detail.join('\n  • ') : ''), 'error');
    const rate = /rate.?limit/i.test(msg);
    if (rate) log(config.tiktok.signApiKey
      ? 'Đã hết lượt kết nối theo giờ của API key Euler Stream. App sẽ tự thử lại sau ít phút. Nếu hay gặp, nâng gói ở eulerstream.com.'
      : 'Máy chủ ký kết nối (Euler Stream) giới hạn số lần kết nối mỗi giờ khi KHÔNG có API key. Cách sửa: vào eulerstream.com → đăng ký miễn phí → tạo API key → dán vào ô "Euler Stream API key" ở tab Kết nối LIVE. App sẽ tự thử lại sau 10 phút.', 'warn');
    if (/Room ID/i.test(msg)) log('Gợi ý: (1) kiểm tra đúng ID TikTok (sau dấu @, không dấu cách) và tài khoản ĐANG LIVE; (2) nhập Room ID ở mục Nâng cao; (3) nhập Euler Stream API key (miễn phí tại eulerstream.com) ở mục Nâng cao.', 'warn');
    if (tk.wanted) scheduleRetry(rate ? 'rate' : '');
  }
}
// Tự tìm Room ID bằng trình duyệt nội bộ của Electron (dùng proxy/cookie hệ thống) — ổn định hơn cách của thư viện
async function findRoomId(user) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';
  const tries = [
    async () => { const r = await net.fetch(`https://www.tiktok.com/api-live/user/room/?aid=1988&app_name=tiktok_web&device_platform=web_pc&uniqueId=${encodeURIComponent(user)}&sourceType=54`, { headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' } }); const j = await r.json(); return j?.data?.user?.roomId || j?.data?.liveRoom?.roomId; },
    async () => { const r = await net.fetch(`https://www.tiktok.com/@${encodeURIComponent(user)}/live`, { headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' } }); const h = await r.text(); const mm = h.match(/"roomId":"(\d{6,})"/) || h.match(/room_id=(\d{6,})/) || h.match(/"room_id":"?(\d{6,})/); return mm && mm[1]; },
  ];
  for (const t of tries) { try { const id = await Promise.race([t(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]); if (id && String(id) !== '0') return String(id); } catch (e) { console.log('findRoomId', e.message); } }
  return '';
}
function scheduleRetry(kind) {
  clearTimeout(tk.retryTimer);
  tk.fails = (tk.fails || 0) + 1;
  let s = Math.max(5, config.tiktok.retrySeconds || 15) * Math.pow(2, Math.min(5, tk.fails - 1)); // 15, 30, 60, 120, 240...
  if (kind === 'rate') s = Math.max(s, 600); // bị giới hạn lượt ký -> chờ lâu, thử liên tục chỉ làm hết lượt
  s = Math.min(s, kind === 'rate' ? 1800 : 300);
  log('Thử kết nối lại sau ' + (s >= 60 ? Math.round(s / 60) + ' phút' : s + ' giây') + '...');
  tk.retryAt = Date.now() + s * 1000;
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
  if (!ttsLib) ttsLib = loadLib('msedge-tts');
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
// ---------------- VieNeu-TTS (chạy trên máy người dùng) ----------------
const { spawn } = require('child_process');
const vn = { proc: null, status: 'off', voices: [], err: '', starting: false };
const vnCfg = () => config.vieneu || {};
const vnBase = () => 'http://127.0.0.1:' + (vnCfg().port || 8765);
function vnState() { return { status: vn.status, voices: vn.voices, err: vn.err, running: !!vn.proc }; }
function vnEmit() { toPanel('vieneu-state', vnState()); }
function splitCmd(c) { const m = c.match(/^"([^"]+)"\s*(.*)$/); if (m) return [m[1], ...m[2].split(/\s+/).filter(Boolean)]; const p = c.split(/\s+/); return [p[0], ...p.slice(1)]; }
function pyCandidates() {
  const c = (vnCfg().python || '').trim(); if (c) return [c];
  const out = []; if (vnCfg().pythonExe) out.push('"' + vnCfg().pythonExe + '"');
  return out.concat(process.platform === 'win32' ? ['python', 'py -3.12', 'py -3.11', 'py'] : ['python3', 'python']);
}
async function vnHealth() {
  try { const r = await net.fetch(vnBase() + '/health'); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
function spawnPy(args, label, onLine) {
  return new Promise(res => {
    const cands = pyCandidates(); let i = 0;
    const tryNext = () => {
      if (i >= cands.length) return res({ ok: false, error: 'Không tìm thấy Python. Cài Python 3.10+ từ python.org (tích "Add python.exe to PATH") rồi thử lại.' });
      const cmd = cands[i++]; const [exe, ...pre] = splitCmd(cmd);
      let p; try { p = spawn(exe, [...pre, ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }); } catch (e) { return tryNext(); }
      let started = false;
      p.on('error', () => { if (!started) tryNext(); });
      p.on('spawn', () => { started = true; res({ ok: true, proc: p, cmd }); });
      const feed = d => String(d).split(/\r?\n/).forEach(l => { l = l.trim(); if (l) onLine && onLine(l); });
      p.stdout && p.stdout.on('data', feed); p.stderr && p.stderr.on('data', feed);
    };
    tryNext();
  });
}
// ghi nhớ đúng file python.exe đã cài vieneu để lần sau chạy đúng trình thông dịch đó
function runCapture(cmd, args) {
  return new Promise(res => { const [exe, ...pre] = splitCmd(cmd); let out = ''; let p; try { p = spawn(exe, [...pre, ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }); } catch { return res({ code: -1, out: '' }); }
    p.on('error', () => res({ code: -1, out })); p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); p.on('exit', code => res({ code, out })); });
}
async function vnRememberPython(cmd) {
  const r = await runCapture(cmd, ['-c', 'import sys, vieneu; print("EXE=" + sys.executable)']);
  const m = r.out.match(/EXE=(.+)/);
  if (r.code === 0 && m) { config.vieneu = { ...(config.vieneu || {}), pythonExe: m[1].trim() }; saveConfig(); log('VieNeu dùng Python: ' + m[1].trim()); return true; }
  log('Kiểm tra VieNeu sau khi cài thất bại: ' + r.out.trim().split('\n').slice(-2).join(' '), 'warn'); return false;
}
async function vnInstall() {
  log('Đang cài VieNeu-TTS (python -m pip install -U vieneu) — lần đầu mất vài phút...');
  let last = 0;
  const r = await spawnPy(['-m', 'pip', 'install', '-U', 'vieneu'], 'pip', l => { if (Date.now() - last > 1500 || /Successfully|ERROR|error/i.test(l)) { last = Date.now(); log('[pip] ' + l.slice(0, 200)); } });
  if (!r.ok) { log(r.error, 'error'); return r; }
  const usedCmd = r.cmd;
  return await new Promise(res => r.proc.on('exit', async code => { const ok = code === 0; if (ok) await vnRememberPython(usedCmd); log(ok ? 'Đã cài xong VieNeu-TTS. Đang khởi động máy chủ giọng (lần đầu sẽ tải model, vui lòng chờ)...' : 'Cài VieNeu-TTS lỗi (mã ' + code + ').', ok ? 'ok' : 'error'); if (ok) { if (vn.proc) { try { vn.proc.kill(); } catch {} vn.proc = null; } setTimeout(() => vnStart().catch(() => {}), 500); } res({ ok }); }));
}
async function vnStart() {
  if (vn.starting) return vnState();
  const h0 = await vnHealth();
  if (h0 && h0.ok) { vn.status = 'ready'; vn.voices = h0.voices || []; vnEmit(); return vnState(); }
  if (!vn.proc) {
    vn.starting = true; vn.status = 'starting'; vn.err = ''; vnEmit();
    const script = path.join(APP, 'tools', 'vieneu_server.py');
    let last = 0;
    const r = await spawnPy([script, String(vnCfg().port || 8765)], 'vieneu', l => { if (Date.now() - last > 2000 || /error|lỗi|sẵn sàng|Traceback/i.test(l)) { last = Date.now(); log('[VieNeu] ' + l.slice(0, 220)); } });
    vn.starting = false;
    if (!r.ok) { vn.status = 'error'; vn.err = r.error; vnEmit(); log(r.error, 'error'); return vnState(); }
    vn.proc = r.proc;
    vn.proc.on('exit', code => { vn.proc = null; if (vn.status !== 'off') { vn.status = 'error'; vn.err = 'Máy chủ VieNeu đã dừng (mã ' + code + '). Có thể chưa cài: bấm "Cài VieNeu".'; vnEmit(); } });
  }
  // chờ tải model (lần đầu tải từ Internet, có thể vài phút)
  for (let k = 0; k < 300 && vn.proc; k++) {
    await new Promise(r => setTimeout(r, 2000));
    const h = await vnHealth();
    if (h && h.ok) { vn.status = 'ready'; vn.voices = h.voices || []; vnEmit(); log('VieNeu-TTS sẵn sàng (' + vn.voices.length + ' giọng).', 'ok'); return vnState(); }
    if (h && h.error) {
      if (/No module named 'vieneu'/.test(h.error) && !vn.retried) {
        vn.retried = true; vnStop(); vn.status = 'starting'; vnEmit();
        for (const c of pyCandidates()) { if (await vnRememberPython(c)) { log('Đã tìm thấy Python có VieNeu — khởi động lại máy chủ giọng...'); return vnStart(); } }
        log('Chưa có Python nào cài được VieNeu. Bấm "1. Cài VieNeu" lại.', 'warn');
      }
      vn.status = 'error'; vn.err = h.error + (h.python ? ' (Python: ' + h.python + ')' : ''); vnEmit(); log('VieNeu lỗi: ' + vn.err, 'error'); return vnState();
    }
  }
  return vnState();
}
function vnStop() { vn.status = 'off'; if (vn.proc) { try { vn.proc.kill(); } catch {} vn.proc = null; } vnEmit(); }
app.on('before-quit', () => { if (vn.proc) try { vn.proc.kill(); } catch {} });
async function ttsVieneu(text, o = {}) {
  text = String(text || '').trim(); if (!text) return null;
  const c = vnCfg();
  const role = (o.voice && o.voice === config.voice.thanksVoice && config.voice.thanksVoice !== config.voice.voice) ? 'thanks' : 'sermon';
  const voice = role === 'thanks' ? (c.thanksVoice || c.voice) : c.voice;
  const ref = role === 'thanks' ? (c.thanksRef || '') : (c.sermonRef || '');
  const key = crypto.createHash('sha1').update(['vieneu', voice, ref, text].join('|')).digest('hex');
  const file = path.join(DIRS.ttsCache, key + '.wav');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (vn.status !== 'ready') { const h = await vnHealth(); if (!(h && h.ok)) { if (!vn.proc && !vn.starting) vnStart(); throw new Error('Máy chủ VieNeu chưa sẵn sàng'); } vn.status = 'ready'; }
  const r = await net.fetch(vnBase() + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: voice || undefined, ref_audio: ref || undefined }) });
  if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) throw new Error('VieNeu trả về rỗng');
  fs.writeFileSync(file, buf); return buf;
}
async function tts(text, o = {}) {
  const engine = config.voice.engine || 'edge';
  if (engine === 'off' || engine === 'system') return null;
  if (engine === 'vieneu') {
    try { return await ttsVieneu(text, o); } catch (e) { ttsErr('VieNeu', e); }
    if (vnCfg().strict !== false) { // giữ đúng một giọng: chờ VieNeu sẵn sàng rồi thử lại, không chuyển sang giọng khác
      for (let k = 0; k < 30 && vn.status !== 'ready'; k++) await new Promise(r => setTimeout(r, 1000));
      return await ttsVieneu(text, o);
    }
    try { return await ttsEdge(text, o); } catch (e) { ttsErr('Microsoft', e); }
    try { return await ttsGoogle(text, o); } catch (e) { ttsErr('Google', e); throw e; }
  }
  if (engine === 'edge') {
    try { return await ttsEdge(text, o); } catch (e) { ttsErr('Microsoft', e); if (config.voice.fallbackGoogle === false) throw e; }
  }
  try { return await ttsGoogle(text, o); } catch (e) { ttsErr('Google', e); throw e; }
}
function ttsCacheSize() { try { return fs.readdirSync(DIRS.ttsCache).length; } catch { return 0; } }

// ---------------- Avatar ----------------
const avatarCache = new Map();
let avatarWarned = 0;
async function fetchAvatar(input) {
  const list = (Array.isArray(input) ? input : [input]).filter(Boolean);
  if (!list.length) return null;
  const key = list[0];
  if (avatarCache.has(key)) return avatarCache.get(key);
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';
  const errs = [];
  for (const url of list) {
    for (const headers of [{ 'User-Agent': UA, Referer: 'https://www.tiktok.com/' }, { 'User-Agent': UA }]) {
      try {
        const r = await net.fetch(url, { headers });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let ct = (r.headers.get('content-type') || '').split(';')[0].trim();
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length < 100) throw new Error('ảnh rỗng');
        if (/heic|heif/i.test(ct) || /\.heic/i.test(url)) throw new Error('định dạng HEIC không hiển thị được');
        if (!/^image\//.test(ct)) ct = b[0] === 0x89 ? 'image/png' : (b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg');
        const d = 'data:' + ct + ';base64,' + b.toString('base64');
        avatarCache.set(key, d); if (avatarCache.size > 300) avatarCache.delete(avatarCache.keys().next().value);
        return d;
      } catch (e) { errs.push(e.message); }
    }
  }
  if (Date.now() - avatarWarned > 60000) { avatarWarned = Date.now(); log('Không tải được avatar (' + list.length + ' link): ' + [...new Set(errs)].join('; ') + ' — ' + String(list[0]).slice(0, 90), 'warn'); }
  return list.find(x => !/\.heic/i.test(x)) || null; // để màn hình tự thử tải trực tiếp
}

// ---------------- Hot update qua GitHub ----------------
function ghHeaders(raw) {
  const h = { 'User-Agent': 'ChuaLive', 'Cache-Control': 'no-cache' };
  if (config.update.token) h.Authorization = 'Bearer ' + config.update.token;
  if (raw) h.Accept = 'application/vnd.github.raw';
  return h;
}
// Lấy mã commit mới nhất để né bộ đệm 5 phút của raw.githubusercontent.com
async function latestSha() {
  const { repo, branch } = config.update;
  try {
    const r = await net.fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch || 'main')}`, { headers: { ...ghHeaders(false), Accept: 'application/vnd.github.sha' } });
    if (r.ok) { const s = (await r.text()).trim(); if (/^[0-9a-f]{40}$/.test(s)) return s; }
  } catch {}
  return null;
}
async function remoteVersion() {
  const { repo, branch } = config.update;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repo chưa đúng dạng owner/ten-repo');
  const sha = await latestSha();
  const ref = sha || (branch || 'main');
  let url, headers;
  if (config.update.token) { url = `https://api.github.com/repos/${repo}/contents/app/version.json?ref=${encodeURIComponent(ref)}`; headers = ghHeaders(true); }
  else { url = `https://raw.githubusercontent.com/${repo}/${ref}/app/version.json?t=${Date.now()}`; headers = ghHeaders(false); }
  const r = await net.fetch(url, { headers });
  if (!r.ok) throw new Error('Không đọc được app/version.json trên repo (HTTP ' + r.status + ')');
  const j = JSON.parse(await r.text()); j._sha = sha; return j;
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
  const url = config.update.token ? `https://api.github.com/repos/${repo}/zipball/${encodeURIComponent(rv._sha || branch || 'main')}` : (rv._sha ? `https://codeload.github.com/${repo}/zip/${rv._sha}` : `https://codeload.github.com/${repo}/zip/refs/heads/${branch || 'main'}`);
  const r = await net.fetch(url, { headers: ghHeaders(false) });
  if (!r.ok) throw new Error('Tải zip thất bại (HTTP ' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  toPanel('update-progress', { msg: 'Đang giải nén ' + (buf.length / 1048576).toFixed(1) + ' MB ...' });
  const AdmZip = loadLib('adm-zip');
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
function relaunch() { writeJSON(CONFIG_PATH, config); try { fs.appendFileSync(CRASH_LOG, new Date().toISOString() + '  (app đóng bình thường — khởi động lại)\n'); } catch {} app.relaunch(); app.exit(0); }
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
ipcMain.handle('config:set', async (_e, key, value) => {
  if (key === 'tiktok.signApiKey' && tk.lib && value !== config.tiktok.signApiKey) {
    setConfigKey(key, value); writeJSON(CONFIG_PATH, config);
    const r = await dialog.showMessageBox(panelWin, { type: 'question', buttons: ['Khởi động lại ngay', 'Để sau'], defaultId: 0, title: 'Chùa Live', message: 'Cần khởi động lại app để dùng API key mới. Khởi động lại ngay?' });
    if (r.response === 0) relaunch();
    return config;
  } setConfigKey(key, value); return config; });
ipcMain.handle('config:reset', (_e, section) => { const v = section && section.split('.').reduce((a, k) => a == null ? a : a[k], DEFAULTS); if (v !== undefined) setConfigKey(section, JSON.parse(JSON.stringify(v))); return config; });
ipcMain.handle('content:default', () => loadContent());
ipcMain.handle('tiktok:connect', async (_e, u) => { await tiktokConnect(u, { manual: true }); return tiktokState(); });
ipcMain.handle('tiktok:disconnect', async () => { await tiktokDisconnect(true); return tiktokState(); });
ipcMain.handle('tts', async (_e, text, o) => { try { return await tts(text, o); } catch (e) { return { error: e.message }; } });
ipcMain.handle('tts:test', async (_e, engine) => {
  const text = 'A Di Đà Phật, xin chào quý Phật tử.';
  try { const b = engine === 'google' ? await ttsGoogle(text + ' ') : await ttsEdge(text, {}); return { ok: true, bytes: b.length }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('vieneu:status', async () => { const h = await vnHealth(); if (h && h.ok) { vn.status = 'ready'; vn.voices = h.voices || []; } return vnState(); });
ipcMain.handle('vieneu:install', () => vnInstall());
ipcMain.handle('vieneu:start', () => vnStart());
ipcMain.handle('vieneu:stop', () => { vnStop(); return vnState(); });
ipcMain.handle('vieneu:test', async (_e, role) => {
  try { const b = await ttsVieneu('A Di Đà Phật, kính chào quý Phật tử đã về chùa.', { voice: role === 'thanks' ? config.voice.thanksVoice : config.voice.voice }); return { ok: true, data: b }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('vieneu:clone', async (_e, { name, file }) => {
  const dir = path.join(USER, 'user', 'voices'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, Date.now() + '_' + path.basename(file)); fs.copyFileSync(file, dest);
  try { const r = await net.fetch(vnBase() + '/add_voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, path: dest }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); vn.voices = j.voices || vn.voices; vnEmit(); return { ok: true, path: dest }; }
  catch (e) { return { ok: false, error: e.message, path: dest }; }
});
ipcMain.handle('vieneu:prerender', async () => {
  const c = config.content; const S = (c.custom && c.sermons) ? c.sermons : loadContent().sermons;
  const lines = S.flatMap(s => s.lines); let ok = 0, fail = 0;
  log('Đang tạo sẵn giọng VieNeu cho ' + lines.length + ' câu giảng...');
  for (let i = 0; i < lines.length; i++) {
    try { await ttsVieneu(lines[i], { voice: config.voice.voice }); ok++; } catch (e) { fail++; if (fail > 5 && ok === 0) { log('Dừng tạo giọng: ' + e.message, 'error'); break; } }
    if (i % 10 === 9) log('Đã tạo ' + (i + 1) + '/' + lines.length + ' câu');
  }
  log('Xong: ' + ok + ' câu đã có sẵn giọng VieNeu' + (fail ? ', lỗi ' + fail : ''), ok ? 'ok' : 'warn');
  return { ok, fail };
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
  if (o.size) { o.w = Math.round(o.size * 9 / 16); o.h = o.size; }
  if (o.w && o.h) {
    const aspect = o.w > o.h ? '16:9' : '9:16';
    config.window.aspect = aspect; saveConfig();
    stageWin.setFullScreen(false);
    stageWin.setAspectRatio(0); stageWin.setContentSize(o.w, o.h); stageWin.setAspectRatio(o.w / o.h);
    const [cw, ch] = stageWin.getContentSize();
    if (cw < o.w - 2 || ch < o.h - 2) log(`Màn hình máy nhỏ hơn ${o.w}×${o.h} nên cửa sổ chỉ được ${cw}×${ch}. Trong TikTok LIVE Studio/OBS có thể phóng nguồn Window Capture lên cho vừa khung.`, 'warn');
  }
  if (o.fullscreen !== undefined) stageWin.setFullScreen(!!o.fullscreen);
  if (o.reload) stageWin.reload();
  return true;
});
ipcMain.handle('dialog:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(panelWin, { properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: opts.filters || [] });
  return r.canceled ? [] : r.filePaths.map(p => ({ path: p, url: fileURL(p), name: path.basename(p) }));
});
ipcMain.handle('file:dataurl', (_e, p) => { const ext = path.extname(p).slice(1).toLowerCase(); const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext; return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64'); });
ipcMain.handle('video:add', (_e, files) => { fs.mkdirSync(DIRS.videos, { recursive: true }); for (const f of files) fs.copyFileSync(f, path.join(DIRS.videos, path.basename(f))); refreshAssets(); return listVideos(); });
ipcMain.handle('video:remove', (_e, id) => { if (id.startsWith('user:')) fs.rmSync(path.join(DIRS.videos, path.basename(id.slice(5))), { force: true }); refreshAssets(); return listVideos(); });
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
ipcMain.handle('config:export', async () => {
  const r = await dialog.showSaveDialog(panelWin, { defaultPath: 'chua-live-' + (config.tiktok.username || 'cau-hinh') + '.json', filters: [{ name: 'Cấu hình', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  const c = JSON.parse(JSON.stringify(config)); delete c.window; if (c.update) delete c.update.token;
  fs.writeFileSync(r.filePath, JSON.stringify(c, null, 2)); return r.filePath;
});
ipcMain.handle('config:import', async () => {
  const r = await dialog.showOpenDialog(panelWin, { properties: ['openFile'], filters: [{ name: 'Cấu hình', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  const c = readJSON(r.filePaths[0]); if (!c || typeof c !== 'object') throw new Error('File cấu hình không hợp lệ');
  delete c.window; const keepToken = config.update.token;
  config = deepMerge(DEFAULTS, deepMerge(config, c)); config.update.token = keepToken; saveConfig(); broadcast('config', config); return true;
});
ipcMain.handle('open:userdir', () => shell.openPath(USER));
ipcMain.handle('app:relaunch', () => relaunch());

// ---------------- Start ----------------
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Không cho Windows/Chromium tạm dừng màn hình LIVE khi bị cửa sổ khác (TikTok LIVE Studio, OBS) che hoặc thu nhỏ
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async () => {
  // cho phép màn hình LIVE dùng webcam (khung người dẫn)
  try {
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'camera', 'microphone', 'mediaKeySystem'].includes(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'camera', 'microphone'].includes(perm));
  } catch {}
  if (await startupUpdate()) return;
  createPanel();
  if (config.window.openStageOnStart !== false) createStage();
  setInterval(() => { if (config.update.auto && config.update.repo) checkUpdate().catch(() => {}); }, 30 * 60 * 1000);
  if (config.tiktok.autoConnect && config.tiktok.username) setTimeout(() => tiktokConnect(config.tiktok.username).catch(e => log(e.message, 'error')), 1500);
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(() => { if (config.voice.engine === 'vieneu') setTimeout(() => vnStart().catch(() => {}), 3000); });
process.on('uncaughtException', e => crash('Lỗi: ' + (e && e.stack || e)));
app.on('before-quit', () => { try { fs.appendFileSync(CRASH_LOG, new Date().toISOString() + '  (app đóng bình thường)\n'); } catch {} });
process.on('unhandledRejection', e => log('Lỗi: ' + (e && e.message || e), 'error'));
