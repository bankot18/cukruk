/**
 * Cloudflare Pages Function: /api/auth
 * Menangani Autentikasi Pengguna & Aturan Lisensi (Admin Lifetime vs Petugas Berbatas Waktu)
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const username = (body.username || "").toString().trim().toLowerCase();
    const password = (body.password || "").toString().trim();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ status: "error", message: "Username dan password tidak boleh kosong!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Jika belum ada binding D1 (misal saat preview lokal tanpa wrangler), gunakan mock fallback
    if (!env || !env.DB) {
      if (username === "admin" && password === "admin123") {
        return new Response(
          JSON.stringify({
            status: "success",
            message: "Login berhasil (Akun Admin - Mode Lifetime)",
            user: {
              id: "usr_admin_master",
              username: "admin",
              nama: "Super Administrator",
              role: "admin",
              instansi: "Dinas Kesehatan / Puskesmas Pusat",
              status_aktif: "aktif",
              masa_aktif: null,
              lisensi: "ENTERPRISE-LIFETIME"
            }
          }),
          { status: 200, headers: corsHeaders }
        );
      } else if (username === "petugas1" && password === "petugas123") {
        return new Response(
          JSON.stringify({
            status: "success",
            message: "Login berhasil!",
            user: {
              id: "usr_petugas_demo",
              username: "petugas1",
              nama: "Petugas Skrining 1",
              role: "petugas",
              instansi: "Puskesmas",
              status_aktif: "aktif",
              masa_aktif: "2026-12-31",
              lisensi: "STANDARD-PRO"
            }
          }),
          { status: 200, headers: corsHeaders }
        );
      }
      return new Response(
        JSON.stringify({ status: "error", message: "Username atau password salah!" }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Query ke Cloudflare D1
    const stmt = env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = ?1");
    const user = await stmt.bind(username).first();

    if (!user) {
      return new Response(
        JSON.stringify({ status: "error", message: "Akun tidak ditemukan!" }),
        { status: 401, headers: corsHeaders }
      );
    }

    if (user.password !== password) {
      return new Response(
        JSON.stringify({ status: "error", message: "Password yang Anda masukkan salah!" }),
        { status: 401, headers: corsHeaders }
      );
    }

    if (user.status_aktif !== "aktif") {
      return new Response(
        JSON.stringify({ status: "error", message: `Akun Anda sedang nonaktif (${user.status_aktif}). Silakan hubungi Admin.` }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Normalisasi Role & Lisensi
    let normalizedRole = user.role;
    let normalizedLisensi = user.lisensi || "Basic";

    const rawRole = (user.role || "").toLowerCase();
    const rawLis = (user.lisensi || "").toUpperCase();

    if (rawRole === "admin" || rawRole === "super_admin" || rawRole === "superadmin" || rawRole.includes("admin") || rawLis.includes("LIFETIME")) {
      normalizedRole = "super_admin";
      normalizedLisensi = "Lifetime";
    } else if (user.role === "puskesmas") {
      normalizedRole = "puskesmas";
    } else if (user.role === "rumah_sakit") {
      normalizedRole = "rumah_sakit";
    } else {
      if (normalizedLisensi.toUpperCase().includes("RS") || (user.instansi && user.instansi.toLowerCase().includes("rs"))) {
        normalizedRole = "rumah_sakit";
      } else {
        normalizedRole = "puskesmas";
      }
    }

    if (normalizedLisensi.toUpperCase().includes("PRO")) normalizedLisensi = "Pro";
    else if (normalizedLisensi.toUpperCase().includes("LIFETIME")) normalizedLisensi = "Lifetime";
    else if (normalizedLisensi.toUpperCase().includes("FREE")) normalizedLisensi = "Free";
    else normalizedLisensi = "Basic";

    // Pengecekan Masa Aktif Lisensi:
    // Super Admin / Lifetime TIDAK ADA MASA AKTIF.
    // Jika lisensi Basic atau Pro habis masa aktifnya, OTOMATIS TURUN KE FREE (Expired).
    // Lisensi Free memang tidak memiliki masa aktif (bersifat Expired).
    let isExpired = false;
    if (normalizedRole !== "super_admin" && normalizedLisensi !== "Lifetime") {
      if (user.masa_aktif) {
        const today = new Date().toISOString().split("T")[0];
        if (today > user.masa_aktif) {
          isExpired = true;
          normalizedLisensi = "Free"; // Otomatis turun ke Free saat masa aktif habis
        }
      } else {
        isExpired = true; // Lisensi Free tidak memiliki masa aktif (Expired)
        normalizedLisensi = "Free";
      }
    }

    // Berhasil Login
    const isSuperAdmin = (normalizedRole === "super_admin");
    const isLifetime = isSuperAdmin || normalizedLisensi === "Lifetime";
    const isPro = !isExpired && (isLifetime || normalizedLisensi === "Pro");
    const isFree = isExpired || normalizedLisensi === "Free";
    const isBasic = !isPro && !isFree;

    const allowedFeatures = isPro
      ? ["pendaftaran", "pelayanan-instan", "konfirmasi-hadir", "otomasi", "bnba-umum", "bnba-sekolah", "tools", "pengaturan"]
      : ["pendaftaran", "pelayanan-instan", "pengaturan"];

    const safeUser = {
      id: user.id,
      username: user.username,
      nama: user.nama,
      role: normalizedRole,
      instansi: user.instansi,
      status_aktif: user.status_aktif,
      masa_aktif: isLifetime ? null : (isFree ? null : user.masa_aktif),
      masaAktif: isLifetime ? null : (isFree ? null : user.masa_aktif),
      lisensi: isLifetime ? "Lifetime" : (isPro ? "Pro" : (isFree ? "Free" : "Basic")),
      isSuperAdmin,
      isLifetime,
      isPro,
      isBasic,
      isFree,
      isExpired,
      maxDailyQuota: isFree ? 200 : null,
      allowedFeatures
    };

    return new Response(
      JSON.stringify({
        status: "success",
        message: isLifetime 
          ? "Login berhasil (Akses Seluruh Fitur - Lifetime)" 
          : (isPro 
              ? "Login berhasil (Lisensi PRO - Seluruh Fitur)" 
              : (isFree 
                  ? "Login berhasil (Lisensi FREE - Kuota Maks 200 Data/Hari)" 
                  : "Login berhasil (Lisensi BASIC - Fitur Pendaftaran & Pasien Unlimited)")),
        user: safeUser
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Internal server error: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}
