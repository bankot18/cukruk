/**
 * ==========================================================================
 * ENCO (Entry CKG Otomatis) - ENTERPRISE CONTROL PANEL & CLINICAL INTELLIGENCE
 * Stack: Cloudflare Pages + D1 Database + R2 Object Storage + Chart.js + SheetJS
 * ==========================================================================
 */

// Global Application State
let currentUser = null;
let currentCategory = "SEKOLAH"; // 'SEKOLAH' atau 'UMUM'
let currentPage = 1;
let pageSize = 25;
let totalPages = 1;
let totalRecords = 0;
let cachedRecords = [];
let selectedNiks = new Set();
let activePatient = null;
let parsedImportData = [];

// Filter & Sort State
let currentSortField = "updated_at";
let currentSortOrder = "desc";
let currentSearch = "";
let currentFilterStatus = "";
let currentFilterSekolah = "";
let currentFilterRisk = "";

// Chart.js Instances
let trendChart = null;
let nutritionChart = null;
let bpChart = null;

// ==========================================================================
// 1. INITIALIZATION & SESSION MANAGEMENT
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  checkExistingSession();
  setupDropzoneEvents();
});

function checkExistingSession() {
  // 1. Dukungan Single Sign-On (SSO) dari ENCO Desktop via URL param sso_user
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const ssoUser = urlParams.get("sso_user");
    if (ssoUser) {
      const user = JSON.parse(decodeURIComponent(escape(atob(ssoUser))));
      if (user && user.username) {
        localStorage.setItem("enco_session", JSON.stringify(user));
        window.history.replaceState({}, document.title, window.location.pathname);
        setupUserSession(user);
        return;
      }
    }
  } catch (e) {
    console.warn("[SSO] Gagal memproses sso_user:", e);
  }

  // 2. Cek sesi tersimpan di localStorage
  const saved = localStorage.getItem("enco_session");
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
      localStorage.setItem("enco_session", JSON.stringify(data.user));
      setupUserSession(data.user);
      showToast(data.message || "Selamat datang kembali!", "success");
    } else {
      Swal.fire({
        icon: "error",
        title: "Login Gagal",
        text: data.message || "Username atau kata sandi tidak cocok!",
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
    }
  } catch (err) {
    Swal.fire({
      icon: "error",
      title: "Gagal Menghubungi Server",
      text: err.message,
      background: "#131d31",
      color: "#fff",
      confirmButtonColor: "#0d9488"
    });
  } finally {
    btn.innerHTML = `<span>Masuk ke Command Center</span> <i class="fa-solid fa-arrow-right"></i>`;
    btn.disabled = false;
  }
}

function setupUserSession(user) {
  currentUser = user;
  showDashboardScreen();

  // Render User Info di Sidebar
  const displayName = user.nama || user.username;
  document.getElementById("userNameDisplay").textContent = displayName;
  document.getElementById("userAvatar").textContent = displayName.charAt(0).toUpperCase();

  const roleBadge = document.getElementById("userRoleBadge");
  const roleText = document.getElementById("userRoleText");
  const adminSection = document.getElementById("adminMenuSection");

  const rawRole = (user.role || "").toString().toLowerCase();
  const rawLisensi = (user.lisensi || "").toString().toUpperCase();
  const isSuperAdmin = (
    rawRole === "super_admin" ||
    rawRole === "admin" ||
    rawRole === "superadmin" ||
    rawRole.includes("admin") ||
    rawLisensi.includes("LIFETIME") ||
    user.isSuperAdmin === true ||
    user.isLifetime === true
  );

  if (isSuperAdmin) {
    roleBadge.className = "user-role-badge admin";
    roleBadge.innerHTML = `<i class="fa-solid fa-crown" style="color: #fbbf24;"></i> <span>Super Admin</span>`;
    if (adminSection) adminSection.style.display = "flex";
  } else {
    roleBadge.className = "user-role-badge";
    const expDate = user.masa_aktif ? `Exp: ${user.masa_aktif}` : "Petugas Skrining";
    roleBadge.innerHTML = `<i class="fa-solid fa-user-nurse" style="color: #38bdf8;"></i> <span>${expDate}</span>`;
    if (adminSection) adminSection.style.display = "none";
  }

  // Render Instansi / Puskesmas di Topbar
  const faskesBadge = document.getElementById("faskesNameDisplay");
  if (faskesBadge) {
    faskesBadge.textContent = user.instansi || "Puskesmas";
  }

  // Inisialisasi Charts & Muat Data
  initCharts();
  loadDashboardData();
  fetchBotTelemetry();

  // Polling Telemetri Bot setiap 30 detik
  setInterval(fetchBotTelemetry, 30000);
}

function handleLogout() {
  Swal.fire({
    title: "Keluar dari Panel?",
    text: "Sesi kerja Anda akan diakhiri.",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Ya, Keluar",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#f43f5e",
    cancelButtonColor: "rgba(255,255,255,0.1)"
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.removeItem("enco_session");
      currentUser = null;
      showAuthScreen();
      showToast("Anda telah keluar dari sistem.", "info");
    }
  });
}

// ==========================================================================
// 2. CLINICAL INTELLIGENCE CALCULATION ENGINES
// ==========================================================================

/**
 * Kalkulasi Indeks Massa Tubuh (IMT / BMI)
 * Standar Kemenkes RI / WHO Asia Pasifik
 */
function calcIMT(bb, tb) {
  if (!bb || !tb || tb <= 0) return null;
  const tbMeter = tb / 100.0;
  const imt = +(bb / (tbMeter * tbMeter)).toFixed(1);

  if (imt < 18.5) {
    return { val: imt, category: "Kurus", tagClass: "badge-risk--warning", color: "#fbbf24" };
  } else if (imt >= 18.5 && imt <= 22.9) {
    return { val: imt, category: "Normal", tagClass: "badge-status--selesai", color: "#34d399" };
  } else if (imt >= 23.0 && imt <= 24.9) {
    return { val: imt, category: "Gemuk (Overweight)", tagClass: "badge-risk--warning", color: "#f59e0b" };
  } else if (imt >= 25.0 && imt <= 29.9) {
    return { val: imt, category: "Obesitas I", tagClass: "badge-risk--danger", color: "#fb7185" };
  } else {
    return { val: imt, category: "Obesitas II", tagClass: "badge-risk--danger", color: "#f43f5e" };
  }
}

/**
 * Klasifikasi Tekanan Darah (JNC 7 / 8 & Kemenkes PTM)
 */
function classifyBP(sistol, diastol) {
  if (!sistol || !diastol) return null;
  const s = parseInt(sistol, 10);
  const d = parseInt(diastol, 10);

  if (s >= 160 || d >= 100) {
    return { stage: "Hipertensi Tk 2", tagClass: "badge-risk--danger", color: "#f43f5e", isHigh: true };
  } else if ((s >= 140 && s <= 159) || (d >= 90 && d <= 99)) {
    return { stage: "Hipertensi Tk 1", tagClass: "badge-risk--danger", color: "#fb7185", isHigh: true };
  } else if ((s >= 120 && s <= 139) || (d >= 80 && d <= 89)) {
    return { stage: "Pra-Hipertensi", tagClass: "badge-risk--warning", color: "#fbbf24", isHigh: false };
  } else {
    return { stage: "Normal", tagClass: "badge-status--selesai", color: "#34d399", isHigh: false };
  }
}

/**
 * Deteksi Semua Red Flags (Kondisi Risiko Klinis Pasien)
 */
function getClinicalRiskTags(record) {
  const tags = [];

  // 1. Tensi
  const bp = classifyBP(record.td_sistolik, record.td_diastolik);
  if (bp && bp.isHigh) {
    tags.push({ text: `🚨 ${bp.stage}`, className: "badge-risk--danger" });
  }

  // 2. Gula Darah Sewaktu
  if (record.gula_darah && record.gula_darah >= 200) {
    tags.push({ text: "🩸 Gula Tinggi (≥200)", className: "badge-risk--danger" });
  } else if (record.gula_darah && record.gula_darah >= 140) {
    tags.push({ text: "⚠️ Pre-Diabetes", className: "badge-risk--warning" });
  }

  // 3. Status Gizi (IMT)
  const imt = calcIMT(record.bb, record.tb);
  if (imt && (imt.category === "Obesitas I" || imt.category === "Obesitas II")) {
    tags.push({ text: `⚖️ ${imt.category}`, className: "badge-risk--danger" });
  }

  // 4. Khusus SEKOLAH: Karies & Anemia
  if (currentCategory === "SEKOLAH") {
    if (record.hb && record.hb > 0 && record.hb < 12) {
      tags.push({ text: `⚠️ Anemia (HB ${record.hb})`, className: "badge-risk--danger" });
    }
    if (record.karies && record.karies !== "Tidak" && record.karies !== "0") {
      tags.push({ text: `🦷 Karies: ${record.karies}`, className: "badge-risk--warning" });
    }
  }

  return tags;
}

// ==========================================================================
// 3. VISUAL ANALYTICS WITH CHART.JS
// ==========================================================================

function initCharts() {
  const ctxTrend = document.getElementById("trendChart")?.getContext("2d");
  const ctxNutri = document.getElementById("nutritionChart")?.getContext("2d");
  const ctxBp = document.getElementById("bloodPressureChart")?.getContext("2d");

  if (!ctxTrend || !ctxNutri || !ctxBp) return;

  // 1. Trend Chart (Line / Area)
  trendChart = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"],
      datasets: [
        {
          label: "Pasien Selesai",
          data: [5, 18, 35, 52, 60, 78, 92],
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.15)",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: "#14b8a6"
        },
        {
          label: "Antrean Masuk",
          data: [12, 28, 48, 65, 70, 85, 100],
          borderColor: "#0284c7",
          borderDash: [5, 5],
          tension: 0.35,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { family: "Plus Jakarta Sans", size: 11 } } }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#64748b" } },
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#64748b" } }
      }
    }
  });

  // 2. Nutrition Donut Chart
  nutritionChart = new Chart(ctxNutri, {
    type: "doughnut",
    data: {
      labels: ["Normal", "Kurus", "Gemuk", "Obesitas"],
      datasets: [{
        data: [65, 12, 15, 8],
        backgroundColor: ["#10b981", "#fbbf24", "#f59e0b", "#f43f5e"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#94a3b8", font: { size: 10 } } }
      }
    }
  });

  // 3. Blood Pressure Donut Chart
  bpChart = new Chart(ctxBp, {
    type: "doughnut",
    data: {
      labels: ["Optimal / Normal", "Pra-Hipertensi", "Hipertensi"],
      datasets: [{
        data: [72, 18, 10],
        backgroundColor: ["#10b981", "#fbbf24", "#f43f5e"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#94a3b8", font: { size: 10 } } }
      }
    }
  });
}

function updateVisualCharts(stats, records) {
  if (!nutritionChart || !bpChart || !records) return;

  // Hitung distribusi IMT dari rekam medis saat ini
  let normalImt = 0, kurusImt = 0, gemukImt = 0, obesitasImt = 0;
  let normalBp = 0, preBp = 0, hyperBp = 0;

  records.forEach(r => {
    const imt = calcIMT(r.bb, r.tb);
    if (imt) {
      if (imt.category === "Normal") normalImt++;
      else if (imt.category === "Kurus") kurusImt++;
      else if (imt.category === "Gemuk (Overweight)") gemukImt++;
      else obesitasImt++;
    }

    const bp = classifyBP(r.td_sistolik, r.td_diastolik);
    if (bp) {
      if (bp.stage === "Normal") normalBp++;
      else if (bp.stage === "Pra-Hipertensi") preBp++;
      else hyperBp++;
    }
  });

  nutritionChart.data.datasets[0].data = [
    normalImt || 1, kurusImt, gemukImt, obesitasImt
  ];
  nutritionChart.update();

  bpChart.data.datasets[0].data = [
    normalBp || 1, preBp, hyperBp
  ];
  bpChart.update();
}

// ==========================================================================
// 4. FETCH DATA DARI CLOUDFLARE D1 DENGAN PAGINATION & FILTER
// ==========================================================================

async function loadDashboardData() {
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = `
    <tr>
      <td colspan="16" style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <i class="fa-solid fa-circle-notch fa-spin fa-2x" style="color: var(--teal-400); margin-bottom: 12px;"></i>
        <div>Memuat data ${currentCategory} dari Cloudflare D1...</div>
      </td>
    </tr>
  `;

  renderTableHeader();

  // Susun query parameters
  const params = new URLSearchParams({
    category: currentCategory,
    page: currentPage,
    limit: pageSize
  });

  if (currentSearch) params.append("search", currentSearch);
  if (currentFilterStatus) params.append("status", currentFilterStatus);
  if (currentFilterSekolah && currentCategory === "SEKOLAH") params.append("sekolah", currentFilterSekolah);
  if (currentFilterRisk) params.append("risk", currentFilterRisk);

  // Filter isolasi Puskesmas
  if (currentUser?.instansi && currentUser.role !== "super_admin") {
    params.append("instansi", currentUser.instansi);
  } else if (currentUser?.role === "super_admin" && window.currentFilterInstansi && window.currentFilterInstansi !== "ALL") {
    params.append("instansi", window.currentFilterInstansi);
  }

  try {
    const res = await fetch(`/api/records?${params.toString()}`);
    const data = await res.json();

    if (res.ok && data.status === "success") {
      cachedRecords = data.records || [];
      totalRecords = data.pagination?.total || 0;
      totalPages = data.pagination?.totalPages || 1;

      // Update KPI
      updateKpiCards(data.stats);

      // Update Daftar Sekolah di Dropdown
      if (data.sekolahList && currentCategory === "SEKOLAH") {
        populateSchoolDropdown(data.sekolahList);
      }

      // Render Baris Data
      renderTableRows(cachedRecords);

      // Update Navigasi Pagination
      updatePaginationControls();

      // Update Charts
      updateVisualCharts(data.stats, cachedRecords);

      // Update Badge Counter Sidebar
      const badgeSekolah = document.getElementById("badgeCountSekolah");
      const badgeUmum = document.getElementById("badgeCountUmum");
      if (currentCategory === "SEKOLAH" && badgeSekolah) {
        badgeSekolah.textContent = data.stats.total || totalRecords;
      } else if (badgeUmum) {
        badgeUmum.textContent = data.stats.total || totalRecords;
      }
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="16" style="text-align: center; padding: 30px; color: #fb7185;">
            <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
            <div style="margin-top: 8px;">Gagal memuat: ${data.message || 'Kesalahan D1'}</div>
          </td>
        </tr>
      `;
    }
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="16" style="text-align: center; padding: 30px; color: #fb7185;">
          <i class="fa-solid fa-plug-circle-xmark fa-2x"></i>
          <div style="margin-top: 8px;">Koneksi ke backend Cloudflare terputus: ${err.message}</div>
        </td>
      </tr>
    `;
  }
}

function updateKpiCards(stats) {
  if (!stats) return;
  const total = stats.total || 0;
  const selesai = stats.selesai || 0;
  const hipertensi = stats.hipertensi || 0;

  document.getElementById("kpiTotal").textContent = total;
  document.getElementById("kpiSelesai").textContent = selesai;
  document.getElementById("kpiHipertensi").textContent = hipertensi;

  const pctCoverage = total > 0 ? Math.round((selesai / total) * 100) : 0;
  document.getElementById("kpiCoverageText").textContent = `${pctCoverage}% (${selesai}/${total}) selesai di-entry`;

  const pctHyper = selesai > 0 ? Math.round((hipertensi / selesai) * 100) : 0;
  document.getElementById("kpiHipertensiPct").textContent = `${pctHyper}% Prevalensi`;

  // Kartu Dinamis (Sekolah: Karies/Anemia | Umum: Gula Darah Tinggi)
  const dynCard = document.getElementById("kpiDynamicCard");
  const dynLabel = document.getElementById("kpiDynamicLabel");
  const dynVal = document.getElementById("kpiDynamicValue");
  const dynDesc = document.getElementById("kpiDynamicDesc");

  if (currentCategory === "SEKOLAH") {
    dynLabel.textContent = "Karies Gigi Siswa";
    dynVal.textContent = stats.karies || 0;
    dynDesc.textContent = `${stats.anemia || 0} siswi terdeteksi anemia (HB < 12)`;
  } else {
    dynLabel.textContent = "Curiga Diabetes";
    dynVal.textContent = stats.gulaTinggi || 0;
    dynDesc.textContent = "Gula Darah Sewaktu ≥ 200 mg/dL";
  }
}

function populateSchoolDropdown(schools) {
  const select = document.getElementById("filterSekolah");
  if (!select) return;
  const curr = select.value;
  select.innerHTML = `<option value="">Semua Sekolah (${schools.length})</option>`;
  schools.forEach(sch => {
    const opt = document.createElement("option");
    opt.value = sch;
    opt.textContent = sch;
    if (sch === curr) opt.selected = true;
    select.appendChild(opt);
  });
}

// ==========================================================================
// 5. TABLE RENDERING & INTERACTIVE SORTING
// ==========================================================================

function renderTableHeader() {
  const headerRow = document.getElementById("tableHeaderRow");
  if (currentCategory === "SEKOLAH") {
    headerRow.innerHTML = `
      <tr>
        <th style="width: 36px;"><input type="checkbox" onchange="toggleSelectAll(this.checked)" title="Pilih Semua"></th>
        <th>No</th>
        <th class="sortable" onclick="handleSort('nik')">NIK <i class="fa-solid fa-sort"></i></th>
        <th class="sortable" onclick="handleSort('nama')">Nama Siswa <i class="fa-solid fa-sort"></i></th>
        <th class="sortable" onclick="handleSort('sekolah')">Sekolah / Kelas</th>
        <th>IMT (Status Gizi)</th>
        <th>Tekanan Darah</th>
        <th>Gula / HB</th>
        <th>Karies Gigi</th>
        <th>Status Entry</th>
        <th>Waktu</th>
        <th style="text-align: right;">Aksi</th>
      </tr>
    `;
  } else {
    headerRow.innerHTML = `
      <tr>
        <th style="width: 36px;"><input type="checkbox" onchange="toggleSelectAll(this.checked)" title="Pilih Semua"></th>
        <th>No</th>
        <th class="sortable" onclick="handleSort('nik')">NIK <i class="fa-solid fa-sort"></i></th>
        <th class="sortable" onclick="handleSort('nama')">Nama Pasien <i class="fa-solid fa-sort"></i></th>
        <th>JK / Usia</th>
        <th>Alamat / HP</th>
        <th>IMT (Status Gizi)</th>
        <th>Tekanan Darah</th>
        <th>Gula Darah</th>
        <th>Merokok / CO</th>
        <th>Status Entry</th>
        <th>Waktu</th>
        <th style="text-align: right;">Aksi</th>
      </tr>
    `;
  }
}

function renderTableRows(records) {
  const tbody = document.getElementById("tableBody");

  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="16" style="text-align: center; padding: 40px; color: var(--text-muted);">
          <i class="fa-regular fa-folder-open fa-2x" style="margin-bottom: 8px;"></i>
          <div>Tidak ada data yang cocok dengan kriteria filter.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map((r, idx) => {
    const isSelesai = r.status === "SELESAI_PEMERIKSAAN";
    const statusBadge = isSelesai
      ? `<span class="badge-status badge-status--selesai"><i class="fa-solid fa-circle-check"></i> Selesai</span>`
      : `<span class="badge-status badge-status--terdaftar"><i class="fa-solid fa-clock"></i> Antrean</span>`;

    const waktuStr = r.updated_at ? new Date(r.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-";

    // IMT Badge
    const imt = calcIMT(r.bb, r.tb);
    const imtHtml = imt 
      ? `<span>${imt.val}</span> <span class="badge-risk ${imt.tagClass}">${imt.category}</span>`
      : `<span style="color: var(--text-muted);">-</span>`;

    // Tensi Badge
    const bp = classifyBP(r.td_sistolik, r.td_diastolik);
    const bpHtml = (r.td_sistolik && r.td_diastolik)
      ? `<span>${r.td_sistolik}/${r.td_diastolik}</span> <span class="badge-risk ${bp.tagClass}">${bp.stage}</span>`
      : `<span style="color: var(--text-muted);">-</span>`;

    const rowNum = (currentPage - 1) * pageSize + (idx + 1);
    const isChecked = selectedNiks.has(r.nik) ? "checked" : "";

    if (currentCategory === "SEKOLAH") {
      const hbHtml = r.hb ? (r.hb < 12 ? `<span style="color:#fb7185; font-weight:700;">HB: ${r.hb}</span>` : `HB: ${r.hb}`) : "";
      const gulaHtml = r.gula_darah ? `GDS: ${r.gula_darah}` : "";
      const labInfo = [gulaHtml, hbHtml].filter(Boolean).join(" | ") || "-";

      return `
        <tr>
          <td><input type="checkbox" ${isChecked} onchange="toggleSelectRow('${r.nik}', this.checked)"></td>
          <td style="color: var(--text-muted); font-size: 0.75rem;">${rowNum}</td>
          <td class="col-nik">${r.nik}</td>
          <td class="col-name" onclick="openPatientDrawer('${r.nik}')">${r.nama || "-"}</td>
          <td>${r.sekolah || "-"} <span style="font-size: 0.72rem; color: var(--text-muted);">(${r.kelas || "-"})</span></td>
          <td>${imtHtml}</td>
          <td>${bpHtml}</td>
          <td>${labInfo}</td>
          <td>${r.karies || "-"}</td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.72rem; color: var(--text-muted);">${waktuStr}</td>
          <td style="text-align: right;">
            <div class="row-actions-group" style="justify-content: flex-end;">
              <button class="btn-row-action" onclick="openPatientDrawer('${r.nik}')" title="Buka Detail Rekam Medis 360">
                <i class="fa-solid fa-eye"></i>
              </button>
              <button class="btn-row-action" onclick="openEditRecordModal('${r.nik}')" title="Edit Data Pasien">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-row-action delete" onclick="handleDeleteSingle('${r.nik}')" title="Hapus Data">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    } else {
      return `
        <tr>
          <td><input type="checkbox" ${isChecked} onchange="toggleSelectRow('${r.nik}', this.checked)"></td>
          <td style="color: var(--text-muted); font-size: 0.75rem;">${rowNum}</td>
          <td class="col-nik">${r.nik}</td>
          <td class="col-name" onclick="openPatientDrawer('${r.nik}')">${r.nama || "-"}</td>
          <td>${r.jenis_kelamin || "-"} / ${r.umur || "-"} th</td>
          <td>${r.alamat || "-"} <span style="font-size: 0.72rem; color: var(--text-muted);">(${r.no_hp || "-"})</span></td>
          <td>${imtHtml}</td>
          <td>${bpHtml}</td>
          <td>${r.gula_darah ? `GDS: ${r.gula_darah} mg/dL` : "-"}</td>
          <td>${r.merokok ? `Rokok: ${r.merokok}` : "-"}</td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.72rem; color: var(--text-muted);">${waktuStr}</td>
          <td style="text-align: right;">
            <div class="row-actions-group" style="justify-content: flex-end;">
              <button class="btn-row-action" onclick="openPatientDrawer('${r.nik}')" title="Buka Detail Rekam Medis 360">
                <i class="fa-solid fa-eye"></i>
              </button>
              <button class="btn-row-action" onclick="openEditRecordModal('${r.nik}')" title="Edit Data Pasien">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-row-action delete" onclick="handleDeleteSingle('${r.nik}')" title="Hapus Data">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }
  }).join("");
}

// ==========================================================================
// 6. PAGINATION & FILTER CONTROLS
// ==========================================================================

function updatePaginationControls() {
  const start = totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const end = Math.min(currentPage * pageSize, totalRecords);

  document.getElementById("pageRangeText").textContent = `${start} - ${end}`;
  document.getElementById("pageTotalCount").textContent = totalRecords;
  document.getElementById("currentPageDisplay").textContent = currentPage;
  document.getElementById("totalPagesDisplay").textContent = totalPages;

  document.getElementById("btnFirstPage").disabled = currentPage <= 1;
  document.getElementById("btnPrevPage").disabled = currentPage <= 1;
  document.getElementById("btnNextPage").disabled = currentPage >= totalPages;
  document.getElementById("btnLastPage").disabled = currentPage >= totalPages;
}

function goToPage(p) {
  if (p < 1 || p > totalPages || p === currentPage) return;
  currentPage = p;
  loadDashboardData();
}

function handlePageSizeChange(val) {
  pageSize = parseInt(val, 10);
  currentPage = 1;
  loadDashboardData();
}

function handleSearch(val) {
  currentSearch = val.trim();
  currentPage = 1;
  clearTimeout(window.searchDebounceTimer);
  window.searchDebounceTimer = setTimeout(loadDashboardData, 350);
}

function handleFilterChange() {
  currentFilterStatus = document.getElementById("filterStatus").value;
  currentFilterRisk = document.getElementById("filterRisk").value;
  const sch = document.getElementById("filterSekolah");
  currentFilterSekolah = sch ? sch.value : "";
  currentPage = 1;
  loadDashboardData();
}

function resetFilters() {
  document.getElementById("searchInput").value = "";
  document.getElementById("filterStatus").value = "";
  document.getElementById("filterRisk").value = "";
  const sch = document.getElementById("filterSekolah");
  if (sch) sch.value = "";

  currentSearch = "";
  currentFilterStatus = "";
  currentFilterRisk = "";
  currentFilterSekolah = "";
  currentPage = 1;
  loadDashboardData();
}

function handleSort(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortField = field;
    currentSortOrder = "asc";
  }

  // Client-side quick sort for current page
  cachedRecords.sort((a, b) => {
    let valA = a[field] || "";
    let valB = b[field] || "";
    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();
    if (valA < valB) return currentSortOrder === "asc" ? -1 : 1;
    if (valA > valB) return currentSortOrder === "asc" ? 1 : -1;
    return 0;
  });

  renderTableRows(cachedRecords);
}

// ==========================================================================
// 7. CATEGORY TOGGLE (SEKOLAH vs UMUM)
// ==========================================================================

function switchCategory(cat) {
  currentCategory = cat;
  currentPage = 1;
  selectedNiks.clear();
  updateBulkDeleteButton();

  const segSekolah = document.getElementById("segmentSekolah");
  const segUmum = document.getElementById("segmentUmum");
  const navSekolah = document.getElementById("navSekolah");
  const navUmum = document.getElementById("navUmum");
  const schFilter = document.getElementById("filterSekolah");

  if (cat === "SEKOLAH") {
    segSekolah.classList.add("active");
    segUmum.classList.remove("active");
    navSekolah.classList.add("active");
    navUmum.classList.remove("active");
    document.getElementById("pageTitleIcon").textContent = "🏫";
    document.getElementById("pageTitleText").textContent = "Skrining Anak Sekolah (UKS)";
    if (schFilter) schFilter.style.display = "inline-block";
  } else {
    segUmum.classList.add("active");
    segSekolah.classList.remove("active");
    navUmum.classList.add("active");
    navSekolah.classList.remove("active");
    document.getElementById("pageTitleIcon").textContent = "👥";
    document.getElementById("pageTitleText").textContent = "Skrining Warga / Posbindu PTM";
    if (schFilter) schFilter.style.display = "none";
  }

  loadDashboardData();
}

// ==========================================================================
// 8. PATIENT 360° DRAWER (SIDE PANEL DETAIL)
// ==========================================================================

function openPatientDrawer(nik) {
  const patient = cachedRecords.find(r => r.nik === nik);
  if (!patient) return;
  activePatient = patient;

  document.getElementById("drawerNama").textContent = patient.nama || "Tanpa Nama";
  document.getElementById("drawerNik").textContent = `NIK: ${patient.nik}`;

  // IMT
  const imt = calcIMT(patient.bb, patient.tb);
  if (imt) {
    document.getElementById("drawerImtVal").textContent = imt.val;
    const tag = document.getElementById("drawerImtTag");
    tag.textContent = imt.category;
    tag.className = `vital-box-tag ${imt.tagClass}`;
  } else {
    document.getElementById("drawerImtVal").textContent = "-";
    document.getElementById("drawerImtTag").textContent = "Belum diukur";
  }

  // Tensi
  const bp = classifyBP(patient.td_sistolik, patient.td_diastolik);
  if (bp && patient.td_sistolik && patient.td_diastolik) {
    document.getElementById("drawerTensiVal").textContent = `${patient.td_sistolik}/${patient.td_diastolik}`;
    const tag = document.getElementById("drawerTensiTag");
    tag.textContent = bp.stage;
    tag.className = `vital-box-tag ${bp.tagClass}`;
  } else {
    document.getElementById("drawerTensiVal").textContent = "-";
    document.getElementById("drawerTensiTag").textContent = "Belum diukur";
  }

  // Gula
  if (patient.gula_darah) {
    document.getElementById("drawerGulaVal").textContent = `${patient.gula_darah} mg/dL`;
    const tag = document.getElementById("drawerGulaTag");
    tag.textContent = patient.gula_darah >= 200 ? "Curiga Diabetes" : (patient.gula_darah >= 140 ? "Pre-Diabetes" : "Normal");
    tag.className = `vital-box-tag ${patient.gula_darah >= 200 ? 'badge-risk--danger' : 'badge-status--selesai'}`;
  } else {
    document.getElementById("drawerGulaVal").textContent = "-";
    document.getElementById("drawerGulaTag").textContent = "Belum dicek";
  }

  // BB / TB / LP
  document.getElementById("drawerBbTbVal").textContent = `${patient.bb || '-'} kg / ${patient.tb || '-'} cm`;
  document.getElementById("drawerLpVal").textContent = `Lingkar Perut: ${patient.lp || '-'} cm`;

  // Details
  const detailsBox = document.getElementById("drawerClinicalDetails");
  if (currentCategory === "SEKOLAH") {
    detailsBox.innerHTML = `
      <div><strong>Sekolah:</strong> ${patient.sekolah || '-'} (Kelas: ${patient.kelas || '-'})</div>
      <div><strong>Hemoglobin (HB):</strong> ${patient.hb ? `${patient.hb} g/dL` : '-'}</div>
      <div><strong>Kesehatan Gigi & Karies:</strong> ${patient.karies || '-'}</div>
      <div><strong>Penggunaan Kacamata:</strong> ${patient.kacamata || 'Tidak'}</div>
      <div><strong>Status Menstruasi:</strong> ${patient.menstruasi || '-'}</div>
      <div><strong>Tingkat Kebugaran:</strong> ${patient.kebugaran || '-'}</div>
    `;
  } else {
    detailsBox.innerHTML = `
      <div><strong>Jenis Kelamin / Usia:</strong> ${patient.jenis_kelamin || '-'} / ${patient.umur || '-'} tahun</div>
      <div><strong>Alamat Domisili:</strong> ${patient.alamat || '-'}</div>
      <div><strong>No HP:</strong> ${patient.no_hp || '-'}</div>
      <div><strong>Riwayat Merokok:</strong> ${patient.merokok || '-'}</div>
      <div><strong>Kadar CO Pernapasan:</strong> ${patient.kadar_co ?? '-'} ppm</div>
      <div><strong>Pemeriksaan Katarak:</strong> ${patient.katarak || 'Normal'}</div>
      <div><strong>Pemeriksaan Telinga:</strong> ${patient.telinga || 'Normal'}</div>
    `;
  }

  document.getElementById("drawerPetugasDaftar").textContent = patient.petugas_pendaftaran || "-";
  document.getElementById("drawerPetugasPeriksa").textContent = patient.petugas_pemeriksaan || "-";
  document.getElementById("drawerUpdatedAt").textContent = patient.updated_at ? new Date(patient.updated_at).toLocaleString("id-ID") : "-";

  document.getElementById("drawerBackdrop").classList.add("show");
}

function closePatientDrawer(e) {
  if (e && e.target && e.target.id !== "drawerBackdrop" && !e.target.classList.contains("btn-drawer-close")) return;
  document.getElementById("drawerBackdrop").classList.remove("show");
  activePatient = null;
}

function openEditFromDrawer() {
  if (!activePatient) return;
  const nik = activePatient.nik;
  closePatientDrawer();
  openEditRecordModal(nik);
}

function deleteFromDrawer() {
  if (!activePatient) return;
  const nik = activePatient.nik;
  closePatientDrawer();
  handleDeleteSingle(nik);
}

// ==========================================================================
// 9. RECORD EDIT & ADD MODAL
// ==========================================================================

function openAddPatientModal() {
  document.getElementById("editModalTitle").textContent = `Tambah Pasien Baru (${currentCategory})`;
  document.getElementById("formActionType").value = "ADD";
  document.getElementById("recordForm").reset();
  document.getElementById("formNik").readOnly = false;

  const schoolFields = document.getElementById("formSchoolFields");
  if (schoolFields) {
    schoolFields.style.display = currentCategory === "SEKOLAH" ? "grid" : "none";
  }

  document.getElementById("editRecordModal").classList.add("show");
}

function openEditRecordModal(nik) {
  const patient = cachedRecords.find(r => r.nik === nik);
  if (!patient) return;

  document.getElementById("editModalTitle").textContent = `Edit Rekam Pasien: ${patient.nama}`;
  document.getElementById("formActionType").value = "EDIT";
  document.getElementById("formNik").value = patient.nik;
  document.getElementById("formNik").readOnly = true;
  document.getElementById("formNama").value = patient.nama || "";
  document.getElementById("formSekolah").value = patient.sekolah || "";
  document.getElementById("formKelas").value = patient.kelas || "";
  document.getElementById("formBb").value = patient.bb || "";
  document.getElementById("formTb").value = patient.tb || "";
  document.getElementById("formLp").value = patient.lp || "";
  document.getElementById("formSistol").value = patient.td_sistolik || "";
  document.getElementById("formDiastol").value = patient.td_diastolik || "";
  document.getElementById("formGula").value = patient.gula_darah || "";

  const schoolFields = document.getElementById("formSchoolFields");
  if (schoolFields) {
    schoolFields.style.display = currentCategory === "SEKOLAH" ? "grid" : "none";
  }

  document.getElementById("editRecordModal").classList.add("show");
}

function closeEditRecordModal() {
  document.getElementById("editRecordModal").classList.remove("show");
}

async function handleRecordFormSubmit(event) {
  event.preventDefault();
  const actionType = document.getElementById("formActionType").value;
  const nik = document.getElementById("formNik").value.trim();
  const nama = document.getElementById("formNama").value.trim();
  const sekolah = document.getElementById("formSekolah").value.trim();
  const kelas = document.getElementById("formKelas").value.trim();
  const bb = document.getElementById("formBb").value;
  const tb = document.getElementById("formTb").value;
  const lp = document.getElementById("formLp").value;
  const sistol = document.getElementById("formSistol").value;
  const diastol = document.getElementById("formDiastol").value;
  const gula = document.getElementById("formGula").value;

  const payload = {
    nik,
    category: currentCategory,
    nama,
    sekolah,
    kelas,
    bb,
    tb,
    lp,
    td_sistolik: sistol,
    td_diastolik: diastol,
    gula_darah: gula,
    petugas: currentUser?.nama || currentUser?.username,
    status: (bb && sistol) ? "SELESAI_PEMERIKSAAN" : "TERDAFTAR"
  };

  const btn = document.getElementById("btnSaveRecord");
  btn.disabled = true;

  try {
    const method = actionType === "ADD" ? "POST" : "PATCH";
    const res = await fetch("/api/records", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.status === "success") {
      showToast("Data pasien berhasil disimpan!", "success");
      closeEditRecordModal();
      loadDashboardData();
    } else {
      Swal.fire({ icon: "error", title: "Gagal Menyimpan", text: data.message, background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
  }
}

// ==========================================================================
// 10. DELETE (SINGLE & BULK)
// ==========================================================================

function toggleSelectRow(nik, checked) {
  if (checked) selectedNiks.add(nik);
  else selectedNiks.delete(nik);
  updateBulkDeleteButton();
}

function toggleSelectAll(checked) {
  if (checked) {
    cachedRecords.forEach(r => selectedNiks.add(r.nik));
  } else {
    selectedNiks.clear();
  }
  renderTableRows(cachedRecords);
  updateBulkDeleteButton();
}

function updateBulkDeleteButton() {
  const btn = document.getElementById("btnBulkDelete");
  const cnt = document.getElementById("bulkCount");
  if (btn && cnt) {
    cnt.textContent = selectedNiks.size;
    btn.style.display = selectedNiks.size > 0 ? "inline-flex" : "none";
  }
}

async function handleDeleteSingle(nik) {
  Swal.fire({
    title: "Hapus Rekam Medis?",
    text: `Data pasien dengan NIK ${nik} akan dihapus permanen dari D1.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#f43f5e"
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/records?nik=${encodeURIComponent(nik)}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok && data.status === "success") {
          showToast("Data berhasil dihapus.", "success");
          selectedNiks.delete(nik);
          loadDashboardData();
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
        }
      } catch (e) {
        Swal.fire({ icon: "error", title: "Error", text: e.message, background: "#131d31", color: "#fff" });
      }
    }
  });
}

async function handleBulkDelete() {
  if (selectedNiks.size === 0) return;
  const niksArray = Array.from(selectedNiks);

  Swal.fire({
    title: `Hapus ${niksArray.length} Pasien?`,
    text: "Tindakan ini tidak dapat dibatalkan.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: `Hapus ${niksArray.length} Data`,
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#f43f5e"
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch("/api/records", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ niks: niksArray })
        });
        const data = await res.json();
        if (res.ok && data.status === "success") {
          showToast(`${niksArray.length} data berhasil dihapus!`, "success");
          selectedNiks.clear();
          updateBulkDeleteButton();
          loadDashboardData();
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
        }
      } catch (e) {
        Swal.fire({ icon: "error", title: "Error", text: e.message, background: "#131d31", color: "#fff" });
      }
    }
  });
}

// ==========================================================================
// 11. SMART DRAG-AND-DROP EXCEL INGESTION ENGINE
// ==========================================================================

function openImportModal() {
  parsedImportData = [];
  const instansiEl = document.getElementById("importModalInstansi");
  if (instansiEl) {
    instansiEl.textContent = currentUser?.instansi || "Puskesmas";
  }
  document.getElementById("importPreviewBox").style.display = "none";
  document.getElementById("excelDropzone").style.display = "flex";
  document.getElementById("importModal").classList.add("show");
}

function closeImportModal() {
  document.getElementById("importModal").classList.remove("show");
}

function setupDropzoneEvents() {
  const dropzone = document.getElementById("excelDropzone");
  if (!dropzone) return;

  ["dragenter", "dragover"].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    }, false);
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    }, false);
  });

  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleExcelFileSelect(files);
    }
  });
}

function handleExcelFileSelect(files) {
  if (!files || files.length === 0) return;
  const file = files[0];
  const ext = file.name.split(".").pop().toLowerCase();

  if (!["xlsx", "xls", "csv"].includes(ext)) {
    Swal.fire({
      icon: "error",
      title: "Format Tidak Didukung",
      text: "Harap unggah file spreadsheet berekstensi .xlsx, .xls, atau .csv",
      background: "#131d31",
      color: "#fff"
    });
    return;
  }

  parseExcelFile(file);
}

function parseExcelFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array", raw: false });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      if (!rawRows || rawRows.length === 0) {
        Swal.fire({ icon: "warning", title: "File Kosong", text: "Tidak ada baris data yang terdeteksi dalam file ini.", background: "#131d31", color: "#fff" });
        return;
      }

      // Auto-column detection & Mapping
      const targetCat = document.querySelector('input[name="importCatTarget"]:checked')?.value || "SEKOLAH";
      let validList = [];
      let invalidCount = 0;

      rawRows.forEach(row => {
        let nikVal = "";
        let namaVal = "";
        let tglLahirVal = "";
        let jkVal = null;
        let sekolahVal = "";
        let kelasVal = "";
        let noHpVal = null;
        let alamatVal = null;

        let bbVal = null;
        let tbVal = null;
        let lpVal = null;
        let sistolVal = null;
        let diastolVal = null;
        let gulaVal = null;
        let hbVal = null;
        let kariesVal = null;
        let kacamataVal = null;
        let menstruasiVal = null;
        let kebugaranVal = null;
        let merokokVal = null;

        // Iterasi keys untuk mapping cerdas
        for (const k of Object.keys(row)) {
          const lk = k.toLowerCase().replace(/[^a-z0-9]/g, "");
          const v = String(row[k]).trim();

          if (!nikVal && (lk.includes("nik") || lk.includes("ktp") || lk.includes("identitas") || lk.includes("noktp"))) nikVal = v;
          else if (!namaVal && (lk.includes("nama") || lk.includes("siswa") || lk.includes("peserta") || lk.includes("pasien"))) namaVal = v;
          else if (!tglLahirVal && (lk.includes("tgllahir") || lk.includes("tanggallahir") || lk.includes("tgl"))) tglLahirVal = v;
          else if (!jkVal && (lk.includes("kelamin") || lk === "jk" || lk.includes("sex") || lk.includes("gender"))) jkVal = v;
          else if (!sekolahVal && (lk.includes("sekolah") || lk.includes("unit"))) sekolahVal = v;
          else if (!kelasVal && lk.includes("kelas")) kelasVal = v;
          else if (!noHpVal && (lk.includes("hp") || lk.includes("wa") || lk.includes("telepon") || lk.includes("whatsapp"))) noHpVal = v;
          else if (!alamatVal && (lk.includes("alamat") || lk.includes("desa") || lk.includes("domisili"))) alamatVal = v;
          
          // Pengukuran Fisik & Klinis
          else if (bbVal === null && (lk === "bb" || lk.includes("berat"))) bbVal = v ? parseFloat(v.replace(",", ".")) : null;
          else if (tbVal === null && (lk === "tb" || lk.includes("tinggi"))) tbVal = v ? parseFloat(v.replace(",", ".")) : null;
          else if (lpVal === null && (lk === "lp" || lk.includes("perut") || lk.includes("lingkar"))) lpVal = v ? parseFloat(v.replace(",", ".")) : null;
          else if (sistolVal === null && (lk.includes("sistol") || lk === "tds")) sistolVal = v ? parseInt(v, 10) : null;
          else if (diastolVal === null && (lk.includes("diastol") || lk === "tdd")) diastolVal = v ? parseInt(v, 10) : null;
          else if (gulaVal === null && (lk.includes("gula") || lk.includes("gds"))) gulaVal = v ? parseInt(v, 10) : null;
          else if (hbVal === null && (lk === "hb" || lk.includes("hemo"))) hbVal = v ? parseFloat(v.replace(",", ".")) : null;
          else if (!kariesVal && (lk.includes("gigi") || lk.includes("karies"))) kariesVal = v;
          else if (!kacamataVal && lk.includes("kacamata")) kacamataVal = v;
          else if (!menstruasiVal && lk.includes("menstruasi")) menstruasiVal = v;
          else if (!kebugaranVal && lk.includes("kebugaran")) kebugaranVal = v;
          else if (!merokokVal && lk.includes("rokok")) merokokVal = v;
        }

        // Sanitasi NIK (Hilangkan format scientific 3.2E+15 jika ada)
        nikVal = nikVal.replace(/[^0-9]/g, "");

        if (nikVal && nikVal.length >= 10) {
          validList.push({
            nik: nikVal,
            category: targetCat,
            nama: namaVal || "Tanpa Nama",
            tanggal_lahir: tglLahirVal,
            jenis_kelamin: jkVal,
            instansi: currentUser?.instansi || "Puskesmas",
            sekolah: sekolahVal,
            kelas: kelasVal,
            no_hp: noHpVal,
            alamat: alamatVal,
            bb: bbVal,
            tb: tbVal,
            lp: lpVal,
            td_sistolik: sistolVal,
            td_diastolik: diastolVal,
            gula_darah: gulaVal,
            hb: hbVal,
            karies: kariesVal,
            kacamata: kacamataVal,
            menstruasi: menstruasiVal,
            kebugaran: kebugaranVal,
            merokok: merokokVal,
            petugas: currentUser?.nama || currentUser?.username
          });
        } else {
          invalidCount++;
        }
      });

      parsedImportData = validList;

      // Update Report Preview
      document.getElementById("importFileName").textContent = file.name;
      document.getElementById("importValidCount").textContent = `${validList.length} Baris Siap Di-import`;

      const warningBox = document.getElementById("importWarningBox");
      if (invalidCount > 0) {
        warningBox.style.display = "block";
        document.getElementById("importWarningText").textContent = `${invalidCount} baris diabaikan karena kolom NIK kosong atau kurang dari 10 digit.`;
      } else {
        warningBox.style.display = "none";
      }

      document.getElementById("importPreviewBox").style.display = "block";
      document.getElementById("excelDropzone").style.display = "none";
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal Parsing File", text: err.message, background: "#131d31", color: "#fff" });
    }
  };

  reader.readAsArrayBuffer(file);
}

async function executeImport() {
  if (!parsedImportData || parsedImportData.length === 0) return;
  const btn = document.getElementById("btnExecuteImport");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mengunggah ${parsedImportData.length} data ke Cloudflare D1...`;

  try {
    const res = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instansi: currentUser?.instansi || "Puskesmas",
        bulk: parsedImportData
      })
    });

    const data = await res.json();
    if (res.ok && data.status === "success") {
      Swal.fire({
        icon: "success",
        title: "Import Berhasil!",
        text: `${data.successCount} rekam data pasien berhasil disimpan ke Bank Data ${currentUser?.instansi || 'Puskesmas'}.`,
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      closeImportModal();
      loadDashboardData();
    } else {
      Swal.fire({ icon: "error", title: "Import Gagal", text: data.message, background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-upload"></i> <span>Simpan ke Cloudflare D1 Sekarang</span>`;
  }
}

// ==========================================================================
// 12. 1-CLICK MULTI-SHEET EXCEL EXPORT (TEXT NIK PROTECTED) & PRINT
// ==========================================================================

async function exportToMultiSheetExcel() {
  showToast("Mengunduh seluruh rekam medis untuk ekspor...", "info");

  try {
    // Ambil seluruh data tanpa limit
    const res = await fetch(`/api/records?category=${currentCategory}&limit=all`);
    const data = await res.json();

    if (!res.ok || !data.records || data.records.length === 0) {
      showToast("Tidak ada data untuk diekspor!", "warning");
      return;
    }

    const records = data.records;
    const today = new Date().toISOString().split("T")[0];
    const filename = `Laporan_ENCO_${currentCategory}_${today}.xlsx`;

    // Sheet 1: Master Data
    const masterData = records.map((r, i) => {
      const imt = calcIMT(r.bb, r.tb);
      const bp = classifyBP(r.td_sistolik, r.td_diastolik);

      return {
        "No": i + 1,
        "NIK": String(r.nik || ""), // Kunci string
        "Nama Pasien": r.nama || "",
        "Kategori": r.category || "",
        "Tanggal Lahir": r.tanggal_lahir || "",
        "Sekolah / Alamat": currentCategory === "SEKOLAH" ? (r.sekolah || "") : (r.alamat || ""),
        "Kelas / No HP": currentCategory === "SEKOLAH" ? (r.kelas || "") : (r.no_hp || ""),
        "BB (kg)": r.bb !== null ? Number(r.bb) : "",
        "TB (cm)": r.tb !== null ? Number(r.tb) : "",
        "IMT": imt ? imt.val : "",
        "Status Gizi": imt ? imt.category : "",
        "Sistol": r.td_sistolik !== null ? Number(r.td_sistolik) : "",
        "Diastol": r.td_diastolik !== null ? Number(r.td_diastolik) : "",
        "Klasifikasi Tensi": bp ? bp.stage : "",
        "Gula Darah (mg/dL)": r.gula_darah !== null ? Number(r.gula_darah) : "",
        "Status Entry": r.status === "SELESAI_PEMERIKSAAN" ? "Selesai" : "Antrean",
        "Petugas": r.petugas_pemeriksaan || r.petugas_pendaftaran || "",
        "Waktu Input": r.updated_at || ""
      };
    });

    const wsMaster = XLSX.utils.json_to_sheet(masterData);

    // KUNCI TEXT NIK di Sheet Master
    const range = XLSX.utils.decode_range(wsMaster['!ref']);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: 1 }); // Kolom B
      if (wsMaster[cellAddress]) wsMaster[cellAddress].t = 's';
    }

    // Sheet 2: Rekapitulasi Eksekutif (Ringkasan)
    const summaryData = [
      { "Indikator": "Total Pasien Terdaftar", "Jumlah": records.length },
      { "Indikator": "Selesai Pemeriksaan Lengkap", "Jumlah": records.filter(r => r.status === "SELESAI_PEMERIKSAAN").length },
      { "Indikator": "Kasus Hipertensi (Sistol ≥ 140 atau Diastol ≥ 90)", "Jumlah": records.filter(r => r.td_sistolik >= 140 || r.td_diastolik >= 90).length },
      { "Indikator": "Kasus Obesitas (IMT ≥ 25)", "Jumlah": records.filter(r => {
        const imt = calcIMT(r.bb, r.tb);
        return imt && imt.val >= 25;
      }).length }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);

    // Buat Workbook & Tambah Sheets
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsMaster, `Data Master ${currentCategory}`);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Eksekutif");

    // Unduh File
    XLSX.writeFile(wb, filename);
    showToast(`File ${filename} berhasil diunduh!`, "success");
  } catch (err) {
    showToast("Gagal export excel: " + err.message, "error");
  }
}

function printOfficialReport() {
  document.getElementById("printDateReport").textContent = new Date().toLocaleDateString("id-ID", {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  window.print();
}

// ==========================================================================
// 13. BOT TELEMETRY & SPEED SETTING CONTROLS
// ==========================================================================

async function fetchBotTelemetry() {
  try {
    const res = await fetch("/api/bot");
    const data = await res.json();
    if (res.ok && data.status === "success" && data.bot) {
      const bot = data.bot;
      const pill = document.getElementById("botStatusPill");
      const txt = document.getElementById("botStatusText");

      if (bot.status === "ONLINE") {
        pill.className = "bot-live-pill";
        txt.textContent = "BOT ONLINE";
      } else {
        pill.className = "bot-live-pill idle";
        txt.textContent = "BOT IDLE";
      }

      if (bot.queue) {
        document.getElementById("telemetryQueued").textContent = bot.queue.queued || 0;
        document.getElementById("telemetrySynced").textContent = bot.queue.synced || 0;
        document.getElementById("telemetryFailed").textContent = bot.queue.failed || 0;
      }

      if (bot.currentTask) {
        document.getElementById("botCurrentTaskText").textContent = bot.currentTask;
      }

      const speedSelect = document.getElementById("botSpeedSelect");
      if (speedSelect && bot.delayMs) {
        speedSelect.value = String(bot.delayMs);
      }
    }
  } catch (e) {}
}

async function handleSpeedChange(delayMs) {
  showToast(`Mengatur jeda pengetikan robot ke ${delayMs}ms...`, "info");
  try {
    const res = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_speed", delayMs })
    });
    const data = await res.json();
    if (res.ok && data.status === "success") {
      showToast(data.message, "success");
    }
  } catch (e) {
    showToast("Gagal mengubah kecepatan bot: " + e.message, "error");
  }
}

async function triggerRequeue() {
  Swal.fire({
    title: "Re-Queue ke Ekstensi Bot?",
    text: `Seluruh data ${currentCategory} yang belum lengkap akan dimasukkan kembali ke antrean otomasi bot.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Ya, Masukkan ke Antrean",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#0d9488"
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch("/api/bot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "requeue", category: currentCategory })
        });
        const data = await res.json();
        if (res.ok && data.status === "success") {
          Swal.fire({ icon: "success", title: "Berhasil", text: data.message, background: "#131d31", color: "#fff" });
          fetchBotTelemetry();
        }
      } catch (e) {
        showToast("Error re-queue: " + e.message, "error");
      }
    }
  });
}

function triggerBotSync() {
  fetchBotTelemetry();
  showToast("Status fleet bot diperbarui.", "info");
}

// ==========================================================================
// 14. CLOUDFLARE R2 BACKUP STORAGE
// ==========================================================================

async function triggerR2Backup() {
  showToast("Mengunggah arsip snapshot ke Cloudflare R2...", "info");
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
        title: "Backup R2 Berhasil",
        text: data.message,
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      loadBackupList();
    } else {
      Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error R2", text: err.message, background: "#131d31", color: "#fff" });
  }
}

function openBackupModal() {
  document.getElementById("backupModal").classList.add("show");
  loadBackupList();
}

function closeBackupModal() {
  document.getElementById("backupModal").classList.remove("show");
}

async function loadBackupList() {
  const tbody = document.getElementById("backupTableBody");
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 15px;">Memuat arsip dari R2...</td></tr>`;

  try {
    const res = await fetch("/api/storage");
    const data = await res.json();
    if (res.ok && data.status === "success") {
      const backups = data.backups || [];
      if (backups.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 15px;">Belum ada arsip di R2.</td></tr>`;
        return;
      }

      tbody.innerHTML = backups.map(b => {
        const sizeKb = Math.round((b.size || 0) / 1024);
        const timeStr = b.uploaded ? new Date(b.uploaded).toLocaleString("id-ID") : "-";
        return `
          <tr>
            <td style="font-family: var(--font-mono); color: var(--teal-400);">${b.key}</td>
            <td>${sizeKb} KB</td>
            <td>${timeStr}</td>
            <td>
              <a href="/api/storage?file=${encodeURIComponent(b.key)}" class="btn-action-outline" style="padding: 3px 8px; font-size: 0.72rem; text-decoration: none; display: inline-flex;">
                <i class="fa-solid fa-download"></i> Unduh
              </a>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color: #fb7185; text-align:center;">Gagal memuat R2: ${e.message}</td></tr>`;
  }
}

// ==========================================================================
// 15. USER & LICENSE MANAGEMENT (3 ROLES & 6 FIELDS)
// ==========================================================================

let cachedUsers = [];
let searchUserKeyword = "";
let filterUserRoleVal = "";
let filterUserLisensiVal = "";
let filterUserStatusVal = "";

function openUserModal() {
  document.getElementById("userModal").classList.add("show");
  loadUserList();
}

function closeUserModal() {
  document.getElementById("userModal").classList.remove("show");
}

async function loadUserList() {
  const tbody = document.getElementById("userTableBody");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 25px; color: var(--text-secondary);"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat daftar akun...</td></tr>`;

  try {
    const res = await fetch("/api/users");
    const data = await res.json();
    if (res.ok && data.status === "success") {
      cachedUsers = data.users || [];
      applyUserFilters();
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="color:#fb7185; text-align:center; padding: 20px;">Gagal memuat: ${data.message}</td></tr>`;
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#fb7185; text-align:center; padding: 20px;">Error: ${e.message}</td></tr>`;
  }
}

function handleUserSearch(keyword) {
  searchUserKeyword = keyword.trim().toLowerCase();
  applyUserFilters();
}

function handleUserFilterChange() {
  filterUserRoleVal = document.getElementById("filterUserRole").value;
  filterUserLisensiVal = document.getElementById("filterUserLisensi").value;
  filterUserStatusVal = document.getElementById("filterUserStatus").value;
  applyUserFilters();
}

function applyUserFilters() {
  const tbody = document.getElementById("userTableBody");
  const today = new Date().toISOString().split("T")[0];

  const filtered = cachedUsers.filter(u => {
    // 1. Keyword search
    let matchKeyword = true;
    if (searchUserKeyword) {
      matchKeyword = (
        (u.username && u.username.toLowerCase().includes(searchUserKeyword)) ||
        (u.nama && u.nama.toLowerCase().includes(searchUserKeyword)) ||
        (u.instansi && u.instansi.toLowerCase().includes(searchUserKeyword))
      );
    }

    // 2. Role filter
    let matchRole = true;
    if (filterUserRoleVal) {
      matchRole = u.role === filterUserRoleVal;
    }

    // 3. Lisensi filter
    let matchLisensi = true;
    if (filterUserLisensiVal) {
      const uLis = String(u.lisensi || "").toUpperCase();
      const fLis = filterUserLisensiVal.toUpperCase();
      if (fLis === "BASIC") {
        matchLisensi = uLis.includes("BASIC") || (!uLis.includes("PRO") && !uLis.includes("FREE") && !uLis.includes("LIFETIME"));
      } else {
        matchLisensi = uLis.includes(fLis);
      }
    }

    // 4. Status filter
    let matchStatus = true;
    if (filterUserStatusVal) {
      if (filterUserStatusVal === "expired") {
        matchStatus = (u.role !== "super_admin" && u.lisensi !== "Lifetime" && u.masa_aktif && today > u.masa_aktif);
      } else {
        matchStatus = u.status_aktif === filterUserStatusVal;
      }
    }

    return matchKeyword && matchRole && matchLisensi && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 30px; color: var(--text-muted);"><i class="fa-regular fa-folder-open"></i> Tidak ada akun yang cocok dengan filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const isSuperAdmin = u.role === "super_admin" || u.role === "admin";
    const isPuskesmas = u.role === "puskesmas";
    const isRumahSakit = u.role === "rumah_sakit";

    // 1. Role Badge
    let roleBadge = "";
    if (isSuperAdmin) {
      roleBadge = `<span class="badge-role badge-role--superadmin"><i class="fa-solid fa-crown"></i> Super Admin</span>`;
    } else if (isPuskesmas) {
      roleBadge = `<span class="badge-role badge-role--puskesmas"><i class="fa-solid fa-hospital"></i> Puskesmas</span>`;
    } else {
      roleBadge = `<span class="badge-role badge-role--rumahsakit"><i class="fa-solid fa-hospital-user"></i> Rumah Sakit</span>`;
    }

    // 2. License & Expiration Tag
    let licenseBadge = "";
    if (isSuperAdmin || u.lisensi === "Lifetime") {
      licenseBadge = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div><span class="badge-license badge-license--lifetime"><i class="fa-solid fa-crown"></i> Lifetime</span></div>
          <span style="font-size: 0.68rem; color: #cbd5e1; font-weight: 600;">Semua Fitur (Permanen)</span>
        </div>
      `;
    } else {
      let lisensiType = "Basic";
      let lisensiClass = "badge-license--basic";
      let lisensiIcon = "fa-id-badge";
      let lisensiDesc = "Pendaftaran & Pasien Saja";

      const upperLis = String(u.lisensi || "").toUpperCase();
      if (upperLis.includes("PRO")) {
        lisensiType = "Pro";
        lisensiClass = "badge-license--pro";
        lisensiIcon = "fa-gem";
        lisensiDesc = "Semua Fitur Terbuka";
      } else if (upperLis.includes("FREE")) {
        lisensiType = "Free";
        lisensiClass = "badge-license--free";
        lisensiIcon = "fa-gift";
        lisensiDesc = "Maks 200 Data/Hari";
      }

      let expInfo = "";
      if (lisensiType === "Free") {
        expInfo = `<span class="badge-license badge-license--expired" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border-color: rgba(239, 68, 68, 0.4);"><i class="fa-solid fa-clock-rotate-left"></i> Expired (Maks 200 Data/Hari)</span>`;
      } else if (u.masa_aktif) {
        const diffDays = Math.ceil((new Date(u.masa_aktif).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
          expInfo = `<span class="badge-license badge-license--expired" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border-color: rgba(239, 68, 68, 0.5); font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> Expired (Turun ke Free)</span>`;
        } else if (diffDays <= 30) {
          expInfo = `<span style="font-size: 0.72rem; color: #fbbf24; font-weight:700;"><i class="fa-solid fa-clock"></i> Sisa ${diffDays} hr (${u.masa_aktif})</span>`;
        } else {
          expInfo = `<span style="font-size: 0.72rem; color: var(--text-secondary);"><i class="fa-regular fa-calendar"></i> s.d ${u.masa_aktif}</span>`;
        }
      } else {
        expInfo = `<span class="badge-license badge-license--expired" style="background: rgba(239, 68, 68, 0.15); color: #f87171;"><i class="fa-solid fa-triangle-exclamation"></i> Expired (Turun ke Free)</span>`;
      }

      licenseBadge = `
        <div style="display: flex; flex-direction: column; gap: 3px;">
          <div style="display: flex; align-items: center; gap: 5px;">
            <span class="badge-license ${lisensiClass}"><i class="fa-solid ${lisensiIcon}"></i> ${lisensiType}</span>
            <span style="font-size: 0.68rem; color: ${lisensiType === 'Pro' ? '#38bdf8' : (lisensiType === 'Free' ? '#34d399' : '#94a3b8')}; font-weight: 600;">${lisensiDesc}</span>
          </div>
          ${expInfo}
        </div>
      `;
    }

    // 3. Status Badge
    const isAktif = u.status_aktif === "aktif";
    const statusBadge = isAktif
      ? `<span class="badge-status badge-status--selesai"><i class="fa-solid fa-circle-check"></i> Aktif</span>`
      : `<span class="badge-status badge-risk--danger"><i class="fa-solid fa-circle-xmark"></i> Nonaktif</span>`;

    // 4. Action Buttons
    const isMasterAdmin = u.id === "usr_admin_master" || u.username === "admin";
    const actionButtons = isMasterAdmin
      ? `<span style="font-size: 0.72rem; color: var(--text-muted); font-style: italic;">Protected Master</span>`
      : `
        <div class="row-actions-group" style="justify-content: flex-end;">
          <button class="btn-row-action" onclick="openEditUserModal('${u.id}')" title="Edit Data & Lisensi">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn-row-action" onclick="handleResetPasswordPrompt('${u.id}', '${u.username}')" title="Reset Kata Sandi">
            <i class="fa-solid fa-key"></i>
          </button>
          <button class="btn-row-action" onclick="toggleUserStatus('${u.id}', '${isAktif ? 'nonaktif' : 'aktif'}')" title="${isAktif ? 'Nonaktifkan Akun' : 'Aktifkan Akun'}">
            <i class="fa-solid fa-power-off" style="color: ${isAktif ? 'var(--text-muted)' : '#34d399'};"></i>
          </button>
          <button class="btn-row-action delete" onclick="deleteUser('${u.id}', '${u.username}')" title="Hapus Akun">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;

    return `
      <tr>
        <td>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: 700; color: #fff; font-size: 0.88rem;">${u.nama || '-'}</div>
            <div style="font-family: var(--font-mono); font-size: 0.76rem; color: var(--teal-400);">@${u.username}</div>
            <div style="font-size: 0.74rem; color: var(--text-secondary); display: flex; align-items: center; gap: 5px;">
              <i class="fa-solid fa-building" style="font-size: 0.68rem; color: var(--text-muted);"></i>
              <span>${u.instansi || 'Puskesmas'}</span>
            </div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td>${licenseBadge}</td>
        <td>${statusBadge}</td>
        <td style="text-align: right;">${actionButtons}</td>
      </tr>
    `;
  }).join("");
}

// ==========================================================================
// SUB-MODAL: FORM PENDAFTARAN & EDIT AKUN (6 FIELDS)
// ==========================================================================

async function openAddUserModal() {
  document.getElementById("userFormMode").value = "ADD";
  document.getElementById("userFormId").value = "";
  document.getElementById("userFormTitle").textContent = "Pendaftaran Akun Baru";
  document.getElementById("userFormIcon").className = "fa-solid fa-user-plus";
  document.getElementById("accountForm").reset();

  document.getElementById("userUsernameInput").readOnly = false;
  document.getElementById("userPasswordLabel").textContent = "5. Password*";
  document.getElementById("userPasswordInput").required = true;
  document.getElementById("passwordEditHint").style.display = "none";

  // Default role: Puskesmas
  document.getElementById("userRoleSelect").value = "puskesmas";
  await handleRoleSelectionChange("puskesmas");

  // Inisialisasi jenis akun & masa aktif sesuai opsi default
  const defaultJenis = document.getElementById("userJenisAkunSelect").value;
  handleJenisAkunChange(defaultJenis);

  document.getElementById("userFormModal").classList.add("show");
}

async function openEditUserModal(userId) {
  const user = cachedUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById("userFormMode").value = "EDIT";
  document.getElementById("userFormId").value = userId;
  document.getElementById("userFormTitle").textContent = `Edit Akun: ${user.nama}`;
  document.getElementById("userFormIcon").className = "fa-solid fa-user-pen";
  document.getElementById("accountForm").reset();

  // 1. Role
  const roleSelect = document.getElementById("userRoleSelect");
  roleSelect.value = user.role || "puskesmas";

  // 2. Instansi Dropdown & Hidden Input
  document.getElementById("userInstansiInput").value = user.instansi || "";
  await populateInstansiDropdown(user.role || "puskesmas", user.instansi || "");

  // 3. Nama Petugas
  document.getElementById("userNamaInput").value = user.nama || "";

  // 4. Username (dikunci saat edit)
  const usernameInput = document.getElementById("userUsernameInput");
  usernameInput.value = user.username;
  usernameInput.readOnly = true;

  // 5. Password (opsional saat edit)
  document.getElementById("userPasswordLabel").textContent = "5. Password (Opsional)";
  document.getElementById("userPasswordInput").required = false;
  document.getElementById("passwordEditHint").style.display = "block";

  // 6. Jenis Akun & Masa Aktif
  handleRoleSelectionChange(user.role, false);
  const jenisAkunSelect = document.getElementById("userJenisAkunSelect");
  const upperLis = String(user.lisensi || "").toUpperCase();
  if (user.role === "super_admin" || upperLis.includes("LIFETIME")) {
    jenisAkunSelect.value = "Lifetime";
  } else if (upperLis.includes("PRO")) {
    jenisAkunSelect.value = "Pro";
  } else if (upperLis.includes("FREE")) {
    jenisAkunSelect.value = "Free";
  } else {
    jenisAkunSelect.value = "Basic";
  }

  handleJenisAkunChange(jenisAkunSelect.value);

  if (jenisAkunSelect.value !== "Free" && user.masa_aktif) {
    document.getElementById("userMasaAktifInput").value = user.masa_aktif;
  }

  document.getElementById("userFormModal").classList.add("show");
}

function closeUserFormModal() {
  document.getElementById("userFormModal").classList.remove("show");
}

async function handleRoleSelectionChange(role, shouldUpdateDropdown = true) {
  const jenisAkunSelect = document.getElementById("userJenisAkunSelect");
  const optLifetime = document.getElementById("optLifetime");
  const fieldMasaAktif = document.getElementById("fieldMasaAktif");

  // Sync Instansi dropdown with selected role
  if (shouldUpdateDropdown) {
    const curInstansi = document.getElementById("userInstansiInput").value;
    await populateInstansiDropdown(role, curInstansi);
  }

  if (role === "super_admin") {
    optLifetime.disabled = false;
    jenisAkunSelect.value = "Lifetime";
    jenisAkunSelect.disabled = true;
    if (fieldMasaAktif) fieldMasaAktif.style.display = "none";
    updateLicenseInfoBox("Lifetime");
  } else {
    optLifetime.disabled = true;
    jenisAkunSelect.disabled = false;
    if (jenisAkunSelect.value === "Lifetime") {
      jenisAkunSelect.value = "Free";
    }
    handleJenisAkunChange(jenisAkunSelect.value);
  }
}

let cachedFaskesListForDropdown = [];

async function populateInstansiDropdown(role, preselectedVal = "") {
  const select = document.getElementById("userInstansiSelect");
  const hiddenInput = document.getElementById("userInstansiInput");
  if (!select) return;

  const tipe = (role === "rumah_sakit") ? "RUMAH_SAKIT" : "PUSKESMAS";
  const labelTipe = (role === "rumah_sakit") ? "Rumah Sakit" : "Puskesmas";

  select.innerHTML = `<option value="">— Memuat daftar ${labelTipe}... —</option>`;

  try {
    let url = `/api/faskes?tipe=${encodeURIComponent(tipe)}`;
    if (role === "super_admin") {
      url = "/api/faskes";
    }
    const res = await fetch(url);
    const data = await res.json();
    const list = (data && data.faskes) ? data.faskes : [];
    cachedFaskesListForDropdown = list;

    let html = `<option value="">— Pilih ${labelTipe} Terdaftar —</option>`;
    let found = false;

    list.forEach(f => {
      const isSel = (preselectedVal && f.nama.trim().toLowerCase() === preselectedVal.trim().toLowerCase());
      if (isSel) found = true;
      html += `<option value="${f.nama}" ${isSel ? 'selected' : ''}>${f.nama} (${f.kab_kota || '-'}, ${f.kecamatan || '-'})</option>`;
    });

    if (preselectedVal && !found) {
      html += `<option value="${preselectedVal}" selected>${preselectedVal} (Tersimpan)</option>`;
    }

    html += `<option value="__ADD_NEW__" style="color: #34d399; font-weight: bold;">+ Daftarkan ${labelTipe} Baru...</option>`;
    select.innerHTML = html;

    if (preselectedVal) {
      select.value = preselectedVal;
      if (hiddenInput) hiddenInput.value = preselectedVal;
    } else {
      if (hiddenInput) hiddenInput.value = select.value === "__ADD_NEW__" ? "" : select.value;
    }
  } catch (err) {
    select.innerHTML = `
      <option value="">— Gagal memuat daftar faskes —</option>
      <option value="__ADD_NEW__">+ Daftarkan Manual...</option>
    `;
  }
}

function handleInstansiSelectChange(val) {
  if (val === "__ADD_NEW__") {
    promptQuickAddFaskes();
  } else {
    const hidden = document.getElementById("userInstansiInput");
    if (hidden) hidden.value = val;
  }
}

function promptQuickAddFaskes() {
  const role = document.getElementById("userRoleSelect").value;
  const tipe = (role === "rumah_sakit") ? "RUMAH_SAKIT" : "PUSKESMAS";
  const tipeLabel = (role === "rumah_sakit") ? "RUMAH SAKIT" : "PUSKESMAS";

  document.getElementById("quickFaskesTipe").value = tipe;
  document.getElementById("quickFaskesTipeText").textContent = tipeLabel;
  document.getElementById("quickFaskesModalTitle").textContent = `Daftarkan ${tipeLabel} Baru`;

  document.getElementById("quickFaskesNamaInput").value = "";
  document.getElementById("quickFaskesProvinsiInput").value = "Jawa Barat";
  document.getElementById("quickFaskesKabKotaInput").value = "";
  document.getElementById("quickFaskesKecamatanInput").value = "";

  document.getElementById("quickFaskesModal").classList.add("show");
}

function closeQuickFaskesModal() {
  document.getElementById("quickFaskesModal").classList.remove("show");
  const curVal = document.getElementById("userInstansiInput").value;
  const select = document.getElementById("userInstansiSelect");
  if (select) {
    select.value = curVal || "";
  }
}

async function handleQuickFaskesSubmit(event) {
  event.preventDefault();
  const tipe = document.getElementById("quickFaskesTipe").value;
  const nama = document.getElementById("quickFaskesNamaInput").value.trim();
  const provinsi = document.getElementById("quickFaskesProvinsiInput").value.trim();
  const kab_kota = document.getElementById("quickFaskesKabKotaInput").value.trim();
  const kecamatan = document.getElementById("quickFaskesKecamatanInput").value.trim();

  if (!nama || !provinsi || !kab_kota || !kecamatan) {
    Swal.fire({ icon: "warning", title: "Data Belum Lengkap", text: "Mohon isi semua field faskes.", background: "#131d31", color: "#fff" });
    return;
  }

  const btn = document.getElementById("btnSaveQuickFaskes");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mendaftarkan...`;

  try {
    const res = await fetch("/api/faskes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama, tipe, provinsi, kab_kota, kecamatan })
    });
    const data = await res.json();

    if (res.status === 409 || (data && data.status === "duplicate")) {
      Swal.fire({
        icon: "warning",
        title: "Faskes Sudah Terdaftar",
        text: data.message || "Faskes dengan nama, tipe, kab/kota, dan kecamatan tersebut sudah ada di database.",
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      return;
    }

    if (res.ok && data.status === "success") {
      showToast(`Unit ${tipe} "${nama}" berhasil didaftarkan!`, "success");
      closeQuickFaskesModal();

      const currentRole = document.getElementById("userRoleSelect").value;
      await populateInstansiDropdown(currentRole, nama);
      document.getElementById("userInstansiInput").value = nama;
      document.getElementById("userInstansiSelect").value = nama;
    } else {
      Swal.fire({ icon: "error", title: "Gagal Mendaftar", text: data.message || "Gagal menyimpan faskes", background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>Simpan & Pilih Faskes</span>`;
  }
}

function handleJenisAkunChange(jenis) {
  const fieldMasaAktif = document.getElementById("fieldMasaAktif");
  const userMasaAktifInput = document.getElementById("userMasaAktifInput");
  const labelMasaAktif = document.getElementById("labelMasaAktif");
  const boxMasaAktif = document.getElementById("boxMasaAktif");
  const masaAktifHelpText = document.getElementById("masaAktifHelpText");
  const masaAktifPresets = document.getElementById("masaAktifPresets");

  if (jenis === "Lifetime") {
    if (fieldMasaAktif) fieldMasaAktif.style.display = "none";
    if (userMasaAktifInput) {
      userMasaAktifInput.required = false;
      userMasaAktifInput.value = "";
    }
  } else if (jenis === "Free") {
    // Lisensi Free: Tidak ada masa aktif / bersifat Expired (dikunci)
    if (fieldMasaAktif) fieldMasaAktif.style.display = "flex";
    if (userMasaAktifInput) {
      userMasaAktifInput.required = false;
      userMasaAktifInput.disabled = true;
      userMasaAktifInput.value = "";
    }
    if (labelMasaAktif) {
      labelMasaAktif.innerHTML = 'Masa Aktif Lisensi <span style="color: #ef4444; font-size: 0.72rem; font-weight: 700;">(Terkunci - Bersifat Expired)</span>';
    }
    if (boxMasaAktif) {
      boxMasaAktif.style.opacity = "0.55";
      boxMasaAktif.style.cursor = "not-allowed";
      boxMasaAktif.style.background = "rgba(239, 68, 68, 0.08)";
      boxMasaAktif.style.borderColor = "rgba(239, 68, 68, 0.35)";
    }
    if (masaAktifHelpText) {
      masaAktifHelpText.innerHTML = '<i class="fa-solid fa-lock" style="color: #ef4444;"></i> <span style="color: #ef4444; font-weight: 600;">Lisensi Free tidak memiliki masa aktif (bersifat Expired). Fitur bot tetap aktif dengan batas kuota 200 data entry/hari.</span>';
    }
    if (masaAktifPresets) {
      masaAktifPresets.style.display = "none";
    }
  } else {
    // Basic atau Pro (Bisa diatur manual tanggal aktifnya)
    if (fieldMasaAktif) fieldMasaAktif.style.display = "flex";
    if (userMasaAktifInput) {
      userMasaAktifInput.disabled = false;
      userMasaAktifInput.required = true;
      if (!userMasaAktifInput.value) {
        setQuickDuration(365);
      }
    }
    if (labelMasaAktif) {
      labelMasaAktif.innerHTML = 'Masa Aktif Lisensi (Diatur Manual)*';
    }
    if (boxMasaAktif) {
      boxMasaAktif.style.opacity = "1";
      boxMasaAktif.style.cursor = "default";
      boxMasaAktif.style.background = "";
      boxMasaAktif.style.borderColor = "";
    }
    if (masaAktifHelpText) {
      masaAktifHelpText.innerHTML = '<i class="fa-solid fa-circle-info" style="color: var(--accent-cyan);"></i> Tanggal masa aktif dapat ditentukan secara manual dan bebas diubah kapan saja oleh Admin.';
    }
    if (masaAktifPresets) {
      masaAktifPresets.style.display = "flex";
    }
  }
  updateLicenseInfoBox(jenis);
}

function updateLicenseInfoBox(jenis) {
  const infoText = document.getElementById("licenseInfoText");
  if (!infoText) return;
  if (jenis === "Free") {
    infoText.innerHTML = `<strong>🎁 Lisensi Free:</strong> Fitur sama seperti Basic (Pendaftaran & Pasien saja), namun dibatasi <b>maksimal 200 data entry per hari</b> (dihitung 1 untuk daftar/periksa). Indikator sisa kuota akan tampil di Bot dekat identitas.`;
  } else if (jenis === "Basic") {
    infoText.innerHTML = `<strong>Lisensi Basic:</strong> Di Bot ENCO hanya fitur <b>Pendaftaran</b> dan <b>Pasien</b> yang terbuka (Kuota Unlimited). Fitur lainnya (Konfirmasi Hadir, Pelayanan, BNBA Umum, BNBA Sekolah, dan Tools) otomatis terkunci.`;
  } else if (jenis === "Pro") {
    infoText.innerHTML = `<strong>💎 Lisensi Pro:</strong> SEMUA fitur di Bot ENCO terbuka lengkap tanpa batas kuota (Pendaftaran, Pasien, Konfirmasi Hadir, Pelayanan, BNBA Umum, BNBA Sekolah, dan Tools).`;
  } else if (jenis === "Lifetime") {
    infoText.innerHTML = `<strong>👑 Lisensi Lifetime (Super Admin):</strong> Akses tak terbatas ke seluruh fitur bot secara permanen tanpa batas masa aktif dan tanpa batas kuota.`;
  }
}

function setQuickDuration(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const dateStr = d.toISOString().split("T")[0];
  document.getElementById("userMasaAktifInput").value = dateStr;
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  btn.innerHTML = `<i class="fa-solid ${isPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
}

async function handleAccountFormSubmit(event) {
  event.preventDefault();
  const mode = document.getElementById("userFormMode").value;
  const userId = document.getElementById("userFormId").value;

  const role = document.getElementById("userRoleSelect").value;
  const instansi = document.getElementById("userInstansiInput").value.trim();
  const nama = document.getElementById("userNamaInput").value.trim();
  const username = document.getElementById("userUsernameInput").value.trim();
  const password = document.getElementById("userPasswordInput").value.trim();
  let jenisAkun = document.getElementById("userJenisAkunSelect").value;
  let masaAktif = document.getElementById("userMasaAktifInput").value;

  if (role === "super_admin" || jenisAkun === "Lifetime" || jenisAkun === "Free") {
    if (role === "super_admin") jenisAkun = "Lifetime";
    masaAktif = null;
  }

  const payload = {
    role,
    instansi,
    nama,
    username,
    jenis_akun: jenisAkun,
    lisensi: jenisAkun,
    masa_aktif: masaAktif
  };

  if (password) {
    payload.password = password;
  }

  const btn = document.getElementById("btnSaveAccount");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

  try {
    let res;
    if (mode === "ADD") {
      res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      payload.id = userId;
      res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok && data.status === "success") {
      Swal.fire({
        icon: "success",
        title: "Berhasil",
        text: mode === "ADD" ? "Akun faskes berhasil ditambahkan!" : "Data akun berhasil diperbarui!",
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      closeUserFormModal();
      loadUserList();
    } else {
      Swal.fire({
        icon: "error",
        title: "Gagal Menyimpan",
        text: data.message,
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#f43f5e"
      });
    }
  } catch (e) {
    Swal.fire({ icon: "error", title: "Error", text: e.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>Simpan Akun Petugas</span>`;
  }
}

// Reset Password Prompt
async function handleResetPasswordPrompt(userId, username) {
  const { value: newPassword } = await Swal.fire({
    title: `Reset Kata Sandi`,
    html: `Masukkan kata sandi baru untuk akun <strong>@${username}</strong>:`,
    input: "password",
    inputPlaceholder: "Kata sandi baru (minimal 6 karakter)",
    inputAttributes: {
      autocapitalize: "off",
      autocorrect: "off"
    },
    showCancelButton: true,
    confirmButtonText: "Simpan Sandi Baru",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#0d9488",
    inputValidator: (val) => {
      if (!val || val.length < 4) {
        return "Kata sandi minimal 4 karakter!";
      }
    }
  });

  if (newPassword) {
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, password: newPassword })
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        showToast(`Kata sandi untuk @${username} berhasil direset!`, "success");
      } else {
        Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
      }
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
  }
}

async function toggleUserStatus(id, newStatus) {
  try {
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status_aktif: newStatus })
    });
    const data = await res.json();
    if (res.ok && data.status === "success") {
      showToast(`Status akun diubah ke ${newStatus}.`, "success");
      loadUserList();
    } else {
      showToast(data.message || "Gagal mengubah status.", "error");
    }
  } catch (e) {
    showToast("Gagal mengubah status: " + e.message, "error");
  }
}

async function deleteUser(id, username) {
  Swal.fire({
    title: `Hapus Akun @${username}?`,
    text: "Akun ini tidak akan dapat login lagi ke Control Panel ataupun ekstensi bot.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus Akun",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#f43f5e"
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok && data.status === "success") {
          showToast(`Akun @${username} berhasil dihapus.`, "success");
          loadUserList();
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
        }
      } catch (e) {
        showToast("Error: " + e.message, "error");
      }
    }
  });
}

// ==========================================================================
// 16. TOAST NOTIFICATION HELPER
// ==========================================================================

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";

  let icon = '<i class="fa-solid fa-circle-info" style="color: var(--teal-400);"></i>';
  if (type === "success") icon = '<i class="fa-solid fa-circle-check" style="color: #34d399;"></i>';
  if (type === "warning") icon = '<i class="fa-solid fa-triangle-exclamation" style="color: #fbbf24;"></i>';
  if (type === "error") icon = '<i class="fa-solid fa-circle-xmark" style="color: #fb7185;"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function focusBankData() {
  const el = document.getElementById("dataBankSection") || document.getElementById("searchInput");
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const input = document.getElementById("searchInput");
    if (input) {
      setTimeout(() => input.focus(), 400);
    }
  }
}
window.focusBankData = focusBankData;

// ==========================================================================
// 17. MASTER DATA FASKES (PUSKESMAS & RUMAH SAKIT)
// ==========================================================================

let cachedFaskes = [];
let currentFaskesTab = "PUSKESMAS"; // 'PUSKESMAS' or 'RUMAH_SAKIT'
let faskesSearchKeyword = "";

function openFaskesModal() {
  document.getElementById("faskesModal").classList.add("show");
  switchFaskesTab("PUSKESMAS");
  loadFaskesList();
}

function closeFaskesModal() {
  document.getElementById("faskesModal").classList.remove("show");
}

function switchFaskesTab(tipe) {
  currentFaskesTab = tipe;
  const tabPusk = document.getElementById("tabFaskesPuskesmas");
  const tabRS = document.getElementById("tabFaskesRS");
  const btnAddText = document.getElementById("btnAddFaskesText");

  if (tipe === "PUSKESMAS") {
    tabPusk.classList.add("active");
    tabRS.classList.remove("active");
    if (btnAddText) btnAddText.textContent = "Tambah Puskesmas";
  } else {
    tabRS.classList.add("active");
    tabPusk.classList.remove("active");
    if (btnAddText) btnAddText.textContent = "Tambah Rumah Sakit";
  }

  applyFaskesFilters();
}

async function loadFaskesList() {
  const tbody = document.getElementById("faskesTableBody");
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 25px; color: var(--text-secondary);"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat master data faskes...</td></tr>`;

  try {
    const res = await fetch("/api/faskes");
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`Server belum merespons API Faskes dengan JSON (${res.status}): ${text.slice(0, 100) || '(respon kosong)'}`);
    }

    if (res.ok && data.status === "success") {
      cachedFaskes = data.faskes || [];

      // Update counters
      const countPusk = cachedFaskes.filter(f => f.tipe === "PUSKESMAS").length;
      const countRS = cachedFaskes.filter(f => f.tipe === "RUMAH_SAKIT").length;
      const badgePusk = document.getElementById("badgeFaskesPuskesmas");
      const badgeRS = document.getElementById("badgeFaskesRS");
      if (badgePusk) badgePusk.textContent = countPusk;
      if (badgeRS) badgeRS.textContent = countRS;

      applyFaskesFilters();
    } else {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#fb7185; text-align:center; padding: 20px;">Gagal memuat: ${data.message || 'Kesalahan server'}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#fb7185; text-align:center; padding: 20px;">Error: ${err.message}</td></tr>`;
  }
}

function filterFaskesTable() {
  faskesSearchKeyword = (document.getElementById("faskesSearchInput").value || "").trim().toLowerCase();
  applyFaskesFilters();
}

function applyFaskesFilters() {
  const tbody = document.getElementById("faskesTableBody");
  if (!tbody) return;

  const filtered = cachedFaskes.filter(f => {
    if (f.tipe !== currentFaskesTab) return false;
    if (faskesSearchKeyword) {
      const q = faskesSearchKeyword;
      return (
        (f.nama && f.nama.toLowerCase().includes(q)) ||
        (f.provinsi && f.provinsi.toLowerCase().includes(q)) ||
        (f.kab_kota && f.kab_kota.toLowerCase().includes(q)) ||
        (f.kecamatan && f.kecamatan.toLowerCase().includes(q))
      );
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--text-muted);"><i class="fa-regular fa-folder-open"></i> Tidak ada unit ${currentFaskesTab === 'PUSKESMAS' ? 'Puskesmas' : 'Rumah Sakit'} terdaftar.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((f, idx) => {
    const tipeBadge = f.tipe === "PUSKESMAS"
      ? `<span class="badge-role badge-role--puskesmas"><i class="fa-solid fa-house-medical"></i> Puskesmas</span>`
      : `<span class="badge-role badge-role--rumahsakit"><i class="fa-solid fa-hospital"></i> RS</span>`;

    return `
      <tr>
        <td style="text-align: center; color: var(--text-muted);">${idx + 1}</td>
        <td style="font-weight: 600; color: #fff;">${f.nama}</td>
        <td>${tipeBadge}</td>
        <td>${f.provinsi || '-'}</td>
        <td>${f.kab_kota || '-'}</td>
        <td>${f.kecamatan || '-'}</td>
        <td style="text-align: center;">
          <button class="btn-row-action delete" onclick="deleteFaskes('${f.id}', '${f.nama}')" title="Hapus Faskes">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function openAddFaskesModal() {
  const form = document.getElementById("faskesForm");
  if (form) form.reset();
  document.getElementById("faskesFormId").value = "";
  document.getElementById("faskesTipeSelect").value = currentFaskesTab;
  document.getElementById("faskesProvinsiInput").value = "Jawa Barat";
  document.getElementById("faskesFormModal").classList.add("show");
}

function closeFaskesFormModal() {
  document.getElementById("faskesFormModal").classList.remove("show");
}

async function handleFaskesFormSubmit(event) {
  event.preventDefault();
  const tipe = document.getElementById("faskesTipeSelect").value;
  const nama = document.getElementById("faskesNamaInput").value.trim();
  const provinsi = document.getElementById("faskesProvinsiInput").value.trim();
  const kab_kota = document.getElementById("faskesKabKotaInput").value.trim();
  const kecamatan = document.getElementById("faskesKecamatanInput").value.trim();

  if (!nama || !provinsi || !kab_kota || !kecamatan) {
    Swal.fire({ icon: "warning", title: "Data Kurang", text: "Semua kolom wajib diisi!", background: "#131d31", color: "#fff" });
    return;
  }

  const btn = document.getElementById("btnSaveFaskes");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

  try {
    const res = await fetch("/api/faskes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama, tipe, provinsi, kab_kota, kecamatan })
    });
    const data = await res.json();

    if (res.status === 409 || (data && data.status === "duplicate")) {
      Swal.fire({
        icon: "warning",
        title: "Faskes Sudah Terdaftar",
        text: data.message || "Faskes dengan kombinasi nama, tipe, kab/kota, dan kecamatan tersebut sudah ada.",
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      return;
    }

    if (res.ok && data.status === "success") {
      showToast(`Unit ${tipe} "${nama}" berhasil disimpan.`, "success");
      closeFaskesFormModal();
      loadFaskesList();
    } else {
      Swal.fire({ icon: "error", title: "Gagal Menyimpan", text: data.message || "Gagal menyimpan faskes", background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>Simpan Faskes</span>`;
  }
}

async function deleteFaskes(id, nama) {
  Swal.fire({
    title: `Hapus Faskes?`,
    html: `Apakah Anda yakin ingin menghapus <strong>${nama}</strong> dari database?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#f43f5e"
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/faskes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok && data.status === "success") {
          showToast(`Faskes "${nama}" berhasil dihapus.`, "success");
          loadFaskesList();
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
        }
      } catch (e) {
        showToast("Error: " + e.message, "error");
      }
    }
  });
}

// ==========================================================================
// 18. MASTER DATA SEKOLAH PER PUSKESMAS (ISOLASI & ANTI-DUPLIKAT)
// ==========================================================================

let cachedSchools = [];
let schoolSearchKeyword = "";
let selectedSchoolInstansi = "";
let parsedSchoolImportList = [];

async function openSchoolsModal() {
  const isSuperAdmin = currentUser && (currentUser.role === "super_admin" || currentUser.role === "admin" || (currentUser.lisensi || "").toUpperCase().includes("LIFETIME"));
  const filterBox = document.getElementById("schoolPuskesmasFilterBox");
  const filterSelect = document.getElementById("schoolPuskesmasFilter");
  const displaySpan = document.getElementById("schoolModalInstansiDisplay");

  if (isSuperAdmin) {
    if (filterBox) filterBox.style.display = "block";
    if (displaySpan) displaySpan.textContent = "Semua Puskesmas (Admin View)";

    // Populate Puskesmas filter
    try {
      const res = await fetch("/api/faskes?tipe=PUSKESMAS");
      const data = await res.json();
      const puskList = data.faskes || [];
      filterSelect.innerHTML = `<option value="">— Tampilkan Semua Puskesmas —</option>` +
        puskList.map(p => `<option value="${p.nama}">${p.nama} (${p.kecamatan || '-'})</option>`).join("");
    } catch (e) {}

    selectedSchoolInstansi = filterSelect ? filterSelect.value : "";
  } else {
    if (filterBox) filterBox.style.display = "none";
    selectedSchoolInstansi = (currentUser && currentUser.instansi) ? currentUser.instansi : "";
    if (displaySpan) displaySpan.textContent = selectedSchoolInstansi || "Puskesmas Induk";
  }

  document.getElementById("schoolsModal").classList.add("show");
  loadSchoolsList();
}

function closeSchoolsModal() {
  document.getElementById("schoolsModal").classList.remove("show");
}

async function loadSchoolsList() {
  const tbody = document.getElementById("schoolsTableBody");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 25px; color: var(--text-secondary);"><i class="fa-solid fa-circle-notch fa-spin"></i> Memuat master data sekolah...</td></tr>`;

  const isSuperAdmin = currentUser && (currentUser.role === "super_admin" || currentUser.role === "admin" || (currentUser.lisensi || "").toUpperCase().includes("LIFETIME"));
  let instansiParam = "";

  if (isSuperAdmin) {
    const filterSelect = document.getElementById("schoolPuskesmasFilter");
    instansiParam = filterSelect ? filterSelect.value : "";
    selectedSchoolInstansi = instansiParam;
  } else {
    instansiParam = (currentUser && currentUser.instansi) ? currentUser.instansi : "";
    selectedSchoolInstansi = instansiParam;
  }

  try {
    let url = "/api/schools";
    if (instansiParam) {
      url += `?instansi=${encodeURIComponent(instansiParam)}`;
    }
    const res = await fetch(url);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`Server belum merespons API Schools dengan JSON (${res.status}): ${text.slice(0, 100) || '(respon kosong)'}`);
    }

    if (res.ok && data.status === "success") {
      cachedSchools = data.schools || [];
      applySchoolsFilters();
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="color:#fb7185; text-align:center; padding: 20px;">Gagal memuat: ${data.message || 'Kesalahan server'}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#fb7185; text-align:center; padding: 20px;">Error: ${err.message}</td></tr>`;
  }
}

function filterSchoolsTable() {
  schoolSearchKeyword = (document.getElementById("schoolSearchInput").value || "").trim().toLowerCase();
  applySchoolsFilters();
}

function applySchoolsFilters() {
  const tbody = document.getElementById("schoolsTableBody");
  if (!tbody) return;

  const filtered = cachedSchools.filter(s => {
    if (schoolSearchKeyword) {
      const q = schoolSearchKeyword;
      return (
        (s.nama_sekolah && s.nama_sekolah.toLowerCase().includes(q)) ||
        (s.alamat_sekolah && s.alamat_sekolah.toLowerCase().includes(q)) ||
        (s.instansi && s.instansi.toLowerCase().includes(q))
      );
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 30px; color: var(--text-muted);"><i class="fa-regular fa-folder-open"></i> Belum ada data sekolah yang tersimpan untuk Puskesmas ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((s, idx) => `
    <tr>
      <td style="text-align: center; color: var(--text-muted);">${idx + 1}</td>
      <td style="font-weight: 600; color: #fff;">
        <i class="fa-solid fa-graduation-cap" style="color: var(--teal-400); margin-right: 6px;"></i>
        ${s.nama_sekolah}
      </td>
      <td style="color: var(--text-secondary);">${s.alamat_sekolah || '-'}</td>
      <td style="color: #38bdf8; font-size: 0.78rem;">
        <i class="fa-solid fa-hospital" style="margin-right: 4px;"></i>${s.instansi}
      </td>
      <td style="text-align: center;">
        <button class="btn-row-action delete" onclick="deleteSchool('${s.id}', '${s.nama_sekolah.replace(/'/g, "\\'")}')" title="Hapus Sekolah">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join("");
}

function openAddSchoolModal() {
  const form = document.getElementById("schoolForm");
  if (form) form.reset();
  document.getElementById("schoolFormId").value = "";

  const instansiInput = document.getElementById("schoolInstansiInput");
  const activeInstansi = selectedSchoolInstansi || (currentUser && currentUser.instansi ? currentUser.instansi : "");

  if (!activeInstansi) {
    Swal.fire({
      icon: "info",
      title: "Pilih Puskesmas Terlebih Dahulu",
      text: "Silakan pilih Puskesmas pada dropdown filter di atas sebelum menambahkan sekolah.",
      background: "#131d31",
      color: "#fff"
    });
    return;
  }

  instansiInput.value = activeInstansi;
  document.getElementById("schoolFormModal").classList.add("show");
}

function closeSchoolFormModal() {
  document.getElementById("schoolFormModal").classList.remove("show");
}

async function handleSchoolFormSubmit(event) {
  event.preventDefault();
  const instansi = document.getElementById("schoolInstansiInput").value.trim();
  const nama_sekolah = document.getElementById("schoolNamaInput").value.trim();
  const alamat_sekolah = document.getElementById("schoolAlamatInput").value.trim();

  if (!instansi || !nama_sekolah || !alamat_sekolah) {
    Swal.fire({ icon: "warning", title: "Data Kurang", text: "Nama sekolah dan alamat wajib diisi!", background: "#131d31", color: "#fff" });
    return;
  }

  const btn = document.getElementById("btnSaveSchool");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

  try {
    const res = await fetch("/api/schools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instansi, nama_sekolah, alamat_sekolah })
    });
    const data = await res.json();

    if (res.status === 409 || (data && data.status === "duplicate")) {
      Swal.fire({
        icon: "warning",
        title: "Sekolah Duplikat",
        text: data.message || "Sekolah dengan nama dan alamat tersebut sudah ada di Puskesmas ini!",
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      return;
    }

    if (res.ok && data.status === "success") {
      showToast(`Sekolah "${nama_sekolah}" berhasil ditambahkan!`, "success");
      closeSchoolFormModal();
      loadSchoolsList();
    } else {
      Swal.fire({ icon: "error", title: "Gagal", text: data.message || "Gagal menyimpan data sekolah.", background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>Simpan Sekolah</span>`;
  }
}

async function deleteSchool(id, nama) {
  Swal.fire({
    title: `Hapus Sekolah?`,
    html: `Apakah Anda yakin ingin menghapus data sekolah <strong>${nama}</strong>?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, Hapus",
    cancelButtonText: "Batal",
    background: "#131d31",
    color: "#fff",
    confirmButtonColor: "#f43f5e"
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/schools?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok && data.status === "success") {
          showToast(`Sekolah "${nama}" berhasil dihapus.`, "success");
          loadSchoolsList();
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: data.message, background: "#131d31", color: "#fff" });
        }
      } catch (e) {
        showToast("Error: " + e.message, "error");
      }
    }
  });
}

function openSchoolImportModal() {
  const activeInstansi = selectedSchoolInstansi || (currentUser && currentUser.instansi ? currentUser.instansi : "");
  if (!activeInstansi) {
    Swal.fire({
      icon: "info",
      title: "Pilih Puskesmas Terlebih Dahulu",
      text: "Silakan pilih Puskesmas pada dropdown filter sebelum melakukan import data sekolah.",
      background: "#131d31",
      color: "#fff"
    });
    return;
  }

  parsedSchoolImportList = [];
  const fileInput = document.getElementById("schoolFileInput");
  if (fileInput) fileInput.value = "";
  document.getElementById("schoolFileName").textContent = "Format .csv, .xlsx, .xls";
  document.getElementById("schoolImportPreview").style.display = "none";
  document.getElementById("btnProcessSchoolImport").disabled = true;

  document.getElementById("schoolImportModal").classList.add("show");
}

function closeSchoolImportModal() {
  document.getElementById("schoolImportModal").classList.remove("show");
}

function handleSchoolFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  document.getElementById("schoolFileName").textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      if (!rawRows || rawRows.length === 0) {
        Swal.fire({ icon: "warning", title: "File Kosong", text: "Tidak ada baris data dalam file ini.", background: "#131d31", color: "#fff" });
        return;
      }

      parsedSchoolImportList = [];

      rawRows.forEach(row => {
        let nama = "";
        let alamat = "";

        for (const [key, val] of Object.entries(row)) {
          const k = key.toString().trim().toLowerCase();
          const v = (val || "").toString().trim();
          if (k.includes("nama") && (k.includes("sekolah") || k.includes("instansi") || k.includes("sd") || k.includes("smp"))) {
            nama = v;
          } else if (!nama && k.includes("nama")) {
            nama = v;
          } else if (k.includes("alamat")) {
            alamat = v;
          }
        }

        if (!nama && Object.values(row)[0]) {
          nama = Object.values(row)[0].toString().trim();
        }
        if (!alamat && Object.values(row)[1]) {
          alamat = Object.values(row)[1].toString().trim();
        }

        if (nama) {
          parsedSchoolImportList.push({
            nama_sekolah: nama,
            alamat_sekolah: alamat || "Alamat belum diatur"
          });
        }
      });

      if (parsedSchoolImportList.length > 0) {
        document.getElementById("schoolImportCount").textContent = parsedSchoolImportList.length;
        document.getElementById("schoolImportPreview").style.display = "block";
        document.getElementById("btnProcessSchoolImport").disabled = false;
      } else {
        Swal.fire({ icon: "warning", title: "Format Tidak Dikenali", text: "Pastikan ada kolom 'Nama Sekolah' dan 'Alamat Sekolah'.", background: "#131d31", color: "#fff" });
      }
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal Membaca File", text: err.message, background: "#131d31", color: "#fff" });
    }
  };
  reader.readAsArrayBuffer(file);
}

async function processSchoolImport() {
  const activeInstansi = selectedSchoolInstansi || (currentUser && currentUser.instansi ? currentUser.instansi : "");
  if (!activeInstansi || parsedSchoolImportList.length === 0) return;

  const btn = document.getElementById("btnProcessSchoolImport");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Mengimpor...`;

  try {
    const res = await fetch("/api/schools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instansi: activeInstansi,
        schools: parsedSchoolImportList
      })
    });
    const data = await res.json();

    if (res.ok && data.status === "success") {
      Swal.fire({
        icon: "success",
        title: "Import Selesai",
        html: `Berhasil mengimpor <strong>${data.inserted || 0}</strong> sekolah baru.<br><small style="color: var(--text-muted);">Dilewati (Duplikat): ${data.skipped_duplicates || 0} sekolah.</small>`,
        background: "#131d31",
        color: "#fff",
        confirmButtonColor: "#0d9488"
      });
      closeSchoolImportModal();
      loadSchoolsList();
    } else {
      Swal.fire({ icon: "error", title: "Gagal Mengimpor", text: data.message || "Gagal", background: "#131d31", color: "#fff" });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "Error", text: err.message, background: "#131d31", color: "#fff" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-upload"></i> <span>Proses Impor</span>`;
  }
}
