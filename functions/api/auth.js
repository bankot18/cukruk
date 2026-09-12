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

    // Pengecekan Masa Aktif Lisensi:
    // ATURAN: Admin TIDAK ADA MASA AKTIF (Lifetime).
    // Masa aktif hanya dicek untuk akun PETUGAS / BIASA.
    if (user.role === "petugas") {
      if (user.masa_aktif) {
        const today = new Date().toISOString().split("T")[0];
        if (today > user.masa_aktif) {
          return new Response(
            JSON.stringify({
              status: "error",
              message: `Masa aktif akun Anda telah berakhir pada ${user.masa_aktif}. Silakan hubungi Admin untuk perpanjangan lisensi.`
            }),
            { status: 403, headers: corsHeaders }
          );
        }
      }
    }

    // Berhasil Login
    const safeUser = {
      id: user.id,
      username: user.username,
      nama: user.nama,
      role: user.role,
      instansi: user.instansi,
      status_aktif: user.status_aktif,
      masa_aktif: user.role === "admin" ? null : user.masa_aktif,
      lisensi: user.lisensi
    };

    return new Response(
      JSON.stringify({
        status: "success",
        message: user.role === "admin" ? "Login berhasil (Akun Admin - Akses Lifetime)" : "Login berhasil!",
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
