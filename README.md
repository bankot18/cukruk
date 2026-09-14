# ENCO Control Panel - Cloudflare Deploy

> **Control Panel & Real-Time Analytics** untuk Sistem Skrining Kesehatan  
> Stack: Cloudflare Pages + Workers + D1 + R2

## 📁 Struktur Folder

```
cpweb-deploy/
├── wrangler.toml            # Konfigurasi Cloudflare Worker + Bindings
├── worker.js                # Router utama (API + Static Assets)
├── schema.sql               # SQL schema untuk Cloudflare D1
├── public/                  # Static assets (dilayani otomatis oleh Cloudflare)
│   ├── index.html           # Halaman utama Control Panel
│   ├── style.css            # Stylesheet (Dark Cyberpunk theme)
│   ├── app.js               # Logika frontend (auth, fetch, export)
│   └── _headers             # Security headers Cloudflare
└── functions/               # Backend API handlers
    └── api/
        ├── auth.js           # POST /api/auth — Login & Lisensi
        ├── users.js          # CRUD /api/users — Kelola Petugas
        ├── records.js        # CRUD /api/records — Data Skrining
        └── storage.js        # /api/storage — Backup CSV ke R2
```

## 🚀 Cara Deploy

### 1. Push ke GitHub
```bash
cd cpweb-deploy
git init
git add .
git commit -m "Initial commit: ENCO Control Panel"
git branch -M main
git remote add origin https://github.com/USERNAME/cpweb-deploy.git
git push -u origin main
```

### 2. Cloudflare Dashboard
1. Buka [Cloudflare Dashboard](https://dash.cloudflare.com) > **Workers & Pages**
2. Klik **Create** > **Connect to Git** > Pilih repo `cpweb-deploy`
3. **Build Configuration:**
   - **Framework preset**: `None`
   - **Build command**: _(Kosongkan / Leave empty)_
   - **Build output directory**: _(Kosongkan / Leave empty)_
   - **Root directory**: _(Kosongkan / Leave empty — karena `wrangler.toml` sudah di root)_
4. Klik **Save and Deploy**

### 3. Setup D1 Database
```bash
# Jalankan schema.sql di D1:
npx wrangler d1 execute enco_db --file=./schema.sql --remote
```

### 4. Pastikan Bindings
Di Cloudflare Dashboard > project **cpenco** > **Settings** > **Bindings**:
- **D1 Database**: `DB` → `enco_db`
- **R2 Bucket**: `BUCKET` → `enco-storage`

## ⚙️ Environment

| Binding | Type | Name |
|---------|------|------|
| `DB` | D1 Database | `enco_db` |
| `BUCKET` | R2 Bucket | `enco-storage` |
| `ASSETS` | Static Assets | `./public` |
