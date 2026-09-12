/**
 * ==========================================================================
 * CEKAT / PRAKTIS - WEB CONTROL PANEL APPLICATION CONTROLLER
 * Architecture: Cloudflare Pages + D1 Database + R2 Object Storage
 * ==========================================================================
 */

// State Aplikasi
let currentUser = null;
let currentCategory = "SEKOLAH"; // 'SEKOLAH' atau 'UMUM'
let cachedRecords = [];
let filteredRecords = [];

// Inisialisasi saat Halaman Dimuat
document.addEventListener("DOMContentLoaded", () => {
  checkExistingSession();
});

// ==========================================================================
// 1. SISTEM AUTENTIKASI & MANAJEMEN SESI
// ==========================================================================

function checkExistingSession() {
  const saved = localStorage.getItem("cekat_session");
  if (saved) {
    try {
      const user = JSON.parse(saved);
      if (user && user.username) {
        setupUserSession(user);
        return;
      }
    } catch (e) {}
  }
  showAuthScreen();
}

function showAuthScreen() {
  document.getElementById("auth-screen").style.display = "flex";
  document.getElementById("dashboard-screen").style.display = "none";
}

function showDashboardScreen() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("dashboard-screen").style.display = "flex";
}

function fillCredentials(username, password) {
  document.getElementById("inputUsername").value = username;
  document.getElementById("inputPassword").value = password;
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById("inputUsername").value.trim();
  const password = document.getElementById("inputPassword").value.trim();
  const btn = document.getElementById("btnLoginSubmit");

  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Memverifikasi...`;
  btn.disabled = true;

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.status === "success") {
      localStorage.setItem("cekat_session", JSON.stringify(data.user));
      setupUserSession(data.user);
      showToast(data.message || "Selamat datang kembali!", "success");
    } else {
      Swal.fire({
        icon: "error",
        title: "Login Gagal",
        text: data.message || "Username atau password salah!",
        background: "#0d152a",
        color: "#fff",
        confirmButtonColor: "#00d4ff"
      });
    }
  } catch (err) {
    Swal.fire({
      icon: "error",
      title: "Gagal Terhubung ke Server",
      text: err.message,
      background: "#0d152a",
      color: "#fff"
    });
  } finally {
    btn.innerHTML = `<span>MASUK PANEL</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>`;
    btn.disabled = false;
  }
}

function setupUserSession(user) {
  currentUser = user;
  showDashboardScreen();

  // Render Info Pengguna di Sidebar
  document.getElementById("userNameDisplay").textContent = user.nama || user.username;
  document.getElementById("userAvatar").textContent = (user.nama || user.username).charAt(0).toUpperCase();

  const licenseElem = document.getElementById("userLicenseDisplay");
  
  // ATURAN LISENSI:
  // Admin: LIFETIME / AKTIF SELAMANYA
  // Petugas: Tampilkan masa aktif
  if (user.role === "admin") {
    licenseElem.className = "user-license license--lifetime";
    licenseElem.innerHTML = `<i class="fa-solid fa-crown"></i> <span>Admin (Lifetime)</span>`;
    document.getElementById("adminMenuSection").style.display = "block";
    document.getElementById("btnTriggerR2Backup").style.display = "flex";
  } else {
    licenseElem.className = "user-license license--petugas";
    const expDate = user.masa_aktif ? user.masa_aktif : "Aktif";
    licenseElem.innerHTML = `<i class="fa-solid fa-clock"></i> <span>Exp: ${expDate}</span>`;
    document.getElementById("adminMenuSection").style.display = "none";
    document.getElementById("btnTriggerR2Backup").style.display = "none";
  }

  // Muat Data Kategori Awal
  loadDashboardData();
}

function handleLogout() {
  Swal.fire({
    title: "Konfirmasi Keluar",
    text: "Apakah Anda yakin ingin keluar dari Control Panel?",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Ya, Keluar",
    cancelButtonText: "Batal",
    background: "#0d152a",
    color: "#fff",
    confirmButtonColor: "#ff007f",
    cancelButtonColor: "rgba(255,255,255,0.1)"
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.removeItem("cekat_session");
      currentUser = null;
      showAuthScreen();
      showToast("Anda telah keluar dari sistem.", "info");
    }
  });
}

// ==========================================================================
// 2. KONTROL TAMPILAN & DUAL-TAB (SEKOLAH vs UMUM)
// ==========================================================================

function switchCategory(cat) {
  currentCategory = cat;

  // Toggle Tab Buttons di Topbar
  const btnSekolah = document.getElementById("tabBtnSekolah");
  const btnUmum = document.getElementById("tabBtnUmum");
  const navSekolah = document.getElementById("navSekolah");
  const navUmum = document.getElementById("navUmum");

  if (cat === "SEKOLAH") {
    btnSekolah.classList.add("active");
    btnUmum.classList.remove("active");
    navSekolah.classList.add("active");
    navUmum.classList.remove("active");
    document.getElementById("pageTitleIcon").textContent = "🏫";
    document.getElementById("pageTitleText").textContent = "Data Skrining Anak Sekolah";
  } else {
    btnUmum.classList.add("active");
    btnSekolah.classList.remove("active");
    navUmum.classList.add("active");
    navSekolah.classList.remove("active");
    document.getElementById("pageTitleIcon").textContent = "👥";
    document.getElementById("pageTitleText").textContent = "Data Skrining Warga / Umum";
  }

  loadDashboardData();
}

// ==========================================================================
// 3. FETCHING DATA DARI CLOUDFLARE D1
// ==========================================================================

async function loadDashboardData() {
  const tableBody = document.getElementById("tableBody");
  tableBody.innerHTML = `
    <tr>
      <td colspan="18" class="table-state-box">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <div>Memuat data ${currentCategory} dari Cloudflare D1...</div>
      </td>
    </tr>
  `;

  renderTableHeaders();

  try {
    const res = await fetch(`/api/records?category=${currentCategory}`);
    const data = await res.json();

    if (res.ok && data.status === "success") {
      cachedRecords = data.records || [];
      filteredRecords = [...cachedRecords];

      // Update KPI
      updateKpiCards(data.stats);

      // Render Baris Tabel
      renderTableRows(filteredRecords);

      // Update badge count di sidebar
      if (currentCategory === "SEKOLAH") {
        document.getElementById("badgeCountSekolah").textContent = data.stats.total || cachedRecords.length;
      } else {
        document.getElementById("badgeCountUmum").textContent = data.stats.total || cachedRecords.length;
      }
    } else {
      tableBody.innerHTML = `
        <tr>
          <td colspan="18" class="table-state-box" style="color: #f87171;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <div>Gagal memuat data: ${data.message || 'Terjadi kesalahan'}</div>
          </td>
        </tr>
      `;
    }
  } catch (err) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="18" class="table-state-box" style="color: #f87171;">
          <i class="fa-solid fa-plug-circle-xmark"></i>
          <div>Koneksi ke backend Cloudflare terputus: ${err.message}</div>
        </td>
      </tr>
    `;
  }
}

function updateKpiCards(stats) {
  const total = stats.total || 0;
  const selesai = stats.selesai || 0;
  const pending = stats.terdaftar || 0;

  document.getElementById("kpiTotal").textContent = total;
  document.getElementById("kpiSelesai").textContent = selesai;
  document.getElementById("kpiPending").textContent = pending;

  const pct = total > 0 ? Math.round((selesai / total) * 100) : 0;
  document.getElementById("kpiExtraValue").textContent = `${pct}%`;
  document.getElementById("kpiExtraDesc").textContent = `${selesai} dari ${total} pasien selesai`;
}

// ==========================================================================
// 4. RENDERING TABEL DINAMIS (SEKOLAH vs UMUM)
// ==========================================================================

function renderTableHeaders() {
  const headerRow = document.getElementById("tableHeaderRow");
  if (currentCategory === "SEKOLAH") {
    headerRow.innerHTML = `
      <tr>
        <th>No</th>
        <th>NIK</th>
        <th>Nama Siswa</th>
        <th>Sekolah</th>
        <th>Kelas</th>
        <th>BB (kg)</th>
        <th>TB (cm)</th>
        <th>LP (cm)</th>
        <th>Sistol</th>
        <th>Diastol</th>
        <th>Gula</th>
        <th>HB</th>
        <th>Karies</th>
        <th>Kacamata</th>
        <th>Menstruasi</th>
        <th>Kebugaran</th>
        <th>Status</th>
        <th>Waktu</th>
      </tr>
    `;
  } else {
    headerRow.innerHTML = `
      <tr>
        <th>No</th>
        <th>NIK</th>
        <th>Nama Pasien</th>
        <th>JK / Umur</th>
        <th>No HP</th>
        <th>Alamat</th>
        <th>BB (kg)</th>
        <th>TB (cm)</th>
        <th>LP (cm)</th>
        <th>Sistol</th>
        <th>Diastol</th>
        <th>Gula</th>
        <th>Merokok</th>
        <th>Kadar CO</th>
        <th>Katarak</th>
        <th>Status</th>
        <th>Waktu</th>
      </tr>
    `;
  }
}

function renderTableRows(records) {
  const tableBody = document.getElementById("tableBody");

  if (!records || records.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="18" class="table-state-box">
          <i class="fa-regular fa-folder-open"></i>
          <div>Belum ada data pasien ${currentCategory} di database.</div>
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = records.map((r, idx) => {
    const isSelesai = r.status === "SELESAI_PEMERIKSAAN";
    const statusBadge = isSelesai
      ? `<span class="badge badge--selesai"><span class="badge-dot"></span>Selesai</span>`
      : `<span class="badge badge--terdaftar"><span class="badge-dot"></span>Antrean</span>`;

    const waktuStr = r.updated_at ? new Date(r.updated_at).toLocaleDateString("id-ID", { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : "-";

    if (currentCategory === "SEKOLAH") {
      return `
        <tr>
          <td>${idx + 1}</td>
          <td class="nik-col">${r.nik || "-"}</td>
          <td style="font-weight: 700;">${r.nama || "-"}</td>
          <td>${r.sekolah || "-"}</td>
          <td>${r.kelas || "-"}</td>
          <td>${r.bb ?? "-"}</td>
          <td>${r.tb ?? "-"}</td>
          <td>${r.lp ?? "-"}</td>
          <td>${r.td_sistolik ?? "-"}</td>
          <td>${r.td_diastolik ?? "-"}</td>
          <td>${r.gula_darah ?? "-"}</td>
          <td>${r.hb ?? "-"}</td>
          <td>${r.karies ?? "-"}</td>
          <td>${r.kacamata ?? "-"}</td>
          <td>${r.menstruasi ?? "-"}</td>
          <td>${r.kebugaran ?? "-"}</td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.72rem; color: var(--text-dim);">${waktuStr}</td>
        </tr>
      `;
    } else {
      return `
        <tr>
          <td>${idx + 1}</td>
          <td class="nik-col">${r.nik || "-"}</td>
          <td style="font-weight: 700;">${r.nama || "-"}</td>
          <td>${r.jenis_kelamin || "-"} / ${r.umur || "-"} th</td>
          <td>${r.no_hp || "-"}</td>
          <td>${r.alamat || "-"}</td>
          <td>${r.bb ?? "-"}</td>
          <td>${r.tb ?? "-"}</td>
          <td>${r.lp ?? "-"}</td>
          <td>${r.td_sistolik ?? "-"}</td>
          <td>${r.td_diastolik ?? "-"}</td>
          <td>${r.gula_darah ?? "-"}</td>
          <td>${r.merokok ?? "-"}</td>
          <td>${r.kadar_co ?? "-"}</td>
          <td>${r.katarak ?? "-"}</td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.72rem; color: var(--text-dim);">${waktuStr}</td>
        </tr>
      `;
    }
  }).join("");
}

// ==========================================================================
// 5. FILTER & PENCARIAN REALTIME
// ==========================================================================

function handleSearch(keyword) {
  const q = keyword.toLowerCase().trim();
  applyFilters(q, document.getElementById("filterStatus").value);
}

function handleFilterChange() {
  const status = document.getElementById("filterStatus").value;
  const q = document.getElementById("searchInput").value.toLowerCase().trim();
  applyFilters(q, status);
}

function applyFilters(keyword, status) {
  filteredRecords = cachedRecords.filter((r) => {
    let matchText = true;
    if (keyword) {
      if (currentCategory === "SEKOLAH") {
        matchText = (
          (r.nik && r.nik.toLowerCase().includes(keyword)) ||
          (r.nama && r.nama.toLowerCase().includes(keyword)) ||
          (r.sekolah && r.sekolah.toLowerCase().includes(keyword)) ||
          (r.kelas && r.kelas.toLowerCase().includes(keyword))
        );
      } else {
        matchText = (
          (r.nik && r.nik.toLowerCase().includes(keyword)) ||
          (r.nama && r.nama.toLowerCase().includes(keyword)) ||
          (r.no_hp && r.no_hp.toLowerCase().includes(keyword)) ||
          (r.alamat && r.alamat.toLowerCase().includes(keyword))
        );
      }
    }

    let matchStatus = true;
    if (status) {
      matchStatus = r.status === status;
    }

    return matchText && matchStatus;
  });

  renderTableRows(filteredRecords);
}

// ==========================================================================
// 6. ON-THE-FLY EXCEL & CSV EXPORT ENGINE (SHEETJS)
// ==========================================================================

/**
 * Konversi langsung di Browser via SheetJS
 * KRUSIAL: Kolom NIK dikunci bertipe TEXT agar tidak corrupt 3.2E+15 di Excel!
 */
function exportToExcel() {
  if (!filteredRecords || filteredRecords.length === 0) {
    showToast("Tidak ada data untuk diekspor!", "warning");
    return;
  }

  showToast("Mengonversi data ke Excel .xlsx...", "info");

  const today = new Date().toISOString().split("T")[0];
  const filename = `Laporan_CEKAT_${currentCategory}_${today}.xlsx`;

  // Petakan Kolom Berdasarkan Kategori
  let exportData = [];

  if (currentCategory === "SEKOLAH") {
    exportData = filteredRecords.map((r, i) => ({
      "No": i + 1,
      "NIK": String(r.nik || ""), // Dikonversi ke String murni
      "Nama Siswa": r.nama || "",
      "Tanggal Lahir": r.tanggal_lahir || "",
      "Jenis Kelamin": r.jenis_kelamin || "",
      "Sekolah": r.sekolah || "",
      "Kelas": r.kelas || "",
      "Nomor Tiket": r.nomor_tiket || "",
      "BB (kg)": r.bb !== null ? Number(r.bb) : "",
      "TB (cm)": r.tb !== null ? Number(r.tb) : "",
      "LP (cm)": r.lp !== null ? Number(r.lp) : "",
      "TD Sistol": r.td_sistolik !== null ? Number(r.td_sistolik) : "",
      "TD Diastol": r.td_diastolik !== null ? Number(r.td_diastolik) : "",
      "Gula Darah": r.gula_darah !== null ? Number(r.gula_darah) : "",
      "HB (g/dL)": r.hb !== null ? Number(r.hb) : "",
      "Karies Gigi": r.karies || "",
      "Kacamata": r.kacamata || "",
      "Menstruasi": r.menstruasi || "",
      "Kebugaran": r.kebugaran || "",
      "Status Pemeriksaan": r.status === "SELESAI_PEMERIKSAAN" ? "Selesai" : "Belum Pemeriksaan",
      "Petugas Pendaftaran": r.petugas_pendaftaran || "",
      "Petugas Pemeriksaan": r.petugas_pemeriksaan || "",
      "Waktu Update": r.updated_at || ""
    }));
  } else {
    exportData = filteredRecords.map((r, i) => ({
      "No": i + 1,
      "NIK": String(r.nik || ""),
      "Nama Pasien": r.nama || "",
      "Tanggal Lahir": r.tanggal_lahir || "",
      "Umur": r.umur || "",
      "Jenis Kelamin": r.jenis_kelamin || "",
      "No HP": r.no_hp || "",
      "Alamat": r.alamat || "",
      "Nomor Tiket": r.nomor_tiket || "",
      "BB (kg)": r.bb !== null ? Number(r.bb) : "",
      "TB (cm)": r.tb !== null ? Number(r.tb) : "",
      "LP (cm)": r.lp !== null ? Number(r.lp) : "",
      "TD Sistol": r.td_sistolik !== null ? Number(r.td_sistolik) : "",
      "TD Diastol": r.td_diastolik !== null ? Number(r.td_diastolik) : "",
      "Gula Darah": r.gula_darah !== null ? Number(r.gula_darah) : "",
      "Merokok": r.merokok || "",
      "Kadar CO": r.kadar_co || "",
      "Katarak": r.katarak || "",
      "Telinga": r.telinga || "",
      "Mata": r.mata || "",
      "Status Pemeriksaan": r.status === "SELESAI_PEMERIKSAAN" ? "Selesai" : "Belum Pemeriksaan",
      "Petugas Pendaftaran": r.petugas_pendaftaran || "",
      "Petugas Pemeriksaan": r.petugas_pemeriksaan || "",
      "Waktu Update": r.updated_at || ""
    }));
  }

  // Buat SheetJS Workbook
  const ws = XLSX.utils.json_to_sheet(exportData);

  // KUNCI KRUSIAL: Ubah semua cell NIK menjadi type 's' (String/Text) secara eksplisit!
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    // Kolom NIK berada di index kolom 1 (kolom B)
    const cellAddress = XLSX.utils.encode_cell({ r: R, c: 1 });
    if (ws[cellAddress]) {
      ws[cellAddress].t = 's'; // Set Explicit Text format
    }
  }

  // Set Column Widths agar rapi
  ws['!cols'] = [
    { wch: 5 },  // No
    { wch: 20 }, // NIK (Lebar 20 agar muat 16 digit tanpa terpotong)
    { wch: 25 }, // Nama
    { wch: 14 }, // Tgl Lahir
    { wch: 15 }, // JK / Sekolah
    { wch: 10 }, // Kelas
    { wch: 15 }, // Tiket
    { wch: 10 }, // BB
    { wch: 10 }, // TB
    { wch: 10 }, // LP
    { wch: 12 }, // Sistol
    { wch: 12 }, // Diastol
    { wch: 12 }, // Gula
    { wch: 12 }, // HB
    { wch: 14 }, // Gigi
    { wch: 12 }, // Kacamata
    { wch: 14 }, // Menstruasi
    { wch: 14 }  // Kebugaran
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Data ${currentCategory}`);

  // Trigger Download .xlsx
  XLSX.writeFile(wb, filename);
  showToast(`File ${filename} berhasil diunduh!`, "success");
}

function exportToRawCsv() {
  if (!filteredRecords || filteredRecords.length === 0) {
    showToast("Tidak ada data untuk diekspor!", "warning");
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const filename = `Data_Raw_${currentCategory}_${today}.csv`;

  const headers = Object.keys(filteredRecords[0]);
  const lines = [headers.join(",")];

  for (const r of filteredRecords) {
    const line = headers.map((h) => {
      let val = r[h];
      if (val === null || val === undefined) return '""';
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(",");
    lines.push(line);
  }

  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`File CSV ${filename} berhasil diunduh.`, "success");
}

// ==========================================================================
// 7. CLOUDFLARE R2 OBJECT STORAGE BACKUP
// ==========================================================================

async function triggerR2Backup() {
  showToast("Mengunggah arsip CSV ke Cloudflare R2...", "info");

  try {
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: currentCategory })
    });

    const data = await res.json();
    if (res.ok && data.status === "success") {
      Swal.fire({
        icon: "success",
        title: "Backup R2 Berhasil!",
        text: data.message,
        background: "#0d152a",
        color: "#fff",
        confirmButtonColor: "#10b981"
      });
    } else {
      Swal.fire({
        icon: "error",
        title: "Gagal Backup R2",
        text: data.message || "Terjadi kesalahan saat upload ke R2",
        background: "#0d152a",
        color: "#fff"
      });
    }
  } catch (err) {
    Swal.fire({
      icon: "error",
      title: "Error R2",
      text: err.message,
      background: "#0d152a",
      color: "#fff"
    });
  }
}

async function openBackupModal() {
  document.getElementById("backupModal").classList.add("show");
  const tbody = document.getElementById("backupTableBody");
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">Memuat daftar arsip dari R2...</td></tr>`;

  try {
    const res = await fetch("/api/storage");
    const data = await res.json();
    if (res.ok && data.status === "success") {
      const backups = data.backups || [];
      if (backups.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">Belum ada arsip di R2.</td></tr>`;
        return;
      }

      tbody.innerHTML = backups.map((b) => {
        const sizeKb = Math.round(b.size / 1024);
        const timeStr = new Date(b.uploaded).toLocaleString("id-ID");
        return `
          <tr>
            <td style="font-family: var(--font-mono); color: var(--neon-cyan);">${b.key}</td>
            <td>${sizeKb} KB</td>
            <td>${timeStr}</td>
            <td>
              <a href="/api/storage?file=${encodeURIComponent(b.key)}" class="btn-preset" style="display:inline-block; text-decoration:none;">
                <i class="fa-solid fa-download"></i> Unduh
              </a>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#f87171; text-align:center;">Gagal membaca R2: ${err.message}</td></tr>`;
  }
}

function closeBackupModal() {
  document.getElementById("backupModal").classList.remove("show");
}

// ==========================================================================
// 8. MANAJEMEN PETUGAS & LISENSI (ADMIN ONLY)
// ==========================================================================

async function openUserModal() {
  document.getElementById("userModal").classList.add("show");
  loadUserList();
}

function closeUserModal() {
  document.getElementById("userModal").classList.remove("show");
}

async function loadUserList() {
  const tbody = document.getElementById("userTableBody");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 15px;">Memuat data akun...</td></tr>`;

  try {
    const res = await fetch("/api/users");
    const data = await res.json();
    if (res.ok && data.status === "success") {
      const users = data.users || [];
      tbody.innerHTML = users.map((u) => {
        const isAdmin = u.role === "admin";
        const masaAktifBadge = isAdmin
          ? `<span style="color:#34d399; font-weight:700;"><i class="fa-solid fa-infinity"></i> Lifetime</span>`
          : `<span style="color:#38bdf8;">${u.masa_aktif || '-'}</span>`;

        const statusBadge = u.status_aktif === "aktif"
          ? `<span style="color:#34d399;">Aktif</span>`
          : `<span style="color:#f87171;">Nonaktif</span>`;

        return `
          <tr>
            <td style="font-weight:700;">${u.username}</td>
            <td>${u.nama}</td>
            <td><span class="badge" style="background:rgba(255,255,255,0.05);">${u.role.toUpperCase()}</span></td>
            <td>${masaAktifBadge}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      }).join("");
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#f87171; text-align:center;">Error: ${err.message}</td></tr>`;
  }
}

async function handleAddUser(event) {
  event.preventDefault();
  const username = document.getElementById("newUsername").value.trim();
  const password = document.getElementById("newPassword").value.trim();
  const nama = document.getElementById("newNama").value.trim();
  const masaAktif = document.getElementById("newMasaAktif").value;

  try {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        nama,
        role: "petugas",
        instansi: currentUser?.instansi || "Puskesmas",
        status_aktif: "aktif",
        masa_aktif: masaAktif
      })
    });

    const data = await res.json();
    if (res.ok && data.status === "success") {
      showToast("Akun petugas berhasil ditambahkan!", "success");
      document.getElementById("addUserForm").reset();
      loadUserList();
    } else {
      Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#0d152a", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#0d152a", color: "#fff" });
  }
}

// ==========================================================================
// 9. TOAST NOTIFICATION HELPER
// ==========================================================================

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast";

  let icon = '<i class="fa-solid fa-circle-info" style="color:var(--neon-cyan);"></i>';
  if (type === "success") icon = '<i class="fa-solid fa-circle-check" style="color:#34d399;"></i>';
  if (type === "warning") icon = '<i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24;"></i>';
  if (type === "error") icon = '<i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
