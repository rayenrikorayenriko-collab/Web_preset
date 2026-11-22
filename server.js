/**
 * Kessoku Family — satu server untuk Web 1 (member) & Web 2 (panel setting admin).
 * Tanpa database: data disimpan sebagai file JSON (data/db.json) + media di public/uploads.
 * Password admin & secret key disimpan di file .env (bukan di JS / browser).
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_FILE = path.join(ROOT, 'data', 'db.json');
const ENV_FILE = path.join(ROOT, '.env');
const PORT = process.env.PORT || 5173;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

/* ---------------- .env (secret key di server, bukan di JS) ---------------- */
function parseEnv(text) {
  const out = {};
  text.split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}
function loadEnv() {
  if (fs.existsSync(ENV_FILE)) Object.assign(process.env, parseEnv(fs.readFileSync(ENV_FILE, 'utf8')));
}
loadEnv();
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'QWERTY12354';
  fs.appendFileSync(ENV_FILE, `\nADMIN_PASSWORD=${process.env.ADMIN_PASSWORD}\n`);
}
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = crypto.randomBytes(48).toString('hex');
  fs.appendFileSync(ENV_FILE, `AUTH_SECRET=${process.env.AUTH_SECRET}\n`);
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const AUTH_SECRET = process.env.AUTH_SECRET;
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 jam

/* ---------------- penyimpanan JSON + siaran realtime ---------------- */
function defaultData() {
  return {
    settings: {
      siteTitle: 'Kessoku Family', siteTagline: 'Preview & Rekomendasi Musik',
      siteDescription: 'Kumpulan preview karya dan rekomendasi musik pilihan buat keluarga Kessoku. Pilih kategori di bawah untuk mulai menjelajah.',
      logoUrl: '', accentColor: '#111114',
      footerText: '© Kessoku Family'
    },
    categories: [], previews: [], banners: [], music: []
  };
}
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { const d = defaultData(); save(d); return d; }
}
function save(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
  broadcast({ type: 'change', at: Date.now() });
}
function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

/* ---------------- Server-Sent Events (sinkron antar device) ---------------- */
const sseClients = new Set();
function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch (e) { sseClients.delete(res); } }
}

/* ---------------- helper media (ffmpeg) ---------------- */
function probeDuration(file) {
  return new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    (err, stdout) => resolve(err ? null : parseFloat(String(stdout).trim()) || null)));
}
function probeSize(file) {
  return new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file],
    (err, stdout) => { if (err) return resolve(null); const [w, h] = String(stdout).trim().split('x').map(Number); resolve(w && h ? { width: w, height: h } : null); }));
}
function makePoster(videoPath) {
  return new Promise((resolve) => {
    const out = videoPath.replace(/\.[^.]+$/, '') + '.poster.jpg';
    execFile('ffmpeg', ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=640:-1', out], () => resolve(fs.existsSync(out) ? '/uploads/' + path.basename(out) : null));
  });
}
function toMp3(src) {
  return new Promise((resolve) => {
    if (src.toLowerCase().endsWith('.mp3')) return resolve(src);
    const out = src.replace(/\.[^.]+$/, '') + '.mp3';
    execFile('ffmpeg', ['-y', '-i', src, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', out], () => resolve(fs.existsSync(out) ? out : src));
  });
}

/* ---------------- upload (dengan validasi tipe) ---------------- */
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.mkv', '.m4v', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '';
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(ALLOWED_EXT.includes(ext) ? null : new Error('Tipe file tidak diizinkan'), ALLOWED_EXT.includes(ext));
  }
});

/* ---------------- auth: token bertanda tangan (HMAC) ---------------- */
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); }
function signToken() {
  const payload = { exp: Date.now() + TOKEN_TTL, n: crypto.randomBytes(8).toString('hex') };
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(p).digest('hex');
  return p + '.' + sig;
}
function verifyToken(t) {
  if (!t || t.indexOf('.') < 0) return false;
  const [p, sig] = t.split('.');
  const expect = crypto.createHmac('sha256', AUTH_SECRET).update(p).digest('hex');
  if (sig.length !== expect.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  try { return JSON.parse(b64urlDecode(p)).exp > Date.now(); } catch (e) { return false; }
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function requireAuth(req, res, next) {
  if (verifyToken(req.get('x-auth-token'))) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
/* pembatas percobaan login (anti brute-force) */
const loginAttempts = new Map();
function loginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.until) { loginAttempts.delete(ip); return false; }
  return rec.count >= 5;
}
function noteFail(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  rec.count++; rec.until = Date.now() + 15 * 60 * 1000;
  loginAttempts.set(ip, rec);
}

/* ---------------- app ---------------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

/* header keamanan */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
    "script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'");
  next();
});
app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginBlocked(ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  const { password } = req.body || {};
  if (!safeEqual(password, ADMIN_PASSWORD)) { noteFail(ip); return res.status(401).json({ error: 'Password salah' }); }
  loginAttempts.delete(ip);
  res.json({ token: signToken() });
});

/* cek token masih valid */
app.get('/api/session', requireAuth, (req, res) => res.json({ ok: true }));

/* siaran realtime */
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { } }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

/* data publik (Web 1) */
app.get('/api/public/data', (req, res) => {
  const db = load();
  res.json({
    settings: db.settings,
    categories: db.categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    previews: db.previews.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    banners: db.banners.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    music: db.music.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    updatedAt: Date.now()
  });
});

/* data lengkap (panel setting) */
app.get('/api/admin/data', requireAuth, (req, res) => res.json(load()));

/* upload media */
app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload gagal' });
    if (!req.file) return res.status(400).json({ error: 'File tidak ada' });
    const fullPath = req.file.path;
    const url = '/uploads/' + req.file.filename;
    const mime = req.file.mimetype || '';
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isAudio = mime.startsWith('audio/') || ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext);
    const isVideo = mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext);
    const isImage = mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext);
    const out = { url, kind: isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : 'file', name: req.file.originalname };
    if (isAudio) {
      const dur = await probeDuration(fullPath);
      out.duration = dur ? Math.round(dur) : null;
      out.mp3Url = '/uploads/' + path.basename(await toMp3(fullPath));
      out.url = out.mp3Url;
    } else if (isVideo) {
      const dur = await probeDuration(fullPath); out.duration = dur ? Math.round(dur) : null;
      const sz = await probeSize(fullPath); if (sz) out.size = sz;
      out.poster = await makePoster(fullPath);
    } else if (isImage) {
      const sz = await probeSize(fullPath); if (sz) out.size = sz;
    }
    res.json(out);
  });
});

/* settings */
app.put('/api/admin/settings', requireAuth, (req, res) => {
  const db = load();
  db.settings = Object.assign({}, db.settings, req.body || {});
  save(db); res.json(db.settings);
});

/* CRUD generik */
function upsert(collection) {
  return (req, res) => {
    const db = load(); const item = req.body || {};
    if (!item.id) { item.id = uid(collection.slice(0, 3)); item.order = db[collection].length; db[collection].push(item); }
    else { const i = db[collection].findIndex((x) => x.id === item.id); if (i >= 0) db[collection][i] = Object.assign({}, db[collection][i], item); else db[collection].push(item); }
    save(db); res.json(item);
  };
}
function removeItem(collection) {
  return (req, res) => {
    const db = load();
    db[collection] = db[collection].filter((x) => x.id !== req.params.id);
    if (collection === 'categories') db.previews = db.previews.filter((p) => p.categoryId !== req.params.id);
    save(db); res.json({ ok: true });
  };
}
function reorder(collection) {
  return (req, res) => {
    const db = load(); const ids = (req.body && req.body.ids) || [];
    ids.forEach((id, i) => { const it = db[collection].find((x) => x.id === id); if (it) it.order = i; });
    save(db); res.json({ ok: true });
  };
}
['categories', 'previews', 'music'].forEach((col) => {
  app.post('/api/admin/' + col, requireAuth, upsert(col));
  app.delete('/api/admin/' + col + '/:id', requireAuth, removeItem(col));
  app.post('/api/admin/' + col + '/reorder', requireAuth, reorder(col));
});

/* banner: hanya satu banner, format tampil 16:9 */
app.post('/api/admin/banners', requireAuth, (req, res) => {
  const db = load(); const it = req.body || {};
  const existing = db.banners[0] || {};
  const b = { id: existing.id || uid('ban'), title: it.title || '', link: it.link || '', media: it.media || {}, order: 0 };
  db.banners = [b];
  save(db); res.json(b);
});
app.delete('/api/admin/banners/:id', requireAuth, removeItem('banners'));

app.listen(PORT, () => {
  console.log(`Kessoku Family berjalan di http://localhost:${PORT}`);
  console.log(`  Situs          : http://localhost:${PORT}/  (panel setting dibuka dari tombol Pengaturan + password)`);
  console.log(`  Password admin : tersimpan aman di .env`);
});
