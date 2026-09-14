-- ==========================================================
-- CLOUDFLARE D1 DATABASE SCHEMA - ENCO (Entry CKG Otomatis)
-- File: CP WEB/schema.sql
-- ==========================================================

-- 1. TABEL PENGGUNA & LISENSI (users)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,             -- Sandi akun petugas/admin
    nama TEXT NOT NULL,                 -- Nama lengkap petugas/admin
    role TEXT NOT NULL CHECK(role IN ('super_admin', 'puskesmas', 'rumah_sakit', 'admin', 'petugas')),
    instansi TEXT NOT NULL,             -- Nama Puskesmas / Rumah Sakit / Dinkes
    status_aktif TEXT DEFAULT 'aktif' CHECK(status_aktif IN ('aktif', 'nonaktif', 'pending')),
    masa_aktif TEXT,                    -- NULL untuk Super Admin (Lifetime), format 'YYYY-MM-DD' untuk Puskesmas & RS
    lisensi TEXT DEFAULT 'Basic',       -- 'Free', 'Basic', 'Pro', 'Lifetime'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed Data: Akun Super Admin Utama (LIFETIME) & Akun Contoh
INSERT OR IGNORE INTO users (id, username, password, nama, role, instansi, status_aktif, masa_aktif, lisensi)
VALUES 
('usr_admin_master', 'admin', 'admin123', 'Super Administrator', 'super_admin', 'Dinas Kesehatan Pusat', 'aktif', NULL, 'Lifetime'),
('usr_puskesmas_demo', 'pusk1', 'pusk123', 'Petugas Puskesmas Cibinong', 'puskesmas', 'Puskesmas Cibinong', 'aktif', '2026-12-31', 'Pro'),
('usr_rs_demo', 'rs1', 'rs123', 'Operator RSUD', 'rumah_sakit', 'RSUD Ciawi', 'aktif', '2026-12-31', 'Basic');

-- 2. TABEL MASTER PENDAFTARAN & PEMERIKSAAN (records)
-- Terpadu 1 baris per NIK dengan kunci UPSERT
CREATE TABLE IF NOT EXISTS records (
    nik TEXT PRIMARY KEY,               -- NIK unik mencegah duplikasi (Primary Key)
    category TEXT NOT NULL CHECK(category IN ('UMUM', 'SEKOLAH')),
    nama TEXT NOT NULL,
    tanggal_lahir TEXT,
    umur INTEGER,
    jenis_kelamin TEXT,
    nomor_tiket TEXT,
    instansi TEXT,
    
    -- Khusus Kategori SEKOLAH (Pendaftaran)
    sekolah TEXT,
    kelas TEXT,
    
    -- Khusus Kategori UMUM (Pendaftaran)
    no_hp TEXT,
    alamat TEXT,
    
    -- Hasil Pemeriksaan Fisik & Vital (Wajib Keduanya)
    bb REAL,                            -- Berat Badan (kg)
    tb REAL,                            -- Tinggi Badan (cm)
    lp REAL,                            -- Lingkar Perut (cm)
    td_sistolik INTEGER,                -- Tekanan Darah Sistol (mmHg)
    td_diastolik INTEGER,               -- Tekanan Darah Diastol (mmHg)
    gula_darah INTEGER,                 -- Gula Darah Sewaktu (mg/dL)
    
    -- Khusus Kategori SEKOLAH (Lab & Skrining UKS)
    hb REAL,                            -- Kadar Hemoglobin (g/dL)
    karies TEXT,                        -- Gigi Karies (Jumlah / Status)
    kacamata TEXT,                      -- Penggunaan Kacamata (Ya/Tidak)
    menstruasi TEXT,                    -- Status Menstruasi Siswi
    kebugaran TEXT,                     -- Kebugaran Jasmani (Baik, Cukup, dll)
    
    -- Khusus Kategori UMUM (Skrining PTM & Lansia)
    merokok TEXT,                       -- Riwayat Merokok (Ya/Tidak)
    kadar_co INTEGER,                   -- Kadar CO Pernapasan
    katarak TEXT,                       -- Pemeriksaan Katarak/Pupil
    telinga TEXT,                       -- Pemeriksaan Telinga/Serumen
    mata TEXT,                          -- Pemeriksaan Visus/Mata
    
    -- Status & Pelacakan Petugas
    status TEXT DEFAULT 'TERDAFTAR',    -- 'TERDAFTAR' atau 'SELESAI_PEMERIKSAAN'
    petugas_pendaftaran TEXT,           -- Username/Nama petugas pendaftaran
    petugas_pemeriksaan TEXT,           -- Username/Nama petugas pemeriksaan
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indeks untuk pencarian dan filter cepat
CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_sekolah ON records(sekolah);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_instansi ON records(instansi);
CREATE INDEX IF NOT EXISTS idx_records_instansi_cat ON records(instansi, category);
CREATE INDEX IF NOT EXISTS idx_records_instansi_sekolah ON records(instansi, sekolah);
CREATE INDEX IF NOT EXISTS idx_records_instansi_status ON records(instansi, status);

-- 3. TABEL MASTER FASKES (Puskesmas & Rumah Sakit)
CREATE TABLE IF NOT EXISTS faskes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    tipe TEXT NOT NULL CHECK(tipe IN ('PUSKESMAS', 'RUMAH_SAKIT')),
    provinsi TEXT NOT NULL,
    kab_kota TEXT NOT NULL,
    kecamatan TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(nama, tipe, kab_kota, kecamatan)
);
CREATE INDEX IF NOT EXISTS idx_faskes_tipe ON faskes(tipe);
CREATE INDEX IF NOT EXISTS idx_faskes_nama ON faskes(nama);

-- Seed Data Faskes Awal
INSERT OR IGNORE INTO faskes (nama, tipe, provinsi, kab_kota, kecamatan) VALUES
('Puskesmas Cibinong', 'PUSKESMAS', 'Jawa Barat', 'Kab. Bogor', 'Cibinong'),
('Puskesmas Banjaran', 'PUSKESMAS', 'Jawa Barat', 'Kab. Bandung', 'Banjaran'),
('Puskesmas Ciawi', 'PUSKESMAS', 'Jawa Barat', 'Kab. Bogor', 'Ciawi'),
('RSUD Ciawi', 'RUMAH_SAKIT', 'Jawa Barat', 'Kab. Bogor', 'Ciawi'),
('RSUD Cibinong', 'RUMAH_SAKIT', 'Jawa Barat', 'Kab. Bogor', 'Cibinong');

-- 4. TABEL MASTER SEKOLAH (Per Puskesmas)
CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instansi TEXT NOT NULL,             -- Nama Puskesmas yang menaungi
    nama_sekolah TEXT NOT NULL,
    alamat_sekolah TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(instansi, nama_sekolah, alamat_sekolah)
);
CREATE INDEX IF NOT EXISTS idx_schools_instansi ON schools(instansi);
CREATE INDEX IF NOT EXISTS idx_schools_nama ON schools(nama_sekolah);

-- Seed Data Sekolah Awal untuk Puskesmas Banjaran & Cibinong
INSERT OR IGNORE INTO schools (instansi, nama_sekolah, alamat_sekolah) VALUES
('Puskesmas Banjaran', 'MIS PERSIS 278 PANGKALAN', 'Kp Taraju RT 02 RW 05 Tarajusari'),
('Puskesmas Banjaran', 'SDN BANJARAN 01', 'Jl. Raya Banjaran No. 12'),
('Puskesmas Banjaran', 'SMAN 1 BANJARAN', 'Jl. Ciapus No. 5'),
('Puskesmas Cibinong', 'SDN CIBINONG 01', 'Jl. Mayor Oking No. 10 Cibinong'),
('Puskesmas Cibinong', 'SMPN 1 CIBINONG', 'Jl. Raya Jakarta-Bogor Km. 42');


