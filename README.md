# Panduan Deployment & Arsitektur: Web Control Panel (Cloudflare Native)

Folder **`CP WEB/`** berisi sistem **Web Control Panel & Real-Time Analytics** yang dirancang 100% menggunakan ekosistem **Cloudflare Native**:
1. **Frontend Hosting:** Cloudflare Pages (HTML, CSS, JS murni tanpa build step).
2. **Serverless API Engine:** Cloudflare Pages Functions (`/functions/api/`).
3. **Database Relasional:** Cloudflare D1 (Serverless SQLite dengan native UPSERT NIK).
4. **Object Storage:** Cloudflare R2 (Penyimpanan arsip snapshot backup file `.csv` super ringan).
5. **100% Bebas Google Apps Script (GAS):** Bebas limit kuota, bebas cold start lambat, dan latensi ultra-rendah langsung di Edge Jakarta.

---

## 1. Kredensial Akun Bawaan (Default Seed Data)

Sistem sudah dilengkapi dengan 2 akun bawaan di dalam database:

| Username | Password | Role | Masa Aktif | Hak Akses |
| :--- | :--- | :--- | :--- | :--- |
| **`admin`** | `admin123` | **Administrator** | **LIFETIME (Selamanya)** | Akses penuh, kelola petugas, buat backup R2, pantau semua data |
| **`petugas1`** | `petugas123` | **Petugas Skrining** | **Hingga 31-12-2026** | Dashboard entri, rekap pasien, unduh laporan pribadi |

> **Aturan Bisnis Lisensi:**  
> * **Akun Admin:** Tidak memiliki masa aktif (Aktif Selamanya / Lifetime). Sistem melewati semua pengecekan tanggal kedaluwarsa.
> * **Akun Petugas:** Wajib memiliki tanggal masa aktif. Saat tanggal telah terlewati, sistem otomatis menolak login dan meminta petugas menghubungi admin.

---

## 2. Struktur Berkas di `CP WEB/`

```text
CP WEB/
├── index.html                 # Antarmuka Web Control Panel (Auth Cyber Neon + Dashboard)
├── style.css                  # Desain Dark Glassmorphism, Theme Neon, Responsive
├── app.js                     # Controller Frontend, SheetJS On-The-Fly Converter, Filter
├── schema.sql                 # Definisi Tabel users & records + Seed Admin di D1
├── wrangler.toml              # Konfigurasi Binding Pages, D1 (DB), dan R2 (BUCKET)
├── _headers                   # Konfigurasi Security & Cache Cloudflare Pages
├── functions/
│   └── api/
│       ├── auth.js            # Login & Validasi Lisensi (Admin Lifetime vs Petugas Expired)
│       ├── users.js           # CRUD Petugas & Perpanjangan Masa Aktif (Khusus Admin)
│       ├── records.js         # UPSERT NIK (Pendaftaran & Skrining Klinis UMUM / SEKOLAH)
│       └── storage.js         # Backup CSV ke Cloudflare R2 & Unduh Arsip
└── README.md                  # Panduan Deployment Lengkap ini
```

---

## 3. Langkah-Langkah Deployment ke Cloudflare

### Cara A: Melalui Dashboard Cloudflare (Paling Mudah / Tanpa Terminal)

1. **Buat Database Cloudflare D1:**
   * Buka [Cloudflare Dashboard](https://dash.cloudflare.com/) -> pilih menu **Storage & Databases** -> **D1 SQL Database**.
   * Klik **Create database**, beri nama: `cekat_db`.
   * Buka database tersebut, pilih tab **Console / SQL Editor**.
   * Buka file `schema.sql` di folder ini, salin seluruh kodenya, tempelkan ke SQL Editor Cloudflare, lalu klik **Execute**.  
     *(Tabel `users`, `records`, dan akun `admin` bawaan akan langsung terbentuk).*

2. **Buat Bucket Cloudflare R2:**
   * Pada menu kiri dashboard, pilih **R2 Object Storage**.
   * Klik **Create bucket**, beri nama: `cekat-storage` (Lokasi: Otomatis / Asia Pasifik).

3. **Deploy Web Control Panel ke Cloudflare Pages:**
   * Pilih menu **Compute (Workers & Pages)** -> **Pages**.
   * Klik **Create application** -> **Pages** -> **Upload assets**.
   * Beri nama proyek (misal: `panel-cekat`).
   * Seret (*drag-and-drop*) seluruh folder **`CP WEB/`** ke area upload Cloudflare.
   * Klik **Deploy site**.

4. **Hubungkan D1 dan R2 ke Pages (Binding):**
   * Setelah deploy berhasil, buka halaman proyek Pages Anda di dashboard.
   * Masuk ke **Settings** -> **Functions**.
   * Gulir ke bagian **D1 database bindings**:
     * Klik **Add binding** -> Variabel Name: `DB` -> Pilih database: `cekat_db`.
   * Gulir ke bagian **R2 bucket bindings**:
     * Klik **Add binding** -> Variabel Name: `BUCKET` -> Pilih bucket: `cekat-storage`.
   * Lakukan re-deploy (atau buat perubahan commit kecil) agar binding aktif 100%.

---

### Cara B: Menggunakan Wrangler CLI (Developer Mode)

Jika Anda terbiasa dengan terminal / command prompt:

```bash
# 1. Masuk ke direktori
cd "g:/My Drive/Bot/PRAKTIS v1.0.0/CP WEB"

# 2. Buat D1 Database
npx wrangler d1 create cekat_db
# (Salin database_id yang muncul dan masukkan ke wrangler.toml)

# 3. Eksekusi skema SQL ke D1
npx wrangler d1 execute cekat_db --file=./schema.sql

# 4. Buat Bucket R2
npx wrangler r2 bucket create cekat-storage

# 5. Deploy langsung ke Cloudflare Pages
npx wrangler pages deploy . --project-name=panel-cekat
```

---

## 4. Cara Ekstensi Bot Mengirim Data ke Cloudflare D1

Ekstensi bot PRAKTIS / CEKAT Anda dapat langsung mengirim data hasil otomasi ke URL Cloudflare Pages Anda (misal `https://panel-cekat.pages.dev`):

### A. Saat Pendaftaran Pasien (Auto-Record & Anti-Dobel):
```javascript
// Kirim data saat bot selesai mengisi pendaftaran:
await fetch("https://panel-cekat.pages.dev/api/records", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nik: patient.nik,
    category: "SEKOLAH", // atau "UMUM"
    nama: patient.nama,
    tanggal_lahir: patient.tanggalLahir,
    jenis_kelamin: patient.jenisKelamin,
    sekolah: patient.sekolah,
    kelas: patient.kelas,
    nomor_tiket: nomorTiket,
    petugas: currentUser.username
  })
});
```
*Jika NIK sudah ada, database otomatis memperbarui info tanpa membuat baris baru.*

### B. Saat Pemeriksaan (Menu Pasien / Pelayanan):
```javascript
// Kirim data klinis saat bot selesai pemeriksaan di Menu Pasien:
await fetch("https://panel-cekat.pages.dev/api/records", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nik: patient.nik,
    category: "SEKOLAH",
    // Field Klinis Lengkap:
    bb: patient.bb,
    tb: patient.tb,
    lp: patient.lp,
    sistol: patient.td_sistolik,
    diastol: patient.td_diastolik,
    gula: patient.gula_darah,
    hb: patient.hb,
    karies: patient.karies,
    kacamata: patient.kacamata,
    menstruasi: patient.menstruasi,
    kebugaran: patient.kebugaran,
    petugas: currentUser.username
  })
});
```
*Data pemeriksaan langsung melengkapi baris identitas pasien yang sama berdasarkan NIK.*

---

## 5. Fitur Konversi CSV-to-XLSX On-The-Fly (Proteksi NIK Tipe Teks)

* **Masalah Klasik Excel:** Jika file CSV dibuka biasa di Microsoft Excel, NIK 16 digit berubah menjadi eksponensial (seperti `3.20101E+15`) atau angka nol di awal terpotong.
* **Solusi di Sistem Ini:**
  * Tombol hijau **"Export Excel (.xlsx)"** di dashboard memanfaatkan pustaka **SheetJS** di browser pengguna.
  * Setiap sel NIK dikunci secara eksplisit dengan format tipe **String / Teks (`cell.t = 's'`)**.
  * Hasil file `.xlsx` yang diunduh sudah tertata rapi dengan lebar kolom yang proporsional dan NIK 16 digit yang dijamin 100% utuh saat dibuka di Microsoft Excel versi apa pun.
