# Kessoku Family

Web preview karya + rekomendasi musik, sekaligus panel setting admin — **satu aplikasi, tanpa database**.
Data disimpan sebagai file JSON (`data/db.json`) dan media di `public/uploads/`, jadi tersinkron antar device.

## Cara menjalankan

Butuh **Node.js** (disarankan v18+) dan **ffmpeg** (untuk durasi otomatis & konversi ke MP3).

```bash
npm install
npm start
```

Buka `http://localhost:5173`.

## Buka panel setting (Web 2)

Klik tombol **Pengaturan** di kanan atas → masukkan password.

Password admin & secret key tersimpan di file `.env` (otomatis dibuat saat pertama jalan, **tidak** ikut ke-upload ke GitHub). Login dibatasi 5 percobaan / 15 menit per IP.

## Isi panel setting

- **Pengaturan** — judul, tagline, deskripsi, warna aksen, logo, teks footer.
- **Kategori** — muncul sebagai bar di halaman member & jadi tempat preview.
- **Preview & Tombol** — media (video/foto, ukuran otomatis) + penjelasan + tombol (teks & link, bisa banyak) + kategori.
- **Banner** — maksimal **1 banner**, selalu tampil rapi **16:9** di bawah bar kategori.
- **Musik** — upload musik apa saja → durasi otomatis, dikonversi ke **MP3**, member bisa putar & download.

Semua perubahan langsung tersinkron ke semua device (Server-Sent Events).

## Deploy

Upload ke GitHub lalu jalankan di hosting Node (Railway, Render, VPS, dsb).
Setelah upload pertama, isi `.env` di server dengan `ADMIN_PASSWORD` dan `AUTH_SECRET` kamu sendiri.

## Struktur

```
server.js            server Express (API + auth + upload)
data/db.json         data (tanpa database)
public/index.html    halaman (Web 1 + panel Web 2)
public/css/app.css   tema putih, elegan, responsif
public/js/app.js     logika aplikasi
public/uploads/      media hasil upload
```
