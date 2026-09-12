/**
 * Cloudflare Pages Function: /api/users
 * Manajemen Pengguna (Khusus Role Admin: List, Tambah, Edit Masa Aktif & Status)
 */

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestGet({ env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (!env || !env.DB) {
    // Mock user list jika preview tanpa D1
    return new Response(
      JSON.stringify({
        status: "success",
        users: [
          {
            id: "usr_admin_master",
            username: "admin",
            nama: "Super Administrator",
            role: "admin",
            instansi: "Dinas Kesehatan / Puskesmas Pusat",
            status_aktif: "aktif",
            masa_aktif: null,
            lisensi: "ENTERPRISE-LIFETIME"
          },
          {
            id: "usr_petugas_demo",
            username: "petugas1",
            nama: "Petugas Skrining 1",
            role: "petugas",
            instansi: "Puskesmas",
            status_aktif: "aktif",
            masa_aktif: "2026-12-31",
            lisensi: "STANDARD-PRO"
          }
        ]
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT id, username, nama, role, instansi, status_aktif, masa_aktif, lisensi, created_at FROM users ORDER BY role ASC, created_at DESC"
    ).all();

    return new Response(JSON.stringify({ status: "success", users: results || [] }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", message: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const username = (body.username || "").trim().toLowerCase();
    const password = (body.password || "").trim();
    const nama = (body.nama || "").trim();
    const role = (body.role || "petugas").trim().toLowerCase();
    const instansi = (body.instansi || "Puskesmas").trim();
    const statusAktif = (body.status_aktif || "aktif").trim().toLowerCase();
    
    // Admin selalu Lifetime (masa_aktif = null). Petugas wajib punya tanggal masa aktif.
    const masaAktif = role === "admin" ? null : (body.masa_aktif || "2026-12-31");
    const lisensi = body.lisensi || (role === "admin" ? "ENTERPRISE-LIFETIME" : "STANDARD-PRO");

    if (!username || !password || !nama) {
      return new Response(
        JSON.stringify({ status: "error", message: "Username, Password, dan Nama Lengkap wajib diisi!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "User berhasil dibuat (Mode Mock)" }),
        { status: 200, headers: corsHeaders }
      );
    }

    const id = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    await env.DB.prepare(`
      INSERT INTO users (id, username, password, nama, role, instansi, status_aktif, masa_aktif, lisensi)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `).bind(id, username, password, nama, role, instansi, statusAktif, masaAktif, lisensi).run();

    return new Response(
      JSON.stringify({ status: "success", message: "Akun pengguna berhasil ditambahkan!" }),
      { status: 201, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal membuat user: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestPatch({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const id = body.id;
    if (!id) {
      return new Response(
        JSON.stringify({ status: "error", message: "ID User wajib disertakan!" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!env || !env.DB) {
      return new Response(
        JSON.stringify({ status: "success", message: "User berhasil diperbarui (Mode Mock)" }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Ambil data user saat ini
    const existing = await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first();
    if (!existing) {
      return new Response(
        JSON.stringify({ status: "error", message: "User tidak ditemukan!" }),
        { status: 404, headers: corsHeaders }
      );
    }

    const statusAktif = body.status_aktif !== undefined ? body.status_aktif : existing.status_aktif;
    let masaAktif = body.masa_aktif !== undefined ? body.masa_aktif : existing.masa_aktif;
    if (existing.role === "admin") masaAktif = null; // Admin selalu Lifetime

    const password = body.password ? body.password : existing.password;
    const nama = body.nama ? body.nama : existing.nama;
    const instansi = body.instansi ? body.instansi : existing.instansi;

    await env.DB.prepare(`
      UPDATE users SET
        nama = ?1,
        password = ?2,
        instansi = ?3,
        status_aktif = ?4,
        masa_aktif = ?5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?6
    `).bind(nama, password, instansi, statusAktif, masaAktif, id).run();

    return new Response(
      JSON.stringify({ status: "success", message: "Data akun berhasil diperbarui!" }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", message: "Gagal update user: " + err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}
