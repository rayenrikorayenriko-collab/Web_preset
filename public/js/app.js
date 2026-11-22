/* =========================================================
   Kessoku Family — satu aplikasi (Web 1 member + Web 2 panel setting)
   Tanpa database. Sinkron realtime lewat Server-Sent Events.
   Ikon memakai vector (SVG sprite di index.html), bukan emoji keyboard.
   ========================================================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (sec) => { if (!sec && sec !== 0) return '0:00'; sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
/* ikon vector */
const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

let TOKEN = localStorage.getItem('kf_token') || '';
let PUBLIC = null, DB = null, activeTab = 'settings', currentAudio = null, currentTrackId = null;

/* ---------------- api ---------------- */
async function api(method, url, body, isForm) {
  const headers = {};
  if (TOKEN) headers['x-auth-token'] = TOKEN;
  let payload;
  if (isForm) payload = body;
  else { headers['Content-Type'] = 'application/json'; payload = body ? JSON.stringify(body) : undefined; }
  const res = await fetch(url, { method, headers, body: payload });
  if (res.status === 401 && url.indexOf('/api/login') < 0) { doLogout(); throw new Error('unauth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}
const uploadFile = (file) => { const fd = new FormData(); fd.append('file', file); return api('POST', '/api/upload', fd, true); };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('show', 'hidden');
  clearTimeout(t._t); clearTimeout(t._hideT);
  requestAnimationFrame(() => t.classList.add('show'));
  t._t = setTimeout(() => {
    t.classList.remove('show');
    t._hideT = setTimeout(() => { if (!t.classList.contains('show')) t.classList.add('hidden'); }, 350);
  }, 2200);
}
function setSaveState(s) { $('#saveState').textContent = s || ''; }

/* Tunda display:none sedikit agar animasi keluar sempat selesai. */
const layerTimers = new WeakMap();
function showLayer(el) {
  clearTimeout(layerTimers.get(el));
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  el.classList.remove('is-open');
  requestAnimationFrame(() => el.classList.add('is-open'));
}
function hideLayer(el) {
  clearTimeout(layerTimers.get(el));
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  layerTimers.set(el, setTimeout(() => {
    if (!el.classList.contains('is-open')) el.classList.add('hidden');
  }, 260));
}

/* =========================================================
   BAGIAN WEB 1 — tampilan publik
   ========================================================= */
async function loadPublic() {
  try { PUBLIC = await api('GET', '/api/public/data'); renderPublic(); }
  catch (e) { /* diamkan saat offline sementara */ }
}

function renderPublic() {
  if (!PUBLIC) return;
  const s = PUBLIC.settings || {};
  const root = document.documentElement.style;
  if (s.accentColor) root.setProperty('--accent', s.accentColor);
  document.title = s.siteTitle || 'Kessoku Family';
  document.querySelector('meta[name=theme-color]').setAttribute('content', '#ffffff');
  $('#brandName').textContent = s.siteTitle || 'Kessoku Family';
  $('#heroTitle').textContent = s.siteTitle || 'Kessoku Family';
  $('#heroTagline').textContent = s.siteTagline || '';
  $('#heroDesc').textContent = s.siteDescription || '';
  $('#footerText').textContent = s.footerText || ('© ' + (s.siteTitle || 'Kessoku Family'));
  const logo = $('#brandLogo');
  if (s.logoUrl) { logo.src = s.logoUrl; logo.classList.remove('hidden'); }
  else { logo.classList.add('hidden'); logo.removeAttribute('src'); }

  renderBanners(); renderCategories(); renderMusic();
  observeReveal();
}

/* Banner: maksimal satu, format tampil 16:9, di bawah bar kategori */
function renderBanners() {
  const wrap = $('#bannerSection'), box = $('#bannerWrap');
  const b = (PUBLIC.banners || [])[0];
  if (!b) { wrap.classList.add('hidden'); box.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  const m = b.media || {};
  let inner;
  if (m.url && m.type === 'video') inner = `<video src="${esc(m.url)}" muted playsinline autoplay loop></video>`;
  else if (m.url) inner = `<img src="${esc(m.url)}" alt="${esc(b.title || '')}" />`;
  else inner = `<span class="banner-empty">${ic('image')} Belum ada media banner</span>`;
  const cap = b.title ? `<div class="banner-cap">${esc(b.title)}</div>` : '';
  box.innerHTML = b.link
    ? `<a class="banner-item" href="${esc(b.link)}" target="_blank" rel="noopener">${inner}${cap}</a>`
    : `<div class="banner-item">${inner}${cap}</div>`;
}

function renderCategories() {
  const cats = PUBLIC.categories || [];
  const bar = $('#catBar');
  bar.innerHTML = `<button class="chip active" data-target="sections">Semua</button>` +
    cats.map((c) => `<button class="chip" data-target="cat-${esc(c.id)}">${esc(c.name)}</button>`).join('');
  bar.querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', () => {
    bar.querySelectorAll('.chip').forEach((x) => x.classList.remove('active')); ch.classList.add('active');
    const el = document.getElementById(ch.dataset.target); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const wrap = $('#sections');
  if (!cats.length) { wrap.innerHTML = `<p class="empty lined">Belum ada kategori. Admin bisa menambahkannya dari panel Setting.</p>`; return; }
  wrap.innerHTML = cats.map((c) => {
    const items = (PUBLIC.previews || []).filter((p) => p.categoryId === c.id);
    const cards = items.length ? items.map((p, i) => cardHTML(p, i)).join('') : `<p class="empty lined">Belum ada preview di kategori ini.</p>`;
    return `<section id="cat-${esc(c.id)}" class="section-block">
      <div class="section-head reveal"><h2>${esc(c.name)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>
      <div class="grid">${cards}</div></section>`;
  }).join('');
}
function cardHTML(p, i) {
  const m = p.media || {};
  let media = `<div class="placeholder">${ic('image')}<span>Belum ada media</span></div>`;
  if (m.url && m.type === 'video') media = `<video src="${esc(m.url)}" controls playsinline preload="metadata"${m.poster ? ` poster="${esc(m.poster)}"` : ''}></video>`;
  else if (m.url) media = `<img src="${esc(m.url)}" alt="${esc(p.title)}" loading="lazy" />`;
  const btns = (p.buttons || []).filter((b) => b && b.label)
    .map((b, k) => `<a class="card-btn${k % 2 ? ' alt' : ''}" href="${esc(b.url || '#')}" target="_blank" rel="noopener">${esc(b.label)}${ic('arrow')}</a>`).join('');
  const ratio = p.size && p.size !== 'auto' ? p.size.replace(':', '/') : '';
  return `<article class="card" style="animation-delay:${Math.min(i * 60, 400)}ms">
    <div class="card-media${ratio ? ' ratio' : ''}"${ratio ? ` style="aspect-ratio:${ratio}"` : ''}>${media}</div>
    <div class="card-body">
      <h3 class="card-title">${esc(p.title || 'Tanpa judul')}</h3>
      ${p.description ? `<p class="card-desc">${esc(p.description)}</p>` : ''}
      ${btns ? `<div class="card-buttons">${btns}</div>` : ''}
    </div></article>`;
}

function renderMusic() {
  const list = $('#musicList'), music = PUBLIC.music || [];
  $('#musicEmpty').classList.toggle('hidden', music.length > 0);
  list.innerHTML = music.map((t, i) => `
    <div class="track" data-id="${esc(t.id)}" style="animation-delay:${Math.min(i * 50, 350)}ms">
      ${t.cover ? `<img class="track-cover" src="${esc(t.cover)}" alt="" />` : `<div class="track-cover">${ic('headphones')}</div>`}
      <button class="icon-btn play" data-act="play" title="Putar">${ic('play')}</button>
      <div class="track-main">
        <p class="track-title">${esc(t.title || 'Tanpa judul')}</p>
        <p class="track-desc">${esc(t.description || '')}</p>
        <div class="track-progress" data-act="seek"><span></span></div>
      </div>
      <span class="track-time" data-time>${fmt(t.duration)}</span>
      <a class="dl-btn" href="${esc(t.url)}" download="${esc((t.title || 'musik').replace(/[\\/:*?"<>|]/g, '') + '.mp3')}">${ic('download')} MP3</a>
    </div>`).join('');
  list.querySelectorAll('.track').forEach((row) => {
    const track = music.find((x) => x.id === row.dataset.id);
    const btn = row.querySelector('[data-act="play"]'), bar = row.querySelector('[data-act="seek"]');
    const fill = bar.querySelector('span'), timeEl = row.querySelector('[data-time]');
    btn.addEventListener('click', () => togglePlay(track, row, btn, fill, timeEl));
    bar.addEventListener('click', (e) => {
      if (!currentAudio || currentTrackId !== track.id) return;
      const rect = bar.getBoundingClientRect();
      if (currentAudio.duration) currentAudio.currentTime = ((e.clientX - rect.left) / rect.width) * currentAudio.duration;
    });
  });
}
function togglePlay(track, row, btn, fill, timeEl) {
  if (currentTrackId === track.id && currentAudio) {
    if (currentAudio.paused) { currentAudio.play(); btn.innerHTML = ic('pause'); } else { currentAudio.pause(); btn.innerHTML = ic('play'); }
    return;
  }
  if (currentAudio) currentAudio.pause();
  $$('.track').forEach((r) => { r.classList.remove('track-playing'); const b = r.querySelector('[data-act="play"]'); if (b) b.innerHTML = ic('play'); const f = r.querySelector('[data-act="seek"] span'); if (f) f.style.width = '0%'; });
  currentAudio = new Audio(track.url); currentTrackId = track.id;
  row.classList.add('track-playing'); btn.innerHTML = ic('pause'); currentAudio.play().catch(() => { });
  currentAudio.addEventListener('timeupdate', () => {
    const d = currentAudio.duration || track.duration || 0;
    if (d) fill.style.width = (currentAudio.currentTime / d) * 100 + '%';
    timeEl.textContent = fmt(currentAudio.currentTime) + ' / ' + fmt(d);
  });
  currentAudio.addEventListener('ended', () => { btn.innerHTML = ic('play'); row.classList.remove('track-playing'); timeEl.textContent = fmt(track.duration); fill.style.width = '0%'; });
}

/* reveal on scroll */
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
function observeReveal() { $$('.reveal:not(.in)').forEach((el) => io.observe(el)); }

/* =========================================================
   LOGIN + PANEL SETTING (Web 2)
   ========================================================= */
function openLogin() { $('#loginErr').textContent = ''; showLayer($('#loginModal')); setTimeout(() => $('#loginPass').focus(), 80); }
function closeLogin() { hideLayer($('#loginModal')); $('#loginPass').value = ''; }

$('#openSettings').addEventListener('click', ensureAuth);
$('#loginCancel').addEventListener('click', closeLogin);
$('#loginModal').addEventListener('click', (e) => { if (e.target.id === 'loginModal') closeLogin(); });
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('POST', '/api/login', { password: $('#loginPass').value });
    TOKEN = r.token; localStorage.setItem('kf_token', TOKEN);
    closeLogin(); await openAdmin();
  } catch (err) { $('#loginErr').textContent = err.message; }
});
$('#closeAdmin').addEventListener('click', () => hideLayer($('#adminPanel')));
$('#logout').addEventListener('click', doLogout);
function doLogout() { TOKEN = ''; localStorage.removeItem('kf_token'); hideLayer($('#adminPanel')); closeLogin(); }

async function ensureAuth() {
  if (!TOKEN) return openLogin();
  try { await api('GET', '/api/session'); await openAdmin(); }
  catch (e) { openLogin(); }
}
async function openAdmin() {
  DB = await api('GET', '/api/admin/data');
  showLayer($('#adminPanel'));
  renderPanel();
}

$('#sideNav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  activeTab = b.dataset.tab;
  $$('#sideNav button').forEach((x) => x.classList.toggle('active', x === b));
  $('#topTitle').textContent = b.textContent.trim();
  renderPanel();
});

function renderPanel() {
  const p = $('#panel');
  if (!DB) return;
  p.innerHTML = activeTab === 'settings' ? viewSettings()
    : activeTab === 'categories' ? viewCategories()
      : activeTab === 'previews' ? viewPreviews()
        : activeTab === 'banners' ? viewBanners() : viewMusic();
  bindPanel();
}

/* baris tombol aksi yang sering dipakai */
const moveBtns = (id, i, len) =>
  `<button class="btn small" data-move="up" data-id="${id}" title="Naik" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button>
   <button class="btn small" data-move="down" data-id="${id}" title="Turun" ${i === len - 1 ? 'disabled' : ''}>${ic('down')}</button>`;

/* ----- Pengaturan ----- */
function viewSettings() {
  const s = DB.settings || {};
  return `<div class="pcard">
    <h2>Pengaturan Situs</h2>
    <p class="hint">Judul, keterangan, warna aksen &amp; logo yang tampil di halaman member. Perubahan langsung tersinkron ke semua device.</p>
    <div class="row">
      <div class="field"><label>Judul Web</label><input id="s-title" type="text" value="${esc(s.siteTitle)}" /></div>
      <div class="field"><label>Tagline</label><input id="s-tag" type="text" value="${esc(s.siteTagline)}" /></div>
    </div>
    <div class="field"><label>Deskripsi / Keterangan</label><textarea id="s-desc">${esc(s.siteDescription)}</textarea></div>
    <div class="row">
      <div class="field"><label>Warna Aksen</label><input id="s-accent" type="color" value="${esc(s.accentColor || '#111114')}" /></div>
      <div class="field"><label>Teks Footer</label><input id="s-footer" type="text" value="${esc(s.footerText)}" /></div>
    </div>
    <div class="field"><label>Logo <span class="sub">— URL atau upload (opsional)</span></label>
      <input id="s-logo" type="text" value="${esc(s.logoUrl)}" placeholder="https://..." />
      <div class="uploader" id="s-logo-up">${ic('upload')} Upload logo (png/jpg)</div>
    </div>
    <button class="btn primary" id="saveSettings">${ic('save')} Simpan Pengaturan</button>
  </div>`;
}
/* ----- Kategori ----- */
function viewCategories() {
  const cats = (DB.categories || []).slice().sort((a, b) => a.order - b.order);
  const rows = cats.length ? cats.map((c, i) => `
    <div class="item"><div class="thumb">${ic('folder')}</div>
      <div class="meta"><strong>${esc(c.name)}</strong><span>${esc(c.description || '')}</span>
        <span style="margin-top:6px">${(DB.previews || []).filter((p) => p.categoryId === c.id).length} preview</span></div>
      <div class="acts">${moveBtns(c.id, i, cats.length)}
        <button class="btn small" data-edit-cat="${c.id}">${ic('pencil')} Edit</button>
        <button class="btn small danger" data-del="categories" data-id="${c.id}">${ic('trash')} Hapus</button>
      </div></div>`).join('') : `<div class="empty lined">Belum ada kategori.</div>`;
  return `<div class="pcard"><div class="list-head">
      <div><h2>Kategori</h2><p class="hint" style="margin:0">Muncul sebagai bar di Web 1 dan jadi tempat preview.</p></div>
      <button class="btn primary" id="addCat">${ic('plus')} Tambah Kategori</button></div>${rows}</div>`;
}
/* ----- Preview ----- */
function viewPreviews() {
  const catName = (id) => (DB.categories.find((c) => c.id === id) || {}).name || '(tanpa kategori)';
  const items = (DB.previews || []).slice().sort((a, b) => a.order - b.order);
  const rows = items.length ? items.map((p, i) => {
    const m = p.media || {};
    const thumb = m.url && m.type !== 'video' ? `<img class="thumb" src="${esc(m.url)}" />`
      : `<div class="thumb">${ic(m.type === 'video' ? 'film' : 'image')}</div>`;
    return `<div class="item">${thumb}
      <div class="meta"><strong>${esc(p.title || 'Tanpa judul')}</strong><span>${esc(p.description || '')}</span>
        <span style="margin-top:6px"><span class="tag">${esc(catName(p.categoryId))}</span> &nbsp; ${(p.buttons || []).length} tombol</span></div>
      <div class="acts">${moveBtns(p.id, i, items.length)}
        <button class="btn small" data-edit-preview="${p.id}">${ic('pencil')} Edit</button>
        <button class="btn small danger" data-del="previews" data-id="${p.id}">${ic('trash')} Hapus</button>
      </div></div>`;
  }).join('') : `<div class="empty lined">Belum ada preview.</div>`;
  return `<div class="pcard"><div class="list-head">
      <div><h2>Preview &amp; Tombol</h2><p class="hint" style="margin:0">Media (video/foto) + penjelasan + tombol (bisa banyak) + kategori.</p></div>
      <button class="btn primary" id="addPreview">${ic('plus')} Tambah Preview</button></div>${rows}</div>`;
}
/* ----- Banner (maks 1, 16:9) ----- */
function viewBanners() {
  const b = (DB.banners || [])[0];
  const m = b && b.media ? b.media : {};
  let prev = `${ic('image')} Belum ada banner`;
  if (m.url && m.type === 'video') prev = `<video src="${esc(m.url)}" muted playsinline></video>`;
  else if (m.url) prev = `<img src="${esc(m.url)}" alt="" />`;
  return `<div class="pcard">
    <div class="list-head">
      <div><h2>Banner</h2><p class="hint" style="margin:0">Cuma satu banner, tampil rapi di bawah bar kategori. Format otomatis 16:9.</p></div>
      <button class="btn primary" id="editBanner">${ic(b ? 'pencil' : 'plus')} ${b ? 'Edit Banner' : 'Tambah Banner'}</button>
    </div>
    <div class="banner-preview">${prev}</div>
    ${b ? `<div class="grid-hint">${ic('bulb')} ${esc(b.title || '(tanpa judul)')}${b.link ? ' — ' + esc(b.link) : ''}</div>
      <div style="margin-top:14px"><button class="btn small danger" data-del="banners" data-id="${b.id}">${ic('trash')} Hapus banner</button></div>` : ''}
  </div>`;
}
/* ----- Musik ----- */
function viewMusic() {
  const items = (DB.music || []).slice().sort((a, b) => a.order - b.order);
  const rows = items.length ? items.map((t, i) => `
    <div class="item">${t.cover ? `<img class="thumb" src="${esc(t.cover)}" />` : `<div class="thumb">${ic('headphones')}</div>`}
      <div class="meta"><strong>${esc(t.title || 'Tanpa judul')}</strong><span>${esc(t.description || '')}</span>
        <span style="margin-top:6px"><span class="tag">${fmt(t.duration)}</span></span></div>
      <div class="acts">${moveBtns(t.id, i, items.length)}
        <button class="btn small" data-edit-music="${t.id}">${ic('pencil')} Edit</button>
        <button class="btn small danger" data-del="music" data-id="${t.id}">${ic('trash')} Hapus</button>
      </div></div>`).join('') : `<div class="empty lined">Belum ada musik.</div>`;
  return `<div class="pcard"><div class="list-head">
      <div><h2>Rekomendasi Musik</h2><p class="hint" style="margin:0">Upload musik apa saja → durasi otomatis &amp; dikonversi ke MP3. Member bisa putar &amp; download.</p></div>
      <button class="btn primary" id="addMusic">${ic('plus')} Tambah Musik</button></div>${rows}</div>`;
}

/* ----- bind per panel ----- */
function bindPanel() {
  if (activeTab === 'settings') {
    $('#saveSettings').addEventListener('click', saveSettings);
    $('#s-logo-up').addEventListener('click', () => pickUpload((info) => { if (info.url) { $('#s-logo').value = info.url; toast('Logo siap, jangan lupa Simpan'); } }, 'image/*'));
  }
  if (activeTab === 'categories') $('#addCat').addEventListener('click', () => openCategoryEditor(null));
  if (activeTab === 'previews') $('#addPreview').addEventListener('click', () => openPreviewEditor(null));
  if (activeTab === 'banners') $('#editBanner').addEventListener('click', () => openBannerEditor((DB.banners || [])[0] || null));
  if (activeTab === 'music') $('#addMusic').addEventListener('click', () => openMusicEditor(null));
  $('#panel').addEventListener('click', onPanelClick);
}
function onPanelClick(e) {
  const mv = e.target.closest('[data-move]'); if (mv) return moveItem(mv.dataset.id, mv.dataset.move);
  const dl = e.target.closest('[data-del]'); if (dl) return deleteItem(dl.dataset.del, dl.dataset.id);
  const ec = e.target.closest('[data-edit-cat]'); if (ec) return openCategoryEditor(DB.categories.find((c) => c.id === ec.dataset.editCat));
  const ep = e.target.closest('[data-edit-preview]'); if (ep) return openPreviewEditor(DB.previews.find((x) => x.id === ep.dataset.editPreview));
  const em = e.target.closest('[data-edit-music]'); if (em) return openMusicEditor(DB.music.find((x) => x.id === em.dataset.editMusic));
}

/* ----- CRUD ----- */
async function moveItem(id, dir) {
  const map = { categories: DB.categories, previews: DB.previews, music: DB.music };
  for (const key of Object.keys(map)) {
    const arr = map[key]; if (!arr || !arr.find((x) => x.id === id)) continue;
    const sorted = arr.slice().sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((x) => x.id === id), j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    await api('POST', `/api/admin/${key}/reorder`, { ids: sorted.map((x) => x.id) });
    DB = await api('GET', '/api/admin/data'); renderPanel();
    toast('Urutan diperbarui'); return;
  }
}
async function deleteItem(collection, id) {
  if (!confirm('Hapus item ini?')) return;
  await api('DELETE', `/api/admin/${collection}/${id}`);
  DB = await api('GET', '/api/admin/data'); renderPanel(); toast('Dihapus');
}

/* ----- modal ----- */
let modalSave = null;
function openModal(title, bodyHTML, onSave, saveLabel) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = bodyHTML;
  $('#modalSave').textContent = saveLabel || 'Simpan'; modalSave = onSave;
  showLayer($('#modal'));
}
function closeModal() { hideLayer($('#modal')); modalSave = null; }
$('#modalClose').addEventListener('click', closeModal);
$('#modalCancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$('#modalSave').addEventListener('click', async () => {
  if (!modalSave) return; setSaveState('Menyimpan...');
  try { await modalSave(); closeModal(); DB = await api('GET', '/api/admin/data'); renderPanel(); setSaveState('Tersimpan'); toast('Tersimpan'); }
  catch (err) { setSaveState(''); toast('Gagal: ' + err.message); }
});
function pickUpload(onDone, accept) {
  const inp = document.createElement('input'); inp.type = 'file'; if (accept) inp.accept = accept;
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; toast('Mengunggah...'); try { onDone(await uploadFile(f)); } catch (e) { toast('Upload gagal: ' + e.message); } };
  inp.click();
}
function uploaderHTML(id, label) { return `<div class="uploader" id="${id}">${ic('upload')} ${label}</div>`; }
function wireUploader(id, onDone, accept) { const el = document.getElementById(id); if (el) el.addEventListener('click', () => pickUpload((info) => { el.classList.add('has'); onDone(info); }, accept)); }

const state = { previewMedia: {}, music: {}, bannerMedia: {} };

/* ----- settings ----- */
async function saveSettings() {
  setSaveState('Menyimpan...');
  try {
    await api('PUT', '/api/admin/settings', {
      siteTitle: $('#s-title').value, siteTagline: $('#s-tag').value, siteDescription: $('#s-desc').value,
      accentColor: $('#s-accent').value, logoUrl: $('#s-logo').value, footerText: $('#s-footer').value
    });
    DB = await api('GET', '/api/admin/data'); renderPanel(); setSaveState('Tersimpan'); toast('Pengaturan disimpan');
  } catch (e) { setSaveState(''); toast('Gagal: ' + e.message); }
}

/* ----- kategori editor ----- */
function openCategoryEditor(cat) {
  const c = cat || { name: '', description: '' };
  openModal(cat ? 'Edit Kategori' : 'Tambah Kategori', `
    <div class="field"><label>Nama Kategori</label><input id="c-name" type="text" value="${esc(c.name)}" placeholder="cth: Music Covers" /></div>
    <div class="field"><label>Keterangan</label><textarea id="c-desc">${esc(c.description || '')}</textarea></div>`,
    async () => {
      const name = $('#c-name').value.trim(); if (!name) throw new Error('Nama wajib diisi');
      await api('POST', '/api/admin/categories', { id: c.id, name, description: $('#c-desc').value });
    });
}

/* ----- preview editor ----- */
function openPreviewEditor(preview) {
  const p = preview || { title: '', description: '', categoryId: (DB.categories[0] || {}).id || '', media: {}, buttons: [] };
  state.previewMedia = Object.assign({}, p.media || {});
  const catOpts = (DB.categories || []).map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const sizes = ['auto', '16:9', '9:16', '1:1', '4:3', '3:2'];
  const sizeOpts = sizes.map((s) => `<option value="${s}" ${(p.size || 'auto') === s ? 'selected' : ''}>${s === 'auto' ? 'Otomatis (sesuai media)' : s}</option>`).join('');
  openModal(preview ? 'Edit Preview' : 'Tambah Preview', `
    <div class="field"><label>Judul Preview</label><input id="p-title" type="text" value="${esc(p.title)}" /></div>
    <div class="row">
      <div class="field"><label>Kategori</label><select id="p-cat">${catOpts || '<option value="">(buat kategori dulu)</option>'}</select></div>
      <div class="field"><label>Ukuran Tampilan</label><select id="p-size">${sizeOpts}</select></div>
    </div>
    <div class="field"><label>Penjelasan <span class="sub">— bisa diedit</span></label><textarea id="p-desc">${esc(p.description || '')}</textarea></div>
    <div class="field"><label>Media (video / foto) <span class="sub">— ukuran otomatis menyesuaikan</span></label>
      ${uploaderHTML('p-up', 'Upload video atau foto')}
      <div id="p-media-info" class="sub" style="margin-top:8px">${p.media && p.media.url ? 'Media sudah ada' : 'Belum ada media'}</div></div>
    <div class="field"><label>Tombol <span class="sub">— teks &amp; link bisa diubah, bisa ditambah banyak</span></label>
      <div id="btnRows">${(p.buttons || []).map((b) => btnRowHTML(b.label, b.url)).join('')}</div>
      <button class="btn small" id="addBtnRow" type="button">${ic('plus')} Tambah Tombol</button></div>`,
    async () => {
      const title = $('#p-title').value.trim(); if (!title) throw new Error('Judul wajib diisi');
      const buttons = $$('#btnRows .btn-row').map((r) => ({ label: r.querySelector('.lbl').value.trim(), url: r.querySelector('.url').value.trim() })).filter((b) => b.label);
      await api('POST', '/api/admin/previews', { id: p.id, title, description: $('#p-desc').value, categoryId: $('#p-cat').value, size: $('#p-size').value, media: state.previewMedia, buttons });
    });
  wireUploader('p-up', (info) => {
    if (info.kind === 'audio') { toast('Ini file audio — pilih video/foto untuk preview'); return; }
    state.previewMedia = { type: info.kind, url: info.url, poster: info.poster || '', size: info.size || null };
    $('#p-media-info').textContent = info.name + (info.size ? ` (${info.size.width}x${info.size.height})` : '');
  }, 'video/*,image/*');
  wireBtnRows();
}
function btnRowHTML(label, url) {
  return `<div class="btn-row"><input class="lbl" type="text" placeholder="Teks tombol" value="${esc(label || '')}" />
    <input class="url" type="url" placeholder="https://link-tujuan" value="${esc(url || '')}" />
    <button class="btn small danger" type="button" data-rm title="Hapus">${ic('x')}</button></div>`;
}
function wireBtnRows() {
  const box = $('#btnRows');
  const bind = () => box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => b.closest('.btn-row').remove(); });
  $('#addBtnRow').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', btnRowHTML('', '')); bind(); });
  bind();
}

/* ----- musik editor ----- */
function openMusicEditor(track) {
  const t = track || { title: '', description: '', url: '', duration: null, cover: '' };
  state.music = Object.assign({}, t);
  openModal(track ? 'Edit Musik' : 'Tambah Musik', `
    <div class="field"><label>Judul Musik</label><input id="m-title" type="text" value="${esc(t.title)}" /></div>
    <div class="field"><label>Penjelasan</label><textarea id="m-desc">${esc(t.description || '')}</textarea></div>
    <div class="field"><label>File Musik <span class="sub">— durasi otomatis, otomatis jadi MP3</span></label>
      ${uploaderHTML('m-up', 'Upload musik (mp3/wav/m4a/...)')}
      <div id="m-info" class="sub" style="margin-top:8px">${t.url ? 'File sudah ada (' + (t.duration || '—') + 's)' : 'Belum ada file'}</div></div>
    <div class="field"><label>Cover <span class="sub">(opsional)</span></label>${uploaderHTML('m-cover', 'Upload gambar cover (opsional)')}</div>`,
    async () => {
      const title = $('#m-title').value.trim(); if (!title) throw new Error('Judul wajib diisi');
      if (!state.music.url) throw new Error('Upload file musik dulu');
      await api('POST', '/api/admin/music', { id: t.id, title, description: $('#m-desc').value, url: state.music.url, duration: state.music.duration, cover: state.music.cover || '' });
    });
  wireUploader('m-up', (info) => { state.music.url = info.url; state.music.duration = info.duration; $('#m-info').textContent = info.name + ' — durasi ' + (info.duration || '?') + ' detik (MP3)'; }, 'audio/*');
  wireUploader('m-cover', (info) => { if (info.kind === 'image') { state.music.cover = info.url; toast('Cover siap'); } }, 'image/*');
}

/* ----- banner editor (tunggal, 16:9) ----- */
function openBannerEditor(banner) {
  const b = banner || { title: '', link: '', media: {} };
  state.bannerMedia = Object.assign({}, b.media || {});
  const m = b.media || {};
  const prev = m.url
    ? (m.type === 'video' ? `<video src="${esc(m.url)}" muted playsinline></video>` : `<img src="${esc(m.url)}" alt="" />`)
    : ic('image');
  openModal(banner ? 'Edit Banner' : 'Tambah Banner', `
    <div class="field"><label>Judul Banner <span class="sub">(opsional)</span></label><input id="b-title" type="text" value="${esc(b.title)}" /></div>
    <div class="field"><label>Link <span class="sub">(opsional — klik banner membuka link ini)</span></label><input id="b-link" type="url" value="${esc(b.link || '')}" placeholder="https://..." /></div>
    <div class="field"><label>Media Banner <span class="sub">— tampil 16:9</span></label>
      ${uploaderHTML('b-up', 'Upload gambar / video')}
      <div class="banner-preview" id="b-prev" style="margin-top:10px">${prev}</div>
    </div>`,
    async () => {
      await api('POST', '/api/admin/banners', { title: $('#b-title').value.trim(), link: $('#b-link').value.trim(), media: state.bannerMedia });
    });
  wireUploader('b-up', (info) => {
    state.bannerMedia = { type: info.kind, url: info.url, poster: info.poster || '' };
    const p = $('#b-prev');
    p.innerHTML = info.kind === 'video' ? `<video src="${esc(info.url)}" muted playsinline></video>` : `<img src="${esc(info.url)}" alt="" />`;
  }, 'image/*,video/*');
}

/* =========================================================
   SINKRON REALTIME (SSE) — perubahan admin langsung tampil di semua device
   ========================================================= */
function connectEvents() {
  try {
    const es = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = async (ev) => {
      let msg = {}; try { msg = JSON.parse(ev.data); } catch (e) { }
      if (msg.type === 'change') {
        await loadPublic();
        if (TOKEN && !$('#adminPanel').classList.contains('hidden') && $('#modal').classList.contains('hidden')) {
          try { DB = await api('GET', '/api/admin/data'); renderPanel(); } catch (e) { }
        }
      }
    };
  } catch (e) { setLive(false); }
}
function setLive(on) { const d = $('#liveDot'); if (!d) return; d.classList.toggle('off', !on); d.innerHTML = `<i></i> ${on ? 'Live tersambung' : 'Menyambung ulang...'}`; }

/* =========================================================
   INIT
   ========================================================= */
let progressFrame = 0;
function updatePageProgress() {
  if (progressFrame) return;
  progressFrame = requestAnimationFrame(() => {
    progressFrame = 0;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
    $('#progressFill').style.transform = `scaleX(${ratio})`;
  });
}
window.addEventListener('scroll', () => {
  const n = document.querySelector('.nav');
  if (n) n.classList.toggle('scrolled', window.scrollY > 12);
  updatePageProgress();
}, { passive: true });
window.addEventListener('resize', updatePageProgress, { passive: true });
loadPublic();
connectEvents();
observeReveal();
updatePageProgress();
if (TOKEN) api('GET', '/api/session').catch(() => { }); // validasi token tanpa membuka panel
